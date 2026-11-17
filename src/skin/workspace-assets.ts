import type { RGBA, SkinImportImage } from '../../shared/skin';
import { decodePixels, encodePixels } from '../../shared/skin-pixels';

export interface ReferenceTransform {
  zoom: number;
  x: number;
  y: number;
}
export interface ImageSize {
  width: number;
  height: number;
}
export const referenceFit = (image: ImageSize, view: ImageSize) =>
  Math.min(view.width / image.width, view.height / image.height) * 0.94;

/** Nearest-neighbor resizing preserves pixel colors and alpha for editable assets. */
export function fitWorkspaceImage(image: SkinImportImage, maximum = 512): SkinImportImage {
  if (
    !Number.isInteger(maximum) ||
    maximum < 1 ||
    maximum > 512 ||
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width > 2048 ||
    image.height > 2048
  )
    throw new Error('素材尺寸无效');
  const source = decodePixels(image.pixels);
  if (source.length !== image.width * image.height * 4) throw new Error('素材像素尺寸不匹配');
  const ratio = Math.min(1, maximum / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * ratio)),
    height = Math.max(1, Math.round(image.height * ratio));
  const result = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index =
        (Math.min(image.height - 1, Math.floor((y * image.height) / height)) * image.width +
          Math.min(image.width - 1, Math.floor((x * image.width) / width))) *
        4;
      result.set(source.subarray(index, index + 4), (y * width + x) * 4);
    }
  return {
    name: image.name.trim().slice(0, 80) || '未命名素材',
    width,
    height,
    pixels: encodePixels(result),
  };
}

export function referenceImagePoint(
  point: { x: number; y: number },
  image: ImageSize,
  view: ImageSize,
  transform: ReferenceTransform,
) {
  const scale = referenceFit(image, view) * transform.zoom;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const x = Math.floor((point.x - view.width / 2 - transform.x) / scale + image.width / 2);
  const y = Math.floor((point.y - view.height / 2 - transform.y) / scale + image.height / 2);
  return x < 0 || y < 0 || x >= image.width || y >= image.height ? null : { x, y };
}

export function zoomReference(
  transform: ReferenceTransform,
  requested: number,
  anchor: { x: number; y: number },
  view: ImageSize,
): ReferenceTransform {
  const zoom = Math.max(0.125, Math.min(16, requested)),
    ratio = zoom / transform.zoom;
  return {
    zoom,
    x: anchor.x - view.width / 2 - (anchor.x - view.width / 2 - transform.x) * ratio,
    y: anchor.y - view.height / 2 - (anchor.y - view.height / 2 - transform.y) * ratio,
  };
}

export function sampleReference(
  pixels: Uint8ClampedArray,
  image: ImageSize,
  point: { x: number; y: number },
): RGBA {
  if (
    !Number.isInteger(point.x) ||
    !Number.isInteger(point.y) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x >= image.width ||
    point.y >= image.height ||
    pixels.length !== image.width * image.height * 4
  )
    throw new Error('采样位置无效');
  const index = (point.y * image.width + point.x) * 4;
  return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
}
