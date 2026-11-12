import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { open, mkdir, lstat, realpath, writeFile, rm } from 'node:fs/promises';
import { appearanceControlsSchema, appearanceSchema } from '../../shared/schema';
import type { Appearance } from '../../shared/types';
import type { Store } from './store';

const maxBytes = 20 * 1024 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const invalid = () => new Error('请选择有效的 PNG 或 JPEG 图片');

function checkSize(width: number, height: number) {
  if (width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 32_000_000)
    throw new Error('图片尺寸过大，请使用不超过 3200 万像素的图片');
  return { width, height };
}

// Inspect dimensions before native decoding so compressed images cannot allocate unbounded memory.
export function backgroundDimensions(data: Buffer) {
  if (data.length > maxBytes) throw new Error('背景图片不能超过 20 MiB');
  if (
    data.length >= 33 &&
    data.subarray(0, 8).equals(pngSignature) &&
    data.toString('ascii', 12, 16) === 'IHDR'
  )
    return checkSize(data.readUInt32BE(16), data.readUInt32BE(20));
  if (data[0] === 255 && data[1] === 216) {
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset++] !== 255) throw invalid();
      while (data[offset] === 255) offset++;
      const marker = data[offset++];
      if (marker === 217 || marker === 218 || offset + 2 > data.length) break;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) throw invalid();
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) throw invalid();
        return checkSize(data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3));
      }
      offset += length;
    }
  }
  throw invalid();
}

interface DecodedImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: { width: number; height: number; quality: 'best' }): DecodedImage;
  toPNG(): Buffer;
}

async function boundedRead(file: string) {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw invalid();
    if (stat.size > maxBytes) throw new Error('背景图片不能超过 20 MiB');
    const data = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await handle.read(data, 0, data.length, 0);
    if (bytesRead !== stat.size) throw new Error('图片已更改，请重新选择');
    return data.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export class AppearanceManager {
  private busy = false;
  private cache?: { id: string; data: string };
  constructor(
    private store: Store,
    private decode: (data: Buffer) => DecodedImage,
  ) {}

  private async directory() {
    const directory = path.join(this.store.root, 'appearance');
    await mkdir(directory, { recursive: true });
    if ((await lstat(directory)).isSymbolicLink() || (await realpath(directory)) !== directory)
      throw new Error('背景目录已被替换');
    return directory;
  }

  async image() {
    const id = appearanceSchema.parse(this.store.data.appearance).backgroundId;
    if (!id) return null;
    if (this.cache?.id === id) return this.cache.data;
    try {
      const file = path.join(await this.directory(), id + '.png');
      if ((await lstat(file)).isSymbolicLink()) throw new Error('背景图片不能是符号链接');
      const bytes = await boundedRead(file);
      backgroundDimensions(bytes);
      if (!bytes.subarray(0, 8).equals(pngSignature)) throw invalid();
      // Revalidate managed files after restart; do not pass arbitrary modified files to Chromium.
      const decoded = this.decode(bytes);
      if (decoded.isEmpty()) throw invalid();
      const { width, height } = decoded.getSize();
      checkSize(width, height);
      this.cache = { id, data: 'data:image/png;base64,' + bytes.toString('base64') };
      return this.cache.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async import(file: string) {
    if (this.busy) throw new Error('正在更新背景，请稍候');
    this.busy = true;
    try {
      const data = await boundedRead(file);
      backgroundDimensions(data);
      let decoded = this.decode(data);
      if (decoded.isEmpty()) throw invalid();
      const { width, height } = decoded.getSize();
      checkSize(width, height);
      const ratio = Math.min(1, 2560 / Math.max(width, height));
      if (ratio < 1)
        decoded = decoded.resize({
          width: Math.max(1, Math.round(width * ratio)),
          height: Math.max(1, Math.round(height * ratio)),
          quality: 'best',
        });
      const bytes = decoded.toPNG();
      backgroundDimensions(bytes);
      const id = randomUUID(),
        directory = await this.directory();
      await writeFile(path.join(directory, id + '.png'), bytes, { flag: 'wx' });
      const previous = this.store.data.appearance;
      this.store.data.appearance = { ...previous, backgroundId: id };
      try {
        this.store.save();
      } catch (error) {
        this.store.data.appearance = previous;
        await rm(path.join(directory, id + '.png'), { force: true });
        throw error;
      }
      this.cache = { id, data: 'data:image/png;base64,' + bytes.toString('base64') };
      if (previous.backgroundId)
        await rm(path.join(directory, previous.backgroundId + '.png'), { force: true }).catch(
          () => {},
        );
    } finally {
      this.busy = false;
    }
  }

  async reset() {
    if (this.busy) throw new Error('正在更新背景，请稍候');
    this.busy = true;
    try {
      const previous = appearanceSchema.parse(this.store.data.appearance);
      this.store.data.appearance = { dim: previous.dim, blur: previous.blur };
      try {
        this.store.save();
      } catch (error) {
        this.store.data.appearance = previous;
        throw error;
      }
      this.cache = undefined;
      if (previous.backgroundId) {
        const directory = await this.directory();
        await rm(path.join(directory, previous.backgroundId + '.png'), { force: true });
      }
    } finally {
      this.busy = false;
    }
  }

  update(value: Pick<Appearance, 'dim' | 'blur'>) {
    const previous = this.store.data.appearance;
    this.store.data.appearance = { ...previous, ...appearanceControlsSchema.parse(value) };
    try {
      this.store.save();
    } catch (error) {
      this.store.data.appearance = previous;
      throw error;
    }
  }
}
