import { describe, expect, it } from 'vitest';
import { decodePixels, encodePixels } from '../shared/skin-pixels';
import { skinWorkspaceSchema, emptyWorkspace } from '../shared/skin-workspace';
import { skinProjectSchema } from '../shared/skin-schema';
import {
  fitWorkspaceImage,
  referenceFit,
  referenceImagePoint,
  sampleReference,
  zoomReference,
} from '../src/skin/workspace-assets';

describe('persistent reference and stamp assets', () => {
  it('bounds a large rectangular reference to 512 pixels while retaining aspect ratio and exact sampled RGBA', () => {
    const data = new Uint8ClampedArray(2048 * 1024 * 4);
    for (let y = 0; y < 1024; y++)
      for (let x = 0; x < 2048; x++)
        data.set([x % 256, y % 256, 211, (x + y) % 256], (y * 2048 + x) * 4);
    const image = fitWorkspaceImage({
      name: ' 大图 ',
      width: 2048,
      height: 1024,
      pixels: encodePixels(data),
    });
    expect([image.name, image.width, image.height]).toEqual(['大图', 512, 256]);
    const result = decodePixels(image.pixels);
    expect(sampleReference(result, image, { x: 20, y: 30 })).toEqual([80, 120, 211, 200]);
    expect(sampleReference(result, image, { x: 511, y: 255 })).toEqual([252, 252, 211, 248]);
    expect(
      skinWorkspaceSchema.parse({
        ...emptyWorkspace(),
        references: [{ ...image, id: 'reference_1' }],
      }).references[0],
    ).toEqual({ ...image, id: 'reference_1' });
  });
  it('retains every channel including transparent RGB when an image already fits', () => {
    const pixels = new Uint8ClampedArray([
      90, 80, 70, 0, 10, 20, 30, 85, 40, 50, 60, 170, 70, 80, 90, 255,
    ]);
    const image = { name: 'RGBA', width: 2, height: 2, pixels: encodePixels(pixels) };
    expect(fitWorkspaceImage(image)).toEqual(image);
    expect(decodePixels(fitWorkspaceImage(image).pixels)).toEqual(pixels);
  });
  it('supports stamp size limits, extreme aspect ratios and default names without zero-sized outputs', () => {
    const wide = fitWorkspaceImage(
      { name: ' ', width: 2048, height: 1, pixels: encodePixels(new Uint8ClampedArray(2048 * 4)) },
      256,
    );
    expect([wide.name, wide.width, wide.height]).toEqual(['未命名素材', 256, 1]);
    const tall = fitWorkspaceImage(
      {
        name: 'tall',
        width: 1,
        height: 2048,
        pixels: encodePixels(new Uint8ClampedArray(2048 * 4)),
      },
      256,
    );
    expect([tall.width, tall.height]).toEqual([1, 256]);
  });
  it('rejects invalid dimensions or pixel counts before resizing', () => {
    const image = { name: 'invalid', width: 1, height: 1, pixels: 'AAAAAA==' };
    expect(() => fitWorkspaceImage({ ...image, width: 0 })).toThrow('尺寸');
    expect(() => fitWorkspaceImage({ ...image, width: 2049 })).toThrow('尺寸');
    expect(() => fitWorkspaceImage({ ...image, width: 1.5 })).toThrow('尺寸');
    expect(() => fitWorkspaceImage(image, 1024)).toThrow('尺寸');
    expect(() => fitWorkspaceImage({ ...image, pixels: 'AA==' })).toThrow('像素');
  });
  it('retains strict base64 validation for large-image decoding', () => {
    for (const value of ['A', 'AAA', '====', 'AA=A', 'A===', 'AAAA\n', 'AA-/', 'AA==AAAA'])
      expect(() => decodePixels(value)).toThrow('编码');
    expect(Array.from(decodePixels('AA=='))).toEqual([0]);
    expect(Array.from(decodePixels('AAE='))).toEqual([0, 1]);
    expect(Array.from(decodePixels('AAEC'))).toEqual([0, 1, 2]);
  });
  it('validates and decodes complete 256-pixel HD layer buffers without a recursive regular expression', () => {
    const pixels = Uint8ClampedArray.from({ length: 256 * 256 * 4 }, (_, index) => index % 256);
    const project = {
      schemaVersion: 1,
      name: 'HD',
      resolution: 256,
      model: 'classic',
      activeLayerId: 'base',
      palette: [],
      layers: [
        {
          id: 'base',
          name: 'HD 图层',
          visible: true,
          locked: false,
          opacity: 1,
          blend: 'normal',
          pixels: encodePixels(pixels),
        },
      ],
    };
    expect(decodePixels(skinProjectSchema.parse(project).layers[0].pixels)).toEqual(pixels);
    expect(() =>
      skinProjectSchema.parse({
        ...project,
        layers: [{ ...project.layers[0], pixels: project.layers[0].pixels.slice(0, -1) }],
      }),
    ).toThrow();
  });
});

describe('reference view coordinates and color picking', () => {
  const image = { width: 64, height: 32 },
    view = { width: 200, height: 160 };
  it('maps zoomed and panned screen coordinates to the original image rather than a rendered color', () => {
    const transform = { zoom: 2.5, x: -45, y: 30 },
      scale = referenceFit(image, view) * transform.zoom;
    const point = {
      x: view.width / 2 + transform.x + (12.5 - image.width / 2) * scale,
      y: view.height / 2 + transform.y + (21.5 - image.height / 2) * scale,
    };
    expect(referenceImagePoint(point, image, view, transform)).toEqual({ x: 12, y: 21 });
    const data = new Uint8ClampedArray(64 * 32 * 4);
    data.set([33, 66, 99, 85], (21 * 64 + 12) * 4);
    expect(
      sampleReference(data, image, referenceImagePoint(point, image, view, transform)!),
    ).toEqual([33, 66, 99, 85]);
  });
  it('excludes letterboxing and the exact far edge without wrapping to another row', () => {
    const transform = { zoom: 1, x: 0, y: 0 },
      scale = referenceFit(image, view);
    expect(referenceImagePoint({ x: 0, y: 0 }, image, view, transform)).toBeNull();
    expect(
      referenceImagePoint(
        { x: view.width / 2 + (image.width * scale) / 2, y: view.height / 2 },
        image,
        view,
        transform,
      ),
    ).toBeNull();
    expect(
      referenceImagePoint({ x: view.width / 2, y: view.height / 2 }, image, view, {
        ...transform,
        zoom: 0,
      }),
    ).toBeNull();
    expect(() =>
      sampleReference(new Uint8ClampedArray(64 * 32 * 4), image, { x: 64, y: 0 }),
    ).toThrow('位置');
  });
  it('keeps the pixel under the cursor fixed when zooming and enforces useful zoom bounds', () => {
    const transform = { zoom: 1, x: 0, y: 0 },
      anchor = { x: 147, y: 92 };
    const before = referenceImagePoint(anchor, image, view, transform),
      zoomed = zoomReference(transform, 4, anchor, view);
    expect(referenceImagePoint(anchor, image, view, zoomed)).toEqual(before);
    expect(zoomReference(transform, 200, anchor, view).zoom).toBe(16);
    expect(zoomReference(transform, 0.001, anchor, view).zoom).toBe(0.125);
    expect(zoomReference(zoomed, 1, anchor, view)).toEqual(transform);
  });
});
