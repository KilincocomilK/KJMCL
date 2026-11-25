import { it, expect, afterEach } from 'vitest';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  rename,
  symlink,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { Store } from '../electron/core/store';
import { GameFolders, resolveExternalVersion } from '../electron/core/game-folders';
import { assertOwned, Instances, claimDirectory } from '../electron/core/instances';
import { Minecraft } from '../electron/core/minecraft';
import { Network } from '../electron/core/network';
import { atomicJson, exists } from '../electron/core/files';
import { DiskUsage } from '../electron/core/disk-usage';
import { schemas } from '../shared/schema';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-folder-test-'));
  roots.push(temp);
  const root = await realpath(temp),
    store = new Store(path.join(root, 'data')),
    source = path.join(root, '游戏 文件夹');
  await mkdir(path.join(source, 'versions'), { recursive: true });
  const folders = new GameFolders(store);
  const version = async (id: string, extra: Record<string, unknown> = {}) => {
    await atomicJson(path.join(source, 'versions', id, id + '.json'), {
      id: '1.21.1',
      type: 'release',
      mainClass: 'Main',
      libraries: [],
      arguments: { game: ['fixture'] },
      ...extra,
    });
    await writeFile(path.join(source, 'versions', id, id + '.jar'), 'fixture client');
  };
  const add = async () => {
    const scan = await folders.scan(source);
    return folders.add({ selectionId: scan.selectionId, name: '原游戏', layouts: [] });
  };
  return { root, store, source, folders, version, add };
}
async function digestTree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(relative: string) {
    for (const e of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = path.join(relative, e.name);
      if (e.isDirectory()) {
        out[name + '/'] = 'directory';
        await walk(name);
      } else
        out[name] = createHash('sha256')
          .update(await readFile(path.join(root, name)))
          .digest('hex');
    }
  }
  await walk('');
  return out;
}
it('indexes shared and isolated versions without any source writes, copying, or ownership markers', async () => {
  const { store, source, folders, version, add } = await fixture();
  await version('共享');
  await version('隔离');
  await version('配置优先');
  await version('新版 HMCL');
  await version('未启用的 HMCL 覆盖');
  await mkdir(path.join(source, 'versions/隔离/saves'), { recursive: true });
  await mkdir(path.join(source, 'versions/配置优先/mods'), { recursive: true });
  await atomicJson(path.join(source, 'versions/配置优先/hmclversion.cfg'), { gameDirType: 0 });
  await atomicJson(
    path.join(source, 'versions/新版 HMCL/.hmcl/config/instance-game-settings.json'),
    { overrideProperties: ['runningDirectory'], runningDirectory: '' },
  );
  await atomicJson(
    path.join(source, 'versions/未启用的 HMCL 覆盖/.hmcl/config/instance-game-settings.json'),
    { overrideProperties: [], runningDirectory: path.join(source, 'missing-unused-directory') },
  );
  const before = await digestTree(source),
    folderId = await add();
  expect(store.data.gameFolders).toHaveLength(1);
  expect(store.data.instances).toHaveLength(5);
  for (const name of ['共享', '配置优先', '未启用的 HMCL 覆盖'])
    expect(store.data.instances.find((i) => i.external?.versionId === name)?.gameDir).toBe(source);
  for (const name of ['隔离', '新版 HMCL'])
    expect(store.data.instances.find((i) => i.external?.versionId === name)?.gameDir).toBe(
      path.join(source, 'versions', name),
    );
  expect(await readdir(store.root)).toEqual(['state.json']);
  expect(await digestTree(source)).toEqual(before);
  const i = store.data.instances[0];
  i.organization = { favorite: true, group: '家', tags: ['保留'], notes: '备注' };
  i.playTime = 42;
  store.save();
  const oldIds = store.data.instances.map((i) => i.id);
  await folders.refresh(folderId);
  await add();
  expect(store.data.gameFolders).toHaveLength(1);
  expect(store.data.instances.map((i) => i.id)).toEqual(oldIds);
  expect(store.instance(i.id).organization?.notes).toBe('备注');
  expect(store.instance(i.id).playTime).toBe(42);
  const reopened = new Store(store.root);
  expect(reopened.dir(i.id)).toBe(i.gameDir);
  expect(
    (await new DiskUsage(store).scan()).rows.filter((r) => r.key.startsWith('folder:')),
  ).toHaveLength(1);
  expect((await new DiskUsage(store).scan()).rows.some((r) => r.key.startsWith('instance:'))).toBe(
    false,
  );
  folders.remove(folderId);
  expect(store.data.instances).toHaveLength(0);
  expect(await digestTree(source)).toEqual(before);
});
it('retains settings for missing disks/versions, restores stable IDs and discovers new versions on refresh', async () => {
  const { store, source, folders, version, add } = await fixture();
  await version('v1');
  const id = await add(),
    i = store.data.instances[0];
  i.memoryMb = 8192;
  store.save();
  await rename(source, source + '-offline');
  await folders.refresh(id);
  expect(store.instance(i.id).status).toBe('error');
  expect(store.folder(id).error).toBeTruthy();
  await rename(source + '-offline', source);
  await folders.refresh(id);
  expect(store.instance(i.id).status).toBe('ready');
  expect(store.instance(i.id).memoryMb).toBe(8192);
  await rename(path.join(source, 'versions/v1/v1.json'), path.join(source, 'versions/v1/v1.bak'));
  await folders.refresh(id);
  expect(store.instance(i.id).error).toContain('原版本');
  await rename(path.join(source, 'versions/v1/v1.bak'), path.join(source, 'versions/v1/v1.json'));
  await version('v2');
  await folders.refresh(id);
  expect(store.data.instances).toHaveLength(2);
  expect(store.instance(i.id).status).toBe('ready');
});
it('preserves accepted run locations until explicitly reconfirmed and never moves worlds', async () => {
  const { store, source, folders, version, add } = await fixture();
  await version('v1');
  const folder = await add(),
    i = store.data.instances[0];
  const cfg = path.join(source, 'versions/v1/hmclversion.cfg');
  await atomicJson(cfg, { gameDirType: 1 });
  await folders.refresh(folder);
  expect(i.gameDir).toBe(source);
  expect(i.error).toContain('运行目录已变化');
  await expect(assertOwned(store, i.id)).rejects.toThrow('运行目录已变化');
  await folders.setLayout(i.id, 'auto');
  expect(i.gameDir).toBe(path.join(source, 'versions/v1'));
  expect(i.status).toBe('ready');
  await folders.setLayout(i.id, 'shared');
  expect(i.gameDir).toBe(source);
  const service = new Instances(store),
    ctx = { signal: new AbortController().signal, progress: () => {} };
  await expect(service.relocate(i.id, path.join(store.root, 'moved'), ctx)).rejects.toThrow(
    '不能搬移',
  );
  await expect(service.clone(i.id, 'unused', true, ctx)).rejects.toThrow('不复制');
  await expect(
    new Minecraft(store, new Network(() => store.data.settings)).install(i.id, ctx),
  ).rejects.toThrow('原启动器');
  expect(() => claimDirectory(store, path.join(source, 'new'), 'new')).toThrow('索引');
  expect(await exists(path.join(source, '.kjmcl-owner.json'))).toBe(false);
});
it('blocks access when an external run directory cannot be resolved and refuses damaged persisted indexes', async () => {
  const { store, source, folders, version, add } = await fixture();
  await version('v1');
  await atomicJson(path.join(source, 'versions/v1/hmclversion.cfg'), {
    gameDirType: 2,
    gameDir: path.join(source, 'missing'),
  });
  await add();
  const i = store.data.instances[0];
  expect(i.status).toBe('error');
  await expect(assertOwned(store, i.id)).rejects.toThrow();
  await folders.setLayout(i.id, 'shared');
  await expect(assertOwned(store, i.id)).resolves.toBeUndefined();
  const file = path.join(store.root, 'state.json');
  const persisted = JSON.parse(await readFile(file, 'utf8'));
  delete persisted.instances[0].gameDir;
  await atomicJson(file, persisted);
  await expect(async () => new Store(store.root)).rejects.toThrow('索引缺少');
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(persisted);
});
it('blocks traversal, loops and path substitution, without falling back to another world', async () => {
  const { root, store, source, folders, version, add } = await fixture();
  await version('v1');
  const id = await add(),
    i = store.data.instances[0];
  const ticket = await folders.scan(source);
  await expect(resolveExternalVersion(source, '../escape')).rejects.toThrow('路径');
  await atomicJson(path.join(source, 'versions/v1/v1.json'), {
    id: 'v1',
    inheritsFrom: 'v1',
    libraries: [],
  });
  await expect(resolveExternalVersion(source, 'v1')).rejects.toThrow('循环');
  await rename(source, source + '-original');
  await symlink(source + '-original', source, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(assertOwned(store, i.id)).rejects.toThrow('链接');
  await folders.refresh(id);
  expect(i.status).toBe('error');
  expect(store.folder(id).error).toContain('链接');
  await expect(
    folders.add({ selectionId: ticket.selectionId, name: '替换目录', layouts: [] }),
  ).rejects.toThrow('链接');
  expect(store.data.gameFolders).toHaveLength(1);
  // A folder registered by realpath must never be silently redirected by a substituted alias.
  folders.remove(id);
  expect(await exists(path.join(source + '-original', 'versions/v1/v1.jar'))).toBe(true);
  await expect(folders.scan(store.root)).rejects.toThrow('数据目录');
  expect(
    schemas.importMinecraft.safeParse({
      selectionId: 'token',
      name: 'x',
      layouts: [{ versionId: '../escape', layout: 'auto' }],
    }).success,
  ).toBe(false);
});
it('keeps malformed external metadata from poisoning persisted launcher state', async () => {
  const { store, source, folders, version, add } = await fixture();
  await version('good');
  const id = await add();
  await version('bad-id', { id: '' });
  await version('bad-long-id', { id: 'v'.repeat(300) });
  await version('bad-loader', {
    libraries: [{ name: 'net.fabricmc:fabric-loader:' + 'x'.repeat(161) }],
  });
  await mkdir(path.join(source, 'versions', 'v'.repeat(241)), { recursive: true });
  await folders.refresh(id);
  for (const name of ['bad-id', 'bad-long-id', 'bad-loader'])
    expect(store.data.instances.find((i) => i.external?.versionId === name)?.status).toBe('error');
  const reopened = new Store(store.root);
  expect(reopened.data.instances).toHaveLength(4);
  expect(reopened.data.instances.find((i) => i.external?.versionId === 'good')?.status).toBe(
    'ready',
  );
});
it('migrates v4 without dropping favorites, copied games, settings or the original state backup', async () => {
  const { store } = await fixture();
  store.data.favorites = [
    {
      source: 'modrinth',
      kind: 'mod',
      projectId: 'kept',
      title: '收藏',
      description: '',
      author: 'a',
      downloads: 1,
      url: 'https://modrinth.com/mod/kept',
      group: 'g',
      savedAt: 1,
    },
  ];
  const old = { ...store.data, schemaVersion: 4 };
  delete (old as any).gameFolders;
  await atomicJson(path.join(store.root, 'state.json'), old);
  const reopened = new Store(store.root);
  expect(reopened.data.schemaVersion).toBe(9);
  expect(reopened.data.gameFolders).toEqual([]);
  expect(reopened.data.favorites[0].projectId).toBe('kept');
  expect(JSON.parse(await readFile(path.join(store.root, 'state.json.v4.bak'), 'utf8'))).toEqual(
    old,
  );
});
