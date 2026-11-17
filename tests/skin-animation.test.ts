import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PNG } from 'pngjs';
import { exportSkinAnimation } from '../electron/core/skin-animation';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-skin-animation-'));
  roots.push(root);
  return { root, file: path.join(root, 'pose.gif') };
}
function frame(width = 4, height = 3, green = false) {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      image.data.set(
        green ? [0, 255, 0, 255] : x % 2 ? [255, 0, 0, 255] : [0, 0, 0, 0],
        (y * width + x) * 4,
      );
  return 'data:image/png;base64,' + PNG.sync.write(image).toString('base64');
}
function work(controller = new AbortController()) {
  return { signal: controller.signal, progress: vi.fn() };
}

// Independent GIF89a block/LZW decoder for exported bytes, not gifenc's encoder internals.
function decodeGif(buffer: Buffer) {
  expect(buffer.toString('ascii', 0, 6)).toBe('GIF89a');
  const width = buffer.readUInt16LE(6),
    height = buffer.readUInt16LE(8),
    packed = buffer[10];
  let offset = 13;
  const palette = (count: number) => {
    const bytes = buffer.subarray(offset, offset + count * 3);
    offset += count * 3;
    return bytes;
  };
  const globalPalette = packed & 128 ? palette(1 << ((packed & 7) + 1)) : Buffer.alloc(0);
  const blocks = () => {
    const pieces: Buffer[] = [];
    while (buffer[offset]) {
      const size = buffer[offset++];
      pieces.push(buffer.subarray(offset, offset + size));
      offset += size;
    }
    offset++;
    return Buffer.concat(pieces);
  };
  let delay = 0,
    transparent = -1,
    disposal = 0;
  const frames: {
    width: number;
    height: number;
    delay: number;
    disposal: number;
    pixels: number[][];
  }[] = [];
  while (offset < buffer.length && buffer[offset] !== 0x3b) {
    const block = buffer[offset++];
    if (block === 0x21) {
      const label = buffer[offset++];
      if (label === 0xf9) {
        expect(buffer[offset++]).toBe(4);
        const flags = buffer[offset++];
        delay = buffer.readUInt16LE(offset) * 10;
        offset += 2;
        transparent = flags & 1 ? buffer[offset] : -1;
        disposal = (flags >> 2) & 7;
        offset += 2;
      } else blocks();
      continue;
    }
    expect(block).toBe(0x2c);
    const w = buffer.readUInt16LE(offset + 4),
      h = buffer.readUInt16LE(offset + 6),
      flags = buffer[offset + 8];
    offset += 9;
    const colors = flags & 128 ? palette(1 << ((flags & 7) + 1)) : globalPalette;
    const min = buffer[offset++],
      data = blocks(),
      clear = 1 << min,
      end = clear + 1;
    let bits = min + 1,
      bit = 0,
      next = clear + 2,
      dictionary: number[][] = [],
      previous: number[] | undefined;
    const reset = () => {
      dictionary = Array.from({ length: clear }, (_, i) => [i]);
      dictionary[clear] = [];
      dictionary[end] = [];
      bits = min + 1;
      next = clear + 2;
      previous = undefined;
    };
    reset();
    const indices: number[] = [];
    while (bit + bits <= data.length * 8) {
      let code = 0;
      for (let i = 0; i < bits; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
      if (code === clear) {
        reset();
        continue;
      }
      if (code === end) break;
      const entry =
        dictionary[code] ?? (code === next && previous ? [...previous, previous[0]] : undefined);
      if (!entry) throw new Error('Invalid GIF LZW stream');
      indices.push(...entry);
      if (previous) {
        dictionary[next++] = [...previous, entry[0]];
        if (next === 1 << bits && bits < 12) bits++;
      }
      previous = entry;
    }
    expect(indices).toHaveLength(w * h);
    frames.push({
      width: w,
      height: h,
      delay,
      disposal,
      pixels: indices.map((index) => [
        colors[index * 3],
        colors[index * 3 + 1],
        colors[index * 3 + 2],
        index === transparent ? 0 : 255,
      ]),
    });
  }
  expect(buffer[offset]).toBe(0x3b);
  return { width, height, frames };
}
it('writes independently decodable GIF frames with dimensions, timing, disposal and transparency', async () => {
  const { file } = await fixture(),
    ctx = work();
  await exportSkinAnimation([frame(), frame(4, 3, true)], 1, file, ctx);
  const gif = decodeGif(await readFile(file));
  expect([gif.width, gif.height]).toEqual([4, 3]);
  expect(gif.frames).toHaveLength(2);
  expect(gif.frames.map((f) => f.delay)).toEqual([500, 500]);
  expect(gif.frames.map((f) => f.disposal)).toEqual([2, 2]);
  expect(gif.frames[0].pixels[0][3]).toBe(0);
  expect(gif.frames[0].pixels[1]).toEqual([255, 0, 0, 255]);
  expect(gif.frames[1].pixels.every((pixel) => pixel[1] === 255 && pixel[3] === 255)).toBe(true);
  expect(ctx.progress).toHaveBeenLastCalledWith(100, '动画已导出');
});
it('cancels while encoding without publishing a partial GIF or leaving staging files', async () => {
  const { root, file } = await fixture(),
    controller = new AbortController(),
    ctx = work(controller);
  ctx.progress.mockImplementation(() => controller.abort());
  await expect(exportSkinAnimation([frame(), frame()], 1, file, ctx)).rejects.toThrow();
  expect(await readdir(root)).toEqual([]);
});
it('rejects invalid frames, mismatched dimensions and excessive dimensions', async () => {
  const { root, file } = await fixture();
  await expect(
    exportSkinAnimation(['data:image/png;base64,AAAA', frame()], 1, file, work()),
  ).rejects.toThrow();
  await expect(exportSkinAnimation([frame(), frame(5, 3)], 1, file, work())).rejects.toThrow(
    '尺寸不一致',
  );
  await expect(
    exportSkinAnimation([frame(1025, 1), frame(1025, 1)], 1, file, work()),
  ).rejects.toThrow('尺寸超限');
  await expect(exportSkinAnimation([frame()], 1, file, work())).rejects.toThrow('参数超限');
  await expect(exportSkinAnimation([frame(), frame()], NaN, file, work())).rejects.toThrow(
    '参数超限',
  );
  expect(await readdir(root)).toEqual([]);
});
it('does not replace an existing export', async () => {
  const { root, file } = await fixture();
  await writeFile(file, 'previous');
  await expect(exportSkinAnimation([frame(), frame()], 1, file, work())).rejects.toThrow();
  expect(await readFile(file, 'utf8')).toBe('previous');
  expect(await readdir(root)).toEqual(['pose.gif']);
});
