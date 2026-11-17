import { setImmediate } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { Work } from './tasks';
import { decodeSkinEditorImage } from './skin-editor';
import { checkGamePath } from './game-folders';
import { safeExport } from './safe-export';
export async function exportSkinAnimation(
  frames: string[],
  seconds: number,
  destination: string,
  work: Work,
) {
  if (
    frames.length < 2 ||
    frames.length > 120 ||
    !Number.isFinite(seconds) ||
    seconds < 0.2 ||
    seconds > 30 ||
    frames.reduce((n, f) => n + f.length, 0) > 48 * 1024 ** 2
  )
    throw new Error('动画参数超限');
  await checkGamePath(destination, true);
  const gif = GIFEncoder();
  let width = 0,
    height = 0;
  for (const [i, frame] of frames.entries()) {
    work.signal.throwIfAborted();
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(frame)) throw new Error('动画帧格式无效');
    const image = decodeSkinEditorImage(Buffer.from(frame.slice(22), 'base64'), '动画帧', 'image');
    if (
      image.width > 1024 ||
      image.height > 1024 ||
      image.width * image.height * 4 * frames.length > 128 * 1024 ** 2
    )
      throw new Error('动画尺寸超限');
    if (!i) {
      width = image.width;
      height = image.height;
    }
    if (image.width !== width || image.height !== height) throw new Error('动画帧尺寸不一致');
    // gifenc reads the complete backing buffer; Node Buffers may share a larger pool.
    const rgba = Uint8Array.from(Buffer.from(image.pixels, 'base64'));
    const palette = quantize(rgba, 256, { format: 'rgba4444', oneBitAlpha: true });
    const indexed = applyPalette(rgba, palette, 'rgba4444');
    const transparentIndex = palette.findIndex((p) => p[3] === 0);
    gif.writeFrame(indexed, width, height, {
      palette,
      delay: (seconds * 1000) / frames.length,
      repeat: 0,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: 2,
    });
    work.progress(Math.round(((i + 1) / frames.length) * 95), `编码 ${i + 1}/${frames.length}`);
    await setImmediate();
  }
  gif.finish();
  work.signal.throwIfAborted();
  await safeExport(destination, async (temporary) => {
    work.signal.throwIfAborted();
    await writeFile(temporary, gif.bytes(), { flag: 'wx' });
    work.signal.throwIfAborted();
  });
  work.progress(100, '动画已导出');
}
