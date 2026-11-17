// Isolated source UI fixture: real canvas, mocked native bridge; never a world-generation acceptance test.
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { selectLauncherOption } from './desktop-test-utils.mjs';
const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-seed-ui-'));
await mkdir(path.join(root, 'screenshots'));
const server = await createServer({
  cacheDir: path.join(root, 'cache'),
  server: { host: '127.0.0.1', port: 0, watch: null },
  optimizeDeps: {
    noDiscovery: true,
    include: [
      'react',
      'react-dom/client',
      'react/jsx-dev-runtime',
      'lucide-react',
      'deepslate/render',
    ],
  },
  logLevel: 'error',
});
let browser, page;
const errors = [];
try {
  await server.listen();
  const address = server.httpServer.address();
  let executablePath;
  for (const candidate of [
    process.env.KJMCL_TEST_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean))
    if (
      await access(candidate).then(
        () => true,
        () => false,
      )
    ) {
      executablePath = candidate;
      break;
    }
  browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await context.addInitScript(() => {
    window.fixture = {
      accounts: [],
      instances: [],
      gameFolders: [],
      tasks: [],
      running: [],
      favorites: [],
      appearance: { dim: 32, blur: 0 },
      settings: {
        memoryMb: 4096,
        javaPath: '',
        proxy: '',
        source: 'official',
        concurrency: 6,
        microsoftClientId: '',
        closeOnLaunch: false,
        showSnapshots: false,
      },
      dataPath: 'Isolated seed UI fixture',
      platform: 'win32',
      appVersion: '0.7.3',
    };
    window.savedSeedState = { schemaVersion: 1, current: null, saved: [] };
    window.seedCalls = [];
    window.seedExports = [];
    window.seedCanceled = [];
    window.fullscreenState = false;
    const listeners = [];
    const rgba = new Uint8Array(128 * 128 * 4),
      biomes = new Uint8Array(128 * 128 * 2);
    for (let i = 0; i < 128 * 128; i++) {
      rgba.set([50, 130, 60, 255], i * 4);
      biomes[i * 2] = 1;
    }
    const b64 = (bytes) => btoa(Array.from(bytes, (v) => String.fromCharCode(v)).join(''));
    const api = {
      snapshot: async () => structuredClone(window.fixture),
      lightweightState: async () => ({ active: false, visible: true, games: [], tasks: 0 }),
      backgroundImage: async () => null,
      seedMapInfo: async () => ({
        engine: 'UI fixture',
        revision: 'fixture',
        versions: [
          { id: '1.20', name: '1.20' },
          { id: '1.21.3', name: '1.21.3' },
          { id: '26.3', name: '26.3' },
        ],
        biomes: [
          { id: 1, name: '平原', color: '#32823c', dimension: 'overworld' },
          { id: 8, name: '下界荒地', color: '#bb3333', dimension: 'nether' },
        ],
        structures: [
          { id: 'village', name: '村庄', dimension: 'overworld', color: '#ffca55' },
          { id: 'fortress', name: '下界要塞', dimension: 'nether', color: '#ff5555' },
          { id: 'abandoned_camp', name: '废弃营地', dimension: 'overworld', minVersion: '26.3' },
        ],
      }),
      seedMapState: async () => structuredClone(window.savedSeedState),
      seedMapSaveState: async (s) => {
        window.savedSeedState = structuredClone(s);
      },
      seedMapSeed: async (input) => ({ seed: input, input }),
      seedMapRandom: async () => '123456789012345678',
      seedMapTile: async (req) => {
        window.seedCalls.push(req);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          x: req.x,
          z: req.z,
          step: req.step,
          width: 128,
          height: 128,
          rgba: b64(rgba),
          biomes: b64(biomes),
          elapsedMs: 1,
        };
      },
      seedMapFeatures: async () => ({
        items: [{ id: 'village:64:32', type: 'village', x: 64, z: 32, approximate: false }],
        spawn: { x: 0, z: 0 },
        truncated: false,
        elapsedMs: 1,
      }),
      seedMapBiome: async () => ({ id: 1, name: '平原', color: '#32823c', slime: false }),
      seedMapLocate: async (req) => {
        if (window.holdLocate)
          await new Promise((resolve) => {
            window.releaseLocate = resolve;
          });
        return {
          items: [
            {
              id: 'near:800:600',
              type: req.kind === 'biome' ? 'biome' : req.target,
              x: 800,
              z: 600,
              distance: 1000,
              approximate: false,
            },
          ],
          searchedRadius: req.radius,
          truncated: false,
          elapsedMs: 1,
          ...(req.kind === 'biome' ? { sampleStep: 64 } : {}),
        };
      },
      seedMapCancel: async (id) => {
        window.seedCanceled.push(id);
      },
      seedMapExport: async (value) => {
        window.seedExports.push(value);
        return 'fixture-export';
      },
      windowFullscreen: async (value) => {
        if (value !== undefined) window.fullscreenState = value;
        for (const fn of listeners)
          fn({ type: 'window-fullscreen', fullscreen: window.fullscreenState });
        return window.fullscreenState;
      },
      onEvent: (fn) => {
        listeners.push(fn);
        return () => {};
      },
      saveWorlds: async () => [],
      seedMapImportWorld: async () => window.seedWorldImport ?? null,
    };
    window.kjmcl = new Proxy(api, {
      get: (target, key) =>
        key in target
          ? target[key]
          : async () => {
              throw new Error('Unexpected fixture API ' + String(key));
            },
    });
  });
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByRole('button', { name: '工具箱', exact: true }).click();
  await page.locator('.toolbox-card').filter({ hasText: '种子地图' }).click();
  await expect(page.getByText('从一个种子开始')).toBeVisible();
  await page.getByLabel('世界种子').fill('9007199254740993');
  await page.getByRole('button', { name: '查看地图', exact: true }).click();
  const canvas = page.getByLabel('种子地图画布');
  await expect(canvas).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.seedCalls.length)).toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.savedSeedState.current?.seed))
    .toBe('9007199254740993');
  expect(await page.evaluate(() => window.savedSeedState.current.version)).toBe('26.3');
  await expect(page.locator('label.check').filter({ hasText: '废弃营地' })).toBeVisible();
  await selectLauncherOption(page, 'Minecraft 版本', '1.20');
  await expect(page.getByText('废弃营地', { exact: true })).toHaveCount(0);
  await selectLauncherOption(page, 'Minecraft 版本', '26.3');
  await expect
    .poll(() =>
      canvas.evaluate((c) => Array.from(c.getContext('2d').getImageData(200, 200, 1, 1).data)),
    )
    .toEqual([50, 130, 60, 255]);
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 150, box.y + 170);
  await expect(page.getByRole('status')).toContainText('平原');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.savedSeedState.current.centerX))
    .toBeLessThan(0);
  await page.getByLabel('跳转 X').fill('-1234');
  await page.getByLabel('跳转 Z').fill('5678');
  await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.savedSeedState.current.centerX)).toBe(-1234);
  await page.getByRole('button', { name: '标记中心', exact: true }).click();
  await page.getByLabel('标记名称').fill('测试基地');
  await page.getByLabel('标记备注').fill('坐标保留');
  await page.getByRole('button', { name: '保存标记', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.savedSeedState.current.markers[0]?.notes))
    .toBe('坐标保留');
  await selectLauncherOption(page, '定位目标', 'village');
  await page.getByRole('button', { name: '从视图中心查找', exact: true }).click();
  await expect(page.getByRole('button', { name: /村庄.*800, 600/ })).toBeVisible();
  await selectLauncherOption(page, '定位类别', 'biome');
  await expect(page.getByRole('button', { name: /800, 600/ })).toHaveCount(0);
  await selectLauncherOption(page, '定位目标', '1');
  await page.getByRole('button', { name: '从视图中心查找', exact: true }).click();
  await expect(page.getByText('每 64 格采样', { exact: true })).toBeVisible();
  await selectLauncherOption(page, '定位半径', '512');
  await expect(page.getByRole('button', { name: /800, 600/ })).toHaveCount(0);
  await selectLauncherOption(page, '定位类别', 'structure');
  await selectLauncherOption(page, '定位目标', 'village');
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.savedSeedState.saved.length)).toBe(1);
  await page.evaluate(() => {
    window.holdLocate = true;
  });
  await page.getByRole('button', { name: '从视图中心查找', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseLocate)).toBe('function');
  await selectLauncherOption(page, 'Minecraft 版本', '1.20');
  await page.evaluate(() => {
    window.releaseLocate();
    window.holdLocate = false;
  });
  await page.waitForTimeout(100);
  await expect(page.getByRole('button', { name: /村庄.*800, 600/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '从视图中心查找', exact: true })).toBeVisible();
  await selectLauncherOption(page, 'Minecraft 版本', '26.3');
  await page.getByRole('button', { name: '全屏地图', exact: true }).click();
  await expect(page.locator('.seed-page')).toHaveClass(/is-fullscreen/);
  await expect
    .poll(() =>
      page.locator('.seed-page').evaluate((el) => Math.round(el.getBoundingClientRect().width)),
    )
    .toBe(1440);
  await page.keyboard.press('Escape');
  await expect(page.locator('.seed-page')).not.toHaveClass(/is-fullscreen/);
  await page.locator('.seed-menu summary').click();
  await expect(page.getByRole('button', { name: '地图 PNG', exact: true })).toBeEnabled({
    timeout: 20000,
  });
  await page.getByRole('button', { name: '地图 PNG', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.seedExports.length)).toBe(1);
  expect(
    await page.evaluate(() => window.seedExports[0].image.startsWith('data:image/png;base64,')),
  ).toBe(true);
  await page.locator('.seed-menu summary').click();
  await page.screenshot({
    path: path.join(root, 'screenshots', 'seed-map-wide.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 960, height: 650 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({
    path: path.join(root, 'screenshots', 'seed-map-960.png'),
    fullPage: true,
  });
  await page.evaluate(() => {
    window.seedWorldImport = {
      name: '超平坦',
      seed: '123',
      version: '26.3',
      preset: 'minecraft:flat',
    };
  });
  await page.getByRole('button', { name: '读取存档', exact: true }).click();
  await page.getByRole('button', { name: '选择 level.dat', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('按默认地形预测');
  expect(errors).toEqual([]);
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        mode: 'source canvas UI with mocked native bridge',
        screenshots: path.join(root, 'screenshots'),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, artifacts: root }));
} catch (error) {
  console.error('Seed UI fixture', root, errors);
  await page?.screenshot({ path: path.join(root, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server.close();
  const cache = path.join(root, 'cache');
  if (path.dirname(cache) === root && path.basename(root).startsWith('kjmcl-seed-ui-'))
    await rm(cache, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
