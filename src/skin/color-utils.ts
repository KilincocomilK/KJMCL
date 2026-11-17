import type { RGBA } from '../../shared/skin';
export interface HSL {
  h: number;
  s: number;
  l: number;
}
export interface HSV {
  h: number;
  s: number;
  v: number;
}
const clamp = (value: number, min = 0, max = 255) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const byte = (value: number) => Math.round(clamp(value));
export function rgbaToHex(color: RGBA, includeAlpha = color[3] !== 255) {
  return (
    '#' +
    color
      .slice(0, includeAlpha ? 4 : 3)
      .map((v) => byte(v).toString(16).padStart(2, '0'))
      .join('')
  );
}
export function parseHex(value: string): RGBA | null {
  const text = value.trim().replace(/^#/, '');
  if (!/^(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(text)) return null;
  const full =
    text.length <= 4
      ? Array.from(text)
          .map((c) => c + c)
          .join('')
      : text;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
    full.length === 8 ? parseInt(full.slice(6, 8), 16) : 255,
  ];
}
export function rgbToHsl(color: RGBA): HSL {
  const [r, g, b] = color.map((v) => v / 255),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min,
    l = (max + min) / 2;
  const hue = !d
    ? 0
    : max === r
      ? ((g - b) / d) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return {
    h: (((hue * 60) % 360) + 360) % 360,
    s: d ? (d / (1 - Math.abs(2 * l - 1))) * 100 : 0,
    l: l * 100,
  };
}
export function hslToRgba({ h, s, l }: HSL, alpha = 255): RGBA {
  h = (((h % 360) + 360) % 360) / 60;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs((h % 2) - 1)),
    m = l - c / 2;
  const rgb =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x];
  return [...rgb.map((v) => byte((v + m) * 255)), byte(alpha)] as RGBA;
}
export function rgbToHsv(color: RGBA): HSV {
  const [r, g, b] = color.map((v) => v / 255),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  const hue = !d
    ? 0
    : max === r
      ? ((g - b) / d) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return { h: (((hue * 60) % 360) + 360) % 360, s: max ? (d / max) * 100 : 0, v: max * 100 };
}
export function hsvToRgba({ h, s, v }: HSV, alpha = 255): RGBA {
  h = (((h % 360) + 360) % 360) / 60;
  s = clamp(s, 0, 100) / 100;
  v = clamp(v, 0, 100) / 100;
  const c = v * s,
    x = c * (1 - Math.abs((h % 2) - 1)),
    m = v - c;
  const rgb =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x];
  return [...rgb.map((n) => byte((n + m) * 255)), byte(alpha)] as RGBA;
}
export function normalizePalette(colors: string[]) {
  const output: string[] = [];
  for (const input of colors) {
    const color = parseHex(input);
    if (!color) throw new Error('色板包含无效颜色');
    const value = rgbaToHex(color);
    if (!output.includes(value)) output.push(value);
  }
  if (output.length > 64) throw new Error('色板最多 64 种颜色');
  return output;
}
/** Weighted median-cut palette: keeps real source colors rather than inventing blend colors. */
export function extractPalette(pixels: Uint8ClampedArray, limit = 16): string[] {
  limit = Math.round(clamp(limit, 1, 64));
  const counts = new Map<string, { color: RGBA; count: number }>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const color = Array.from(pixels.subarray(i, i + 4)) as RGBA,
      key = rgbaToHex(color);
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { color, count: 1 });
  }
  type Point = { color: RGBA; count: number };
  const points = [...counts.values()];
  if (points.length <= limit)
    return points
      .sort((a, b) => b.count - a.count || rgbaToHex(a.color).localeCompare(rgbaToHex(b.color)))
      .map((p) => rgbaToHex(p.color));
  const range = (box: Point[]) =>
    [0, 1, 2, 3].map((c) => {
      let min = 255,
        max = 0;
      for (const p of box) {
        min = Math.min(min, p.color[c]);
        max = Math.max(max, p.color[c]);
      }
      return (max - min) * (c === 3 ? 0.5 : 1);
    });
  const boxes: Point[][] = [points];
  while (boxes.length < limit) {
    let chosen = -1,
      score = -1,
      channel = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      const ranges = range(boxes[i]),
        c = ranges.indexOf(Math.max(...ranges)),
        weight = boxes[i].reduce((n, p) => n + p.count, 0),
        value = ranges[c] * Math.sqrt(weight);
      if (value > score) {
        score = value;
        chosen = i;
        channel = c;
      }
    }
    if (chosen < 0) break;
    const box = boxes[chosen].sort(
        (a, b) =>
          a.color[channel] - b.color[channel] ||
          rgbaToHex(a.color).localeCompare(rgbaToHex(b.color)),
      ),
      total = box.reduce((n, p) => n + p.count, 0);
    let running = 0,
      index = 0;
    while (index < box.length - 1 && running < total / 2) {
      running += box[index].count;
      index++;
    }
    boxes.splice(chosen, 1, box.slice(0, index), box.slice(index));
  }
  return boxes
    .map((box) => {
      const total = box.reduce((n, p) => n + p.count, 0),
        mean = [0, 1, 2, 3].map((c) => box.reduce((n, p) => n + p.color[c] * p.count, 0) / total);
      const point = box.reduce((best, p) =>
        p.color.reduce((n, v, c) => n + (v - mean[c]) ** 2, 0) <
        best.color.reduce((n, v, c) => n + (v - mean[c]) ** 2, 0)
          ? p
          : best,
      );
      return { color: rgbaToHex(point.color), count: total };
    })
    .sort((a, b) => b.count - a.count || a.color.localeCompare(b.color))
    .map((p) => p.color);
}
export function validatePaletteName(value: string, names: string[], current?: string) {
  const name = value.trim();
  if (!name || name.length > 40) throw new Error('色板名称需为 1–40 字');
  if (names.some((n) => n !== current && n.toLocaleLowerCase() === name.toLocaleLowerCase()))
    throw new Error('色板名称已存在');
  return name;
}
