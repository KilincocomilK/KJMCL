import { firstVisibleWindow } from './desktop-test-utils.mjs';
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-library-desktop-'));
const env = { ...process.env, KJMCL_DATA_DIR: root };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
let app;
const launch = () =>
  electron.launch(
    process.env.KJMCL_EXECUTABLE
      ? { executablePath: process.env.KJMCL_EXECUTABLE, args: [], env }
      : { args: ['.'], env },
  );
try {
  app = await launch();
  let page = await firstVisibleWindow(app);
  await page.waitForSelector('h1');
  const id = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: '建筑测试', version: '1.21.1', loader: 'fabric' }),
  );
  const other = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: '生存测试', version: '1.21.1', loader: 'vanilla' }),
  );
  await page.evaluate((id) => window.kjmcl.select({ instanceId: id }), id);
  await app.close();
  app = undefined;
  const game = path.join(root, 'instances', id);
  await mkdir(path.join(game, 'mods'), { recursive: true });
  for (const name of ['a.jar', 'b.jar']) {
    const zip = new AdmZip();
    zip.addFile(
      'fabric.mod.json',
      Buffer.from(JSON.stringify({ id: 'duplicate', version: '1.0', depends: { absent: '*' } })),
    );
    await writeFile(path.join(game, 'mods', name), zip.toBuffer());
  }
  await mkdir(path.join(game, 'crash-reports'));
  await writeFile(
    path.join(game, 'crash-reports/crash-ui.txt'),
    `OutOfMemoryError: Java heap space\naccessToken=ui-secret-token\n${game}\nmail@example.org`,
  );
  await mkdir(path.join(root, 'cache'), { recursive: true });
  await writeFile(path.join(root, 'cache', 'old.tmp'), 'old-cache');
  const old = new Date(Date.now() - 48 * 3600000);
  await utimes(path.join(root, 'cache', 'old.tmp'), old, old);
  await writeFile(path.join(root, 'cache', 'fresh.tmp'), 'keep');
  const file = path.join(root, 'state.json'),
    state = JSON.parse(await readFile(file, 'utf8'));
  state.favorites = [
    {
      source: 'modrinth',
      kind: 'resourcepack',
      projectId: 'fixture',
      title: '测试资源收藏',
      description: '仅存在于隔离桌面测试目录',
      author: 'fixture',
      downloads: 0,
      url: 'https://modrinth.com/resourcepack/fixture',
      group: '视觉',
      savedAt: Date.now(),
    },
  ];
  await writeFile(file, JSON.stringify(state));
  app = await launch();
  page = await firstVisibleWindow(app);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('h1');
  await page.getByRole('button', { name: '游戏实例', exact: true }).click();
  await page.getByLabel('建筑测试 分组与备注').click();
  await page.getByLabel('分组名称').fill('建筑');
  await page.getByLabel('实例标签').fill('创作, 红石');
  await page.getByLabel('实例备注').fill('桌面验证备注');
  await page.getByRole('button', { name: '保存整理', exact: true }).click();
  await page.getByLabel('收藏 建筑测试', { exact: true }).click();
  await page.getByLabel('实例分组').selectOption('建筑');
  await page.getByLabel('切换实例视图').click();
  await expect(page.getByText('桌面验证备注', { exact: true })).toBeVisible();
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/library-v060.png' });
  await expect(page.getByRole('button', { name: '生存测试', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '内容中心', exact: true }).click();
  await page.getByRole('button', { name: /收藏夹/ }).click();
  await expect(page.getByRole('heading', { name: '测试资源收藏', exact: true })).toBeVisible();
  await page.getByLabel('测试资源收藏 收藏分组').fill('常用');
  await page.getByRole('heading', { name: '测试资源收藏', exact: true }).click();
  await expect
    .poll(async () => JSON.parse(await readFile(file, 'utf8')).favorites[0].group)
    .toBe('常用');
  await page.screenshot({ path: '.local/catalog-v060.png' });
  await page.getByRole('button', { name: '模组中心', exact: true }).click();
  await page.getByRole('button', { name: '检查与批量操作', exact: true }).click();
  await expect(page.getByText('重复模组 ID：duplicate', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: '选择筛选结果', exact: true }).click();
  await page.getByRole('button', { name: '批量停用', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认批量模组操作' })).toBeVisible();
  await page.getByRole('button', { name: '应用变更', exact: true }).click();
  await expect
    .poll(() => readdir(path.join(game, 'mods')))
    .toEqual(['a.jar.disabled', 'b.jar.disabled']);
  await page.getByRole('button', { name: '崩溃报告', exact: true }).click();
  await page.getByRole('button', { name: /crash-ui.txt/ }).click();
  await expect(page.getByRole('heading', { name: 'Java 堆内存不足', exact: true })).toBeVisible();
  await expect(page.locator('.crash-text')).not.toContainText('ui-secret-token');
  await expect(page.locator('.crash-text')).toContainText('[INSTANCE]');
  await app.evaluate(
    ({ dialog }, output) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
    },
    path.join(root, 'exported.zip'),
  );
  await page.getByRole('button', { name: '导出诊断包', exact: true }).click();
  await expect
    .poll(async () => {
      try {
        return new AdmZip(await readFile(path.join(root, 'exported.zip'))).getEntries().length;
      } catch {
        return 0;
      }
    })
    .toBe(3);
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/crashes-v060.png' });
  await page.getByRole('button', { name: '磁盘管理', exact: true }).click();
  await page.getByRole('button', { name: '分析磁盘占用', exact: true }).click();
  await expect(page.getByRole('heading', { name: /已统计/ })).toBeVisible();
  await page.screenshot({ path: '.local/disk-usage-v060.png' });
  await page.getByRole('button', { name: '预览缓存清理', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '清理缓存预览' })).toBeVisible();
  await page.getByRole('button', { name: '清理这些缓存', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已清理 1 个文件' })).toBeVisible();
  expect(await readFile(path.join(root, 'cache/fresh.tmp'), 'utf8')).toBe('keep');
  await page.screenshot({ path: '.local/maintenance-v060.png' });
  const rejected = await page.evaluate(async (id) => {
    try {
      await window.kjmcl.readCrash({ id, name: '../state.json' });
      return false;
    } catch {
      return true;
    }
  }, id);
  expect(rejected).toBe(true);
  expect(errors).toEqual([]);
  await app.close();
  app = await launch();
  page = await firstVisibleWindow(app);
  await page.waitForSelector('h1');
  const persisted = await page.evaluate(() => window.kjmcl.snapshot());
  expect(persisted.instances.find((i) => i.id === id).organization).toMatchObject({
    group: '建筑',
    favorite: true,
    tags: ['创作', '红石'],
  });
  expect(persisted.favorites[0].group).toBe('常用');
  expect(persisted.instances.some((i) => i.id === other)).toBe(true);
  console.log(
    'PASS instance organization/favorites persistence, offline collection groups, mod audit/batch, redacted crash export and reviewed cache cleanup (disposable fixtures; no live content API acceptance)',
  );
} finally {
  if (app) await app.close();
  if (path.basename(root).startsWith('kjmcl-library-desktop-'))
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
