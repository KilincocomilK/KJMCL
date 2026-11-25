import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  firstVisibleWindow,
  navigateWorkspace,
  selectLauncherOption,
} from './desktop-test-utils.mjs';

// Run after an approved build. All accounts, events and files below are disposable fixtures.
const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-convenience-desktop-'));
const env = { ...process.env, KJMCL_DATA_DIR: root };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
const options = process.env.KJMCL_EXECUTABLE
  ? { executablePath: process.env.KJMCL_EXECUTABLE, args: [], env }
  : { args: ['.'], env };
let app;
const errors = [];
async function launch() {
  app = await electron.launch(options);
  const page = await firstVisibleWindow(app);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('h1');
  return page;
}
const snapshot = (page) => page.evaluate(() => window.kjmcl.snapshot());
async function emit(id, text, count = 1) {
  await app.evaluate(
    ({ BrowserWindow }, payload) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
      if (!window) throw new Error('Test window missing');
      for (let index = 0; index < payload.count; index++) {
        window.webContents.send('kjmcl:event', {
          type: 'log',
          line: {
            instanceId: payload.id,
            time: Date.now(),
            level: 'info',
            text: payload.count === 1 ? payload.text : `${payload.text} ${index}`,
          },
        });
      }
    },
    { id, text, count },
  );
}
try {
  let page = await launch();
  const accounts = await page.evaluate(async () => {
    const first = await window.kjmcl.addOffline('FixtureFirst');
    const second = await window.kjmcl.addOffline('FixtureSecond');
    const third = await window.kjmcl.addOffline('FixtureThird');
    await window.kjmcl.select({ accountId: second.id });
    return [first.id, second.id, third.id];
  });
  await navigateWorkspace(page, '账户');
  await expect(page.locator('.account-card h2')).toHaveText([
    'FixtureFirst',
    'FixtureSecond',
    'FixtureThird',
  ]);
  await expect(page.getByLabel('上移账户 FixtureFirst', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('下移账户 FixtureThird', { exact: true })).toBeDisabled();
  await page.getByLabel('上移账户 FixtureSecond', { exact: true }).click();
  await expect(page.locator('.account-card h2')).toHaveText([
    'FixtureSecond',
    'FixtureFirst',
    'FixtureThird',
  ]);
  expect((await snapshot(page)).selectedAccountId).toBe(accounts[1]);
  await page.getByLabel('下移账户 FixtureFirst', { exact: true }).click();
  await expect(page.locator('.account-card h2')).toHaveText([
    'FixtureSecond',
    'FixtureThird',
    'FixtureFirst',
  ]);
  await app.close();
  app = undefined;
  page = await launch();
  expect((await snapshot(page)).accounts.map((account) => account.id)).toEqual([
    accounts[1],
    accounts[2],
    accounts[0],
  ]);
  expect((await snapshot(page)).selectedAccountId).toBe(accounts[1]);
  const ids = await page.evaluate(async () => {
    const first = await window.kjmcl.createInstance({
      name: '日志测试',
      version: '1.21.1',
      loader: 'vanilla',
    });
    const second = await window.kjmcl.createInstance({
      name: '其他实例',
      version: '1.21.1',
      loader: 'vanilla',
    });
    await window.kjmcl.select({ instanceId: first });
    return [first, second];
  });
  const game = (await snapshot(page)).instances.find((instance) => instance.id === ids[0]).gameDir;
  await mkdir(path.join(game, 'logs'), { recursive: true });
  const source = path.join(game, 'logs', 'kjmcl.log');
  const persisted =
    Array.from({ length: 3500 }, (_, index) => `persisted line ${index}`).join('\n') +
    '\npassword="two secret words"\nBearer hidden-token\n';
  await writeFile(source, persisted);
  await navigateWorkspace(page, '游戏日志');
  const log = page.getByRole('log');
  await expect(log).toContainText('暂无日志');
  // These synthetic events bypass the launcher's history. Wait for the page's
  // subscription to receive a probe before testing an exact, unrepeated batch.
  await expect
    .poll(async () => {
      await emit(ids[0], '[main/INFO] listener ready fixture');
      return log.innerText();
    })
    .toContain('listener ready fixture');
  await emit(ids[0], '[main/INFO] scrolling fixture', 120);
  await expect(log).toContainText('scrolling fixture 119');
  await expect(log.locator('pre').filter({ hasText: 'scrolling fixture' })).toHaveText(
    Array.from({ length: 120 }, (_, index) => `[main/INFO] scrolling fixture ${index}`),
  );
  await expect
    .poll(() => log.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeLessThan(25);
  await log.evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(page.getByRole('checkbox', { name: '跟随', exact: true })).not.toBeChecked();
  await emit(ids[0], '[main/INFO] stay at reading position');
  await expect(log).toContainText('stay at reading position');
  expect(await log.evaluate((node) => node.scrollTop)).toBe(0);
  await page.getByRole('checkbox', { name: '跟随', exact: true }).check();
  await expect
    .poll(() => log.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeLessThan(25);

  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const frozen = await log.innerText();
  await emit(ids[0], '[main/INFO] received while paused', 20);
  await emit(ids[1], '[main/ERROR] never show another instance');
  // A state request provides a round trip after the synthetic event delivery.
  await snapshot(page);
  await expect.poll(() => log.innerText()).toBe(frozen);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(log).toContainText('received while paused 19');
  await expect(log).not.toContainText('another instance');
  await emit(ids[0], '[main/WARN] warning accessToken=[REDACTED]');
  await emit(ids[0], '[main/ERROR] error fixture');
  await selectLauncherOption(page, '日志等级', 'warn');
  await expect(log).toContainText('warning');
  await expect(log).not.toContainText('error fixture');
  await page.getByLabel('过滤日志', { exact: true }).fill('warning');
  // Avoid changing the user's system clipboard; this verifies the exact UI payload.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.fixtureCopiedLog = value;
        },
      },
    });
  });
  await page.getByRole('button', { name: '复制', exact: true }).click();
  const copied = await page.evaluate(() => window.fixtureCopiedLog);
  expect(copied).toContain('[WARN]');
  expect(copied).toContain('[REDACTED]');
  expect(copied).not.toContain('error fixture');
  await page.getByLabel('过滤日志', { exact: true }).fill('does not match');
  await expect(log).toContainText('没有匹配的日志');
  await expect(page.getByRole('button', { name: '复制', exact: true })).toBeDisabled();
  await page.getByLabel('过滤日志', { exact: true }).fill('');
  await selectLauncherOption(page, '日志等级', 'all');
  await emit(ids[0], '[main/INFO] ' + 'long-text '.repeat(200));
  await page.getByRole('checkbox', { name: '换行', exact: true }).uncheck();
  await expect(log).toHaveClass(/log-nowrap/);
  await page.getByRole('checkbox', { name: '换行', exact: true }).check();
  await expect(log).not.toHaveClass(/log-nowrap/);

  const output = path.join(root, 'complete.log');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, output);
  await page.getByRole('button', { name: '导出完整日志', exact: true }).click();
  await expect
    .poll(() => readFile(output, 'utf8').catch(() => ''))
    .toContain('persisted line 3499');
  const exported = await readFile(output, 'utf8');
  expect(exported).toContain('persisted line 0');
  expect(exported).not.toContain('secret words');
  expect(exported).not.toContain('hidden-token');
  expect(await readFile(source, 'utf8')).toBe(persisted);
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  expect(await page.evaluate((id) => window.kjmcl.exportCompleteLogs(id), ids[0])).toBeNull();
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, source);
  const rejected = await page.evaluate(async (id) => {
    try {
      await window.kjmcl.exportCompleteLogs(id);
      return false;
    } catch {
      return true;
    }
  }, ids[0]);
  expect(rejected).toBe(true);
  expect(await readFile(source, 'utf8')).toBe(persisted);
  await page.evaluate((id) => window.kjmcl.select({ instanceId: id }), ids[1]);
  await expect(log).toContainText('暂无日志');
  await expect(log).not.toContainText('received while paused');
  await page.evaluate(
    async ({ id, accountId }) => {
      const instance = (await window.kjmcl.snapshot()).instances.find((item) => item.id === id);
      await window.kjmcl.updateInstance({
        ...instance,
        launchOptions: { accountId, fullscreen: true, target: { kind: 'menu' } },
      });
    },
    { id: ids[0], accountId: accounts[1] },
  );
  await app.close();
  app = undefined;
  page = await launch();
  expect(
    (await snapshot(page)).instances.find((instance) => instance.id === ids[0]).launchOptions,
  ).toEqual({ accountId: accounts[1], fullscreen: true, target: { kind: 'menu' } });
  await page.getByRole('button', { name: '游戏实例', exact: true }).click();
  await page.getByRole('button', { name: '日志测试', exact: true }).click();
  await page.getByRole('button', { name: '日志测试 设置', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '启动账户', exact: true })).toContainText(
    'FixtureSecond',
  );
  await expect(page.getByRole('checkbox', { name: '全屏启动', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  expect(errors).toEqual([]);
  console.log(
    'PASS account ordering/restart, synthetic live log pause/follow/filter/copy payload/wrap, full log IPC export/cancel/source protection (disposable fixtures; no Minecraft or native clipboard acceptance)',
  );
} finally {
  if (app) await app.close();
  if (
    path.dirname(root) === path.resolve(os.tmpdir()) &&
    path.basename(root).startsWith('kjmcl-convenience-desktop-')
  ) {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}
