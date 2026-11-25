// Actual Electron/preload/native generation and filesystem persistence. Only file pickers use fixture paths.
// Run after npm run build; all accounts, instances and output files stay in a disposable temp directory.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PNG } from 'pngjs';
import { firstVisibleWindow, selectLauncherOption } from './desktop-test-utils.mjs';
import { levelFixture } from './save-fixtures.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-seed-map-desktop-'));
const data = path.join(root, 'data'),
  shots = path.join(root, 'screenshots'),
  world = path.join(root, 'Seed Fixture');
await mkdir(shots);
await mkdir(world);
await writeFile(path.join(world, 'level.dat'), levelFixture());
const env = { ...process.env, KJMCL_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
const executablePath = process.env.KJMCL_TEST_EXECUTABLE || process.env.KJMCL_EXECUTABLE;
const options = executablePath ? { executablePath, args: [], env } : { args: ['.'], env };
const measurements = { startedAt: Date.now(), nativeTileMs: [] };
const checks = [],
  errors = [],
  files = {
    project: path.join(root, 'map.kjmap'),
    markers: path.join(root, 'markers.json'),
    png: path.join(root, 'map.png'),
  };
const workspace = path.join(data, 'seed-map', 'workspace.json');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
let app, page;
// The storage reader waits for queued writes before opening the workspace on Windows.
const disk = () => page.evaluate(() => window.kjmcl.seedMapState());
const map = () => page.getByLabel('种子地图查看器', { exact: true });
const canvas = () => page.getByLabel('种子地图画布', { exact: true });
async function launch() {
  app = await electron.launch(options);
  page = await firstVisibleWindow(app);
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1450, 950),
  );
  const snapshot = await page.evaluate(() => window.kjmcl.snapshot());
  expect(await realpath(snapshot.dataPath)).toBe(await realpath(data));
  expect(snapshot.accounts).toEqual([]);
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  await page.getByRole('button', { name: '工具箱', exact: true }).click();
  await page.getByRole('button', { name: /^种子地图/ }).click();
  await expect(map().getByLabel('世界种子', { exact: true })).toBeVisible();
}
async function close() {
  if (app) {
    await app.close();
    app = undefined;
  }
}
async function picker(kind, file) {
  const relative = path.relative(root, path.resolve(file));
  if (path.isAbsolute(relative) || relative.startsWith('..'))
    throw new Error('Picker outside disposable fixture');
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
  await expect(map().locator('.seed-status')).not.toContainText(/生成地图|查询结构/, {
    timeout: 60000,
  });
  await expect(map().getByRole('alert')).toHaveCount(0);
  await expect
    .poll(
      () =>
        canvas().evaluate((c) => {
          const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data,
            colors = new Set();
          for (let i = 0; i < pixels.length; i += 256)
            colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
          return colors.size;
        }),
      { timeout: 60000 },
    )
    .toBeGreaterThan(3);
}
async function jump(x, z) {
  await map().getByLabel('跳转 X', { exact: true }).fill(String(x));
  await map().getByLabel('跳转 Z', { exact: true }).fill(String(z));
  await map().getByRole('button', { name: '跳转', exact: true }).click();
  await expect
    .poll(async () => ({
      x: (await disk())?.current?.centerX,
      z: (await disk())?.current?.centerZ,
    }))
    .toEqual({ x, z });
}
async function exportFile(label, file) {
  await picker('save', file);
  const menu = map().locator('.seed-menu');
  if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
  await menu.getByRole('button', { name: label, exact: true }).click();
  await expect
    .poll(
      () =>
        readFile(file).then(
          () => true,
          () => false,
        ),
      { timeout: 20000 },
    )
    .toBe(true);
  if ((await menu.getAttribute('open')) !== null) await menu.locator('summary').click();
}
try {
  await launch();
  const info = await page.evaluate(() => window.kjmcl.seedMapInfo());
  expect(info.versions.map((v) => v.id)).toEqual(
    expect.arrayContaining(['1.21.5', '26.1', '26.2', '26.3']),
  );
  expect(info.biomes.map((b) => b.id)).toEqual(expect.arrayContaining([187, 188]));
  expect(info.structures.map((s) => s.id)).toContain('abandoned_camp');
  expect(await page.evaluate(() => window.kjmcl.seedMapSeed('🌱'))).toEqual({
    seed: '1773173',
    input: '🌱',
  });
  const random = await page.evaluate(async () =>
    Promise.all(Array.from({ length: 8 }, () => window.kjmcl.seedMapRandom())),
  );
  expect(new Set(random).size).toBe(8);
  expect(random.every((s) => BigInt(s) >= -(1n << 63n) && BigInt(s) < 1n << 63n)).toBe(true);
  const base = {
    seed: '-3829811542736183482',
    version: '26.3',
    dimension: 'overworld',
    y: 77,
    largeBiomes: false,
  };
  const point = await page.evaluate(
    (query) => window.kjmcl.seedMapBiome({ ...query, requestId: 'known_26_3', x: 68148, z: 80990 }),
    base,
  );
  expect(point.id).toBe(188);
  // Independent java.util.Random reference values, including overflowing int products.
  for (const [seed, chunkX, chunkZ, expected] of [
    ['0', -345, -223, true],
    ['262', -16, 5, true],
    ['9007199254740993', -1875000, 1874999, true],
    ['9007199254740993', 1874999, -1875000, false],
  ]) {
    const sample = await page.evaluate((query) => window.kjmcl.seedMapBiome(query), {
      ...base,
      seed,
      requestId: `slime_${chunkX}_${chunkZ}`,
      x: chunkX * 16,
      z: chunkZ * 16,
    });
    expect(sample.slime).toBe(expected);
  }
  for (const [version, expected] of [
    ['26.2', 43],
    ['26.3', 42],
  ]) {
    const tile = await page.evaluate((query) => window.kjmcl.seedMapTile(query), {
      ...base,
      seed: '856461443495910397',
      version,
      dimension: 'end',
      y: 0,
      requestId: 'end_' + version.replace('.', '_'),
      x: -371136,
      z: -64,
      step: 64,
      size: 128,
    });
    expect(Buffer.from(tile.biomes, 'base64').readUInt16LE(0)).toBe(expected);
    expect(Buffer.from(tile.rgba, 'base64')).toHaveLength(128 * 128 * 4);
    measurements.nativeTileMs.push({
      version,
      dimension: 'end',
      step: 64,
      milliseconds: tile.elapsedMs,
    });
  }
  checks.push('real native 26.3 Dappled Forest and 26.2/26.3 End ring fixtures through named IPC');

  await map().getByLabel('世界种子', { exact: true }).fill(base.seed);
  await selectLauncherOption(page, 'Minecraft 版本', '26.3');
  await map().getByRole('button', { name: '查看地图', exact: true }).click();
  await map().getByLabel('群系采样高度', { exact: true }).fill('77');
  await map().getByLabel('地图名称', { exact: true }).fill('桌面种子地图');
  await jump(68148, 80990);
  await rendered();
  await map().getByLabel('区块网格', { exact: true }).check();
  const initial = (await disk()).current;
  await map().getByRole('button', { name: '放大地图', exact: true }).click();
  await expect.poll(async () => (await disk())?.current?.zoom).toBeGreaterThan(initial.zoom);
  await canvas().focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await disk())?.current?.centerX).toBeGreaterThan(initial.centerX);
  await jump(-123, 456);
  await map().getByRole('button', { name: '标记中心', exact: true }).click();
  const markerDialog = page.getByRole('dialog', { name: '添加标记', exact: true });
  await markerDialog.getByLabel('标记名称', { exact: true }).fill('桌面营地');
  await markerDialog.getByLabel('标记备注', { exact: true }).fill('从传送门出发 🌱');
  await markerDialog.getByRole('button', { name: '保存标记', exact: true }).click();
  await expect.poll(async () => (await disk())?.current?.markers[0]?.name).toBe('桌面营地');
  expect((await disk()).current.markers[0]).toMatchObject({
    x: -123,
    z: 456,
    dimension: 'overworld',
    notes: '从传送门出发 🌱',
  });
  await map().getByRole('button', { name: '收藏', exact: true }).click();
  await expect.poll(async () => (await disk())?.saved.length).toBe(1);
  checks.push(
    'canvas rendering, negative coordinate navigation, keyboard pan/zoom and persistent markers',
  );

  await selectLauncherOption(page, '定位目标', 'village');
  await selectLauncherOption(page, '定位半径', '4096');
  await map().getByRole('button', { name: '从视图中心查找', exact: true }).click();
  await expect(map().getByRole('button', { name: '从视图中心查找', exact: true })).toBeVisible({
    timeout: 60000,
  });
  expect(await map().locator('.seed-result-list button').count()).toBeGreaterThan(0);
  await rendered();
  await exportFile('地图工程', files.project);
  await exportFile('坐标标记', files.markers);
  await exportFile('地图 PNG', files.png);
  const saved = (await json(files.project)).map;
  expect(saved.seed).toBe(base.seed);
  expect((await json(files.markers)).markers).toEqual(saved.markers);
  const png = PNG.sync.read(await readFile(files.png));
  expect(png.width).toBeGreaterThan(300);
  expect(png.height).toBeGreaterThan(200);
  expect(
    new Set(Array.from({ length: png.data.length / 4 }, (_, i) => png.data.readUInt32LE(i * 4)))
      .size,
  ).toBeGreaterThan(10);
  expect(
    await app.evaluate(
      ({ nativeImage }, file) => nativeImage.createFromPath(file).isEmpty(),
      files.png,
    ),
  ).toBe(false);
  checks.push(
    'nearest structure search plus real JSON/PNG exports, pixels and native image decoder',
  );

  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__seedFullscreenEvents = [];
    const current = BrowserWindow.getAllWindows().find((w) => w.isVisible());
    for (const name of ['enter-full-screen', 'leave-full-screen', 'focus', 'blur'])
      current.on(name, () => globalThis.__seedFullscreenEvents.push({ name, at: Date.now() }));
  });
  await page.evaluate(() => {
    globalThis.__seedFullscreenKeys = [];
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape')
          globalThis.__seedFullscreenKeys.push({
            at: Date.now(),
            key: event.key,
            focus: document.hasFocus(),
            dialogs: document.querySelectorAll('[role="dialog"]').length,
            fullscreen: document.querySelector('.seed-page')?.classList.contains('is-fullscreen'),
          });
      },
      true,
    );
  });
  for (let cycle = 0; cycle < 5; cycle++) {
    await map().getByRole('button', { name: '全屏地图', exact: true }).click();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.isVisible())
            .isFullScreen(),
        ),
      )
      .toBe(true);
    await expect(map().getByRole('button', { name: '退出全屏', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.isVisible())
            .isFullScreen(),
        ),
      )
      .toBe(false);
  }
  for (const dimension of ['nether', 'end', 'overworld']) {
    await selectLauncherOption(page, '地图维度', dimension);
    await expect.poll(async () => (await disk())?.current?.dimension).toBe(dimension);
    await rendered();
  }
  const switchTool = async (name) => {
    const navigation = page.locator('.toolbox-navigation');
    await expect(navigation.getByRole('button')).toHaveCount(1);
    await navigation.getByRole('button', { name: '返回工具箱', exact: true }).click();
    await page.locator('.toolbox-card').filter({ hasText: name }).click();
  };
  await switchTool('皮肤编辑器');
  await expect(page.getByLabel('作品名称', { exact: true })).toBeVisible();
  await page.getByLabel('作品名称', { exact: true }).fill('工具箱切换皮肤');
  await switchTool('种子地图');
  await expect(map().getByLabel('地图名称', { exact: true })).toHaveValue('桌面种子地图');
  await switchTool('皮肤编辑器');
  await expect(page.getByLabel('作品名称', { exact: true })).toHaveValue('工具箱切换皮肤');
  await switchTool('种子地图');
  checks.push('native fullscreen/Esc, all dimensions and toolbox round-trip preserves both tools');

  await picker('open', path.join(world, 'level.dat'));
  await map().getByRole('button', { name: '读取存档', exact: true }).click();
  await page
    .getByRole('dialog', { name: '读取存档种子', exact: true })
    .getByRole('button', { name: '选择 level.dat', exact: true })
    .click();
  await expect(map().getByLabel('世界种子', { exact: true })).toHaveValue('9007199254740993');
  await expect(map().getByLabel('地图名称', { exact: true })).toHaveValue('测试世界');
  await expect.poll(async () => (await disk())?.current?.seed).toBe('9007199254740993');
  expect(await readFile(path.join(world, 'level.dat'))).toEqual(levelFixture());
  await picker('open', files.project);
  await map().getByRole('button', { name: '我的地图', exact: true }).click();
  await page
    .getByRole('dialog', { name: '我的地图', exact: true })
    .getByRole('button', { name: '打开地图工程', exact: true })
    .click();
  await expect(map().getByLabel('地图名称', { exact: true })).toHaveValue(saved.name);
  await expect.poll(async () => (await disk())?.current?.markers).toEqual(saved.markers);
  await map().getByRole('button', { name: '删除标记 桌面营地', exact: true }).click();
  await expect.poll(async () => (await disk())?.current?.markers.length).toBe(0);
  await picker('open', files.markers);
  await map().getByRole('button', { name: '导入标记', exact: true }).click();
  await expect.poll(async () => (await disk())?.current?.markers).toEqual(saved.markers);
  checks.push('unchanged real level.dat read via Rust and portable map/marker import round-trips');

  await rendered();
  measurements.processes = await app.evaluate(({ app }) =>
    app.getAppMetrics().map(({ type, memory }) => ({ type, memory })),
  );
  await page.screenshot({ path: path.join(shots, 'seed-map-wide.png'), fullPage: true });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(960, 650),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth,
      ),
    )
    .toBe(true);
  await rendered();
  await page.screenshot({ path: path.join(shots, 'seed-map-960.png'), fullPage: true });
  const expected = structuredClone((await disk()).current);
  await close();
  expect((await json(workspace)).current).toEqual(expected);
  await launch();
  await expect(map().getByLabel('地图名称', { exact: true })).toHaveValue(expected.name);
  expect((await page.evaluate(() => window.kjmcl.seedMapState())).current).toEqual(expected);
  checks.push('responsive 960px layout and complete map recovery after actual Electron restart');
  await close();
  expect(errors).toEqual([]);
  measurements.totalMs = Date.now() - measurements.startedAt;
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        checks,
        files,
        screenshots: shots,
        nativeRevision: info.revision,
        measurements,
        inGameComparison: 'not exercised',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, artifacts: root, checks }));
} catch (error) {
  await page?.screenshot({ path: path.join(shots, 'failure.png'), fullPage: true }).catch(() => {});
  const fullscreen = await app
    ?.evaluate(({ BrowserWindow }) => ({
      events: globalThis.__seedFullscreenEvents,
      windows: BrowserWindow.getAllWindows().map((w) => ({
        fullscreen: w.isFullScreen(),
        visible: w.isVisible(),
      })),
    }))
    .catch(() => null);
  const keys = await page?.evaluate(() => globalThis.__seedFullscreenKeys).catch(() => null);
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify({ error: String(error), errors, checks, fullscreen, keys }, null, 2),
  );
  console.error('Seed map desktop smoke failed; isolated artifacts:', root);
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
}
