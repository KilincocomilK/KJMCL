import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { gzipSync } from 'node:zlib';
import { Store } from '../electron/core/store';
import { claimDirectory } from '../electron/core/instances';
import { Resources } from '../electron/core/resources';
import { readNbt, schematicPreview } from '../electron/core/resource-preview';
import { schemas } from '../shared/schema';
import type { Instance } from '../shared/types';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-resource-test-'));
  roots.push(root);
  const store = new Store(path.join(root, 'data'));
  for (const [id, version, loader] of [
    ['fabric', '1.21.1', 'fabric'],
    ['older', '1.20.1', 'forge'],
  ] as const) {
    const gameDir = claimDirectory(store, path.join(store.root, 'instances', id), id);
    store.data.instances.push({
      id,
      name: id,
      version,
      loader,
      gameDir,
      status: 'ready',
      createdAt: 0,
      playTime: 0,
      memoryMb: 2048,
      javaPath: '',
      jvmArgs: [],
      width: 1280,
      height: 720,
    } satisfies Instance);
  }
  const zip = async (name: string, files: Record<string, string | Buffer>) => {
    const z = new AdmZip();
    for (const [n, b] of Object.entries(files))
      z.addFile(n, Buffer.isBuffer(b) ? b : Buffer.from(b));
    const p = path.join(root, name);
    await writeFile(p, z.toBuffer());
    return p;
  };
  return { root, store, r: new Resources(store), zip };
}
it('identifies contents and only recommends a uniquely matching instance from metadata', async () => {
  const { r, zip } = await setup();
  const mod = await zip('random.jar', {
    'fabric.mod.json': JSON.stringify({ id: 'sample', depends: { minecraft: '1.21.1' } }),
  });
  const shader = await zip('random.zip', { 'shaders/a.fsh': 'shader' });
  const pack = await zip('texture.zip', {
    'pack.mcmeta': JSON.stringify({ pack: { pack_format: 34, description: '测试资源' } }),
  });
  const replay = await zip('record.mcpr', {
    'metaData.json': JSON.stringify({ mcversion: '1.21.1', duration: 12500 }),
    'recording.tmcpr': 'recording',
  });
  const result = await r.inspect([mod, shader, pack, replay]);
  expect(result.map((c) => c.kind)).toEqual([
    'mods',
    'shaderpacks',
    'resourcepacks',
    'replay_recordings',
  ]);
  expect(result[0].suggestedInstanceId).toBe('fabric');
  expect(result[1].suggestedInstanceId).toBeUndefined();
  expect(result[3].suggestedInstanceId).toBe('fabric');
  expect(result.every((c) => !c.error)).toBe(true);
});
it('imports with no overwrite, preserves the source, lists nested recordings, previews and renames safely', async () => {
  const { r, zip, store } = await setup();
  const source = await zip('pack.zip', {
    'pack.mcmeta': JSON.stringify({ pack: { pack_format: 34, description: '测试资源' } }),
  });
  const inspect = async () => (await r.inspect([source]))[0];
  const a = await inspect();
  const choice = {
    token: a.token,
    id: 'fabric',
    kind: 'resourcepacks' as const,
    conflict: 'skip' as const,
  };
  expect((await r.importOne(choice)).status).toBe('added');
  const b = await inspect();
  expect((await r.importOne({ ...choice, token: b.token })).status).toBe('skipped');
  expect((await r.importOne({ ...choice, token: b.token, conflict: 'rename' })).name).toBe(
    'pack (1).zip',
  );
  expect(await readFile(source)).toEqual(
    await readFile(path.join(store.dir('fabric'), 'resourcepacks', 'pack.zip')),
  );
  expect((await r.preview('fabric', 'resourcepacks', 'pack.zip')).description).toBe('测试资源');
  await r.rename('fabric', 'resourcepacks', 'pack (1).zip', 'renamed.zip');
  await expect(r.rename('fabric', 'resourcepacks', 'renamed.zip', 'pack.zip')).rejects.toThrow();
  await expect(r.rename('fabric', 'resourcepacks', 'renamed.zip', 'escape.exe')).rejects.toThrow();
  expect((await r.list('fabric')).map((f) => f.name).sort()).toEqual(['pack.zip', 'renamed.zip']);
  expect(await r.list('older')).toEqual([]);
  await mkdir(path.join(store.dir('fabric'), 'replay_recordings', 'sub'), { recursive: true });
  await writeFile(path.join(store.dir('fabric'), 'replay_recordings', 'sub', 'a.mcpr'), 'fixture');
  expect((await r.list('fabric')).some((f) => f.name === 'sub/a.mcpr')).toBe(true);
});
it('rejects modified sources, unsupported files, traversal, symlink destinations and cross-kind writes', async () => {
  const { root, r, zip, store } = await setup();
  const source = await zip('mod.jar', { 'fabric.mod.json': '{}' }),
    c = (await r.inspect([source]))[0];
  await expect(
    r.importOne({ token: c.token, id: 'fabric', kind: 'shaderpacks', conflict: 'skip' }),
  ).rejects.toThrow('不匹配');
  await writeFile(source, 'changed');
  await expect(
    r.importOne({ token: c.token, id: 'fabric', kind: 'mods', conflict: 'skip' }),
  ).rejects.toThrow('改变');
  const exe = path.join(root, 'evil.exe');
  await writeFile(exe, 'fixture');
  expect((await r.inspect([exe]))[0].error).toContain('不支持');
  expect(
    schemas.previewResource.safeParse({ id: 'fabric', kind: 'mods', name: '../state.json' })
      .success,
  ).toBe(false);
  await expect(r.file('fabric', 'mods', '../evil.jar')).rejects.toThrow();
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await symlink(outside, path.join(store.dir('fabric'), 'shaderpacks'), 'junction');
  await expect(r.location('fabric', 'shaderpacks', 'test.zip', true)).rejects.toThrow('链接');
  expect(await r.list('older')).toEqual([]);
});
it('rejects malformed archives and never recommends broad Minecraft ranges as exact matches', async () => {
  const { r, zip, root } = await setup();
  const mod = await zip('range.jar', {
    'fabric.mod.json': JSON.stringify({ depends: { minecraft: '>=1.21.1' } }),
  });
  const c = (await r.inspect([mod]))[0];
  expect(c.reason).not.toContain('Minecraft >=');
  expect(c.suggestedInstanceId).toBeUndefined();
  const invalid = path.join(root, 'broken.zip');
  await writeFile(invalid, 'no zip');
  expect((await r.inspect([invalid]))[0].error).toBeTruthy();
  const fakeReplay = await zip('broken.mcpr', { 'metaData.json': '{}' });
  expect((await r.inspect([fakeReplay]))[0].error).toContain('Replay');
});
const short = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const text = (s: string) => Buffer.concat([short(Buffer.byteLength(s)), Buffer.from(s)]);
const int = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const named = (type: number, name: string, payload: Buffer) =>
  Buffer.concat([Buffer.from([type]), text(name), payload]);
const compound = (...tags: Buffer[]) => Buffer.concat([...tags, Buffer.from([0])]);
it('previews compressed Litematica packed palette states and Sponge v3 varints', async () => {
  const { root } = await setup();
  const word = Buffer.alloc(8);
  word.writeBigUInt64BE(4n);
  const palette = Buffer.concat([
    Buffer.from([10]),
    int(2),
    compound(named(8, 'Name', text('minecraft:air'))),
    compound(named(8, 'Name', text('minecraft:stone'))),
  ]);
  const region = compound(
    named(
      10,
      'Size',
      compound(named(3, 'x', int(-2)), named(3, 'y', int(1)), named(3, 'z', int(1))),
    ),
    named(9, 'BlockStatePalette', palette),
    named(12, 'BlockStates', Buffer.concat([int(1), word])),
  );
  const litematic = named(
    10,
    '',
    compound(named(10, 'Regions', compound(named(10, '测试区域', region)))),
  );
  const file = path.join(root, 'test.litematic');
  await writeFile(file, gzipSync(litematic));
  expect((await schematicPreview(file)).layers?.[0]).toEqual({
    name: '测试区域',
    width: 2,
    depth: 1,
    cells: ['', 'minecraft:stone'],
  });
  const blockPalette = named(
    10,
    'Palette',
    compound(named(3, 'minecraft:air', int(0)), named(3, 'minecraft:stone', int(1))),
  );
  const blockData = named(7, 'Data', Buffer.concat([int(2), Buffer.from([0, 1])]));
  const spongeRoot = compound(
    named(2, 'Width', short(2)),
    named(2, 'Height', short(1)),
    named(2, 'Length', short(1)),
    named(10, 'Blocks', compound(blockPalette, blockData)),
  );
  const sponge = named(10, '', compound(named(10, 'Schematic', spongeRoot)));
  const schem = path.join(root, 'test.schem');
  await writeFile(schem, gzipSync(sponge));
  expect((await schematicPreview(schem)).layers?.[0].cells).toEqual(['', 'minecraft:stone']);
});
it('decodes a real NBT schematic top-down, including legacy IDs and rejects unbounded NBT', async () => {
  const { root } = await setup();
  const tags = ['Width', 'Height', 'Length'].map((n) =>
    Buffer.concat([Buffer.from([2]), text(n), short(n === 'Width' ? 2 : 1)]),
  );
  const length = Buffer.alloc(4);
  length.writeInt32BE(2);
  const nbt = Buffer.concat([
    Buffer.from([10]),
    text('Schematic'),
    ...tags,
    Buffer.from([7]),
    text('Blocks'),
    length,
    Buffer.from([0, 1, 0]),
  ]);
  const file = path.join(root, 'test.schematic');
  await writeFile(file, nbt);
  const preview = await schematicPreview(file);
  expect(preview.layers?.[0]).toEqual({
    name: '区域',
    width: 2,
    depth: 1,
    cells: ['', 'legacy:1'],
  });
  expect(() => readNbt(Buffer.from([10, 0, 0, 7, 0, 0, 127, 255, 255, 255]))).toThrow();
  expect(() => readNbt(Buffer.from([10, 0, 0, 99]))).toThrow();
});
