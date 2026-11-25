import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { firstVisibleWindow } from './desktop-test-utils.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-appearance-'));
const env = { ...process.env, KJMCL_DATA_DIR: path.join(root, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
const options = process.env.KJMCL_EXECUTABLE
  ? { executablePath: process.env.KJMCL_EXECUTABLE, args: [], env }
  : { args: ['.'], env };
let app;
const errors = [];
const launch = async () => {
  app = await electron.launch(options);
  const page = await firstVisibleWindow(app);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('h1');
  return page;
};
const snapshot = (page) => page.evaluate(() => window.kjmcl.snapshot());
const noHorizontalOverflow = async (page) => {
  const overflowing = await page.evaluate(() =>
    ['html', 'body', '.app-shell', '.main-shell', 'main', '.pane-rail', '.pane-content'].filter(
      (selector) => {
        const node = document.querySelector(selector);
        return node && node.scrollWidth > node.clientWidth + 1;
      },
    ),
  );
  if (overflowing.length) {
    await page.screenshot({ animations: 'disabled', path: '.local/appearance-overflow.png' });
    console.log(
      'Layout overflow',
      await page.evaluate(() => ({
        page: document.querySelector('h1')?.textContent,
        viewport: innerWidth,
        nodes: [...document.querySelectorAll('main *')]
          .filter((el) => el.getBoundingClientRect().right > innerWidth)
          .map((el) => ({
            tag: el.tagName,
            className: el.className,
            text: el.textContent?.slice(0, 60),
            right: el.getBoundingClientRect().right,
          })),
      })),
    );
  }
  expect(overflowing).toEqual([]);
};
try {
  await mkdir('.local', { recursive: true });
  let page = await launch();
  await expect(page.getByRole('heading', { name: '开始游戏', exact: true })).toBeVisible();
  await expect(page.locator('.titlebar')).not.toContainText('KJMCL');
  await expect(page.locator('body')).toHaveCSS('font-family', /Fusion Pixel/);
  expect(
    await page.evaluate(async () =>
      (await document.fonts.load('14px "Fusion Pixel"', '资源管理')).some(
        (font) => font.status === 'loaded',
      ),
    ),
  ).toBe(true);
  await expect(page.getByRole('button', { name: '创建游戏实例', exact: true })).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/JAVA EDITION|Java Edition|就绪/);
  await noHorizontalOverflow(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.home-launch')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.hero-button')).toHaveCSS('transition-duration', '0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.home-launch')).toHaveCSS('animation-timing-function', /cubic-bezier/);
  const sidebar = await page.locator('.sidebar').boundingBox();
  const content = await page.locator('.main-shell').boundingBox();
  expect(sidebar.x).toBe(0);
  expect(sidebar.y).toBe(0);
  expect(sidebar.width).toBeLessThanOrEqual(72);
  expect(content.x).toBeCloseTo(sidebar.x + sidebar.width, 0);
  const stage = await page.locator('.home-stage').boundingBox();
  const header = await page.locator('.titlebar').boundingBox();
  expect(stage.x).toBeCloseTo(content.x, 0);
  expect(stage.y).toBeCloseTo(header.y + header.height, 0);
  expect(stage.y + stage.height).toBeCloseTo(content.y + content.height, 0);
  expect(
    await page.locator('.background-scene').evaluate((n) => getComputedStyle(n).backgroundImage),
  ).toContain('mesa-sunset');
  await page.screenshot({ animations: 'disabled', path: '.local/appearance-home-default.png' });

  const rail = page.locator('.sidebar');
  await expect(rail.locator('.brand')).toHaveText('');
  await expect(rail.locator('.brand svg')).toBeVisible();
  const buttons = rail.getByRole('button');
  await expect(buttons).toHaveCount(11);
  expect(
    await buttons.evaluateAll((items) =>
      items.every(
        (button) => button.ariaLabel && !button.textContent.trim() && button.querySelector('svg'),
      ),
    ),
  ).toBe(true);
  const library = rail.getByRole('button', { name: '游戏实例', exact: true });
  await library.hover();
  const tooltip = rail.getByRole('tooltip');
  await expect(tooltip).toHaveText('游戏实例');
  const tipBox = await tooltip.boundingBox();
  expect(tipBox.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
  await page.mouse.move(content.x + 50, content.y + 60);
  await expect(tooltip).toHaveCount(0);
  await library.focus();
  await page.keyboard.press('Tab');
  await expect(rail.getByRole('button', { name: '资源管理', exact: true })).toBeFocused();
  await expect(tooltip).toHaveText('资源管理');
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);

  const home = buttons.first();
  const settings = rail.getByRole('button', { name: '启动器设置', exact: true });
  await expect(home).toHaveAccessibleName('开始游戏');
  await expect(home).toHaveJSProperty('draggable', false);
  await expect(home).toHaveCSS('box-shadow', /inset/);
  const initialOrder = (await snapshot(page)).sidebarOrder;
  const accounts = rail.getByRole('button', { name: '账户管理', exact: true });
  const saves = rail.getByRole('button', { name: '存档管理', exact: true });
  for (const fixed of [settings, accounts]) {
    await expect(fixed).toHaveJSProperty('draggable', false);
    await fixed.dragTo(library);
    await fixed.press('Alt+ArrowUp');
    await saves.dragTo(fixed);
  }
  await saves.dragTo(home, { targetPosition: { x: 12, y: 4 } });
  expect((await snapshot(page)).sidebarOrder).toEqual(initialOrder);
  await saves.dragTo(library, { targetPosition: { x: 12, y: 4 } });
  await expect(buttons.nth(1)).toHaveAccessibleName('存档管理');
  await expect(home).toHaveAttribute('aria-current', 'page');
  await saves.press('Alt+ArrowDown');
  await expect(buttons.nth(2)).toHaveAccessibleName('存档管理');
  await expect(saves).toBeFocused();
  const savedOrder = [
    'instances',
    'saves',
    ...initialOrder.filter((key) => key !== 'instances' && key !== 'saves'),
  ];
  await expect.poll(async () => (await snapshot(page)).sidebarOrder).toEqual(savedOrder);

  const ids = await page.evaluate(async () => {
    const ids = [];
    for (const name of ['外观验证一', '外观验证二', '外观验证三']) {
      ids.push(await window.kjmcl.createInstance({ name, version: '1.21.1', loader: 'vanilla' }));
    }
    await window.kjmcl.select({ instanceId: ids[0] });
    return ids;
  });
  const instances = page.getByRole('combobox', { name: '当前游戏实例', exact: true });
  await expect(instances).toContainText('外观验证一');
  await instances.focus();
  await instances.press('Space');
  await expect(instances).toHaveAttribute('aria-expanded', 'true');
  await expect(instances).toHaveCSS('font-family', /Fusion Pixel/);
  await expect(page.getByRole('option').first()).toHaveCSS('font-family', /Fusion Pixel/);
  await instances.press('End');
  await page.screenshot({ animations: 'disabled', path: '.local/appearance-dropdown.png' });
  const menuBox = await page.getByRole('listbox').boundingBox();
  const triggerBox = await instances.boundingBox();
  expect(
    menuBox.y + menuBox.height <= triggerBox.y - 4 ||
      menuBox.y >= triggerBox.y + triggerBox.height + 4,
  ).toBe(true);
  await instances.press('Enter');
  await expect.poll(async () => (await snapshot(page)).selectedInstanceId).toBe(ids[2]);
  await instances.press('ArrowUp');
  await instances.press('Escape');
  await expect(instances).toHaveAttribute('aria-expanded', 'false');
  await expect(instances).toBeFocused();
  expect((await snapshot(page)).selectedInstanceId).toBe(ids[2]);
  await instances.click();
  await page.getByRole('heading', { name: '开始游戏', exact: true }).click();
  await expect(instances).toHaveAttribute('aria-expanded', 'false');

  await page.getByRole('button', { name: '启动器设置', exact: true }).click();
  await expect(page.locator('.settings-form > :first-child')).toHaveAccessibleName('启动器信息');
  await expect(rail.getByRole('button', { name: '启动器信息' })).toHaveCount(0);
  await page.locator('.appearance-settings > summary').click();
  const preview = await page.getByLabel('背景预览').boundingBox();
  const chooseImage = await page.getByRole('button', { name: '选择图片' }).boundingBox();
  expect(chooseImage.y).toBeGreaterThanOrEqual(preview.y + preview.height);
  // Encode real files in Chromium; nativeImage format support differs by platform.
  const formats = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ff8b45';
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#202020';
    context.fillRect(4, 4, 8, 8);
    return {
      jpeg: canvas.toDataURL('image/jpeg'),
      webp: canvas.toDataURL('image/webp'),
    };
  });
  expect(formats.jpeg).toMatch(/^data:image\/jpeg;base64,/);
  expect(formats.webp).toMatch(/^data:image\/webp;base64,/);
  const jpeg = path.join(root, 'supported-background.jpg');
  const webp = path.join(root, 'unsupported-background.webp');
  await writeFile(jpeg, Buffer.from(formats.jpeg.split(',')[1], 'base64'));
  await writeFile(webp, Buffer.from(formats.webp.split(',')[1], 'base64'));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.backgroundPickerExtensions = options.filters[0].extensions;
      return { canceled: false, filePaths: [file] };
    };
  }, jpeg);
  await page.getByRole('button', { name: '选择图片', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).appearance?.backgroundId).toBeTruthy();
  expect(await app.evaluate(() => globalThis.backgroundPickerExtensions)).toEqual([
    'png',
    'jpg',
    'jpeg',
  ]);
  const jpegId = (await snapshot(page)).appearance.backgroundId;
  const normalizedJpeg = await page.evaluate(() => window.kjmcl.backgroundImage());
  expect(normalizedJpeg).toMatch(/^data:image\/png;base64,/);
  await expect(page.locator('.app-background .background-scene > img')).toHaveAttribute(
    'src',
    normalizedJpeg,
  );
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, webp);
  const formatError = await page.evaluate(async () => {
    try {
      await window.kjmcl.pickBackground();
      return '';
    } catch (error) {
      return error.message;
    }
  });
  expect(formatError).toContain('PNG 或 JPEG');
  expect((await snapshot(page)).appearance.backgroundId).toBe(jpegId);
  expect(await page.evaluate(() => window.kjmcl.backgroundImage())).toBe(normalizedJpeg);
  await page.evaluate(() => window.kjmcl.resetBackground());
  await expect.poll(async () => (await snapshot(page)).appearance?.backgroundId).toBeUndefined();

  const source = path.join(root, 'bright-background.png');
  const encoded = await app.evaluate(({ nativeImage }) => {
    const width = 480,
      height = 270;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const bright = (Math.floor(x / 48) + Math.floor(y / 45)) % 2 === 0;
        pixels[offset] = bright ? 255 : 205;
        pixels[offset + 1] = bright ? 255 : 145;
        pixels[offset + 2] = bright ? 255 : 50;
        pixels[offset + 3] = 255;
      }
    }
    return nativeImage.createFromBitmap(pixels, { width, height }).toPNG().toString('base64');
  });
  await writeFile(source, Buffer.from(encoded, 'base64'));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, source);
  await page.getByRole('button', { name: '选择图片', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).appearance?.backgroundId).toBeTruthy();
  const imported = (await snapshot(page)).appearance.backgroundId;
  const image = await page.evaluate(() => window.kjmcl.backgroundImage());
  expect(image).toMatch(/^data:image\/png;base64,/);
  await expect(page.locator('.app-background .background-scene > img')).toHaveAttribute(
    'src',
    image,
  );
  await unlink(source);
  expect(await page.evaluate(() => window.kjmcl.backgroundImage())).toBe(image);

  const invalid = path.join(root, 'invalid.png');
  await writeFile(invalid, 'not an image');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, invalid);
  expect(
    await page.evaluate(async () => {
      try {
        await window.kjmcl.pickBackground();
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  expect((await snapshot(page)).appearance.backgroundId).toBe(imported);
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await page.getByRole('button', { name: '更换图片', exact: true }).click();
  expect((await snapshot(page)).appearance.backgroundId).toBe(imported);

  await page.getByRole('slider', { name: '背景暗度', exact: true }).focus();
  await page.getByRole('slider', { name: '背景暗度', exact: true }).press('End');
  await expect.poll(async () => (await snapshot(page)).appearance.dim).toBe(80);
  await page.getByRole('slider', { name: '背景模糊', exact: true }).focus();
  await page.getByRole('slider', { name: '背景模糊', exact: true }).press('End');
  await expect.poll(async () => (await snapshot(page)).appearance.blur).toBe(24);
  await page.evaluate(() => window.kjmcl.updateAppearance({ dim: 35, blur: 2 }));
  await expect.poll(async () => (await snapshot(page)).appearance.dim).toBe(35);
  await expect(page.locator('.appearance-settings output').first()).toHaveText('35%');
  await expect(page.locator('.appearance-settings output').nth(1)).toHaveText('2 px');
  await noHorizontalOverflow(page);
  await page.screenshot({ animations: 'disabled', path: '.local/appearance-settings.png' });
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: '.local/appearance-home-custom.png' });

  const browserWindow = await app.browserWindow(page);
  await browserWindow.evaluate((window) => window.setSize(960, 650));
  await browserWindow.dispose();
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(960);
  await noHorizontalOverflow(page);
  await expect(page.getByRole('button', { name: '实例设置', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '安装游戏', exact: true })).toBeInViewport();
  await page.screenshot({ animations: 'disabled', path: '.local/appearance-home-compact.png' });
  for (const name of [
    '游戏实例',
    '资源管理',
    'AI 助手',
    '存档管理',
    '诊断与维护',
    '下载任务',
    '账户管理',
    '启动器设置',
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    await noHorizontalOverflow(page);
  }
  await page.getByText('下载与网络', { exact: true }).click();
  const downloadSource = page.getByRole('combobox', { name: '下载源', exact: true });
  await page.getByText('下载源', { exact: true }).click();
  await expect(downloadSource).toHaveAttribute('aria-expanded', 'true');
  const popup = await page.getByRole('listbox').boundingBox();
  expect(popup.y).toBeGreaterThanOrEqual(0);
  expect(popup.y + popup.height).toBeLessThanOrEqual(651);
  await downloadSource.press('Escape');
  await app.close();
  app = undefined;

  const persisted = JSON.parse(await readFile(path.join(root, 'data/state.json'), 'utf8'));
  expect(persisted.appearance).toEqual({ backgroundId: imported, dim: 35, blur: 2 });
  expect(persisted.sidebarOrder).toEqual(savedOrder);
  page = await launch();
  await expect(page.locator('.sidebar .nav-item').nth(2)).toHaveAccessibleName('存档管理');
  await expect(page.locator('.sidebar-bottom button').first()).toHaveAccessibleName('启动器设置');
  await expect(page.locator('.sidebar-bottom button').last()).toHaveAccessibleName('账户管理');
  expect((await snapshot(page)).instances).toHaveLength(3);
  expect(await page.evaluate(() => window.kjmcl.backgroundImage())).toBe(image);
  await expect(page.locator('.app-background .background-scene > img')).toHaveAttribute(
    'src',
    image,
  );
  await page.getByRole('button', { name: '启动器设置', exact: true }).click();
  await page.locator('.appearance-settings > summary').click();
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.kjmcl.backgroundImage())).toBeNull();
  await expect(page.locator('.app-background .background-scene > img')).toHaveCount(0);
  expect((await snapshot(page)).appearance).toEqual({ dim: 35, blur: 2 });
  await app.close();
  app = undefined;
  page = await launch();
  expect(await page.evaluate(() => window.kjmcl.backgroundImage())).toBeNull();
  expect((await snapshot(page)).instances).toHaveLength(3);
  expect(errors).toEqual([]);
  console.log(
    'PASS edge-to-edge pixel landscape, single-column appearance controls, compact navigation, accessible dropdown keyboard/viewport, PNG/JPEG import, unsupported WebP preservation, validation/cancel, image independence, appearance persistence and reset (disposable local fixtures)',
  );
} finally {
  if (app) await app.close();
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
  if (
    !relative.startsWith('..') &&
    !path.isAbsolute(relative) &&
    path.basename(root).startsWith('kjmcl-appearance-')
  )
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
