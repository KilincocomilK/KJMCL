import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PNG } from 'pngjs';
import type { SkinBlend, SkinProject, SkinResolution } from '../shared/skin';
import { emptyWorkspace } from '../shared/skin-workspace';
import { Store } from '../electron/core/store';
import {
  SkinEditorStorage,
  decodeSkinEditorImage,
  encodeSkinPng,
} from '../electron/core/skin-editor';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-skin-storage-'));
  roots.push(root);
  const store = new Store(path.join(root, 'data'));
  return {
    root,
    store,
    storage: new SkinEditorStorage(store),
    directory: path.join(store.root, 'skin-editor'),
  };
}
function pixels(width = 64, height = width) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4)
    data.set([(i / 4) % 256, 33, 201, ((i / 4) % 4) * 85], i);
  return data;
}
function png(width = 64, height = width, data = pixels(width, height)) {
  const image = new PNG({ width, height });
  image.data = data;
  return PNG.sync.write(image);
}
function project(name = '测试作品', resolution: SkinResolution = 64): SkinProject {
  return {
    schemaVersion: 1,
    name,
    resolution,
    model: 'classic',
    activeLayerId: 'base',
    palette: ['#f26b21', '#10203080'],
    layers: [
      {
        id: 'base',
        name: '底色',
        visible: true,
        locked: false,
        opacity: 1,
        blend: 'normal',
        alphaLock: false,
        pixels: pixels(resolution).toString('base64'),
      },
    ],
  };
}
async function readJson(file: string) {
  return JSON.parse(await readFile(file, 'utf8'));
}

describe('skin image codecs', () => {
  it.each([
    [64, 64],
    [64, 32],
    [128, 128],
    [128, 64],
    [256, 256],
    [256, 128],
  ])('decodes %i × %i skin PNGs without losing RGBA', (width, height) => {
    const data = pixels(width, height),
      image = decodeSkinEditorImage(png(width, height, data), path.join('folder', '颜色.png'));
    expect(image).toMatchObject({ name: '颜色', width, height });
    expect(Buffer.from(image.pixels, 'base64')).toEqual(data);
  });
  it('rejects malformed signatures, truncated files and corrupt chunk checksums', () => {
    expect(() => decodeSkinEditorImage(Buffer.from('not a png'), 'bad')).toThrow('有效');
    expect(() => decodeSkinEditorImage(png().subarray(0, 40), 'truncated')).toThrow('损坏');
    const corrupt = Buffer.from(png());
    corrupt[29] ^= 1;
    expect(() => decodeSkinEditorImage(corrupt, 'crc')).toThrow('损坏');
    const signature = Buffer.from(png());
    signature[0] = 0;
    expect(() => decodeSkinEditorImage(signature, 'bad')).toThrow('有效');
  });
  it.each([
    [32, 32],
    [64, 63],
    [128, 32],
    [256, 64],
    [512, 512],
  ])('rejects unsupported skin dimensions %i × %i', (width, height) => {
    expect(() => decodeSkinEditorImage(png(width, height), 'wrong-size')).toThrow('皮肤宽度');
  });
  it('bounds compressed bytes and reference-image dimensions before decoding', () => {
    const huge = Buffer.alloc(8 * 1024 * 1024 + 1);
    png().copy(huge);
    expect(() => decodeSkinEditorImage(huge, 'huge')).toThrow('有效');
    expect(decodeSkinEditorImage(png(2048, 1), 'reference', 'image')).toMatchObject({
      width: 2048,
      height: 1,
    });
    expect(decodeSkinEditorImage(png(1, 2048), 'reference', 'image')).toMatchObject({
      width: 1,
      height: 2048,
    });
    expect(() => decodeSkinEditorImage(png(2049, 1), 'reference', 'image')).toThrow('2048');
    expect(() => decodeSkinEditorImage(png(1, 2049), 'reference', 'image')).toThrow('2048');
    const zeroWidth = Buffer.from(png());
    zeroWidth.writeUInt32BE(0, 16);
    expect(() => decodeSkinEditorImage(zeroWidth, 'zero', 'image')).toThrow('2048');
  });
  it('exports HD, nearest-neighbor 64 × 64 and classic legacy 64 × 32 while preserving alpha', () => {
    const doc = project('HD', 128),
      data = Buffer.alloc(128 * 128 * 4);
    data.set([200, 100, 50, 85], (2 * 128 + 2) * 4);
    data.set([20, 40, 60, 170], (126 * 128 + 126) * 4);
    doc.layers[0].pixels = data.toString('base64');
    const hd = PNG.sync.read(encodeSkinPng(doc));
    expect([hd.width, hd.height]).toEqual([128, 128]);
    expect(Array.from(hd.data.subarray((2 * 128 + 2) * 4, (2 * 128 + 2) * 4 + 4))).toEqual([
      200, 100, 50, 85,
    ]);
    const standard = PNG.sync.read(encodeSkinPng(doc, 'png64'));
    expect([standard.width, standard.height]).toEqual([64, 64]);
    expect(Array.from(standard.data.subarray((64 + 1) * 4, (64 + 1) * 4 + 4))).toEqual([
      200, 100, 50, 85,
    ]);
    expect(Array.from(standard.data.subarray((63 * 64 + 63) * 4, (63 * 64 + 63) * 4 + 4))).toEqual([
      20, 40, 60, 170,
    ]);
    const legacy = PNG.sync.read(encodeSkinPng(doc, 'legacy'));
    expect([legacy.width, legacy.height]).toEqual([64, 32]);
    expect(legacy.data).toEqual(standard.data.subarray(0, 64 * 32 * 4));
    expect(() => encodeSkinPng({ ...doc, model: 'slim' }, 'legacy')).toThrow('经典');
  });
  it('exports the visible composite while keeping original layer pixels unchanged', () => {
    const doc = project(),
      bottom = Buffer.alloc(64 * 64 * 4),
      top = Buffer.alloc(bottom.length);
    bottom.set([10, 20, 30, 255]);
    top.set([210, 120, 50, 255]);
    doc.layers[0].pixels = bottom.toString('base64');
    doc.layers.push({
      ...doc.layers[0],
      id: 'overlay',
      name: '半透明',
      opacity: 0.5,
      pixels: top.toString('base64'),
    });
    expect(Array.from(PNG.sync.read(encodeSkinPng(doc)).data.subarray(0, 4))).toEqual([
      110, 70, 40, 255,
    ]);
    doc.layers[1].visible = false;
    expect(Array.from(PNG.sync.read(encodeSkinPng(doc)).data.subarray(0, 4))).toEqual([
      10, 20, 30, 255,
    ]);
    expect(doc.layers[1].pixels).toBe(top.toString('base64'));
  });
});

describe('skin projects and durable local storage', () => {
  it('flushes queued writes including a write added while the flush is waiting', async () => {
    const { storage, directory } = await fixture();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const importProject = storage.importProject.bind(storage);
    vi.spyOn(storage, 'importProject').mockImplementationOnce(async (file) => {
      entered();
      await gate;
      return importProject(file);
    });
    const first = storage.saveDraft(project('first'));
    let finished = false;
    const flushed = storage.flush().then(() => {
      finished = true;
    });
    await started;
    expect(finished).toBe(false);
    const second = storage.saveDraft(project('last committed stroke'));
    release();
    await flushed;
    await Promise.all([first, second]);
    expect(finished).toBe(true);
    expect((await readJson(path.join(directory, 'draft.json'))).name).toBe('last committed stroke');
    expect((await readJson(path.join(directory, 'draft.json.bak'))).name).toBe('first');
  });
  it('reports an unrepaired draft failure at flush but clears it after a successful retry', async () => {
    const { storage, directory } = await fixture();
    await storage.saveDraft(project('original'));
    const temporary = path.join(directory, 'draft.json.tmp');
    await mkdir(temporary);
    await expect(storage.saveDraft(project('latest'))).rejects.toThrow();
    await expect(storage.flush()).rejects.toThrow('保存未完成');
    await storage.save({ project: project('different project') });
    await expect(storage.flush()).rejects.toThrow('保存未完成');
    await rm(temporary, { recursive: true });
    await storage.saveDraft(project('latest'));
    await expect(storage.flush()).resolves.toBeUndefined();
    expect((await storage.draft())?.name).toBe('latest');
  });
  it('round-trips every layer setting, blend mode, order, active layer, palette and RGBA', async () => {
    const { root, storage } = await fixture();
    const blends: SkinBlend[] = [
      'normal',
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'colorDodge',
      'colorBurn',
      'hardLight',
      'softLight',
      'difference',
      'exclusion',
      'hue',
      'saturation',
      'color',
      'luminosity',
    ];
    const doc = project('完整工程', 128);
    doc.model = 'slim';
    doc.workspace = {
      ...emptyWorkspace(),
      palettes: [{ name: '衣服', colors: ['#aabbcc', '#00112280'] }],
      references: [
        {
          id: 'reference_1',
          name: '色彩参考',
          width: 2,
          height: 2,
          pixels: pixels(2).toString('base64'),
        },
      ],
      brushes: [
        {
          id: 'brush_1',
          name: '自定义笔刷',
          width: 1,
          height: 1,
          pixels: Buffer.from([90, 120, 180, 85]).toString('base64'),
        },
      ],
      shortcuts: { pencil: 'b', fill: 'g' },
      poseAngles: { head: { x: 15, y: -30, z: 0 } },
      poses: [{ name: '招手', angles: { rightArm: { x: 0, y: 20, z: 120 } } }],
      background: '#112233',
      checkerboard: false,
    };
    doc.layers = blends.map((blend, i) => ({
      ...doc.layers[0],
      id: `layer_${i}`,
      name: `颜色层 ${i}`,
      visible: i % 2 === 0,
      locked: i % 3 === 0,
      alphaLock: i % 4 === 0,
      opacity: i / 15,
      blend,
    }));
    doc.activeLayerId = 'layer_9';
    const file = path.join(root, 'complete.kjskin');
    await storage.export(doc, 'project', file);
    expect(await storage.importProject(file)).toEqual(doc);
    await storage.saveDraft(doc);
    const id = await storage.save({ project: doc });
    expect(await storage.draft()).toEqual(doc);
    expect(await storage.open(id)).toEqual(doc);
    await storage.save({ id, project: { ...doc, name: '后续工程' } });
    const [version] = await storage.versions(id);
    expect(await storage.restoreVersion(id, version.versionId)).toEqual(doc);
    const [entry] = await storage.list();
    expect(entry).toMatchObject({ id, name: '后续工程', model: 'slim', resolution: 128 });
    expect(PNG.sync.read(Buffer.from(entry.thumbnail.split(',')[1], 'base64')).width).toBe(64);
  });
  it.each([
    ['future version', (doc: SkinProject) => ({ ...doc, schemaVersion: 2 })],
    ['unknown metadata', (doc: SkinProject) => ({ ...doc, extra: 'must not disappear' })],
    [
      'short pixels',
      (doc: SkinProject) => ({ ...doc, layers: [{ ...doc.layers[0], pixels: 'AA==' }] }),
    ],
    ['duplicate ids', (doc: SkinProject) => ({ ...doc, layers: [doc.layers[0], doc.layers[0]] })],
    ['missing active layer', (doc: SkinProject) => ({ ...doc, activeLayerId: 'missing' })],
    [
      'excess layers',
      (doc: SkinProject) => ({
        ...doc,
        layers: Array.from({ length: 17 }, (_, i) => ({ ...doc.layers[0], id: `l_${i}` })),
      }),
    ],
  ])('rejects %s without replacing the draft', async (_name, corrupt) => {
    const { root, storage } = await fixture(),
      original = project();
    await storage.saveDraft(original);
    const file = path.join(root, 'invalid.kjskin');
    await writeFile(file, JSON.stringify(corrupt(original)));
    await expect(storage.importProject(file)).rejects.toThrow();
    expect(() => storage.saveDraft(corrupt(original) as SkinProject)).toThrow();
    expect(await storage.draft()).toEqual(original);
  });
  it('reports corrupt, oversized and non-file imports without silently resetting them', async () => {
    const { root, storage, directory } = await fixture();
    expect(await storage.draft()).toBeNull();
    const original = project('first');
    await storage.saveDraft(original);
    await storage.saveDraft(project('second'));
    const file = path.join(directory, 'draft.json');
    await writeFile(file, '{corrupt');
    await expect(storage.draft()).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('{corrupt');
    expect(await readJson(file + '.bak')).toEqual(original);
    const large = path.join(root, 'large.kjskin'),
      handle = await open(large, 'w');
    await handle.truncate(32 * 1024 * 1024 + 1);
    await handle.close();
    await expect(storage.importProject(large)).rejects.toThrow('文件过大');
    await expect(storage.importProject(root)).rejects.toThrow();
  });
  it('serializes concurrent drafts and records the preceding complete backup', async () => {
    const { storage, directory, store } = await fixture(),
      docs = Array.from({ length: 12 }, (_, i) => project(`draft-${i}`));
    const writes = docs.map((doc) => storage.saveDraft(doc)),
      readWhileSaving = storage.draft();
    await Promise.all(writes);
    expect(await readWhileSaving).toEqual(docs.at(-1));
    expect(await new SkinEditorStorage(new Store(store.root)).draft()).toEqual(docs.at(-1));
    expect(await readJson(path.join(directory, 'draft.json.bak'))).toEqual(docs.at(-2));
    expect(await readdir(directory)).not.toContain('draft.json.tmp');
  });
  it('snapshots submitted objects before queued saves so subsequent caller edits cannot leak in', async () => {
    const { storage } = await fixture(),
      doc = project('submitted'),
      expected = structuredClone(doc),
      saved = storage.saveDraft(doc);
    doc.name = 'changed later';
    doc.layers[0].name = 'also changed';
    doc.palette.push('#ffffff');
    await saved;
    expect(await storage.draft()).toEqual(expected);
  });
  it('serializes library updates, survives restart and assigns distinct ids to copies', async () => {
    const { storage, store, directory } = await fixture(),
      id = await storage.save({ project: project('initial') });
    const docs = Array.from({ length: 5 }, (_, i) => project(`version-${i}`));
    await Promise.all(docs.map((doc) => storage.save({ id, project: doc })));
    const reopened = new SkinEditorStorage(new Store(store.root));
    expect(await reopened.open(id)).toEqual(docs.at(-1));
    expect(await readJson(path.join(directory, id + '.kjskin.bak'))).toEqual(docs.at(-2));
    expect((await reopened.list())[0]).toMatchObject({ id, name: 'version-4' });
    const copies = await Promise.all([
      reopened.save({ project: docs[4] }),
      reopened.save({ project: docs[4] }),
    ]);
    expect(new Set([id, ...copies]).size).toBe(3);
    expect(await reopened.list()).toHaveLength(3);
    await expect(reopened.open('../draft')).rejects.toThrow();
  });
  it('allows saves after a write failure without changing the previous draft', async () => {
    const { storage, directory } = await fixture(),
      original = project('original');
    await storage.saveDraft(original);
    const temporary = path.join(directory, 'draft.json.tmp');
    await mkdir(temporary);
    await expect(storage.saveDraft(project('failed'))).rejects.toThrow();
    expect(await storage.draft()).toEqual(original);
    await rm(temporary, { recursive: true });
    await storage.saveDraft(project('recovered'));
    expect((await storage.draft())?.name).toBe('recovered');
  });
});

describe('safe image and project files', () => {
  it('imports PNGs and screenshots without overwriting a source or previous export', async () => {
    const { root, storage } = await fixture(),
      source = path.join(root, 'original.png'),
      bytes = png();
    await writeFile(source, bytes);
    expect(await storage.importImage(source, 'skin')).toMatchObject({ width: 64, height: 64 });
    await expect(storage.export(project(), 'png', source)).rejects.toThrow();
    expect(await readFile(source)).toEqual(bytes);
    const target = path.join(root, 'capture.png'),
      capture = png(120, 90);
    await storage.exportCapture('data:image/png;base64,' + capture.toString('base64'), target);
    expect(PNG.sync.read(await readFile(target)).data).toEqual(pixels(120, 90));
    await expect(
      storage.exportCapture('data:image/png;base64,' + png().toString('base64'), target),
    ).rejects.toThrow();
    expect(PNG.sync.read(await readFile(target)).width).toBe(120);
    expect((await readdir(root)).filter((name) => name.startsWith('.kjmcl-export-'))).toEqual([]);
  });
  it('rejects invalid screenshot encodings without creating an output', async () => {
    const { root, storage } = await fixture(),
      target = path.join(root, 'capture.png');
    await expect(storage.exportCapture('data:image/jpeg;base64,AAAA', target)).rejects.toThrow(
      '无效',
    );
    await expect(storage.exportCapture('data:image/png;base64,AAAA', target)).rejects.toThrow(
      'PNG',
    );
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects junctions in import and export parents without touching linked contents', async () => {
    const { root, storage } = await fixture(),
      outside = path.join(root, 'outside'),
      linked = path.join(root, 'linked');
    await mkdir(outside);
    await symlink(outside, linked, 'junction');
    await writeFile(path.join(outside, 'source.png'), png());
    await writeFile(path.join(outside, 'source.kjskin'), JSON.stringify(project()));
    await expect(storage.importImage(path.join(linked, 'source.png'), 'skin')).rejects.toThrow(
      '链接',
    );
    await expect(storage.importProject(path.join(linked, 'source.kjskin'))).rejects.toThrow('链接');
    await expect(storage.export(project(), 'png', path.join(linked, 'output.png'))).rejects.toThrow(
      '链接',
    );
    await expect(
      storage.exportCapture(
        'data:image/png;base64,' + png().toString('base64'),
        path.join(linked, 'capture.png'),
      ),
    ).rejects.toThrow('链接');
    expect((await readdir(outside)).sort()).toEqual(['source.kjskin', 'source.png']);
  });
  it('rejects linked managed directories and backups before rewriting user data', async () => {
    const { root, storage, directory } = await fixture(),
      outside = path.join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, directory, 'junction');
    await expect(storage.saveDraft(project())).rejects.toThrow('链接');
    expect(await readdir(outside)).toEqual([]);
    await rm(directory);
    await storage.saveDraft(project('keep'));
    await symlink(outside, path.join(directory, 'draft.json.bak'), 'junction');
    await expect(storage.saveDraft(project('rejected'))).rejects.toThrow('链接');
    expect((await storage.draft())?.name).toBe('keep');
    expect(await readdir(outside)).toEqual([]);
  });
});

describe('explicit recovery and project versions', () => {
  it('reads a valid draft backup without mutating either the corrupt draft or its backup', async () => {
    const { storage, directory } = await fixture();
    expect(await storage.recoverDraft()).toBeNull();
    const original = project('recoverable');
    await storage.saveDraft(original);
    await storage.saveDraft(project('newer'));
    const draft = path.join(directory, 'draft.json');
    await writeFile(draft, 'broken draft');
    const backup = await readFile(draft + '.bak');
    expect(await storage.recoverDraft()).toEqual(original);
    expect(await readFile(draft, 'utf8')).toBe('broken draft');
    expect(await readFile(draft + '.bak')).toEqual(backup);
    await writeFile(draft + '.bak', 'broken backup');
    await expect(storage.recoverDraft()).rejects.toThrow();
    expect(await readFile(draft + '.bak', 'utf8')).toBe('broken backup');
  });
  it('preserves a corrupt original separately and keeps the good backup when explicitly saving recovered work', async () => {
    const { storage, directory } = await fixture(),
      original = project('recoverable');
    await storage.saveDraft(original);
    await storage.saveDraft(project('newer'));
    const draft = path.join(directory, 'draft.json');
    await writeFile(draft, '{corrupt original');
    const recovered = await storage.recoverDraft();
    expect(recovered).toEqual(original);
    await storage.saveDraft(recovered!);
    expect(await storage.draft()).toEqual(original);
    expect(await storage.recoverDraft()).toEqual(original);
    const retained = (await readdir(directory)).filter((name) => name.startsWith('draft.corrupt-'));
    expect(retained).toHaveLength(1);
    expect(await readFile(path.join(directory, retained[0]), 'utf8')).toBe('{corrupt original');
  });
  it('keeps the latest 20 preceding versions in chronological order and restores without replacing current files', async () => {
    const { storage, directory, store } = await fixture();
    const id = await storage.save({ project: project('v0') });
    expect(await storage.versions(id)).toEqual([]);
    await storage.saveDraft(project('separate draft'));
    await Promise.all(
      Array.from({ length: 23 }, (_, i) => storage.save({ id, project: project(`v${i + 1}`) })),
    );
    const reopened = new SkinEditorStorage(new Store(store.root)),
      versions = await reopened.versions(id);
    expect(versions).toHaveLength(20);
    expect(versions.map((v) => v.name)).toEqual(Array.from({ length: 20 }, (_, i) => `v${22 - i}`));
    expect(versions.every((v, i) => i === 0 || versions[i - 1].createdAt > v.createdAt)).toBe(true);
    expect(versions[0]).toMatchObject({ name: 'v22', model: 'classic', resolution: 64 });
    expect((await reopened.restoreVersion(id, versions.at(-1)!.versionId)).name).toBe('v3');
    expect((await reopened.open(id)).name).toBe('v23');
    expect((await reopened.draft())?.name).toBe('separate draft');
    expect((await readJson(path.join(directory, id + '.kjskin.bak'))).name).toBe('v22');
    expect(await readdir(path.join(directory, 'versions', id))).toHaveLength(20);
    await expect(reopened.versions('../escape')).rejects.toThrow();
    await expect(reopened.restoreVersion(id, '../escape')).rejects.toThrow();
  });
  it('rejects corrupt versions and linked version directories without changing the current project', async () => {
    const { storage, directory, root } = await fixture(),
      id = await storage.save({ project: project('original') });
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await mkdir(path.join(directory, 'versions'));
    await symlink(outside, path.join(directory, 'versions', id), 'junction');
    await expect(storage.save({ id, project: project('rejected') })).rejects.toThrow('链接');
    await expect(storage.versions(id)).rejects.toThrow('链接');
    expect((await storage.open(id)).name).toBe('original');
    expect(await readdir(outside)).toEqual([]);
    await rm(path.join(directory, 'versions', id));
    await storage.save({ id, project: project('next') });
    const [version] = await storage.versions(id),
      versionPath = path.join(directory, 'versions', id, version.versionId + '.json');
    const saved = await readJson(versionPath);
    await writeFile(versionPath, JSON.stringify({ ...saved, schemaVersion: 999 }));
    await expect(storage.restoreVersion(id, version.versionId)).rejects.toThrow();
    expect((await storage.open(id)).name).toBe('next');
  });
  it('trashes only a selected project, its backups and versions after validating every target', async () => {
    const { storage, directory } = await fixture(),
      id = await storage.save({ project: project('old') });
    await storage.save({ id, project: project('new') });
    const keep = await storage.save({ project: project('keep') });
    const trashed: string[] = [];
    await storage.remove(id, async (file) => {
      trashed.push(path.relative(directory, file));
      await rm(file, { recursive: true });
    });
    expect(trashed.sort()).toEqual(
      [
        id + '.kjskin',
        id + '.kjskin.bak',
        id + '.meta.json',
        id + '.meta.json.bak',
        path.join('versions', id),
      ].sort(),
    );
    expect((await storage.list()).map((entry) => entry.id)).toEqual([keep]);
    expect(await storage.versions(id)).toEqual([]);
  });
});

describe('palette files', () => {
  it('round-trips versioned palettes, exact color order and alpha without uploading or overwriting', async () => {
    const { root, storage } = await fixture(),
      file = path.join(root, 'palette.json');
    const palette = {
      name: '衣服与阴影',
      colors: ['#123456', '#AbCdEf80', '#00000000', '#ffffff'],
    };
    await storage.exportPalette(palette, file);
    expect(await readJson(file)).toEqual({ schemaVersion: 1, ...palette });
    expect(await storage.importPalette(file)).toEqual(palette);
    const original = await readFile(file);
    await expect(
      storage.exportPalette({ name: 'replacement', colors: ['#ff0000'] }, file),
    ).rejects.toThrow();
    expect(await readFile(file)).toEqual(original);
  });
  it.each([
    { schemaVersion: 2, name: 'future', colors: ['#ffffff'] },
    { schemaVersion: 1, name: '', colors: ['#ffffff'] },
    { schemaVersion: 1, name: 'empty', colors: [] },
    { schemaVersion: 1, name: 'invalid alpha', colors: ['#ffffff1'] },
    { schemaVersion: 1, name: 'excess', colors: Array.from({ length: 65 }, () => '#ffffff') },
    { schemaVersion: 1, name: 'unknown field', colors: ['#ffffff'], unrecognized: true },
  ])('rejects invalid palette content %# without changing its source', async (value) => {
    const { root, storage } = await fixture(),
      file = path.join(root, 'invalid.json'),
      text = JSON.stringify(value);
    await writeFile(file, text);
    await expect(storage.importPalette(file)).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe(text);
  });
  it('bounds files to 32 KiB and rejects linked imports and destinations', async () => {
    const { root, storage } = await fixture(),
      large = path.join(root, 'large.json');
    await writeFile(large, ' '.repeat(32 * 1024 + 1));
    await expect(storage.importPalette(large)).rejects.toThrow('文件过大');
    const outside = path.join(root, 'outside'),
      link = path.join(root, 'linked');
    await mkdir(outside);
    await symlink(outside, link, 'junction');
    await writeFile(
      path.join(outside, 'palette.json'),
      JSON.stringify({ schemaVersion: 1, name: 'reference', colors: ['#ff6600'] }),
    );
    await expect(storage.importPalette(path.join(link, 'palette.json'))).rejects.toThrow('链接');
    await expect(
      storage.exportPalette({ name: 'output', colors: ['#ff6600'] }, path.join(link, 'new.json')),
    ).rejects.toThrow('链接');
    expect(await readdir(outside)).toEqual(['palette.json']);
  });
});
