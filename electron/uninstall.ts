import { app, dialog } from 'electron';
import path from 'node:path';
import { Storage, type StorageLayout } from './core/storage';
export async function uninstallData(layout: StorageLayout) {
  const storage = new Storage(layout, path.dirname(app.getPath('exe')));
  return storage.reviewUninstall(
    async (roots) =>
      (
        await dialog.showMessageBox({
          type: 'question',
          title: '卸载 KJMCL',
          message: '是否保留游戏与账户数据？',
          detail:
            '当前用户数据目录：\n' +
            roots.join('\n') +
            '\n\n删除会永久清理这些目录中的受管实例、存档、备份、资源和账户凭据。外部自定义游戏目录保留。请先关闭所有游戏。',
          buttons: ['保留数据并卸载', '删除数据并卸载', '取消卸载'],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        })
      ).response,
  );
}
