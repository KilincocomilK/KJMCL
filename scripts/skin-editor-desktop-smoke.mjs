// Real Electron/preload/main-process acceptance. Only native file pickers return fixture paths.
// Build separately first. KJMCL_TEST_EXECUTABLE can point at an unpacked desktop application.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, realpath, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { firstVisibleWindow, selectLauncherOption } from './desktop-test-utils.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-skin-desktop-'));
const data = path.join(root, 'data'),
  shots = path.join(root, 'screenshots');
await mkdir(shots);
const env = { ...process.env, KJMCL_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
const executablePath = process.env.KJMCL_TEST_EXECUTABLE || process.env.KJMCL_EXECUTABLE;
const expectedVersion =
  process.env.KJMCL_TEST_VERSION || JSON.parse(await readFile('package.json', 'utf8')).version;
const options = executablePath ? { executablePath, args: [], env } : { args: ['.'], env };
const errors = [],
  checks = [];
let app, page;
const files = {
  reference: path.join(root, 'desktop-reference.png'),
  png: path.join(root, 'skin-export.png'),
  project: path.join(root, 'skin-export.kjskin'),
  capture: path.join(root, 'skin-preview.png'),
  gif: path.join(root, 'skin-preview.gif'),
};
const referencePng = new PNG({ width: 2, height: 2 });
referencePng.data = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
await writeFile(files.reference, PNG.sync.write(referencePng));
const draftFile = path.join(data, 'skin-editor', 'draft.json');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const draft = () => json(draftFile).catch(() => null);
const state = () => page.evaluate(() => window.kjmcl.snapshot());
const library = () => page.evaluate(() => window.kjmcl.skinEditorList());
async function launch() {
  app = await electron.launch(options);
  page = await firstVisibleWindow(app);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(() => {
    window.__skinDesktopErrors = [];
    window.addEventListener('error', (event) => window.__skinDesktopErrors.push(event.message));
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1500, 980),
  );
  await expect(page.getByRole('button', { name: '工具箱', exact: true })).toBeVisible();
  const snapshot = await state();
  expect(snapshot.appVersion).toBe(expectedVersion);
  expect(await realpath(snapshot.dataPath)).toBe(await realpath(data));
  expect(snapshot.accounts).toEqual([]);
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  await page.getByRole('button', { name: '工具箱', exact: true }).click();
  await page.locator('.toolbox-card').filter({ hasText: '皮肤编辑器' }).click();
}
async function close() {
  if (!app) return;
  expect(await page.evaluate(() => window.__skinDesktopErrors)).toEqual([]);
  await app.close();
  app = undefined;
}
async function picker(kind, file) {
  const relative = path.relative(root, path.resolve(file));
  if (path.isAbsolute(relative) || relative.startsWith('..'))
    throw new Error('Picker escaped fixture root');
  await app.evaluate(
    ({ dialog }, { kind, file }) => {
      if (kind === 'open')
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      else dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    },
    { kind, file },
  );
}
async function fileMenu(action) {
  const menu = page.locator('.skin-menu');
  if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
  await menu.getByRole('button', { name: action, exact: true }).click();
}
async function closeMenu() {
  const menu = page.locator('.skin-menu');
  if ((await menu.getAttribute('open')) !== null) await menu.locator('summary').click();
}
async function save() {
  await closeMenu();
  await page.getByRole('button', { name: '保存作品', exact: true }).click();
  await expect(page.locator('.skin-save-state')).toHaveText('作品已保存');
}
async function waitFile(file) {
  await expect
    .poll(
      () =>
        access(file).then(
          () => true,
          () => false,
        ),
      { timeout: 20000 },
    )
    .toBe(true);
}
async function paint(x, y) {
  const canvas = page.getByLabel('三维皮肤编辑画布', { exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const rect = await canvas.boundingBox();
  await canvas.click({
    position: {
      x: rect.width / 2 + (x * rect.height) / 40,
      y: rect.height / 2 - ((y - 16) * rect.height) / 40,
    },
  });
}
async function openSaved() {
  await page.getByRole('button', { name: '作品库', exact: true }).click();
  const libraryDialog = page.getByRole('dialog', { name: '作品库', exact: true });
  await libraryDialog.getByRole('button', { name: '编辑', exact: true }).click();
  // File reads are asynchronous; wait for their result before inspecting the unsaved-work guard.
  await expect(libraryDialog).toHaveCount(0);
  const guard = page.getByRole('dialog', { name: '保存当前作品？', exact: true });
  if (await guard.count()) await guard.getByRole('button', { name: '不保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
function gifFrames(bytes) {
  expect(bytes.toString('ascii', 0, 6)).toBe('GIF89a');
  const width = bytes.readUInt16LE(6),
    height = bytes.readUInt16LE(8);
  let at = 13 + (bytes[10] & 128 ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0),
    delay = 0;
  const frames = [];
  const blocks = () => {
    const pieces = [];
    while (bytes[at]) {
      const size = bytes[at++];
      pieces.push(bytes.subarray(at, at + size));
      at += size;
    }
    at++;
    return Buffer.concat(pieces);
  };
  while (at < bytes.length && bytes[at] !== 0x3b) {
    const type = bytes[at++];
    if (type === 0x21) {
      const label = bytes[at++];
      if (label === 0xf9) {
        expect(bytes[at++]).toBe(4);
        at++;
        delay = bytes.readUInt16LE(at) * 10;
        at += 4;
      } else blocks();
    } else {
      expect(type).toBe(0x2c);
      const w = bytes.readUInt16LE(at + 4),
        h = bytes.readUInt16LE(at + 6),
        flags = bytes[at + 8];
      at += 9;
      if (flags & 128) at += 3 * (1 << ((flags & 7) + 1));
      at++;
      frames.push({
        width: w,
        height: h,
        delay,
        hash: createHash('sha256').update(blocks()).digest('hex'),
      });
    }
  }
  expect(bytes[at]).toBe(0x3b);
  return { width, height, frames };
}

try {
  await launch();
  await expect(page.getByLabel('作品名称')).toHaveValue('未命名皮肤');
  expect(await page.evaluate(() => window.kjmcl.skinEditorLoadDraft())).toBeNull();
  await fileMenu('新建皮肤');
  const create = page.getByRole('dialog', { name: '新建皮肤', exact: true });
  await create.getByLabel('名称', { exact: true }).fill('桌面皮肤');
  await create.getByRole('button', { name: '创建空白皮肤', exact: true }).click();
  await closeMenu();
  await expect.poll(async () => (await draft())?.name).toBe('桌面皮肤');
  await selectLauncherOption(page, '观察方向', 'front');
  await page.getByLabel('显示外层', { exact: true }).uncheck();
  await page.getByLabel('游戏效果', { exact: true }).check();
  await paint(0.5, 16.5);
  await expect
    .poll(async () => {
      const saved = await draft();
      return (
        saved &&
        Buffer.from(saved.layers[0].pixels, 'base64').some((value, i) => i % 4 === 3 && value > 0)
      );
    })
    .toBe(true);
  checks.push('real 3D drawing through preload into a new on-disk draft');

  const colors = page.locator('.skin-color-panel');
  await colors.getByText('我的色板', { exact: true }).click();
  await colors.getByLabel('色板名称', { exact: true }).fill('桌面色板');
  await colors.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(async () => (await draft())?.workspace.palettes[0]?.name).toBe('桌面色板');
  await page
    .locator('.skin-inspector > details > summary')
    .filter({ hasText: /^参考图$/ })
    .click();
  await picker('open', files.reference);
  await page.getByRole('button', { name: '导入参考图', exact: true }).click();
  await expect.poll(async () => (await draft())?.workspace.references.length).toBe(1);
  const reference = (await draft()).workspace.references[0];
  expect([reference.width, reference.height]).toEqual([2, 2]);
  expect(Buffer.from(reference.pixels, 'base64')).toEqual(referencePng.data);
  await page
    .locator('.skin-inspector > details > summary')
    .filter({ hasText: /^印章素材$/ })
    .click();
  await page
    .locator('.skin-stamp-panel')
    .getByRole('button', { name: '导入 PNG', exact: true })
    .click();
  await expect(page.getByLabel('印章名称', { exact: true })).toHaveValue('desktop-reference');
  await page.getByLabel('印章名称', { exact: true }).fill('桌面印章');
  await page.getByRole('button', { name: '保存印章', exact: true }).click();
  await expect.poll(async () => (await draft())?.workspace.brushes[0]?.name).toBe('桌面印章');
  await page
    .locator('.skin-inspector > details > summary')
    .filter({ hasText: /^姿势与背景$/ })
    .click();
  await page.getByLabel('头部 Y 角度数值', { exact: true }).fill('25');
  await page.getByLabel('姿势名称', { exact: true }).fill('桌面姿势');
  await page.getByRole('button', { name: '保存姿势', exact: true }).click();
  await page.getByRole('button', { name: '重置姿势', exact: true }).click();
  await expect.poll(async () => (await draft())?.workspace.poses[0]?.angles.head?.y).toBe(25);
  await save();
  const entries = await library();
  expect(entries).toHaveLength(1);
  const id = entries[0].id,
    first = await page.evaluate((id) => window.kjmcl.skinEditorOpen(id), id);
  expect(first).toEqual(await draft());
  expect(await json(path.join(data, 'skin-editor', id + '.kjskin'))).toEqual(first);
  checks.push('workspace palettes/references/stamps/poses saved through real storage');

  await page.getByLabel('作品名称').fill('桌面皮肤 v2');
  await page.locator('.skin-tools button').filter({ hasText: /^画笔/ }).click();
  await page.locator('.skin-toolbox').getByLabel('HEX 颜色', { exact: true }).fill('#23ce70');
  await paint(2.5, 20.5);
  await expect.poll(async () => (await draft())?.name).toBe('桌面皮肤 v2');
  await save();
  const second = await page.evaluate((id) => window.kjmcl.skinEditorOpen(id), id);
  expect(second.layers[0].pixels).not.toBe(first.layers[0].pixels);
  const versions = await page.evaluate((id) => window.kjmcl.skinEditorVersions(id), id);
  expect(versions).toHaveLength(1);
  expect(
    await page.evaluate((value) => window.kjmcl.skinEditorRestoreVersion(value), {
      id,
      versionId: versions[0].versionId,
    }),
  ).toEqual(first);
  expect(await json(path.join(data, 'skin-editor', id + '.kjskin.bak'))).toEqual(first);
  expect(await page.evaluate(() => window.kjmcl.skinEditorRecoverDraft())).toEqual(
    await json(draftFile + '.bak'),
  );
  checks.push('version snapshots and draft/project backups are real files');

  await picker('save', files.png);
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
  await waitFile(files.png);
  const png = PNG.sync.read(await readFile(files.png));
  expect([png.width, png.height]).toEqual([64, 64]);
  expect(png.data).toEqual(Buffer.from(second.layers[0].pixels, 'base64'));
  expect(
    await app.evaluate(
      ({ nativeImage }, file) => ({
        size: nativeImage.createFromPath(file).getSize(),
        empty: nativeImage.createFromPath(file).isEmpty(),
      }),
      files.png,
    ),
  ).toEqual({ size: { width: 64, height: 64 }, empty: false });
  await picker('open', files.png);
  await fileMenu('导入为图层');
  const importing = page.getByRole('dialog', { name: '导入为图层', exact: true });
  await expect(importing.getByLabel('三维皮肤编辑画布', { exact: true })).toBeVisible();
  await importing.getByRole('button', { name: '导入', exact: true }).click();
  await closeMenu();
  await expect.poll(async () => (await draft())?.layers.length).toBe(2);
  expect(Buffer.from((await draft()).layers[1].pixels, 'base64')).toEqual(png.data);
  await save();
  const finalProject = await page.evaluate((id) => window.kjmcl.skinEditorOpen(id), id);
  await picker('save', files.project);
  expect(
    await page.evaluate(
      (project) => window.kjmcl.skinEditorExport({ project, format: 'project' }),
      finalProject,
    ),
  ).toBe(files.project);
  expect(await json(files.project)).toEqual(finalProject);
  checks.push('PNG export/import and .kjskin export use real codecs and native file paths');

  await openSaved();
  await expect(page.getByLabel('作品名称')).toHaveValue(finalProject.name);
  await expect.poll(draft).toEqual(finalProject);
  await close();
  await launch();
  await expect(page.getByLabel('作品名称')).toHaveValue(finalProject.name);
  expect(await page.evaluate(() => window.kjmcl.skinEditorLoadDraft())).toEqual(finalProject);
  expect(await page.evaluate((id) => window.kjmcl.skinEditorOpen(id), id)).toEqual(finalProject);
  await expect(page.locator('.skin-layer')).toHaveCount(2);
  await openSaved();
  await expect.poll(draft).toEqual(finalProject);
  checks.push('works reopened from the library and restored after an actual Electron restart');

  await page.getByRole('button', { name: '作品库', exact: true }).click();
  const libraryDialog = page.getByRole('dialog', { name: '作品库', exact: true });
  await libraryDialog.getByRole('button', { name: '版本', exact: true }).click();
  await expect(
    libraryDialog.getByRole('button', { name: '恢复为新工程', exact: true }),
  ).toHaveCount(2);
  await libraryDialog.getByRole('button', { name: '恢复为新工程', exact: true }).first().click();
  await expect.poll(draft).toEqual(second);
  expect(await page.evaluate((id) => window.kjmcl.skinEditorOpen(id), id)).toEqual(finalProject);
  await openSaved();
  await expect.poll(draft).toEqual(finalProject);
  checks.push('version restored through UI without overwriting the saved work');

  await page.getByLabel('显示外层', { exact: true }).uncheck();
  await page.getByLabel('游戏效果', { exact: true }).check();
  await picker('save', files.capture);
  await page.getByRole('button', { name: '截图', exact: true }).click();
  await waitFile(files.capture);
  const capture = PNG.sync.read(await readFile(files.capture));
  expect(capture.width).toBeGreaterThan(50);
  expect(capture.height).toBeGreaterThan(50);
  await page.getByLabel('转台', { exact: true }).check();
  await picker('save', files.gif);
  await page.getByRole('button', { name: '导出动画', exact: true }).click();
  await page.getByLabel('动画帧数', { exact: true }).fill('3');
  await page.getByLabel('动画时长', { exact: true }).fill('1.2');
  await page.getByRole('button', { name: '导出 GIF', exact: true }).click();
  await expect
    .poll(async () => (await state()).tasks.find((task) => task.title === '导出皮肤动画')?.status, {
      timeout: 30000,
    })
    .toBe('completed');
  await waitFile(files.gif);
  const gif = gifFrames(await readFile(files.gif));
  expect([gif.width, gif.height]).toEqual([256, 256]);
  expect(gif.frames).toHaveLength(3);
  expect(gif.frames.map((frame) => [frame.width, frame.height, frame.delay])).toEqual([
    [256, 256, 400],
    [256, 256, 400],
    [256, 256, 400],
  ]);
  expect(new Set(gif.frames.map((frame) => frame.hash)).size).toBeGreaterThan(1);
  await page.getByLabel('转台', { exact: true }).uncheck();
  await page.getByRole('button', { name: '重置视角', exact: true }).click();
  checks.push(
    'real screenshot PNG and animated GIF task/file, dimensions/frame count/timing verified',
  );
  await page.screenshot({ path: path.join(shots, 'skin-desktop-wide.png'), fullPage: true });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(960, 650),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({ path: path.join(shots, 'skin-desktop-960.png'), fullPage: true });

  await close();
  const recovery = await json(draftFile + '.bak');
  await writeFile(draftFile, '{truncated fixture');
  await launch();
  await expect(page.getByText('草稿读取失败', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复备份', exact: true }).click();
  await expect.poll(draft).toEqual(recovery);
  expect(await json(draftFile + '.bak')).toEqual(recovery);
  const retained = (await readdir(path.dirname(draftFile))).filter((file) =>
    /^draft\.corrupt-.*\.json$/.test(file),
  );
  expect(retained).toHaveLength(1);
  expect(await readFile(path.join(path.dirname(draftFile), retained[0]), 'utf8')).toBe(
    '{truncated fixture',
  );
  checks.push('damaged temporary draft recovered from backup and retained for inspection');
  await close();
  expect(errors).toEqual([]);
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        executable: executablePath ?? 'local Electron + dist-electron/main.cjs',
        checks,
        artifacts: files,
        screenshots: shots,
        accountUpload: 'not exercised',
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      artifacts: root,
      checks,
      screenshots: [
        path.join(shots, 'skin-desktop-wide.png'),
        path.join(shots, 'skin-desktop-960.png'),
      ],
    }),
  );
} catch (error) {
  await page?.screenshot({ path: path.join(shots, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify({ error: String(error), errors, checks }, null, 2),
  );
  console.error('Skin desktop smoke failed; isolated artifacts:', root);
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  // Keep only this disposable temporary directory as reviewable evidence; never touch production profiles.
}
