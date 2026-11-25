import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, readFile, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { firstVisibleWindow, closeFixtureApp } from './desktop-test-utils.mjs';
import { litematicFixture } from '../tests/fixtures/projection-nbt.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-reden-desktop-'));
const live = process.env.KJMCL_LIVE_REDEN === '1';
const env = { ...process.env, KJMCL_DATA_DIR: path.join(root, 'data'), TEMP: root, TMP: root };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
let app;
try {
  const sourceAssets = path.resolve('.local/projection-render-assets/projection-workshop/assets');
  let cachedAssets = false;
  try {
    await cp(sourceAssets, path.join(env.KJMCL_DATA_DIR, 'projection-workshop/assets'), {
      recursive: true,
    });
    cachedAssets = true;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  app = await electron.launch(
    process.env.KJMCL_EXECUTABLE
      ? { executablePath: process.env.KJMCL_EXECUTABLE, args: [], env }
      : { args: ['.'], env },
  );
  const page = await firstVisibleWindow(app);
  await page.waitForSelector('h1');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const id = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: '投影验证', version: '1.21.1', loader: 'fabric' }),
  );
  const bytes = litematicFixture();
  const fileName = live ? '2x2 地下隐藏门.litematic' : '验收.litematic',
    name = live ? '2x2 地下隐藏门' : '红石验收样本';
  if (!live)
    await app.evaluate(
      async (_, { encoded, sha, name, fileName }) => {
        const { createRequire } = process.getBuiltinModule('node:module');
        const path = process.getBuiltinModule('node:path');
        const { MockAgent, setGlobalDispatcher } = createRequire(path.resolve('package.json'))(
          'undici',
        );
        const agent = new MockAgent();
        agent.disableNetConnect();
        setGlobalDispatcher(agent);
        const host = agent.get('https://redenmc.com'),
          cdn = agent.get('https://static.redenmc.com');
        const payload = Buffer.from(encoded, 'base64'),
          item = {
            key: 'redstone-sample',
            name,
            type: 'LitematicaShare',
            author: { username: 'Fixture' },
            versions: ['1.21.1'],
          };
        const gen = {
          ...item,
          key: 'sized',
          name: '尺寸生成器',
          type: 'LitematicaGen',
          hasX: true,
          hasY: false,
          hasZ: false,
          conditions: { x: ['min(2)', 'max(8)', 'mod(2,0)'] },
        };
        host
          .intercept({
            method: 'HEAD',
            path: /^\/api\/mc-services\/yisibite\/redstone-sample\/download\/2$/,
          })
          .reply(302, '', { headers: { location: 'https://static.redenmc.com/test/file' } })
          .persist();
        host
          .intercept({
            method: 'HEAD',
            path: '/api/mc-services/yisibite/sized?xSize=4&ySize=0&zSize=0',
          })
          .reply(200, '', { headers: { 'content-type': 'application/octet-stream' } })
          .persist();
        host
          .intercept({
            method: 'HEAD',
            path: '/api/mc-services/yisibite/sized?xSize=6&ySize=0&zSize=0',
          })
          .reply(302, '', { headers: { location: 'https://pan.quark.cn/s/fixture' } })
          .persist();
        host
          .intercept({ path: /^\/api\/mc-services\/litematica\/search\?/ })
          .reply(200, { d: [item, gen], count: 2, estimatedTotalHits: 2 })
          .persist();
        host
          .intercept({ path: '/api/mc-services/yisibite/redstone-sample/info/zh_cn' })
          .reply(200, {
            d: [
              {
                ...item,
                attachments: [
                  { name: '说明.txt', size: 12 },
                  { name: fileName, size: payload.length, sha256: sha },
                ],
              },
            ],
          })
          .persist();
        host
          .intercept({ path: '/api/mc-services/yisibite/redstone-sample/download/2' })
          .reply(302, '', { headers: { location: 'https://static.redenmc.com/test/file' } })
          .persist();
        cdn
          .intercept({
            path: '/test/file',
            headers: { referer: 'https://redenmc.com/zh_cn/litematica/redstone-sample' },
          })
          .reply(200, payload)
          .persist();
        host
          .intercept({ path: '/api/mc-services/yisibite/sized/info/zh_cn' })
          .reply(200, { d: [gen] })
          .persist();
        host
          .intercept({ path: '/api/mc-services/yisibite/sized?xSize=4&ySize=0&zSize=0' })
          .reply(200, payload)
          .persist();
      },
      {
        encoded: bytes.toString('base64'),
        sha: createHash('sha256').update(bytes).digest('hex'),
        name,
        fileName,
      },
    );
  await page.getByRole('button', { name: '资源管理', exact: true }).click();
  await page.getByRole('tab', { name: /投影原理图/ }).click();
  const browser = page.getByLabel('RedenMC 在线投影');
  await browser.getByLabel('搜索在线投影').fill(live ? '地下隐藏门' : '红石');
  await browser.getByRole('button', { name: '搜索', exact: true }).click();
  const hit = browser.locator('article').filter({ has: page.getByText(name, { exact: true }) });
  await expect(hit).toBeVisible({ timeout: 90000 });
  await expect(hit.getByRole('button', { name: '打开发布页 ' + name })).toBeVisible();
  const before = await page.evaluate(() => window.kjmcl.projectionState());
  await hit.getByRole('button', { name: '预览 ' + name }).click();
  const preview = page.getByRole('dialog');
  await expect(preview.getByLabel('投影俯视图')).toBeVisible({ timeout: 90000 });
  expect(
    await preview.locator('canvas').evaluate((c) =>
      c
        .getContext('2d')
        .getImageData(0, 0, c.width, c.height)
        .data.some((v, i) => i % 4 === 3 && v > 0),
    ),
  ).toBe(true);
  if (cachedAssets) {
    await preview.getByRole('button', { name: '立体' }).click();
    await expect(preview.locator('.projection-viewport')).toHaveAttribute(
      'data-render-status',
      'ready',
      { timeout: 90000 },
    );
  }
  await preview.getByRole('button', { name: '关闭', exact: true }).click();
  expect(await page.evaluate(() => window.kjmcl.projectionState())).toEqual(before);
  await hit.getByRole('button', { name: '下载 ' + name }).click();
  await expect(page.locator('.resource-list').getByText(fileName, { exact: true })).toBeVisible({
    timeout: 90000,
  });
  const installed = await readFile(
    path.join(env.KJMCL_DATA_DIR, 'instances', id, 'schematics', fileName),
  );
  if (live) {
    expect(installed.length).toBe(787);
    expect(installed[0]).toBe(31);
  } else {
    expect(installed.equals(bytes)).toBe(true);
    await browser.getByRole('button', { name: '预览 尺寸生成器' }).click();
    const settings = page.getByRole('dialog', { name: '尺寸生成器' });
    await settings.getByRole('spinbutton').fill('3');
    await expect(settings.getByRole('button', { name: '预览', exact: true })).toBeDisabled();
    await settings.getByRole('spinbutton').fill('4');
    await settings.getByRole('button', { name: '预览', exact: true }).click();
    await expect(page.getByLabel('投影俯视图')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await browser.getByRole('button', { name: '预览 尺寸生成器' }).click();
    await settings.getByRole('spinbutton').fill('6');
    await settings.getByRole('button', { name: '预览', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: '投影下载页' }).getByText(/夸克网盘/),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
  console.log(
    'PASS ' +
      (live
        ? 'live RedenMC search/author attachment'
        : 'fixture RedenMC redirects, filenames, generated sizes') +
      ', geometry preview and instance install (' +
      installed.length +
      ' bytes' +
      (cachedAssets ? ', textured 3D' : '') +
      ')',
  );
} finally {
  if (app) await closeFixtureApp(app);
  if (path.basename(root).startsWith('kjmcl-reden-desktop-'))
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
