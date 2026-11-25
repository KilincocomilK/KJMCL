import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { z } from 'zod';
import {
  chatSchema,
  legacyChatSchema,
  mcpSettings,
  modelSelection,
  modelList,
  providerSchema,
  type AiChange,
  type AiChat,
  type AiChatSummary,
  type AiMessage,
} from '../../../shared/assistant';
import { settingText } from '../../../shared/assistant-display';

const legacyProvider = providerSchema.extend({ credential: z.uuid().optional() });
const storedProvider = legacyProvider.extend({ manualModels: modelList });
const legacyConfig = z.strictObject({
  schemaVersion: z.literal(1),
  providers: z.array(legacyProvider).max(40),
  selection: modelSelection.optional(),
  mcp: mcpSettings,
});
const configSchema = legacyConfig.extend({
  schemaVersion: z.literal(2),
  providers: z.array(storedProvider).max(40),
});
export type StoredProvider = z.infer<typeof storedProvider>;
export type AiConfig = z.infer<typeof configSchema>;
// Presets describe endpoints. Installed models are discovered from the user's service.
const presets = [
  ['深度求索', 'https://api.deepseek.com'],
  ['OpenAI', 'https://api.openai.com/v1'],
  ['Ollama', 'http://127.0.0.1:11434/v1'],
  ['LM Studio', 'http://127.0.0.1:1234/v1'],
  ['OpenRouter', 'https://openrouter.ai/api/v1'],
];
function defaults(): AiConfig {
  return {
    schemaVersion: 2,
    providers: presets.map(([name, baseUrl]) => ({
      id: randomUUID(),
      name,
      baseUrl,
      enabled: true,
      models: [],
      manualModels: [],
    })),
    mcp: { enabled: false, port: 28631, allowChanges: false },
  };
}
function readJson<T>(file: string, schema: z.ZodType<T>, limit: number): T | undefined {
  const info = lstatSync(file, { throwIfNoEntry: false });
  if (!info) return;
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit)
    throw new Error('助手数据文件异常，请检查 ' + path.basename(file));
  try {
    return schema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    throw new Error(
      '无法读取助手数据，请检查文件或使用匹配版本的 KJMCL（' + path.basename(file) + '）',
    );
  }
}
function writeJson(file: string, data: unknown, limit: number) {
  const body = JSON.stringify(data);
  if (Buffer.byteLength(body) > limit) throw new Error('助手数据已达容量上限');
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, body, { flag: 'wx', mode: 0o600 });
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}
const configLimit = 8 * 1024 * 1024,
  chatLimit = 4 * 1024 * 1024;
function backupV1(file: string, value: unknown, limit: number) {
  const backup = file + '.v1.bak';
  if (!lstatSync(backup, { throwIfNoEntry: false })) writeJson(backup, value, limit);
}

export class AssistantStorage {
  private configCache?: AiConfig;
  private summaries?: Map<string, AiChatSummary>;
  historyIssue?: string;
  constructor(private root: string) {}
  private directory(chats = false) {
    let dir = this.root;
    for (const segment of chats ? ['assistant', 'chats'] : ['assistant']) {
      dir = path.join(dir, segment);
      const info = lstatSync(dir, { throwIfNoEntry: false });
      if (info && (!info.isDirectory() || info.isSymbolicLink()))
        throw new Error('助手数据目录异常');
      if (!info) mkdirSync(dir, { mode: 0o700 });
    }
    return dir;
  }
  get config(): AiConfig {
    if (!this.configCache) {
      const file = path.join(this.directory(), 'config.json');
      const loaded = readJson(
        file,
        z.discriminatedUnion('schemaVersion', [legacyConfig, configSchema]),
        configLimit,
      );
      if (loaded?.schemaVersion === 1) {
        backupV1(file, loaded, configLimit);
        this.configure({
          ...loaded,
          schemaVersion: 2,
          providers: loaded.providers.map((p) => ({ ...p, manualModels: p.models })),
        });
      } else if (loaded) this.configCache = loaded;
      else this.configure(defaults());
    }
    return this.configCache!;
  }
  configure(value: AiConfig) {
    const next = configSchema.parse(value);
    writeJson(path.join(this.directory(), 'config.json'), next, configLimit);
    this.configCache = next;
  }
  chat(id: string) {
    const file = path.join(this.directory(true), z.uuid().parse(id) + '.json');
    const chat = readJson(
      file,
      z.discriminatedUnion('schemaVersion', [legacyChatSchema, chatSchema]),
      chatLimit,
    );
    if (chat && chat.id !== id) throw new Error('对话标识与文件不匹配');
    if (chat?.schemaVersion === 1) {
      const next = chatSchema.parse({ ...chat, schemaVersion: 2 });
      backupV1(file, chat, chatLimit);
      writeJson(file, next, chatLimit);
      return next;
    }
    return chat;
  }
  private index() {
    if (!this.summaries) {
      const all = new Map<string, AiChatSummary>();
      const unreadable: string[] = [];
      for (const file of readdirSync(this.directory(true)).filter((name) =>
        name.endsWith('.json'),
      )) {
        try {
          const chat = this.chat(file.slice(0, -5));
          if (chat) all.set(chat.id, this.summary(chat));
        } catch {
          unreadable.push(file);
        }
      }
      if (unreadable.length)
        this.historyIssue =
          '有 ' +
          unreadable.length +
          ' 个对话文件无法读取，原文件已保留。请检查 assistant/chats/' +
          unreadable[0];
      this.summaries = all;
    }
    return this.summaries;
  }
  private summary({ messages, schemaVersion, ...summary }: AiChat): AiChatSummary {
    return summary;
  }
  list() {
    return [...this.index().values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  saveChat(chat: AiChat) {
    const all = this.index();
    if (!all.has(chat.id) && all.size >= 50) throw new Error('对话已达 50 个，请先移除旧对话');
    const next = chatSchema.parse({
      ...chat,
      updatedAt: Math.max(Date.now(), (all.get(chat.id)?.updatedAt ?? 0) + 1),
    });
    writeJson(path.join(this.directory(true), next.id + '.json'), next, chatLimit);
    all.set(next.id, this.summary(next));
  }
  append(id: string, role: AiMessage['role'], text: string) {
    const chat = this.chat(id);
    if (!chat) throw new Error('对话不存在');
    chat.messages.push({ role, text, at: Date.now() });
    this.saveChat(chat);
  }
  receipt(plan: AiChange) {
    if (!plan.chatId) return;
    const chat = this.chat(plan.chatId);
    if (!chat) return;
    const index = chat.messages.findIndex((m) => m.change?.id === plan.id);
    const message: AiMessage = {
      role: 'activity',
      at: chat.messages[index]?.at ?? Date.now(),
      text:
        plan.target +
        '\n' +
        plan.fields
          .map((f) => f.label + '  ' + settingText(f.before) + ' → ' + settingText(f.after))
          .join('\n'),
      change: { id: plan.id, status: plan.status },
    };
    if (index < 0) chat.messages.push(message);
    else chat.messages[index] = message;
    this.saveChat(chat);
  }
  removeChat(id: string) {
    const all = this.index();
    const file = path.join(this.directory(true), z.uuid().parse(id) + '.json');
    rmSync(file + '.v1.bak', { force: true });
    rmSync(file, { force: true });
    all.delete(id);
  }
}
