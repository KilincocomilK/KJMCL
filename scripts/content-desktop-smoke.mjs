// Run after the user approves a build; all provider responses and data are disposable fixtures.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import AdmZip from 'adm-zip';
import { answerSystemDialog, firstVisibleWindow, selectLauncherOption } from './desktop-test-utils.mjs';
const require = createRequire(import.meta.url);
const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-content-desktop-'));
const data = path.join(root, 'data');
const launcherVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
const newer = Number(launcherVersion.split('.')[0]) + 1 + '.0.0';
const later = newer.slice(0, -1) + '1';
const latest = newer.slice(0, -1) + '2';
const zip = new AdmZip();
zip.addFile('pack.mcmeta', Buffer.from('{"pack":{"description":"Fixture","pack_format":34}}'));
zip.addFile('shaders/main.fsh', Buffer.from('fixture'));
const bytes = zip.toBuffer();
await writeFile(path.join(root, 'fixture.zip'), bytes);
await writeFile(
  path.join(root, 'package.json'),
  JSON.stringify({
    name: 'kjmcl',
    version: launcherVersion,
    main: 'harness.cjs',
  }),
);
await writeFile(
  path.join(root, 'harness.cjs'),
  `
const {MockAgent, setGlobalDispatcher} = require(process.env.KJMCL_TEST_UNDICI);
const fs = require('node:fs');
const mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock);
const releases = mock.get('https://api.github.com');
const latestPath = '/repos/KilincocomilK/KJMCL/releases/latest';
releases.intercept({path:latestPath}).reply(200, {tag_name:'v${newer}',draft:false,prerelease:false}).times(2);
releases.intercept({path:latestPath}).reply(404, {});
releases.intercept({path:latestPath}).reply(200, {tag_name:'v${later}',draft:false,prerelease:false});
releases.intercept({path:latestPath}).reply(200, {tag_name:'v${latest}',draft:false,prerelease:false}).persist();
releases.intercept({path:'/repos/KilincocomilK/KJMCL/releases?per_page=1'}).reply(404, {}).persist();
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
 for (const n of [1,2]) pool.intercept({path:'/v2/version/'+project+n,method:'GET'}).reply(200,version(project,n)).delay(700).persist();
}
let transfer;
globalThis.holdTransfer = () => { transfer = new Promise(resolve => { globalThis.finishTransfer = resolve; }); };
globalThis.holdTransfer();
mock.get('https://fixture.invalid').intercept({path:'/file.zip',method:'GET'}).reply(async () => {
 await transfer;
 return {statusCode:200, data:fs.readFileSync(process.env.KJMCL_TEST_ZIP)};
}).persist();
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
delete env.KJMCL_UPDATE_FEED;
let app;
try {
  app = await electron.launch({ args: [root], env });
  const page = await firstVisibleWindow(app),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const notices = page.getByRole('complementary', { name: '活动通知' });
  const noticeBox = await notices.boundingBox();
  const closeBox = await page
    .getByRole('button', { name: '关闭启动器', exact: true })
    .boundingBox();
  expect(noticeBox.y).toBeGreaterThanOrEqual(closeBox.y + closeBox.height);
  expect(Math.abs(noticeBox.x + noticeBox.width - closeBox.x - closeBox.width)).toBeLessThan(12);
  await notices.getByRole('button', { name: '查看启动器更新 v' + newer }).click();
  const info = page.getByRole('heading', { name: '启动器信息', level: 2 });
  await expect(page.getByRole('heading', { name: '启动器设置', level: 1 })).toBeVisible();
  await expect(info).toBeFocused();
  await page.getByText('游戏运行', { exact: true }).click();
  await page.getByText('版本详情', { exact: true }).click();
  const javaPath = page.getByPlaceholder('自动检测', { exact: true });
  const savedJava = (await page.evaluate(() => window.kjmcl.snapshot())).settings.javaPath;
  await javaPath.fill('unsaved-java');
  await expect(page.getByText('v' + launcherVersion, { exact: true })).toBeVisible();
  await expect(page.getByText('KilincocomilK', { exact: true })).toBeVisible();
  await expect(page.getByText('可更新至 v' + newer, { exact: true })).toBeVisible();
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url) => {
      globalThis.openedRelease = url;
    };
  });
  await page.getByRole('button', { name: '查看新版本' }).click();
  expect(await app.evaluate(() => globalThis.openedRelease)).toBe(
    'https://github.com/KilincocomilK/KJMCL/releases/tag/v' + newer,
  );
  await page.evaluate(() => window.kjmcl.checkLauncherUpdate());
  await expect(notices.getByText('启动器有更新')).toHaveCount(0);
  await page.getByRole('button', { name: '检查更新' }).click();
  await expect(page.getByText('暂时无法读取发布源')).toBeVisible();
  await expect(javaPath).toHaveValue('unsaved-java');
  expect((await page.evaluate(() => window.kjmcl.snapshot())).settings.javaPath).toBe(savedJava);
  const main = page.getByRole('main');
  await main.evaluate((el) => el.scrollTo(0, 0));
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/launcher-info.png', animations: 'disabled' });
  await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(info).not.toBeInViewport();
  await page.evaluate(() => window.kjmcl.checkLauncherUpdate());
  await notices.getByRole('button', { name: '查看启动器更新 v' + later }).click();
  await expect(info).toBeFocused();
  await expect(info).toBeInViewport();
  expect(await main.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(javaPath).toHaveValue('unsaved-java');
  const id = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: '内容测试', version: '1.21.1', loader: 'fabric' }),
  );
  const other = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: '另一实例', version: '1.20.1', loader: 'fabric' }),
  );
  await page.evaluate((id) => window.kjmcl.select({ instanceId: id }), id);
  await page.getByRole('button', { name: '资源管理', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '选择实例', exact: true })).toContainText(
    '内容测试',
  );
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
  await expect(notices.getByRole('progressbar')).toBeVisible();
  await expect(notices.getByText(/约剩/)).toBeVisible();
  await answerSystemDialog(app, () => page.evaluate(() => window.kjmcl.window('close')), async (dialog) => {
    await expect(dialog.getByRole('button', { name: '继续下载' })).toBeFocused();
    await expect(dialog.getByText('退出会取消正在进行的下载。')).toBeVisible();
    await dialog.screenshot({ path: '.local/launcher-download-exit.png' });
    await dialog.getByRole('button', { name: '继续下载' }).click();
  });
  await expect(notices.getByRole('progressbar')).toBeVisible();
  await notices.getByRole('button', { name: /^查看任务/ }).click();
  await expect(modal).toBeVisible();
  await expect(notices.locator('.activity-detail')).toContainText('Fixture Pack');
  await page.screenshot({ path: '.local/launcher-download-notice.png' });
  await page.evaluate(() => window.kjmcl.checkLauncherUpdate());
  const more = notices.getByRole('button', { name: '另有 1 条通知' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await notices.getByRole('button', { name: '查看启动器更新 v' + latest }).click();
  await expect(notices.getByText('v' + launcherVersion + ' → v' + latest)).toBeVisible();
  await expect(modal).toBeVisible();
  await notices.getByRole('button', { name: '关闭更新通知' }).click();
  await expect(notices.getByRole('button', { name: '关闭更新通知' })).toHaveCount(0);
  await notices.getByRole('button', { name: /^关闭通知/ }).click();
  await expect(notices.getByRole('progressbar')).toHaveCount(0);
  await app.evaluate(() => globalThis.finishTransfer());
  await expect(modal.getByText('安装完成', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(notices.getByRole('button', { name: /^查看任务/ })).toHaveCount(0);
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
  await app.evaluate(({ app }) => app.emit('second-instance', {}, [], process.cwd(), {}));
  await expect(notices.getByRole('button', { name: '查看启动器更新 v' + latest })).toBeVisible();
  await app.evaluate(() => globalThis.holdTransfer());
  await page.evaluate((id) => window.kjmcl.installContent({
    id, source: 'modrinth', kind: 'resourcepack', projectId: 'pack', versionId: 'pack2',
  }), id);
  await expect.poll(() => page.evaluate(async () =>
    (await window.kjmcl.snapshot()).tasks.find((t) => t.status === 'running')?.detail,
  )).toContain('下载');
  const closed = app.waitForEvent('close', { timeout: 15000 });
  await answerSystemDialog(app, () => page.evaluate(() => window.kjmcl.window('close')),
    (dialog) => dialog.getByRole('button', { name: '退出启动器' }).click(),
  );
  await closed;
  app = undefined;
  const files = await readdir(path.join(data, 'instances', id), { recursive: true });
  expect(files.some((file) => /pack-2\.zip$|\.part$|\.download$/.test(file))).toBe(false);
  console.log(
    'PASS launcher info, release checks, grouped activity, ETA, dismiss-without-cancel, content/favorites UI, pinned downloads and export (mock HTTP)',
  );
} finally {
  if (app) {
    await app.evaluate(() => globalThis.finishTransfer?.()).catch(() => {});
    await app.close();
  }
  const relative = path.relative(os.tmpdir(), root);
  if (
    !path.isAbsolute(relative) &&
    !relative.startsWith('..') &&
    path.basename(root).startsWith('kjmcl-content-desktop-')
  )
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
