import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { firstVisibleWindow, selectLauncherOption } from './desktop-test-utils.mjs';

const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kjmcl-welcome-')));
const data = path.join(root, 'data');
const source = path.join(root, 'portable', '.minecraft');
const target = path.join(root, 'copies');
const env = { ...process.env, KJMCL_DATA_DIR: data, MINECRAFT_HOME: source };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
const options = process.env.KJMCL_EXECUTABLE
  ? { executablePath: process.env.KJMCL_EXECUTABLE, args: [], env }
  : { args: ['.'], env };
let app;
let page;
const open = async () => {
  app = await electron.launch(options);
  page = await firstVisibleWindow(app, { welcome: true });
};
const click = (name) => page.getByRole('button', { name, exact: true }).click();
const next = () => click('下一步');
try {
  const version = path.join(source, 'versions', '1.21.1');
  await mkdir(version, { recursive: true });
  await mkdir(target);
  await writeFile(
    path.join(version, '1.21.1.json'),
    JSON.stringify({ id: '1.21.1', mainClass: 'Fixture', libraries: [] }),
  );
  await writeFile(path.join(version, '1.21.1.jar'), 'unused fixture');
  await writeFile(path.join(source, 'options.txt'), 'fov:0.5');
  await open();
  await expect(page.getByRole('heading', { name: '欢迎使用 KJMCL' })).toBeVisible();
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/welcome-first-run.png' });
  await page.getByRole('button', { name: /第一次玩/ }).click();
  await expect(page.getByRole('button', { name: '跳过', exact: true })).toBeVisible();
  await click('使用默认文件夹');
  await expect(page.getByText(/文件夹已就绪/)).toBeVisible();
  expect((await stat(path.join(data, 'instances'))).isDirectory()).toBe(true);
  await next();
  await expect(page.getByRole('heading', { name: '配置 Java 环境' })).toBeVisible();
  const javaField = '准备游玩的 Minecraft 版本';
  const combo = page.getByRole('combobox', { name: javaField });
  const scan = page.getByRole('button', { name: '重新检测', exact: true });
  await expect(scan).toBeEnabled({ timeout: 20000 });
  const { available } = await page.evaluate(() => window.kjmcl.welcomeJavaInfo());
  const preferred = [25, 21, 17, 16, 8].find((major) => available.some((j) => j.major === major));
  const defaultMajor = preferred ?? 25;
  await expect(combo).toContainText(`Java ${defaultMajor}`);
  expect(await page.locator('.welcome-java .row button').first().innerText()).toBe('重新检测');
  const manualMajor = defaultMajor === 8 ? 17 : 8;
  await selectLauncherOption(page, javaField, manualMajor);
  await scan.click();
  await expect(scan).toBeEnabled({ timeout: 20000 });
  await expect(combo).toContainText(`Java ${manualMajor}`);
  await expect(page.getByRole('button', { name: '跳过', exact: true })).toBeVisible();
  if (preferred) {
    await selectLauncherOption(page, javaField, preferred);
    await click('应用推荐配置');
    await expect(page.getByRole('button', { name: '已配置', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeVisible();
  }
  await app.close();
  await open();
  await expect(page.getByRole('heading', { name: '配置 Java 环境' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: preferred ? '下一步' : '跳过', exact: true }),
  ).toBeVisible();
  await click('上一步');
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeVisible();
  await click('上一步');
  await page.getByRole('button', { name: /我玩过/ }).click();
  await expect(page.getByRole('button', { name: '跳过', exact: true })).toBeVisible();
  await page.getByRole('button').filter({ hasText: source }).click();
  const review = page.getByRole('dialog', { name: '导入游戏数据' });
  await expect(review).toContainText('发现 1 个版本');
  await selectLauncherOption(page, '导入方式', 'copy');
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, target);
  await click('选择副本位置');
  await expect(review).toHaveCount(0);
  const snapshot = await page.evaluate(() => window.kjmcl.snapshot());
  expect(snapshot.instances).toHaveLength(1);
  expect(path.dirname(snapshot.gameFolders[0].path)).toBe(target);
  expect(await readFile(path.join(snapshot.gameFolders[0].path, 'options.txt'), 'utf8')).toBe(
    'fov:0.5',
  );
  expect(await readFile(path.join(source, 'options.txt'), 'utf8')).toBe('fov:0.5');
  await next();
  await expect(page.getByRole('heading', { name: '配置 Java 环境' })).toBeVisible();
  await click(preferred ? '下一步' : '跳过');
  await page.getByPlaceholder('Player', { exact: true }).fill('WelcomeTester');
  await expect(page.getByRole('button', { name: '跳过', exact: true })).toBeVisible();
  await click('添加账户');
  await expect(page.getByText('当前账户 · WelcomeTester')).toBeVisible();
  await next();
  await expect(page.getByRole('combobox', { name: '模型服务' })).toBeVisible();
  await click('跳过');
  await expect(page.getByRole('heading', { name: '准备完成' })).toBeVisible();
  await click('上一步');
  await page.getByLabel('模型 ID', { exact: true }).fill('welcome-test-model');
  await expect(page.getByRole('button', { name: '跳过', exact: true })).toBeVisible();
  await click('保存并使用');
  await next();
  await expect(page.getByRole('heading', { name: '准备完成' })).toBeVisible();
  await click('进入首页');
  await app.close();
  await open();
  await expect(page.getByRole('heading', { name: '开始游戏', exact: true })).toBeVisible();
  await click('启动器设置');
  await page.getByText('游戏目录与迁移', { exact: true }).click();
  await click('导入其他启动器');
  await expect(page.getByRole('dialog', { name: '导入其他启动器' })).toContainText(source);
  console.log(
    'PASS welcome routes, resume, default folder, discovery, independent copy, account, skip, completion and settings re-entry',
  );
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true, maxRetries: 8 });
}
