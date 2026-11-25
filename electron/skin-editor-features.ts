import { showSystemDialog } from './system-dialog';
import { dialog, shell, type BrowserWindow } from 'electron';
import type { Api } from '../shared/types';
import type { Store } from './core/store';
import type { Skins } from './core/skins';
import { SkinEditorStorage, decodeSkinEditorImage, encodeSkinPng } from './core/skin-editor';

export function skinEditorHandlers(c: {
  store: Store;
  skins: Skins;
  window: () => BrowserWindow;
  changed: () => void;
  storage?: SkinEditorStorage;
}) {
  const editor = c.storage ?? new SkinEditorStorage(c.store);
  const choose = async (title: string, extensions: string[]) => {
    const file = await dialog.showOpenDialog(c.window(), {
      title,
      properties: ['openFile'],
      filters: [{ name: title, extensions }],
    });
    return file.canceled ? undefined : file.filePaths[0];
  };
  return {
    skinEditorImportPalette: async () => {
      const file = await choose('导入调色板', ['json']);
      return file ? editor.importPalette(file) : null;
    },
    skinEditorExportPalette: async (palette) => {
      const file = await dialog.showSaveDialog(c.window(), {
        defaultPath: 'skin-palette.json',
        filters: [{ name: '调色板', extensions: ['json'] }],
      });
      if (file.canceled || !file.filePath) return null;
      await editor.exportPalette(palette, file.filePath);
      return file.filePath;
    },
    skinEditorImport: async (mode) => {
      const file = await choose(mode === 'skin' ? '导入皮肤' : '导入图片', ['png']);
      return file ? editor.importImage(file, mode) : null;
    },
    skinEditorImportProject: async () => {
      const file = await choose('打开皮肤工程', ['kjskin', 'json']);
      return file ? editor.importProject(file) : null;
    },
    skinEditorLoadDraft: () => editor.draft(),
    skinEditorRecoverDraft: () => editor.recoverDraft(),
    skinEditorSaveDraft: (project) => editor.saveDraft(project),
    skinEditorList: () => editor.list(),
    skinEditorOpen: (id) => editor.open(id),
    skinEditorVersions: (id) => editor.versions(id),
    skinEditorRestoreVersion: ({ id, versionId }) => editor.restoreVersion(id, versionId),
    skinEditorSave: (value) => editor.save(value),
    skinEditorDelete: async (id) => {
      const answer = await showSystemDialog(c.window(), {
        message: '将此作品移入回收站？',
        buttons: ['取消', '移入回收站'],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response !== 1) return false;
      await editor.remove(id, (file) => shell.trashItem(file));
      return true;
    },
    skinEditorExport: async ({ project, format }) => {
      const extension = format === 'project' ? 'kjskin' : 'png';
      const name =
        project.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\.+$/, '') || 'skin';
      const file = await dialog.showSaveDialog(c.window(), {
        defaultPath: name + '.' + extension,
        filters: [
          { name: format === 'project' ? '皮肤工程' : 'PNG 皮肤', extensions: [extension] },
        ],
      });
      if (file.canceled || !file.filePath) return null;
      await editor.export(project, format, file.filePath);
      return file.filePath;
    },
    skinEditorAccount: async (id) => {
      const skin = await c.skins.preview(id);
      return skin
        ? decodeSkinEditorImage(
            Buffer.from(skin.split(',')[1], 'base64'),
            c.store.data.accounts.find((a) => a.id === id)?.name ?? '账户皮肤',
          )
        : null;
    },
    skinEditorApply: async ({ accountId, project }) => {
      const account = c.store.data.accounts.find((a) => a.id === accountId);
      if (!account) throw new Error('账户不存在');
      if (project.resolution !== 64) throw new Error('应用到账户前，请将分辨率调整为 64×64');
      const bytes = encodeSkinPng(project);
      const answer = await showSystemDialog(c.window(), {
        message:
          account.kind === 'offline'
            ? `将皮肤保存为 ${account.name} 的本地预览？`
            : `将皮肤应用到 ${account.name}？`,
        buttons: ['取消', '应用'],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response !== 1) return false;
      await c.skins.uploadBytes(accountId, bytes, project.model);
      c.changed();
      return true;
    },
    skinEditorCapture: async (image) => {
      const file = await dialog.showSaveDialog(c.window(), {
        defaultPath: 'skin-preview.png',
        filters: [{ name: '预览截图', extensions: ['png'] }],
      });
      if (file.canceled || !file.filePath) return null;
      await editor.exportCapture(image, file.filePath);
      return file.filePath;
    },
  } satisfies Pick<
    Api,
    | 'skinEditorImportPalette'
    | 'skinEditorExportPalette'
    | 'skinEditorImport'
    | 'skinEditorImportProject'
    | 'skinEditorLoadDraft'
    | 'skinEditorRecoverDraft'
    | 'skinEditorSaveDraft'
    | 'skinEditorList'
    | 'skinEditorOpen'
    | 'skinEditorVersions'
    | 'skinEditorRestoreVersion'
    | 'skinEditorSave'
    | 'skinEditorDelete'
    | 'skinEditorExport'
    | 'skinEditorAccount'
    | 'skinEditorApply'
    | 'skinEditorCapture'
  >;
}
