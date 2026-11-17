import * as THREE from 'three';
import { Identifier, type TextureAtlasProvider, type UV, type Quad } from 'deepslate/render';
import type { ProjectionAssets } from '../../shared/projection-assets';

interface Sprite {
  id: string;
  image: ImageBitmap;
  x: number;
  y: number;
  w: number;
  h: number;
  frames: { index: number; time: number }[];
  duration: number;
  frame: number;
  translucent: boolean;
  cutout: boolean;
}
const power2 = (n: number) => 2 ** Math.ceil(Math.log2(n));

/** Only packs images; all Minecraft geometry and UV interpretation is provided by Deepslate. */
export class ProjectionAtlas implements TextureAtlasProvider {
  readonly texture: THREE.CanvasTexture;
  readonly missing = new Set<string>();
  private used = new Set<string>();
  private materialCache = new Map<string, 'solid' | 'cutout' | 'transparent'>();
  private constructor(
    private canvas: HTMLCanvasElement,
    private sprites: Map<string, Sprite>,
  ) {
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.flipY = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
  }
  getTextureAtlas() {
    return this.canvas.getContext('2d')!.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }
  getPixelSize() {
    return 1 / this.canvas.width;
  }
  getTextureUV(id: Identifier): UV {
    this.used.add(id.toString());
    const s = this.sprites.get(id.toString());
    if (!s && id.toString() !== 'kjmcl:missing') this.missing.add(id.toString());
    return s
      ? [
          s.x / this.canvas.width,
          s.y / this.canvas.height,
          (s.x + s.w) / this.canvas.width,
          (s.y + s.h) / this.canvas.height,
        ]
      : [0, 0, 16 / this.canvas.width, 16 / this.canvas.height];
  }
  material(quad: Quad): 'solid' | 'cutout' | 'transparent' {
    const uv = quad.v1.textureLimit;
    if (!uv) return 'solid';
    const key = uv.join(',');
    const cached = this.materialCache.get(key);
    if (cached) return cached;
    const u = ((uv[0] + uv[2]) / 2) * this.canvas.width;
    const v = ((uv[1] + uv[3]) / 2) * this.canvas.height;
    const s = [...this.sprites.values()].find(
      (s) => u >= s.x && u <= s.x + s.w && v >= s.y && v <= s.y + s.h,
    );
    const result = s?.translucent ? 'transparent' : s?.cutout ? 'cutout' : 'solid';
    this.materialCache.set(key, result);
    return result;
  }
  animate(timeMs: number): boolean {
    let changed = false;
    for (const s of this.sprites.values()) {
      if (s.frames.length < 2 || !this.used.has(s.id)) continue;
      let time = Math.floor(timeMs / 50) % s.duration;
      let frame = s.frames[0].index;
      for (const f of s.frames) {
        frame = f.index;
        if (time < f.time) break;
        time -= f.time;
      }
      if (frame !== s.frame) {
        s.frame = frame;
        this.paint(s);
        changed = true;
      }
    }
    if (changed) this.texture.needsUpdate = true;
    return changed;
  }
  private paint(s: Sprite) {
    const ctx = this.canvas.getContext('2d')!;
    const cols = Math.max(1, Math.floor(s.image.width / s.w));
    ctx.clearRect(s.x, s.y, s.w, s.h);
    ctx.drawImage(
      s.image,
      (s.frame % cols) * s.w,
      Math.floor(s.frame / cols) * s.h,
      s.w,
      s.h,
      s.x,
      s.y,
      s.w,
      s.h,
    );
  }
  dispose() {
    this.texture.dispose();
    for (const s of this.sprites.values()) s.image.close();
  }
  static async create(assets: ProjectionAssets): Promise<ProjectionAtlas> {
    const sprites = new Map<string, Sprite>();
    try {
      for (const [id, data] of Object.entries(assets.textures)) {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const meta = (
          assets.animations?.[id] as
            | {
                animation?: {
                  width?: number;
                  height?: number;
                  frametime?: number;
                  frames?: (number | { index: number; time?: number })[];
                };
              }
            | undefined
        )?.animation;
        const w = meta
          ? (meta.width ?? (meta.height ? image.width : Math.min(image.width, image.height)))
          : image.width;
        const h = meta
          ? (meta.height ?? (meta.width ? image.height : Math.min(image.width, image.height)))
          : image.height;
        if (w < 1 || h < 1 || w > image.width || h > image.height || w > 2048 || h > 2048) {
          image.close();
          throw new Error('贴图尺寸无效');
        }
        const count = Math.floor(image.width / w) * Math.floor(image.height / h);
        const frames = (meta?.frames ?? Array.from({ length: meta ? count : 1 }, (_, i) => i))
          .map((f) => ({
            index: typeof f === 'number' ? f : f.index,
            time: Math.max(
              1,
              typeof f === 'number' ? (meta?.frametime ?? 1) : (f.time ?? meta?.frametime ?? 1),
            ),
          }))
          .filter((f) => f.index >= 0 && f.index < count);
        if (!frames.length) frames.push({ index: 0, time: 1 });
        const sample = document.createElement('canvas');
        sample.width = image.width;
        sample.height = image.height;
        const ctx = sample.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(image, 0, 0);
        const rgba = ctx.getImageData(0, 0, image.width, image.height).data;
        let translucent = false,
          cutout = false;
        for (let i = 3; i < rgba.length; i += 4) {
          if (rgba[i] === 0) cutout = true;
          else if (rgba[i] < 255) translucent = true;
        }
        sprites.set(id, {
          id,
          image,
          w,
          h,
          x: 0,
          y: 0,
          frames,
          duration: frames.reduce((n, f) => n + f.time, 0),
          frame: frames[0].index,
          translucent,
          cutout,
        });
      }
      const ordered = [...sprites.values()].sort((a, b) => b.h - a.h);
      const area = ordered.reduce((n, s) => n + (s.w + 2) * (s.h + 2), 18 * 18);
      const width = Math.min(
        8192,
        power2(Math.max(64, Math.sqrt(area) * 1.2, ...ordered.map((s) => s.w + 2))),
      );
      let x = 18,
        y = 0,
        row = 18;
      for (const s of ordered) {
        if (x + s.w + 2 > width) {
          x = 0;
          y += row;
          row = 0;
        }
        s.x = x + 1;
        s.y = y + 1;
        x += s.w + 2;
        row = Math.max(row, s.h + 2);
      }
      const height = power2(y + row);
      if (height > 8192) throw new Error('贴图图集过大');
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 16, 16);
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(0, 0, 8, 8);
      ctx.fillRect(8, 8, 8, 8);
      const atlas = new ProjectionAtlas(canvas, sprites);
      for (const s of sprites.values()) atlas.paint(s);
      atlas.texture.needsUpdate = true;
      return atlas;
    } catch (error) {
      for (const s of sprites.values()) s.image.close();
      throw error;
    }
  }
}
