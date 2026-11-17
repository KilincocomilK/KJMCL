// Source-mode UI acceptance: Vite serves TSX in memory; no production build or desktop bundle.
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PNG } from 'pngjs';
import { selectLauncherOption } from './desktop-test-utils.mjs';
const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-skin-ui-'));
const shots = path.join(root, 'screenshots');
await mkdir(shots);
const server = await createServer({
  cacheDir: path.join(root, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, watch: null },
  optimizeDeps: {
    noDiscovery: true,
    include: [
      'react',
      'react-dom/client',
      'react/jsx-dev-runtime',
      'lucide-react',
      'three',
      'deepslate/render',
    ],
  },
  logLevel: 'error',
});
let browser, page;
try {
  console.log('Starting isolated Vite preview');
  await server.listen();
  console.log('Vite listening');
  const address = server.httpServer.address(),
    url = `http://127.0.0.1:${address.port}`;
  let executablePath;
  for (const candidate of [
    process.env.KJMCL_TEST_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean)) {
    if (
      await access(candidate).then(
        () => true,
        () => false,
      )
    ) {
      executablePath = candidate;
      break;
    }
  }
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  console.log('Browser launched');
  const context = await browser.newContext({
    viewport: { width: 1500, height: 980 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    const bytes = new Uint8Array(64 * 64 * 4);
    for (let i = 0; i < bytes.length; i += 4) bytes.set([48, 104, 180, 255], i);
    const project = {
      schemaVersion: 1,
      name: '界面测试皮肤',
      resolution: 64,
      model: 'classic',
      layers: [
        {
          id: 'fixture-layer',
          name: '基础图层',
          visible: true,
          locked: false,
          opacity: 1,
          blend: 'normal',
          pixels: btoa(String.fromCharCode(...bytes)),
        },
      ],
      activeLayerId: 'fixture-layer',
      palette: ['#f26b21', '#3068b4'],
    };
    window.__skinDraft = structuredClone(project);
    window.__skinSaved = [];
    window.__skinCaptures = [];
    window.__skinAnimations = [];
    window.__skinRuntimeErrors = [];
    window.addEventListener('error', (event) => window.__skinRuntimeErrors.push(event.message));
    const snapshot = {
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
      dataPath: 'Isolated UI fixture',
      platform: 'win32',
      appVersion: '0.7.3',
    };
    const api = {
      snapshot: async () => structuredClone(snapshot),
      lightweightState: async () => ({ active: false, visible: true, games: [], tasks: 0 }),
      onEvent: () => () => {},
      skinEditorLoadDraft: async () => structuredClone(project),
      skinEditorRecoverDraft: async () => structuredClone(project),
      skinEditorImport: async (mode) => {
        if (mode === 'skin')
          return { name: '界面导入皮肤', width: 64, height: 64, pixels: project.layers[0].pixels };
        if (mode !== 'image') throw new Error('Unexpected fixture image mode: ' + mode);
        return {
          name: '界面参考',
          width: 2,
          height: 2,
          pixels: btoa(
            String.fromCharCode(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255),
          ),
        };
      },
      skinEditorImportPalette: async () => ({ name: '导入色板', colors: ['#ff0000', '#00ff00'] }),
      skinEditorExportPalette: async () => 'fixture-palette',
      skinEditorSaveDraft: async (value) => {
        window.__skinDraft = structuredClone(value);
      },
      skinEditorSave: async (value) => {
        window.__skinSaved.push(structuredClone(value));
        return 'fixture-project';
      },
      skinEditorList: async () => [],
      skinEditorVersions: async () => [],
      skinEditorRestoreVersion: async () => structuredClone(project),
      skinEditorExportAnimation: async (value) => {
        window.__skinAnimations.push(value);
        return 'fixture-animation';
      },
      skinEditorCapture: async (value) => {
        window.__skinCaptures.push(value);
        return 'fixture-capture';
      },
      skinEditorExport: async () => null,
      backgroundImage: async () => null,
    };
    window.kjmcl = new Proxy(api, {
      get: (target, key) =>
        key in target
          ? target[key]
          : async () => {
              throw new Error('Unexpected fixture API: ' + String(key));
            },
    });
  });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  console.log('Source page loaded');
  await page.getByRole('button', { name: '工具箱', exact: true }).click();
  await page.locator('.toolbox-card').filter({ hasText: '皮肤编辑器' }).click();
  await expect(page.getByLabel('作品名称')).toHaveValue('界面测试皮肤');
  const viewport = page.getByLabel('三维皮肤编辑画布', { exact: true });
  await expect(viewport).toBeVisible();
  await expect(page.getByText('3D 视图不可用，请使用展开图', { exact: true })).toHaveCount(0);
  await page.getByLabel('显示外层', { exact: true }).uncheck();
  await selectLauncherOption(page, '观察方向', 'front');
  await expect
    .poll(() =>
      viewport.evaluate((canvas) => {
        const gl = canvas.getContext('webgl2');
        if (!gl) return false;
        const data = new Uint8Array(4);
        gl.readPixels(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          data,
        );
        return data[2] > 80 && data[3] > 0;
      }),
    )
    .toBe(true);
  const initial = await page.evaluate(() => window.__skinDraft.layers[0].pixels);
  let box = await viewport.boundingBox();
  const frontImage = await viewport.evaluate((canvas) => canvas.toDataURL());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2 + 10, { steps: 3 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(() => viewport.evaluate((canvas) => canvas.toDataURL())).not.toBe(frontImage);
  expect(await page.evaluate(() => window.__skinDraft.layers[0].pixels)).toBe(initial);
  await page.getByRole('button', { name: '重置视角', exact: true }).click();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  box = await viewport.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect
    .poll(() => page.evaluate(() => window.__skinDraft.layers[0].pixels))
    .not.toBe(initial);
  const painted = await page.evaluate(() =>
    Array.from(atob(window.__skinDraft.layers[0].pixels), (v) => v.charCodeAt(0)),
  );
  expect(
    painted.some(
      (v, i) =>
        i % 4 === 0 &&
        v === 242 &&
        painted[i + 1] === 107 &&
        painted[i + 2] === 33 &&
        painted[i + 3] === 255,
    ),
  ).toBe(true);
  await expect(page.getByLabel('皮肤展开图编辑画布', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__skinDraft.layers[0].pixels)).toBe(initial);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__skinDraft.layers[0].pixels))
    .not.toBe(initial);
  await page.getByRole('button', { name: '新建图层', exact: true }).click();
  await expect(page.locator('.skin-layer')).toHaveCount(2);
  await page.getByLabel('图层名称', { exact: true }).fill('叠加细节');
  await expect
    .poll(() => page.evaluate(() => window.__skinDraft.layers.at(-1).name))
    .toBe('叠加细节');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.getByRole('button', { name: '重置视角', exact: true }).click();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const atlas = page.getByLabel('皮肤展开图编辑画布', { exact: true }),
    atlasBox = await atlas.boundingBox();
  // Click inside the head front using the atlas fit transform used by the real canvas.
  const scale = Math.min((atlasBox.width - 32) / 64, (atlasBox.height - 32) / 64),
    originX = (atlasBox.width - 64 * scale) / 2,
    originY = (atlasBox.height - 64 * scale) / 2;
  await page.mouse.move(atlasBox.x + originX + 10.5 * scale, atlasBox.y + originY + 10.5 * scale);
  await expect(page.locator('.skin-canvas-status')).toContainText('10, 10');
  await page.mouse.down();
  await page.mouse.move(atlasBox.x + originX + 13.5 * scale, atlasBox.y + originY + 10.5 * scale, {
    steps: 2,
  });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const bytes = atob(window.__skinDraft.layers.at(-1).pixels);
        return [10, 11, 12, 13].every((x) => bytes.charCodeAt((10 * 64 + x) * 4 + 3) === 255);
      }),
    )
    .toBe(true);
  await page.getByRole('button', { name: '双视图', exact: true }).click();
  // Front orthographic camera: the painted head texel (10,10) is at world (-1.5,29.5).
  await expect
    .poll(() =>
      viewport.evaluate((canvas) => {
        const gl = canvas.getContext('webgl2'),
          pixel = new Uint8Array(4);
        gl.readPixels(
          Math.floor(canvas.width / 2 - (1.5 * canvas.height) / 40),
          Math.floor(canvas.height / 2 + (13.5 * canvas.height) / 40),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixel,
        );
        return Array.from(pixel);
      }),
    )
    .toEqual([242, 107, 33, 255]);
  const beforeModes = await page.evaluate(() => JSON.stringify(window.__skinDraft));
  await selectLauncherOption(page, '皮肤模型', 'slim');
  const modelDialog = page.getByRole('dialog', { name: '更换皮肤模型', exact: true });
  await expect(modelDialog.getByRole('button', { name: '仅更换模型', exact: true })).toBeVisible();
  await expect(
    modelDialog.getByRole('button', { name: '同时转换手臂像素', exact: true }),
  ).toBeVisible();
  await modelDialog.getByRole('button', { name: '关闭', exact: true }).click();
  expect(await page.evaluate(() => JSON.stringify(window.__skinDraft))).toBe(beforeModes);
  await selectLauncherOption(page, '皮肤模型', 'slim');
  await modelDialog.getByRole('button', { name: '仅更换模型', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__skinDraft.model)).toBe('slim');
  expect(await page.evaluate(() => window.__skinDraft.layers)).toEqual(
    JSON.parse(beforeModes).layers,
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(window.__skinDraft)))
    .toBe(beforeModes);
  await selectLauncherOption(page, '皮肤模型', 'slim');
  await modelDialog.getByRole('button', { name: '同时转换手臂像素', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__skinDraft.model)).toBe('slim');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(window.__skinDraft)))
    .toBe(beforeModes);

  await selectLauncherOption(page, '皮肤分辨率', 128);
  const resizeDialog = page.getByRole('dialog', { name: '调整分辨率', exact: true });
  expect(
    await resizeDialog
      .locator('canvas')
      .evaluateAll((nodes) => nodes.map((canvas) => canvas.width)),
  ).toEqual([64, 128]);
  await resizeDialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => JSON.stringify(window.__skinDraft))).toBe(beforeModes);
  await selectLauncherOption(page, '皮肤分辨率', 128);
  await resizeDialog.getByRole('button', { name: '应用', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__skinDraft.resolution)).toBe(128);
  expect(await page.evaluate(() => atob(window.__skinDraft.layers[0].pixels).length)).toBe(
    128 * 128 * 4,
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(window.__skinDraft)))
    .toBe(beforeModes);

  await page.getByLabel('选择图层 基础图层', { exact: true }).check();
  await page.getByLabel('选择图层 叠加细节', { exact: true }).check();
  await page.getByRole('button', { name: '隐藏所选', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__skinDraft.layers.map((layer) => layer.visible)))
    .toEqual([false, false]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(window.__skinDraft)))
    .toBe(beforeModes);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__skinDraft.layers.map((layer) => layer.visible)))
    .toEqual([false, false]);
  await page.getByRole('button', { name: '显示所选', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__skinDraft.layers.map((layer) => layer.visible)))
    .toEqual([true, true]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__skinDraft.layers.map((layer) => layer.visible)))
    .toEqual([false, false]);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(window.__skinDraft)))
    .toBe(beforeModes);
  await page.getByRole('button', { name: '取消选择', exact: true }).click();

  await page.getByRole('button', { name: '快捷键', exact: true }).click();
  const shortcuts = page.getByRole('dialog', { name: '快捷键', exact: true });
  await shortcuts.getByLabel('画笔快捷键', { exact: true }).fill('E');
  await expect(shortcuts.getByRole('alert')).toContainText('已用于橡皮');
  await expect(shortcuts.getByLabel('画笔快捷键', { exact: true })).toHaveValue('B');
  await shortcuts.getByLabel('画笔快捷键', { exact: true }).fill('1');
  await expect
    .poll(() => page.evaluate(() => window.__skinDraft.workspace.shortcuts.pencil))
    .toBe('1');
  await shortcuts.getByLabel('搜索快捷键', { exact: true }).fill('画笔');
  await expect(shortcuts.locator('.skin-shortcut-grid input')).toHaveCount(1);
  await shortcuts.getByRole('button', { name: '完成', exact: true }).click();
  await page.locator('.skin-tools button').filter({ hasText: /^橡皮/ }).click();
  await viewport.focus();
  await viewport.press('1');
  await expect(page.locator('.skin-tools button').filter({ hasText: /^画笔/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '快捷键', exact: true }).click();
  await shortcuts.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(shortcuts.getByLabel('画笔快捷键', { exact: true })).toHaveValue('B');
  await shortcuts.getByRole('button', { name: '完成', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(window.__skinDraft)))
    .toBe(beforeModes);

  const pickBox = await viewport.boundingBox();
  await viewport.click({
    modifiers: ['Alt'],
    position: {
      x: pickBox.width / 2 + (2 * pickBox.height) / 40,
      y: pickBox.height / 2 - (5 * pickBox.height) / 40,
    },
  });
  await expect(page.locator('.skin-toolbox').getByLabel('HEX 颜色', { exact: true })).toHaveValue(
    '#3068b4',
  );
  expect(await page.evaluate(() => JSON.stringify(window.__skinDraft))).toBe(beforeModes);
  await expect(page.locator('.skin-tools button').filter({ hasText: /^画笔/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('.skin-toolbox').getByLabel('HEX 颜色', { exact: true }).fill('#f26b21');

  await page.locator('.skin-menu > summary').click();
  await page.locator('.skin-menu').getByRole('button', { name: '导入 PNG', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: '导入皮肤', exact: true });
  const importCanvas = importDialog.getByLabel('三维皮肤编辑画布', { exact: true });
  await expect(importCanvas).toBeVisible();
  const classicPreview = await importCanvas.evaluate((canvas) => canvas.toDataURL());
  await selectLauncherOption(page, '原图模型', 'slim');
  await expect
    .poll(() => importCanvas.evaluate((canvas) => canvas.toDataURL()))
    .not.toBe(classicPreview);
  await importDialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => JSON.stringify(window.__skinDraft))).toBe(beforeModes);
  if ((await page.locator('.skin-menu').getAttribute('open')) !== null)
    await page.locator('.skin-menu > summary').click();
  const beforeAdjust = await page.evaluate(() => JSON.stringify(window.__skinDraft));
  await page.getByRole('button', { name: '颜色调整', exact: true }).click();
  const adjust = page.getByRole('dialog', { name: '颜色调整 · 当前图层', exact: true });
  const preview = adjust.getByLabel('调整预览', { exact: true });
  const unadjusted = await preview.evaluate((canvas) => canvas.toDataURL());
  await adjust.getByLabel('亮度', { exact: true }).focus();
  await adjust.getByLabel('亮度', { exact: true }).press('End');
  await expect.poll(() => preview.evaluate((canvas) => canvas.toDataURL())).not.toBe(unadjusted);
  await adjust.getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => JSON.stringify(window.__skinDraft))).toBe(beforeAdjust);
  await page.locator('.skin-menu > summary').click();
  await page.getByRole('button', { name: '新建皮肤', exact: true }).click();
  await page.getByRole('button', { name: '创建空白皮肤', exact: true }).click();
  const protect = page.getByRole('dialog', { name: '保存当前作品？', exact: true });
  await expect(protect).toBeVisible();
  await protect.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByLabel('作品名称')).toHaveValue('界面测试皮肤');
  expect(await page.evaluate(() => JSON.stringify(window.__skinDraft))).toBe(beforeAdjust);
  await page.locator('.skin-menu > summary').click();

  const colors = page.locator('.skin-color-panel');
  await colors.getByLabel('HEX 颜色', { exact: true }).fill('#00ff00');
  await expect(page.locator('.skin-toolbox').getByLabel('HEX 颜色', { exact: true })).toHaveValue(
    '#00ff00',
  );
  await colors.getByLabel('HEX 颜色', { exact: true }).fill('#f26b21');
  await colors.getByText('我的色板', { exact: true }).click();
  await colors.getByLabel('色板名称', { exact: true }).fill('界面色板');
  await colors.getByRole('button', { name: '保存', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__skinDraft.workspace.palettes[0]?.name))
    .toBe('界面色板');

  await page
    .locator('.skin-inspector > details > summary')
    .filter({ hasText: /^参考图$/ })
    .click();
  await page.getByRole('button', { name: '导入参考图', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__skinDraft.workspace.references.length))
    .toBe(1);
  const reference = page.getByLabel('参考图 界面参考', { exact: true });
  const referenceBox = await reference.boundingBox();
  await reference.click({ position: { x: referenceBox.width / 4, y: referenceBox.height / 4 } });
  await expect(page.locator('.skin-toolbox').getByLabel('HEX 颜色', { exact: true })).toHaveValue(
    '#ff0000',
  );
  await page.getByRole('button', { name: '参考图放大', exact: true }).click();
  await page.getByRole('button', { name: '参考图适应窗口', exact: true }).click();
  await page
    .locator('.skin-inspector > details > summary')
    .filter({ hasText: /^印章素材$/ })
    .click();
  const stamp = page.locator('.skin-stamp-panel');
  await stamp.getByRole('button', { name: '导入 PNG', exact: true }).click();
  await stamp.getByLabel('印章名称', { exact: true }).fill('界面印章');
  await stamp.getByRole('button', { name: '保存印章', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__skinDraft.workspace.brushes[0]?.name))
    .toBe('界面印章');
  await page
    .locator('.skin-inspector > details > summary')
    .filter({ hasText: /^姿势与背景$/ })
    .click();
  await page.getByLabel('头部 Y 角度数值', { exact: true }).fill('30');
  await expect
    .poll(() => page.evaluate(() => window.__skinDraft.workspace.poseAngles.head?.y))
    .toBe(30);
  await page.getByLabel('姿势名称', { exact: true }).fill('界面姿势');
  await page.getByRole('button', { name: '保存姿势', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__skinDraft.workspace.poses[0]?.name))
    .toBe('界面姿势');
  await page.getByRole('button', { name: '重置姿势', exact: true }).click();
  await page.getByLabel('棋盘背景', { exact: true }).uncheck();
  await expect
    .poll(() => page.evaluate(() => window.__skinDraft.workspace.checkerboard))
    .toBe(false);
  await page.getByLabel('棋盘背景', { exact: true }).check();
  await page.locator('.skin-toolbox').getByLabel('HEX 颜色', { exact: true }).fill('#f26b21');
  await page.getByRole('button', { name: '保存作品', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__skinSaved.length)).toBe(1);
  await page.getByRole('button', { name: '截图', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__skinCaptures.length)).toBe(1);
  await page.getByLabel('转台', { exact: true }).check();
  await page.getByRole('button', { name: '导出动画', exact: true }).click();
  await page.getByLabel('动画帧数', { exact: true }).fill('6');
  await page.getByLabel('动画时长', { exact: true }).fill('1');
  await page.getByRole('button', { name: '导出 GIF', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__skinAnimations.length), { timeout: 20000 })
    .toBe(1);
  const animation = await page.evaluate(() => window.__skinAnimations[0]);
  expect(animation.seconds).toBe(1);
  expect(animation.frames).toHaveLength(6);
  expect(new Set(animation.frames).size).toBeGreaterThan(1);
  for (const image of animation.frames) {
    const png = PNG.sync.read(Buffer.from(image.slice(22), 'base64'));
    expect([png.width, png.height]).toEqual([256, 256]);
  }
  await page.getByLabel('转台', { exact: true }).uncheck();
  await page.getByRole('button', { name: '重置视角', exact: true }).click();
  await page.screenshot({ path: path.join(shots, 'skin-editor-wide.png'), fullPage: true });
  await page.setViewportSize({ width: 960, height: 650 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: path.join(shots, 'skin-editor-960.png'), fullPage: true });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(await page.evaluate(() => window.__skinRuntimeErrors)).toEqual([]);
  expect(errors).toEqual([]);
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        mode: 'Vite source preview + headless Chromium; mocked main-process bridge, real WebGL',
        screenshots: shots,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      artifacts: root,
      screenshots: [
        path.join(shots, 'skin-editor-wide.png'),
        path.join(shots, 'skin-editor-960.png'),
      ],
    }),
  );
} catch (error) {
  await page?.screenshot({ path: path.join(shots, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(
    path.join(root, 'debug.json'),
    JSON.stringify(
      await page
        ?.evaluate(() => ({
          draft: window.__skinDraft,
          alerts: [...document.querySelectorAll('[role=alert]')].map((e) => e.textContent),
        }))
        .catch(() => ({})),
      null,
      2,
    ),
  );
  console.error('Skin UI fixture failed; temporary artifacts:', root);
  throw error;
} finally {
  await browser?.close();
  await server.close();
  const cache = path.join(root, 'vite-cache');
  if (path.dirname(cache) === root && path.basename(root).startsWith('kjmcl-skin-ui-'))
    await rm(cache, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
