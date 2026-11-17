import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { SeedMapStorage } from '../electron/core/seed-map-storage';
import type { SeedMapDocument, SeedMapState } from '../shared/seed-map';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-seed-queue-'));
  roots.push(root);
  return {
    root,
    file: path.join(root, 'seed-map', 'workspace.json'),
    storage: new SeedMapStorage({ root }),
  };
}
function document(name = 'map'): SeedMapDocument {
  return {
    id: randomUUID(),
    name,
    seed: '0',
    version: '26.3',
    dimension: 'overworld',
    y: 64,
    largeBiomes: false,
    centerX: 0,
    centerZ: 0,
    zoom: 1,
    structures: [],
    grid: false,
    slime: false,
    highlightBiomes: [],
    markers: [],
    modifiedAt: 1,
  };
}
const state = (name: string): SeedMapState => ({
  schemaVersion: 1,
  current: document(name),
  saved: [],
});
const read = async (file: string): Promise<SeedMapState> =>
  JSON.parse(await readFile(file, 'utf8'));

describe('seed map save queue', () => {
  it('coalesces waiting snapshots and acknowledges them only after the latest snapshot is written', async () => {
    const f = await fixture();
    const values = Array.from({ length: 100 }, (_, i) => state(String(i)));
    const writes = values.map((value) => f.storage.save(value));
    const acknowledgements = writes.slice(1).map(async (pending) => {
      await pending;
      expect((await read(f.file)).current?.name).toBe('99');
    });
    // The first save is already running. Only the latest queued snapshot should follow it.
    values[99].current!.name = 'late caller mutation';
    await f.storage.flush();
    await Promise.all([writes[0], ...acknowledgements]);
    expect((await read(f.file + '.bak')).current?.name).toBe('0');
    expect((await f.storage.state()).current?.name).toBe('99');
  });
  it('rejects every superseded waiter on failure and allows a clean retry', async () => {
    const f = await fixture();
    await f.storage.save(state('original'));
    await mkdir(f.file + '.tmp');
    const outcomes = Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => f.storage.save(state(String(i)))),
    );
    await expect(f.storage.flush()).rejects.toThrow();
    expect((await outcomes).every((r) => r.status === 'rejected')).toBe(true);
    expect((await f.storage.state()).current?.name).toBe('original');
    await rm(f.file + '.tmp', { recursive: true });
    await f.storage.save(state('retried'));
    await expect(f.storage.flush()).resolves.toBeUndefined();
    expect((await f.storage.state()).current?.name).toBe('retried');
  });
  it('counts the actual pretty-printed bytes before accepting a save', async () => {
    const f = await fixture();
    await f.storage.save(state('original'));
    const markers = Array.from({ length: 500 }, () => ({
      id: randomUUID(),
      name: 'a',
      x: 0,
      z: 0,
      dimension: 'overworld' as const,
      color: '#ff0000',
      notes: 'a'.repeat(900),
    }));
    const value: SeedMapState = {
      schemaVersion: 1,
      current: null,
      saved: Array.from({ length: 30 }, () => ({ ...document('a'), markers })),
    };
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(16 * 1024 * 1024);
    expect(Buffer.byteLength(JSON.stringify(value, null, 2))).toBeGreaterThan(16 * 1024 * 1024);
    expect(() => f.storage.save(value)).toThrow('地图记录过大');
    await f.storage.flush();
    expect((await f.storage.state()).current?.name).toBe('original');
  });
});
