import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { SaveRegion, TerrainTileRequest, WorldRef } from '../../shared/types';
import { cellKey } from './terrain';

type Side = TerrainTileRequest['side'];
export type Thumbnail = { image?: HTMLCanvasElement; color?: string; error?: string };
const keyOf = (r: SaveRegion) => cellKey(r.x, r.z);

export function useTerrainThumbnails(
  ref: WorldRef,
  dimension: string,
  side: Side | 0,
  regions: SaveRegion[],
) {
  const [levels] = useState(() => ({
    1: new Map<string, Thumbnail>(),
    8: new Map<string, Thumbnail>(),
    32: new Map<string, Thumbnail>(),
  }));
  const cache = side ? levels[side] : undefined;
  const latest = useRef({ regions, side });
  const pending = useRef(false),
    alive = useRef(true);
  const [revision, refresh] = useState(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    latest.current = { side, regions };
  }, [side, regions]);
  const batch = useMemo(() => {
    const missing: SaveRegion[] = [];
    if (!cache) return missing;
    const limit = side === 32 ? 3 : side === 8 ? 8 : 32;
    for (const r of regions) {
      if (!cache.has(keyOf(r))) missing.push(r);
      if (missing.length >= limit) break;
    }
    return missing;
  }, [side, regions, cache, revision]);
  useEffect(() => {
    if (!side || !cache || !batch.length || pending.current) return;
    pending.current = true;
    void api
      .worldTerrainTiles({
        ...ref,
        dimension,
        side,
        regions: batch.map((r) => ({ rx: r.x, rz: r.z })),
      })
      .then((result) => {
        if (!alive.current) return;
        for (const tile of result) {
          const key = cellKey(tile.rx, tile.rz);
          if (!tile.pixels) {
            cache.set(key, { error: tile.error ?? '地形读取失败' });
            continue;
          }
          const bytes = Uint8ClampedArray.from(atob(tile.pixels), (c) => c.charCodeAt(0));
          if (side === 1) {
            cache.set(key, bytes[3] ? { color: 'rgb(' + bytes.slice(0, 3).join(',') + ')' } : {});
            continue;
          }
          const image = document.createElement('canvas');
          image.width = side;
          image.height = side;
          image.getContext('2d')!.putImageData(new ImageData(bytes, side, side), 0, 0);
          cache.set(key, { image });
        }
        // Keep distant one-pixel samples cheaply. Retain detailed thumbnails near the viewport.
        const active = latest.current;
        const nearby = active.side === side || !active.side ? active.regions : [];
        if (side !== 1 && cache.size > Math.max(1024, nearby.length + 256)) {
          const visible = new Set(nearby.map(keyOf));
          for (const key of cache.keys()) {
            if (!visible.has(key)) cache.delete(key);
            if (cache.size <= Math.max(768, visible.size)) break;
          }
        }
      })
      .catch((e) => {
        if (alive.current)
          for (const r of batch)
            cache.set(keyOf(r), {
              error: e instanceof Error ? e.message : String(e),
            });
      })
      .finally(() => {
        pending.current = false;
        if (alive.current) refresh((n) => n + 1);
      });
  }, [ref.id, ref.world, side, dimension, batch, cache]);
  const get = useCallback((r: SaveRegion) => cache?.get(keyOf(r)), [cache]);
  const preview = useCallback(
    (r: SaveRegion) => {
      const exact = get(r);
      if (exact && !exact.error) return exact;
      for (const resolution of [32, 8, 1] as const) {
        const cached = levels[resolution].get(keyOf(r));
        if (cached && !cached.error) return cached;
      }
    },
    [get, levels],
  );
  const retry = () => {
    if (cache) for (const r of regions) if (get(r)?.error) cache.delete(keyOf(r));
    refresh((n) => n + 1);
  };
  return { get, preview, revision, retry };
}
