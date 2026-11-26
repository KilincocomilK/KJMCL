import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, realpath, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import AdmZip from 'adm-zip';
import { firstVisibleWindow, selectLauncherOption } from './desktop-test-utils.mjs';
const require = createRequire(import.meta.url);
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kjmcl-mod-resources-')));
const version = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')).version;
await writeFile(
  path.join(root, 'package.json'),
  JSON.stringify({ name: 'kjmcl', version, main: 'harness.cjs' }),
);
const data = path.join(root, 'data'),
  harness = path.join(root, 'harness.cjs');
const fixture = new AdmZip();
fixture.addFile(
  'fabric.mod.json',
  Buffer.from(
    JSON.stringify({
      id: 'sodium',
      name: 'Sodium',
      version: '0.6.13',
      icon: 'assets/sodium/logo.png',
      depends: { minecraft: '1.21.1' },
    }),
  ),
);
fixture.addFile('assets/sodium/logo.png', await readFile('build/icon.png'));
const bytes = fixture.toBuffer(),
  hash = createHash('sha512').update(bytes).digest('hex');
await writeFile(path.join(root, 'example.jar'), bytes);
await writeFile(
  harness,
  `
const {MockAgent, setGlobalDispatcher} = require(process.env.KJMCL_TEST_UNDICI);
const fs = require('node:fs');
const mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock);
const pool = mock.get('https://api.modrinth.com');
globalThis.searchRequests = [];
globalThis.modVersion = 'v1';
const hit = {project_id:'example', title:'Example Mod', description:'Test fixture', author:'Fixture', downloads:42, slug:'example'};
pool.intercept({path:p=>p.startsWith('/v2/search?') && new URL(p,'https://api.modrinth.com').searchParams.get('query')==='slow', method:'GET'})
 .reply(200,{hits:[{...hit,title:'Late Result'}],total_hits:1}).delay(1200);
pool.intercept({path:/^\\/v2\\/search\\?/, method:'GET'}).reply(200, ({path})=>{
 const p = new URL(path, 'https://api.modrinth.com').searchParams;
 globalThis.searchRequests.push({query:p.get('query'), facets:JSON.parse(p.get('facets')), offset:p.get('offset'), sort:p.get('index')});
 return {hits:p.get('query')==='empty'?[]:[hit],total_hits:p.get('query')==='empty'?0:1};
}).persist();
pool.intercept({path:/^\\/v2\\/project\\/example\\/version\\?/,method:'GET'}).reply(200,()=>[{
 id:globalThis.modVersion,project_id:'example',game_versions:['1.21.1'],loaders:['fabric'],dependencies:[],
 files:[{filename:globalThis.modVersion === 'v1' ? 'example.jar' : 'example-v2.jar',url:'https://fixture.invalid/example.jar',hashes:{sha512:process.env.KJMCL_TEST_HASH},size:${bytes.length},primary:true}]
}]).persist();
mock.get('https://fixture.invalid').intercept({path:'/example.jar',method:'GET'})
 .reply(200,fs.readFileSync(process.env.KJMCL_TEST_JAR)).delay(700).persist();
require(process.env.KJMCL_TEST_ENTRY);
`,
);
const env = {
  ...process.env,
  KJMCL_DATA_DIR: data,
  KJMCL_TEST_UNDICI: require.resolve('undici'),
  KJMCL_TEST_HASH: hash,
  KJMCL_TEST_JAR: path.join(root, 'example.jar'),
  KJMCL_TEST_ENTRY: path.resolve('dist-electron/main.cjs'),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
let app;
try {
  app = await electron.launch({ args: [root], env });
  const page = await firstVisibleWindow(app);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const id = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: '模组实例', version: '1.21.1', loader: 'fabric' }),
  );
  const other = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: '另一实例', version: '1.20.1', loader: 'forge' }),
  );
  await page.evaluate((id) => window.kjmcl.select({ instanceId: id }), id);
  await page.getByRole('button', { name: '资源管理', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '选择实例' })).toHaveCount(1);
  for (const name of ['本地资源', '模组管理', '内容发现', '发现模组'])
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /^模组/ })).toHaveAttribute('aria-selected', 'true');
  const input = page.getByLabel('搜索在线模组', { exact: true });
  await expect
    .poll(async () => {
      const selector = await page.getByRole('combobox', { name: '选择实例' }).boundingBox();
      const firstTab = await page.getByRole('tab', { name: /^模组/ }).boundingBox();
      return !!selector && !!firstTab && selector.y + selector.height < firstTab.y;
    })
    .toBe(true);
  await input.fill('钠 Sodium');
  await input.press('Enter');
  const results = page.getByRole('region', { name: '在线模组' });
  await expect(results.getByText('Example Mod', { exact: true })).toBeVisible();
  // The initial unfiltered listing can finish before the submitted search.
  await expect
    .poll(() =>
      app.evaluate(
        () => globalThis.searchRequests.find((request) => request.query === 'sodium')?.facets,
      ),
    )
    .toEqual([['project_type:mod'], ['versions:1.21.1'], ['categories:fabric']]);
  await selectLauncherOption(page, '内容排序', 'downloads');
  await expect
    .poll(() => app.evaluate(() => globalThis.searchRequests.at(-1).sort))
    .toBe('downloads');
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url) => {
      globalThis.openedProject = url;
    };
  });
  await results.getByRole('button', { name: '打开发布页 Example Mod' }).click();
  expect(await app.evaluate(() => globalThis.openedProject)).toBe(
    'https://modrinth.com/mod/example',
  );
  await results.getByRole('button', { name: '安装', exact: true }).click();
  await expect(results.getByRole('button', { name: '下载中', exact: true })).toBeDisabled();
  await expect(results.getByRole('button', { name: '已安装', exact: true })).toBeDisabled({
    timeout: 15000,
  });
  expect(await readFile(path.join(data, 'instances', id, 'mods', 'example.jar'))).toEqual(bytes);
  const activity = page.locator('.activity-stack .activity-card').first();
  await activity.hover();
  const noticeBounds = await activity.boundingBox();
  for (const label of ['刷新资源', '导出清单']) {
    const control = page.getByRole('button', { name: label, exact: true });
    const box = await control.boundingBox();
    expect(
      box.x + box.width <= noticeBounds.x || box.y >= noticeBounds.y + noticeBounds.height,
    ).toBe(true);
  }
  await page.getByRole('button', { name: '刷新资源' }).click();
  const installed = page.getByRole('region', { name: '已安装模组' });
  await expect(installed.getByText('example.jar', { exact: true })).toBeVisible();
  await expect(installed.getByText('Sodium', { exact: true })).toBeVisible();
  await expect(installed.getByText('0.6.13', { exact: true })).toBeVisible();
  await expect(installed.locator('.local-resource-art img')).toHaveJSProperty('naturalWidth', 64);
  const local = page.getByLabel('搜索本地模组');
  await local.fill('Ｓｏｄｉｕｍ 钠 0.6.13');
  await expect(installed.getByRole('switch')).toBeVisible();
  await local.fill('无匹配');
  await expect(installed.getByRole('switch')).toHaveCount(0);
  await expect(results.getByText('Example Mod', { exact: true })).toBeVisible();
  await input.fill('独立的在线搜索');
  await local.fill('钠');
  const toggle = installed.getByRole('switch');
  const track = await toggle.locator('.switch-track').boundingBox();
  expect(track.width / track.height).toBeGreaterThanOrEqual(1.6);
  expect((await toggle.boundingBox()).height).toBeLessThanOrEqual(track.height + 8);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(installed.locator('small')).toHaveCSS('font-family', /Fusion Pixel/);
  expect(await readFile(path.join(data, 'instances', id, 'mods', 'example.jar.disabled'))).toEqual(
    bytes,
  );
  await expect(results.getByRole('button', { name: '已安装', exact: true })).toBeDisabled();
  await page.getByLabel('更多操作 example.jar.disabled', { exact: true }).click();
  await expect(page.getByRole('button', { name: '重命名', exact: true })).toHaveCount(0);
  await page.getByLabel('更多操作 example.jar.disabled', { exact: true }).click();
  await app.evaluate(() => {
    globalThis.modVersion = 'v2';
  });
  await selectLauncherOption(page, '内容来源', 'curseforge');
  await installed.getByRole('button', { name: '检查更新', exact: true }).click();
  const preview = installed.getByRole('region', { name: '模组更新预览' });
  await expect(preview.getByText('example-v2.jar', { exact: true })).toBeVisible();
  expect(await readFile(path.join(data, 'instances', id, 'mods', 'example.jar.disabled'))).toEqual(
    bytes,
  );
  await preview.getByRole('button', { name: '应用全部更新' }).click();
  await expect(installed.getByRole('button', { name: '撤销上次更新' })).toBeVisible();
  expect(
    await readFile(path.join(data, 'instances', id, 'mods', 'example-v2.jar.disabled')),
  ).toEqual(bytes);
  await installed.getByRole('button', { name: '撤销上次更新' }).click();
  await expect(installed.getByRole('button', { name: '撤销上次更新' })).toHaveCount(0);
  expect(await readFile(path.join(data, 'instances', id, 'mods', 'example.jar.disabled'))).toEqual(
    bytes,
  );
  await selectLauncherOption(page, '内容来源', 'modrinth');
  await mkdir('.local', { recursive: true });
  await page.mouse.move(1, 1);
  await page.screenshot({ path: '.local/resources-v071.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({ path: '.local/resources-v071-compact.png' });
  await input.fill('slow');
  await input.press('Enter');
  await selectLauncherOption(page, '选择实例', other);
  await expect(page.getByLabel('搜索在线模组', { exact: true })).toHaveValue('');
  await page.waitForTimeout(1400);
  await expect(page.getByText('Late Result', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await page.getByLabel('搜索在线模组', { exact: true }).fill('example');
  await page.getByLabel('搜索在线模组', { exact: true }).press('Enter');
  await expect(results.getByText('Example Mod', { exact: true })).toBeVisible();
  expect((await app.evaluate(() => globalThis.searchRequests)).at(-1).facets).toEqual([
    ['project_type:mod'],
    ['versions:1.20.1'],
    ['categories:forge'],
  ]);
  await selectLauncherOption(page, '内容来源', 'curseforge');
  await expect(results.getByRole('article')).toHaveCount(0);
  await selectLauncherOption(page, '内容来源', 'modrinth');
  await page.getByLabel('搜索在线模组', { exact: true }).fill('empty');
  await page.getByLabel('搜索在线模组', { exact: true }).press('Enter');
  await expect(page.getByText('没有找到兼容内容', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    'PASS unified resource UI, instance-filtered search, real verified fixture download via mocked HTTP, install refresh, duplicate prevention, toggling, stale-result rejection, source switch and compact layout (no live provider acceptance)',
  );
} finally {
  if (app) await app.close();
  if (path.basename(root).startsWith('kjmcl-mod-resources-'))
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
