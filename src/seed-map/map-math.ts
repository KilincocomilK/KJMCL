export interface MapView {
  x: number;
  z: number;
  zoom: number;
}
export interface MapSize {
  width: number;
  height: number;
}
export interface WorldPoint {
  x: number;
  z: number;
}
export const WORLD_LIMIT = 29_999_984;
export const MIN_ZOOM = 1 / 256;
export const MAX_ZOOM = 32;
export const clampCoordinate = (value: number) =>
  Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, Number.isFinite(value) ? value : 0));
export const clampZoom = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
export function screenToWorld(x: number, y: number, view: MapView, size: MapSize): WorldPoint {
  return {
    x: view.x + (x - size.width / 2) / view.zoom,
    z: view.z + (y - size.height / 2) / view.zoom,
  };
}
export function worldToScreen(point: WorldPoint, view: MapView, size: MapSize) {
  return {
    x: (point.x - view.x) * view.zoom + size.width / 2,
    y: (point.z - view.z) * view.zoom + size.height / 2,
  };
}
export function zoomAt(
  view: MapView,
  size: MapSize,
  x: number,
  y: number,
  factor: number,
): MapView {
  const point = screenToWorld(x, y, view, size),
    zoom = clampZoom(view.zoom * factor);
  return {
    x: clampCoordinate(point.x - (x - size.width / 2) / zoom),
    z: clampCoordinate(point.z - (y - size.height / 2) / zoom),
    zoom,
  };
}
export function pan(view: MapView, dx: number, dy: number): MapView {
  return {
    ...view,
    x: clampCoordinate(view.x - dx / view.zoom),
    z: clampCoordinate(view.z - dy / view.zoom),
  };
}
export function sampleStep(zoom: number) {
  let step = 1;
  while (step * zoom < 0.65 && step < 256) step *= 4;
  return step;
}
export function viewBounds(view: MapView, size: MapSize) {
  const a = screenToWorld(0, 0, view, size),
    b = screenToWorld(size.width, size.height, view, size);
  return {
    minX: Math.floor(clampCoordinate(a.x)),
    minZ: Math.floor(clampCoordinate(a.z)),
    maxX: Math.ceil(clampCoordinate(b.x)),
    maxZ: Math.ceil(clampCoordinate(b.z)),
  };
}
export interface TilePosition {
  x: number;
  z: number;
  step: number;
  size: number;
}
export function visibleTiles(view: MapView, size: MapSize, pixels = 128): TilePosition[] {
  let step = sampleStep(view.zoom);
  const bounds = viewBounds(view, size);
  const countAt = (sample: number) => {
    const span = sample * pixels;
    return (
      (Math.floor(bounds.maxX / span) - Math.floor(bounds.minX / span) + 1) *
      (Math.floor(bounds.maxZ / span) - Math.floor(bounds.minZ / span) + 1)
    );
  };
  while (countAt(step) > 80 && step < 256) step *= 4;
  const span = step * pixels,
    lower = Math.ceil(-30_000_000 / step) * step,
    upper = Math.floor((30_000_000 - (pixels - 1) * step) / step) * step,
    tiles = new Map<string, TilePosition>();
  for (let z = Math.floor(bounds.minZ / span) * span; z <= bounds.maxZ; z += span)
    for (let x = Math.floor(bounds.minX / span) * span; x <= bounds.maxX; x += span) {
      const tile = {
        x: Math.max(lower, Math.min(upper, x)),
        z: Math.max(lower, Math.min(upper, z)),
        step,
        size: pixels,
      };
      tiles.set(tileKey(tile), tile);
    }
  return [...tiles.values()].sort(
    (a, b) =>
      Math.hypot(a.x + span / 2 - view.x, a.z + span / 2 - view.z) -
      Math.hypot(b.x + span / 2 - view.x, b.z + span / 2 - view.z),
  );
}
export const tileKey = (tile: TilePosition) => `${tile.step}:${tile.x}:${tile.z}:${tile.size}`;
export class LruCache<K, V> {
  private map = new Map<K, V>();
  constructor(public capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error('Cache capacity must be positive');
  }
  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }
  set(key: K, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value!);
  }
  resize(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error('Cache capacity must be positive');
    this.capacity = capacity;
    while (this.map.size > capacity) this.map.delete(this.map.keys().next().value!);
  }
  has(key: K) {
    return this.map.has(key);
  }
  values() {
    return [...this.map.values()];
  }
  clear() {
    this.map.clear();
  }
  get size() {
    return this.map.size;
  }
}
export function rulerLength(zoom: number, targetPixels = 100) {
  const desired = targetPixels / zoom,
    magnitude = 10 ** Math.floor(Math.log10(desired));
  const length =
    [1, 2, 5, 10].map((value) => value * magnitude).find((value) => value >= desired) ?? magnitude;
  return { blocks: length, pixels: length * zoom };
}
