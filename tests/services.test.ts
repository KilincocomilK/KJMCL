import { it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { Store } from '../electron/core/store';
import { Network } from '../electron/core/network';
import { Minecraft } from '../electron/core/minecraft';
import { Mods } from '../electron/core/mods';
import { Packs } from '../electron/core/packs';
import { Tasks } from '../electron/core/tasks';
import { exists, hashFile } from '../electron/core/files';
const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { force: true, recursive: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-services-'));
  roots.push(root);
  const store = new Store(root);
  store.data.instances.push({
    id: 'test',
    name: 'Test',
    version: '1.21.1',
    loader: 'fabric',
    loaderVersion: '0.16.0',
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
  const net = new Network(() => store.data.settings);
  const ctx = { signal: new AbortController().signal, progress: vi.fn() };
  return { root, store, net, ctx };
}
it('installs a complete synthetic Minecraft artifact graph and reuses verified files', async () => {
  const { store, net, ctx } = await fixture();
  store.instance('test').loader = 'vanilla';
  const mc = new Minecraft(store, net);
  const resource = Buffer.from('resource'),
    client = Buffer.from('client'),
    lib = Buffer.from('lib');
  const hash = (data: Buffer) => createHash('sha1').update(data).digest('hex');
  const assetIndex = Buffer.from(
    JSON.stringify({ objects: { 'test.txt': { hash: hash(resource), size: resource.length } } }),
  );
  const native = new AdmZip();
  native.addFile('native.dll', Buffer.from('native'));
  native.addFile('META-INF/MANIFEST.MF', Buffer.from('skip'));
  const nativeData = native.toBuffer();
  const nativeName =
    process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  const artifact = (name: string, b: Buffer) => ({
    url: 'https://fixture.test/' + name,
    sha1: hash(b),
    size: b.length,
    path: name,
  });
  const version = {
    id: '1.21.1',
    type: 'release',
    mainClass: 'Main',
    libraries: [
      { name: 'fixture:library:1', downloads: { artifact: artifact('lib.jar', lib) } },
      {
        name: 'fixture:native:1',
        downloads: { classifiers: { native: artifact('native.jar', nativeData) } },
        natives: { [nativeName]: 'native' },
      },
    ],
    downloads: { client: artifact('client.jar', client) },
    assetIndex: { ...artifact('index.json', assetIndex), id: 'test' },
    arguments: { game: ['--username', '${auth_player_name}'] },
  };
  const metadata = Buffer.from(JSON.stringify(version));
  const data: Record<string, Buffer> = {
    'version.json': metadata,
    'client.jar': client,
    'lib.jar': lib,
    'native.jar': nativeData,
    'index.json': assetIndex,
    [hash(resource)]: resource,
  };
  vi.spyOn(net, 'json').mockResolvedValue({
    versions: [{ id: '1.21.1', url: 'https://fixture.test/version.json', sha1: hash(metadata) }],
  });
  const response = vi
    .spyOn(net, 'response')
    .mockImplementation(
      async (url) => new Response(new Uint8Array(data[url.split('/').at(-1)!])) as any,
    );
  await mc.install('test', ctx);
  expect(store.instance('test').status).toBe('ready');
  expect(await readFile(path.join(store.dir('test'), 'natives/native.dll'), 'utf8')).toBe('native');
  expect(await exists(path.join(store.dir('test'), 'natives/META-INF/MANIFEST.MF'))).toBe(false);
  const calls = response.mock.calls.length;
  await mc.install('test', ctx);
  expect(response.mock.calls.length).toBe(calls);
});
it('failed installation is retryable and never becomes ready', async () => {
  const { store, net, ctx } = await fixture();
  const mc = new Minecraft(store, net);
  vi.spyOn(mc, 'metadata').mockRejectedValue(new Error('fixture offline'));
  await expect(mc.install('test', ctx)).rejects.toThrow('fixture offline');
  expect(store.instance('test').status).toBe('error');
  expect(new Store(store.root).instance('test').error).toBe('fixture offline');
});
it('never commits downloaded content with the wrong digest', async () => {
  const { root, net, ctx } = await fixture();
  vi.spyOn(net, 'response').mockImplementation(async () => new Response('bad') as any);
  const dest = path.join(root, 'file.jar');
  await expect(
    net.download('https://fixture.test/file.jar', dest, {
      signal: ctx.signal,
      hash: '0'.repeat(40),
    }),
  ).rejects.toThrow('哈希');
  expect(await exists(dest)).toBe(false);
  expect(await exists(dest + '.part')).toBe(false);
});
it('resolves required Modrinth dependencies and preserves disabled state during updates', async () => {
  const { store, net, ctx } = await fixture(),
    mods = new Mods(store, net);
  let latest = 'a1';
  const bytes = (id: string) => Buffer.from(id);
  const version = (id: string, project: string, dependencies: any[] = []) => ({
    id,
    project_id: project,
    game_versions: ['1.21.1'],
    loaders: ['fabric'],
    dependencies,
    files: [
      {
        filename: project + '-' + id + '.jar',
        url: 'https://fixture.test/' + id,
        hashes: { sha512: createHash('sha512').update(bytes(id)).digest('hex') },
        size: bytes(id).length,
        primary: true,
      },
    ],
  });
  vi.spyOn(net, 'json').mockImplementation(async (url) => {
    if (url.includes('/project/main/'))
      return [version(latest, 'main', [{ dependency_type: 'required', project_id: 'dep' }])] as any;
    if (url.includes('/project/dep/')) return [version('d1', 'dep')] as any;
    throw new Error(url);
  });
  vi.spyOn(net, 'response').mockImplementation(
    async (url) => new Response(bytes(url.split('/').at(-1)!)) as any,
  );
  await mods.install('test', 'main', ctx);
  expect((await mods.list('test')).length).toBe(2);
  await mods.toggle('test', 'main-a1.jar');
  latest = 'a2';
  await mods.update('test', ctx);
  expect((await mods.list('test')).find((m) => m.projectId === 'main')).toMatchObject({
    name: 'main-a2.jar.disabled',
    enabled: false,
    versionId: 'a2',
  });
  expect(await exists(path.join(mods.dir('test'), 'main-a1.jar.disabled'))).toBe(false);
});
it('exports portable content without credentials, worlds or executable caches', async () => {
  const { root, store, net } = await fixture(),
    dir = store.dir('test');
  await mkdir(path.join(dir, 'mods'), { recursive: true });
  await writeFile(path.join(dir, 'mods/test.jar'), 'mod');
  await writeFile(path.join(dir, 'client.jar'), 'excluded');
  const packs = new Packs(store, new Minecraft(store, net), net, new Tasks(() => {}), () => {
    throw new Error('unused');
  });
  const output = path.join(root, 'export.zip');
  await packs.export('test', output);
  const names = new AdmZip(output).getEntries().map((e) => e.entryName);
  expect(names).toContain('kjmcl-instance.json');
  expect(names).toContain('overrides/mods/test.jar');
  expect(names).not.toContain('client.jar');
  expect(names.some((n) => n.includes('credentials'))).toBe(false);
});
