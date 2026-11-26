import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '../electron/core/store';
import { Minecraft, type Version } from '../electron/core/minecraft';
import { Packs } from '../electron/core/packs';
import { Network } from '../electron/core/network';
import { Tasks } from '../electron/core/tasks';
import { exists } from '../electron/core/files';
import { CurseForge } from '../electron/core/curseforge';

const roots: string[] = [];
const sha = (value: string) => createHash('sha1').update(value).digest('hex');
const ctx = () => ({ signal: new AbortController().signal, progress: vi.fn() });
const host = 'https://pack.example/';
const asset = 'asset bytes',
  assetPath = sha(asset).slice(0, 2) + '/' + sha(asset);
const index = JSON.stringify({
  objects: { 'sound/test': { size: asset.length, hash: sha(asset) } },
});
const payloads: Record<string, string> = {
  client: 'client jar',
  index,
  library: 'base library',
  first: 'first mod',
  second: 'second mod',
  extra: 'optional mod',
  [assetPath]: asset,
};
const artifact = (name: string) => ({
  url: host + name,
  size: payloads[name].length,
  sha1: sha(payloads[name]),
});
const version: Version = {
  id: '1.21.1',
  type: 'release',
  mainClass: 'example.Main',
  downloads: { client: artifact('client') },
  assetIndex: { id: 'demo', ...artifact('index') },
  libraries: [
    {
      name: 'example:library:1',
      downloads: { artifact: { ...artifact('library'), path: 'demo/lib.jar' } },
    },
  ],
};
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
async function tmp() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-packs-'));
  roots.push(root);
  return root;
}
const row = (
  name: string,
  path = 'mods/' + name + '.jar',
  client: 'required' | 'optional' | 'unsupported' = 'required',
) => ({
  path,
  env: { client },
  hashes: { sha1: sha(payloads[name] ?? name) },
  fileSize: (payloads[name] ?? name).length,
  downloads: [host + name],
});
function mr(files: ReturnType<typeof row>[], overrides: Record<string, string> = {}) {
  const zip = new AdmZip();
  zip.addFile(
    'modrinth.index.json',
    Buffer.from(
      JSON.stringify({
        formatVersion: 1,
        game: 'minecraft',
        name: 'Resume',
        dependencies: { minecraft: '1.21.1' },
        files,
      }),
    ),
  );
  for (const [name, data] of Object.entries(overrides)) zip.addFile(name, Buffer.from(data));
  return zip;
}
function service(
  root: string,
  extra?: {
    prepare?: ConstructorParameters<typeof Packs>[6];
    restore?: ConstructorParameters<typeof Packs>[7];
  },
) {
  const store = new Store(path.join(root, 'data'));
  store.data.settings.source = 'official';
  store.data.settings.concurrency = 1;
  const net = new Network(() => store.data.settings),
    mc = new Minecraft(store, net),
    tasks = new Tasks(() => {});
  const responses = vi.spyOn(net, 'response').mockImplementation(async (url) => {
    const key = url.startsWith(host)
      ? url.slice(host.length)
      : url.replace('https://resources.download.minecraft.net/', '');
    if (!(key in payloads)) throw new Error('Unexpected request: ' + url);
    return new Response(payloads[key]) as any;
  });
  const metadata = vi
    .spyOn(mc, 'metadata')
    .mockImplementation(async () => structuredClone(version));
  const cf = new CurseForge(store, net, {
    get: async () => '',
    set: async () => {},
    has: async () => false,
  });
  const packs = new Packs(
    store,
    mc,
    net,
    tasks,
    (v) => {
      const id = randomUUID();
      store.data.instances.push({
        ...v,
        id,
        status: 'empty',
        createdAt: 0,
        playTime: 0,
        memoryMb: 2048,
        javaPath: '',
        jvmArgs: [],
        width: 1280,
        height: 720,
      });
      store.save();
      return id;
    },
    cf,
    extra?.prepare,
    extra?.restore,
  );
  return { store, net, mc, tasks, packs, metadata, responses, cf };
}
it('previews the client plan, resumes its original selection and rechecks missing base resources after restart', async () => {
  const root = await tmp(),
    file = path.join(root, 'sample.mrpack');
  const zip = mr(
    [
      row('first'),
      row('second'),
      row('extra', undefined, 'optional'),
      row('omit', undefined, 'optional'),
      row('server', undefined, 'unsupported'),
      row('shadow', 'config/layer.toml'),
    ],
    {
      'client-overrides/config/layer.toml': 'client',
      'overrides/config/layer.toml': 'common',
      'overrides/kubejs/client_scripts/test.js': 'script',
      'overrides/Distant_Horizons_server_data/custom.json': 'custom',
      'overrides/root-config.ts': 'custom script',
      'server-overrides/config/client.toml': 'server',
      'README.md': 'description',
    },
  );
  await zip.writeZipPromise(file);
  const a = service(root);
  const plan = await a.packs.preview(file);
  expect(a.store.data.instances).toHaveLength(0);
  expect(plan.items.filter((i) => i.kind === 'optional').map((i) => i.label)).toEqual([
    'mods/extra.jar',
    'mods/omit.jar',
  ]);
  expect(plan.items.filter((i) => i.kind === 'skipped').map((i) => i.label)).toEqual(
    expect.arrayContaining([
      'config/layer.toml',
      'mods/server.jar',
      'README.md',
      'server-overrides/config/client.toml',
    ]),
  );
  const download = a.net.download.bind(a.net);
  vi.spyOn(a.net, 'download').mockImplementation(async (url, target, work) => {
    if (url === host + 'second') throw new Error('fixture interrupted');
    return download(url, target, work);
  });
  const id = await a.packs.confirm({ token: plan.token, optional: ['mr:mods/extra.jar'] });
  await vi.waitFor(() => expect(a.tasks.items[0].status).toBe('failed'));
  const instance = a.store.instance(id),
    game = a.store.dir(id);
  expect(instance.status).toBe('error');
  expect(instance.packInstall?.phase).toBe('files');
  expect(await readFile(path.join(game, 'mods/first.jar'), 'utf8')).toBe(payloads.first);
  await rm(file);
  await rm(path.join(a.store.runtime(id), 'libraries/demo/lib.jar'));
  await rm(path.join(a.store.runtime(id), 'assets/objects', assetPath));
  const b = service(root);
  b.metadata.mockRejectedValue(new Error('metadata offline'));
  await b.packs.install(id, ctx());
  expect(b.metadata).not.toHaveBeenCalled();
  expect(b.responses.mock.calls.map(([u]) => u)).toEqual(
    expect.arrayContaining([
      host + 'library',
      'https://resources.download.minecraft.net/' + assetPath,
      host + 'extra',
      host + 'second',
    ]),
  );
  expect(b.responses.mock.calls.map(([u]) => u)).not.toContain(host + 'first');
  expect(b.store.data.instances).toHaveLength(1);
  expect(b.store.instance(id)).toMatchObject({
    status: 'ready',
    packInstall: { phase: 'complete' },
  });
  for (const [name, value] of Object.entries({
    'config/layer.toml': 'client',
    'mods/extra.jar': payloads.extra,
    'kubejs/client_scripts/test.js': 'script',
    'Distant_Horizons_server_data/custom.json': 'custom',
    'root-config.ts': 'custom script',
  }))
    expect(await readFile(path.join(game, name), 'utf8')).toBe(value);
  for (const missing of ['mods/omit.jar', 'mods/server.jar', 'config/client.toml'])
    expect(await exists(path.join(game, missing))).toBe(false);
  await writeFile(path.join(game, 'config/layer.toml'), 'player change');
  await rm(path.join(game, 'client.jar'));
  b.metadata.mockResolvedValue(version);
  await b.packs.install(id, ctx());
  expect(await readFile(path.join(game, 'client.jar'), 'utf8')).toBe(payloads.client);
  expect(await readFile(path.join(game, 'config/layer.toml'), 'utf8')).toBe('player change');
});
it('blocks required protected files and detects archive changes before creating an instance', async () => {
  const root = await tmp(),
    file = path.join(root, 'sample.mrpack'),
    { packs, store } = service(root);
  await mr([row('first', 'version.json')], {
    'overrides/setup.cmd': 'command',
    'overrides/.kjmcl-owner.json': 'owner',
  }).writeZipPromise(file);
  const bad = await packs.preview(file);
  expect(bad.items.filter((i) => i.kind === 'blocked')).toHaveLength(3);
  await expect(packs.confirm({ token: bad.token, optional: [] })).rejects.toThrow('必需');
  await mr([]).writeZipPromise(file);
  const plan = await packs.preview(file);
  await expect(packs.confirm({ token: plan.token, optional: ['bad'] })).rejects.toThrow('可选项');
  await mr([row('first')]).writeZipPromise(file);
  await expect(packs.confirm({ token: plan.token, optional: [] })).rejects.toThrow('变化');
  expect(store.data.instances).toHaveLength(0);
});
it('resumes a trial with its original backups and refuses to replace missing pack data with vanilla', async () => {
  const root = await tmp(),
    file = path.join(root, 'sample.mrpack'),
    prepare = vi.fn().mockResolvedValue(['world-backup']),
    restore = vi
      .fn()
      .mockRejectedValueOnce(new Error('restore interrupted'))
      .mockResolvedValue(undefined);
  await mr([]).writeZipPromise(file);
  const a = service(root, { prepare, restore }),
    plan = await a.packs.preview(file),
    source = randomUUID();
  const id = await a.packs.confirm({ token: plan.token, optional: [], trialSourceId: source });
  await vi.waitFor(() => expect(a.tasks.items[0].status).toBe('failed'));
  const b = service(root, { prepare, restore });
  await b.packs.install(id, ctx());
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(restore.mock.calls.map((args) => args.slice(0, 3))).toEqual([
    [source, id, ['world-backup']],
    [source, id, ['world-backup']],
  ]);
  const i = b.store.instance(id),
    record = i.packInstall!;
  record.phase = 'files';
  const frozen = path.join(b.store.root, 'pack-archives', record.archive + '.zip');
  await writeFile(frozen, 'damaged');
  await expect(b.packs.install(id, ctx())).rejects.toThrow('校验失败');
  expect(i.status).toBe('error');
  await rm(frozen);
  await expect(b.packs.install(id, ctx())).rejects.toThrow('找不到');
  delete i.packInstall;
  i.error = '整合包导入未完成';
  await expect(b.packs.install(id, ctx())).rejects.toThrow('旧版');
  expect(b.metadata).not.toHaveBeenCalled();
});
it('resumes CurseForge from checked pins and refuses to finish without a committed required file', async () => {
  const root = await tmp(),
    file = path.join(root, 'cf.zip'),
    zip = new AdmZip();
  zip.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify({
        manifestType: 'minecraftModpack',
        manifestVersion: 1,
        name: 'Curse pack',
        minecraft: { version: '1.21.1', modLoaders: [] },
        files: [
          { projectID: 1, fileID: 10, required: true },
          { projectID: 2, fileID: 20, required: true },
          { projectID: 3, fileID: 30, required: false },
        ],
      }),
    ),
  );
  await zip.writeZipPromise(file);
  const fixtureFile = (project: number, id: number) => ({
    id,
    modId: project,
    fileDate: '2026-01-01',
    fileName: project + '.jar',
    fileLength: payloads[project === 1 ? 'first' : 'second'].length,
    hashes: [{ algo: 1, value: sha(payloads[project === 1 ? 'first' : 'second']) }],
    downloadUrl: host + (project === 1 ? 'first' : 'second'),
    gameVersions: ['1.21.1'],
    dependencies: [],
  });
  const a = service(root),
    plan = await a.packs.preview(file);
  const list = vi.spyOn(a.cf, 'file').mockImplementation(async (project, id) => {
    if (project === 2) throw new Error('fixture outage');
    return fixtureFile(project, id);
  });
  const id = await a.packs.confirm({ token: plan.token, optional: [] });
  await vi.waitFor(() => expect(a.tasks.items[0].status).toBe('failed'));
  expect(list.mock.calls).toEqual([
    [1, 10],
    [2, 20],
  ]);
  expect(a.store.instance(id).status).toBe('error');
  const b = service(root);
  vi.spyOn(b.cf, 'install').mockResolvedValueOnce();
  await expect(b.packs.install(id, ctx())).rejects.toThrow('未确认所选文件');
  expect(b.store.instance(id).status).toBe('error');
  const lookups = vi
    .spyOn(b.cf, 'file')
    .mockImplementation(async (project, id) => fixtureFile(project, id));
  await b.packs.install(id, ctx());
  expect(lookups.mock.calls).toEqual([[2, 20]]);
  expect(b.responses.mock.calls.map(([url]) => url)).toEqual([host + 'second']);
  expect(b.store.instance(id).status).toBe('ready');
});
