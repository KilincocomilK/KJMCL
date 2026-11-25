import { z } from 'zod';
import { readJsonResponse, textChunks, type ModelResponse } from './provider';
import type { WireCall, WireMessage } from './prompts';

const deltaSchema = z.object({
  content: z.string().nullish(),
  reasoning_content: z.string().nullish(),
  tool_calls: z
    .array(
      z.object({
        index: z.int().min(0).max(5).optional(),
        id: z.string().max(256).nullish(),
        function: z
          .object({
            name: z.string().max(128).nullish(),
            arguments: z.string().max(16384).nullish(),
          })
          .optional(),
      }),
    )
    .max(6)
    .nullish(),
});
const frameSchema = z.object({
  choices: z
    .array(
      z.object({
        index: z.number().optional(),
        delta: deltaSchema.optional(),
        message: deltaSchema.optional(),
        finish_reason: z.string().nullish(),
      }),
    )
    .max(8),
});
async function* frames(response: ModelResponse) {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    yield await readJsonResponse(response);
    return;
  }
  let buffer = '',
    data: string[] = [];
  for await (const chunk of textChunks(response)) {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      if (!line && data.length) {
        const payload = data.join('\n');
        data = [];
        if (payload === '[DONE]') return;
        try {
          yield JSON.parse(payload);
        } catch {
          throw new Error('模型流包含无效数据');
        }
      }
    }
  }
}
export async function completion(
  response: ModelResponse,
  update: (text: string) => void,
): Promise<WireMessage> {
  let text = '',
    reasoning = '',
    finish = '';
  const calls = new Map<number, WireCall>();
  for await (const raw of frames(response)) {
    const frame = frameSchema.safeParse(raw);
    if (!frame.success) throw new Error('模型回复格式无效');
    const choice = frame.data.choices.find((c) => (c.index ?? 0) === 0);
    const delta = choice?.delta ?? choice?.message;
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (!delta) continue;
    reasoning += delta.reasoning_content ?? '';
    if (delta.content) {
      text += delta.content;
      update(text);
    }
    if (text.length > 32000 || reasoning.length > 64000)
      throw new Error('模型回复过长，请缩小问题范围');
    for (const [i, fragment] of (delta.tool_calls ?? []).entries()) {
      const index = fragment.index ?? i;
      const call = calls.get(index) ?? {
        type: 'function',
        id: '',
        function: { name: '', arguments: '' },
      };
      call.id += fragment.id ?? '';
      call.function.name += fragment.function?.name ?? '';
      call.function.arguments += fragment.function?.arguments ?? '';
      if (
        call.id.length > 256 ||
        call.function.name.length > 128 ||
        call.function.arguments.length > 16384
      )
        throw new Error('工具调用超过长度上限');
      calls.set(index, call);
    }
  }
  if (!['stop', 'tool_calls'].includes(finish))
    throw new Error(
      finish === 'length' ? '回复达到模型长度上限，请缩小问题范围' : '模型回复未完整结束，请重试',
    );
  const tools = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
  if (!text.trim() && !tools.length) throw new Error('模型返回了空回复');
  if (
    tools.some((c) => !c.id || !c.function.name) ||
    new Set(tools.map((c) => c.id)).size !== tools.length
  )
    throw new Error('模型返回了不完整的工具调用');
  return {
    role: 'assistant',
    content: text || null,
    ...(tools.length
      ? { tool_calls: tools, ...(reasoning ? { reasoning_content: reasoning } : {}) }
      : {}),
  };
}
