import type { AiChat, AiMessage, AiProgress, AiSend } from '../../../shared/assistant';
import { chatMessages, functionTools } from './prompts';
import { completion } from './completion';
import { Providers } from './provider';
import { AssistantStorage } from './storage';
import { AssistantTools, type ToolContext } from './tools';
import { redact } from '../log-redaction';

export class AssistantChat {
  private active?: { progress: AiProgress; control: AbortController; providerId: string };
  constructor(
    private storage: AssistantStorage,
    private providers: Providers,
    private tools: AssistantTools,
    private checkInstance: (id: string) => void,
    private changed: () => void,
    private progress: (run: AiProgress) => void,
  ) {}
  get run() {
    return this.active?.progress;
  }
  private reconcile(messages: AiMessage[]) {
    const records = new Map(this.tools.changes().map((p) => [p.id, p.status]));
    return messages.map((m) => {
      if (!m.change) return m;
      const status =
        records.get(m.change.id) ?? (m.change.status === 'pending' ? 'expired' : m.change.status);
      return { ...m, change: { ...m.change, status } };
    });
  }
  history(id: string) {
    return this.reconcile(this.storage.chat(id)?.messages ?? []);
  }
  guardProvider(id: string) {
    if (this.active?.providerId === id) throw new Error('请先停止当前回复');
  }
  cancel(id?: string) {
    if (this.active && (!id || id === this.active.progress.chatId)) this.active.control.abort();
  }
  remove(id: string) {
    if (this.run?.chatId === id) throw new Error('请先停止当前回复');
    this.storage.removeChat(id);
    this.tools.revoke((p) => p.chatId === id);
  }
  async send(input: AiSend) {
    if (this.active) throw new Error('已有回复正在生成');
    const p = this.providers.get(input.providerId);
    if (!p.enabled || !p.models.includes(input.model))
      throw new Error('请在模型服务中启用并选择模型');
    if (input.instanceId) this.checkInstance(input.instanceId);
    const text = redact(input.text.trim());
    const stored = this.storage.chat(input.chatId);
    if (
      stored &&
      (stored.baseUrl !== p.baseUrl ||
        stored.providerId !== p.id ||
        stored.model !== input.model ||
        stored.instanceId !== input.instanceId ||
        stored.mode !== input.mode)
    )
      throw new Error('对话绑定的服务或范围已变化，请新建对话');
    const chat: AiChat = stored ?? {
      schemaVersion: 2,
      id: input.chatId,
      providerId: p.id,
      model: input.model,
      baseUrl: p.baseUrl,
      mode: input.mode,
      instanceId: input.instanceId,
      title: text.slice(0, 40),
      updatedAt: Date.now(),
      messages: [],
    };
    if (chat.messages.length > 178) throw new Error('对话已达长度上限，请新建对话');
    if (input.retry) {
      const last = chat.messages.at(-1);
      if (last?.role === 'error') chat.messages.pop();
      if (chat.messages.at(-1)?.role !== 'user' || chat.messages.at(-1)?.text !== text)
        throw new Error('只能重试上一条未完成的消息');
    } else chat.messages.push({ role: 'user', text, at: Date.now() });
    this.storage.saveChat(chat);
    const control = new AbortController(),
      signal = AbortSignal.any([control.signal, AbortSignal.timeout(240000)]);
    const run = { chatId: chat.id, text: '', activity: '正在连接模型' };
    this.active = { progress: run, control, providerId: p.id };
    this.changed();
    const ctx: ToolContext = {
      source: 'assistant',
      allowChanges: chat.mode === 'assist',
      chatId: chat.id,
      instanceId: chat.instanceId,
      signal,
    };
    const created = new Set<string>();
    try {
      const messages = chatMessages({ ...chat, messages: this.reconcile(chat.messages) });
      const definitions = chat.mode === 'assist' ? functionTools(this.tools, ctx) : undefined;
      let toolCount = 0;
      for (let round = 0; round < 6; round++) {
        signal.throwIfAborted();
        Object.assign(run, { text: '', activity: '正在生成回复' });
        this.progress(run);
        const response = await this.providers.request(
          p,
          'chat/completions',
          {
            model: chat.model,
            messages,
            stream: true,
            ...(definitions ? { tools: definitions } : {}),
          },
          signal,
        );
        let updated = 0;
        const answer = await completion(response, (value) => {
          run.text = value;
          if (performance.now() - updated >= 60) {
            this.progress(run);
            updated = performance.now();
          }
        });
        signal.throwIfAborted();
        if (!answer.tool_calls) {
          this.storage.append(chat.id, 'assistant', redact(answer.content ?? ''));
          return;
        }
        toolCount += answer.tool_calls.length;
        if (!definitions || toolCount > 12) throw new Error('模型超出本次对话的工具权限或调用次数');
        messages.push(answer);
        for (const call of answer.tool_calls) {
          signal.throwIfAborted();
          const name = call.function.name;
          run.activity = this.tools.registry.find((t) => t.name === name)?.title ?? '检查工具调用';
          this.progress(run);
          let result: unknown;
          try {
            let args: unknown;
            try {
              args = JSON.parse(call.function.arguments);
            } catch {
              throw new Error('工具参数不是有效 JSON');
            }
            result = await this.tools.call(name, args, ctx);
            if (
              this.tools.registry.find((t) => t.name === name)?.proposes &&
              result &&
              typeof result === 'object' &&
              'status' in result &&
              result.status === 'pending' &&
              'id' in result &&
              typeof result.id === 'string'
            )
              created.add(result.id);
          } catch (error) {
            signal.throwIfAborted();
            result = { error: error instanceof Error ? error.message : '工具调用失败' };
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
        signal.throwIfAborted();
        if (created.size) {
          for (const plan of this.tools.changes())
            if (created.has(plan.id)) this.storage.receipt(plan);
          return;
        }
      }
      throw new Error('已达到本轮工具调用上限，请缩小问题范围');
    } catch (error) {
      this.tools.revoke((plan) => created.has(plan.id));
      const detail = control.signal.aborted
        ? '已停止回复'
        : signal.aborted
          ? '模型回复超时'
          : error instanceof Error && !('code' in error)
            ? redact(error.message)
            : '连接中断，请重试';
      this.storage.append(chat.id, 'error', detail);
    } finally {
      this.active = undefined;
      this.changed();
    }
  }
}
