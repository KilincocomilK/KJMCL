import { dialog, type BrowserWindow } from 'electron';
import type { Api } from '../shared/types';
import type { Store } from './core/store';
import type { Tasks } from './core/tasks';
import type { Catalog } from './core/catalog';
import type { ModAudit } from './core/mod-audit';
import type { DiskUsage } from './core/disk-usage';
import type { CrashReports } from './core/crash-reports';
export function libraryHandlers(c: {
  store: Store;
  tasks: Tasks;
  catalog: Catalog;
  audit: ModAudit;
  disk: DiskUsage;
  crashes: CrashReports;
  secrets: () => Promise<string[]>;
  writable: (id: string) => Promise<void>;
  idle: () => void;
  changed: () => void;
  window: () => BrowserWindow;
}) {
  return {
    organizeInstance: async (v) => {
      c.store.instance(v.id).organization = v.organization;
      c.store.save();
      c.changed();
    },
    catalogSearch: (v) => c.catalog.search(v),
    catalogVersions: (v) => c.catalog.versions(v),
    installContent: async (v) => {
      await c.writable(v.id);
      return c.tasks.start(
        v.kind === 'modpack' ? '下载并创建整合包实例' : '安装内容',
        v.id,
        (ctx) => c.catalog.install(v, ctx),
        'download',
      );
    },
    saveFavorite: async (v) => {
      await c.catalog.favorite(v, v.group);
      c.changed();
    },
    removeFavorite: async (v) => {
      c.catalog.removeFavorite(v);
      c.changed();
    },
    exportModList: async (id) => {
      c.store.instance(id);
      const result = await dialog.showSaveDialog(c.window(), {
        defaultPath: 'KJMCL-mods.txt',
        filters: [{ name: '模组清单', extensions: ['txt'] }],
      });
      if (!result.filePath) return null;
      await c.tasks.exclusive(id, async () => {
        const secrets = await c.secrets();
        await c.catalog.exportModList(id, result.filePath!, secrets, await c.audit.scan(id));
      });
      return result.filePath;
    },
    auditMods: (id) => c.audit.scan(id),
    planModBatch: async (v) => {
      await c.writable(v.id);
      return c.tasks.exclusive(v.id, () => c.audit.plan(v.id, v.names, v.enabled));
    },
    applyModBatch: async (token) => {
      const p = c.audit.ticket(token);
      await c.writable(p.id);
      await c.tasks.exclusive(p.id, () => c.audit.apply(token));
      c.changed();
    },
    diskUsage: () => c.disk.scan(),
    planCacheCleanup: async () => {
      c.idle();
      return c.disk.plan();
    },
    applyCacheCleanup: async (token) => {
      c.idle();
      return c.tasks.exclusive('maintenance', () => c.disk.apply(token));
    },
    crashFiles: (id) => c.crashes.list(id),
    readCrash: (v) => c.crashes.read(v.id, v.name),
    exportCrash: async (v) => {
      const result = await dialog.showSaveDialog(c.window(), {
        defaultPath: 'KJMCL-diagnosis.zip',
        filters: [{ name: '诊断 ZIP', extensions: ['zip'] }],
      });
      if (!result.filePath) return null;
      await c.crashes.export(v.id, v.name, result.filePath);
      return result.filePath;
    },
  } satisfies Pick<
    Api,
    | 'organizeInstance'
    | 'catalogSearch'
    | 'catalogVersions'
    | 'installContent'
    | 'saveFavorite'
    | 'removeFavorite'
    | 'exportModList'
    | 'auditMods'
    | 'planModBatch'
    | 'applyModBatch'
    | 'diskUsage'
    | 'planCacheCleanup'
    | 'applyCacheCleanup'
    | 'crashFiles'
    | 'readCrash'
    | 'exportCrash'
  >;
}
