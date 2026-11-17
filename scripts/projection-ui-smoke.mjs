// Source UI fixture: genuine WebGL, isolated mock bridge; native file/format tests are separate.
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { selectLauncherOption } from './desktop-test-utils.mjs';
const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-projection-ui-'));
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
      'three',
      'three/examples/jsm/controls/OrbitControls.js',
      'deepslate/render',
    ],
  },
  logLevel: 'error',
});
let browser, page;
const errors = [];
try {
  await server.listen();
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
    const fixture = {
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
      dataPath: 'Isolated projection UI fixture',
      platform: 'win32',
      appVersion: '0.7.3',
    };
    const size = [8, 5, 7],
      palette = [
        { name: 'minecraft:air' },
        { name: 'minecraft:stone' },
        { name: 'minecraft:oak_planks' },
        { name: 'minecraft:glass' },
      ];
    let data = new Uint32Array(size[0] * size[1] * size[2]);
    for (let z = 0; z < 7; z++)
      for (let x = 0; x < 8; x++) {
        data[z * 8 + x] = 1;
        if (x === 0 || x === 7 || z === 0 || z === 6)
          for (let y = 1; y < 4; y++) data[(y * 7 + z) * 8 + x] = 2;
      }
    data[(4 * 7 + 3) * 8 + 4] = 3;
    const encode = () => {
      const bytes = new Uint8Array(data.buffer);
      return btoa(Array.from(bytes, (v) => String.fromCharCode(v)).join(''));
    };
    let doc = {
      id: crypto.randomUUID(),
      revision: crypto.randomUUID(),
      name: '投影测试小屋',
      format: 'Litematic v7',
      dataVersion: 3955,
      dimensions: size,
      origin: [-8, 0, 3],
      palette,
      blocks: encode(),
      nonAir: 0,
      materials: [],
      warnings: [],
      canUndo: false,
      canRedo: false,
    };
    const refresh = () => {
      const counts = new Map();
      data.forEach((v) => {
        if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
      });
      doc = {
        ...doc,
        blocks: encode(),
        materials: [...counts].map(([palette, count]) => ({ palette, count })),
        nonAir: [...counts.values()].reduce((a, b) => a + b, 0),
      };
    };
    refresh();
    window.projectionFixture = doc;
    window.projectionCalls = [];
    window.projectionExports = [];
    window.fixtureData = () => Array.from(data);
    let current = null,
      history = [],
      future = [];
    const listeners = [];
    const api = {
      snapshot: async () => structuredClone(fixture),
      lightweightState: async () => ({ active: false, visible: true, games: [], tasks: 0 }),
      backgroundImage: async () => null,
      onEvent: (fn) => {
        listeners.push(fn);
        return () => {};
      },
      projectionState: async () => ({
        current,
        entries: current ? [{ id: doc.id, name: doc.name, modifiedAt: Date.now() }] : [],
      }),
      projectionImport: async () => {
        current = doc;
        return structuredClone(doc);
      },
      projectionOpen: async () => structuredClone(doc),
      // Synthetic resource fixtures exercise UI only; official textures are verified by the desktop render suite.
      projectionAssets: async ({ blocks }) => {
        const faces = Object.fromEntries(
          ['up', 'down', 'north', 'south', 'east', 'west'].map((face) => [
            face,
            { texture: '#all', cullface: face },
          ]),
        );
        const blockstates = {},
          models = {},
          textures = {};
        for (const name of blocks.filter((name) => name !== 'minecraft:air')) {
          const image = document.createElement('canvas');
          image.width = image.height = 16;
          const ctx = image.getContext('2d');
          ctx.fillStyle = name.includes('glass')
            ? '#93c5db88'
            : name.includes('oak')
              ? '#9c753e'
              : '#9a9a9a';
          ctx.fillRect(0, 0, 16, 16);
          ctx.fillStyle = '#00000044';
          for (let x = 0; x < 16; x += 4) for (let y = 0; y < 16; y += 4) ctx.fillRect(x, y, 2, 2);
          const model = name.replace(':', ':block/');
          textures[model] = image.toDataURL('image/png').split(',')[1];
          models[model] = {
            textures: { all: model },
            elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces }],
          };
          blockstates[name] = { variants: { '': { model } } };
        }
        return {
          version: 'UI fixture',
          source: 'local',
          blockstates,
          models,
          textures,
          animations: {},
          missing: [],
        };
      },
      projectionSelect: async ({ selection }) => {
        window.projectionCalls.push(selection);
        const ids = [];
        const at = (i) => [i % 8, Math.floor(i / 56), Math.floor(i / 8) % 7];
        for (let i = 0; i < data.length; i++) {
          if (!data[i]) continue;
          const p = at(i);
          if (
            selection.mode === 'box'
              ? p.every((v, j) => v >= selection.min[j] && v <= selection.max[j])
              : selection.mode === 'layer'
                ? p[1] === at(selection.index)[1]
                : data[i] === data[selection.index]
          )
            ids.push(i);
        }
        return { indices: ids };
      },
      projectionEdit: async ({ op }) => {
        window.projectionCalls.push(op);
        history.push({ doc: structuredClone(doc), data: Array.from(data) });
        future = [];
        if (op.kind === 'rename') doc.name = op.name;
        if (op.kind === 'replace' || op.kind === 'delete') {
          let id = 0;
          if (op.kind === 'replace') {
            id = palette.findIndex((b) => b.name === op.block.name);
            if (id < 0) {
              id = palette.length;
              palette.push(op.block);
            }
          }
          for (const i of op.indices) data[i] = id;
        }
        doc = { ...doc, revision: crypto.randomUUID(), canUndo: true, canRedo: false };
        refresh();
        current = doc;
        return structuredClone(doc);
      },
      projectionUndo: async () => {
        future.push({ doc: structuredClone(doc), data: Array.from(data) });
        const value = history.pop();
        data = new Uint32Array(value.data);
        doc = {
          ...value.doc,
          revision: crypto.randomUUID(),
          canUndo: history.length > 0,
          canRedo: true,
        };
        current = doc;
        return structuredClone(doc);
      },
      projectionRedo: async () => {
        const value = future.pop();
        history.push({ doc: structuredClone(doc), data: Array.from(data) });
        data = new Uint32Array(value.data);
        doc = {
          ...value.doc,
          revision: crypto.randomUUID(),
          canUndo: true,
          canRedo: future.length > 0,
        };
        current = doc;
        return structuredClone(doc);
      },
      projectionExport: async (value) => {
        window.projectionExports.push(value);
        return 'isolated-export';
      },
      windowFullscreen: async (value) => {
        for (const fn of listeners) fn({ type: 'window-fullscreen', fullscreen: !!value });
        return !!value;
      },
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
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.getByRole('button', { name: '工具箱', exact: true }).click();
  await page.locator('.toolbox-card').filter({ hasText: '投影工坊' }).click();
  const workshop = page.getByRole('region', { name: '投影工坊', exact: true });
  await workshop.getByRole('button', { name: '打开投影', exact: true }).click();
  const canvas = page.getByRole('application', { name: '投影 3D 视图' });
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((c) => c.toDataURL().length)).toBeGreaterThan(10000);
  await workshop.getByText('坐标框选', { exact: true }).click();
  for (const label of ['终点 X', '终点 Y', '终点 Z'])
    await workshop.getByLabel(label, { exact: true }).fill('0');
  await workshop.getByRole('button', { name: '选择范围', exact: true }).click();
  await expect(workshop.getByRole('heading', { name: '已选 1 个', exact: true })).toBeVisible();
  await workshop.getByLabel('替换方块', { exact: true }).fill('minecraft:diamond_block');
  await workshop.getByRole('button', { name: '替换所选', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.fixtureData()[0])).toBe(4);
  await workshop.getByRole('button', { name: '撤销投影编辑', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.fixtureData()[0])).toBe(1);
  await workshop.getByRole('button', { name: '重做投影编辑', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.fixtureData()[0])).toBe(4);
  await workshop.getByLabel('层间距', { exact: true }).fill('1.7');
  await workshop.getByLabel('结束层', { exact: true }).fill('2');
  await workshop.getByRole('button', { name: '仅此层', exact: true }).click();
  await expect(workshop.getByLabel('起始层', { exact: true })).toHaveValue('2');
  await workshop.getByRole('button', { name: '全部层', exact: true }).click();
  await selectLauncherOption(page, '投影视角', 'top');
  await workshop.getByRole('button', { name: '单选', exact: true }).click();
  let box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width / 2 + 12, y: box.height / 2 } });
  await expect(workshop.getByRole('heading', { name: '已选 1 个', exact: true })).toBeVisible();
  await workshop.getByRole('button', { name: '相同材料', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.projectionCalls.at(-1)?.mode))
    .toBe('material');
  await workshop.getByRole('button', { name: '隐藏所选', exact: true }).click();
  await workshop.getByRole('button', { name: '全部显示', exact: true }).click();
  await workshop.getByRole('button', { name: '测量', exact: true }).click();
  await canvas.click({ position: { x: box.width / 2 + 12, y: box.height / 2 } });
  await canvas.click({ position: { x: box.width / 2 + 45, y: box.height / 2 } });
  await expect(workshop.locator('.projection-measure')).toContainText('格');
  await workshop.getByRole('button', { name: '框选', exact: true }).click();
  await page.mouse.move(box.x + box.width / 2 - 70, box.y + box.height / 2 - 70);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 70, { steps: 4 });
  await page.mouse.up();
  await expect(workshop.getByRole('heading', { name: /^已选 \d+ 个$/ })).not.toHaveText(
    '已选 0 个',
  );
  await workshop.getByRole('button', { name: '单选', exact: true }).click();
  await workshop.getByRole('button', { name: '材料', exact: true }).click();
  await expect(workshop.getByRole('button', { name: /钻石块/ })).toBeVisible();
  await workshop.getByRole('button', { name: '导出材料清单', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.projectionExports.at(-1)?.format))
    .toBe('materials');
  await workshop.getByText('导出投影', { exact: true }).click();
  await workshop.getByRole('button', { name: '视图 PNG', exact: true }).click();
  expect(
    await page.evaluate(() =>
      window.projectionExports.at(-1).image.startsWith('data:image/png;base64,'),
    ),
  ).toBe(true);
  await workshop.getByText('导出投影', { exact: true }).click();
  for (let i = 0; i < 5; i++) {
    await workshop.getByRole('button', { name: '全屏投影', exact: true }).click();
    await expect(workshop).toHaveClass(/is-fullscreen/);
    await page.keyboard.press('Escape');
    await expect(workshop).not.toHaveClass(/is-fullscreen/);
  }
  await workshop.getByRole('button', { name: '编辑', exact: true }).click();
  await workshop.getByLabel('层间距', { exact: true }).fill('1.2');
  await workshop.getByRole('button', { name: '复位', exact: true }).click();
  await page.screenshot({
    path: path.join(root, 'screenshots/projection-wide.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '返回工具箱', exact: true }).click();
  await page.locator('.toolbox-card').filter({ hasText: '投影工坊' }).click();
  await expect(workshop.getByLabel('层间距', { exact: true })).toHaveValue('1.2');
  await page.setViewportSize({ width: 960, height: 650 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({
    path: path.join(root, 'screenshots/projection-960.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        mode: 'source UI with mocked native bridge',
        screenshots: path.join(root, 'screenshots'),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, artifacts: root }));
} catch (error) {
  console.error('Projection UI fixture', root, errors);
  await page?.screenshot({ path: path.join(root, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server.close();
  const cache = path.join(root, 'cache');
  if (path.dirname(cache) === root && path.basename(root).startsWith('kjmcl-projection-ui-'))
    await rm(cache, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
