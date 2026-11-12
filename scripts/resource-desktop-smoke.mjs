import {
  firstVisibleWindow,
  navigateWorkspace,
  selectLauncherOption,
} from './desktop-test-utils.mjs';
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-resource-desktop-'));
const env = { ...process.env, KJMCL_DATA_DIR: path.join(root, 'data'), TEMP: root, TMP: root };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
let app;
try {
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
    window.kjmcl.createInstance({ name: '资源测试实例', version: '1.21.1', loader: 'fabric' }),
  );
  const second = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: '另一实例', version: '1.20.1', loader: 'forge' }),
  );
  const zip = new AdmZip();
  zip.addFile(
    'fabric.mod.json',
    Buffer.from(
      JSON.stringify({
        id: 'smoke',
        name: 'Smoke',
        version: '1',
        depends: { minecraft: '1.21.1' },
      }),
    ),
  );
  const source = path.join(root, 'drop.jar');
  await writeFile(source, zip.toBuffer());
  // CDP-backed input files keep native paths: this exercises webUtils, not a forged path in the renderer.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.id = 'native-drop-source';
    input.style.display = 'none';
    document.body.append(input);
  });
  await page.locator('#native-drop-source').setInputFiles(source);
  const drop = () =>
    page.evaluate(() => {
      const input = document.querySelector('#native-drop-source');
      const dt = new DataTransfer();
      for (const file of input.files) dt.items.add(file);
      window.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }),
      );
    });
  for (const pageName of ['开始游戏', '账户', '陶瓦联机', '资源管理']) {
    await navigateWorkspace(page, pageName);
    await drop();
    await expect(page.getByRole('dialog', { name: '添加资源', exact: true })).toBeVisible();
    await expect(
      page
        .locator('.launcher-select')
        .filter({ has: page.getByRole('combobox', { name: 'drop.jar 实例', exact: true }) })
        .locator('select'),
    ).toHaveValue(id);
    if (pageName === '资源管理') {
      await page.getByRole('button', { name: '确认添加', exact: true }).click();
      await expect(
        page.getByText('已添加 · drop.jar · 资源测试实例', { exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: '完成', exact: true }).click();
    } else await page.getByRole('button', { name: '取消', exact: true }).click();
  }
  const imported = await readFile(path.join(root, 'data', 'instances', id, 'mods', 'drop.jar'));
  expect(imported).toEqual(await readFile(source));
  await selectLauncherOption(page, '选择实例', id);
  await page.getByRole('tab', { name: /^模组\s*1$/ }).click();
  await expect(
    page.locator('.resource-mod-row').getByText('drop.jar', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('更多操作 drop.jar', { exact: true }).click();
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'drop.jar' }).getByText('smoke', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByLabel('更多操作 drop.jar', { exact: true }).click();
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByLabel('文件名').fill('renamed.jar');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    page.locator('.resource-mod-row').getByText('renamed.jar', { exact: true }),
  ).toBeVisible();
  await selectLauncherOption(page, '选择实例', second);
  await expect(page.locator('.resource-mod-row')).toHaveCount(0);
  await selectLauncherOption(page, '选择实例', id);
  await page.getByRole('tab', { name: /^模组\s*1$/ }).click();
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/resources-v040.png' });
  const makeZip = async (name, entries) => {
    const archive = new AdmZip();
    for (const [key, value] of Object.entries(entries)) archive.addFile(key, Buffer.from(value));
    const file = path.join(root, name);
    await writeFile(file, archive.toBuffer());
    return file;
  };
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZl8AAAAASUVORK5CYII=',
    'base64',
  );
  const pack = await makeZip('textures.zip', {
    'pack.mcmeta': JSON.stringify({ pack: { pack_format: 34, description: '资源包桌面预览' } }),
    'pack.png': png,
  });
  const replay = await makeZip('recording.mcpr', {
    'metaData.json': JSON.stringify({
      mcversion: '1.21.1',
      duration: 12345,
      serverName: '测试世界',
    }),
    'recording.tmcpr': 'fixture',
    thumb: png,
  });
  const shader = await makeZip('shader.zip', { 'shaders/a.fsh': 'fixture' });
  const short = (n) => {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n);
    return b;
  };
  const text = (s) => Buffer.concat([short(Buffer.byteLength(s)), Buffer.from(s)]);
  const tags = ['Width', 'Height', 'Length'].map((n) =>
    Buffer.concat([Buffer.from([2]), text(n), short(n === 'Width' ? 2 : 1)]),
  );
  const length = Buffer.alloc(4);
  length.writeInt32BE(2);
  const schematic = path.join(root, 'build.schematic');
  await writeFile(
    schematic,
    Buffer.concat([
      Buffer.from([10]),
      text('Schematic'),
      ...tags,
      Buffer.from([7]),
      text('Blocks'),
      length,
      Buffer.from([0, 1, 0]),
    ]),
  );
  await page.locator('#native-drop-source').setInputFiles([pack, replay, shader, schematic]);
  await drop();
  await expect(page.getByRole('dialog', { name: '添加资源', exact: true })).toBeVisible();
  await selectLauncherOption(page, '统一目标实例', id);
  await page.getByRole('button', { name: '确认添加', exact: true }).click();
  await expect(
    page.getByText('已添加 · build.schematic · 资源测试实例', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  for (const [tab, file] of [
    ['资源包', 'textures.zip'],
    ['Replay 录像', 'recording.mcpr'],
    ['投影原理图', 'build.schematic'],
  ]) {
    await page.getByRole('tab', { name: new RegExp('^' + tab + '\\s*1$') }).click();
    await expect(page.locator('.resource-row').getByText(file, { exact: true })).toBeVisible();
    await page.getByLabel('更多操作 ' + file, { exact: true }).click();
    await page.getByRole('button', { name: '预览', exact: true }).click();
    const modal = page.getByRole('dialog', { name: file, exact: true });
    await expect(modal).toBeVisible();
    if (tab === '投影原理图') {
      await expect(modal.locator('canvas')).toBeVisible();
      expect(
        await modal
          .locator('canvas')
          .evaluate((c) => c.getContext('2d').getImageData(1, 0, 1, 1).data[3]),
      ).toBe(255);
      await page.screenshot({ path: '.local/schematic-preview-v040.png' });
    } else await expect(modal.getByAltText('资源缩略图')).toBeVisible();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  }
  await page.getByRole('button', { name: '陶瓦联机', exact: true }).click();
  await expect(page.getByRole('button', { name: '创建房间', exact: true })).toBeDisabled();
  await expect(page.getByText(/Terracotta \/ 陶瓦联机 ©/)).toBeVisible();
  await page.screenshot({ path: '.local/multiplayer-v040.png' });
  if (process.env.KJMCL_TEST_REAL_TERRACOTTA === '1') {
    if (process.env.KJMCL_TEST_PROXY)
      await page.evaluate(async (proxy) => {
        const s = await window.kjmcl.snapshot();
        await window.kjmcl.settings({ ...s.settings, proxy });
      }, process.env.KJMCL_TEST_PROXY);
    // Explicit opt-in: downloads/executes the official pinned component. No room or game server is joined.
    const task = await page.evaluate(() => window.kjmcl.installTerracotta());
    await expect
      .poll(
        async () =>
          page.evaluate(
            async (task) =>
              (await window.kjmcl.snapshot()).tasks.find((t) => t.id === task)?.status,
            task,
          ),
        { timeout: 120000 },
      )
      .not.toBe('running');
    const installedTask = await page.evaluate(
      async (task) => (await window.kjmcl.snapshot()).tasks.find((t) => t.id === task),
      task,
    );
    expect(installedTask.status, installedTask.detail).toBe('completed');
    await page.evaluate(() => window.kjmcl.startTerracotta());
    await expect
      .poll(() => page.evaluate(async () => (await window.kjmcl.terracottaStatus()).state), {
        timeout: 20000,
      })
      .toBe('waiting');
    await page.evaluate(() =>
      window.kjmcl.controlTerracotta({ action: 'host', player: 'KJMCL_Test' }),
    );
    await expect
      .poll(() => page.evaluate(async () => (await window.kjmcl.terracottaStatus()).state), {
        timeout: 10000,
      })
      .toBe('host-scanning');
    await page.evaluate(() => window.kjmcl.controlTerracotta({ action: 'leave' }));
    await expect
      .poll(() => page.evaluate(async () => (await window.kjmcl.terracottaStatus()).state))
      .toBe('waiting');
    await page.screenshot({ path: '.local/terracotta-real-v040.png' });
    console.log(
      'PASS official Terracotta download/hash verification/process handshake/HTTP scanning/reset (no multiplayer acceptance)',
    );
  }
  expect(errors).toEqual([]);
  console.log(
    'PASS native file drop across four pages, metadata recommendation, import, resource preview/rename/isolation, multiplayer UI and preload',
  );
} finally {
  if (app) {
    const page = app.windows()[0];
    if (page && !page.isClosed())
      await page
        .evaluate(async () => {
          for (const t of (await window.kjmcl.snapshot()).tasks)
            if (t.status === 'running') await window.kjmcl.cancelTask(t.id);
        })
        .catch(() => {});
    await app.close().catch(() => {});
  }
  if (path.basename(root).startsWith('kjmcl-resource-desktop-'))
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
