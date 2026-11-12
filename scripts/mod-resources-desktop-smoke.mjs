import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import AdmZip from 'adm-zip';
import { firstVisibleWindow } from './desktop-test-utils.mjs';
const require = createRequire(import.meta.url);
const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-mod-resources-'));
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
  Buffer.from(JSON.stringify({ id: 'example', version: '1', depends: { minecraft: '1.21.1' } })),
);
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
const hit = {project_id:'example', title:'Example Mod', description:'Test fixture', author:'Fixture', downloads:42, slug:'example'};
pool.intercept({path:p=>p.startsWith('/v2/search?') && new URL(p,'https://api.modrinth.com').searchParams.get('query')==='slow', method:'GET'})
 .reply(200,{hits:[{...hit,title:'Late Result'}],total_hits:1}).delay(1200);
pool.intercept({path:/^\\/v2\\/search\\?/, method:'GET'}).reply(200, ({path})=>{
 const p = new URL(path, 'https://api.modrinth.com').searchParams;
 globalThis.searchRequests.push({query:p.get('query'), facets:JSON.parse(p.get('facets')), offset:p.get('offset')});
 return {hits:p.get('query')==='empty'?[]:[hit],total_hits:p.get('query')==='empty'?0:1};
}).persist();
pool.intercept({path:/^\\/v2\\/project\\/example\\/version\\?/,method:'GET'}).reply(200,[{
 id:'v1',project_id:'example',game_versions:['1.21.1'],loaders:['fabric'],dependencies:[],
 files:[{filename:'example.jar',url:'https://fixture.invalid/example.jar',hashes:{sha512:process.env.KJMCL_TEST_HASH},size:${bytes.length},primary:true}]
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
  const input = page.getByLabel('搜索模组', { exact: true });
  await input.fill('example');
  await input.press('Enter');
  const results = page.getByRole('region', { name: '模组搜索结果' });
  await expect(results.getByText('Example Mod', { exact: true })).toBeVisible();
  expect((await app.evaluate(() => globalThis.searchRequests))[0].facets).toEqual([
    ['project_type:mod'],
    ['versions:1.21.1'],
    ['categories:fabric'],
  ]);
  await results.getByRole('button', { name: '安装', exact: true }).click();
  await expect(results.getByRole('button', { name: '下载中', exact: true })).toBeDisabled();
  await expect(results.getByRole('button', { name: '已安装', exact: true })).toBeDisabled({
    timeout: 15000,
  });
  expect(await readFile(path.join(data, 'instances', id, 'mods', 'example.jar'))).toEqual(bytes);
  const installed = page.getByRole('region', { name: '已安装模组' });
  await expect(installed.getByText('example.jar', { exact: true })).toBeVisible();
  await installed.getByRole('switch').click();
  await expect(installed.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  expect(await readFile(path.join(data, 'instances', id, 'mods', 'example.jar.disabled'))).toEqual(
    bytes,
  );
  await expect(results.getByRole('button', { name: '已安装', exact: true })).toBeDisabled();
  await page.getByLabel('更多操作 example.jar.disabled', { exact: true }).click();
  await expect(page.getByRole('button', { name: '重命名', exact: true })).toHaveCount(0);
  await page.getByLabel('更多操作 example.jar.disabled', { exact: true }).click();
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
  await page.getByLabel('选择实例').selectOption(other);
  await expect(page.getByLabel('搜索模组', { exact: true })).toHaveValue('');
  await page.waitForTimeout(1400);
  await expect(page.getByText('Late Result', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await page.getByLabel('搜索模组', { exact: true }).fill('example');
  await page.getByLabel('搜索模组', { exact: true }).press('Enter');
  await expect(results.getByText('Example Mod', { exact: true })).toBeVisible();
  expect((await app.evaluate(() => globalThis.searchRequests)).at(-1).facets).toEqual([
    ['project_type:mod'],
    ['versions:1.20.1'],
    ['categories:forge'],
  ]);
  await page.getByLabel('模组来源').selectOption('curseforge');
  await expect(results).toHaveCount(0);
  await page.getByLabel('模组来源').selectOption('modrinth');
  await page.getByLabel('搜索模组', { exact: true }).fill('empty');
  await page.getByLabel('搜索模组', { exact: true }).press('Enter');
  await expect(page.getByText('没有找到兼容模组', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    'PASS unified resource UI, instance-filtered search, real verified fixture download via mocked HTTP, install refresh, duplicate prevention, toggling, stale-result rejection, source switch and compact layout (no live provider acceptance)',
  );
} finally {
  if (app) await app.close();
  if (path.basename(root).startsWith('kjmcl-mod-resources-'))
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
