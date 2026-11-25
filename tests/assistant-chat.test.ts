import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Response } from 'undici';
import { Store } from '../electron/core/store';
import { VideoSettings } from '../electron/core/video-settings';
import type { Network } from '../electron/core/network';
import { AssistantStorage } from '../electron/core/assistant/storage';
import { Providers } from '../electron/core/assistant/provider';
import { AssistantChat } from '../electron/core/assistant/chat';
import { chatMessages } from '../electron/core/assistant/prompts';
import { AssistantTools } from '../electron/core/assistant/tools';
import type { AiSend } from '../shared/assistant';

let root: string,
  storage: AssistantStorage,
  chat: AssistantChat,
  input: AiSend,
  tools: AssistantTools;
const calls: { messages: { role: string; content: string }[]; tools?: unknown[] }[] = [];
const responses: Response[] = [];
function answer(content: string | null, tool?: string) {
  const message = {
    content,
    tool_calls: tool
      ? [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: tool,
              arguments: JSON.stringify(
                tool === 'configure_launcher' ? { changes: { concurrency: 3 } } : {},
              ),
            },
          },
        ]
      : undefined,
  };
  return Response.json({ choices: [{ message, finish_reason: tool ? 'tool_calls' : 'stop' }] });
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-ai-chat-'));
  const store = new Store(root);
  storage = new AssistantStorage(root);
  const providers = new Providers(
    storage,
    { has: async () => false, get: async () => undefined, set: async () => {} },
    {
      response: async (_url: string, opts: { body: string }) => {
        calls.push(JSON.parse(opts.body));
        return responses.shift();
      },
    } as unknown as Network,
  );
  const providerId = randomUUID();
  await providers.save({
    id: providerId,
    name: 'fixture',
    baseUrl: 'https://fixture.invalid',
    models: ['local'],
    enabled: true,
  });
  tools = new AssistantTools(
    store,
    new VideoSettings(store),
    async () => [],
    async (_, write) => write(),
    () => {},
  );
  chat = new AssistantChat(
    storage,
    providers,
    tools,
    () => {},
    () => {},
    () => {},
  );
  input = { providerId, chatId: randomUUID(), model: 'local', mode: 'assist', text: '查看设置' };
  calls.length = responses.length = 0;
});
afterEach(() => rm(root, { recursive: true, force: true }));
it('bounds model context while keeping complete recent turns and full local history', async () => {
  responses.push(answer('好的'));
  await chat.send(input);
  const saved = storage.chat(input.chatId)!;
  saved.messages = Array.from({ length: 60 }, (_, n) => ({
    role: n % 2 === 0 ? 'user' : 'assistant',
    text: '消息 ' + n + 'x'.repeat(1500),
    at: n,
  }));
  storage.saveChat(saved);
  const context = chatMessages(saved);
  expect(context[0].role).toBe('system');
  expect(context[1].role).toBe('user');
  expect(context.at(-1)?.content).toBe(saved.messages.at(-1)?.text);
  expect(
    context
      .slice(1)
      .map((m) => m.content)
      .join('').length,
  ).toBeLessThanOrEqual(24000);
  expect(storage.chat(input.chatId)?.messages).toHaveLength(60);
});
it('reads tools across rounds and persists only the conversation', async () => {
  responses.push(answer(null, 'launcher_overview'), answer('当前并行数为 6。'));
  await chat.send(input);
  expect(calls[0].tools?.length).toBeGreaterThan(1);
  expect(calls[1].messages.at(-1)).toMatchObject({ role: 'tool' });
  expect(calls[1].messages.at(-1)?.content).not.toContain(root);
  const saved = new AssistantStorage(root).chat(input.chatId)!;
  expect(saved.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  responses.push(answer(null, 'configure_launcher'));
  await chat.send({ ...input, text: '并行数设为 3' });
  expect(calls.at(-1)?.messages).toContainEqual({ role: 'assistant', content: '当前并行数为 6。' });
  expect(tools.changes()[0]).toMatchObject({ source: 'assistant', status: 'pending' });
  expect(storage.chat(input.chatId)?.messages.at(-1)?.change?.status).toBe('pending');
  tools.revoke(() => true);
  expect(chat.history(input.chatId).at(-1)?.change?.status).toBe('expired');
});
it('cancels a streaming turn without invoking incomplete calls and pins each chat to its original endpoint', async () => {
  let end!: () => void;
  responses.push(
    new Response(
      new ReadableStream({
        start(controller) {
          end = () => controller.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    ),
  );
  const sending = chat.send(input);
  await expect.poll(() => calls.length).toBe(1);
  chat.cancel(input.chatId);
  end();
  await sending;
  expect(chat.history(input.chatId).at(-1)?.text).toBe('已停止回复');
  const old = storage.config;
  storage.configure({
    ...old,
    providers: old.providers.map((p) =>
      p.id === input.providerId ? { ...p, baseUrl: 'https://different.invalid' } : p,
    ),
  });
  await expect(chat.send(input)).rejects.toThrow('绑定');
  expect(calls).toHaveLength(1);
  expect(tools.changes()).toHaveLength(0);
});
it('streams UTF-8 text, omits tools in chat mode and allows retry after an interrupted stream', async () => {
  const body = 'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\n';
  const headers = { 'content-type': 'text/event-stream' };
  responses.push(new Response(body, { headers }));
  input.mode = 'chat';
  await chat.send(input);
  expect(calls[0]).not.toHaveProperty('tools');
  expect(storage.chat(input.chatId)?.messages.at(-1)?.role).toBe('error');
  const bytes = Buffer.from(
    body + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
  );
  responses.push(
    new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        },
      }),
      { headers },
    ),
  );
  await chat.send({ ...input, retry: true });
  expect(storage.chat(input.chatId)?.messages.map((m) => m.text)).toEqual(['查看设置', '你好']);
});
