import { app } from 'electron';
import { showSystemDialog } from './system-dialog';
import path from 'node:path';
import { Storage, type StorageLayout } from './core/storage';
export async function uninstallData(layout: StorageLayout) {
  const storage = new Storage(layout, path.dirname(app.getPath('exe')));
  return storage.reviewUninstall(
    async (roots) =>
      (
        await showSystemDialog(undefined, {
          title: '卸载 KJMCL',
          message: '卸载时保留游戏数据？',
          detail: '删除会永久清除以下目录中的受管实例、存档、备份和账户。外部游戏目录会保留。',
          paths: roots,
          buttons: ['保留数据并卸载', '删除数据并卸载', '取消卸载'],
          defaultId: 0,
          cancelId: 2,
        })
      ).response,
  );
}
