import { answerSystemDialog, closeFixtureApp, firstVisibleWindow, navigateWorkspace } from './desktop-test-utils.mjs';
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-lightweight-desktop-'));
const env = { ...process.env, KJMCL_DATA_DIR: root };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
const options = process.env.KJMCL_EXECUTABLE
  ? { executablePath: process.env.KJMCL_EXECUTABLE, args: [], env }
  : { args: ['.'], env };
let app;
const errors = [];
async function current(lightweight) {
  let found;
  await expect
    .poll(
      async () => {
        found = app
          .windows()
          .find(
            (p) =>
              !p.isClosed() &&
              new URL(p.url()).pathname.endsWith(lightweight ? '/lightweight.html' : '/index.html'),
          );
        return !!found;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  // Minimized windows deliberately do not paint; wait for DOM, not animation-frame visibility.
  await found.waitForSelector('h1', { state: 'attached', timeout: 15000 });
  return found;
}
async function swap(page, action, lightweight) {
  const closed = page.waitForEvent('close', { timeout: 20000 });
  await action();
  await closed;
  return current(lightweight);
}
async function metrics(page) {
  await page.waitForTimeout(700);
  await app.evaluate(({ app }) => app.getAppMetrics());
  await page.waitForTimeout(3000);
  return app.evaluate(({ app }) =>
    app.getAppMetrics().map(({ pid, type, cpu, memory }) => ({ pid, type, cpu, memory })),
  );
}
try {
  app = await electron.launch(options);
  let page = await firstVisibleWindow(app);
  await page.waitForSelector('h1');
  await page.evaluate(() => window.kjmcl.addOffline('LightTester'));
  const ids = [];
  for (const name of ['轻量测试甲', '轻量测试乙'])
    ids.push(
      await page.evaluate(
        (name) => window.kjmcl.createInstance({ name, version: '1.21.1', loader: 'vanilla' }),
        name,
      ),
    );
  const runtime = (await page.evaluate(() => window.kjmcl.java())).find((j) => j.major >= 17);
  if (!runtime) throw new Error('JDK 17+ required');
  await app.close();
  app = undefined;
  const stateFile = path.join(root, 'state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  const fixture = path.join(root, 'fixture');
  await mkdir(fixture);
  await writeFile(
    path.join(fixture, 'LightSmoke.java'),
    `
import java.nio.file.*;
public class LightSmoke {
  public static void main(String[] args) throws Exception {
    System.out.println("LIGHT_JVM_READY");
    for(int n=0;n<12000;n++) {
      if(Files.exists(Path.of("finish.fixture"))) { System.out.println("LIGHT_JVM_END"); return; }
      if(Files.exists(Path.of("crash.fixture"))) { System.err.println("LIGHT_JVM_CRASH"); System.exit(7); }
      System.out.println("fixture tick " + n + " access_token=fixture_light_secret");
      Thread.sleep(10);
    }
  }
}`,
  );
  const bin = path.dirname(runtime.path),
    ext = process.platform === 'win32' ? '.exe' : '';
  execFileSync(path.join(bin, 'javac' + ext), [path.join(fixture, 'LightSmoke.java')]);
  for (const instance of state.instances) {
    await mkdir(instance.gameDir, { recursive: true });
    execFileSync(path.join(bin, 'jar' + ext), [
      'cf',
      path.join(instance.gameDir, 'client.jar'),
      '-C',
      fixture,
      'LightSmoke.class',
    ]);
    await writeFile(
      path.join(instance.gameDir, 'version.json'),
      JSON.stringify({
        id: 'fixture',
        type: 'release',
        mainClass: 'LightSmoke',
        libraries: [],
        javaVersion: { majorVersion: runtime.major },
        arguments: { jvm: ['-cp', '${classpath}'], game: ['--username', '${auth_player_name}'] },
      }),
    );
    instance.status = 'ready';
    instance.javaPath = runtime.path;
    instance.memoryMb = 512;
  }
  state.selectedInstanceId = ids[0];
  await writeFile(stateFile, JSON.stringify(state));
  app = await electron.launch(options);
  app.on('window', (p) => p.on('pageerror', (e) => errors.push(e.message)));
  page = await firstVisibleWindow(app);
  await page.waitForSelector('h1');
  page.on('pageerror', (e) => errors.push(e.message));
  const originalPid = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getOSProcessId(),
  );
  // Real spawned JVM -> automatic replacement, with no confirmation dialog.
  page = await swap(page, () => page.evaluate((id) => window.kjmcl.launch(id), ids[0]), true);
  await expect(page.getByRole('heading', { name: '轻量模式' })).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('font-family', /Fusion Pixel/);
  await expect(page.getByRole('button', { name: '打开完整界面' })).toHaveCSS(
    'font-family',
    /Fusion Pixel/,
  );
  await expect(page.getByRole('img', { name: 'KJMCL' })).toHaveJSProperty('naturalWidth', 512);
  await expect(page.locator('header')).not.toContainText('KJMCL');
  await expect(page.getByRole('status')).toContainText('已进入轻量模式');
  expect(
    (await page.evaluate(() => window.kjmcl.lightweightState())).games.map((g) => g.id),
  ).toEqual([ids[0]]);
  await expect
    .poll(() =>
      app.evaluate(({ app }, pid) => app.getAppMetrics().some((p) => p.pid === pid), originalPid),
    )
    .toBe(false);
  expect(await page.evaluate(() => document.querySelector('#root'))).toBeNull();
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  const boundaries = await page.evaluate(async () => {
    const rejected = async (fn) => {
      try {
        await fn();
        return false;
      } catch {
        return true;
      }
    };
    return {
      node: typeof window.require,
      snapshot: await rejected(() => window.kjmcl.snapshot()),
      invalid: await rejected(() => window.kjmcl.setLightweight('true')),
    };
  });
  expect(boundaries).toEqual({ node: 'undefined', snapshot: true, invalid: true });
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/lightweight-v061.png' });
  // No per-line log delivery or polling in the light renderer while the JVM remains chatty.
  await page.evaluate(() => {
    window.events = [];
    window.kjmcl.onEvent((e) => window.events.push(e.type));
  });
  const lightMetrics = await metrics(page);
  expect(
    await page.evaluate(() => window.events.includes('log') || window.events.includes('state')),
  ).toBe(false);
  expect(await readFile(path.join(state.instances[0].gameDir, 'logs/kjmcl.log'), 'utf8')).toContain(
    'fixture tick',
  );
  // Explicit full view lasts for this play session and supplies a recovery notification.
  page = await swap(page, () => page.getByRole('button', { name: '打开完整界面' }).click(), false);
  await expect(page.getByRole('status')).toContainText('已退出轻量模式');
  await navigateWorkspace(page, '游戏日志');
  const fullMetrics = await metrics(page);
  expect((await page.evaluate(() => window.kjmcl.snapshot())).running).toEqual([ids[0]]);
  const log = (await page.evaluate((id) => window.kjmcl.logs(id), ids[0]))
    .map((l) => l.text)
    .join('\n');
  expect(log).not.toContain('fixture_light_secret');
  // Multiple games: the first exit must not restore the full UI.
  await page.evaluate((id) => window.kjmcl.launch(id), ids[1]);
  await expect
    .poll(() => page.evaluate(async () => (await window.kjmcl.snapshot()).running.length))
    .toBe(2);
  page = await swap(page, () => page.evaluate(() => window.kjmcl.setLightweight(true)), true);
  await page.evaluate((id) => window.kjmcl.stop(id), ids[0]);
  await expect
    .poll(() => page.evaluate(async () => (await window.kjmcl.lightweightState()).games.length))
    .toBe(1);
  expect(page.url()).toContain('lightweight.html');
  await answerSystemDialog(app, () => app.evaluate(({ app }) => app.quit()), async (dialog) => {
    await expect(dialog.getByText('已启动的游戏会继续运行。')).toBeVisible();
    const closed = dialog.waitForEvent('close');
    await dialog.keyboard.down('Escape').catch((error) => {
      if (!dialog.isClosed()) throw error;
    });
    await closed;
  });
  await page.keyboard.up('Escape');
  page = await swap(
    page,
    () => writeFile(path.join(state.instances[1].gameDir, 'finish.fixture'), ''),
    false,
  );
  await expect(page.getByRole('status')).toContainText('已退出轻量模式');
  await expect
    .poll(() => page.evaluate(async (id) => (await window.kjmcl.sessions(id))[0]?.status, ids[1]))
    .toBe('exited');
  expect((await page.evaluate(() => window.kjmcl.snapshot())).running).toEqual([]);
  // Startup validation failure stays in the full view, and never reports mode entry.
  await page.evaluate(async (id) => {
    const instance = (await window.kjmcl.snapshot()).instances.find((i) => i.id === id);
    await window.kjmcl.updateInstance({ ...instance, jvmArgs: ['-Xmx8G'] });
    await window.kjmcl.launch(id);
  }, ids[0]);
  await expect
    .poll(() => page.evaluate(async (id) => (await window.kjmcl.sessions(id))[0]?.status, ids[0]))
    .toBe('failed');
  expect(page.url()).toContain('index.html');
  await page.evaluate(async (id) => {
    const instance = (await window.kjmcl.snapshot()).instances.find((i) => i.id === id);
    await window.kjmcl.updateInstance({ ...instance, jvmArgs: [] });
  }, ids[0]);
  // A renderer load failure keeps the old window and offers an explicit retry.
  await app.evaluate(({ BrowserWindow }) => {
    const original = BrowserWindow.prototype.loadFile;
    BrowserWindow.prototype.loadFile = function (file, options) {
      if (file.endsWith('lightweight.html')) {
        BrowserWindow.prototype.loadFile = original;
        return Promise.reject(new Error('synthetic light load failure'));
      }
      return original.call(this, file, options);
    };
  });
  await page.evaluate((id) => window.kjmcl.launch(id), ids[0]);
  await expect(page.getByRole('alert')).toContainText('界面切换失败');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  page = await swap(
    page,
    () => page.getByRole('button', { name: '进入轻量模式', exact: true }).click(),
    true,
  );
  // Abnormal process termination restores automatically too.
  page = await swap(
    page,
    () => writeFile(path.join(state.instances[0].gameDir, 'crash.fixture'), ''),
    false,
  );
  await expect
    .poll(() => page.evaluate(async (id) => (await window.kjmcl.sessions(id))[0]?.exitCode, ids[0]))
    .toBe(7);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  // Respect the existing minimize-on-launch preference and retain the notice while hidden.
  await rm(path.join(state.instances[0].gameDir, 'crash.fixture'));
  await page.evaluate(async () => {
    const state = await window.kjmcl.snapshot();
    await window.kjmcl.settings({ ...state.settings, closeOnLaunch: true });
  });
  page = await swap(page, () => page.evaluate((id) => window.kjmcl.launch(id), ids[0]), true);
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()))
    .toBe(true);
  await page.waitForTimeout(6100);
  expect(await page.locator('#notice').getAttribute('hidden')).toBeNull();
  page = await swap(
    page,
    () => writeFile(path.join(state.instances[0].gameDir, 'finish.fixture'), ''),
    false,
  );
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()))
    .toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
  await expect(page.getByRole('status')).toContainText('已退出轻量模式');
  expect(errors).toEqual([]);
  const evidence = {
    platform: process.platform,
    sampleMs: 3000,
    fixture:
      '100 log lines/second; full log page vs static light page; no Minecraft/FPS measurement',
    fullMetrics,
    lightMetrics,
  };
  await writeFile('.local/lightweight-metrics.json', JSON.stringify(evidence, null, 2));
  console.log(
    'PASS automatic light mode, old renderer process release, no log IPC, manual restore, multiple JVMs, normal/crash/failed launch, load failure rollback, sandbox and redaction (disposable JVM fixtures)',
  );
  console.log(
    'Resource samples saved to .local/lightweight-metrics.json (fixture only; not a game performance claim)',
  );
} finally {
  // Ask this test's own JVMs to finish before closing Electron; never touch player directories.
  for (const instance of JSON.parse(
    await readFile(path.join(root, 'state.json'), 'utf8').catch(() => '{"instances":[]}'),
  ).instances) {
    if (
      realpathSync
        .native(instance.gameDir)
        .toLowerCase()
        .startsWith(realpathSync.native(root).toLowerCase() + path.sep)
    )
      await writeFile(path.join(instance.gameDir, 'finish.fixture'), '').catch(() => {});
  }
  if (app) await closeFixtureApp(app);
  if (path.basename(root).startsWith('kjmcl-lightweight-desktop-'))
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
