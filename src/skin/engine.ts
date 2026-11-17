import type {
  RGBA,
  SkinBrush,
  SkinImportImage,
  SkinLayer,
  SkinModel,
  SkinPart,
  SkinPoint,
  SkinProject,
  SkinResolution,
  SkinFace,
} from '../../shared/skin';
import { skinProjectSchema } from '../../shared/skin-schema';
import {
  blendPixel,
  compositeLayers,
  decodePixels,
  encodePixels,
  resizePixels,
} from '../../shared/skin-pixels';
import { faceAt, mirroredPixel, skinFaces, surfaceTopology } from './uv';
export interface RuntimeSkinLayer extends Omit<SkinLayer, 'pixels'> {
  pixels: Uint8ClampedArray;
}
export interface SkinDocument extends Omit<SkinProject, 'layers'> {
  layers: RuntimeSkinLayer[];
}
export interface SkinClipboard {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  mask: Uint8Array;
  x: number;
  y: number;
}
export interface SkinAdjustment {
  hue?: number;
  saturation?: number;
  brightness?: number;
  contrast?: number;
  invert?: boolean;
  grayscale?: boolean;
  levels?: { black: number; white: number; gamma: number };
  outline?: { color: RGBA; width: number; inside?: boolean };
}
export interface SkinInspection {
  baseTransparent: number;
  outerTranslucent: number;
  unusedPixels: number;
}
function uvMask(model: SkinModel, resolution: number) {
  const mask = new Uint8Array(resolution ** 2);
  for (const f of skinFaces(model, resolution))
    for (let y = f.y; y < f.y + f.height; y++)
      for (let x = f.x; x < f.x + f.width; x++)
        mask[y * resolution + x] = f.surface === 'base' ? 1 : 2;
  return mask;
}
export function inspectSkin(
  pixels: Uint8ClampedArray,
  model: SkinModel,
  resolution: number,
): SkinInspection {
  if (pixels.length !== resolution ** 2 * 4) throw new Error('皮肤像素尺寸无效');
  const mask = uvMask(model, resolution),
    report = { baseTransparent: 0, outerTranslucent: 0, unusedPixels: 0 };
  for (let i = 0; i < mask.length; i++) {
    const alpha = pixels[i * 4 + 3];
    if (mask[i] === 1 && alpha < 255) report.baseTransparent++;
    if (mask[i] === 2 && alpha > 0 && alpha < 255) report.outerTranslucent++;
    if (!mask[i] && pixels.subarray(i * 4, i * 4 + 4).some((v) => v !== 0)) report.unusedPixels++;
  }
  return report;
}
export function adjustedPixels(
  source: Uint8ClampedArray,
  resolution: number,
  options: SkinAdjustment,
  selection: Uint8Array | null = null,
  alphaLock = false,
) {
  const data = source.slice();
  for (let i = 0; i < data.length; i += 4) {
    if ((selection && !selection[i / 4]) || !data[i + 3]) continue;
    let [r, g, b] = rgba(data, i)
      .slice(0, 3)
      .map((v) => v / 255);
    if (options.hue || options.saturation) {
      let [h, s, v] = rgbToHsv(r, g, b);
      h = (((h + (options.hue ?? 0) / 360) % 1) + 1) % 1;
      s = clamp(s + (options.saturation ?? 0), 0, 1);
      [r, g, b] = hsvToRgb(h, s, v);
    }
    if (options.grayscale) r = g = b = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const c = clamp(options.contrast ?? 0, -1, 1),
      contrast = c >= 0 ? 1 + c * 3 : 1 + c;
    for (const [j, v] of [r, g, b].entries()) {
      let value = options.invert ? 1 - v : v;
      value = (value - 0.5) * contrast + 0.5 + (options.brightness ?? 0);
      if (options.levels) {
        const { black, white, gamma } = options.levels;
        value = Math.pow(
          clamp(
            (value * 255 - clamp(black)) /
              (Math.max(clamp(white), clamp(black) + 1) - clamp(black)),
            0,
            1,
          ),
          1 / clamp(gamma, 0.1, 10),
        );
      }
      data[i + j] = clamp(value, 0, 1) * 255;
    }
  }
  if (options.outline) {
    const { color, inside = false } = options.outline,
      width = clamp(Math.round(options.outline.width), 1, 16),
      before = data.slice();
    // Two chamfer passes yield Chebyshev distance without a width² scan per pixel.
    const distance = new Uint16Array(resolution ** 2).fill(65535);
    for (let p = 0; p < distance.length; p++)
      if (inside ? !source[p * 4 + 3] : !!source[p * 4 + 3]) distance[p] = 0;
    for (let y = 0; y < resolution; y++)
      for (let x = 0; x < resolution; x++) {
        const i = y * resolution + x;
        let d = distance[i];
        if (x) d = Math.min(d, distance[i - 1] + 1);
        if (y) d = Math.min(d, distance[i - resolution] + 1);
        if (x && y) d = Math.min(d, distance[i - resolution - 1] + 1);
        if (x + 1 < resolution && y) d = Math.min(d, distance[i - resolution + 1] + 1);
        distance[i] = d;
      }
    for (let y = resolution - 1; y >= 0; y--)
      for (let x = resolution - 1; x >= 0; x--) {
        const i = y * resolution + x;
        let d = distance[i];
        if (x + 1 < resolution) d = Math.min(d, distance[i + 1] + 1);
        if (y + 1 < resolution) d = Math.min(d, distance[i + resolution] + 1);
        if (x + 1 < resolution && y + 1 < resolution)
          d = Math.min(d, distance[i + resolution + 1] + 1);
        if (x && y + 1 < resolution) d = Math.min(d, distance[i + resolution - 1] + 1);
        if (inside) d = Math.min(d, x + 1, y + 1, resolution - x, resolution - y);
        distance[i] = d;
      }
    for (let p = 0; p < distance.length; p++) {
      if ((selection && !selection[p]) || (alphaLock && !source[p * 4 + 3])) continue;
      if (distance[p] > 0 && distance[p] <= width) {
        blendPixel(data, p * 4, color);
        if (alphaLock) data[p * 4 + 3] = before[p * 4 + 3];
      }
    }
  }
  return data;
}
type SelectionMode = 'replace' | 'add' | 'subtract';
type Entry = { doc: SkinDocument; label: string; bytes: number };
const clamp = (v: number, min = 0, max = 255) => Math.min(max, Math.max(min, v));
let serial = 0;
const uid = () => `layer_${Date.now().toString(36)}_${(++serial).toString(36)}`;
const clone = (doc: SkinDocument): SkinDocument => ({
  ...doc,
  palette: [...doc.palette],
  layers: doc.layers.map((l) => ({ ...l, pixels: l.pixels.slice() })),
});
const rgba = (pixels: Uint8ClampedArray, i: number) =>
  Array.from(pixels.subarray(i, i + 4)) as RGBA;
export const defaultBrush: SkinBrush = {
  tool: 'pencil',
  color: [242, 107, 33, 255],
  secondary: [255, 255, 255, 255],
  size: 1,
  opacity: 1,
  hardness: 1,
  shape: 'square',
  mirror: 'none',
  tolerance: 0,
  filled: false,
  contiguous: true,
  sampleMerged: true,
  clipFace: false,
  dither: false,
  fillScope: 'texture',
  sculptMode: 'raise',
  stampScale: 1,
  stampRotation: 0,
  stampFlipX: false,
  stampFlipY: false,
  gradientSteps: 0,
  preserveAlpha: false,
  noiseStrength: 0.2,
  noiseSeed: 1,
  noisePalette: false,
};
export function createProject(
  name = '未命名皮肤',
  resolution: SkinResolution = 64,
  model: SkinModel = 'classic',
): SkinProject {
  const id = uid();
  return {
    schemaVersion: 1,
    name,
    resolution,
    model,
    activeLayerId: id,
    palette: ['#f26b21', '#ffffff', '#171717', '#b67b50', '#538d4e', '#4d74b8'],
    layers: [
      {
        id,
        name: '基础图层',
        visible: true,
        locked: false,
        opacity: 1,
        blend: 'normal',
        alphaLock: false,
        pixels: encodePixels(new Uint8ClampedArray(resolution ** 2 * 4)),
      },
    ],
  };
}
export function deserializeProject(project: SkinProject): SkinDocument {
  const parsed = skinProjectSchema.parse(project);
  return {
    ...parsed,
    layers: parsed.layers.map((l) => ({ ...l, pixels: decodePixels(l.pixels) })),
  };
}
export function serializeDocument(doc: SkinDocument): SkinProject {
  return {
    ...doc,
    palette: [...doc.palette],
    layers: doc.layers.map((l) => ({ ...l, pixels: encodePixels(l.pixels) })),
  };
}
function line(a: SkinPoint, b: SkinPoint, draw: (x: number, y: number) => void) {
  let x = Math.round(a.x),
    y = Math.round(a.y),
    tx = Math.round(b.x),
    ty = Math.round(b.y);
  const dx = Math.abs(tx - x),
    dy = -Math.abs(ty - y),
    sx = x < tx ? 1 : -1,
    sy = y < ty ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    draw(x, y);
    if (x === tx && y === ty) break;
    const e = 2 * error;
    if (e >= dy) {
      error += dy;
      x += sx;
    }
    if (e <= dx) {
      error += dx;
      y += sy;
    }
  }
}
function colorsNear(a: RGBA, b: RGBA, tolerance: number) {
  return a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
}
/** Move all arm UV faces while preserving the rest of the texture. */
export function convertModelPixels(
  pixels: Uint8ClampedArray,
  resolution: SkinResolution,
  source: SkinModel,
  target: SkinModel,
) {
  const result = pixels.slice();
  if (source === target) return result;
  const oldFaces = skinFaces(source, resolution).filter((f) => f.part.endsWith('Arm')),
    newFaces = skinFaces(target, resolution).filter((f) => f.part.endsWith('Arm'));
  for (const face of oldFaces)
    for (let y = face.y; y < face.y + face.height; y++)
      result.fill(0, (y * resolution + face.x) * 4, (y * resolution + face.x + face.width) * 4);
  for (const face of newFaces) {
    const old = oldFaces.find(
      (candidate) =>
        candidate.part === face.part &&
        candidate.surface === face.surface &&
        candidate.face === face.face,
    )!;
    for (let y = 0; y < face.height; y++)
      for (let x = 0; x < face.width; x++) {
        const ox = old.x + Math.min(old.width - 1, Math.floor((x * old.width) / face.width)),
          oy = old.y + y,
          from = (oy * resolution + ox) * 4;
        result.set(pixels.subarray(from, from + 4), ((face.y + y) * resolution + face.x + x) * 4);
      }
  }
  return result;
}
export class SkinEditor {
  doc: SkinDocument;
  revision = 0;
  selection: Uint8Array | null = null;
  clipboard: SkinClipboard | null = null;
  private entries: Entry[] = [];
  private cursor = 0;
  private stroke?: {
    before: SkinDocument;
    start: SkinPoint;
    last: SkinPoint;
    brush: SkinBrush;
    face?: SkinFace;
    source: Uint8ClampedArray;
    touched: Map<number, number>;
    cloneOffset?: SkinPoint;
    shapeInterrupted?: boolean;
  };
  private cloneOrigin?: SkinPoint;
  private customStamp?: SkinClipboard;
  get hasStamp() {
    return !!this.customStamp;
  }
  getStampImage(): SkinImportImage | null {
    return this.customStamp
      ? {
          name: '自定义印章',
          width: this.customStamp.width,
          height: this.customStamp.height,
          pixels: encodePixels(this.customStamp.pixels),
        }
      : null;
  }
  setStampFromSelection() {
    this.copy();
    if (this.clipboard)
      this.customStamp = {
        ...this.clipboard,
        pixels: this.clipboard.pixels.slice(),
        mask: this.clipboard.mask.slice(),
      };
    this.revision++;
  }
  setStampImage(image: SkinImportImage) {
    const pixels = decodePixels(image.pixels);
    if (
      !Number.isInteger(image.width) ||
      !Number.isInteger(image.height) ||
      image.width < 1 ||
      image.height < 1 ||
      image.width > 256 ||
      image.height > 256 ||
      pixels.length !== image.width * image.height * 4
    )
      throw new Error('印章尺寸无效');
    this.customStamp = {
      width: image.width,
      height: image.height,
      pixels,
      mask: new Uint8Array(image.width * image.height).fill(1),
      x: 0,
      y: 0,
    };
    this.revision++;
  }
  constructor(
    project: SkinProject = createProject(),
    private historyLimit = 64 * 1024 ** 2,
  ) {
    this.doc = deserializeProject(project);
    this.record('初始状态');
  }
  get activeLayer() {
    return this.doc.layers.find((l) => l.id === this.doc.activeLayerId)!;
  }
  get canUndo() {
    return this.cursor > 0;
  }
  get canRedo() {
    return this.cursor < this.entries.length - 1;
  }
  serialize() {
    return serializeDocument(this.doc);
  }
  composite() {
    return compositeLayers(this.doc.layers, this.doc.resolution);
  }
  history() {
    return { labels: this.entries.map((e) => e.label), index: this.cursor };
  }
  private record(label: string) {
    this.entries.splice(this.cursor + 1);
    this.entries.push({
      doc: clone(this.doc),
      label,
      bytes: this.doc.layers.reduce((n, l) => n + l.pixels.byteLength, 0),
    });
    while (
      this.entries.length > 1 &&
      (this.entries.length > 100 ||
        this.entries.reduce((n, e) => n + e.bytes, 0) > this.historyLimit)
    )
      this.entries.shift();
    this.cursor = this.entries.length - 1;
    this.revision++;
  }
  private mutate(label: string, fn: () => void) {
    this.endStroke();
    const before = clone(this.doc),
      selection = this.selection?.slice() ?? null;
    try {
      fn();
    } catch (error) {
      this.doc = before;
      this.selection = selection;
      throw error;
    }
    this.record(label);
  }
  undo() {
    this.jumpHistory(this.cursor - 1);
  }
  redo() {
    this.jumpHistory(this.cursor + 1);
  }
  jumpHistory(index: number) {
    this.cancelStroke();
    if (index < 0 || index >= this.entries.length) return;
    this.cursor = index;
    this.doc = clone(this.entries[index].doc);
    this.selection = null;
    this.revision++;
  }
  setName(name: string) {
    if (name.trim() && name.trim().length <= 80)
      this.mutate('重命名', () => {
        this.doc.name = name.trim();
      });
  }
  setPalette(colors: string[]) {
    if (colors.length > 64 || colors.some((c) => !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(c)))
      throw new Error('色板无效');
    this.mutate('修改色板', () => {
      this.doc.palette = [...colors];
    });
  }
  setActiveLayer(id: string) {
    if (this.doc.layers.some((l) => l.id === id)) {
      this.endStroke();
      this.doc.activeLayerId = id;
      this.revision++;
    }
  }
  addLayer(name = '新图层') {
    if (this.doc.layers.length >= 16) throw new Error('最多 16 个图层');
    this.mutate('添加图层', () => {
      const l: RuntimeSkinLayer = {
        id: uid(),
        name,
        visible: true,
        locked: false,
        opacity: 1,
        blend: 'normal',
        alphaLock: false,
        pixels: new Uint8ClampedArray(this.doc.resolution ** 2 * 4),
      };
      this.doc.layers.splice(this.doc.layers.indexOf(this.activeLayer) + 1, 0, l);
      this.doc.activeLayerId = l.id;
    });
  }
  duplicateLayer() {
    this.batchLayers([this.doc.activeLayerId], 'duplicate');
  }
  deleteLayer() {
    if (this.doc.layers.length < 2) return;
    this.batchLayers([this.doc.activeLayerId], 'delete');
  }
  batchLayers(ids: string[], action: 'show' | 'hide' | 'lock' | 'unlock' | 'delete' | 'duplicate') {
    const selected = new Set(ids);
    if (!selected.size) return [];
    if ([...selected].some((id) => !this.doc.layers.some((layer) => layer.id === id)))
      throw new Error('所选图层不存在');
    const layers = this.doc.layers.filter((layer) => selected.has(layer.id));
    if (action === 'delete') {
      if (layers.some((layer) => layer.locked)) throw new Error('请先解锁图层');
      if (layers.length === this.doc.layers.length) throw new Error('至少保留一个图层');
    }
    if (action === 'duplicate' && this.doc.layers.length + layers.length > 16)
      throw new Error('最多 16 个图层');
    const labels = {
      show: '显示图层',
      hide: '隐藏图层',
      lock: '锁定图层',
      unlock: '解锁图层',
      delete: '删除图层',
      duplicate: '复制图层',
    };
    let result = [...selected];
    this.mutate(labels[action], () => {
      if (action === 'delete') {
        const activeIndex = this.doc.layers.indexOf(this.activeLayer);
        this.doc.layers = this.doc.layers.filter((layer) => !selected.has(layer.id));
        if (selected.has(this.doc.activeLayerId))
          this.doc.activeLayerId =
            this.doc.layers[Math.max(0, Math.min(this.doc.layers.length - 1, activeIndex - 1))].id;
        result = [];
      } else if (action === 'duplicate') {
        const copies = new Map(
          layers.map((layer) => [
            layer.id,
            {
              ...layer,
              id: uid(),
              name: (layer.name + ' 副本').slice(0, 80),
              pixels: layer.pixels.slice(),
            },
          ]),
        );
        this.doc.layers = this.doc.layers.flatMap((layer) => {
          const copy = copies.get(layer.id);
          return copy ? [layer, copy] : [layer];
        });
        result = [...copies.values()].map((layer) => layer.id);
        this.doc.activeLayerId =
          copies.get(this.doc.activeLayerId)?.id ?? result[result.length - 1];
      } else {
        for (const layer of layers) {
          if (action === 'show' || action === 'hide') layer.visible = action === 'show';
          else layer.locked = action === 'lock';
        }
      }
    });
    return result;
  }
  updateLayer(id: string, patch: Partial<Omit<RuntimeSkinLayer, 'pixels' | 'id'>>) {
    this.mutate('图层设置', () => {
      const l = this.doc.layers.find((l) => l.id === id);
      if (!l) return;
      if (patch.opacity !== undefined) patch.opacity = clamp(patch.opacity, 0, 1);
      if (patch.name !== undefined) patch.name = patch.name.trim().slice(0, 80) || l.name;
      Object.assign(l, patch);
    });
  }
  moveLayer(id: string, delta: number) {
    this.mutate('图层排序', () => {
      const i = this.doc.layers.findIndex((l) => l.id === id),
        j = clamp(i + delta, 0, this.doc.layers.length - 1);
      if (i < 0 || i === j) return;
      const [l] = this.doc.layers.splice(i, 1);
      this.doc.layers.splice(j, 0, l);
    });
  }
  mergeDown() {
    const i = this.doc.layers.indexOf(this.activeLayer);
    if (i < 1) return;
    if (this.activeLayer.locked || this.doc.layers[i - 1].locked) throw new Error('请先解锁图层');
    this.mutate('合并图层', () => {
      const below = this.doc.layers[i - 1],
        top = this.doc.layers[i];
      below.pixels = compositeLayers([below, top], this.doc.resolution);
      below.opacity = 1;
      below.blend = 'normal';
      below.visible = true;
      this.doc.layers.splice(i, 1);
      this.doc.activeLayerId = below.id;
    });
  }
  flatten() {
    if (this.doc.layers.some((l) => l.visible && l.locked)) throw new Error('请先解锁图层');
    if (!this.doc.layers.some((l) => l.visible)) return;
    this.mutate('合并可见图层', () => {
      const pixels = this.composite(),
        l = {
          ...this.activeLayer,
          id: uid(),
          name: '合并图层',
          pixels,
          visible: true,
          locked: false,
          alphaLock: false,
          opacity: 1,
          blend: 'normal' as const,
        };
      const at = this.doc.layers.findIndex((layer) => layer.visible),
        before = this.doc.layers.slice(0, at).filter((layer) => !layer.visible),
        after = this.doc.layers.slice(at).filter((layer) => !layer.visible);
      this.doc.layers = [...before, l, ...after];
      this.doc.activeLayerId = l.id;
    });
  }
  private writable() {
    if (this.activeLayer.locked) throw new Error('请先解锁图层');
    if (!this.activeLayer.visible) throw new Error('请先显示图层');
  }
  sample(x: number, y: number, merged = true): RGBA {
    const n = this.doc.resolution;
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= n || y >= n) return [0, 0, 0, 0];
    return rgba(merged ? this.composite() : this.activeLayer.pixels, (y * n + x) * 4);
  }
  cloneSource(point: SkinPoint) {
    this.cloneOrigin = { ...point };
  }
  beginStroke(point: SkinPoint, input: Partial<SkinBrush> = {}) {
    this.endStroke();
    this.writable();
    const brush = { ...defaultBrush, ...input };
    brush.size = clamp(Math.round(brush.size), 1, 64);
    brush.opacity = clamp(brush.opacity, 0, 1);
    brush.hardness = clamp(brush.hardness, 0, 1);
    brush.tolerance = clamp(brush.tolerance);
    this.stroke = {
      before: clone(this.doc),
      start: { ...point },
      last: { ...point },
      brush,
      face: brush.clipFace
        ? faceAt(point.x, point.y, this.doc.model, this.doc.resolution)
        : undefined,
      source: brush.sampleMerged ? this.composite() : this.activeLayer.pixels.slice(),
      touched: new Map(),
      cloneOffset: this.cloneOrigin
        ? { x: this.cloneOrigin.x - point.x, y: this.cloneOrigin.y - point.y }
        : undefined,
    };
    if (brush.tool === 'eyedropper') {
      this.stroke = undefined;
      return;
    }
    if (brush.tool === 'clone' && !this.cloneOrigin) {
      this.stroke = undefined;
      throw new Error('按住 Ctrl 点击设置克隆来源');
    }
    if (brush.tool === 'stamp' && !this.customStamp) {
      this.stroke = undefined;
      throw new Error('请先从选区或图片创建印章');
    }
    if (brush.tool === 'fill' || brush.tool === 'replace')
      this.fill(point, brush.tool === 'fill' && brush.contiguous);
    else this.moveStroke(point);
    this.revision++;
  }
  moveStroke(point: SkinPoint, discontinuous = false) {
    const s = this.stroke;
    if (!s) return;
    const { brush, start } = s;
    if (['fill', 'replace', 'eyedropper'].includes(brush.tool)) return;
    if (s.shapeInterrupted) return;
    // A 3D pointer crossing a cuboid edge jumps between unrelated atlas islands.
    if (discontinuous) {
      if (['line', 'rectangle', 'ellipse', 'gradient'].includes(brush.tool)) {
        s.shapeInterrupted = true;
        return;
      }
      s.last = { ...point };
    }
    if (['line', 'rectangle', 'ellipse', 'gradient'].includes(brush.tool)) {
      this.doc = clone(s.before);
      s.touched.clear();
      const x0 = Math.min(start.x, point.x),
        y0 = Math.min(start.y, point.y),
        x1 = Math.max(start.x, point.x),
        y1 = Math.max(start.y, point.y);
      if (brush.tool === 'line') line(start, point, (x, y) => this.stamp(x, y));
      else if (brush.tool === 'rectangle') {
        if (brush.filled) {
          for (let y = y0; y <= y1; y++)
            for (let x = x0; x <= x1; x++) this.paint(x, y, brush.color, brush.opacity);
        } else {
          line({ x: x0, y: y0 }, { x: x1, y: y0 }, (x, y) => this.stamp(x, y));
          line({ x: x1, y: y0 }, { x: x1, y: y1 }, (x, y) => this.stamp(x, y));
          line({ x: x1, y: y1 }, { x: x0, y: y1 }, (x, y) => this.stamp(x, y));
          line({ x: x0, y: y1 }, { x: x0, y: y0 }, (x, y) => this.stamp(x, y));
        }
      } else if (brush.tool === 'ellipse') {
        const rx = (x1 - x0 + 1) / 2,
          ry = (y1 - y0 + 1) / 2,
          cx = (x1 + x0) / 2,
          cy = (y1 + y0) / 2;
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const outer = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
            if (
              outer <= 1 &&
              (brush.filled ||
                rx <= 1 ||
                ry <= 1 ||
                ((x - cx) / Math.max(0.1, rx - brush.size)) ** 2 +
                  ((y - cy) / Math.max(0.1, ry - brush.size)) ** 2 >=
                  1)
            )
              this.paint(x, y, brush.color, brush.opacity);
          }
      } else {
        const n = this.doc.resolution,
          dx = point.x - start.x,
          dy = point.y - start.y,
          den = dx * dx + dy * dy || 1;
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++) {
            let t = clamp(((x - start.x) * dx + (y - start.y) * dy) / den, 0, 1);
            if (brush.gradientSteps >= 2) {
              const steps = clamp(Math.round(brush.gradientSteps), 2, 256);
              t = Math.round(t * (steps - 1)) / (steps - 1);
            }
            if (brush.dither) {
              const bayer = [
                [0, 8, 2, 10],
                [12, 4, 14, 6],
                [3, 11, 1, 9],
                [15, 7, 13, 5],
              ];
              t = t > bayer[y % 4][x % 4] / 16 ? 1 : 0;
            }
            this.paint(
              x,
              y,
              brush.color.map((v, i) => v * (1 - t) + brush.secondary[i] * t) as RGBA,
              brush.opacity,
            );
          }
      }
    } else line(s.last, point, (x, y) => this.stamp(x, y));
    s.last = { ...point };
    this.revision++;
  }
  endStroke() {
    if (!this.stroke) return;
    const before = this.stroke.before;
    const label = toolLabels[this.stroke.brush.tool];
    this.stroke = undefined;
    if (this.doc.layers.some((l, i) => l.pixels.some((v, n) => v !== before.layers[i].pixels[n])))
      this.record(label);
  }
  cancelStroke() {
    if (this.stroke) {
      this.doc = this.stroke.before;
      this.stroke = undefined;
      this.revision++;
    }
  }
  private paint(x: number, y: number, color: RGBA, opacity: number, mirror = true) {
    x = Math.floor(x);
    y = Math.floor(y);
    const n = this.doc.resolution,
      s = this.stroke;
    if (x < 0 || y < 0 || x >= n || y >= n || (this.selection && !this.selection[y * n + x]))
      return;
    if (
      s?.face &&
      (x < s.face.x ||
        y < s.face.y ||
        x >= s.face.x + s.face.width ||
        y >= s.face.y + s.face.height)
    )
      return;
    const i = (y * n + x) * 4,
      l = this.activeLayer;
    const erasing =
      s?.brush.tool === 'eraser' || (s?.brush.tool === 'sculpt' && s.brush.sculptMode === 'lower');
    if (l.alphaLock && erasing) return;
    const tonal = s?.brush.tool === 'lighten' || s?.brush.tool === 'darken';
    const preserveAlpha =
      l.alphaLock || tonal || (s?.brush.tool === 'gradient' && s.brush.preserveAlpha);
    if (preserveAlpha && !l.pixels[i + 3]) return;
    // Brush overlap does not accumulate alpha within one gesture; each pixel receives its maximum coverage.
    if (s) {
      const old = s.touched.get(i) ?? 0;
      if (opacity <= old) return;
      s.touched.set(i, opacity);
      l.pixels.set(s.before.layers.find((v) => v.id === l.id)!.pixels.subarray(i, i + 4), i);
    }
    const alpha = l.pixels[i + 3];
    if (tonal) {
      for (let c = 0; c < 3; c++)
        l.pixels[i + c] = l.pixels[i + c] * (1 - opacity) + color[c] * opacity;
    } else if (erasing) {
      l.pixels[i + 3] = alpha * (1 - opacity);
      if (!l.pixels[i + 3]) l.pixels.fill(0, i, i + 4);
    } else blendPixel(l.pixels, i, color, opacity);
    if (preserveAlpha) l.pixels[i + 3] = alpha;
    if (mirror && s?.brush.mirror !== 'none' && s) {
      const f = faceAt(x, y, this.doc.model, n);
      const mx = f ? f.x + f.width - 1 - (x - f.x) : x,
        my = f ? f.y + f.height - 1 - (y - f.y) : y;
      const targets =
        s.brush.mirror === 'faceXY'
          ? [
              { x: mx, y },
              { x, y: my },
              { x: mx, y: my },
            ]
          : [
              s.brush.mirror === 'faceX'
                ? { x: mx, y }
                : s.brush.mirror === 'faceY'
                  ? { x, y: my }
                  : s.brush.mirror === 'texture'
                    ? { x: n - 1 - x, y }
                    : mirroredPixel(x, y, this.doc.model, n),
            ];
      for (const target of targets)
        if (target.x !== x || target.y !== y) {
          const face = s.face;
          s.face = undefined;
          this.paint(target.x, target.y, color, opacity, false);
          s.face = face;
        }
    }
  }
  private stamp(x: number, y: number) {
    const s = this.stroke!;
    const b = s.brush,
      half = (b.size - 1) / 2,
      start = Math.floor(-half),
      end = Math.ceil(half),
      n = this.doc.resolution;
    if (b.tool === 'stamp' && this.customStamp) {
      const image = this.customStamp,
        rotate = b.stampRotation === 90 || b.stampRotation === 270;
      const w = rotate ? image.height : image.width,
        h = rotate ? image.width : image.height,
        scale = clamp(Math.round(b.stampScale), 1, 8);
      for (let py = 0; py < image.height; py++)
        for (let px = 0; px < image.width; px++) {
          if (!image.mask[py * image.width + px]) continue;
          let dx =
            b.stampRotation === 90
              ? w - 1 - py
              : b.stampRotation === 180
                ? w - 1 - px
                : b.stampRotation === 270
                  ? py
                  : px;
          let dy =
            b.stampRotation === 90
              ? px
              : b.stampRotation === 180
                ? h - 1 - py
                : b.stampRotation === 270
                  ? h - 1 - px
                  : py;
          if (b.stampFlipX) dx = w - 1 - dx;
          if (b.stampFlipY) dy = h - 1 - dy;
          const color = rgba(image.pixels, (py * image.width + px) * 4);
          if (!color[3]) continue;
          for (let iy = 0; iy < scale; iy++)
            for (let ix = 0; ix < scale; ix++)
              this.paint(
                x + dx * scale + ix - Math.floor((w * scale) / 2),
                y + dy * scale + iy - Math.floor((h * scale) / 2),
                color,
                b.opacity,
              );
        }
      return;
    }
    for (let dy = start; dy <= end; dy++)
      for (let dx = start; dx <= end; dx++) {
        if (dx - start >= b.size || dy - start >= b.size) continue;
        const center = start + (b.size - 1) / 2;
        const distance =
          b.shape === 'circle'
            ? Math.hypot(dx - center, dy - center) / (b.size / 2)
            : Math.max(Math.abs(dx - center), Math.abs(dy - center)) / (b.size / 2);
        if (b.shape === 'circle' && distance > 1) continue;
        const opacity =
          b.opacity *
          (distance <= b.hardness
            ? 1
            : Math.max(0, (1 - distance) / Math.max(0.001, 1 - b.hardness)));
        let color = b.color;
        const px = Math.floor(x + dx),
          py = Math.floor(y + dy),
          i = (py * n + px) * 4;
        if (px < 0 || py < 0 || px >= n || py >= n) continue;
        if (b.tool === 'lighten' || b.tool === 'darken') {
          color = rgba(s.source, i);
          color = color.map((v, c) =>
            c === 3 ? 255 : clamp(v + (b.tool === 'lighten' ? 20 : -20)),
          ) as RGBA;
        }
        if (b.tool === 'noise') {
          let hash =
            Math.imul(px + 1, 374761393) ^ Math.imul(py + 1, 668265263) ^ (b.noiseSeed | 0);
          hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
          hash ^= hash >>> 16;
          const noise = ((hash >>> 0) / 4294967295 - 0.5) * 510 * clamp(b.noiseStrength, 0, 1);
          color = b.color.map((v, c) => (c === 3 ? v : clamp(v + noise))) as RGBA;
          if (b.noisePalette && this.doc.palette.length) {
            const colors = this.doc.palette.map(
              (hex) =>
                [
                  parseInt(hex.slice(1, 3), 16),
                  parseInt(hex.slice(3, 5), 16),
                  parseInt(hex.slice(5, 7), 16),
                  color[3],
                ] as RGBA,
            );
            color = colors.reduce((best, current) =>
              current.slice(0, 3).reduce((sum, v, i) => sum + (v - color[i]) ** 2, 0) <
              best.slice(0, 3).reduce((sum, v, i) => sum + (v - color[i]) ** 2, 0)
                ? current
                : best,
            );
          }
        }
        if (b.tool === 'clone') {
          const sx = px + s.cloneOffset!.x,
            sy = py + s.cloneOffset!.y;
          if (sx < 0 || sy < 0 || sx >= n || sy >= n) continue;
          color = rgba(s.source, (sy * n + sx) * 4);
        }
        if (b.tool === 'sculpt') {
          const current = faceAt(px, py, this.doc.model, n);
          if (!current) continue;
          const faces = skinFaces(this.doc.model, n),
            base = faces.find(
              (f) => f.part === current.part && f.face === current.face && f.surface === 'base',
            )!,
            outer = faces.find(
              (f) => f.part === current.part && f.face === current.face && f.surface === 'outer',
            )!;
          const ox = px - current.x,
            oy = py - current.y;
          color = rgba(s.source, ((base.y + oy) * n + base.x + ox) * 4);
          const previous = s.face;
          s.face = undefined;
          this.paint(outer.x + ox, outer.y + oy, color, opacity);
          s.face = previous;
          continue;
        }
        this.paint(px, py, color, opacity);
      }
  }
  private matching(
    point: SkinPoint,
    tolerance: number,
    contiguous: boolean,
    pixels: Uint8ClampedArray,
    face?: SkinFace,
    topology?: Map<number, number[]>,
    respectSelection = false,
  ) {
    const n = this.doc.resolution,
      mask = new Uint8Array(n * n),
      x = Math.floor(point.x),
      y = Math.floor(point.y);
    if (x < 0 || y < 0 || x >= n || y >= n) return mask;
    const color = rgba(pixels, (y * n + x) * 4),
      valid = (p: number) => {
        const px = p % n,
          py = Math.floor(p / n);
        return (
          (!topology || topology.has(p)) &&
          (!respectSelection || !this.selection || !!this.selection[p]) &&
          (!face ||
            (px >= face.x &&
              py >= face.y &&
              px < face.x + face.width &&
              py < face.y + face.height)) &&
          colorsNear(rgba(pixels, p * 4), color, tolerance)
        );
      };
    if (!contiguous) {
      for (let p = 0; p < n * n; p++) if (valid(p)) mask[p] = 1;
      return mask;
    }
    const seen = new Uint8Array(n * n),
      stack = [y * n + x];
    while (stack.length) {
      const p = stack.pop()!;
      if (seen[p]) continue;
      seen[p] = 1;
      if (!valid(p)) continue;
      mask[p] = 1;
      if (topology) {
        stack.push(...(topology.get(p) ?? []));
        continue;
      }
      const px = p % n,
        py = Math.floor(p / n);
      if (px > 0) stack.push(p - 1);
      if (px < n - 1) stack.push(p + 1);
      if (py > 0) stack.push(p - n);
      if (py < n - 1) stack.push(p + n);
    }
    return mask;
  }
  private fill(point: SkinPoint, contiguous: boolean) {
    const s = this.stroke!,
      f = faceAt(point.x, point.y, this.doc.model, this.doc.resolution),
      face = s.face ?? (s.brush.fillScope === 'face' ? f : undefined),
      topology =
        !face && f && s.brush.fillScope === 'part'
          ? surfaceTopology(this.doc.model, this.doc.resolution, f.part, f.surface)
          : undefined,
      mask = this.matching(point, s.brush.tolerance, contiguous, s.source, face, topology, true),
      n = this.doc.resolution;
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) this.paint(i % n, Math.floor(i / n), s.brush.color, s.brush.opacity);
  }
  private setSelection(mask: Uint8Array, mode: SelectionMode) {
    if (mode === 'replace' || !this.selection) this.selection = mask;
    else
      for (let i = 0; i < mask.length; i++)
        this.selection[i] =
          mode === 'add' ? this.selection[i] || mask[i] : this.selection[i] && !mask[i] ? 1 : 0;
    this.revision++;
  }
  selectRect(a: SkinPoint, b: SkinPoint, mode: SelectionMode = 'replace') {
    const n = this.doc.resolution,
      mask = new Uint8Array(n * n);
    for (let y = Math.max(0, Math.min(a.y, b.y)); y <= Math.min(n - 1, Math.max(a.y, b.y)); y++)
      for (let x = Math.max(0, Math.min(a.x, b.x)); x <= Math.min(n - 1, Math.max(a.x, b.x)); x++)
        mask[y * n + x] = 1;
    this.setSelection(mask, mode);
  }
  selectPolygon(points: SkinPoint[], mode: SelectionMode = 'replace') {
    if (points.length < 3) return;
    const n = this.doc.resolution,
      mask = new Uint8Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const a = points[i],
            b = points[j];
          if (
            a.y > y + 0.5 !== b.y > y + 0.5 &&
            x + 0.5 < ((b.x - a.x) * (y + 0.5 - a.y)) / (b.y - a.y) + a.x
          )
            inside = !inside;
        }
        if (inside) mask[y * n + x] = 1;
      }
    this.setSelection(mask, mode);
  }
  selectWand(
    p: SkinPoint,
    tolerance = 0,
    contiguous = true,
    merged = true,
    mode: SelectionMode = 'replace',
  ) {
    this.setSelection(
      this.matching(p, tolerance, contiguous, merged ? this.composite() : this.activeLayer.pixels),
      mode,
    );
  }
  selectAll() {
    this.selection = new Uint8Array(this.doc.resolution ** 2).fill(1);
    this.revision++;
  }
  clearSelection() {
    this.selection = null;
    this.revision++;
  }
  invertSelection() {
    const n = this.doc.resolution;
    this.selection = Uint8Array.from(this.selection ?? new Uint8Array(n * n), (v) => (v ? 0 : 1));
    this.revision++;
  }
  selectFace(face: SkinFace) {
    this.selectRect(
      { x: face.x, y: face.y },
      { x: face.x + face.width - 1, y: face.y + face.height - 1 },
    );
  }
  private bounds() {
    const n = this.doc.resolution;
    let x: number = n,
      y: number = n,
      right = -1,
      bottom = -1;
    for (let i = 0; i < n * n; i++)
      if (!this.selection || this.selection[i]) {
        x = Math.min(x, i % n);
        y = Math.min(y, Math.floor(i / n));
        right = Math.max(right, i % n);
        bottom = Math.max(bottom, Math.floor(i / n));
      }
    return right < 0 ? null : { x, y, width: right - x + 1, height: bottom - y + 1 };
  }
  copy(cut = false) {
    const bounds = this.bounds();
    if (!bounds) return;
    const n = this.doc.resolution,
      pixels = new Uint8ClampedArray(bounds.width * bounds.height * 4),
      mask = new Uint8Array(bounds.width * bounds.height);
    for (let y = 0; y < bounds.height; y++)
      for (let x = 0; x < bounds.width; x++) {
        const p = (y + bounds.y) * n + x + bounds.x;
        if (!this.selection || this.selection[p]) {
          pixels.set(
            this.activeLayer.pixels.subarray(p * 4, p * 4 + 4),
            (y * bounds.width + x) * 4,
          );
          mask[y * bounds.width + x] = 1;
        }
      }
    this.clipboard = { ...bounds, pixels, mask };
    if (cut) this.clear();
    this.revision++;
  }
  paste() {
    if (!this.clipboard) return;
    this.writable();
    this.mutate('粘贴', () => this.place(this.clipboard!, this.clipboard!.x, this.clipboard!.y));
  }
  private place(clip: SkinClipboard, ox: number, oy: number) {
    const n = this.doc.resolution,
      mask = new Uint8Array(n * n);
    for (let y = 0; y < clip.height; y++)
      for (let x = 0; x < clip.width; x++) {
        const px = x + ox,
          py = y + oy;
        if (px < 0 || py < 0 || px >= n || py >= n || !clip.mask[y * clip.width + x]) continue;
        const i = (py * n + px) * 4;
        if (this.activeLayer.alphaLock) {
          const a = this.activeLayer.pixels[i + 3];
          if (!a) continue;
          this.activeLayer.pixels.set(
            clip.pixels.subarray((y * clip.width + x) * 4, (y * clip.width + x) * 4 + 4),
            i,
          );
          this.activeLayer.pixels[i + 3] = a;
        } else
          this.activeLayer.pixels.set(
            clip.pixels.subarray((y * clip.width + x) * 4, (y * clip.width + x) * 4 + 4),
            i,
          );
        mask[py * n + px] = 1;
      }
    this.selection = mask;
  }
  moveSelection(dx: number, dy: number) {
    this.writable();
    this.copy();
    if (!this.clipboard) return;
    const clip = this.clipboard;
    this.mutate('移动选区', () => {
      this.clearPixels();
      this.place(clip, clip.x + Math.round(dx), clip.y + Math.round(dy));
    });
  }
  transform(kind: 'flipX' | 'flipY' | 'rotateCW' | 'rotateCCW') {
    this.writable();
    this.copy();
    const source = this.clipboard;
    if (!source) return;
    this.mutate('变换选区', () => {
      const rotate = kind.startsWith('rotate'),
        w = rotate ? source.height : source.width,
        h = rotate ? source.width : source.height,
        pixels = new Uint8ClampedArray(w * h * 4),
        mask = new Uint8Array(w * h);
      for (let y = 0; y < source.height; y++)
        for (let x = 0; x < source.width; x++) {
          const dx =
              kind === 'flipX'
                ? w - 1 - x
                : kind === 'flipY'
                  ? x
                  : kind === 'rotateCW'
                    ? w - 1 - y
                    : y,
            dy =
              kind === 'flipY'
                ? h - 1 - y
                : kind === 'flipX'
                  ? y
                  : kind === 'rotateCW'
                    ? x
                    : h - 1 - x;
          pixels.set(
            source.pixels.subarray((y * source.width + x) * 4, (y * source.width + x) * 4 + 4),
            (dy * w + dx) * 4,
          );
          mask[dy * w + dx] = source.mask[y * source.width + x];
        }
      this.clearPixels();
      this.place({ ...source, width: w, height: h, pixels, mask }, source.x, source.y);
    });
  }
  private clearPixels() {
    const l = this.activeLayer;
    if (l.alphaLock) return;
    for (let i = 0; i < l.pixels.length; i += 4)
      if (!this.selection || this.selection[i / 4]) l.pixels.fill(0, i, i + 4);
  }
  clear() {
    this.writable();
    this.mutate('清除像素', () => this.clearPixels());
  }
  adjust(options: SkinAdjustment) {
    this.writable();
    this.mutate('颜色调整', () => {
      this.activeLayer.pixels = adjustedPixels(
        this.activeLayer.pixels,
        this.doc.resolution,
        options,
        this.selection,
        !!this.activeLayer.alphaLock,
      );
    });
  }
  previewAdjust(options: SkinAdjustment) {
    const pixels = adjustedPixels(
      this.activeLayer.pixels,
      this.doc.resolution,
      options,
      this.selection,
      !!this.activeLayer.alphaLock,
    );
    return compositeLayers(
      this.doc.layers.map((l) => (l.id === this.doc.activeLayerId ? { ...l, pixels } : l)),
      this.doc.resolution,
    );
  }
  inspect(scope: 'merged' | 'active' = 'merged') {
    return inspectSkin(
      scope === 'merged' ? this.composite() : this.activeLayer.pixels,
      this.doc.model,
      this.doc.resolution,
    );
  }
  fixSkin(
    options: { baseAlpha?: boolean; clearUnused?: boolean; outerBinaryAlpha?: boolean },
    color: RGBA = [255, 255, 255, 255],
  ) {
    this.writable();
    if (this.activeLayer.alphaLock) throw new Error('请先关闭透明度锁定');
    this.mutate('修复当前图层', () => {
      const mask = uvMask(this.doc.model, this.doc.resolution),
        pixels = this.activeLayer.pixels;
      for (let i = 0; i < mask.length; i++) {
        if (this.selection && !this.selection[i]) continue;
        if (options.clearUnused && !mask[i]) pixels.fill(0, i * 4, i * 4 + 4);
        else if (options.baseAlpha && mask[i] === 1 && pixels[i * 4 + 3] < 255) {
          if (!pixels[i * 4 + 3]) pixels.set(color, i * 4);
          pixels[i * 4 + 3] = 255;
        } else if (options.outerBinaryAlpha && mask[i] === 2) {
          pixels[i * 4 + 3] = pixels[i * 4 + 3] >= 128 ? 255 : 0;
          if (!pixels[i * 4 + 3]) pixels.fill(0, i * 4, i * 4 + 4);
        }
      }
    });
  }
  resize(resolution: SkinResolution) {
    if (![64, 128, 256].includes(resolution)) throw new Error('不支持的皮肤尺寸');
    this.mutate('调整分辨率', () => {
      for (const l of this.doc.layers)
        l.pixels = resizePixels(l.pixels, this.doc.resolution, resolution);
      this.doc.resolution = resolution;
      this.selection = null;
    });
  }
  convertModel(model: SkinModel) {
    if (model === this.doc.model) return;
    this.mutate('转换模型', () => {
      for (const layer of this.doc.layers)
        layer.pixels = convertModelPixels(layer.pixels, this.doc.resolution, this.doc.model, model);
      this.doc.model = model;
      this.selection = null;
    });
  }
  reinterpretModel(model: SkinModel) {
    if (model === this.doc.model) return;
    this.mutate('仅更换模型', () => {
      this.doc.model = model;
      this.selection = null;
    });
  }
  importImage(
    image: SkinImportImage,
    mode: 'replace' | 'layer' | 'part' = 'replace',
    part?: SkinPart,
    surface: 'base' | 'outer' | 'both' = 'both',
    newLayer = false,
    sourceModel?: SkinModel,
  ) {
    let pixels = decodePixels(image.pixels),
      resolution = image.width as SkinResolution;
    if (
      ![64, 128, 256].includes(image.width) ||
      ![image.width, image.width / 2].includes(image.height) ||
      pixels.length !== image.width * image.height * 4
    )
      throw new Error('皮肤像素尺寸无效');
    const legacy = image.height === image.width / 2,
      importedModel = sourceModel ?? (legacy ? 'classic' : this.doc.model);
    if (legacy) {
      pixels = upgradeLegacy(pixels, resolution);
      if (importedModel !== 'classic')
        pixels = convertModelPixels(pixels, resolution, 'classic', importedModel);
    }
    if (mode !== 'replace' && resolution !== this.doc.resolution) {
      pixels = resizePixels(pixels, resolution, this.doc.resolution);
      resolution = this.doc.resolution;
    }
    if (mode !== 'replace' && importedModel !== this.doc.model)
      pixels = convertModelPixels(pixels, resolution, importedModel, this.doc.model);
    if ((mode === 'layer' || newLayer) && this.doc.layers.length >= 16)
      throw new Error('最多 16 个图层');
    if (mode === 'part' && !newLayer) this.writable();
    this.mutate('导入皮肤', () => {
      if (mode === 'replace') {
        const project = createProject(
          image.name.slice(0, 80) || '导入皮肤',
          resolution,
          importedModel,
        );
        this.doc = deserializeProject(project);
        this.activeLayer.pixels = pixels;
        this.selection = null;
      } else if (mode === 'layer') {
        const l = {
          ...this.activeLayer,
          id: uid(),
          name: image.name.slice(0, 80) || '导入图层',
          pixels,
          visible: true,
          locked: false,
          alphaLock: false,
          opacity: 1,
          blend: 'normal' as const,
        };
        this.doc.layers.push(l);
        this.doc.activeLayerId = l.id;
      } else if (part) {
        const n = this.doc.resolution;
        if (newLayer) {
          const l: RuntimeSkinLayer = {
            id: uid(),
            name: (image.name + ' · ' + part).slice(0, 80),
            visible: true,
            locked: false,
            opacity: 1,
            blend: 'normal',
            alphaLock: false,
            pixels: new Uint8ClampedArray(n * n * 4),
          };
          this.doc.layers.push(l);
          this.doc.activeLayerId = l.id;
        }
        for (const f of skinFaces(this.doc.model, n).filter(
          (f) => f.part === part && (surface === 'both' || f.surface === surface),
        ))
          for (let y = f.y; y < f.y + f.height; y++)
            for (let x = f.x; x < f.x + f.width; x++) {
              const i = (y * n + x) * 4;
              if (this.activeLayer.alphaLock) {
                if (!this.activeLayer.pixels[i + 3]) continue;
                const a = this.activeLayer.pixels[i + 3];
                this.activeLayer.pixels.set(pixels.subarray(i, i + 4), i);
                this.activeLayer.pixels[i + 3] = a;
              } else this.activeLayer.pixels.set(pixels.subarray(i, i + 4), i);
            }
      }
    });
  }
}
export const toolLabels: Record<SkinBrush['tool'], string> = {
  pencil: '画笔',
  eraser: '橡皮',
  eyedropper: '吸管',
  fill: '填充',
  replace: '替换颜色',
  line: '直线',
  rectangle: '矩形',
  ellipse: '椭圆',
  gradient: '渐变',
  noise: '噪点',
  lighten: '提亮',
  darken: '加深',
  clone: '克隆',
  sculpt: '雕刻',
  stamp: '印章',
};
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = !d ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h / 6 + 1) % 1, max ? d / max : 0, max];
}
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const sector = Math.floor(h * 6),
    f = h * 6 - sector,
    p = v * (1 - s),
    q = v * (1 - f * s),
    t = v * (1 - (1 - f) * s);
  return [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][sector % 6] as [number, number, number];
}
export function upgradeLegacy(pixels: Uint8ClampedArray, resolution: SkinResolution = 64) {
  if (pixels.length !== ((resolution * resolution) / 2) * 4)
    throw new Error('旧版皮肤像素尺寸无效');
  const out = new Uint8ClampedArray(resolution ** 2 * 4);
  out.set(pixels);
  const faces = skinFaces('classic', resolution);
  // Very old PNG skins used an entirely opaque unused upper-right rectangle.
  // Java treats that as absence of a hat, then forces the actual body faces opaque.
  let opaqueHat = true;
  for (let y = 0; y < resolution / 2; y++)
    for (let x = resolution / 2; x < resolution; x++)
      if (pixels[(y * resolution + x) * 4 + 3] < 128) opaqueHat = false;
  if (opaqueHat)
    for (let y = 0; y < resolution / 2; y++)
      for (let x = resolution / 2; x < resolution; x++) out[(y * resolution + x) * 4 + 3] = 0;
  for (const part of ['rightArm', 'rightLeg'] as const) {
    const target = part === 'rightArm' ? 'leftArm' : 'leftLeg';
    for (const f of faces.filter((f) => f.part === part && f.surface === 'base')) {
      const mirrorFace = f.face === 'left' ? 'right' : f.face === 'right' ? 'left' : f.face;
      const t = faces.find(
        (t) => t.part === target && t.surface === 'base' && t.face === mirrorFace,
      )!;
      for (let y = 0; y < f.height; y++)
        for (let x = 0; x < f.width; x++) {
          const i = ((f.y + y) * resolution + f.x + x) * 4;
          out.set(pixels.subarray(i, i + 4), ((t.y + y) * resolution + t.x + t.width - 1 - x) * 4);
        }
    }
  }
  for (const f of faces.filter((f) => f.surface === 'base'))
    for (let y = f.y; y < f.y + f.height; y++)
      for (let x = f.x; x < f.x + f.width; x++) out[(y * resolution + x) * 4 + 3] = 255;
  return out;
}
