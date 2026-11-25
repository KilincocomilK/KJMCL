import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { Store } from '../electron/core/store';
import { claimDirectory } from '../electron/core/instances';
import { Resources } from '../electron/core/resources';
import type { ProjectionWorkshop } from '../electron/core/projection-workshop';
import type { ProjectionAssetService } from '../electron/core/projection-assets';
import { projectionHandlers } from '../electron/projection-features';
import { schemas } from '../shared/schema';
import type { ProjectionDocument } from '../shared/projection';

vi.mock('electron', () => ({ dialog: {} }));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-projection-resources-'));
  roots.push(root);
  const store = new Store(path.join(root, 'data'));
  const id = 'fixture-instance';
  const gameDir = claimDirectory(store, path.join(store.root, 'instances', id), id);
  store.data.instances.push({
    id,
    name: 'Fixture',
    version: '1.21.4',
    loader: 'vanilla',
    gameDir,
    status: 'ready',
    createdAt: 0,
    playTime: 0,
    memoryMb: 2048,
    javaPath: '',
    jvmArgs: [],
    width: 1280,
    height: 720,
  });
  const source = path.join(gameDir, 'schematics', 'nested', '测试.litematic');
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, 'projection service boundary fixture');
  const result = { id: 'resolved-by-workshop' } as ProjectionDocument;
  const importFile = vi.fn(async (_source: string, _key?: string) => result);
  const handlers = projectionHandlers({
    store,
    resources: new Resources(store),
    workshop: { importFile } as unknown as ProjectionWorkshop,
    assets: {} as ProjectionAssetService,
    window: () => ({}) as BrowserWindow,
    writable: async () => {},
  });
  return { root, gameDir, id, source, handlers, importFile, result };
}

it('accepts only an instance and relative resource name over the named bridge', () => {
  const schema = schemas.projectionImportResource;
  expect(schema.safeParse({ id: 'fixture-instance', name: 'nested/测试.litematic' }).success).toBe(
    true,
  );
  for (const name of [
    '../outside.nbt',
    '/outside.nbt',
    'nested/../../outside.nbt',
    'C:/outside.nbt',
    'nested\\outside.nbt',
  ])
    expect(schema.safeParse({ id: 'fixture-instance', name }).success).toBe(false);
  expect(
    schema.safeParse({ id: 'fixture-instance', name: 'a.nbt', path: 'outside.nbt' }).success,
  ).toBe(false);
});

it('resolves nested schematics through the owned instance resource service', async () => {
  const f = await setup();
  expect(
    await f.handlers.projectionImportResource({ id: f.id, name: 'nested/测试.litematic' }),
  ).toBe(f.result);
  expect(f.importFile).toHaveBeenCalledExactlyOnceWith(
    f.source,
    JSON.stringify([f.id, 'nested/测试.litematic']),
  );
  // Extensions alone do not identify the NBT format; the native parser makes that decision.
  const legacy = path.join(f.gameDir, 'schematics', 'legacy.schematic');
  await writeFile(legacy, 'format is decided by the native parser');
  await f.handlers.projectionImportResource({ id: f.id, name: 'legacy.schematic' });
  expect(f.importFile).toHaveBeenLastCalledWith(legacy, JSON.stringify([f.id, 'legacy.schematic']));
});

it('rejects traversal, foreign kinds and linked resources before opening the workshop', async () => {
  const f = await setup();
  for (const name of ['../outside.nbt', 'nested/../../outside.nbt', 'mod.jar', 'missing.nbt'])
    await expect(f.handlers.projectionImportResource({ id: f.id, name })).rejects.toThrow();
  const outside = path.join(f.root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'a.nbt'), 'external data');
  await symlink(outside, path.join(f.gameDir, 'schematics', 'linked'), 'junction');
  await expect(
    f.handlers.projectionImportResource({ id: f.id, name: 'linked/a.nbt' }),
  ).rejects.toThrow();
  expect(f.importFile).not.toHaveBeenCalled();
});
