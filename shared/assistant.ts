import { z } from 'zod';

export const modelId = z
  .string()
  .trim()
  .min(1)
  .max(192)
  .regex(/^[^\s\x00-\x1f\x7f]+$/);
export const modelList = z
  .array(modelId)
  .max(4096)
  .refine((v) => new Set(v).size === v.length);
export const apiBase = z
  .url()
  .max(2048)
  .refine((value) => {
    const u = new URL(value);
    return (
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))
    );
  }, '在线 API 需要 HTTPS，本机服务可使用 HTTP');
const providerFields = {
  id: z.uuid(),
  name: z.string().trim().min(1).max(60),
  baseUrl: apiBase,
  enabled: z.boolean(),
  models: modelList,
};
export const providerSchema = z.strictObject(providerFields);
export type AiProvider = z.infer<typeof providerSchema> & { hasKey: boolean };
export const modelSelection = z.strictObject({ providerId: z.uuid(), model: modelId });
export const chatBinding = z.strictObject({
  ...modelSelection.shape,
  mode: z.enum(['assist', 'chat']),
  instanceId: z.string().min(1).max(160).optional(),
});
export const mcpSettings = z.strictObject({
  enabled: z.boolean(),
  port: z.int().min(1024).max(65535),
  allowChanges: z.boolean(),
});
export const assistantSchemas = {
  aiState: z.undefined(),
  aiHistory: z.uuid(),
  aiSaveProvider: z.strictObject({
    ...providerFields,
    key: z
      .string()
      .trim()
      .max(4096)
      .regex(/^[\x21-\x7e]*$/)
      .optional(),
  }),
  aiRemoveProvider: z.uuid(),
  aiTestProvider: z.uuid(),
  aiSyncModels: z.uuid(),
  aiSelectModel: modelSelection,
  aiSend: z.strictObject({
    ...chatBinding.shape,
    chatId: z.uuid(),
    text: z.string().trim().min(1).max(8000),
    retry: z.boolean().optional(),
  }),
  aiCancel: z.uuid(),
  aiDeleteChat: z.uuid(),
  aiDecide: z.strictObject({ id: z.uuid(), decision: z.enum(['apply', 'reject', 'undo']) }),
  aiSetMcp: mcpSettings,
  aiCopyMcp: z.enum(['config', 'token']),
  aiRotateMcp: z.undefined(),
};
export type AiProviderInput = z.infer<typeof assistantSchemas.aiSaveProvider>;
export type AiSend = z.infer<typeof assistantSchemas.aiSend>;
export type AiDecision = z.infer<typeof assistantSchemas.aiDecide>;
export type AiMcpSettings = z.infer<typeof mcpSettings>;
export type ModelSelection = z.infer<typeof modelSelection>;

const legacyMessage = z.strictObject({
  role: z.enum(['user', 'assistant', 'activity', 'error']),
  text: z.string().max(40000),
  at: z.number(),
});
const changeStatus = z.enum(['pending', 'applied', 'rejected', 'expired', 'undone', 'stale']);
const messageSchema = legacyMessage.extend({
  change: z.strictObject({ id: z.uuid(), status: changeStatus }).optional(),
});
export type AiMessage = z.infer<typeof messageSchema>;
export const legacyChatSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  title: z.string().max(80),
  updatedAt: z.number(),
  ...chatBinding.shape,
  baseUrl: apiBase,
  messages: z.array(legacyMessage).max(200),
});
export const chatSchema = legacyChatSchema.extend({
  schemaVersion: z.literal(2),
  messages: z.array(messageSchema).max(200),
});
export type AiChat = z.infer<typeof chatSchema>;
export type AiChatSummary = Omit<AiChat, 'messages' | 'schemaVersion'>;
export type SettingValue = string | number | boolean;
export interface AiChange {
  id: string;
  source: 'assistant' | 'mcp';
  chatId?: string;
  target: string;
  instanceId?: string;
  fields: { key: string; label: string; before: SettingValue; after: SettingValue }[];
  status: z.infer<typeof changeStatus>;
  expiresAt: number;
}
export interface AiProgress {
  chatId: string;
  text: string;
  activity: string;
}
export interface AiState {
  providers: AiProvider[];
  selection?: ModelSelection;
  chats: AiChatSummary[];
  historyIssue?: string;
  changes: AiChange[];
  run?: AiProgress;
  mcp: AiMcpSettings & { listening: boolean; error?: string; url: string };
}
export interface AssistantApi {
  aiState(): Promise<AiState>;
  aiHistory(id: string): Promise<AiMessage[]>;
  aiSaveProvider(input: AiProviderInput): Promise<void>;
  aiRemoveProvider(id: string): Promise<void>;
  aiTestProvider(id: string): Promise<number>;
  aiSyncModels(id: string): Promise<number>;
  aiSelectModel(input: ModelSelection): Promise<void>;
  aiSend(input: AiSend): Promise<void>;
  aiCancel(chatId: string): Promise<void>;
  aiDeleteChat(chatId: string): Promise<void>;
  aiDecide(input: AiDecision): Promise<void>;
  aiSetMcp(input: AiMcpSettings): Promise<void>;
  aiCopyMcp(kind: 'config' | 'token'): Promise<void>;
  aiRotateMcp(): Promise<void>;
}
