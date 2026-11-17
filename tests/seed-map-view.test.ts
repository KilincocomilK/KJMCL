import { describe, expect, it } from 'vitest';
import {
  LruCache,
  pan,
  sampleStep,
  screenToWorld,
  tileKey,
  viewBounds,
  visibleTiles,
  worldToScreen,
  WORLD_LIMIT,
  zoomAt,
} from '../src/seed-map/map-math';
describe('seed map view', () => {
  it('round trips negative and far coordinates without pixel drift', () => {
    for (const zoom of [1 / 256, 0.25, 1, 32]) {
      const view = { x: -232949.5, z: 29998321, zoom },
        size = { width: 983, height: 657 };
      const point = screenToWorld(132, 87, view, size);
      expect(worldToScreen(point, view, size).x).toBeCloseTo(132, 6);
      expect(worldToScreen(point, view, size).y).toBeCloseTo(87, 6);
    }
  });
  it('zooms under cursor and pans in world coordinates', () => {
    const view = { x: -15, z: 32, zoom: 0.25 },
      size = { width: 800, height: 600 };
    const next = zoomAt(view, size, 100, 200, 4);
    expect(screenToWorld(100, 200, next, size)).toEqual(screenToWorld(100, 200, view, size));
    expect(pan(view, 10, -20)).toEqual({ x: -55, z: 112, zoom: 0.25 });
  });
  it('aligns negative tiles and covers complete viewport with bounded sample counts', () => {
    const view = { x: -1, z: -1, zoom: 0.25 },
      size = { width: 1100, height: 700 };
    const tiles = visibleTiles(view, size),
      bounds = viewBounds(view, size),
      span = tiles[0].step * 128;
    expect(new Set(tiles.map(tileKey)).size).toBe(tiles.length);
    expect(Math.min(...tiles.map((t) => t.x))).toBeLessThanOrEqual(bounds.minX);
    expect(Math.max(...tiles.map((t) => t.x)) + span).toBeGreaterThanOrEqual(bounds.maxX);
    expect(Math.min(...tiles.map((t) => t.z))).toBeLessThanOrEqual(bounds.minZ);
    expect(tiles.length).toBeLessThanOrEqual(80);
    expect(sampleStep(24)).toBe(1);
    expect(sampleStep(1 / 256)).toBe(256);
  });
  it('evicts least recently used tile, keeping current view data', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.size).toBe(2);
    cache.resize(1);
    expect(cache.values()).toEqual([3]);
  });
  it('covers large viewports without dropping edge tiles', () => {
    for (const zoom of [0.65, 0.8, 1, 4, 16, 1 / 256]) {
      const view = { x: -1, z: -37, zoom },
        size = { width: 3840, height: 2160 };
      const tiles = visibleTiles(view, size),
        bounds = viewBounds(view, size);
      expect(tiles.length).toBeLessThanOrEqual(tiles[0].step === 256 ? 600 : 80);
      for (const x of [bounds.minX, view.x, bounds.maxX])
        for (const z of [bounds.minZ, view.z, bounds.maxZ])
          expect(
            tiles.some(
              (t) => x >= t.x && x < t.x + t.size * t.step && z >= t.z && z < t.z + t.size * t.step,
            ),
          ).toBe(true);
    }
  });
  it('keeps every sampled pixel within native world limits at both boundaries', () => {
    for (const coordinate of [-WORLD_LIMIT, WORLD_LIMIT])
      for (const zoom of [1 / 256, 0.25, 1, 32]) {
        const tiles = visibleTiles(
          { x: coordinate, z: coordinate, zoom },
          { width: 1440, height: 900 },
        );
        expect(new Set(tiles.map(tileKey)).size).toBe(tiles.length);
        for (const tile of tiles) {
          expect(tile.x).toBeGreaterThanOrEqual(-30_000_000);
          expect(tile.z).toBeGreaterThanOrEqual(-30_000_000);
          expect(tile.x + (tile.size - 1) * tile.step).toBeLessThanOrEqual(30_000_000);
          expect(tile.z + (tile.size - 1) * tile.step).toBeLessThanOrEqual(30_000_000);
        }
      }
  });
});
