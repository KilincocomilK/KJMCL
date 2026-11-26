import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AppearanceManager, backgroundDimensions } from '../electron/core/appearance';
import { STATE_VERSION, Store } from '../electron/core/store';
import { schemas } from '../shared/schema';
import { DEFAULT_SIDEBAR_ORDER } from '../shared/navigation';

const roots: string[] = [];
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
const image = () => ({
  isEmpty: () => false,
  getSize: () => ({ width: 1, height: 1 }),
  resize: vi.fn(image),
  toPNG: () => png,
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-appearance-'));
  roots.push(root);
  const store = new Store(root);
  return { root, store, appearance: new AppearanceManager(store, image) };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('background import', () => {
  it('retains an independent managed image across source deletion and restart, then resets it', async () => {
    const { root, store, appearance } = await fixture();
    const source = path.join(root, '用户背景.png');
    await writeFile(source, png);
    await appearance.import(source);
    const id = store.data.appearance.backgroundId;
    expect(id).toBeTruthy();
    await rm(source);
    const reopened = new Store(root);
    const restored = new AppearanceManager(reopened, image);
    expect(await restored.image()).toBe('data:image/png;base64,' + png.toString('base64'));
    restored.update({ dim: 65, blur: 12 });
    await restored.reset();
    expect(await restored.image()).toBeNull();
    expect(new Store(root).data.appearance).toEqual({ dim: 65, blur: 12 });
    await expect(readFile(path.join(root, 'appearance', id + '.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('rejects untrusted bytes and dimension bombs before decoding without altering the previous background', async () => {
    const { root, store, appearance } = await fixture();
    const source = path.join(root, 'image.png');
    await writeFile(source, png);
    await appearance.import(source);
    const previous = { ...store.data.appearance };
    const decode = vi.fn(image),
      rejecting = new AppearanceManager(store, decode);
    const enormous = Buffer.from(png);
    enormous.writeUInt32BE(16384, 16);
    enormous.writeUInt32BE(16384, 20);
    await writeFile(source, enormous);
    await expect(rejecting.import(source)).rejects.toThrow('图片尺寸过大');
    await writeFile(source, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await expect(rejecting.import(source)).rejects.toThrow('有效');
    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0);
    webp.write('WEBP', 8);
    webp.write('VP8X', 12);
    await writeFile(source, webp);
    await expect(rejecting.import(source)).rejects.toThrow('PNG 或 JPEG');
    expect(decode).not.toHaveBeenCalled();
    expect(store.data.appearance).toEqual(previous);
  });
  it('rejects invalid decoder output and rolls back when persisting fails', async () => {
    const { root, store, appearance } = await fixture();
    const source = path.join(root, 'image.png');
    await writeFile(source, png);
    const empty = new AppearanceManager(store, () => ({ ...image(), isEmpty: () => true }));
    await expect(empty.import(source)).rejects.toThrow('有效');
    const previous = { ...store.data.appearance };
    vi.spyOn(store, 'save').mockImplementation(() => {
      throw new Error('disk failure');
    });
    await expect(appearance.import(source)).rejects.toThrow('disk failure');
    expect(store.data.appearance).toEqual(previous);
  });
  it('downsamples large decoded images and tolerates a missing managed file without resetting preferences', async () => {
    const { root, store } = await fixture();
    const source = path.join(root, 'image.png');
    await writeFile(source, png);
    const resized = vi.fn(image);
    const appearance = new AppearanceManager(store, () => ({
      ...image(),
      getSize: () => ({ width: 4096, height: 2048 }),
      resize: resized,
    }));
    await appearance.import(source);
    expect(resized).toHaveBeenCalledWith({ width: 2560, height: 1280, quality: 'best' });
    await rm(path.join(root, 'appearance', store.data.appearance.backgroundId + '.png'));
    expect(await new AppearanceManager(store, image).image()).toBeNull();
    expect(new Store(root).data.appearance.backgroundId).toBe(store.data.appearance.backgroundId);
  });
});

describe('appearance contract and migration', () => {
  it('bounds dimensions, bytes, settings and rejects renderer-provided paths', () => {
    expect(backgroundDimensions(png)).toEqual({ width: 1, height: 1 });
    expect(() => backgroundDimensions(Buffer.alloc(20 * 1024 * 1024 + 1))).toThrow('20 MiB');
    expect(() => schemas.updateAppearance.parse({ dim: 81, blur: 0 })).toThrow();
    expect(() => schemas.updateAppearance.parse({ dim: 32, blur: -1 })).toThrow();
    expect(() =>
      schemas.updateAppearance.parse({ dim: 32, blur: 0, backgroundId: '../secret' }),
    ).toThrow();
    expect(() => schemas.pickBackground.parse('C:/secret.png')).toThrow();
    expect(() => schemas.backgroundImage.parse('../../secret')).toThrow();
  });
  it('migrates v5 while retaining accounts, folders, external instances, selections and a recoverable original', async () => {
    const { root, store } = await fixture();
    store.data.accounts = [{ id: 'player', name: 'Player', uuid: '1234', kind: 'offline' }];
    store.data.gameFolders = [
      { id: 'folder', name: 'Games', path: path.join(root, 'games'), addedAt: 1, refreshedAt: 2 },
    ];
    store.data.selectedAccountId = 'player';
    store.data.selectedGameFolderId = 'folder';
    store.data.selectedInstanceId = 'external';
    store.data.settings.memoryMb = 8192;
    store.data.instances = [
      {
        id: 'external',
        name: 'Existing',
        version: '1.21.1',
        loader: 'vanilla',
        status: 'ready',
        createdAt: 1,
        playTime: 42,
        memoryMb: 2048,
        javaPath: '',
        jvmArgs: [],
        width: 1280,
        height: 720,
        gameDir: path.join(root, 'games'),
        external: { folderId: 'folder', versionId: '1.21.1', layout: 'shared' },
      },
    ];
    const { appearance: _, ...data } = store.data;
    const original = { ...data, schemaVersion: 5 };
    await writeFile(path.join(root, 'state.json'), JSON.stringify(original));
    const next = new Store(root);
    expect(next.data.schemaVersion).toBe(STATE_VERSION);
    expect(next.data.appearance).toEqual({ dim: 32, blur: 0 });
    expect(next.data.accounts).toEqual(original.accounts);
    expect(next.data.gameFolders).toEqual(original.gameFolders);
    expect(next.data.instances[0].external).toEqual(original.instances[0].external);
    expect(next.data.instances[0].gameDir).toBe(original.instances[0].gameDir);
    expect(next.data.selectedAccountId).toBe('player');
    expect(next.data.selectedInstanceId).toBe('external');
    expect(next.data.selectedGameFolderId).toBe('folder');
    expect(next.data.settings.memoryMb).toBe(8192);
    expect(JSON.parse(await readFile(path.join(root, 'state.json.v5.bak'), 'utf8'))).toEqual(
      original,
    );
  });
});

it('migrates v7 with a backup and persists only complete sidebar permutations', async () => {
  const { root, store } = await fixture();
  const { sidebarOrder: order, ...prior } = store.data;
  const original = { ...prior, schemaVersion: 7, appearance: { dim: 31, blur: 2 } };
  const file = path.join(root, 'state.json');
  await writeFile(file, JSON.stringify(original));
  const migrated = new Store(root);
  expect(migrated.data.sidebarOrder).toEqual(DEFAULT_SIDEBAR_ORDER);
  expect(JSON.parse(await readFile(file + '.v7.bak', 'utf8'))).toEqual(original);
  const sorted = [...order].reverse();
  migrated.setSidebarOrder(sorted);
  expect(new Store(root).data).toEqual({
    ...original,
    schemaVersion: STATE_VERSION,
    welcome: { step: 'done' },
    sidebarOrder: sorted,
  });
  for (const candidate of [
    order.slice(1),
    [...order.slice(1), 'home'],
    [...order.slice(1), 'settings'],
    [...order.slice(1), 'accounts'],
    [...order.slice(1), order[1]],
  ]) {
    expect(schemas.setSidebarOrder.safeParse(candidate).success).toBe(false);
  }
  const invalid = JSON.stringify({ ...migrated.data, sidebarOrder: [] });
  await writeFile(file, invalid);
  expect(() => new Store(root)).toThrow();
  expect(await readFile(file, 'utf8')).toBe(invalid);
});

it('pins the two footer entries on v8 migration and preserves the other positions', async () => {
  const { root, store } = await fixture();
  const movable = [...store.data.sidebarOrder].reverse();
  const old = {
    ...store.data,
    schemaVersion: 8,
    sidebarOrder: ['accounts', ...movable.slice(0, 2), 'settings', ...movable.slice(2)],
  };
  const file = path.join(root, 'state.json');
  await writeFile(file, JSON.stringify(old));
  expect(new Store(root).data).toEqual({
    ...old,
    schemaVersion: STATE_VERSION,
    welcome: { step: 'done' },
    sidebarOrder: movable,
  });
  expect(new Store(root).data.sidebarOrder).toEqual(movable);
  expect(JSON.parse(await readFile(file + '.v8.bak', 'utf8'))).toEqual(old);
});
