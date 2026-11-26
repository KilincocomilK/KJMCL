import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { chromium, expect } from '@playwright/test';

const base = await realpath(os.tmpdir());
const root = await realpath(await mkdtemp(path.join(base, 'kjmcl-atlas-test-')));
assert.equal(path.dirname(root), base);
const pagePath = path.join(root, 'icon-atlas.html');
await copyFile(new URL('../../docs/icon-atlas.html', import.meta.url), pagePath);
const options = { headless: true };
if (process.env.KJMCL_TEST_BROWSER) options.executablePath = process.env.KJMCL_TEST_BROWSER;
else if (!existsSync(chromium.executablePath()) && process.platform === 'win32') {
  const paths = [
    path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
    path.join(
      process.env['ProgramFiles(x86)'] || process.env.ProgramFiles,
      'Microsoft/Edge/Application/msedge.exe',
    ),
  ];
  options.executablePath = paths.find(existsSync);
}
const url = pathToFileURL(pagePath).href;
const brush = {
  name: '手绘草方块.svg',
  mimeType: 'image/svg+xml',
  buffer: Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#79ae4d"/></svg>',
  ),
};
const second = {
  name: '第二稿.png',
  mimeType: 'image/png',
  buffer: await readFile(new URL('../../build/icon.png', import.meta.url)),
};
const browser = await chromium.launch(options);
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  const cards = page.locator('article.card'),
    block = cards.filter({ has: page.getByRole('heading', { name: '草方块', exact: true }) });
  const count = await page.evaluate(async () => {
    const { items } = JSON.parse(document.getElementById('inventory').textContent);
    if (
      new Set(items.map((i) => i.id)).size !== items.length ||
      items.some((i) => !i.title || !i.purpose || !i.refs.length)
    )
      throw Error('图鉴存在遗漏');
    await Promise.all(
      items
        .filter((i) => i.image)
        .map(async (i) => {
          const image = new Image();
          image.src = i.image;
          await image.decode();
        }),
    );
    return items.length;
  });
  await expect(cards).toHaveCount(count);
  await expect(page.locator('.card input[type=file]')).toHaveCount(count);
  for (const [id, filename] of [
    ['brand/application', 'KJMCL_icon.png'],
    ['inline/components/Brand', 'KJMCL_icon_02.png'],
  ]) {
    const reference = await page.evaluate((id) => {
      const { items } = JSON.parse(document.getElementById('inventory').textContent);
      return items.find((item) => item.id === id)?.image;
    }, id);
    const artwork = await readFile(new URL('../../resources/icons/' + filename, import.meta.url));
    assert.equal(reference, 'data:image/png;base64,' + artwork.toString('base64'));
  }
  const refDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载全部参考图' }).click();
  const refZip = path.join(root, 'refs.zip');
  await (await refDownload).saveAs(refZip);
  const refs = new AdmZip(refZip);
  assert.equal(refs.getEntries().filter((e) => e.entryName.endsWith('.png')).length, count);
  assert.equal(refs.readFile('references/pixel/block.png').readUInt32BE(16), 16);
  assert.equal(refs.readFile('references/lucide/Eye.png').readUInt32BE(16), 24);
  assert(refs.readAsText('图标清单.csv').includes('草方块'));
  await page.locator('#area').selectOption({ label: '世界地图' });
  await page.getByRole('searchbox').fill('SquarePlus');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('框选添加');
  await page.getByRole('searchbox').fill('');
  await page.locator('#area').selectOption('');
  await page.locator('[data-state="done"]').click();
  await expect(cards).toHaveCount(0);
  await page.locator('[data-state="all"]').click();

  const chooser = page.waitForEvent('filechooser');
  await block.getByRole('button', { name: '上传手绘 · 草方块' }).click();
  await (await chooser).setFiles(brush);
  await expect(block.getByAltText('手绘稿')).toHaveCount(1);
  await page.reload();
  await expect(block.getByAltText('手绘稿')).toHaveCount(1);
  await block.getByRole('button', { name: '查看绘制参考 · 草方块' }).click();
  const detail = page.locator('#detail');
  await expect(detail).toContainText('手绘草方块.svg');
  await expect(detail).toContainText('16 × 16 px');
  await detail
    .locator('input[type=file]')
    .setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('bad') });
  await expect(detail.getByRole('status')).toContainText('支持 PNG');
  await expect(detail).toContainText('手绘草方块.svg');
  await detail.getByRole('button', { name: '关闭详情' }).click();
  await block.locator('input').setInputFiles(second);
  await expect(page.locator('#notice')).toContainText('已保存「草方块」的手绘稿');

  // Chromium exposes origin-private directory handles on loopback. Use one as the
  // native picker result while the upload, backup, and persistence tests use file://.
  const folderPage = await context.newPage();
  await folderPage.addInitScript(() => {
    window.showDirectoryPicker = () => navigator.storage.getDirectory();
  });
  await folderPage.route('http://127.0.0.1/artwork', (route) =>
    route.fulfill({ path: pagePath, contentType: 'text/html; charset=utf-8' }),
  );
  await folderPage.goto('http://127.0.0.1/artwork');
  const folderInput = folderPage.locator('[data-id="pixel/block"] input');
  await folderInput.setInputFiles(brush);
  await expect(folderPage.locator('#count')).toHaveText('1 / ' + count);
  await folderPage.getByRole('button', { name: '画稿目录', exact: true }).click();
  await expect(folderPage.locator('#notice')).toContainText('已同步');
  await folderPage.reload();
  await expect(folderPage.locator('#storage-note')).toContainText('KJMCL-画稿');
  await folderInput.setInputFiles(second);
  await expect(folderPage.locator('#notice')).toContainText('已保存「草方块」的手绘稿。已同步');
  const copies = await folderPage.evaluate(async () => {
    const d = await (
      await (await navigator.storage.getDirectory()).getDirectoryHandle('KJMCL-画稿')
    ).getDirectoryHandle('pixel');
    const files = [];
    for await (const f of d.values()) {
      const data = await f.getFile();
      files.push([f.name, data.size]);
    }
    return files;
  });
  assert.equal(copies.length, 2);
  assert(copies.some(([n, s]) => n.endsWith('.png') && s === second.buffer.length));
  assert(copies.some(([n, s]) => n.endsWith('.svg') && s === brush.buffer.length));
  const received = page.waitForEvent('download');
  await page.locator('#export').click();
  const backup = path.join(root, 'artwork.zip');
  await (await received).saveAs(backup);
  const zip = new AdmZip(backup);
  assert.deepEqual(zip.readFile('artwork/pixel/block.png'), second.buffer);
  assert.equal(JSON.parse(zip.readAsText('manifest.json')).items[0].name, second.name);
  await block.locator('input').setInputFiles(brush);
  await expect(page.locator('#notice')).toContainText('已保存「草方块」');
  await page.locator('#backup-file').setInputFiles(backup);
  await expect(page.locator('#confirm')).toBeVisible();
  await page.locator('#no').click();
  await block.locator('.plate').click();
  await expect(detail).toContainText(brush.name);
  await detail.getByRole('button', { name: '关闭详情' }).click();
  await page.locator('#backup-file').setInputFiles(backup);
  await page.locator('#yes').click();
  await expect(page.locator('#notice')).toContainText('已导入 1 张');
  await block.locator('.plate').click();
  await expect(detail).toContainText(second.name);
  await detail.getByRole('button', { name: '关闭详情' }).click();

  // Replacing the generated document at the same location must preserve existing IDs' drafts.
  const html = await readFile(pagePath, 'utf8');
  await writeFile(
    pagePath,
    html.replace('<title>KJMCL 图标图鉴</title>', '<title>图鉴更新回归</title>'),
  );
  await page.reload();
  await expect(page).toHaveTitle('图鉴更新回归');
  await expect(block.getByAltText('手绘稿')).toHaveCount(1);
  const fresh = await browser.newContext(),
    p2 = await fresh.newPage();
  await p2.goto(url);
  await expect(p2.locator('#count')).toHaveText('0 / ' + count);
  await p2.locator('#backup-file').setInputFiles(backup);
  await expect(p2.locator('#count')).toHaveText('1 / ' + count);
  await p2.setViewportSize({ width: 390, height: 844 });
  assert.equal(await p2.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.deepEqual(errors, []);
  console.log(
    'Verified ' +
      count +
      ' references and upload controls, file persistence, replacement, folder copies via a test directory handle, ZIP round-trip, catalogue regeneration and mobile layout.',
  );
} finally {
  await browser.close();
  if (path.dirname(root) === base && path.basename(root).startsWith('kjmcl-atlas-test-'))
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
