// Real Electron + named preload + native import + official Minecraft assets.
// Only native file-picker answers are supplied by this test. Build first.
import { _electron as electron, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { firstVisibleWindow, selectLauncherOption } from './desktop-test-utils.mjs';
import { writeProjectionRenderFixture } from '../tests/fixtures/projection-render.mjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-projection-render-'));
const data = path.join(temporary, 'data');
const artifactParent = path.resolve('.local/projection-render-desktop');
await mkdir(artifactParent, { recursive: true });
const artifacts = await mkdtemp(path.join(artifactParent, 'run-'));
const fixture = await writeProjectionRenderFixture(temporary);
const cachedAssets = path.resolve('.local/projection-render-assets/projection-workshop/assets');
try {
  await cp(cachedAssets, path.join(data, 'projection-workshop/assets'), { recursive: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const env = { ...process.env, KJMCL_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
const checks = [],
  errors = [],
  observations = {};
let app, page;
const workshop = () => page.getByLabel('投影工坊', { exact: true });
const canvas = () => page.getByLabel('投影 3D 视图', { exact: true });
const viewport = () => workshop().locator('.projection-viewport');
const button = (name) => workshop().getByRole('button', { name, exact: true });
const state = () => page.evaluate(() => window.kjmcl.projectionState());
const revision = async () => (await state()).current.revision;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pauseFrame = () =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
async function ready() {
  await expect(viewport()).toHaveAttribute('data-render-status', 'ready', { timeout: 180000 });
  await expect
    .poll(async () => Number(await viewport().getAttribute('data-render-quads')))
    .toBeGreaterThan(0);
  await pauseFrame();
}
async function picture(name) {
  await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: true });
  const image = await canvas().evaluate((node) => node.toDataURL('image/png'));
  const bytes = Buffer.from(image.split(',')[1], 'base64');
  await writeFile(path.join(artifacts, `${name}-canvas.png`), bytes);
  return PNG.sync.read(bytes);
}
async function pixels() {
  const dataUrl = await canvas().evaluate((node) => node.toDataURL('image/png'));
  return PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
}
// Known orthographic camera framing is observable UI behaviour. No production
// Three objects, internal renderer methods or writable test globals are exposed.
async function screen(point, view) {
  const box = await canvas().boundingBox();
  const [w, h, d] = fixture.dimensions,
    scale = box.height / (Math.max(w, h, d, 2) * 1.5);
  const horizontal = view === 'side' ? d / 2 - point[2] : point[0] - w / 2;
  const vertical = view === 'top' ? d / 2 - point[2] : point[1] - h / 2;
  return { x: box.width / 2 + horizontal * scale, y: box.height / 2 - vertical * scale, box };
}
async function clickAt(point, view) {
  const { x, y } = await screen(point, view);
  await canvas().click({ position: { x, y } });
  await pauseFrame();
}
async function colorAt(image, point, view, radius = 1) {
  const { x, y, box } = await screen(point, view);
  const px = Math.round((x / box.width) * image.width),
    py = Math.round((y / box.height) * image.height);
  const total = [0, 0, 0];
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const offset = ((py + dy) * image.width + px + dx) * 4;
      for (let c = 0; c < 3; c++) total[c] += image.data[offset + c] / (2 * radius + 1) ** 2;
    }
  return total.map(Math.round);
}
async function cropHash(image, point, view) {
  const { x, y, box } = await screen(point, view);
  const px = Math.round((x / box.width) * image.width),
    py = Math.round((y / box.height) * image.height);
  const radius = Math.max(2, Math.floor((image.height / 36) * 0.3)),
    rows = [];
  for (let dy = -radius; dy <= radius; dy++)
    rows.push(
      image.data.subarray(
        ((py + dy) * image.width + px - radius) * 4,
        ((py + dy) * image.width + px + radius + 1) * 4,
      ),
    );
  return digest(Buffer.concat(rows));
}
async function changed(action) {
  const before = await revision();
  await action();
  await expect.poll(revision).not.toBe(before);
  await ready();
}
async function picker(kind, file) {
  const relative = path.relative(temporary, path.resolve(file));
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Picker outside disposable fixture');
  await app.evaluate(
    ({ dialog }, value) => {
      if (value.kind === 'open')
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [value.file] });
      else dialog.showSaveDialog = async () => ({ canceled: false, filePath: value.file });
    },
    { kind, file },
  );
}

try {
  app = await electron.launch({ args: ['.'], env });
  page = await firstVisibleWindow(app);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.isVisible())
      .setSize(1600, 1000),
  );
  const snapshot = await page.evaluate(() => window.kjmcl.snapshot());
  expect(await realpath(snapshot.dataPath)).toBe(await realpath(data));
  expect(snapshot.accounts).toEqual([]);
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  await page.getByRole('button', { name: '工具箱', exact: true }).click();
  await page.getByRole('button', { name: /^投影工坊/ }).click();
  await picker('open', fixture.file);
  await button('打开投影').first().click();
  await expect
    .poll(async () => (await state()).current?.nonAir, { timeout: 30000 })
    .toBe(fixture.nonAir);
  await ready();
  const doc = (await state()).current;
  expect(doc.dimensions).toEqual(fixture.dimensions);
  const assets = await page.evaluate(
    (blocks) => window.kjmcl.projectionAssets({ blocks }),
    [...new Set(fixture.palette.map((entry) => entry.name))],
  );
  expect(assets.missing).toEqual([]);
  expect(Object.keys(assets.models).length).toBeGreaterThan(20);
  expect(assets.blockstates['minecraft:oak_stairs']).toBeTruthy();
  expect(assets.animations['minecraft:block/water_still']).toBeTruthy();
  const textureChecks = {};
  for (const key of [
    'minecraft:block/oak_planks',
    'minecraft:block/water_still',
    'minecraft:entity/chest/normal',
  ]) {
    const textureBytes = Buffer.from(assets.textures[key], 'base64');
    expect([...textureBytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const texture = PNG.sync.read(textureBytes),
      colors = new Set();
    for (let i = 0; i < texture.data.length; i += 4)
      colors.add(texture.data.subarray(i, i + 4).join(','));
    expect(colors.size).toBeGreaterThan(5);
    textureChecks[key] = {
      sha256: digest(textureBytes),
      width: texture.width,
      height: texture.height,
      colors: colors.size,
    };
  }
  observations.assets = {
    version: assets.version,
    source: assets.source,
    textures: Object.keys(assets.textures).length,
    checks: textureChecks,
  };
  expect(Number(await viewport().getAttribute('data-render-textures'))).toBeGreaterThan(15);
  checks.push(
    'independent NBT imported through native core; original PNG, model and animation resources through named preload',
  );
  await workshop().getByRole('checkbox', { name: '网格', exact: true }).uncheck();
  await picture('01-gallery');

  await selectLauncherOption(page, '投影视角', 'side');
  await button('清除选择').click();
  await button('单选').click();
  await clickAt([2.5, 3.75, 13.75], 'side');
  await expect(button('删除所选')).toBeDisabled();
  await clickAt([2.5, 3.25, 13.75], 'side');
  await expect(button('删除所选')).toBeEnabled();
  await expect(workshop().locator('.projection-selected-info small')).toHaveText('2, 3, 13');
  await picture('02-stair-picking');
  await button('清除选择').click();
  checks.push('side-view ray misses the empty stair corner and picks its actual lower half');

  await selectLauncherOption(page, '投影视角', 'front');
  const transparent = await picture('03-transparency');
  const marker = await colorAt(transparent, [14.5, 1.5, 12.5], 'front');
  const empty = await colorAt(transparent, [16.5, 1.5, 12.5], 'front');
  observations.transparency = { redBlockThroughWhiteGlass: marker, whiteGlassWithoutBlock: empty };
  expect(marker[0] - empty[0]).toBeGreaterThan(15);
  expect(marker[0]).toBeGreaterThan(marker[1] + 15);
  checks.push('actual framebuffer shows a red block through translucent stained glass');

  const dryWood = await colorAt(transparent, [3.5, 1.25, 7.5], 'front');
  const wetWood = await colorAt(transparent, [4.5, 1.25, 7.5], 'front');
  const exposedWater = await colorAt(transparent, [4.5, 1.7, 7.5], 'front');
  expect(dryWood[0]).toBeGreaterThan(dryWood[2] + 25);
  expect(
    Math.max(...dryWood.map((value, index) => Math.abs(value - wetWood[index]))),
  ).toBeLessThanOrEqual(12);
  expect(exposedWater[2]).toBeGreaterThan(exposedWater[0] + 8);
  expect(exposedWater[2]).toBeGreaterThan(40);
  const waterFrame = Number(await viewport().getAttribute('data-render-animation-frame'));
  await expect
    .poll(async () => Number(await viewport().getAttribute('data-render-animation-frame')), {
      timeout: 10000,
    })
    .toBeGreaterThan(waterFrame + 4);
  const wetWoodAfterAnimation = await colorAt(await pixels(), [4.5, 1.25, 7.5], 'front');
  expect(wetWoodAfterAnimation).toEqual(wetWood);
  observations.waterloggedSlab = { dryWood, wetWood, exposedWater, wetWoodAfterAnimation };
  checks.push(
    'waterlogged slab retains the dry wood side color while its exposed upper water remains visible and animated',
  );
  // Sample the narrow strip that is empty when source water incorrectly keeps
  // its exposed 0.8875 height beneath a waterlogged neighbour. A single center
  // pixel avoids averaging that strip with either neighbouring block face.
  const waterConnection = await colorAt(transparent, [20.5, 1.95, 7.5], 'front', 0);
  expect(waterConnection[2]).toBeGreaterThan(waterConnection[0] + 8);
  expect(waterConnection[2]).toBeGreaterThan(40);
  observations.waterloggedConnection = { belowSharedFace: waterConnection };
  checks.push('source water reaches the shared face beneath a waterlogged slab without an air gap');

  await selectLauncherOption(page, '投影视角', 'top');
  await pauseFrame();
  const initialFrame = Number(await viewport().getAttribute('data-render-animation-frame'));
  const lavaBefore = await cropHash(await pixels(), [6.5, 1.5, 7.5], 'top');
  await expect
    .poll(async () => Number(await viewport().getAttribute('data-render-animation-frame')), {
      timeout: 10000,
    })
    .toBeGreaterThan(initialFrame + 4);
  await expect
    .poll(async () => cropHash(await pixels(), [6.5, 1.5, 7.5], 'top'), { timeout: 10000 })
    .not.toBe(lavaBefore);
  await picture('04-animated-fluid');
  checks.push('animation advances the atlas and changes real lava pixels');

  await button('测量').click();
  await clickAt([1.5, 1.5, 2.5], 'top');
  await clickAt([3.5, 1.5, 2.5], 'top');
  await expect(workshop().locator('.projection-measure')).toContainText('2.00 格');
  await button('框选').click();
  const start = await screen([0.8, 1, 1.8], 'top'),
    finish = await screen([4.2, 1, 3.2], 'top');
  await page.mouse.move(start.box.x + start.x, start.box.y + start.y);
  await page.mouse.down();
  await page.mouse.move(finish.box.x + finish.x, finish.box.y + finish.y, { steps: 4 });
  await page.mouse.up();
  await expect(button('隐藏所选')).toBeEnabled();
  const allQuads = Number(await viewport().getAttribute('data-render-quads'));
  await button('隐藏所选').click();
  await expect
    .poll(async () => Number(await viewport().getAttribute('data-render-quads')))
    .toBeLessThan(allQuads);
  await button('全部显示').click();
  await button('清除选择').click();
  await button('单选').click();
  await clickAt([1.5, 1.5, 2.5], 'top');
  await button('相同材料').click();
  await expect(button('仅显示所选')).toBeEnabled();
  await button('仅显示所选').click();
  await ready();
  await button('全部显示').click();
  await button('清除选择').click();
  await clickAt([1.5, 1.5, 2.5], 'top');
  await workshop().getByLabel('替换方块', { exact: true }).fill('minecraft:bricks');
  await changed(() => button('替换所选').click());
  await changed(() => button('撤销投影编辑').click());
  await changed(() => button('重做投影编辑').click());
  await changed(() => button('撤销投影编辑').click());
  for (const name of ['顺时针旋转', '沿 X 轴镜像', '沿 Z 轴镜像']) {
    await changed(() => button(name).click());
    await changed(() => button('撤销投影编辑').click());
  }
  checks.push(
    'textured measurement, screen selection, visibility, material selection, replace, undo/redo, rotate and mirror',
  );

  await workshop().getByLabel('结束层', { exact: true }).fill('1');
  await workshop().getByLabel('结束层', { exact: true }).press('Tab');
  await button('仅此层').click();
  await ready();
  await button('全部层').click();
  const spacing = workshop().getByLabel('层间距', { exact: true });
  await spacing.focus();
  await spacing.press('Home');
  for (let i = 0; i < 8; i++) await spacing.press('ArrowRight');
  await expect(spacing).toHaveValue('0.8');
  await ready();
  await button('复位').click();
  await picture('05-exploded');
  await spacing.press('Home');
  await button('全屏投影').click();
  await expect.poll(() => page.evaluate(() => window.kjmcl.windowFullscreen())).toBe(true);
  await expect(button('退出工坊全屏')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.kjmcl.windowFullscreen())).toBe(false);
  await button('材料').click();
  await workshop().getByLabel('筛选材料', { exact: true }).fill('oak_stairs');
  await expect(workshop().locator('.projection-panel')).toContainText('oak_stairs');
  await button('编辑').click();
  await page.getByRole('button', { name: '返回工具箱', exact: true }).click();
  await page.getByRole('button', { name: /^投影工坊/ }).click();
  await ready();
  await picture('06-restored');
  checks.push(
    'layer slicing, exploded spacing, fullscreen/Esc, materials and toolbox re-entry with textured scene',
  );
  expect(errors).toEqual([]);
  observations.geometry = {
    quads: Number(await viewport().getAttribute('data-render-quads')),
    textures: Number(await viewport().getAttribute('data-render-textures')),
    nonAir: fixture.nonAir,
  };
  await writeFile(
    path.join(artifacts, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        checks,
        observations,
        data,
        fixture: fixture.file,
        scope:
          'Actual Windows Electron/WebGL with official Minecraft assets; synthetic structure, not an in-game acceptance run.',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, artifacts, checks, observations }));
} catch (error) {
  await page
    ?.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true })
    .catch(() => {});
  await writeFile(
    path.join(artifacts, 'failure.json'),
    JSON.stringify({ error: String(error), errors, checks, observations, data }, null, 2),
  );
  console.error('Projection rendering failed, artifacts: ' + artifacts);
  throw error;
} finally {
  await app?.close();
}
