import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';

if (process.platform !== 'win32' || !process.env.KJMCL_PORTABLE)
  throw new Error('Set KJMCL_PORTABLE to the built Windows portable EXE');
await mkdir('.local', { recursive: true });
const base = realpathSync.native(path.resolve('.local'));
const work = realpathSync.native(await mkdtemp(path.join(base, 'kjmcl-portable-test-')));
const executable = path.join(work, 'KJMCL portable.exe');
await copyFile(process.env.KJMCL_PORTABLE, executable);
const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const endpoint = `http://127.0.0.1:${port}`;
const env = { ...process.env };
for (const name of [
  'ELECTRON_RUN_AS_NODE',
  'KJMCL_DEV_URL',
  'KJMCL_DATA_DIR',
  'PORTABLE_EXECUTABLE_DIR',
  'PORTABLE_EXECUTABLE_FILE',
])
  delete env[name];
let browser, page, wrapper;
const ownedProcesses = new Set();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function connect() {
  let version;
  await expect
    .poll(
      async () => {
        try {
          version = await (await fetch(endpoint + '/json/version')).json();
          return !!version.webSocketDebuggerUrl;
        } catch {
          return false;
        }
      },
      { timeout: 45000 },
    )
    .toBe(true);
  browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl);
  const session = await browser.newBrowserCDPSession();
  const { processInfo } = await session.send('SystemInfo.getProcessInfo');
  const pid = processInfo.find((p) => p.type === 'browser').id;
  ownedProcesses.add(pid);
  await expect.poll(() => browser.contexts()[0]?.pages().length || 0).toBeGreaterThan(0);
  page = browser.contexts()[0].pages()[0];
  await page.waitForSelector('h1');
  return pid;
}
try {
  wrapper = spawn(executable, [`--remote-debugging-port=${port}`], {
    env,
    windowsHide: true,
    stdio: 'ignore',
  });
  const firstPid = await connect();
  const control = path.join(work, 'KJMCL-data');
  const initial = await page.evaluate(() => window.kjmcl.snapshot());
  expect(initial.storage.mode).toBe('portable');
  expect(initial.dataPath).toBe(control);
  await page.evaluate(() => window.kjmcl.addOffline('Portable_Test'));
  const target = path.join(work, 'migrated-data');
  await page.evaluate((target) => window.kjmcl.migrateStorage(target), target);
  await expect
    .poll(() => page.evaluate(async () => (await window.kjmcl.snapshot()).storage.pendingRestart))
    .toBe(target);
  await page.getByRole('button', { name: '启动器设置', exact: true }).click();
  const disconnected = new Promise((resolve) => browser.once('disconnected', resolve));
  await page.getByRole('button', { name: '重启并切换', exact: true }).click();
  await disconnected;
  const secondPid = await connect();
  expect(secondPid).not.toBe(firstPid);
  const restarted = await page.evaluate(() => window.kjmcl.snapshot());
  expect(restarted.storage.mode).toBe('portable');
  expect(restarted.dataPath).toBe(target);
  expect(restarted.accounts[0].name).toBe('Portable_Test');
  expect(JSON.parse(await readFile(path.join(control, 'storage-location.json'), 'utf8')).root).toBe(
    target,
  );
  await expect.poll(() => wrapper.exitCode, { timeout: 10000 }).toBe(0);
  // The old wrapper has now completed cleanup. Force a renderer reload to prove the new
  // process still has its HTML, preload and JavaScript, not just an already painted window.
  await page.reload();
  await page.waitForSelector('h1');
  expect((await page.evaluate(() => window.kjmcl.snapshot())).accounts[0].name).toBe(
    'Portable_Test',
  );
  await page.screenshot({ path: '.local/storage-portable.png' });
  console.log(
    'PASS actual portable EXE: adjacent data, migration, outer-wrapper restart, new process, old-wrapper cleanup and renderer reload',
  );
} finally {
  await page?.evaluate(() => window.kjmcl.window('close')).catch(() => {});
  await browser?.close().catch(() => {});
  // Only PIDs reported by this test's isolated CDP browser connection may be terminated.
  for (const pid of ownedProcesses) {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        process.kill(pid, 0);
      } catch {
        break;
      }
      await delay(100);
    }
    try {
      process.kill(pid, 0);
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {}
  }
  if (wrapper && wrapper.exitCode === null) wrapper.kill();
  if (work.startsWith(base + path.sep) && path.basename(work).startsWith('kjmcl-portable-test-'))
    await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
