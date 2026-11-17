import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  normalizeSeed,
  isSlimeChunk,
  seedMapTileSchema,
  seedMapFeaturesSchema,
  seedMapLocateSchema,
  seedMapStateSchema,
  seedMapProjectSchema,
  type SeedMapInfo,
  type SeedMapTileRequest,
  type SeedMapDocument,
} from '../shared/seed-map';
import {
  SeedMapEngine,
  type SeedNativeRunner,
  type SeedNativeResponse,
} from '../electron/core/seed-map';

const query = {
  seed: '262',
  version: '1.18.2',
  dimension: 'overworld' as const,
  y: 63,
  largeBiomes: false,
};
const tile = (requestId: string, x = 0): SeedMapTileRequest => ({
  ...query,
  requestId,
  x,
  z: 0,
  step: 1,
  size: 128,
});
const catalog: SeedMapInfo = {
  engine: 'test boundary runner',
  revision: 'fixture',
  versions: [{ id: '1.18.2', name: '1.18.2' }],
  biomes: [{ id: 14, name: 'mushroom_fields', color: '#ff00ff', dimension: 'overworld' }],
  structures: [{ id: 'village', name: 'village', dimension: 'overworld' }],
};
const response = (data: unknown): SeedNativeResponse => ({ protocol: 1, data, elapsedMs: 7 });
const pixels = (args: Record<string, unknown>) =>
  response({
    x: args.x,
    z: args.z,
    step: args.step,
    width: 128,
    height: 128,
    rgba: Buffer.alloc(128 * 128 * 4, 255).toString('base64'),
    biomes: Buffer.alloc(128 * 128 * 2).toString('base64'),
  });
const engines: SeedMapEngine[] = [];
const engine = (runner: SeedNativeRunner) => {
  const value = new SeedMapEngine('unused-injected-boundary', runner);
  engines.push(value);
  return value;
};
afterEach(() => engines.splice(0).forEach((value) => value.dispose()));
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function mapDocument(name = '地图'): SeedMapDocument {
  return {
    ...query,
    id: randomUUID(),
    name,
    seedText: '262',
    centerX: -17,
    centerZ: 21,
    zoom: 0.25,
    structures: ['village'],
    grid: true,
    slime: true,
    highlightBiomes: [14],
    markers: [
      {
        id: randomUUID(),
        name: '基地',
        x: -123,
        z: 456,
        dimension: 'overworld',
        color: '#f26b21',
        notes: '从传送门向北',
      },
    ],
    modifiedAt: 1730000000000,
  };
}

describe('seed map Java compatibility and boundary schemas', () => {
  it('matches genuine Java seed parsing, UTF-16 hashing and Random fixtures', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/seed-java-reference.json', import.meta.url), 'utf8'),
    ) as { seeds: string[]; slime: [string, number, number, boolean][] };
    const inputs = [
      '0',
      '+000262',
      '-9223372036854775808',
      '9223372036854775807',
      '9223372036854775808',
      '9007199254740993',
      'Minecraft',
      '种子地图',
      '🌱',
      '\uD800',
      'Aa',
      'BB',
    ];
    expect(inputs.map(normalizeSeed)).toEqual(fixture.seeds);
    for (const [seed, x, z, result] of fixture.slime)
      expect(isSlimeChunk(seed, x, z), `${seed} chunk ${x},${z}`).toBe(result);
    expect(fixture.slime.some((v) => v[3])).toBe(true);
    expect(normalizeSeed('  262 ')).toBe('262');
    expect(() => normalizeSeed(' ')).toThrow();
    expect(() => normalizeSeed('a'.repeat(257))).toThrow();
  });
  it('bounds native work, coordinates and complete project documents', () => {
    expect(seedMapTileSchema.safeParse(tile('ok', -128)).success).toBe(true);
    for (const value of [
      { ...tile('bad'), seed: '9223372036854775808' },
      { ...tile('bad'), x: 1, step: 4 },
      { ...tile('bad'), size: 1024 },
      { ...tile('bad'), x: 30000001 },
      { ...tile('bad'), path: 'private' },
    ])
      expect(seedMapTileSchema.safeParse(value).success).toBe(false);
    const features = {
      ...query,
      requestId: 'f',
      x0: -128,
      z0: -128,
      x1: 128,
      z1: 128,
      types: ['village'],
      limit: 8,
    };
    expect(seedMapFeaturesSchema.safeParse(features).success).toBe(true);
    expect(seedMapFeaturesSchema.safeParse({ ...features, x1: 200000 }).success).toBe(false);
    expect(seedMapFeaturesSchema.safeParse({ ...features, z1: -129 }).success).toBe(false);
    expect(
      seedMapLocateSchema.safeParse({
        ...query,
        requestId: 'l',
        x: 0,
        z: 0,
        kind: 'structure',
        target: 'village',
        radius: 20000,
      }).success,
    ).toBe(false);
    const map = mapDocument();
    expect(seedMapProjectSchema.parse({ schemaVersion: 1, map }).map).toEqual(map);
    for (const state of [
      { schemaVersion: 2, current: map, saved: [] },
      {
        schemaVersion: 1,
        current: { ...map, markers: [map.markers[0], map.markers[0]] },
        saved: [],
      },
      { schemaVersion: 1, current: map, saved: [map, map] },
    ])
      expect(seedMapStateSchema.safeParse(state).success).toBe(false);
  });
});

describe('seed map native task service', () => {
  it('validates the supported version before generation and reuses a localized catalog', async () => {
    const calls: string[] = [];
    const service = engine(async (command, args) => {
      calls.push(command);
      return command === 'info' ? response(catalog) : pixels(args);
    });
    const info = await service.info();
    expect(info.biomes[0].name).toBe('蘑菇岛');
    await expect(service.tile({ ...tile('future'), version: '26.99' })).rejects.toThrow('不支持');
    expect(calls).toEqual(['info']);
    await service.tile(tile('supported'));
    expect(calls).toEqual(['info', 'tile']);
  });
  it('retries a failed catalog instead of poisoning all future requests', async () => {
    let calls = 0;
    const service = engine(async () => {
      if (!calls++) throw new Error('temporary');
      return response(catalog);
    });
    await expect(service.info()).rejects.toThrow('temporary');
    expect((await service.info()).versions).toEqual(catalog.versions);
    expect(calls).toBe(2);
  });
  it('honors cancellation while the initial version catalog is still loading', async () => {
    let resolveCatalog!: (r: SeedNativeResponse) => void;
    const calls: string[] = [];
    const service = engine(async (command, args) => {
      calls.push(command);
      return command === 'info'
        ? new Promise((resolve) => {
            resolveCatalog = resolve;
          })
        : pixels(args);
    });
    const pending = service.tile(tile('before_catalog')).then(
      () => null,
      (e) => e,
    );
    service.cancel('before_catalog');
    resolveCatalog(response(catalog));
    expect((await pending).message).toContain('取消');
    expect(calls).toEqual(['info']);
    await service.tile(tile('fresh'));
    expect(calls).toEqual(['info', 'tile']);
  });
  it('bounds running jobs at two, cancels queued/running work, and discards late results', async () => {
    const pending = new Map<
      string,
      {
        resolve: (r: SeedNativeResponse) => void;
        signal: AbortSignal;
        args: Record<string, unknown>;
      }
    >();
    const service = engine(async (command, args, signal) =>
      command === 'info'
        ? response(catalog)
        : new Promise((resolve) => pending.set(String(args.x), { resolve, signal, args })),
    );
    await service.info();
    const first = service.tile(tile('first', 0)).then(
        () => null,
        (e) => e,
      ),
      second = service.tile(tile('second', 128)),
      third = service.tile(tile('third', 256)).then(
        () => null,
        (e) => e,
      );
    await turn();
    expect(pending.size).toBe(2);
    service.cancel('third');
    expect((await third).message).toContain('取消');
    service.cancel('first');
    expect(pending.get('0')!.signal.aborted).toBe(true);
    pending.get('0')!.resolve(pixels(pending.get('0')!.args));
    expect((await first).message).toContain('取消');
    pending.get('128')!.resolve(pixels(pending.get('128')!.args));
    await second;
    await turn();
    expect(pending.has('256')).toBe(false);
    const retry = service.tile(tile('retry', 0));
    await turn();
    expect(pending.get('0')!.signal.aborted).toBe(false);
    pending.get('0')!.resolve(pixels(pending.get('0')!.args));
    expect((await retry).cached).toBe(false);
  });
  it('rejects duplicate ids and an oversized queue without starting additional native jobs', async () => {
    const pending: { resolve: (r: SeedNativeResponse) => void; args: Record<string, unknown> }[] =
      [];
    const service = engine(async (command, args) =>
      command === 'info'
        ? response(catalog)
        : new Promise((resolve) => pending.push({ resolve, args })),
    );
    await service.info();
    const tasks = Array.from({ length: 64 }, (_, i) =>
      service.tile(tile('q' + i, i * 128)).then(
        () => null,
        (e) => e,
      ),
    );
    await turn();
    expect(pending).toHaveLength(2);
    await expect(service.tile(tile('q0', 9000))).rejects.toThrow('重复');
    await expect(service.tile(tile('overflow', 10000))).rejects.toThrow('过多');
    service.cancelAll();
    for (const p of pending) p.resolve(pixels(p.args));
    expect((await Promise.all(tasks)).every((e) => e?.message.includes('取消'))).toBe(true);
  });
  it('keeps at most 128 verified tiles and evicts the least recently used tile', async () => {
    let generated = 0;
    const service = engine(async (command, args) => {
      if (command === 'info') return response(catalog);
      generated++;
      return pixels(args);
    });
    for (let i = 0; i < 128; i++) await service.tile(tile('tile' + i, i * 128));
    expect((await service.tile(tile('refresh', 0))).cached).toBe(true);
    await service.tile(tile('new', 128 * 128));
    expect((await service.tile(tile('retained', 0))).cached).toBe(true);
    expect((await service.tile(tile('evicted', 128))).cached).toBe(false);
    expect(generated).toBe(130);
    expect((await service.tile({ ...tile('different-height', 0), y: -32 })).cached).toBe(false);
  });
  it('rejects corrupt native pixels before caching and retries the same tile', async () => {
    let invalid = true;
    const service = engine(async (command, args) =>
      command === 'info'
        ? response(catalog)
        : invalid
          ? response({ ...(pixels(args).data as object), biomes: 'AA==' })
          : pixels(args),
    );
    await expect(service.tile(tile('bad'))).rejects.toThrow('像素');
    invalid = false;
    expect((await service.tile(tile('good'))).cached).toBe(false);
    service.dispose();
    await expect(service.tile(tile('closed', 128))).rejects.toThrow(/关闭|取消/);
  });
});
