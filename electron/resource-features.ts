import { dialog, shell, type BrowserWindow } from 'electron';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import type { Api, ResourceImportResult } from '../shared/types';
import type { Resources } from './core/resources';
import type { Terracotta } from './core/terracotta';
import type { Tasks } from './core/tasks';

export function resourceHandlers(c: {
  window: () => BrowserWindow;
  resources: Resources;
  terracotta: Terracotta;
  tasks: Tasks;
  writable: (id: string) => Promise<void>;
  changed: () => void;
}) {
  const { resources: r, terracotta: t, tasks } = c;
  return {
    inspectResources: (paths) => r.inspect(paths),
    pickResources: async () => {
      const result = await dialog.showOpenDialog(c.window(), {
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Minecraft 资源',
            extensions: ['jar', 'zip', 'mcpr', 'litematic', 'schematic', 'schem', 'nbt'],
          },
        ],
      });
      return result.canceled ? [] : r.inspect(result.filePaths);
    },
    importResources: async (choices) => {
      const result: ResourceImportResult[] = [];
      for (const choice of choices) {
        try {
          await c.writable(choice.id);
          result.push(await tasks.exclusive(choice.id, () => r.importOne(choice)));
        } catch (e) {
          result.push({
            name: choice.token,
            status: 'failed',
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      }
      c.changed();
      return result;
    },
    resources: (id) => r.list(id),
    previewResource: (v) => r.preview(v.id, v.kind, v.name),
    renameResource: async (v) => {
      await c.writable(v.id);
      await tasks.exclusive(v.id, () => r.rename(v.id, v.kind, v.name, v.newName));
      c.changed();
    },
    deleteResource: async (v) => {
      await c.writable(v.id);
      const result = await dialog.showMessageBox(c.window(), {
        type: 'warning',
        message: `将“${v.name}”移入回收站？`,
        buttons: ['取消', '移入回收站'],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response !== 1) return;
      await c.writable(v.id);
      await tasks.exclusive(v.id, async () => shell.trashItem(await r.file(v.id, v.kind, v.name)));
      c.changed();
    },
    revealResource: async (v) => shell.showItemInFolder(await r.file(v.id, v.kind, v.name)),
    exportResource: async (v) => {
      const file = await r.file(v.id, v.kind, v.name);
      const result = await dialog.showSaveDialog(c.window(), {
        defaultPath: path.basename(v.name),
      });
      if (result.filePath && path.resolve(result.filePath) !== path.resolve(file))
        await copyFile(file, result.filePath);
    },
    terracottaStatus: () => t.status(),
    installTerracotta: async () =>
      tasks.start('安装陶瓦联机', 'terracotta', (ctx) => t.install(ctx)),
    startTerracotta: () => tasks.exclusive('terracotta', () => t.start()),
    controlTerracotta: (v) => tasks.exclusive('terracotta', () => t.control(v)),
  } satisfies Pick<
    Api,
    | 'inspectResources'
    | 'pickResources'
    | 'importResources'
    | 'resources'
    | 'previewResource'
    | 'renameResource'
    | 'deleteResource'
    | 'revealResource'
    | 'exportResource'
    | 'terracottaStatus'
    | 'installTerracotta'
    | 'startTerracotta'
    | 'controlTerracotta'
  >;
}
