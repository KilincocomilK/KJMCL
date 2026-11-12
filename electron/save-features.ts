import { dialog, shell, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { Api } from '../shared/types';
import type { SaveManager } from './core/save-manager';
import type { Tasks } from './core/tasks';
import { archiveWorld } from './core/archives';
import { safeExport } from './core/safe-export';
export function saveHandlers(c: {
  saves: SaveManager;
  tasks: Tasks;
  writable: (id: string) => Promise<void>;
  window: () => BrowserWindow;
  changed: () => void;
}) {
  const { saves, tasks } = c;
  return {
    saveWorlds: (id) => saves.list(id),
    scanWorld: (v) => saves.scan(v),
    worldRegion: (v) => saves.region(v),
    planWorldPrune: async (v) => {
      await c.writable(v.id);
      return tasks.exclusive(v.id, () => saves.plan(v));
    },
    applyWorldPrune: async (token) => {
      const t = saves.ticket(token);
      await c.writable(t.request.id);
      const answer = await dialog.showMessageBox(c.window(), {
        type: 'warning',
        message: `清理“${t.request.world}”中的 ${t.plan.selected.length} 个区块？`,
        detail: '受影响的地形、实体和 POI 文件会先备份。已清理区块下次进入游戏时会重新生成。',
        buttons: ['取消', '备份并清理'],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response !== 1) return '';
      await c.writable(t.request.id);
      return tasks.start('清理存档区块', t.request.id, async (ctx) => {
        ctx.progress(5, '校验源文件并保存恢复记录');
        await saves.apply(token, ctx.signal);
        ctx.progress(100, '区块已清理');
      });
    },
    editWorld: async (v) => {
      await c.writable(v.id);
      await tasks.exclusive(v.id, () => saves.edit(v, v.patch));
      c.changed();
    },
    undoWorldEdit: async (v) => {
      await c.writable(v.id);
      await tasks.exclusive(v.id, () => saves.undo(v, v.transaction));
      c.changed();
    },
    revealWorld: async (v) => {
      const error = await shell.openPath(await saves.world(v));
      if (error) throw new Error(error);
    },
    exportWorld: async (v) => {
      await c.writable(v.id);
      const source = await saves.world(v);
      const result = await dialog.showSaveDialog(c.window(), {
        defaultPath: v.world + '.zip',
        filters: [{ name: '存档 ZIP', extensions: ['zip'] }],
      });
      if (!result.filePath) return null;
      if (
        path.relative(source, result.filePath) === '' ||
        (!path.relative(source, result.filePath).startsWith('..') &&
          !path.isAbsolute(path.relative(source, result.filePath)))
      )
        throw new Error('导出文件不能放在被导出的存档内部');
      await c.writable(v.id);
      const dest = result.filePath;
      return tasks.start('导出存档', v.id, (ctx) =>
        safeExport(dest, (temporary) => archiveWorld(source, temporary, ctx)),
      );
    },
  } satisfies Pick<
    Api,
    | 'saveWorlds'
    | 'scanWorld'
    | 'worldRegion'
    | 'planWorldPrune'
    | 'applyWorldPrune'
    | 'editWorld'
    | 'undoWorldEdit'
    | 'revealWorld'
    | 'exportWorld'
  >;
}
