import { firstVisibleWindow } from './desktop-test-utils.mjs';
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import AdmZip from 'adm-zip';
const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-desktop-'));
await mkdir(path.resolve('.local'), { recursive: true });
// On this Windows host userData is on C: and the workspace is on F:.
// Keep custom games on the workspace volume to exercise real cross-volume copies.
const customRoot = await mkdtemp(path.join(path.resolve('.local'), 'kjmcl-custom-'));
const env = { ...process.env, KJMCL_DATA_DIR: root };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
const launchOptions = process.env.KJMCL_EXECUTABLE
  ? { executablePath: process.env.KJMCL_EXECUTABLE, args: [], env }
  : { args: ['.'], env };
let app;
try {
  app = await electron.launch(launchOptions);
  const page = await firstVisibleWindow(app);
  await page.waitForSelector('h1');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.getByRole('heading', { name: '开始游戏', exact: true })).toBeVisible();
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/home-empty.png' });
  await page.getByRole('button', { name: '账户', exact: true }).click();
  await page.getByPlaceholder('Player', { exact: true }).fill('KJMC_Tester');
  await page.getByRole('button', { name: '添加账户', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'KJMC_Tester' })).toBeVisible();
  await page.getByRole('button', { name: '启动器设置', exact: true }).click();
  await page.getByRole('button', { name: '检测', exact: true }).click();
  await expect(page.locator('.java-list')).toBeVisible({ timeout: 20000 });
  // Exercise the typed preload/IPC boundary, without any download source requests.
  const id = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: 'KJMC · 本地验收', version: '1.21.1', loader: 'vanilla' }),
  );
  await page.evaluate(async () => {
    const s = await window.kjmcl.snapshot();
    s.settings.proxy = 'http://127.0.0.1:7890';
    await window.kjmcl.settings(s.settings);
  });
  const rejected = await page.evaluate(async () => {
    try {
      await window.kjmcl.install('../escape');
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);
  await page.getByRole('button', { name: '游戏实例', exact: true }).click();
  await expect(page.getByRole('button', { name: 'KJMC · 本地验收', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'KJMC · 本地验收 设置' }).click();
  await page.getByLabel('名称', { exact: true }).fill('KJMC · 生存');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: 'KJMC · 生存', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.screenshot({ path: '.local/home-instance.png' });
  // Keep fixtures confined to the disposable userData directory.
  let dir = path.join(root, 'instances', id);
  await mkdir(path.join(dir, 'mods'), { recursive: true });
  await writeFile(path.join(dir, 'mods', 'sample mod.jar'), 'fixture');
  await page.getByRole('button', { name: '模组中心', exact: true }).click();
  await expect(page.getByText('sample mod', { exact: true })).toBeVisible();
  await page.getByRole('switch').click();
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('combobox', { name: '模组来源' }).selectOption('curseforge');
  await page.getByRole('button', { name: '发现模组', exact: true }).click();
  await expect(page.getByPlaceholder('在 CurseForge 搜索模组')).toBeVisible();
  await mkdir(path.join(dir, 'saves/Smoke World'), { recursive: true });
  await writeFile(path.join(dir, 'saves/Smoke World/level.dat'), 'world fixture');
  await page.getByRole('button', { name: '存档备份', exact: true }).click();
  await expect(page.getByText('Smoke World', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '备份', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await expect
    .poll(async () => page.evaluate(async (id) => (await window.kjmcl.worlds(id)).length, id))
    .toBe(2);
  await page.screenshot({ path: '.local/backups-v2.png' });
  await page.getByRole('button', { name: '游戏实例', exact: true }).click();
  await page.getByRole('button', { name: 'KJMC · 生存 设置' }).click();
  await page.getByRole('button', { name: '克隆实例', exact: true }).click();
  await page.getByLabel('副本名称').fill('Smoke Clone');
  await page.getByRole('button', { name: '创建副本', exact: true }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        async () =>
          (await window.kjmcl.snapshot()).tasks.filter((t) => t.status === 'running').length,
      ),
    )
    .toBe(0);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Smoke Clone', exact: true })).toBeVisible();
  const clone = await page.evaluate(async () =>
    (await window.kjmcl.snapshot()).instances.find((i) => i.name === 'Smoke Clone'),
  );
  expect(await readFile(path.join(clone.gameDir, 'mods/sample mod.jar.disabled'), 'utf8')).toBe(
    'fixture',
  );
  expect(await page.evaluate(async (id) => (await window.kjmcl.worlds(id)).length, clone.id)).toBe(
    0,
  );
  await page.evaluate((id) => window.kjmcl.select({ instanceId: id }), id);
  await page.evaluate(({ id, directory }) => window.kjmcl.relocateInstance({ id, directory }), {
    id,
    directory: path.join(customRoot, 'game'),
  });
  await expect
    .poll(async () =>
      page.evaluate(
        async () =>
          (await window.kjmcl.snapshot()).tasks.filter((t) => t.status === 'running').length,
      ),
    )
    .toBe(0);
  dir = await page.evaluate(
    async (id) => (await window.kjmcl.snapshot()).instances.find((i) => i.id === id).gameDir,
    id,
  );
  expect(dir.toLowerCase()).toContain('kjmcl-custom-');
  expect(await readFile(path.join(dir, 'saves/Smoke World/level.dat'), 'utf8')).toBe(
    'world fixture',
  );
  await page.getByRole('button', { name: '账户', exact: true }).click();
  await expect(page.getByRole('heading', { name: '第三方账户', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '管理皮肤', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'KJMC_Tester · 皮肤' })).toBeVisible();
  const skinPath = path.join(customRoot, 'skin.png');
  const png = await app.evaluate(({ dialog, nativeImage }, skinPath) => {
    globalThis.originalOpenDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [skinPath] });
    const pixels = Buffer.alloc(64 * 64 * 4);
    for (let n = 0; n < pixels.length; n += 4) {
      pixels[n] = 30;
      pixels[n + 1] = 110;
      pixels[n + 2] = 240;
      pixels[n + 3] = 255;
    }
    return nativeImage
      .createFromBitmap(pixels, { width: 64, height: 64 })
      .toPNG()
      .toString('base64');
  }, skinPath);
  await writeFile(skinPath, Buffer.from(png, 'base64'));
  await page.getByRole('button', { name: '选择皮肤', exact: true }).click();
  await expect(page.getByLabel('皮肤正面预览')).toBeVisible();
  await page.getByLabel('模型', { exact: true }).selectOption('slim');
  await page.screenshot({ path: '.local/skin-v2.png' });
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = globalThis.originalOpenDialog;
  });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const source = path.join(customRoot, 'old-minecraft');
  await mkdir(path.join(source, 'versions/1.21.1'), { recursive: true });
  await mkdir(path.join(source, 'config'), { recursive: true });
  await writeFile(
    path.join(source, 'versions/1.21.1/1.21.1.json'),
    JSON.stringify({
      id: '1.21.1',
      type: 'release',
      mainClass: 'Smoke',
      libraries: [],
      arguments: { game: [] },
    }),
  );
  await writeFile(path.join(source, 'versions/1.21.1/1.21.1.jar'), 'import client fixture');
  await writeFile(path.join(source, 'config/game.toml'), 'import=true');
  await app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
  }, source);
  await page.getByRole('button', { name: '游戏实例', exact: true }).click();
  await page.getByRole('button', { name: '导入目录', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '导入游戏目录' })).toBeVisible();
  await page.getByLabel('实例名称', { exact: true }).fill('Imported Game');
  await page.getByRole('button', { name: '复制导入', exact: true }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        async () =>
          (await window.kjmcl.snapshot()).instances.find((i) => i.name === 'Imported Game')?.status,
      ),
    )
    .toBe('ready');
  const imported = await page.evaluate(async () =>
    (await window.kjmcl.snapshot()).instances.find((i) => i.name === 'Imported Game'),
  );
  expect(await readFile(path.join(imported.gameDir, 'config/game.toml'), 'utf8')).toBe(
    'import=true',
  );
  expect(await readFile(path.join(source, 'versions/1.21.1/1.21.1.jar'), 'utf8')).toBe(
    'import client fixture',
  );
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = globalThis.originalOpenDialog;
  });
  await page.evaluate((id) => window.kjmcl.select({ instanceId: id }), id);
  await mkdir(path.join(dir, 'config'), { recursive: true });
  await writeFile(path.join(dir, 'config/client.toml'), 'enabled=true');
  const packFile = path.join(customRoot, 'smoke.mrpack');
  await app.evaluate(({ dialog }, packFile) => {
    globalThis.originalSaveDialog = dialog.showSaveDialog;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: packFile });
  }, packFile);
  await page.getByRole('button', { name: 'KJMC · 生存 设置' }).click();
  await page.getByRole('button', { name: '整合包发布', exact: true }).click();
  await page.getByRole('button', { name: '生成发布包', exact: true }).click();
  await expect(page.locator('.publish-review')).toBeVisible();
  const pack = new AdmZip(packFile);
  expect(pack.getEntry('modrinth.index.json')).toBeTruthy();
  expect(pack.getEntry('overrides/config/client.toml').getData().toString()).toBe('enabled=true');
  expect(pack.getEntries().some((e) => /saves|accounts|servers/.test(e.entryName))).toBe(false);
  await page.screenshot({ path: '.local/publishing-v2.png' });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = globalThis.originalSaveDialog;
  });
  await page.getByRole('button', { name: '游戏日志', exact: true }).click();
  await expect(page.locator('.console')).toBeVisible();
  const java = await page.evaluate(() => window.kjmcl.java());
  await app.close();
  app = undefined;
  const saved = JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8'));
  expect(saved.accounts[0].name).toBe('KJMC_Tester');
  expect(saved.instances[0].name).toBe('KJMC · 生存');
  expect(saved.settings.proxy).toBe('http://127.0.0.1:7890');
  // Real JVM subprocess with a tiny local fixture, not a downloaded Minecraft client.
  const runtime = java.find((j) => j.major >= 17);
  if (!runtime) throw new Error('Desktop smoke test requires a JDK >= 17 on PATH');
  if (runtime) {
    const bin = path.dirname(runtime.path),
      ext = process.platform === 'win32' ? '.exe' : '';
    await mkdir(path.join(dir, 'logs'), { recursive: true });
    await writeFile(
      path.join(dir, 'Smoke.java'),
      'public class Smoke { public static void main(String[] args) throws Exception { System.out.println("KJMCL_JVM_OK"); System.out.println("refresh_token=secret_fixture"); System.gc(); if(Boolean.getBoolean("kjmcl.smoke.hold")) Thread.sleep(30000); } }',
    );
    execFileSync(path.join(bin, 'javac' + ext), [path.join(dir, 'Smoke.java')]);
    execFileSync(path.join(bin, 'jar' + ext), [
      'cf',
      path.join(dir, 'client.jar'),
      '-C',
      dir,
      'Smoke.class',
    ]);
    await writeFile(
      path.join(dir, 'version.json'),
      JSON.stringify({
        id: 'fixture',
        type: 'release',
        mainClass: 'Smoke',
        libraries: [],
        javaVersion: { majorVersion: runtime.major },
        arguments: {
          jvm: ['-cp', '${classpath}'],
          game: ['--username', '${auth_player_name}', '--gameDir', '${game_directory}'],
        },
      }),
    );
    saved.instances[0].status = 'ready';
    saved.instances[0].javaPath = runtime.path;
    await writeFile(
      path.join(dir, 'options.txt'),
      'renderDistance:24\r\nsimulationDistance:12\r\nentityDistanceScaling:1.0\r\nmaxFps:260\r\nfov:0.5\r\n',
    );
    await writeFile(path.join(root, 'state.json'), JSON.stringify(saved));
    app = await electron.launch(launchOptions);
    const second = await firstVisibleWindow(app);
    await second.waitForSelector('h1');
    await second.getByRole('button', { name: '性能与诊断', exact: true }).click();
    await second.getByLabel('内存分配', { exact: true }).selectOption('auto');
    await second.getByLabel('堆内存上限', { exact: true }).fill('1024');
    await second.getByLabel('垃圾收集器', { exact: true }).selectOption('g1');
    await second.getByLabel('记录 GC 停顿', { exact: true }).check();
    await second.getByRole('button', { name: '保存', exact: true }).click();
    await expect(second.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    await second.getByRole('button', { name: '检查并试运行 JVM' }).click();
    await expect(second.getByText('JVM 试运行通过', { exact: false })).toBeVisible({
      timeout: 20000,
    });
    await second.getByRole('button', { name: /低负载/ }).click();
    await expect
      .poll(async () => readFile(path.join(dir, 'options.txt'), 'utf8'))
      .toContain('renderDistance:8');
    await second.getByRole('button', { name: '还原', exact: true }).click();
    await expect
      .poll(async () => readFile(path.join(dir, 'options.txt'), 'utf8'))
      .toContain('renderDistance:24');
    await second.locator('h1').scrollIntoViewIfNeeded();
    await second.screenshot({ path: '.local/performance-v3.png' });
    await second.getByRole('button', { name: '开始游戏', exact: true }).click();
    await second.getByRole('button', { name: '启动游戏', exact: true }).click();
    await expect
      .poll(
        async () =>
          second.evaluate(
            async (id) => (await window.kjmcl.logs(id)).map((l) => l.text).join('\n'),
            id,
          ),
        { timeout: 20000 },
      )
      .toContain('KJMCL_JVM_OK');
    const logs = await second.evaluate((id) => window.kjmcl.logs(id), id);
    expect(logs.map((l) => l.text).join('\n')).not.toContain('secret_fixture');
    await expect
      .poll(async () => second.evaluate(async () => (await window.kjmcl.snapshot()).running.length))
      .toBe(0);
    await expect
      .poll(async () =>
        second.evaluate(async (id) => (await window.kjmcl.sessions(id))[0]?.gc?.pauses, id),
      )
      .toBeGreaterThan(0);
    const diagnosis = await second.evaluate((id) => window.kjmcl.sessions(id), id);
    expect(diagnosis[0].status).toBe('exited');
    expect(diagnosis[0].memoryMb).toBeLessThanOrEqual(1024);
    expect(JSON.stringify(diagnosis)).not.toContain('secret_fixture');
    const gcFiles = await readdir(path.join(dir, 'logs'));
    expect(gcFiles.some((n) => n.startsWith('kjmcl-gc-') && n.endsWith('.log'))).toBe(true);
    await second.screenshot({ path: '.local/home-ready.png' });
    await second.evaluate(async (id) => {
      const s = await window.kjmcl.snapshot(),
        i = s.instances.find((i) => i.id === id);
      await window.kjmcl.updateInstance({ ...i, jvmArgs: ['-Dkjmcl.smoke.hold=true'] });
    }, id);
    const startButton = second.getByRole('button', { name: '启动游戏', exact: true });
    const location = await startButton.boundingBox();
    await startButton.click();
    await expect(second.getByRole('button', { name: '游戏运行中', exact: true })).toBeDisabled();
    // Keep the full interface for this legacy button regression. Automatic renderer release
    // and recovery are exercised separately by lightweight-desktop-smoke.mjs.
    await second.evaluate(() => window.kjmcl.setLightweight(false));
    await second.mouse.click(location.x + location.width / 2, location.y + location.height / 2);
    expect(await second.evaluate(async () => (await window.kjmcl.snapshot()).running.length)).toBe(
      1,
    );
    await second.getByRole('button', { name: '结束游戏', exact: true }).click();
    await expect
      .poll(async () => second.evaluate(async () => (await window.kjmcl.snapshot()).running.length))
      .toBe(0);
    const stopped = await second.evaluate((id) => window.kjmcl.logs(id), id);
    expect(stopped.some((l) => l.text.includes('收到结束游戏请求'))).toBe(true);
    expect(stopped.some((l) => l.text.includes('游戏已由启动器结束') && l.level === 'info')).toBe(
      true,
    );
    console.log(
      'PASS repeated start-position click leaves JVM running; explicit stop has a recorded reason',
    );
    console.log('PASS real JVM launch, argument expansion, process exit, redacted logs');
    await expect
      .poll(async () =>
        second.evaluate(async (id) => (await window.kjmcl.sessions(id))[0]?.status, id),
      )
      .toBe('stopped');
    await second.getByRole('button', { name: '性能与诊断', exact: true }).click();
    await second.locator('.session-record summary').first().click();
    await second.screenshot({ path: '.local/diagnostics-v3.png' });
    const diagnosisExport = path.join(root, 'exported-diagnosis.json');
    await app.evaluate(({ dialog }, filePath) => {
      globalThis.originalSaveDialog = dialog.showSaveDialog;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, diagnosisExport);
    await second.getByRole('button', { name: '导出诊断', exact: true }).first().click();
    await expect
      .poll(async () => readFile(diagnosisExport, 'utf8').catch(() => ''))
      .toContain('"status": "stopped"');
    expect(await readFile(diagnosisExport, 'utf8')).not.toContain('secret_fixture');
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = globalThis.originalSaveDialog;
    });
    await second.evaluate(async (id) => {
      const i = (await window.kjmcl.snapshot()).instances.find((i) => i.id === id);
      await window.kjmcl.updateInstance({ ...i, jvmArgs: ['-Xmx8G'] });
      await window.kjmcl.launch(id);
    }, id);
    await expect
      .poll(async () =>
        second.evaluate(async (id) => (await window.kjmcl.sessions(id))[0]?.status, id),
      )
      .toBe('failed');
    expect(
      await second.evaluate(
        async (id) => (await window.kjmcl.sessions(id))[0].tail.map((l) => l.text).join('\n'),
        id,
      ),
    ).toContain('堆内存上限');
    expect(await second.evaluate(async () => (await window.kjmcl.snapshot()).running)).toHaveLength(
      0,
    );
    await second.evaluate(async (id) => {
      const i = (await window.kjmcl.snapshot()).instances.find((i) => i.id === id);
      await window.kjmcl.updateInstance({ ...i, jvmArgs: [] });
    }, id);
    await app.close();
    app = await electron.launch(launchOptions);
    const third = await firstVisibleWindow(app);
    await third.waitForSelector('h1');
    const persisted = await third.evaluate((id) => window.kjmcl.sessions(id), id);
    expect(persisted[0].status).toBe('failed');
    expect(persisted[1].status).toBe('stopped');
    expect(persisted[2].gc.pauses).toBeGreaterThan(0);
    console.log(
      'PASS performance UI, real G1 JVM probe and GC log parsing, reversible options, durable session history',
    );
  }
  expect(errors).toEqual([]);
  console.log(
    'PASS existing directory import, local skin preview, standard pack generation (native dialog responses supplied by test)',
  );
  console.log(
    'PASS custom directory relocation, clone isolation, backup/restore, provider switch, account and skin UI',
  );
  console.log(
    'PASS desktop navigation, offline account, Java scan, instance settings, mod toggle, IPC validation, persistence',
  );
} finally {
  if (app) await app.close();
  if (path.basename(root).startsWith('kjmcl-desktop-'))
    await rm(root, { recursive: true, force: true });
  if (path.basename(customRoot).startsWith('kjmcl-custom-'))
    await rm(customRoot, { recursive: true, force: true });
}
