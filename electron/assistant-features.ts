import { clipboard } from 'electron';
import type { AssistantApi } from '../shared/assistant';
import type { LauncherEvent, LaunchSession } from '../shared/types';
import type { Network } from './core/network';
import type { Store } from './core/store';
import type { Secrets } from './core/vault';
import type { VideoSettings } from './core/video-settings';
import type { Resources } from './core/resources';
import { AssistantStorage } from './core/assistant/storage';
import { AssistantChat } from './core/assistant/chat';
import { Providers } from './core/assistant/provider';
import { AssistantTools } from './core/assistant/tools';
import { LocalMcp } from './core/assistant/mcp';

export function assistantFeatures(deps: {
  store: Store;
  vault: Secrets;
  net: Network;
  video: VideoSettings;
  resources: Resources;
  sessions: (id: string) => Promise<LaunchSession[]>;
  withInstance: (id: string, work: () => Promise<void>) => Promise<void>;
  available: () => boolean;
  changed: () => void;
  emit: (event: LauncherEvent) => void;
}) {
  const storage = new AssistantStorage(deps.store.root);
  const refresh = () => deps.emit({ type: 'assistant' });
  const providers = new Providers(storage, deps.vault, deps.net);
  const tools = new AssistantTools(
    deps.store,
    deps.video,
    deps.sessions,
    deps.withInstance,
    () => {
      refresh();
      deps.changed();
    },
    deps.resources,
  );
  const chat = new AssistantChat(
    storage,
    providers,
    tools,
    (id) => deps.store.instance(id),
    refresh,
    (progress) => deps.emit({ type: 'assistant-progress', progress }),
  );
  const mcp = new LocalMcp(storage, deps.vault, tools, deps.available, refresh);
  const handlers: AssistantApi = {
    aiState: async () => ({
      providers: providers.list(),
      selection: storage.config.selection,
      chats: storage.list(),
      historyIssue: storage.historyIssue,
      changes: tools.changes(),
      mcp: mcp.state(),
      run: chat.run,
    }),
    aiHistory: async (id) => chat.history(id),
    aiSaveProvider: async (value) => {
      chat.guardProvider(value.id);
      await providers.save(value);
      refresh();
    },
    aiRemoveProvider: async (id) => {
      chat.guardProvider(id);
      await providers.remove(id);
      refresh();
    },
    aiTestProvider: (id) => providers.models(id, false),
    aiSyncModels: async (id) => {
      const count = await providers.models(id, true);
      refresh();
      return count;
    },
    aiSelectModel: async (value) => {
      providers.select(value);
      refresh();
    },
    aiSend: (value) => chat.send(value),
    aiCancel: async (id) => chat.cancel(id),
    aiDeleteChat: async (id) => chat.remove(id),
    aiDecide: async (value) => {
      const plan = await tools.decide(value);
      storage.receipt(plan);
      refresh();
    },
    aiSetMcp: (value) => mcp.set(value),
    aiRotateMcp: () => mcp.rotate(),
    aiCopyMcp: async (kind) => mcp.copy(kind, (value) => clipboard.writeText(value)),
  };
  return {
    handlers,
    tools,
    mcp,
    cancelRequests: () => {
      chat.cancel();
      providers.stopRequests();
    },
  };
}
