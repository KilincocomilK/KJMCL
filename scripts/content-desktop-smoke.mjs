// Run after the user approves a build; all provider responses and data are disposable fixtures.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import AdmZip from 'adm-zip';
import { firstVisibleWindow, selectLauncherOption } from './desktop-test-utils.mjs';
const require = createRequire(import.meta.url);
const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-content-desktop-'));
const data = path.join(root, 'data');
const zip = new AdmZip();
zip.addFile('pack.mcmeta', Buffer.from('{"pack":{"description":"Fixture","pack_format":34}}'));
zip.addFile('shaders/main.fsh', Buffer.from('fixture'));
const bytes = zip.toBuffer();
await writeFile(path.join(root, 'fixture.zip'), bytes);
await writeFile(
  path.join(root, 'package.json'),
  JSON.stringify({
    name: 'kjmcl',
    version: JSON.parse(await readFile('package.json', 'utf8')).version,
    main: 'harness.cjs',
  }),
);
await writeFile(
  path.join(root, 'harness.cjs'),
  `
const {MockAgent, setGlobalDispatcher} = require(process.env.KJMCL_TEST_UNDICI);
const fs = require('node:fs');
const mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock);
const pool = mock.get('https://api.modrinth.com');
const version = (project, n) => ({ id:project+n, project_id:project, name:'Version '+n, date_published:'2026-10-0'+n, version_type:'release', game_versions:['1.21.1'], loaders:project==='shader'?['iris']:['minecraft'], dependencies:[], files:[{ filename:project+'-'+n+'.zip', url:'https://fixture.invalid/file.zip', hashes:{sha512:process.env.KJMCL_TEST_HASH}, size:${bytes.length}, primary:true }] });
globalThis.contentSearches = [];
pool.intercept({path:p=>p.startsWith('/v2/search?')&&new URL(p,'https://api.modrinth.com').searchParams.get('query')==='slow',method:'GET'}).reply(200,{hits:[{project_id:'late', title:'Late content'}],total_hits:1}).delay(1200);
pool.intercept({path:/^\\/v2\\/search\\?/,method:'GET'}).reply(200,({path})=>{
 const q = new URL(path, 'https://api.modrinth.com').searchParams;
 globalThis.contentSearches.push(Object.fromEntries(q));
 const shader = q.get('facets').includes('project_type:shader');
 return {hits:[{project_id:shader?'shader':'pack', title:shader?'Fixture Shader':'Fixture Pack', description:'Isolated test', downloads:10, author:'Fixture'}],total_hits:1};
}).persist();
for (const project of ['pack','shader']) {
 pool.intercept({path:'/v2/project/'+project,method:'GET'}).reply(200,{id:project,title:project==='pack'?'Fixture Pack':'Fixture Shader',project_type:project==='pack'?'resourcepack':'shader',downloads:10}).persist();
 pool.intercept({path:p=>p.startsWith('/v2/project/'+project+'/version?'),method:'GET'}).reply(200,[version(project,2),version(project,1)]).persist();
 for (const n of [1,2]) pool.intercept({path:'/v2/version/'+project+n,method:'GET'}).reply(200,version(project,n)).persist();
}
mock.get('https://fixture.invalid').intercept({path:'/file.zip',method:'GET'}).reply(200,fs.readFileSync(process.env.KJMCL_TEST_ZIP)).persist();
require(process.env.KJMCL_TEST_ENTRY);
`,
);
const env = {
  ...process.env,
  KJMCL_DATA_DIR: data,
  KJMCL_TEST_UNDICI: require.resolve('undici'),
  KJMCL_TEST_HASH: createHash('sha512').update(bytes).digest('hex'),
  KJMCL_TEST_ZIP: path.join(root, 'fixture.zip'),
  KJMCL_TEST_ENTRY: path.resolve('dist-electron/main.cjs'),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
let app;
try {
  app = await electron.launch({ args: [root], env });
  const page = await firstVisibleWindow(app),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const id = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: '内容测试', version: '1.21.1', loader: 'fabric' }),
  );
  const other = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: '另一实例', version: '1.20.1', loader: 'fabric' }),
  );
  await page.evaluate((id) => window.kjmcl.select({ instanceId: id }), id);
  await page.getByRole('button', { name: '资源管理', exact: true }).click();
  await page.getByRole('tab', { name: /^资源包/ }).click();
  await page.getByLabel('搜索在线资源包', { exact: true }).fill('pack');
  await page.getByLabel('搜索在线资源包', { exact: true }).press('Enter');
  const online = page.getByRole('region', { name: '在线资源包', exact: true });
  await expect(online.getByText('Fixture Pack', { exact: true })).toBeVisible();
  const search = (await app.evaluate(() => globalThis.contentSearches))[0];
  expect(JSON.parse(search.facets)).toEqual([['project_type:resourcepack'], ['versions:1.21.1']]);
  await online.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(online.getByRole('button', { name: '取消收藏', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await online.getByRole('button', { name: '选择版本', exact: true }).click();
  await selectLauncherOption(page, '内容版本', 'pack1');
  let modal = page.getByRole('dialog', { name: 'Fixture Pack', exact: true });
  await modal.getByRole('button', { name: '安装', exact: true }).click();
  await expect(modal.getByText('安装完成', { exact: true })).toBeVisible({ timeout: 15000 });
  expect(await readFile(path.join(data, 'instances', id, 'resourcepacks/pack-1.zip'))).toEqual(
    bytes,
  );
  await modal.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  modal = page.getByRole('dialog', { name: '收藏', exact: true });
  await modal.getByRole('button', { name: '分组', exact: true }).click();
  await page.getByLabel('收藏分组名称', { exact: true }).fill('__ungrouped__');
  await page
    .getByRole('dialog', { name: '收藏分组', exact: true })
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await selectLauncherOption(page, '收藏分组', 'group:__ungrouped__');
  await expect(modal.getByText('Fixture Pack', { exact: true })).toBeVisible();
  await selectLauncherOption(page, '收藏分组', 'ungrouped');
  await expect(modal.getByText('没有匹配的收藏', { exact: true })).toBeVisible();
  await selectLauncherOption(page, '收藏分组', '');
  await selectLauncherOption(page, '收藏来源', 'curseforge');
  await expect(modal.getByText('没有匹配的收藏', { exact: true })).toBeVisible();
  await selectLauncherOption(page, '收藏来源', 'modrinth');
  await modal.getByRole('button', { name: '选择版本', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Fixture Pack', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /^光影/ }).click();
  const shaderInput = page.getByLabel('搜索在线光影', { exact: true });
  await shaderInput.fill('shader');
  await shaderInput.press('Enter');
  await page
    .getByRole('region', { name: '在线光影', exact: true })
    .getByRole('button', { name: '选择版本', exact: true })
    .click();
  modal = page.getByRole('dialog', { name: 'Fixture Shader', exact: true });
  await modal.getByRole('button', { name: '安装', exact: true }).click();
  await expect(modal.getByText('安装完成', { exact: true })).toBeVisible({ timeout: 15000 });
  expect(await readFile(path.join(data, 'instances', id, 'shaderpacks/shader-2.zip'))).toEqual(
    bytes,
  );
  await page.keyboard.press('Escape');
  await shaderInput.fill('slow');
  await shaderInput.press('Enter');
  await selectLauncherOption(page, '选择实例', other);
  await page.waitForTimeout(1400);
  await expect(page.getByText('Late content', { exact: true })).toHaveCount(0);
  await selectLauncherOption(page, '选择实例', id);
  await page.getByRole('tab', { name: /^模组/ }).click();
  await mkdir(path.join(data, 'instances', id, 'mods'), { recursive: true });
  const mod = new AdmZip();
  mod.addFile('fabric.mod.json', Buffer.from('{"id":"local","version":"1.0"}'));
  await writeFile(path.join(data, 'instances', id, 'mods/local.jar.disabled'), mod.toBuffer());
  const output = path.join(root, 'mods.txt');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, output);
  await page.getByRole('button', { name: '导出清单', exact: true }).click();
  await expect
    .poll(async () => readFile(output, 'utf8').catch(() => ''))
    .toContain('local.jar.disabled\t停用\t1.0\t本地');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth,
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
  console.log(
    'PASS content/favorites UI, pinned fixture downloads, export, stale-result isolation (mock HTTP; no live provider acceptance)',
  );
} finally {
  if (app) await app.close();
  const relative = path.relative(os.tmpdir(), root);
  if (
    !path.isAbsolute(relative) &&
    !relative.startsWith('..') &&
    path.basename(root).startsWith('kjmcl-content-desktop-')
  )
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
