import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { SeedMapStorage } from '../electron/core/seed-map-storage';
import { SeedMapEngine } from '../electron/core/seed-map';
import { emptySeedMapState, type SeedMapDocument, type SeedMapState } from '../shared/seed-map';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-seed-storage-'));
  roots.push(root);
  const data = path.join(root, 'data');
  return {
    root,
    data,
    file: path.join(data, 'seed-map', 'workspace.json'),
    storage: new SeedMapStorage({ root: data }),
  };
}
function document(name = '种子地图'): SeedMapDocument {
  return {
    id: randomUUID(),
    name,
    seed: '9007199254740993',
    seedText: '9007199254740993',
    version: '26.3',
    dimension: 'overworld',
    y: 77,
    largeBiomes: true,
    centerX: -400,
    centerZ: 8192,
    zoom: 0.125,
    structures: ['village', 'abandoned_camp'],
    grid: true,
    slime: false,
    highlightBiomes: [188],
    markers: [
      {
        id: randomUUID(),
        name: '营地',
        x: -123,
        z: 456,
        dimension: 'overworld',
        color: '#f26b21',
        notes: '高地🌱',
      },
      {
        id: randomUUID(),
        name: '传送门',
        x: -16,
        z: 57,
        dimension: 'nether',
        color: '#834adb',
        notes: '',
      },
    ],
    modifiedAt: 1730000000000,
  };
}
const state = (map = document()): SeedMapState => ({
  schemaVersion: 1,
  current: map,
  saved: [map],
});
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

describe('seed map durable workspace and projects', () => {
  it('starts empty and preserves all map settings, exact seeds and markers after restart', async () => {
    const f = await fixture();
    expect(await f.storage.state()).toEqual(emptySeedMapState());
    expect(await f.storage.recover()).toBeNull();
    const saved = state();
    await f.storage.save(saved);
    await f.storage.flush();
    expect(await new SeedMapStorage({ root: f.data }).state()).toEqual(saved);
    expect(await json(f.file)).toEqual(saved);
  });
  it('serializes concurrent writes, snapshots submitted objects and keeps the preceding complete backup', async () => {
    const f = await fixture(),
      values = Array.from({ length: 8 }, (_, i) => state(document('视图' + i))),
      expected = structuredClone(values);
    const writes = values.map((value) => f.storage.save(value));
    values.at(-1)!.current!.name = 'late caller mutation';
    values.at(-1)!.current!.markers[0].notes = 'must not leak';
    const duringWrite = f.storage.state();
    await f.storage.flush();
    await Promise.all(writes);
    expect(await duringWrite).toEqual(expected.at(-1));
    // Pending views coalesce while the first write is active; backup is the last committed view.
    expect(await json(f.file + '.bak')).toEqual(expected[0]);
    expect(await readdir(path.dirname(f.file))).not.toContain('workspace.json.tmp');
  });
  it('does not reset corrupt state and archives it when the user restores the previous backup', async () => {
    const f = await fixture(),
      first = state(document('first'));
    await f.storage.save(first);
    await f.storage.save(state(document('second')));
    await writeFile(f.file, '{truncated');
    await expect(f.storage.state()).rejects.toThrow();
    expect(await readFile(f.file, 'utf8')).toBe('{truncated');
    const backup = await f.storage.recover();
    expect(backup).toEqual(first);
    await f.storage.save(backup!);
    expect(await f.storage.state()).toEqual(first);
    expect(await f.storage.recover()).toEqual(first);
    const corrupt = (await readdir(path.dirname(f.file))).filter((name) =>
      name.startsWith('workspace.corrupt-'),
    );
    expect(corrupt).toHaveLength(1);
    expect(await readFile(path.join(path.dirname(f.file), corrupt[0]), 'utf8')).toBe('{truncated');
  });
  it('surfaces failed writes at flush and allows a retry without losing the prior workspace', async () => {
    const f = await fixture(),
      first = state(document('first'));
    await f.storage.save(first);
    await mkdir(f.file + '.tmp');
    await expect(f.storage.save(state(document('failed')))).rejects.toThrow();
    await expect(f.storage.flush()).rejects.toThrow();
    expect(await f.storage.state()).toEqual(first);
    await rm(f.file + '.tmp', { recursive: true });
    await f.storage.save(state(document('retried')));
    await expect(f.storage.flush()).resolves.toBeUndefined();
    expect((await f.storage.state()).current!.name).toBe('retried');
  });
  it('round-trips portable project and marker files without changing current work', async () => {
    const f = await fixture(),
      map = document(),
      saved = state(document('current'));
    await f.storage.save(saved);
    const project = path.join(f.root, '地图.kjmap'),
      markers = path.join(f.root, '标记.json');
    await f.storage.export(map, 'project', project);
    await f.storage.export(map, 'markers', markers);
    expect(await f.storage.importProject(project)).toEqual(map);
    expect(await f.storage.importMarkers(markers)).toEqual({
      seed: map.seed,
      version: map.version,
      markers: map.markers,
    });
    expect(await f.storage.state()).toEqual(saved);
    await expect(f.storage.export(document('replacement'), 'project', project)).rejects.toThrow();
    expect((await json(project)).map).toEqual(map);
  });
  it.each([
    ['future schema', (map: SeedMapDocument) => ({ schemaVersion: 2, map })],
    [
      'unknown field',
      (map: SeedMapDocument) => ({ schemaVersion: 1, map: { ...map, privatePath: 'secret' } }),
    ],
    [
      'duplicate markers',
      (map: SeedMapDocument) => ({
        schemaVersion: 1,
        map: { ...map, markers: [map.markers[0], map.markers[0]] },
      }),
    ],
    [
      'out of range coordinates',
      (map: SeedMapDocument) => ({ schemaVersion: 1, map: { ...map, centerX: 30000001 } }),
    ],
    [
      'unsafe seed',
      (map: SeedMapDocument) => ({ schemaVersion: 1, map: { ...map, seed: 9007199254740993 } }),
    ],
  ])('rejects %s imports while retaining the original workspace', async (_name, corrupt) => {
    const f = await fixture(),
      saved = state();
    await f.storage.save(saved);
    const file = path.join(f.root, 'bad.kjmap');
    await writeFile(file, JSON.stringify(corrupt(document())));
    await expect(f.storage.importProject(file)).rejects.toThrow();
    expect(await f.storage.state()).toEqual(saved);
  });
  it('bounds files before reading and rejects directory imports', async () => {
    const f = await fixture(),
      large = path.join(f.root, 'large.kjmap'),
      handle = await open(large, 'w');
    await handle.truncate(16 * 1024 * 1024 + 1);
    await handle.close();
    await expect(f.storage.importProject(large)).rejects.toThrow('过大');
    await expect(f.storage.importProject(f.root)).rejects.toThrow();
  });
  it('rejects duplicate marker identities in a standalone marker import', async () => {
    const f = await fixture(),
      map = document(),
      file = path.join(f.root, 'duplicate-markers.json');
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        seed: map.seed,
        version: map.version,
        markers: [map.markers[0], map.markers[0]],
      }),
    );
    await expect(f.storage.importMarkers(file)).rejects.toThrow();
  });
  it('refuses junctions in managed storage and import/export paths', async () => {
    const f = await fixture(),
      outside = path.join(f.root, 'outside'),
      linked = path.join(f.root, 'linked');
    await mkdir(outside);
    await symlink(outside, linked, 'junction');
    const map = document();
    await writeFile(path.join(outside, 'source.kjmap'), JSON.stringify({ schemaVersion: 1, map }));
    await expect(f.storage.importProject(path.join(linked, 'source.kjmap'))).rejects.toThrow(
      '链接',
    );
    await expect(f.storage.export(map, 'project', path.join(linked, 'out.kjmap'))).rejects.toThrow(
      '链接',
    );
    await mkdir(f.data);
    await symlink(outside, path.dirname(f.file), 'junction');
    await expect(f.storage.save(state())).rejects.toThrow('链接');
    expect(await readdir(outside)).toEqual(['source.kjmap']);
  });
  it('exports validated real PNG pixels and rejects malformed screenshots', async () => {
    const f = await fixture(),
      image = new PNG({ width: 32, height: 24 });
    for (let i = 0; i < image.data.length; i += 4) image.data.set([i % 256, 82, 201, 255], i);
    const data = 'data:image/png;base64,' + PNG.sync.write(image).toString('base64'),
      target = path.join(f.root, 'map.png');
    await f.storage.export(document(), 'png', target, data);
    const decoded = PNG.sync.read(await readFile(target));
    expect([decoded.width, decoded.height]).toEqual([32, 24]);
    expect(decoded.data).toEqual(image.data);
    for (const invalid of [
      undefined,
      'data:image/jpeg;base64,AAAA',
      'data:image/png;base64,AAAA',
      data.slice(0, -15),
    ])
      await expect(
        f.storage.export(document(), 'png', path.join(f.root, 'bad.png'), invalid),
      ).rejects.toThrow();
    expect(await readdir(f.root)).not.toContain('bad.png');
  });
});

describe('seed map native executable validation', () => {
  it('rejects platform mismatches and altered executable bytes before launching', async () => {
    const f = await fixture(),
      name = 'kjmcl-seed-map' + (process.platform === 'win32' ? '.exe' : '');
    await writeFile(path.join(f.root, name), 'not executable');
    const manifest = {
      schemaVersion: 1,
      platform: process.platform,
      arch: process.arch,
      executable: name,
      sha256: '0'.repeat(64),
    };
    await writeFile(
      path.join(f.root, 'manifest.json'),
      JSON.stringify({ ...manifest, platform: 'invalid' }),
    );
    const service = new SeedMapEngine(f.root);
    await expect(service.info()).rejects.toThrow('系统不匹配');
    await writeFile(path.join(f.root, 'manifest.json'), JSON.stringify(manifest));
    await expect(service.info()).rejects.toThrow('校验失败');
    service.dispose();
  });
});
