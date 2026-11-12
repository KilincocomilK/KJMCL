import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const control = realpathSync.native(await mkdtemp(path.join(os.tmpdir(), 'kjmcl-storage-ui-')));
const work = realpathSync.native(
  await mkdtemp(path.join(path.resolve('.local'), 'kjmcl-storage-target-')),
);
const target = path.join(work, 'data'),
  external = path.join(work, 'external');
const env = { ...process.env, KJMCL_DATA_DIR: control };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
const options = process.env.KJMCL_EXECUTABLE
  ? { executablePath: process.env.KJMCL_EXECUTABLE, args: [], env }
  : { args: ['.'], env };
let app;
try {
  app = await electron.launch(options);
  let page = await app.firstWindow();
  await page.waitForSelector('h1');
  const ids = await page.evaluate(async (external) => {
    await window.kjmcl.addOffline('Storage_Test');
    const internal = await window.kjmcl.createInstance({
      name: '内部实例',
      version: '1.21.11',
      loader: 'vanilla',
    });
    const other = await window.kjmcl.createInstance({
      name: '外部实例',
      version: '1.21.11',
      loader: 'vanilla',
      gameDir: external,
    });
    await window.kjmcl.integrationKey({ service: 'curseforge', key: 'storage-fixture-key' });
    return { internal, other };
  }, external);
  await mkdir(path.join(control, 'assets'), { recursive: true });
  await writeFile(path.join(control, 'assets/probe'), 'resource-fixture');
  await writeFile(path.join(external, 'world.txt'), 'world-fixture');
  await page.getByRole('button', { name: '启动器设置', exact: true }).click();
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
  }, target);
  await page.getByRole('button', { name: '迁移数据', exact: true }).click();
  await expect
    .poll(async () =>
      page.evaluate(async () => (await window.kjmcl.snapshot()).storage.pendingRestart),
    )
    .toBe(target);
  expect(await readFile(path.join(control, 'assets/probe'), 'utf8')).toBe('resource-fixture');
  expect(
    await page.evaluate(async () => {
      try {
        await window.kjmcl.addOffline('Blocked');
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  await expect(page.getByRole('button', { name: '重启并切换', exact: true })).toBeEnabled();
  await page.screenshot({ path: '.local/storage-pending.png' });
  await app.close();
  app = await electron.launch(options);
  page = await app.firstWindow();
  await page.waitForSelector('h1');
  const snapshot = await page.evaluate(() => window.kjmcl.snapshot());
  expect(snapshot.dataPath).toBe(target);
  expect(snapshot.accounts[0].name).toBe('Storage_Test');
  expect(snapshot.instances.find((i) => i.id === ids.internal).gameDir).toBe(
    path.join(target, 'instances', ids.internal),
  );
  expect(snapshot.instances.find((i) => i.id === ids.other).gameDir).toBe(external);
  expect(await app.evaluate(({ app }) => app.getPath('sessionData'))).toBe(control);
  const credentialWorks = await app.evaluate(
    ({ safeStorage }, bytes) =>
      safeStorage.decryptString(Buffer.from(bytes)) === 'storage-fixture-key',
    Array.from(await readFile(path.join(target, 'credentials/curseforge.vault'))),
  );
  expect(credentialWorks).toBe(true);
  await page.getByRole('button', { name: '启动器设置', exact: true }).click();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  await page.getByRole('button', { name: '清理原数据', exact: true }).click();
  await expect
    .poll(async () => page.evaluate(async () => (await window.kjmcl.snapshot()).storage.retired))
    .toBeUndefined();
  expect(await readFile(path.join(control, 'state.json'), 'utf8').catch(() => null)).toBeNull();
  expect(await readFile(path.join(target, 'assets/probe'), 'utf8')).toBe('resource-fixture');
  expect(await readFile(path.join(external, 'world.txt'), 'utf8')).toBe('world-fixture');
  await page.locator('.storage-settings').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/storage-migrated.png' });
  await app.close();
  app = undefined;
  const locationFile = path.join(control, 'storage-location.json');
  const location = JSON.parse(await readFile(locationFile, 'utf8'));
  await writeFile(locationFile, JSON.stringify({ ...location, setupComplete: false }));
  app = await electron.launch(options);
  page = await app.firstWindow();
  await expect(page.getByRole('dialog', { name: '选择数据目录' })).toBeVisible();
  await page.getByRole('button', { name: '使用此目录', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '选择数据目录' })).not.toBeVisible();
  expect((await page.evaluate(() => window.kjmcl.snapshot())).accounts[0].name).toBe(
    'Storage_Test',
  );
  console.log(
    'PASS cross-volume data migration, restart, internal path remapping, encrypted credentials, external game preservation, explicit source cleanup and directory setup UI',
  );
} finally {
  if (app) await app.close();
  if (path.basename(control).startsWith('kjmcl-storage-ui-'))
    await rm(control, { recursive: true, force: true });
  if (
    path.basename(work).startsWith('kjmcl-storage-target-') &&
    work.startsWith(path.resolve('.local') + path.sep)
  )
    await rm(work, { recursive: true, force: true });
}
