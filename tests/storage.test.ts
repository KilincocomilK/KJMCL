import { it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { realpathSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, symlink } from 'node:fs/promises';
import {
  resolveStorage,
  prepareStorage,
  Storage,
  removeManagedData,
  canonicalDestination,
} from '../electron/core/storage';
import { Store } from '../electron/core/store';
import { claimDirectory } from '../electron/core/instances';
import { GameFolders } from '../electron/core/game-folders';
import { exists, atomicJson } from '../electron/core/files';
import type { Instance } from '../shared/types';
const roots: string[] = [];
const ctx = () => ({ signal: new AbortController().signal, progress: vi.fn() });
async function temp() {
  const root = realpathSync.native(await mkdtemp(path.join(os.tmpdir(), 'kjmcl-storage-')));
  roots.push(root);
  return root;
}
async function fixture() {
  const base = await temp(),
    profile = path.join(base, 'profile'),
    layout = resolveStorage(profile, profile);
  prepareStorage(layout);
  const store = new Store(layout.root),
    storage = new Storage(layout, path.join(base, 'program'));
  const add = (id: string, directory: string) => {
    const i: Instance = {
      id,
      gameDir: claimDirectory(store, directory, id),
      name: id,
      version: '1.21.11',
      loader: 'vanilla',
      status: 'empty',
      createdAt: 0,
      playTime: 0,
      memoryMb: 4096,
      javaPath: '',
      jvmArgs: [],
      width: 1280,
      height: 720,
    };
    store.data.instances.push(i);
    return i;
  };
  add('internal', path.join(store.root, 'instances/internal'));
  add('external', path.join(base, 'external'));
  await mkdir(path.join(store.root, 'assets'), { recursive: true });
  await writeFile(path.join(store.root, 'assets/test'), 'resource');
  await writeFile(path.join(store.dir('external'), 'world.txt'), 'external-world');
  await writeFile(path.join(store.root, 'unrelated.txt'), 'keep-me');
  store.save();
  return { base, profile, layout, store, storage, target: path.join(base, 'new-data') };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it('migrates managed backgrounds and schema backups with the data directory', async () => {
  const { store, storage, target } = await fixture();
  await mkdir(path.join(store.root, 'appearance'));
  await writeFile(path.join(store.root, 'appearance', 'background.png'), 'managed-image');
  await writeFile(path.join(store.root, 'state.json.v6.bak'), 'state-backup');
  await storage.migrate(store, target, ctx());
  expect(await readFile(path.join(target, 'appearance', 'background.png'), 'utf8')).toBe(
    'managed-image',
  );
  expect(await readFile(path.join(target, 'state.json.v6.bak'), 'utf8')).toBe('state-backup');
});
it('rejects migrating launcher data anywhere inside an indexed game folder with isolated versions', async () => {
  const { base, store, storage } = await fixture();
  const source = path.join(base, 'indexed-games');
  await atomicJson(path.join(source, 'versions/v1/v1.json'), {
    id: '1.21.1',
    mainClass: 'Main',
    libraries: [],
  });
  await writeFile(path.join(source, 'versions/v1/v1.jar'), 'fixture');
  await mkdir(path.join(source, 'versions/v1/saves'), { recursive: true });
  const folders = new GameFolders(store),
    scan = await folders.scan(source);
  await folders.add({ selectionId: scan.selectionId, name: 'Indexed', layouts: [] });
  const target = path.join(source, 'launcher-data');
  await expect(storage.migrate(store, target, ctx())).rejects.toThrow('已索引');
  expect(await exists(target)).toBe(false);
  expect(await readFile(path.join(source, 'versions/v1/v1.jar'), 'utf8')).toBe('fixture');
});
it('gives a fresh installation a separate data child and keeps an existing profile in place', async () => {
  const base = await temp(),
    profile = path.join(base, 'profile');
  const fresh = resolveStorage(profile);
  expect(fresh.root).toBe(path.join(profile, 'data'));
  expect(fresh.config.setupComplete).toBe(false);
  const legacy = new Store(profile);
  legacy.save();
  const old = resolveStorage(profile);
  expect(old.root).toBe(profile);
  expect(old.config.setupComplete).toBe(true);
});
it('locates portable data beside the outer executable, and rebases internal paths when moved', async () => {
  const base = await temp(),
    original = path.join(base, 'portable-a'),
    moved = path.join(base, 'portable-b');
  const layout = resolveStorage(path.join(base, 'unused'), undefined, original);
  prepareStorage(layout);
  const store = new Store(layout.root);
  store.data.settings.javaPath = path.join(layout.root, 'runtimes/bin/java');
  store.save();
  await cp(original, moved, { recursive: true });
  const next = resolveStorage(path.join(base, 'unused'), undefined, moved);
  prepareStorage(next);
  expect(next.mode).toBe('portable');
  expect(next.root).toBe(path.join(moved, 'KJMCL-data'));
  expect(new Store(next.root).data.settings.javaPath).toBe(
    path.join(next.root, 'runtimes/bin/java'),
  );
});
it('refuses to silently replace a missing selected disk with empty default data', async () => {
  const { profile, target, storage, store } = await fixture();
  await storage.migrate(store, target, ctx());
  await rm(target, { recursive: true });
  expect(() => resolveStorage(profile, profile)).toThrow('数据目录不可用');
  expect(await exists(target)).toBe(false);
});
it('copies and verifies managed files, remaps internal paths, and preserves external games', async () => {
  const { profile, target, storage, store, base } = await fixture();
  await mkdir(path.join(store.root, 'tools/terracotta/0.4.2'), { recursive: true });
  await writeFile(
    path.join(store.root, 'tools/terracotta/0.4.2/manifest.json'),
    '{"schemaVersion":1}',
  );
  store.data.settings.javaPath = path.join(store.root, 'runtimes/bin/java');
  await storage.migrate(store, target, ctx());
  expect(await readFile(path.join(target, 'assets/test'), 'utf8')).toBe('resource');
  expect(await readFile(path.join(target, 'tools/terracotta/0.4.2/manifest.json'), 'utf8')).toBe(
    '{"schemaVersion":1}',
  );
  const next = new Store(target);
  expect(next.dir('internal')).toBe(path.join(target, 'instances/internal'));
  expect(next.dir('external')).toBe(path.join(base, 'external'));
  expect(next.data.settings.javaPath).toBe(path.join(target, 'runtimes/bin/java'));
  expect(await exists(path.join(profile, 'assets/test'))).toBe(true);
  expect(await exists(path.join(target, 'unrelated.txt'))).toBe(false);
  const layout = resolveStorage(profile, profile);
  prepareStorage(layout);
  const restarted = new Storage(layout, path.join(base, 'program'));
  expect((await restarted.info()).retired?.path).toBe(profile);
  await restarted.cleanup(ctx());
  expect(await exists(path.join(profile, 'assets/test'))).toBe(false);
  expect(await exists(path.join(profile, 'tools/terracotta/0.4.2/manifest.json'))).toBe(false);
  expect(await readFile(path.join(profile, 'unrelated.txt'), 'utf8')).toBe('keep-me');
  expect(await readFile(path.join(base, 'external/world.txt'), 'utf8')).toBe('external-world');
  expect(await exists(path.join(profile, 'storage-location.json'))).toBe(true);
});
it('does not clean changed originals and supports retry after partial cleanup', async () => {
  const { profile, target, storage, store, base } = await fixture();
  await storage.migrate(store, target, ctx());
  const next = new Storage(resolveStorage(profile, profile), path.join(base, 'program'));
  await writeFile(path.join(profile, 'assets/test'), 'new-user-content');
  await expect(next.cleanup(ctx())).rejects.toThrow('原文件已修改');
  expect(await exists(path.join(profile, 'state.json'))).toBe(true);
  await writeFile(path.join(profile, 'assets/test'), 'resource');
  await rm(path.join(profile, 'assets/test')); // simulate a completed first deletion followed by an interruption
  await next.cleanup(ctx());
  expect((await next.info()).retired).toBeUndefined();
});
it('cancels migration without committing the new directory or deleting source files', async () => {
  const { profile, target, storage, store } = await fixture(),
    controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await expect(
    storage.migrate(store, target, { signal: controller.signal, progress: vi.fn() }),
  ).rejects.toThrow('cancelled');
  expect(await exists(target)).toBe(false);
  expect(resolveStorage(profile, profile).root).toBe(profile);
  expect(await readFile(path.join(profile, 'assets/test'), 'utf8')).toBe('resource');
});
it('recovers an interrupted pointer commit from the verified migration journal', async () => {
  const { profile, target, storage, store, layout, base } = await fixture();
  const original = { ...layout.config };
  await storage.migrate(store, target, ctx());
  await atomicJson(path.join(profile, 'storage-location.json'), original);
  const resumed = new Storage(resolveStorage(profile, profile), path.join(base, 'program'));
  expect(resumed.pendingRestart).toBe(target);
  await resumed.commitPending();
  expect(resolveStorage(profile, profile).root).toBe(target);
});
it('rejects root, overlapping, occupied and linked destinations', async () => {
  const { base, profile, storage, store } = await fixture();
  expect(() => canonicalDestination(path.parse(base).root)).toThrow('根目录');
  await expect(storage.migrate(store, path.join(profile, 'nested'), ctx())).rejects.toThrow('重叠');
  await expect(storage.migrate(store, path.join(base, 'external'), ctx())).rejects.toThrow(
    '实例目录',
  );
  const occupied = path.join(base, 'occupied');
  await mkdir(occupied);
  await writeFile(path.join(occupied, 'keep'), 'keep');
  await expect(storage.migrate(store, occupied, ctx())).rejects.toThrow('空的数据目录');
  const linked = path.join(base, 'linked');
  await symlink(occupied, linked, 'junction');
  await expect(storage.migrate(store, linked, ctx())).rejects.toThrow('符号链接');
});
it('keeps or cancels uninstall without mutating files; explicit deletion preserves external and unknown files', async () => {
  const { storage, profile, base } = await fixture();
  expect(await storage.reviewUninstall(async () => 0)).toBe(0);
  expect(await exists(path.join(profile, 'assets/test'))).toBe(true);
  expect(await storage.reviewUninstall(async () => 2)).toBe(2);
  expect(await exists(path.join(profile, 'state.json'))).toBe(true);
  expect(await storage.reviewUninstall(async () => 1)).toBe(0);
  expect(await exists(path.join(profile, 'state.json'))).toBe(false);
  expect(await readFile(path.join(base, 'external/world.txt'), 'utf8')).toBe('external-world');
  expect(await readFile(path.join(profile, 'unrelated.txt'), 'utf8')).toBe('keep-me');
});
it('refuses destructive cleanup without ownership or when data overlaps the application', async () => {
  const { layout, profile, base } = await fixture();
  await expect(
    removeManagedData([profile], 'wrong-owner', path.join(base, 'program')),
  ).rejects.toThrow('归属');
  await expect(
    new Storage(layout, path.join(profile, 'program')).reviewUninstall(async () => 0),
  ).rejects.toThrow('程序目录');
  expect(await exists(path.join(profile, 'state.json'))).toBe(true);
});
it('preflights nested junctions before deleting any managed data', async () => {
  const { profile, storage, base } = await fixture();
  await symlink(path.join(base, 'external'), path.join(profile, 'assets/junction'), 'junction');
  await expect(storage.reviewUninstall(async () => 1)).rejects.toThrow('符号链接');
  expect(await exists(path.join(profile, 'state.json'))).toBe(true);
  expect(await readFile(path.join(base, 'external/world.txt'), 'utf8')).toBe('external-world');
});
