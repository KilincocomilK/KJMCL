// Actual Electron, named preload, native core and disposable files; only picker paths are supplied by the test.
import { _electron as electron, expect } from '@playwright/test';
import { cp, mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { PNG } from 'pngjs';
import { firstVisibleWindow, selectLauncherOption } from './desktop-test-utils.mjs';
import {
  writeProjectionFixtures,
  fixtureGeometry,
  readProjection,
} from '../tests/fixtures/projection-nbt.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-projection-desktop-')),
  data = path.join(root, 'data'),
  shots = path.join(root, 'screenshots');
await mkdir(shots);
try {
  await cp(
    path.resolve('.local/projection-render-assets/projection-workshop/assets'),
    path.join(data, 'projection-workshop/assets'),
    { recursive: true },
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const files = await writeProjectionFixtures(root),
  checks = [],
  errors = [];
const env = { ...process.env, KJMCL_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
const options = { args: ['.'], env };
let app, page;
const work = () => page.getByLabel('投影工坊', { exact: true });
const canvas = () => page.getByLabel('投影 3D 视图', { exact: true });
const state = () => page.evaluate(() => window.kjmcl.projectionState());
const ref = (doc) => ({ id: doc.id, revision: doc.revision });
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const states = (r) =>
  r.blocks.map((index) => {
    const b = r.palette[index];
    if (!b) return 'minecraft:air';
    const [name, rest] = b.Name.split('[');
    const p =
      b.Properties ||
      Object.fromEntries(
        (rest?.replace(/\]$/, '') || '')
          .split(',')
          .filter(Boolean)
          .map((pair) => pair.split('=')),
      );
    return name + JSON.stringify(Object.fromEntries(Object.entries(p).sort()));
  });
const dataStates = (doc) => {
  const bytes = Buffer.from(doc.blocks, 'base64');
  return Array.from({ length: bytes.length / 4 }, (_, i) => {
    const b = doc.palette[bytes.readUInt32LE(i * 4)];
    return b.name + JSON.stringify(Object.fromEntries(Object.entries(b.properties || {}).sort()));
  });
};
async function launch() {
  app = await electron.launch(options);
  page = await firstVisibleWindow(app);
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1450, 950),
  );
  expect(await realpath((await page.evaluate(() => window.kjmcl.snapshot())).dataPath)).toBe(
    await realpath(data),
  );
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  await enter();
}
async function enter() {
  await page.getByRole('button', { name: '工具箱', exact: true }).click();
  await page.getByRole('button', { name: /^投影工坊/ }).click();
  await expect(work()).toBeVisible();
}
async function close() {
  if (app) {
    await app.close();
    app = undefined;
  }
}
async function picker(kind, file) {
  const relative = path.relative(root, path.resolve(file));
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Picker outside fixture');
  await app.evaluate(
    ({ dialog }, { kind, file }) => {
      if (kind === 'open')
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      else dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    },
    { kind, file },
  );
}
async function rendered() {
  await expect(canvas()).toBeVisible();
  await expect(work().locator('.projection-viewport')).toHaveAttribute(
    'data-render-status',
    'ready',
    { timeout: 180000 },
  );
  await expect.poll(() => canvas().evaluate((c) => c.width * c.height)).toBeGreaterThan(10000);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
try {
  await launch();
  expect((await state()).entries).toEqual([]);
  const originalHash = digest(await readFile(files.litematic));
  await picker('open', files.litematic);
  await work().getByRole('button', { name: '打开投影', exact: true }).first().click();
  await expect.poll(async () => (await state()).current?.nonAir, { timeout: 30000 }).toBe(101);
  await rendered();
  const gridBox = await work().getByRole('checkbox', { name: '网格', exact: true }).boundingBox();
  expect(gridBox.height).toBe(gridBox.width);
  let doc = (await state()).current;
  expect(doc.dimensions).toEqual([8, 5, 7]);
  expect(dataStates(doc)).toEqual(states(readProjection(await readFile(files.litematic))));
  const initial = doc;
  // Test all codecs with independently encoded inputs, including signed region dimensions.
  for (const key of ['negative', 'schem', 'schem2', 'nbt']) {
    const imported = await page.evaluate((file) => window.kjmcl.projectionImport(file), files[key]);
    expect(imported.dimensions).toEqual([8, 5, 7]);
    expect(imported.nonAir).toBe(101);
    expect(dataStates(imported)).toEqual(dataStates(initial));
    if (key === 'negative') expect(imported.origin).toEqual([4, -2, -13]);
  }
  await page.evaluate((id) => window.kjmcl.projectionOpen(id), initial.id);
  await enter();
  await rendered();
  doc = (await state()).current;
  checks.push(
    'independent Litematic v6/v7, Sponge v2/v3 and structure NBT fixtures through actual native core',
  );
  const material = await page.evaluate((value) => window.kjmcl.projectionSelect(value), {
    ...ref(doc),
    selection: { mode: 'material', index: 0 },
  });
  expect(material.indices).toHaveLength(56);
  const connected = await page.evaluate((value) => window.kjmcl.projectionSelect(value), {
    ...ref(doc),
    selection: { mode: 'connected', index: 0 },
  });
  expect(connected.indices).toHaveLength(95);
  const deleted = await page.evaluate((value) => window.kjmcl.projectionEdit(value), {
    ...ref(doc),
    op: { kind: 'delete', indices: [0, 1] },
  });
  expect(deleted.nonAir).toBe(99);
  const stale = await page.evaluate(
    async (value) => {
      try {
        await window.kjmcl.projectionEdit(value);
        return false;
      } catch {
        return true;
      }
    },
    { ...ref(doc), op: { kind: 'delete', indices: [2] } },
  );
  expect(stale).toBe(true);
  doc = await page.evaluate((value) => window.kjmcl.projectionUndo(value), ref(deleted));
  expect(dataStates(doc)).toEqual(dataStates(initial));
  const redone = await page.evaluate((value) => window.kjmcl.projectionRedo(value), ref(doc));
  expect(redone.nonAir).toBe(99);
  doc = await page.evaluate((value) => window.kjmcl.projectionUndo(value), ref(redone));
  const rotated = await page.evaluate((value) => window.kjmcl.projectionEdit(value), {
    ...ref(doc),
    op: { kind: 'rotate', direction: 'cw' },
  });
  expect(rotated.dimensions).toEqual([7, 5, 8]);
  expect(
    rotated.palette.some(
      (b) => b.name === 'minecraft:oak_stairs' && b.properties?.facing === 'east',
    ),
  ).toBe(true);
  doc = await page.evaluate((value) => window.kjmcl.projectionUndo(value), ref(rotated));
  checks.push(
    'material/connected selections, edits, stale revision rejection, undo/redo and directional rotation',
  );
  for (const format of ['litematic', 'schem', 'nbt', 'materials']) {
    const file = path.join(root, 'export.' + (format === 'materials' ? 'csv' : format));
    await picker('save', file);
    expect(
      await page.evaluate((value) => window.kjmcl.projectionExport(value), { ...ref(doc), format }),
    ).toBe(file);
    if (format === 'materials') {
      expect(await readFile(file, 'utf8')).toContain('minecraft:stone');
    } else {
      const decoded = readProjection(await readFile(file));
      expect(decoded.dimensions).toEqual(doc.dimensions);
      expect(states(decoded)).toEqual(dataStates(doc));
    }
  }
  expect(digest(await readFile(files.litematic))).toBe(originalHash);
  checks.push(
    'three exported formats decoded independently, material CSV and source bytes retained',
  );
  // Refresh from the real persisted document before visible viewport controls.
  await enter();
  await rendered();
  await selectLauncherOption(page, '投影视角', 'top');
  await work().getByRole('button', { name: '单选', exact: true }).click();
  const bounds = await canvas().boundingBox();
  // This even-width fixture has a block seam at the exact view center.
  await canvas().click({ position: { x: bounds.width / 2 + 12, y: bounds.height / 2 + 12 } });
  await expect(work().getByRole('button', { name: '删除所选', exact: true })).toBeEnabled();
  await work().getByRole('button', { name: '删除所选', exact: true }).click();
  await expect.poll(async () => (await state()).current.nonAir).toBe(100);
  await work().getByRole('button', { name: '撤销投影编辑', exact: true }).click();
  await expect.poll(async () => (await state()).current.nonAir).toBe(101);
  checks.push('visible WebGL picking and deletion/undo through toolbox UI');
  for (let i = 0; i < 5; i++) {
    await work().getByRole('button', { name: '全屏投影', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.kjmcl.windowFullscreen())).toBe(true);
    await expect(work().getByRole('button', { name: '退出工坊全屏', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.kjmcl.windowFullscreen())).toBe(false);
  }
  await page.screenshot({ path: path.join(shots, 'projection-wide.png'), fullPage: true });
  const image = await canvas().evaluate((c) => c.toDataURL('image/png'));
  const pngPath = path.join(root, 'view.png');
  await picker('save', pngPath);
  doc = (await state()).current;
  await page.evaluate((value) => window.kjmcl.projectionExport(value), {
    ...ref(doc),
    format: 'png',
    image,
  });
  const decoded = PNG.sync.read(await readFile(pngPath)),
    colors = new Set();
  for (let i = 0; i < decoded.data.length; i += 128)
    colors.add(decoded.data.subarray(i, i + 3).join(','));
  expect(colors.size).toBeGreaterThan(8);
  const instance = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: '投影测试', version: '1.21.4', loader: 'vanilla' }),
  );
  const installed = await page.evaluate((value) => window.kjmcl.projectionInstall(value), {
    ...ref(doc),
    instanceId: instance,
    format: 'litematic',
  });
  const installedRelative = path.relative(await realpath(data), await realpath(installed));
  expect(installedRelative.startsWith('..') || path.isAbsolute(installedRelative)).toBe(false);
  expect(states(readProjection(await readFile(installed)))).toEqual(dataStates(doc));
  checks.push(
    'five native fullscreen/Esc cycles, actual PNG pixels and install into disposable instance',
  );
  const expected = await state();
  await close();
  await launch();
  expect(await state()).toEqual(expected);
  await rendered();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(960, 650),
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: path.join(shots, 'projection-960.png'), fullPage: true });
  await page.getByRole('button', { name: '返回工具箱', exact: true }).click();
  await page.getByRole('button', { name: /^种子地图/ }).click();
  await enter();
  expect((await state()).current.revision).toBe(expected.current.revision);
  checks.push('actual close/restart recovery, toolbox round-trip and 960px layout');
  await close();
  expect(errors).toEqual([]);
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        checks,
        screenshots: shots,
        fixture: 'synthetic independent NBT; no Minecraft/mod acceptance',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, artifacts: root, checks }));
} catch (error) {
  await page?.screenshot({ path: path.join(shots, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify({ error: String(error), errors, checks }, null, 2),
  );
  console.error('Projection desktop failed, artifacts: ' + root);
  throw error;
} finally {
  await close();
}
