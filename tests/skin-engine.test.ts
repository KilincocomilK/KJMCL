import { describe, expect, it } from 'vitest';
import {
  SkinEditor,
  createProject,
  upgradeLegacy,
  inspectSkin,
  adjustedPixels,
} from '../src/skin/engine';
import { skinFaces, mirroredPixel, surfaceTopology } from '../src/skin/uv';
import {
  blendPixel,
  compositeProject,
  compositeLayers,
  decodePixels,
  encodePixels,
} from '../shared/skin-pixels';
import { skinProjectSchema } from '../shared/skin-schema';
import type { RGBA, SkinBrush } from '../shared/skin';
const red: RGBA = [255, 0, 0, 255],
  blue: RGBA = [0, 0, 255, 255];
function draw(e: SkinEditor, x: number, y: number, brush: Partial<SkinBrush> = {}) {
  e.beginStroke({ x, y }, { color: red, ...brush });
  e.endStroke();
}
describe('skin pixels and document contract', () => {
  it('composites a 256px 16-layer fixture without extra per-pixel arrays in the normal path', () => {
    const layers = Array.from({ length: 16 }, (_, i) => ({
      pixels: new Uint8ClampedArray(256 * 256 * 4).fill(80 + i * 8),
      visible: true,
      opacity: 0.65,
      blend: 'normal' as const,
    }));
    const start = performance.now();
    const output = compositeLayers(layers, 256);
    const ms = performance.now() - start;
    expect(output.length).toBe(256 * 256 * 4);
    expect(output[3]).toBeGreaterThan(250);
    console.info(
      `HD skin composite fixture: ${ms.toFixed(1)}ms, typed pixel buffers ${((layers.reduce((n, l) => n + l.pixels.byteLength, 0) + output.byteLength) / 1024 / 1024).toFixed(2)} MiB`,
    );
  });
  it('round trips arbitrary bytes in portable base64 and rejects corrupted layer lengths', () => {
    const data = Uint8ClampedArray.from({ length: 64 * 64 * 4 }, (_, i) => i % 256);
    expect(decodePixels(encodePixels(data))).toEqual(data);
    for (const bytes of [[1], [1, 2], [1, 2, 3], [1, 2, 3, 4]])
      expect(Array.from(decodePixels(encodePixels(new Uint8Array(bytes))))).toEqual(bytes);
    expect(() => decodePixels('invalid%%%')).toThrow();
    const p = createProject();
    p.layers[0].pixels = 'AA==';
    expect(skinProjectSchema.safeParse(p).success).toBe(false);
    p.layers[0].pixels = encodePixels(data);
    p.activeLayerId = 'missing';
    expect(skinProjectSchema.safeParse(p).success).toBe(false);
  });
  it('composites straight alpha with opacity and blend modes', () => {
    const out = new Uint8ClampedArray([0, 0, 255, 255]);
    blendPixel(out, 0, red, 0.5);
    expect(Array.from(out)).toEqual([128, 0, 128, 255]);
    const multiply = new Uint8ClampedArray([100, 200, 255, 255]);
    blendPixel(multiply, 0, [128, 128, 128, 255], 1, 'multiply');
    expect(Array.from(multiply)).toEqual([50, 100, 128, 255]);
    const add = new Uint8ClampedArray([180, 70, 20, 255]);
    blendPixel(add, 0, [120, 90, 30, 255], 1, 'add');
    expect(Array.from(add)).toEqual([255, 160, 50, 255]);
    const transparent = new Uint8ClampedArray(4);
    blendPixel(transparent, 0, red, 1, 'multiply');
    expect(Array.from(transparent)).toEqual(red);
    const editor = new SkinEditor();
    draw(editor, 3, 4);
    editor.addLayer();
    draw(editor, 3, 4, { color: blue, opacity: 0.5 });
    expect(compositeProject(editor.serialize())).toEqual(editor.composite());
  });
});
describe('paint gestures and history', () => {
  it('centers even-sized round brushes symmetrically on the pixel grid', () => {
    const e = new SkinEditor();
    draw(e, 10, 10, { shape: 'circle', size: 2 });
    for (const [x, y] of [
      [9, 9],
      [10, 9],
      [9, 10],
      [10, 10],
    ])
      expect(e.sample(x, y)).toEqual(red);
    expect(e.sample(11, 10)[3]).toBe(0);
  });
  it('supports posterized gradients with preserved alpha and reproducible palette-limited noise', () => {
    const e = new SkinEditor();
    draw(e, 1, 1, { color: [120, 80, 50, 128] });
    e.selectRect({ x: 1, y: 1 }, { x: 4, y: 1 });
    e.beginStroke(
      { x: 1, y: 1 },
      { tool: 'gradient', color: red, secondary: blue, gradientSteps: 2, preserveAlpha: true },
    );
    e.moveStroke({ x: 4, y: 1 });
    e.endStroke();
    expect(e.sample(1, 1)[3]).toBe(128);
    expect(e.sample(2, 1)[3]).toBe(0);
    const a = new SkinEditor(),
      b = new SkinEditor();
    a.setPalette(['#000000', '#ffffff']);
    b.setPalette(['#000000', '#ffffff']);
    for (const editor of [a, b]) {
      editor.beginStroke(
        { x: 5, y: 5 },
        {
          tool: 'noise',
          color: [128, 128, 128, 255],
          size: 8,
          noiseStrength: 1,
          noiseSeed: 500,
          noisePalette: true,
        },
      );
      editor.endStroke();
    }
    expect(a.composite()).toEqual(b.composite());
    for (let y = 2; y <= 8; y++)
      for (let x = 2; x <= 8; x++) {
        const c = a.sample(x, y);
        if (c[3]) expect([0, 255]).toContain(c[0]);
      }
    a.setStampFromSelection();
    const image = a.getStampImage();
    expect(image).not.toBeNull();
    b.setStampImage(image!);
    expect(b.getStampImage()!.pixels).toBe(image!.pixels);
  });
  it('interpolates continuous strokes and commits one history entry per gesture', () => {
    const e = new SkinEditor();
    e.beginStroke({ x: 2, y: 2 }, { color: red });
    e.moveStroke({ x: 8, y: 2 });
    e.endStroke();
    for (let x = 2; x <= 8; x++) expect(e.sample(x, 2)).toEqual(red);
    expect(e.history().labels.length).toBe(2);
    e.undo();
    expect(e.sample(5, 2)).toEqual([0, 0, 0, 0]);
    e.redo();
    expect(e.sample(5, 2)).toEqual(red);
    e.undo();
    draw(e, 9, 9);
    expect(e.canRedo).toBe(false);
  });
  it('keeps repeated brush passes at intended opacity and supports cancellation', () => {
    const e = new SkinEditor();
    e.beginStroke({ x: 2, y: 2 }, { color: red, opacity: 0.5 });
    e.moveStroke({ x: 2, y: 2 });
    e.moveStroke({ x: 3, y: 2 });
    e.moveStroke({ x: 2, y: 2 });
    e.endStroke();
    expect(e.sample(2, 2)[3]).toBe(128);
    e.beginStroke({ x: 2, y: 2 }, { tool: 'eraser' });
    e.cancelStroke();
    expect(e.sample(2, 2)[3]).toBe(128);
    draw(e, 2, 2, { tool: 'eraser' });
    expect(e.sample(2, 2)[3]).toBe(0);
  });
  it('enforces layer locks, alpha locks, and bounded undo memory', () => {
    const e = new SkinEditor(createProject(), 64 * 64 * 4 * 3);
    draw(e, 1, 1);
    e.updateLayer(e.activeLayer.id, { alphaLock: true });
    draw(e, 2, 2);
    expect(e.sample(2, 2)[3]).toBe(0);
    draw(e, 1, 1, { color: blue });
    expect(e.sample(1, 1)).toEqual(blue);
    e.updateLayer(e.activeLayer.id, { locked: true });
    expect(() => draw(e, 1, 1)).toThrow('解锁');
    expect(e.history().labels.length).toBeLessThanOrEqual(3);
  });
  it('keeps locked alpha pixels unchanged by erasing and preserves alpha during dodge/burn', () => {
    const e = new SkinEditor();
    draw(e, 8, 8, { color: [100, 120, 140, 128] });
    e.updateLayer(e.activeLayer.id, { alphaLock: true });
    const before = e.serialize(),
      count = e.history().labels.length;
    draw(e, 8, 8, { tool: 'eraser' });
    expect(e.serialize()).toEqual(before);
    expect(e.history().labels).toHaveLength(count);
    e.updateLayer(e.activeLayer.id, { alphaLock: false });
    e.beginStroke({ x: 8, y: 8 }, { tool: 'lighten', opacity: 0.5 });
    e.moveStroke({ x: 8, y: 8 });
    e.endStroke();
    expect(e.sample(8, 8)[3]).toBe(128);
    const lighter = e.sample(8, 8);
    expect(lighter).toEqual([110, 130, 150, 128]);
    draw(e, 8, 8, { tool: 'darken', opacity: 0.5 });
    expect(e.sample(8, 8)[3]).toBe(128);
    expect(e.sample(8, 8)).toEqual([100, 120, 140, 128]);
    draw(e, 9, 8, { tool: 'lighten' });
    expect(e.sample(9, 8)[3]).toBe(0);
    draw(e, 40, 8, { color: [100, 120, 140, 128] });
    e.updateLayer(e.activeLayer.id, { alphaLock: true });
    const outer = e.sample(40, 8);
    draw(e, 40, 8, { tool: 'sculpt', sculptMode: 'lower' });
    expect(e.sample(40, 8)).toEqual(outer);
  });
  it('limits fill to a face and matches disconnected colors only for global replace', () => {
    const e = new SkinEditor();
    draw(e, 8, 8, { tool: 'fill', clipFace: true });
    expect(e.sample(8, 8)).toEqual(red);
    expect(e.sample(7, 8)[3]).toBe(0);
    expect(e.sample(15, 15)).toEqual(red);
    expect(e.sample(16, 15)[3]).toBe(0);
    draw(e, 40, 40);
    draw(e, 8, 8, { tool: 'replace', color: blue });
    expect(e.sample(40, 40)).toEqual(blue);
    expect(e.sample(8, 8)).toEqual(blue);
  });
  it('previews shapes from the original gesture instead of leaving intermediate outlines', () => {
    const e = new SkinEditor();
    e.beginStroke({ x: 1, y: 1 }, { tool: 'rectangle', color: red });
    e.moveStroke({ x: 5, y: 5 });
    e.moveStroke({ x: 8, y: 8 });
    e.endStroke();
    expect(e.sample(5, 5)[3]).toBe(0);
    expect(e.sample(8, 8)).toEqual(red);
    e.selectRect({ x: 10, y: 10 }, { x: 12, y: 10 });
    e.beginStroke({ x: 10, y: 10 }, { tool: 'gradient', color: red, secondary: blue });
    e.moveStroke({ x: 12, y: 10 });
    e.endStroke();
    expect(e.sample(10, 10)).toEqual(red);
    expect(e.sample(12, 10)).toEqual(blue);
    expect(e.sample(9, 10)[3]).toBe(0);
  });
  it('mirrors corresponding body limbs rather than unrelated atlas pixels', () => {
    const e = new SkinEditor();
    draw(e, 44, 20, { mirror: 'body' });
    expect(e.sample(39, 52)).toEqual(red);
    expect(mirroredPixel(44, 20, 'classic')).toEqual({ x: 39, y: 52 });
    expect(mirroredPixel(39, 52, 'classic')).toEqual({ x: 44, y: 20 });
  });
  it('clones the selected source without sampling pixels modified by the current gesture', () => {
    const e = new SkinEditor();
    draw(e, 1, 1);
    draw(e, 2, 1, { color: blue });
    e.cloneSource({ x: 1, y: 1 });
    e.beginStroke({ x: 2, y: 1 }, { tool: 'clone' });
    e.moveStroke({ x: 3, y: 1 });
    e.endStroke();
    expect(e.sample(2, 1)).toEqual(red);
    expect(e.sample(3, 1)).toEqual(blue);
  });
});
describe('selections layers and transforms', () => {
  it('previews levels and outlines without mutating history and applies exactly that preview', () => {
    const e = new SkinEditor();
    draw(e, 10, 10, { color: [64, 128, 192, 255] });
    const before = e.serialize(),
      history = e.history();
    const settings = {
      levels: { black: 64, white: 192, gamma: 1 },
      outline: { color: red, width: 1 },
    };
    const preview = e.previewAdjust(settings);
    expect(e.serialize()).toEqual(before);
    expect(e.history()).toEqual(history);
    expect(Array.from(preview.subarray((10 * 64 + 10) * 4, (10 * 64 + 10) * 4 + 4))).toEqual([
      0, 128, 255, 255,
    ]);
    expect(Array.from(preview.subarray((10 * 64 + 9) * 4, (10 * 64 + 9) * 4 + 4))).toEqual(red);
    e.adjust(settings);
    expect(e.composite()).toEqual(preview);
    e.undo();
    expect(e.serialize()).toEqual(before);
    const adjusted = adjustedPixels(e.activeLayer.pixels, 64, { contrast: -1 });
    expect(adjusted[(10 * 64 + 10) * 4]).toBe(128);
  });
  it('merges only visible layers while preserving hidden locked layers and their pixels', () => {
    const e = new SkinEditor();
    draw(e, 1, 1);
    const hiddenId = e.activeLayer.id;
    e.updateLayer(hiddenId, { visible: false, locked: true });
    e.addLayer();
    draw(e, 2, 2, { color: blue });
    e.addLayer();
    draw(e, 3, 3);
    const before = e.composite();
    e.flatten();
    expect(e.doc.layers).toHaveLength(2);
    expect(e.doc.layers.find((l) => l.id === hiddenId)?.locked).toBe(true);
    expect(e.composite()).toEqual(before);
    e.updateLayer(hiddenId, { visible: true });
    expect(e.sample(1, 1)).toEqual(red);
  });
  it('supports additive/subtractive masks, wand, polygon, cut and paste', () => {
    const e = new SkinEditor();
    e.selectRect({ x: 1, y: 1 }, { x: 3, y: 3 });
    e.selectRect({ x: 2, y: 2 }, { x: 2, y: 2 }, 'subtract');
    draw(e, 2, 2);
    expect(e.sample(2, 2)[3]).toBe(0);
    draw(e, 1, 1);
    e.selectWand({ x: 1, y: 1 });
    expect(e.selection!.reduce((n, v) => n + v, 0)).toBe(1);
    e.copy(true);
    expect(e.sample(1, 1)[3]).toBe(0);
    e.paste();
    expect(e.sample(1, 1)).toEqual(red);
    e.selectPolygon([
      { x: 10, y: 10 },
      { x: 14, y: 10 },
      { x: 10, y: 14 },
    ]);
    expect(e.selection![10 * 64 + 10]).toBe(1);
    expect(e.selection![14 * 64 + 14]).toBe(0);
  });
  it('moves and rotates non-square selections and preserves pixel content through undo', () => {
    const e = new SkinEditor();
    draw(e, 2, 3);
    draw(e, 3, 3, { color: blue });
    e.selectRect({ x: 2, y: 3 }, { x: 3, y: 3 });
    e.transform('rotateCW');
    expect(e.sample(2, 3)).toEqual(red);
    expect(e.sample(2, 4)).toEqual(blue);
    expect(e.sample(3, 3)[3]).toBe(0);
    e.moveSelection(3, 2);
    expect(e.sample(5, 5)).toEqual(red);
    expect(e.sample(5, 6)).toEqual(blue);
    e.undo();
    expect(e.sample(2, 4)).toEqual(blue);
  });
  it('merges visible layers, preserves alpha, and serializes alpha locks', () => {
    const e = new SkinEditor();
    draw(e, 1, 1);
    e.addLayer();
    draw(e, 1, 1, { color: blue, opacity: 0.5 });
    const before = e.composite();
    e.mergeDown();
    expect(e.doc.layers).toHaveLength(1);
    expect(e.composite()).toEqual(before);
    e.duplicateLayer();
    e.updateLayer(e.activeLayer.id, { alphaLock: true, visible: false });
    const reopened = new SkinEditor(e.serialize());
    expect(reopened.activeLayer.alphaLock).toBe(true);
    expect(reopened.composite()).toEqual(before);
  });
  it('applies color adjustments only inside the selected alpha pixels', () => {
    const e = new SkinEditor();
    draw(e, 1, 1);
    draw(e, 5, 5);
    e.selectRect({ x: 1, y: 1 }, { x: 1, y: 1 });
    e.adjust({ invert: true });
    expect(e.sample(1, 1)).toEqual([0, 255, 255, 255]);
    expect(e.sample(5, 5)).toEqual(red);
    e.adjust({ hue: 180 });
    expect(e.sample(1, 1)).toEqual(red);
  });
});
describe('Minecraft UV compatibility', () => {
  it('imports both arm models by source UVs into the target model, including HD destination layers', () => {
    for (const [source, target] of [
      ['classic', 'slim'],
      ['slim', 'classic'],
    ] as const) {
      const pixels = new Uint8ClampedArray(64 * 64 * 4),
        faces = skinFaces(source);
      faces.forEach((face, index) => {
        for (let y = 0; y < face.height; y++)
          for (let x = 0; x < face.width; x++)
            pixels.set([index + 1, x * 25, y * 15, 255], ((face.y + y) * 64 + face.x + x) * 4);
      });
      const image = { name: 'Source model', width: 64, height: 64, pixels: encodePixels(pixels) },
        e = new SkinEditor(createProject('Target', 128, target)),
        original = e.serialize();
      e.importImage(image, 'layer', undefined, 'both', false, source);
      expect(e.doc.model).toBe(target);
      expect(e.doc.layers).toHaveLength(2);
      for (const face of skinFaces(target, 128)) {
        const from = faces.find(
          (f) => f.part === face.part && f.surface === face.surface && f.face === face.face,
        )!;
        const index = faces.indexOf(from);
        for (let x = 0; x < face.width; x++) {
          // Resize happens before remapping arm width, using nearest-neighbor pixels.
          const sourceX = Math.floor(Math.floor((x * from.width * 2) / face.width) / 2);
          expect(e.sample(face.x + x, face.y)).toEqual([index + 1, sourceX * 25, 0, 255]);
        }
      }
      e.undo();
      expect(e.serialize()).toEqual(original);
      e.redo();
      const beforePart = e.serialize();
      e.importImage(image, 'part', 'leftArm', 'outer', true, source);
      const outer = skinFaces(target, 128).find(
        (f) => f.part === 'leftArm' && f.surface === 'outer' && f.face === 'left',
      )!;
      const expected =
        faces.findIndex((f) => f.part === 'leftArm' && f.surface === 'outer' && f.face === 'left') +
        1;
      expect(e.sample(outer.x, outer.y, false)[0]).toBe(expected);
      const base = skinFaces(target, 128).find(
        (f) => f.part === 'leftArm' && f.surface === 'base' && f.face === 'left',
      )!;
      expect(e.sample(base.x, base.y, false)[3]).toBe(0);
      e.undo();
      expect(e.serialize()).toEqual(beforePart);
      e.importImage(image, 'replace', undefined, 'both', false, source);
      expect(e.doc.model).toBe(source);
      expect(e.doc.resolution).toBe(64);
      expect(e.activeLayer.pixels).toEqual(pixels);
    }
  });
  it('upgrades classic legacy pixels before importing them into a slim document', () => {
    const pixels = new Uint8ClampedArray(64 * 32 * 4);
    pixels.set(red, (20 * 64 + 48) * 4);
    const e = new SkinEditor(createProject('Slim', 64, 'slim')),
      image = { name: 'Legacy', width: 64, height: 32, pixels: encodePixels(pixels) };
    e.importImage(image, 'layer');
    expect(e.sample(47, 20)).toEqual(red);
    e.importImage(image, 'replace', undefined, 'both', false, 'slim');
    expect(e.doc.model).toBe('slim');
    expect(e.sample(47, 20)).toEqual(red);
  });
  it('reports unused pixels and alpha issues, and repairs the active layer reversibly', () => {
    const e = new SkinEditor();
    draw(e, 40, 8, { color: [200, 100, 50, 100] });
    draw(e, 0, 0);
    const report = e.inspect('active');
    expect(report.baseTransparent).toBeGreaterThan(0);
    expect(report.outerTranslucent).toBe(1);
    expect(report.unusedPixels).toBe(1);
    const before = e.serialize();
    e.fixSkin({ baseAlpha: true, clearUnused: true, outerBinaryAlpha: true });
    expect(e.inspect('active')).toEqual({
      baseTransparent: 0,
      outerTranslucent: 0,
      unusedPixels: 0,
    });
    expect(inspectSkin(e.composite(), 'classic', 64)).toEqual(e.inspect());
    e.undo();
    expect(e.serialize()).toEqual(before);
  });
  it('crosses genuine 3D seams in surface fill without leaking into adjacent atlas islands', () => {
    const topology = surfaceTopology('classic', 64, 'head', 'base');
    expect(topology.size).toBe(6 * 8 * 8);
    for (const neighbors of topology.values()) expect(neighbors).toHaveLength(4);
    const e = new SkinEditor();
    draw(e, 8, 8, { tool: 'fill', fillScope: 'part' });
    for (const f of skinFaces('classic').filter((f) => f.part === 'head' && f.surface === 'base'))
      expect(e.sample(f.x, f.y)).toEqual(red);
    expect(e.sample(40, 8)[3]).toBe(0);
    expect(e.sample(20, 20)[3]).toBe(0);
    e.beginStroke({ x: 44, y: 20 }, { color: blue });
    e.moveStroke({ x: 36, y: 52 }, true);
    e.endStroke();
    expect(e.sample(40, 36)[3]).toBe(0);
  });
  it('keeps shape previews on their original island after a 3D seam discontinuity', () => {
    for (const tool of ['line', 'rectangle', 'ellipse', 'gradient'] as const) {
      const e = new SkinEditor();
      e.beginStroke({ x: 44, y: 20 }, { tool, color: red });
      e.moveStroke({ x: 45, y: 21 });
      const preview = e.composite();
      e.moveStroke({ x: 36, y: 52 }, true);
      e.moveStroke({ x: 37, y: 53 });
      e.endStroke();
      expect(e.composite()).toEqual(preview);
      expect(e.history().labels).toHaveLength(2);
      e.undo();
      expect(e.composite().some((v) => v !== 0)).toBe(false);
    }
  });
  it('mirrors within both axes of one face and raises/erases only its outer-layer counterpart', () => {
    const e = new SkinEditor();
    draw(e, 8, 8, { mirror: 'faceXY' });
    for (const [x, y] of [
      [8, 8],
      [15, 8],
      [8, 15],
      [15, 15],
    ])
      expect(e.sample(x, y)).toEqual(red);
    draw(e, 8, 8, { tool: 'sculpt' });
    expect(e.sample(40, 8)).toEqual(red);
    expect(e.sample(8, 8)).toEqual(red);
    draw(e, 40, 8, { tool: 'sculpt', sculptMode: 'lower' });
    expect(e.sample(40, 8)[3]).toBe(0);
    expect(e.sample(8, 8)).toEqual(red);
  });
  it('creates RGBA stamps, rotates/flips/scales them and keeps their alpha intact', () => {
    const e = new SkinEditor();
    draw(e, 1, 1);
    draw(e, 2, 1, { color: blue });
    e.selectRect({ x: 1, y: 1 }, { x: 2, y: 1 });
    e.setStampFromSelection();
    expect(e.hasStamp).toBe(true);
    e.clearSelection();
    draw(e, 10, 10, { tool: 'stamp', stampRotation: 90 });
    expect(e.sample(10, 9)).toEqual(red);
    expect(e.sample(10, 10)).toEqual(blue);
    draw(e, 20, 20, { tool: 'stamp', stampFlipX: true, stampScale: 2 });
    expect(e.sample(18, 19)).toEqual(blue);
    expect(e.sample(21, 20)).toEqual(red);
  });
  it('imports a chosen body surface to a new layer without modifying locked originals', () => {
    const e = new SkinEditor();
    draw(e, 20, 20);
    e.updateLayer(e.activeLayer.id, { locked: true });
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set(blue, i);
    e.importImage(
      { name: 'Jacket', width: 64, height: 64, pixels: encodePixels(pixels) },
      'part',
      'body',
      'outer',
      true,
    );
    expect(e.doc.layers).toHaveLength(2);
    expect(e.sample(20, 20)).toEqual(red);
    expect(e.sample(20, 36)).toEqual(blue);
    expect(e.sample(8, 8)[3]).toBe(0);
    expect(() => e.flatten()).toThrow('解锁');
    expect(() => e.mergeDown()).toThrow('解锁');
  });
  it('removes the opaque hat area from old alpha-less PNGs while keeping actual body faces opaque', () => {
    const old = new Uint8ClampedArray(64 * 32 * 4).fill(255),
      pixels = upgradeLegacy(old);
    expect(pixels[(8 * 64 + 40) * 4 + 3]).toBe(0);
    expect(pixels[(20 * 64 + 44) * 4 + 3]).toBe(255);
    expect(pixels[(52 * 64 + 36) * 4 + 3]).toBe(255);
  });
  it('describes all 72 faces without overlaps and scales HD coordinates', () => {
    for (const model of ['classic', 'slim'] as const) {
      const faces = skinFaces(model);
      expect(faces).toHaveLength(72);
      const occupied = new Set<string>();
      for (const f of faces)
        for (let y = f.y; y < f.y + f.height; y++)
          for (let x = f.x; x < f.x + f.width; x++) {
            expect(occupied.has(`${x}:${y}`)).toBe(false);
            occupied.add(`${x}:${y}`);
          }
      expect(skinFaces(model, 128)[0].width).toBe(16);
    }
  });
  it('upgrades legacy arms/legs with mirrored sides and transparent modern overlays', () => {
    const legacy = new Uint8ClampedArray(64 * 32 * 4);
    legacy.set(red, (20 * 64 + 44) * 4);
    legacy.set(blue, (20 * 64 + 40) * 4);
    const pixels = upgradeLegacy(legacy);
    expect(Array.from(pixels.subarray((52 * 64 + 39) * 4, (52 * 64 + 39) * 4 + 4))).toEqual(red);
    expect(Array.from(pixels.subarray((52 * 64 + 43) * 4, (52 * 64 + 43) * 4 + 4))).toEqual(blue);
    expect(pixels[(36 * 64 + 20) * 4 + 3]).toBe(0);
  });
  it('moves narrow-arm face UV pixels when converting models and supports per-part import', () => {
    const e = new SkinEditor();
    draw(e, 48, 20);
    e.convertModel('slim');
    expect(e.sample(47, 20)).toEqual(red);
    e.convertModel('classic');
    expect(e.sample(48, 20)).toEqual(red);
    const p = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < p.length; i += 4) p.set(blue, i);
    e.importImage({ name: 'Part', width: 64, height: 64, pixels: encodePixels(p) }, 'part', 'head');
    expect(e.sample(8, 8)).toEqual(blue);
    expect(e.sample(48, 20)).toEqual(red);
    e.resize(128);
    expect(e.sample(16, 16)).toEqual(blue);
    expect(e.serialize().resolution).toBe(128);
    e.undo();
    expect(e.doc.resolution).toBe(64);
  });
  it('can reinterpret slim model metadata without moving imported pixels', () => {
    const e = new SkinEditor();
    draw(e, 48, 20);
    const pixels = e.activeLayer.pixels.slice();
    e.reinterpretModel('slim');
    expect(e.activeLayer.pixels).toEqual(pixels);
    expect(e.doc.model).toBe('slim');
    e.undo();
    expect(e.doc.model).toBe('classic');
    expect(e.activeLayer.pixels).toEqual(pixels);
  });
});
describe('batch layer edits', () => {
  it('shows, hides, locks, unlocks, duplicates and deletes a selection with one undo per action', () => {
    const e = new SkinEditor();
    draw(e, 1, 1);
    const first = e.activeLayer.id;
    e.addLayer('Second');
    draw(e, 2, 2, { color: blue });
    const second = e.activeLayer.id;
    e.addLayer('Third');
    const selected = [first, second];
    for (const action of ['hide', 'show', 'lock', 'unlock', 'duplicate', 'delete'] as const) {
      if (action === 'show') e.batchLayers(selected, 'hide');
      if (action === 'unlock') e.batchLayers(selected, 'lock');
      const before = e.serialize(),
        count = e.history().index;
      const ids = e.batchLayers(selected, action);
      expect(e.history().labels).toHaveLength(count + 2);
      if (action === 'duplicate') {
        expect(ids).toHaveLength(2);
        expect(e.doc.layers.map((l) => l.id)).toEqual([
          first,
          ids[0],
          second,
          ids[1],
          before.activeLayerId,
        ]);
        expect(e.doc.layers[1].pixels).toEqual(e.doc.layers[0].pixels);
        expect(e.doc.layers[1].pixels).not.toBe(e.doc.layers[0].pixels);
      } else if (action === 'delete') {
        expect(e.doc.layers).toHaveLength(1);
        expect(ids).toEqual([]);
      } else {
        for (const id of selected) {
          const layer = e.doc.layers.find((l) => l.id === id)!;
          if (action === 'hide' || action === 'show') expect(layer.visible).toBe(action === 'show');
          else expect(layer.locked).toBe(action === 'lock');
        }
      }
      const after = e.serialize();
      e.undo();
      expect(e.serialize()).toEqual(before);
      e.redo();
      expect(e.serialize()).toEqual(after);
      e.undo();
      if (action === 'show') e.batchLayers(selected, 'show');
      if (action === 'unlock') e.batchLayers(selected, 'unlock');
    }
  });
  it('rejects invalid or destructive selections atomically and permits locked-layer copies', () => {
    const e = new SkinEditor();
    const first = e.activeLayer.id;
    expect(() => e.batchLayers([first], 'delete')).toThrow('保留');
    e.addLayer();
    const second = e.activeLayer.id;
    e.batchLayers([first], 'lock');
    const before = e.serialize(),
      count = e.history().labels.length;
    expect(() => e.batchLayers([first, second], 'delete')).toThrow('解锁');
    expect(() => e.batchLayers([first, 'missing'], 'hide')).toThrow('不存在');
    e.batchLayers([], 'delete');
    expect(e.serialize()).toEqual(before);
    expect(e.history().labels).toHaveLength(count);
    const copies = e.batchLayers([first, first], 'duplicate');
    expect(copies).toHaveLength(1);
    expect(e.doc.layers.find((l) => l.id === copies[0])?.locked).toBe(true);
    e.undo();
    for (let i = 0; i < 13; i++) e.addLayer();
    const full = e.serialize();
    expect(() => e.batchLayers([first, second], 'duplicate')).toThrow('16');
    expect(e.serialize()).toEqual(full);
  });
});
