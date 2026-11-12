import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createSaveFixture } from './save-fixtures.mjs';
const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-saves-desktop-'));
const env = { ...process.env, KJMCL_DATA_DIR: root };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
let app, java;
try {
  app = await electron.launch(
    process.env.KJMCL_EXECUTABLE
      ? { executablePath: process.env.KJMCL_EXECUTABLE, args: [], env }
      : { args: ['.'], env },
  );
  const page = await app.firstWindow();
  await page.waitForSelector('h1');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const id = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: 'Rust 存档测试', version: '1.21.1', loader: 'vanilla' }),
  );
  const world = path.join(root, 'instances', id, 'saves', 'Fixture');
  const original = await createSaveFixture(world);
  await page.getByRole('button', { name: '存档管理', exact: true }).click();
  await page.getByRole('button', { name: /测试世界/ }).click();
  await expect(page.getByRole('heading', { name: '测试世界', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(page.getByLabel('区块地表地图')).toBeVisible();
  const map = page.getByLabel('区块地表地图');
  await expect
    .poll(() => map.evaluate((c) => c.getContext('2d').getImageData(8, 8, 1, 1).data[3]))
    .toBe(255);
  await page.getByRole('button', { name: '属性', exact: true }).click();
  await page.getByLabel('世界名称').fill('Rust 编辑验收');
  await page.getByRole('button', { name: '备份并保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rust 编辑验收', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('heading', { name: '测试世界', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(map).toBeVisible();
  await page.getByLabel('出生点保护半径').fill('0');
  await page.getByLabel('最大停留分钟').fill('5');
  await page.getByRole('button', { name: '选择符合条件的区块', exact: true }).click();
  await expect(page.getByText('已选 6 个', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '预览清理', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认区块清理范围' })).toBeVisible();
  await app.evaluate(({ dialog }) => {
    globalThis.originalSaveConfirm = dialog.showMessageBox;
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('button', { name: '备份并清理', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        async (id) =>
          (await window.kjmcl.scanWorld({ id, world: 'Fixture' })).dimensions[0].regions[0].chunks,
        id,
      ),
    )
    .toBe(1018);
  await expect(page.getByText('清理 6 个区块', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).first().click();
  await expect
    .poll(() => readFile(path.join(world, 'region/r.0.0.mca')).then((b) => b.equals(original)))
    .toBe(true);
  // Validate Java FileChannel lock interoperability, not only Rust-on-Rust locking.
  const source = path.join(root, 'WorldLock.java');
  await writeFile(
    source,
    'import java.nio.channels.*; import java.nio.file.*; class WorldLock { public static void main(String[] a) throws Exception { try (var c=FileChannel.open(Path.of(a[0]),StandardOpenOption.CREATE,StandardOpenOption.WRITE); var l=c.lock()) { System.out.println("LOCKED"); System.out.flush(); Thread.sleep(60000); } } }',
  );
  java = spawn('java', [source, path.join(world, 'session.lock')], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Java world lock timeout')), 15000);
    java.stdout.on('data', (b) => {
      if (b.toString().includes('LOCKED')) {
        clearTimeout(timer);
        resolve();
      }
    });
    java.on('error', reject);
  });
  const locked = await page.evaluate(async (id) => {
    try {
      await window.kjmcl.editWorld({ id, world: 'Fixture', patch: { name: 'must not write' } });
      return false;
    } catch (e) {
      return String(e).includes('正在被');
    }
  }, id);
  expect(locked).toBe(true);
  java.kill();
  java = undefined;
  const rejected = await page.evaluate(async (id) => {
    try {
      await window.kjmcl.scanWorld({ id, world: '../escape' });
      return false;
    } catch {
      return true;
    }
  }, id);
  expect(rejected).toBe(true);
  await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(map).toBeVisible();
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/save-manager-v050.png' });
  await map.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/save-manager-map-v050.png' });
  expect(errors).toEqual([]);
  console.log(
    'PASS Rust map/UI/metadata/plan/prune/byte-exact undo, Java FileChannel lock and IPC path validation (synthetic save)',
  );
} finally {
  java?.kill();
  if (app) await app.close();
  if (path.basename(root).startsWith('kjmcl-saves-desktop-'))
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
