import type { SaveChunk, SaveRegion } from '../../shared/types';

export interface Point {
  x: number;
  z: number;
}
export interface Camera extends Point {
  zoom: number;
}
export interface Tile {
  image: HTMLImageElement;
  chunks: SaveChunk[];
}
export type MapTool = 'pan' | 'rectangle-add' | 'rectangle-remove' | 'brush' | 'erase' | 'spawn';
export interface SelectionBox {
  a: Point;
  b: Point;
  remove: boolean;
}
export interface MapSize {
  w: number;
  h: number;
}
export const cellKey = (x: number, z: number) => x + ',' + z;
export const chunkAt = (p: Point): Point => ({ x: Math.floor(p.x / 16), z: Math.floor(p.z / 16) });
export function regionBounds(camera: Camera, view: MapSize, margin = 0) {
  const dx = (view.w / 2 + margin) / camera.zoom,
    dz = (view.h / 2 + margin) / camera.zoom;
  return {
    left: Math.floor((camera.x - dx) / 512),
    right: Math.floor((camera.x + dx) / 512),
    top: Math.floor((camera.z - dz) / 512),
    bottom: Math.floor((camera.z + dz) / 512),
  };
}

export function regionsNear(
  index: Map<string, SaveRegion>,
  camera: Camera,
  view: MapSize,
  margin: number,
) {
  const { left, right, top, bottom } = regionBounds(camera, view, margin);
  const result: SaveRegion[] = [];
  if ((right - left + 1) * (bottom - top + 1) > index.size) {
    for (const r of index.values())
      if (r.x >= left && r.x <= right && r.z >= top && r.z <= bottom) result.push(r);
  } else {
    for (let z = top; z <= bottom; z++)
      for (let x = left; x <= right; x++) {
        const r = index.get(cellKey(x, z));
        if (r) result.push(r);
      }
  }
  const distance = (r: SaveRegion) =>
    (r.x * 512 + 256 - camera.x) ** 2 + (r.z * 512 + 256 - camera.z) ** 2;
  return result.sort((a, b) => distance(a) - distance(b));
}
export function groupsFrom(selection: Set<string>) {
  const groups = new Map<string, { rx: number; rz: number; indices: number[] }>();
  for (const key of selection) {
    const [x, z] = key.split(',').map(Number),
      rx = Math.floor(x / 32),
      rz = Math.floor(z / 32),
      region = cellKey(rx, rz);
    let group = groups.get(region);
    if (!group) {
      group = { rx, rz, indices: [] };
      groups.set(region, group);
    }
    group.indices.push((z - rz * 32) * 32 + x - rx * 32);
  }
  return [...groups.values()];
}
export function startCamera(regions: SaveRegion[], spawn: Point | null): Camera {
  const valid = regions.filter((r) => r.chunks > 0);
  if (!valid.length) return { ...(spawn ?? { x: 0, z: 0 }), zoom: 0.8 };
  const at = spawn ?? { x: 0, z: 0 };
  let nearest = valid[0],
    distance = Infinity;
  for (const r of valid) {
    const d = Math.hypot(r.x * 512 + 256 - at.x, r.z * 512 + 256 - at.z);
    if (d < distance) {
      distance = d;
      nearest = r;
    }
  }
  if (valid.length <= 9) {
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity;
    for (const r of valid)
      for (let i = 0; i < 1024; i++)
        if (occupied(r, i)) {
          const x = r.x * 512 + (i % 32) * 16,
            z = r.z * 512 + Math.floor(i / 32) * 16;
          left = Math.min(left, x);
          right = Math.max(right, x + 16);
          top = Math.min(top, z);
          bottom = Math.max(bottom, z + 16);
        }
    if (right > left && bottom > top && Math.max(right - left, bottom - top) <= 2048)
      return {
        x: (left + right) / 2,
        z: (top + bottom) / 2,
        zoom: Math.min(1.25, 600 / (right - left), 350 / (bottom - top)),
      };
  }
  if (
    valid.length > 1 &&
    spawn &&
    valid.some((r) => r.x === Math.floor(spawn.x / 512) && r.z === Math.floor(spawn.z / 512))
  )
    return { ...spawn, zoom: 0.8 };
  let x = 0,
    z = 0,
    n = 0;
  for (let i = 0; i < 1024; i++)
    if (occupied(nearest, i)) {
      x += (i % 32) * 16 + 8;
      z += Math.floor(i / 32) * 16 + 8;
      n++;
    }
  return {
    x: nearest.x * 512 + (n ? x / n : 256),
    z: nearest.z * 512 + (n ? z / n : 256),
    zoom: 0.8,
  };
}
export function occupied(region: SaveRegion, index: number) {
  if (!region.occupancy) return false;
  const byte = Math.floor(index / 8) * 2;
  return !!(parseInt(region.occupancy.slice(byte, byte + 2), 16) & (1 << (index % 8)));
}
export function inBox(regions: Map<string, SaveRegion>, a: Point, b: Point) {
  const result: string[] = [];
  const minX = Math.min(a.x, b.x),
    maxX = Math.max(a.x, b.x),
    minZ = Math.min(a.z, b.z),
    maxZ = Math.max(a.z, b.z);
  for (let rz = Math.floor(minZ / 32); rz <= Math.floor(maxZ / 32); rz++)
    for (let rx = Math.floor(minX / 32); rx <= Math.floor(maxX / 32); rx++) {
      const r = regions.get(cellKey(rx, rz));
      if (!r) continue;
      for (let z = Math.max(minZ, rz * 32); z <= Math.min(maxZ, rz * 32 + 31); z++)
        for (let x = Math.max(minX, rx * 32); x <= Math.min(maxX, rx * 32 + 31); x++) {
          if (occupied(r, (z - rz * 32) * 32 + x - rx * 32)) result.push(cellKey(x, z));
        }
    }
  return result;
}
