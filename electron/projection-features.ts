import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dialog, type BrowserWindow } from 'electron';
import type { Api } from '../shared/types';
import type { Store } from './core/store';
import { checkGamePath } from './core/game-folders';
import { ProjectionWorkshop } from './core/projection-workshop';
import type { ProjectionAssetService } from './core/projection-assets';
export function projectionHandlers(c: {
  workshop: ProjectionWorkshop;
  assets: ProjectionAssetService;
  store: Store;
  window: () => BrowserWindow;
  writable: (id: string) => Promise<void>;
}) {
  return {
    projectionAssets: (value) => c.assets.load(value),
    projectionState: () => c.workshop.state(),
    projectionRecover: () => c.workshop.recover(),
    projectionImport: async (source) => {
      if (!source) {
        const result = await dialog.showOpenDialog(c.window(), {
          title: '打开投影',
          properties: ['openFile'],
          filters: [{ name: 'Minecraft 投影', extensions: ['litematic', 'schem', 'nbt'] }],
        });
        if (result.canceled || !result.filePaths[0]) return null;
        source = result.filePaths[0];
      }
      return c.workshop.importFile(source);
    },
    projectionOpen: (id) => c.workshop.open(id),
    projectionEdit: (value) => c.workshop.edit(value),
    projectionUndo: (value) => c.workshop.undo(value),
    projectionRedo: (value) => c.workshop.redo(value),
    projectionSelect: (value) => c.workshop.select(value),
    projectionRemove: (id) => c.workshop.remove(id),
    projectionExport: async (value) => {
      const ext = value.format === 'materials' ? 'csv' : value.format;
      const result = await dialog.showSaveDialog(c.window(), {
        title: '导出投影',
        defaultPath: 'projection.' + ext,
        filters: [
          {
            name:
              value.format === 'materials'
                ? '材料清单'
                : value.format === 'png'
                  ? 'PNG 截图'
                  : 'Minecraft 投影',
            extensions: [ext],
          },
        ],
      });
      if (result.canceled || !result.filePath) return null;
      await c.workshop.export(value, value.format, result.filePath, value.image);
      return result.filePath;
    },
    projectionInstall: async (value) => {
      await c.writable(value.instanceId);
      const root = path.join(c.store.dir(value.instanceId), 'schematics');
      await checkGamePath(root, true);
      await mkdir(root, { recursive: true });
      await checkGamePath(root);
      await c.writable(value.instanceId);
      const file = path.join(root, 'KJMCL-' + randomUUID().slice(0, 8) + '.' + value.format);
      await c.workshop.export(value, value.format, file);
      return file;
    },
  } satisfies Pick<
    Api,
    | 'projectionAssets'
    | 'projectionState'
    | 'projectionRecover'
    | 'projectionImport'
    | 'projectionOpen'
    | 'projectionEdit'
    | 'projectionUndo'
    | 'projectionRedo'
    | 'projectionSelect'
    | 'projectionExport'
    | 'projectionInstall'
    | 'projectionRemove'
  >;
}
