import { VERSION } from '../shared/version';
import type { Api, Snapshot } from '../shared/types';
const empty: Snapshot = {
  gameFolders: [],
  accounts: [],
  instances: [],
  tasks: [],
  running: [],
  settings: {
    memoryMb: 4096,
    javaPath: '',
    proxy: '',
    source: 'bmclapi',
    concurrency: 6,
    microsoftClientId: '',
    closeOnLaunch: false,
    showSnapshots: false,
  },
  dataPath: '桌面应用中可用',
  platform: 'preview',
  appVersion: VERSION,
};
export const api: Api =
  window.kjmcl ??
  (new Proxy(
    { snapshot: async () => empty, onEvent: () => () => {} },
    {
      get: (target, key) =>
        key in target
          ? target[key as keyof typeof target]
          : async () => {
              throw new Error('请在 KJMCL 桌面应用中使用此功能');
            },
    },
  ) as unknown as Api);
