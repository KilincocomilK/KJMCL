import { describe, expect, it } from 'vitest';
import {
  extractPalette,
  hslToRgba,
  hsvToRgba,
  normalizePalette,
  parseHex,
  rgbToHsl,
  rgbToHsv,
  rgbaToHex,
  validatePaletteName,
} from '../src/skin/color-utils';
import type { RGBA } from '../shared/skin';
describe('skin color editing', () => {
  it('accepts short/long hex without losing alpha and rejects partial or malformed input', () => {
    expect(parseHex('#abcd')).toEqual([170, 187, 204, 221]);
    expect(parseHex(' f26b21 ')).toEqual([242, 107, 33, 255]);
    expect(parseHex('#12345678')).toEqual([18, 52, 86, 120]);
    expect(rgbaToHex([255, 0, 128, 40])).toBe('#ff008028');
    for (const text of ['#', 'fffff', 'rgb(1,2,3)', '000000000', 'zzzzzz'])
      expect(parseHex(text)).toBeNull();
  });
  it('round trips RGB/HSL/HSV primaries, grays, dark shades and alpha', () => {
    const colors: RGBA[] = [
      [255, 0, 0, 255],
      [0, 255, 0, 128],
      [0, 0, 255, 64],
      [128, 128, 128, 255],
      [0, 0, 0, 0],
      [255, 255, 255, 255],
      [9, 17, 33, 192],
      [242, 107, 33, 255],
    ];
    for (const color of colors) {
      expect(hslToRgba(rgbToHsl(color), color[3])).toEqual(color);
      expect(hsvToRgba(rgbToHsv(color), color[3])).toEqual(color);
    }
    expect(hslToRgba({ h: -120, s: 100, l: 50 })).toEqual([0, 0, 255, 255]);
    expect(hsvToRgba({ h: 720, s: 100, v: 100 })).toEqual([255, 0, 0, 255]);
  });
  it('normalizes and deduplicates color palettes while retaining translucent variants', () => {
    expect(normalizePalette(['#FFF', '#ffffff', '#ffffffff', '#ffffff80'])).toEqual([
      '#ffffff',
      '#ffffff80',
    ]);
    expect(() => normalizePalette(['bad color'])).toThrow('无效');
    expect(() =>
      normalizePalette(Array.from({ length: 65 }, (_, i) => '#' + i.toString(16).padStart(6, '0'))),
    ).toThrow('64');
    expect(validatePaletteName(' 新色板 ', [])).toBe('新色板');
    expect(() => validatePaletteName('warm', ['Warm'])).toThrow('已存在');
    expect(validatePaletteName('warm', ['Warm'], 'Warm')).toBe('warm');
  });
  it('extracts only visible real source colors and ranks exact small palettes by frequency', () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128,
    ]);
    expect(extractPalette(pixels, 16)).toEqual(['#ff0000', '#0000ff', '#0000ff80']);
    expect(extractPalette(new Uint8ClampedArray(64), 8)).toEqual([]);
  });
  it('keeps rare distinct hues in bounded weighted median-cut output without inventing colors', () => {
    const pixels = new Uint8ClampedArray(300 * 4),
      source = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const c: RGBA = i < 250 ? [i, Math.floor(i / 2), 0, 255] : [0, 0, 200 + (i % 50), 255];
      pixels.set(c, i * 4);
      source.add(rgbaToHex(c));
    }
    const result = extractPalette(pixels, 8);
    expect(result).toHaveLength(8);
    expect(new Set(result).size).toBe(8);
    for (const color of result) expect(source.has(color)).toBe(true);
    expect(result.some((hex) => parseHex(hex)![2] > 100)).toBe(true);
    expect(extractPalette(pixels, 8)).toEqual(result);
  });
});
