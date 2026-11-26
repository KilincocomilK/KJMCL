import { _electron as electron, expect } from '@playwright/test';
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { firstVisibleWindow, selectLauncherOption } from './desktop-test-utils.mjs';

const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kjmcl-upgrade-')));
const archive = path.join(root, 'fixture.mrpack');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const sha1 = (text) => createHash('sha1').update(text).digest('hex');
const origin = 'https://fixture.invalid';
const client = 'isolated test client',
  assets = '{"objects":{}}',
  mod = 'required fixture';
const artifact = (file, text) => ({
  url: origin + '/' + file,
  sha1: sha1(text),
  size: Buffer.byteLength(text),
});
const profile = (id) =>
  JSON.stringify({
    id,
    mainClass: 'Fixture',
    libraries: [],
    downloads: { client: artifact('client', client) },
    assetIndex: { id: 'fixture', ...artifact('index', assets) },
  });
const versions = ['1.21.1', '1.21.2'].map((id) => ({
  id,
  type: 'release',
  ...artifact(id, profile(id)),
}));
const routes = Object.fromEntries([
  ['/index', assets],
  ['/client', client],
  ...versions.map(({ id }) => ['/' + id, profile(id)]),
]);
const pack = new AdmZip();
pack.addFile(
  'modrinth.index.json',
  Buffer.from(
    JSON.stringify({
      formatVersion: 1,
      game: 'minecraft',
      name: '续装测试',
      dependencies: { minecraft: '1.21.1' },
      files: [
        {
          path: 'mods/fixture.jar',
          hashes: { sha1: sha1(mod) },
          downloads: [origin + '/required'],
          fileSize: mod.length,
        },
      ],
    }),
  ),
);
for (const [name, content] of [
  ['overrides/kubejs/test.js', 'base'],
  ['client-overrides/kubejs/test.js', 'client'],
  ['overrides/saves/World/level.dat', 'original world'],
  ['server-overrides/config/server.json', 'server'],
])
  pack.addFile(name, Buffer.from(content));
const onlinePack = new AdmZip();
onlinePack.addFile(
  'modrinth.index.json',
  Buffer.from(
    JSON.stringify({
      formatVersion: 1,
      game: 'minecraft',
      name: '在线试更',
      dependencies: { minecraft: '1.21.2' },
      files: [],
    }),
  ),
);
const packBytes = onlinePack.toBuffer();
const onlineProject = {
  id: 'upgrade',
  project_id: 'upgrade',
  project_type: 'modpack',
  title: '跨版本整合包',
  downloads: 10,
};
const onlineVersion = {
  id: 'upgrade2',
  project_id: 'upgrade',
  name: 'V2',
  date_published: '2026-11-02',
  version_type: 'release',
  game_versions: ['1.21.2'],
  loaders: ['vanilla'],
  dependencies: [],
  files: [
    {
      filename: 'online.mrpack',
      primary: true,
      url: origin + '/online.mrpack',
      size: packBytes.length,
      hashes: { sha512: createHash('sha512').update(packBytes).digest('hex') },
    },
  ],
};
await pack.writeZipPromise(archive);
await writeFile(
  path.join(root, 'package.json'),
  JSON.stringify({ name: 'kjmcl', version, main: 'harness.cjs' }),
);
await writeFile(
  path.join(root, 'harness.cjs'),
  `
const {MockAgent, setGlobalDispatcher} = require(process.env.FIXTURE_UNDICI);
const mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock);
mock.get('https://piston-meta.mojang.com').intercept({path:'/mc/game/version_manifest_v2.json'}).reply(200, {versions:${JSON.stringify(versions)}}).persist();
const modrinth = mock.get('https://api.modrinth.com');
modrinth.intercept({path: p=>p.startsWith('/v2/search?') && new URL(p,'https://api.modrinth.com').searchParams.get('facets')==='[["project_type:modpack"]]'}).reply(200,{hits:[${JSON.stringify(onlineProject)}],total_hits:1}).persist();
modrinth.intercept({path:'/v2/project/upgrade'}).reply(200,${JSON.stringify(onlineProject)}).persist();
modrinth.intercept({path:'/v2/project/upgrade/version'}).reply(200,[${JSON.stringify(onlineVersion)}]).persist();
modrinth.intercept({path:'/v2/version/upgrade2'}).reply(200,${JSON.stringify(onlineVersion)}).persist();
const downloads = mock.get(${JSON.stringify(origin)});
downloads.intercept({path:'/online.mrpack'}).reply(200,Buffer.from(${JSON.stringify(packBytes.toString('base64'))},'base64')).persist();
for (const [url, value] of Object.entries(${JSON.stringify(routes)}))
  downloads.intercept({path:url}).reply(200,value).persist();
downloads.intercept({path:'/required'}).reply(process.env.FIXTURE_RETRY ? 200 : 404, ${JSON.stringify(mod)}).persist();
require(process.env.FIXTURE_MAIN);
`,
);
const env = {
  ...process.env,
  KJMCL_DATA_DIR: path.join(root, 'data'),
  FIXTURE_UNDICI: createRequire(import.meta.url).resolve('undici'),
  FIXTURE_MAIN: path.resolve('dist-electron/main.cjs'),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
let app;
const errors = [];
async function open(retry) {
  app = await electron.launch({ args: [root], env: { ...env, FIXTURE_RETRY: retry ? 'yes' : '' } });
  const page = await firstVisibleWindow(app);
  page.on('pageerror', (error) => errors.push(error.message));
  return page;
}
const instances = (page) => page.evaluate(async () => (await window.kjmcl.snapshot()).instances);
async function onlinePreview(page) {
  await page.getByRole('button', { name: '查找整合包' }).click();
  const catalog = page.getByRole('region', { name: '在线整合包' });
  await catalog.getByRole('button', { name: '搜索', exact: true }).click();
  await catalog.getByRole('button', { name: '选择版本' }).click();
  const versions = page.getByRole('dialog', { name: '跨版本整合包' });
  await expect(versions.getByRole('combobox', { name: '内容版本' })).toContainText(
    'Minecraft 1.21.2 · 原版',
  );
  await versions.getByRole('button', { name: '预览整合包' }).click();
  const plan = page.getByRole('dialog', { name: '预览整合包' });
  await expect(plan.getByText(/Minecraft 1.21.2/)).toBeVisible();
  return plan;
}
try {
  let page = await open(false);
  await page.evaluate(async () => {
    const { settings } = await window.kjmcl.snapshot();
    await window.kjmcl.settings({ ...settings, source: 'official' });
  });
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, archive);
  await page.getByRole('button', { name: '游戏实例', exact: true }).click();
  const early = await onlinePreview(page);
  expect(await instances(page)).toHaveLength(0);
  await early.getByRole('button', { name: '取消' }).click();
  await page.getByRole('button', { name: '导入整合包' }).click();
  const preview = page.getByRole('dialog', { name: '预览整合包' });
  await expect(preview.getByText(/跳过.*2/)).toBeVisible();
  await expect.poll(async () => (await instances(page)).length).toBe(0);
  await preview.getByRole('button', { name: '创建实例并安装' }).click();
  await expect
    .poll(async () => (await instances(page))[0]?.status, { timeout: 30000 })
    .toBe('error');
  const [source] = await instances(page);
  expect(source.error).toContain('404');
  await app.close();
  app = undefined;
  await rm(archive);
  page = await open(true);
  await page.getByRole('button', { name: '继续安装整合包' }).click();
  await expect
    .poll(
      async () => {
        const [saved] = await instances(page);
        return saved.error || saved.status;
      },
      { timeout: 30000 },
    )
    .toBe('ready');
  expect((await instances(page)).map((i) => i.id)).toEqual([source.id]);
  expect(await readFile(path.join(source.gameDir, 'kubejs/test.js'), 'utf8')).toBe('client');
  expect(await readFile(path.join(source.gameDir, 'mods/fixture.jar'), 'utf8')).toBe(mod);
  await page.getByRole('button', { name: '游戏实例', exact: true }).click();
  await page.getByLabel('续装测试 设置', { exact: true }).click();
  await page.getByRole('button', { name: '副本试更', exact: true }).click();
  await selectLauncherOption(page, '游戏版本', '1.21.2');
  await page.getByRole('button', { name: '创建试更副本', exact: true }).click();
  await expect
    .poll(async () => (await instances(page)).find((i) => i.id !== source.id)?.status, {
      timeout: 30000,
    })
    .toBe('ready');
  const after = await instances(page);
  const copy = after.find((i) => i.id !== source.id);
  expect(copy.version).toBe('1.21.2');
  expect(after.find((i) => i.id === source.id).version).toBe('1.21.1');
  const world = path.join('saves', 'World', 'level.dat');
  expect(await readFile(path.join(copy.gameDir, world), 'utf8')).toBe('original world');
  await writeFile(path.join(copy.gameDir, world), 'updated world');
  expect(await readFile(path.join(source.gameDir, world), 'utf8')).toBe('original world');
  await page.evaluate((id) => window.kjmcl.select({ instanceId: id }), source.id);
  await page.getByRole('button', { name: '游戏实例', exact: true }).click();
  const online = await onlinePreview(page);
  expect(await instances(page)).toHaveLength(2);
  await online.getByText('用已有存档试更', { exact: true }).click();
  await selectLauncherOption(page, '存档来源', source.id);
  await online.getByRole('button', { name: '创建试更副本' }).click();
  await expect
    .poll(async () => (await instances(page)).find((i) => i.name === '在线试更')?.status, {
      timeout: 30000,
    })
    .toBe('ready');
  const final = await instances(page),
    fresh = final.find((i) => i.name === '在线试更');
  expect(fresh.version).toBe('1.21.2');
  expect(final.find((i) => i.id === source.id).version).toBe('1.21.1');
  expect(await readFile(path.join(fresh.gameDir, world), 'utf8')).toBe('original world');
  expect(errors).toEqual([]);
  console.log(
    'PASS desktop pack preview, failed required download, restart and resume without original archive, override priority, separate version trial, public cross-version pack search, preview and confirmed pack trial with preserved world (isolated HTTP fixtures)',
  );
} finally {
  if (app) await app.close();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
