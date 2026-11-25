import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { answerSystemDialog, closeFixtureApp, firstVisibleWindow } from './desktop-test-utils.mjs';
import { levelFixture } from './save-fixtures.mjs';
const temp = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-folders-desktop-'));
// Stock Windows JDK 21 converts CLI arguments through the system code page.
// English Windows CI cannot pass Chinese paths; retain Unicode coverage locally
// and on macOS/Linux, and use ASCII physical paths on that CI runner only.
const asciiPaths = process.platform === 'win32' && !!process.env.CI;
const base = await realpath(temp),
  data = path.join(base, 'launcher'),
  source = path.join(base, asciiPaths ? 'External Game' : 'External 游戏');
const sharedVersion = asciiPaths ? 'shared-version' : '共享版本',
  isolatedVersion = asciiPaths ? 'isolated-version' : '隔离版本';
const sharedDir = source,
  isolatedDir = path.join(source, 'versions', isolatedVersion);
const env = { ...process.env, KJMCL_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
let app;
async function tree(root) {
  const files = {};
  async function visit(relative) {
    for (const e of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = path.join(relative, e.name);
      if (e.isDirectory()) {
        files[name + '/'] = 'directory';
        await visit(name);
      } else
        files[name] = createHash('sha256')
          .update(await readFile(path.join(root, name)))
          .digest('hex');
    }
  }
  await visit('');
  return files;
}
try {
  await mkdir(path.join(source, 'versions', sharedVersion), { recursive: true });
  await mkdir(path.join(isolatedDir, 'saves', 'Isolated World'), { recursive: true });
  await mkdir(path.join(source, 'saves', 'Shared World'), { recursive: true });
  await mkdir(path.join(source, 'libraries', 'fixture'), { recursive: true });
  await mkdir(path.join(source, 'assets'), { recursive: true });
  await writeFile(path.join(source, 'saves', 'Shared World', 'level.dat'), levelFixture());
  await writeFile(path.join(isolatedDir, 'saves', 'Isolated World', 'level.dat'), levelFixture());
  const javaFile = path.join(base, 'FolderFixture.java');
  await writeFile(
    javaFile,
    `import java.nio.file.*;
public class FolderFixture {
 public static void main(String[] args) throws Exception {
  String evidence=Path.of("").toRealPath()+"\\n"+System.getProperty("java.class.path")+"\\n"+String.join("\\n",args);
  Files.writeString(Path.of("launch-evidence.txt"),evidence);
  System.out.println("FOLDER_FIXTURE_READY");
  for(int n=0;n<600 && !Files.exists(Path.of("finish.fixture"));n++) Thread.sleep(50);
 }
}`,
  );
  execFileSync('javac', ['--release', '17', javaFile], { windowsHide: true });
  const client = path.join(source, 'versions', sharedVersion, sharedVersion + '.jar');
  // Package the compiled class directly, independently of the JDK jar CLI's path encoding.
  const fixtureJar = new AdmZip();
  fixtureJar.addFile('FolderFixture.class', await readFile(path.join(base, 'FolderFixture.class')));
  const jarBytes = fixtureJar.toBuffer();
  await writeFile(client, jarBytes);
  const library = path.join(source, 'libraries', 'fixture', 'support.jar');
  await writeFile(library, jarBytes);
  await writeFile(
    path.join(source, 'versions', sharedVersion, sharedVersion + '.json'),
    JSON.stringify({
      id: '1.21.1',
      type: 'release',
      mainClass: 'FolderFixture',
      javaVersion: { majorVersion: 17 },
      libraries: [
        {
          name: 'fixture:support:1',
          downloads: {
            artifact: { path: 'fixture/support.jar', url: 'https://fixture.invalid/support.jar' },
          },
        },
      ],
      arguments: { game: ['--gameDir', '${game_directory}', '--assetsDir', '${assets_root}'] },
    }),
  );
  await writeFile(
    path.join(isolatedDir, isolatedVersion + '.json'),
    JSON.stringify({ id: isolatedVersion, inheritsFrom: sharedVersion, libraries: [] }),
  );
  const before = await tree(source);
  const options = process.env.KJMCL_EXECUTABLE
    ? { executablePath: process.env.KJMCL_EXECUTABLE, args: [], env }
    : { args: ['.'], env };
  app = await electron.launch(options);
  let page = await firstVisibleWindow(app);
  const workspaceNav = page.getByRole('navigation', { name: '工作空间' });
  const entries = workspaceNav.getByRole('button');
  await expect(entries).toHaveCount(9);
  expect(await entries.evaluateAll((buttons) => buttons.map((button) => button.ariaLabel))).toEqual(
    [
      '开始游戏',
      '游戏实例',
      '资源管理',
      '工具箱',
      'AI 助手',
      '存档管理',
      '陶瓦联机',
      '诊断与维护',
      '下载任务',
    ],
  );
  await expect(workspaceNav.getByRole('button', { name: '账户管理' })).toHaveCount(0);
  await page.getByRole('button', { name: '账户管理', exact: true }).click();
  await page.getByPlaceholder('Player', { exact: true }).fill('FolderTester');
  await page.getByRole('button', { name: '添加账户', exact: true }).click();
  const runtime = (await page.evaluate(() => window.kjmcl.java())).find((j) => j.major >= 17);
  if (!runtime) throw new Error('JDK 17+ required');
  await app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
  }, source);
  await page.getByRole('button', { name: '游戏实例', exact: true }).click();
  await page.evaluate(() => {
    window.folderScanStates = [];
    window.kjmcl.onEvent((e) => {
      if (e.type === 'folder-scan') window.folderScanStates.push(e.active);
    });
    new MutationObserver(() => {
      const message = document.querySelector('.activity-stack .scan-notice');
      if (message) window.sawFolderScanNotice = message.textContent;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole('button', { name: '添加游戏文件夹', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加游戏文件夹' });
  await expect(dialog).toContainText(sharedDir);
  expect(await page.evaluate(() => window.folderScanStates)).toEqual([true, false]);
  expect(await page.evaluate(() => window.sawFolderScanNotice)).toBe('正在读取游戏文件夹…');
  await expect(page.getByText('正在读取游戏文件夹…')).toHaveCount(0);
  await expect(dialog).toContainText(isolatedDir);
  await expect(dialog.getByRole('button', { name: '复制导入' })).toHaveCount(0);
  await page.getByLabel('文件夹名称', { exact: true }).fill('原地游戏');
  await page.getByRole('button', { name: '添加文件夹', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const notification = page.getByRole('button', { name: '查看任务 · 导入 原地游戏', exact: true });
  await notification.click();
  await expect(page.getByRole('heading', { name: '下载任务', exact: true })).toBeVisible();
  const importedTask = page.getByRole('region', { name: '导入 原地游戏', exact: true });
  await expect(importedTask).toBeFocused();
  await expect(importedTask).toContainText('已完成');
  await page.getByRole('button', { name: '游戏实例', exact: true }).click();
  await expect(notification).toHaveCount(0);
  const snapshot = await page.evaluate(() => window.kjmcl.snapshot()),
    folder = snapshot.gameFolders[0];
  expect(snapshot.instances).toHaveLength(2);
  expect(await tree(source)).toEqual(before);
  expect(await readdir(data)).not.toContain('instances');
  await expect(page.getByRole('heading', { name: '原地游戏', exact: true })).toBeVisible();
  for (const instance of snapshot.instances) {
    await page.evaluate(
      async ({ id, javaPath }) => {
        const i = (await window.kjmcl.snapshot()).instances.find((i) => i.id === id);
        await window.kjmcl.updateInstance({ ...i, javaPath });
      },
      { id: instance.id, javaPath: runtime.path },
    );
    const worlds = await page.evaluate((id) => window.kjmcl.worlds(id), instance.id);
    expect(worlds.map((w) => w.name)).toEqual([
      instance.external.versionId === sharedVersion ? 'Shared World' : 'Isolated World',
    ]);
  }
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/game-folders-v070.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const main = document.querySelector('main');
        return main.scrollWidth <= main.clientWidth;
      }),
    )
    .toBe(true);
  await page.mouse.move(2, 2);
  await page.screenshot({ path: '.local/game-folders-compact-v070.png' });
  const first = snapshot.instances.find((i) => i.external.versionId === sharedVersion),
    second = snapshot.instances.find((i) => i.external.versionId === isolatedVersion);
  for (const instance of [first, second]) {
    await page.evaluate((id) => window.kjmcl.select({ instanceId: id }), instance.id);
    await page.evaluate((id) => window.kjmcl.launch(id), instance.id);
    const evidenceFile = path.join(instance.gameDir, 'launch-evidence.txt');
    await expect
      .poll(() => readFile(evidenceFile, 'utf8').catch(() => ''), { timeout: 20000 })
      .toContain(instance.gameDir);
    const evidence = await readFile(evidenceFile, 'utf8');
    expect(evidence).toContain(client);
    expect(evidence).toContain(library);
    expect(evidence).toContain(path.join(source, 'assets'));
    expect(evidence.split('\n')[0]).toBe(instance.gameDir);
    // Check the folder-wide write/launch lock before automatic lightweight mode replaces the page.
    const rejected = await page.evaluate(async (id) => {
      try {
        await window.kjmcl.refreshGameFolder(id);
        return false;
      } catch {
        return true;
      }
    }, folder.id);
    expect(rejected).toBe(true);
    await writeFile(path.join(instance.gameDir, 'finish.fixture'), '');
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(1);
    await expect
      .poll(
        async () => {
          const full = app.windows().find((p) => !p.isClosed() && p.url().includes('index.html'));
          if (!full) return false;
          page = full;
          return (await page.evaluate(() => window.kjmcl.snapshot())).running.length === 0;
        },
        { timeout: 20000 },
      )
      .toBe(true);
  }
  // Persistence and refresh keep IDs and source paths; no source tree is mirrored under data/instances.
  await app.close();
  app = await electron.launch(options);
  page = await firstVisibleWindow(app);
  expect((await page.evaluate(() => window.kjmcl.snapshot())).instances.map((i) => i.id)).toEqual(
    snapshot.instances.map((i) => i.id),
  );
  await page.evaluate((id) => window.kjmcl.refreshGameFolder(id), folder.id);
  for (const [workspace, tabs] of [
    ['存档管理', ['世界编辑', '存档备份']],
    ['诊断与维护', ['性能诊断', '游戏日志', '崩溃报告', '磁盘管理']],
  ]) {
    await page.getByRole('button', { name: workspace, exact: true }).click();
    for (const tab of tabs) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByRole('button', { name: workspace, exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
    }
  }
  await page.getByRole('button', { name: '资源管理', exact: true }).click();
  await page.screenshot({ path: '.local/workspace-resources-v070.png' });
  const afterLaunch = await tree(source);
  await answerSystemDialog(app,
    () => page.evaluate((id) => window.kjmcl.removeGameFolder(id), folder.id),
    (dialog) => dialog.getByRole('button', { name: '移除索引', exact: true }).click(),
  );
  expect((await page.evaluate(() => window.kjmcl.snapshot())).instances).toHaveLength(0);
  expect(await tree(source)).toEqual(afterLaunch);
  // Hold the native trash call to verify the main-process lock, without using the OS recycle bin.
  const disposableId = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: '删除锁测试', version: '1.21.1', loader: 'vanilla' }),
  );
  await app.evaluate(({ shell }) => {
    globalThis.savedTrash = shell.trashItem;
    shell.trashItem = async () => {
      globalThis.trashReached = true;
      await new Promise((resolve) => {
        globalThis.finishTrash = resolve;
      });
    };
  });
  await answerSystemDialog(app, () => page.evaluate((id) => {
    globalThis.deleteFixture = window.kjmcl.deleteInstance(id);
  }, disposableId), (dialog) => dialog.getByRole('button', { name: '移入回收站', exact: true }).click());
  await expect.poll(() => app.evaluate(() => !!globalThis.trashReached)).toBe(true);
  for (const action of ['launch', 'install', 'deleteInstance']) {
    const message = await page.evaluate(
      async ({ id, action }) => {
        try {
          await window.kjmcl[action](id);
          return '';
        } catch (e) {
          return String(e);
        }
      },
      { id: disposableId, action },
    );
    expect(message).toContain('等待任务');
  }
  await app.evaluate(({ shell }) => {
    globalThis.finishTrash();
    shell.trashItem = globalThis.savedTrash;
  });
  await page.evaluate(() => globalThis.deleteFixture);
  expect((await page.evaluate(() => window.kjmcl.snapshot())).instances).toHaveLength(0);
  console.log(
    'PASS folder indexing without copies, shared/isolated worlds, original client/libraries/assets and JVM cwd, folder/deletion locks, persistence, detach preservation, workspace navigation and all workspace tabs (disposable fixtures; native trash mocked)',
  );
} finally {
  for (const dir of [sharedDir, isolatedDir])
    await writeFile(path.join(dir, 'finish.fixture'), '').catch(() => {});
  if (app) await closeFixtureApp(app);
  if (path.basename(base).startsWith('kjmcl-folders-desktop-'))
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
