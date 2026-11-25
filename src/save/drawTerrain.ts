import type { SaveRegion } from '../../shared/types';
import {
  cellKey,
  type Camera,
  type MapSize,
  type Point,
  type SelectionBox,
  type Tile,
  type groupsFrom,
} from './terrain';
import type { Thumbnail } from './useTerrainThumbnails';

// Snap the backing layer to this interval. A moving viewport can use its margins
// without repainting the terrain between anchor changes.
export const PAN_MARGIN = 128;

export interface TerrainLayer {
  anchor: Camera;
  view: MapSize;
  ratio: number;
  regions: SaveRegion[];
  tiles: ReadonlyMap<string, Tile>;
  thumbnail: (r: SaveRegion) => Thumbnail | undefined;
  detailed: boolean;
  heat: boolean;
  grid: boolean;
  groups: ReturnType<typeof groupsFrom>;
  spawn: Point | null;
}

const heatmaps = new WeakMap<Tile, HTMLCanvasElement>();
function heatmap(tile: Tile) {
  const cached = heatmaps.get(tile);
  if (cached) return cached;
  const image = document.createElement('canvas');
  image.width = image.height = 32;
  const ctx = image.getContext('2d')!;
  const pixels = ctx.createImageData(32, 32);
  for (const chunk of tile.chunks) {
    if (!chunk.inhabitedTicks || chunk.inhabitedTicks < 0) continue;
    const offset = chunk.index * 4;
    pixels.data[offset] = 255;
    pixels.data[offset + 1] = 97;
    pixels.data[offset + 2] = 34;
    pixels.data[offset + 3] = 255 * Math.min(0.75, Math.log1p(chunk.inhabitedTicks / 1200) * 0.12);
  }
  ctx.putImageData(pixels, 0, 0);
  heatmaps.set(tile, image);
  return image;
}

export function paintTerrain(canvas: HTMLCanvasElement, layer: TerrainLayer) {
  const { anchor, view, ratio } = layer;
  const w = view.w + PAN_MARGIN * 2,
    h = view.h + PAN_MARGIN * 2;
  const width = Math.round(w * ratio),
    height = Math.round(h * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = '#151a18';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  const s = anchor.zoom,
    ox = w / 2 - anchor.x * s,
    oz = h / 2 - anchor.z * s;
  for (const r of layer.regions) {
    const tile = layer.tiles.get(cellKey(r.x, r.z));
    const preview = layer.detailed && tile ? undefined : layer.thumbnail(r);
    const x = Math.round(ox + r.x * 512 * s),
      y = Math.round(oz + r.z * 512 * s);
    const tw = Math.max(1, Math.round(ox + (r.x + 1) * 512 * s) - x);
    const th = Math.max(1, Math.round(oz + (r.z + 1) * 512 * s) - y);
    if (preview?.color) {
      ctx.fillStyle = preview.color;
      ctx.fillRect(x, y, tw, th);
    } else {
      const image = preview?.image ?? tile?.image;
      if (image) ctx.drawImage(image, x, y, tw, th);
    }
    if (layer.heat && layer.detailed && tile) ctx.drawImage(heatmap(tile), x, y, tw, th);
  }
  if (layer.grid) {
    const step = 16 * s * 2 ** Math.max(0, Math.ceil(Math.log2(7 / (16 * s))));
    ctx.beginPath();
    ctx.strokeStyle = '#c8d4bc48';
    for (let x = ((ox % step) + step) % step; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let z = ((oz % step) + step) % step; z < h; z += step) {
      ctx.moveTo(0, z);
      ctx.lineTo(w, z);
    }
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,157,66,.55)';
  ctx.strokeStyle = '#ffb467';
  for (const { rx, rz, indices } of layer.groups) {
    const left = ox + rx * 512 * s,
      top = oz + rz * 512 * s;
    if (left >= w || top >= h || left + 512 * s < 0 || top + 512 * s < 0) continue;
    for (const i of indices) {
      const x = left + (i % 32) * 16 * s,
        z = top + Math.floor(i / 32) * 16 * s;
      ctx.fillRect(x, z, 16 * s, 16 * s);
      if (s >= 0.6) ctx.strokeRect(x + 0.5, z + 0.5, 16 * s - 1, 16 * s - 1);
    }
  }
  if (layer.spawn) {
    const x = Math.round(ox + layer.spawn.x * s),
      z = Math.round(oz + layer.spawn.z * s);
    ctx.fillStyle = '#201911';
    ctx.fillRect(x - 6, z - 6, 12, 12);
    ctx.fillStyle = '#ffab61';
    ctx.fillRect(x - 4, z - 2, 8, 4);
    ctx.fillRect(x - 2, z - 4, 4, 8);
  }
}

export function paintViewport(
  canvas: HTMLCanvasElement,
  buffer: HTMLCanvasElement,
  layer: TerrainLayer,
  camera: Camera,
  box?: SelectionBox,
) {
  const { anchor, view, ratio } = layer;
  const w = Math.round(view.w * ratio),
    h = Math.round(view.h * ratio);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d')!;
  const dx = Math.round((PAN_MARGIN + (camera.x - anchor.x) * camera.zoom) * ratio);
  const dz = Math.round((PAN_MARGIN + (camera.z - anchor.z) * camera.zoom) * ratio);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buffer, dx, dz, w, h, 0, 0, w, h);
  if (!box) return;
  const s = 16 * camera.zoom;
  const x = view.w / 2 - camera.x * camera.zoom + Math.min(box.a.x, box.b.x) * s;
  const y = view.h / 2 - camera.z * camera.zoom + Math.min(box.a.z, box.b.z) * s;
  const bw = (Math.abs(box.a.x - box.b.x) + 1) * s,
    bh = (Math.abs(box.a.z - box.b.z) + 1) * s;
  ctx.save();
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = box.remove ? '#ea695730' : '#ffb46730';
  ctx.strokeStyle = box.remove ? '#ff9b87' : '#ffcf9c';
  if (box.remove) ctx.setLineDash([5, 3]);
  ctx.fillRect(x, y, bw, bh);
  ctx.strokeRect(x, y, bw, bh);
  ctx.restore();
}
