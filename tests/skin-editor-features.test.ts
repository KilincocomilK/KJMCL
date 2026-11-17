import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PNG } from 'pngjs';
import { dialog, type BrowserWindow } from 'electron';
import type { SkinProject } from '../shared/skin';
import type { Account } from '../shared/types';
import type { Skins } from '../electron/core/skins';
import { Store } from '../electron/core/store';
import { SkinEditorStorage } from '../electron/core/skin-editor';
import { skinEditorHandlers } from '../electron/skin-editor-features';

vi.mock('electron', () => ({
  dialog: { showMessageBox: vi.fn(), showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { trashItem: vi.fn() },
}));
const roots: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function project(): SkinProject {
  const pixels = Buffer.alloc(64 * 64 * 4);
  pixels.set([120, 60, 30, 170], (8 * 64 + 8) * 4);
  return {
    schemaVersion: 1,
    name: '测试皮肤',
    resolution: 64,
    model: 'slim',
    activeLayerId: 'base',
    palette: [],
    layers: [
      {
        id: 'base',
        name: '图层',
        visible: true,
        locked: false,
        opacity: 1,
        blend: 'normal',
        pixels: pixels.toString('base64'),
      },
    ],
  };
}
async function fixture(kind: Account['kind'] = 'microsoft') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-skin-handlers-'));
  roots.push(root);
  const store = new Store(path.join(root, 'data'));
  store.data.accounts.push({ id: 'account', name: '测试账户', uuid: 'fixture-uuid', kind });
  const skins = {
      uploadBytes: vi.fn(async () => {}),
      preview: vi.fn(async (): Promise<string | undefined> => undefined),
    },
    changed = vi.fn(),
    window = {} as BrowserWindow;
  const handlers = skinEditorHandlers({
    store,
    skins: skins as unknown as Skins,
    changed,
    window: () => window,
  });
  return { root, store, skins, changed, window, handlers };
}
describe('account skin application', () => {
  it.each(['offline', 'microsoft', 'yggdrasil'] as const)(
    'requires explicit confirmation before applying to %s',
    async (kind) => {
      const { handlers, skins, changed, window } = await fixture(kind);
      vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({
        response: 0,
        checkboxChecked: false,
      });
      expect(await handlers.skinEditorApply({ accountId: 'account', project: project() })).toBe(
        false,
      );
      expect(skins.uploadBytes).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      expect(dialog.showMessageBox).toHaveBeenCalledWith(
        window,
        expect.objectContaining({
          defaultId: 0,
          cancelId: 0,
          buttons: ['取消', '应用'],
          message:
            kind === 'offline' ? '将皮肤保存为 测试账户 的本地预览？' : '将皮肤应用到 测试账户？',
        }),
      );
    },
  );
  it('uploads the confirmed composite as PNG with selected model and only then reports changed', async () => {
    const { handlers, skins, changed } = await fixture();
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false });
    expect(await handlers.skinEditorApply({ accountId: 'account', project: project() })).toBe(true);
    expect(skins.uploadBytes).toHaveBeenCalledTimes(1);
    const [id, data, model] = vi.mocked(skins.uploadBytes).mock.calls[0] as unknown as [
      string,
      Buffer,
      string,
    ];
    expect([id, model]).toEqual(['account', 'slim']);
    const decoded = PNG.sync.read(data);
    expect([decoded.width, decoded.height]).toEqual([64, 64]);
    expect(Array.from(decoded.data.subarray((8 * 64 + 8) * 4, (8 * 64 + 8) * 4 + 4))).toEqual([
      120, 60, 30, 170,
    ]);
    expect(changed).toHaveBeenCalledOnce();
    expect(skins.uploadBytes.mock.invocationCallOrder[0]).toBeLessThan(
      changed.mock.invocationCallOrder[0],
    );
  });
  it('propagates upload failure without reporting success or changing the saved project', async () => {
    const { handlers, skins, changed } = await fixture(),
      doc = project();
    await handlers.skinEditorSaveDraft(doc);
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false });
    skins.uploadBytes.mockRejectedValueOnce(new Error('fixture upload failed'));
    await expect(handlers.skinEditorApply({ accountId: 'account', project: doc })).rejects.toThrow(
      'fixture upload failed',
    );
    expect(changed).not.toHaveBeenCalled();
    expect(await handlers.skinEditorLoadDraft()).toEqual(doc);
  });
  it('rejects missing accounts, HD and invalid project versions before asking or uploading', async () => {
    const { handlers, skins, changed } = await fixture();
    await expect(
      handlers.skinEditorApply({ accountId: 'missing', project: project() }),
    ).rejects.toThrow('账户不存在');
    await expect(
      handlers.skinEditorApply({
        accountId: 'account',
        project: { ...project(), resolution: 128 },
      }),
    ).rejects.toThrow('64×64');
    await expect(
      handlers.skinEditorApply({
        accountId: 'account',
        project: { ...project(), schemaVersion: 99 } as unknown as SkinProject,
      }),
    ).rejects.toThrow();
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(skins.uploadBytes).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });
});
describe('editor file and recovery handlers', () => {
  it('shares an injected storage queue with the application shutdown flush', async () => {
    const { store, skins, changed, window } = await fixture();
    const storage = new SkinEditorStorage(store),
      saveDraft = vi.spyOn(storage, 'saveDraft');
    const handlers = skinEditorHandlers({
      store,
      skins: skins as unknown as Skins,
      changed,
      window: () => window,
      storage,
    });
    const write = handlers.skinEditorSaveDraft(project());
    await storage.flush();
    await write;
    expect(saveDraft).toHaveBeenCalledWith(project());
    expect(await storage.draft()).toEqual(project());
  });
  it('cancels import, export and delete without side effects', async () => {
    const { handlers, skins, root } = await fixture(),
      doc = project(),
      id = await handlers.skinEditorSave({ project: doc });
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await handlers.skinEditorImport('skin')).toBeNull();
    expect(await handlers.skinEditorImportProject()).toBeNull();
    const target = path.join(root, 'canceled.png');
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: target });
    expect(await handlers.skinEditorExport({ project: doc, format: 'png' })).toBeNull();
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' });
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });
    expect(await handlers.skinEditorDelete(id)).toBe(false);
    expect(await handlers.skinEditorOpen(id)).toEqual(doc);
    expect(skins.uploadBytes).not.toHaveBeenCalled();
  });
  it('returns explicit recovery and version content without overwriting the current work', async () => {
    const { handlers } = await fixture(),
      original = project(),
      next = { ...project(), name: '更新皮肤' };
    await handlers.skinEditorSaveDraft(original);
    await handlers.skinEditorSaveDraft(next);
    expect(await handlers.skinEditorRecoverDraft()).toEqual(original);
    expect(await handlers.skinEditorLoadDraft()).toEqual(next);
    const id = await handlers.skinEditorSave({ project: original });
    await handlers.skinEditorSave({ id, project: next });
    const [version] = await handlers.skinEditorVersions(id);
    expect(await handlers.skinEditorRestoreVersion({ id, versionId: version.versionId })).toEqual(
      original,
    );
    expect(await handlers.skinEditorOpen(id)).toEqual(next);
  });
});

describe('palette dialog handlers', () => {
  it('cancels imports and exports without writing files or touching an account', async () => {
    const { handlers, root, skins, changed } = await fixture(),
      file = path.join(root, 'canceled.json');
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await handlers.skinEditorImportPalette()).toBeNull();
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: file });
    expect(
      await handlers.skinEditorExportPalette({ name: 'colors', colors: ['#f26b2180'] }),
    ).toBeNull();
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(skins.uploadBytes).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });
  it('imports and exports the user-selected palette while preserving exact colors and source', async () => {
    const { handlers, root, window } = await fixture(),
      source = path.join(root, 'source.json'),
      target = path.join(root, 'saved.json');
    const palette = { name: '调色板', colors: ['#ff6600', '#12345678'] },
      original = JSON.stringify({ schemaVersion: 1, ...palette });
    await writeFile(source, original);
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [source] });
    expect(await handlers.skinEditorImportPalette()).toEqual(palette);
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      window,
      expect.objectContaining({ filters: [{ name: '导入调色板', extensions: ['json'] }] }),
    );
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: target });
    expect(await handlers.skinEditorExportPalette(palette)).toBe(target);
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ schemaVersion: 1, ...palette });
    expect(await readFile(source, 'utf8')).toBe(original);
  });
});
