import type { RGBA, SkinBlend, SkinProject } from './skin';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function encodePixels(pixels: Uint8ClampedArray | Uint8Array): string {
  const result: string[] = [];
  for (let i = 0; i < pixels.length; i += 3) {
    const bits = (pixels[i] << 16) | ((pixels[i + 1] ?? 0) << 8) | (pixels[i + 2] ?? 0);
    result.push(
      alphabet[bits >>> 18],
      alphabet[(bits >>> 12) & 63],
      i + 1 < pixels.length ? alphabet[(bits >>> 6) & 63] : '=',
      i + 2 < pixels.length ? alphabet[bits & 63] : '=',
    );
  }
  return result.join('');
}
export function decodePixels(value: string): Uint8ClampedArray {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    throw new Error('无效的像素编码');
  const length = (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  const result = new Uint8ClampedArray(length);
  for (let i = 0, j = 0; i < value.length; i += 4) {
    const bits =
      (alphabet.indexOf(value[i]) << 18) |
      (alphabet.indexOf(value[i + 1]) << 12) |
      (Math.max(0, alphabet.indexOf(value[i + 2])) << 6) |
      Math.max(0, alphabet.indexOf(value[i + 3]));
    result[j++] = bits >>> 16;
    if (j < length) result[j++] = (bits >>> 8) & 255;
    if (j < length) result[j++] = bits & 255;
  }
  return result;
}
const lum = (v: number[]) => 0.3 * v[0] + 0.59 * v[1] + 0.11 * v[2];
const sat = (v: number[]) => Math.max(...v) - Math.min(...v);
const setLum = (v: number[], l: number) => {
  let out = v.map((c) => c + l - lum(v)),
    n = Math.min(...out),
    x = Math.max(...out);
  if (n < 0) out = out.map((c) => l + ((c - l) * l) / (l - n));
  if (x > 1) out = out.map((c) => l + ((c - l) * (1 - l)) / (x - l));
  return out;
};
const setSat = (v: number[], s: number) => {
  const min = Math.min(...v),
    max = Math.max(...v);
  return v.map((c) => (max > min ? ((c - min) * s) / (max - min) : 0));
};
export function blendPixel(
  destination: Uint8ClampedArray,
  offset: number,
  color: RGBA,
  opacity = 1,
  blend: SkinBlend = 'normal',
) {
  const a = (color[3] / 255) * opacity,
    b = destination[offset + 3] / 255,
    out = a + b * (1 - a);
  if (!out) {
    destination.fill(0, offset, offset + 4);
    return;
  }
  if (blend === 'normal') {
    for (let c = 0; c < 3; c++)
      destination[offset + c] = (color[c] * a + destination[offset + c] * b * (1 - a)) / out;
    destination[offset + 3] = out * 255;
    return;
  }
  const source = color.slice(0, 3).map((c) => c / 255),
    dest = Array.from(destination.subarray(offset, offset + 3)).map((c) => c / 255);
  const nonseparable =
    blend === 'hue'
      ? setLum(setSat(source, sat(dest)), lum(dest))
      : blend === 'saturation'
        ? setLum(setSat(dest, sat(source)), lum(dest))
        : blend === 'color'
          ? setLum(source, lum(dest))
          : blend === 'luminosity'
            ? setLum(dest, lum(source))
            : undefined;
  for (let c = 0; c < 3; c++) {
    const s = color[c] / 255,
      d = destination[offset + c] / 255;
    const mixed =
      nonseparable?.[c] ??
      (blend === 'add'
        ? Math.min(1, s + d)
        : blend === 'multiply'
          ? s * d
          : blend === 'screen'
            ? 1 - (1 - s) * (1 - d)
            : blend === 'overlay'
              ? d <= 0.5
                ? 2 * s * d
                : 1 - 2 * (1 - s) * (1 - d)
              : blend === 'darken'
                ? Math.min(s, d)
                : blend === 'lighten'
                  ? Math.max(s, d)
                  : blend === 'colorDodge'
                    ? s === 1
                      ? 1
                      : Math.min(1, d / (1 - s))
                    : blend === 'colorBurn'
                      ? s === 0
                        ? 0
                        : 1 - Math.min(1, (1 - d) / s)
                      : blend === 'hardLight'
                        ? s <= 0.5
                          ? 2 * s * d
                          : 1 - 2 * (1 - s) * (1 - d)
                        : blend === 'softLight'
                          ? s <= 0.5
                            ? d - (1 - 2 * s) * d * (1 - d)
                            : d +
                              (2 * s - 1) *
                                ((d <= 0.25 ? ((16 * d - 12) * d + 4) * d : Math.sqrt(d)) - d)
                          : blend === 'difference'
                            ? Math.abs(d - s)
                            : blend === 'exclusion'
                              ? s + d - 2 * s * d
                              : s);
    destination[offset + c] = (((1 - a) * b * d + (1 - b) * a * s + a * b * mixed) / out) * 255;
  }
  destination[offset + 3] = out * 255;
}
export function compositeLayers(
  layers: { pixels: Uint8ClampedArray; visible: boolean; opacity: number; blend: SkinBlend }[],
  resolution: number,
) {
  const output = new Uint8ClampedArray(resolution * resolution * 4);
  for (const layer of layers) {
    if (!layer.visible || !layer.opacity) continue;
    if (layer.pixels.length !== output.length) throw new Error('图层像素尺寸不匹配');
    if (layer.blend === 'normal') {
      const data = layer.pixels,
        opacity = layer.opacity;
      for (let i = 0; i < output.length; i += 4) {
        if (!data[i + 3]) continue;
        const alpha = (data[i + 3] / 255) * opacity;
        if (alpha === 1) {
          output[i] = data[i];
          output[i + 1] = data[i + 1];
          output[i + 2] = data[i + 2];
          output[i + 3] = 255;
          continue;
        }
        const below = output[i + 3] / 255,
          remainder = below * (1 - alpha),
          out = alpha + remainder;
        output[i] = (data[i] * alpha + output[i] * remainder) / out;
        output[i + 1] = (data[i + 1] * alpha + output[i + 1] * remainder) / out;
        output[i + 2] = (data[i + 2] * alpha + output[i + 2] * remainder) / out;
        output[i + 3] = out * 255;
      }
      continue;
    }
    for (let i = 0; i < output.length; i += 4)
      if (layer.pixels[i + 3])
        blendPixel(
          output,
          i,
          Array.from(layer.pixels.subarray(i, i + 4)) as RGBA,
          layer.opacity,
          layer.blend,
        );
  }
  return output;
}
export function compositeProject(project: SkinProject) {
  return compositeLayers(
    project.layers.map((l) => ({ ...l, pixels: decodePixels(l.pixels) })),
    project.resolution,
  );
}
export function resizePixels(pixels: Uint8ClampedArray, from: number, to: number) {
  if (pixels.length !== from * from * 4 || !Number.isInteger(to) || to < 1 || to > 256)
    throw new Error('像素尺寸无效');
  const out = new Uint8ClampedArray(to * to * 4);
  for (let y = 0; y < to; y++)
    for (let x = 0; x < to; x++) {
      const offset = (Math.floor((y * from) / to) * from + Math.floor((x * from) / to)) * 4;
      out.set(pixels.subarray(offset, offset + 4), (y * to + x) * 4);
    }
  return out;
}
