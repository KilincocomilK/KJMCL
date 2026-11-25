import { showSystemDialog } from './system-dialog';
import { dialog, shell, type BrowserWindow } from 'electron';
import path from 'node:path';
import ruleCatalog from '../shared/game-rules.json';
import type { Api } from '../shared/types';
import { worldDimensionName } from '../shared/world-dimensions';
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
    worldTerrainTiles: (v) => saves.terrainTiles(v),
    planWorldSelection: async (v) => {
      await c.writable(v.id);
      return tasks.exclusive(v.id, () => saves.plan(v));
    },
    editGameRules: async (v) => {
      await c.writable(v.id);
      const display = (s: string) => (s === 'true' ? '开启' : s === 'false' ? '关闭' : s);
      const answer = await showSystemDialog(c.window(), {
        message: '保存“' + v.world + '”的游戏规则？',
        detail: v.changes
          .map((change) => {
            const rule = ruleCatalog.find(
              (item) => item.legacy === change.key || item.modern === change.key,
            );
            return (
              (rule?.name ?? change.key) +
              '　' +
              display(change.before) +
              ' → ' +
              display(change.value)
            );
          })
          .join('\n'),
        buttons: ['取消', '保存规则'],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response !== 1) return false;
      await c.writable(v.id);
      await tasks.exclusive(v.id, () => saves.editRules(v, v.changes));
      c.changed();
      return true;
    },
    planWorldPrune: async (v) => {
      await c.writable(v.id);
      return tasks.exclusive(v.id, () => saves.plan(v));
    },
    applyWorldPrune: async (token) => {
      const t = saves.ticket(token);
      if (!t.plan.selected.length) throw new Error('没有可清理的区块');
      await c.writable(t.request.id);
      const answer = await showSystemDialog(c.window(), {
        message: `确认清理“${t.request.world}”${worldDimensionName(t.request.dimension)}的 ${t.plan.selected.length} 个区块？`,
        detail: '所选区块内的建筑和实体将被移除，地形会在下次加载时重新生成。可从编辑历史撤销。',
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
    | 'worldTerrainTiles'
    | 'editGameRules'
    | 'planWorldSelection'
    | 'planWorldPrune'
    | 'applyWorldPrune'
    | 'editWorld'
    | 'undoWorldEdit'
    | 'revealWorld'
    | 'exportWorld'
  >;
}
