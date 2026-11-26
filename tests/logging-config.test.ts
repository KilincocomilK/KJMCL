import { afterEach, expect, it, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/core/store';
import { Minecraft } from '../electron/core/minecraft';
import { Network } from '../electron/core/network';
import { GameFolders } from '../electron/core/game-folders';
import { atomicJson, exists } from '../electron/core/files';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kjmcl-logging-test-')));
  roots.push(root);
  const store = new Store(path.join(root, 'KJMCL'));
  const game = path.join(root, '.minecraft');
  const net = new Network(() => store.data.settings);
  const mc = new Minecraft(store, net);
  const bytes = Buffer.from('<Configuration status="WARN"/>');
  const hash = createHash('sha1').update(bytes).digest('hex');
  const name = 'client-1.21.2.xml';
  const object = '/v1/objects/' + hash + '/' + name;
  const mirror = 'https://bmclapi2.bangbang93.com' + object;
  const cdn = 'https://piston-data.mojang.com' + object;
  const alternate = 'https://launcher.mojang.com' + object;
  const dir = path.join(game, 'versions', '1.21.11');
  await atomicJson(path.join(dir, '1.21.11.json'), {
    id: '1.21.11',
    type: 'release',
    mainClass: 'example.Main',
    libraries: [],
    logging: {
      client: {
        argument: '-Dlog4j.configurationFile=${path}',
        file: { id: name, size: bytes.length, sha1: hash, url: mirror },
      },
    },
  });
  await writeFile(path.join(dir, '1.21.11.jar'), 'fixture client');
  await atomicJson(path.join(game, 'versions/1.21.11-Fabric/1.21.11-Fabric.json'), {
    id: '1.21.11-Fabric',
    inheritsFrom: '1.21.11',
    mainClass: 'fabric.Main',
    libraries: [],
  });
  const folders = new GameFolders(store);
  const scan = await folders.scan(game);
  await folders.add({ selectionId: scan.selectionId, name: '旧目录', layouts: [] });
  const instance = store.data.instances.find((i) => i.external?.versionId === '1.21.11-Fabric')!;
  const { version } = await mc.resolved(instance.id);
  const resolve = (signal = new AbortController().signal) =>
    mc.ensureLogging(instance.id, version, signal);
  return {
    root,
    store,
    game,
    net,
    mc,
    instance,
    bytes,
    hash,
    name,
    mirror,
    cdn,
    alternate,
    resolve,
    version,
  };
}

it('resolves inherited loader metadata containing a mirror URL and fails over after both a 404 and a transport failure', async () => {
  const f = await fixture();
  const response = vi.spyOn(f.net, 'response').mockImplementation(async (url) => {
    if (url === f.mirror) return new Response(null, { status: 404 }) as any;
    if (url === f.cdn) throw new TypeError('fetch failed');
    if (url === f.alternate) return new Response(f.bytes) as any;
    throw new Error('Unexpected test URL');
  });
  const result = await f.resolve();
  expect(await readFile(result!)).toEqual(f.bytes);
  expect(response.mock.calls.map(([u]) => u)).toEqual([f.mirror, f.cdn, f.alternate]);
  expect(await exists(path.join(f.game, 'assets'))).toBe(false);
  await f.resolve();
  expect(response).toHaveBeenCalledTimes(3);
});

it('recovers an identical renamed XML offline and rejects unverified same-name or same-size files', async () => {
  const f = await fixture();
  const response = vi.spyOn(f.net, 'response').mockRejectedValue(new TypeError('fetch failed'));
  const folder = path.join(f.game, 'assets', 'log_configs');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, f.name), Buffer.alloc(f.bytes.length, 1));
  await writeFile(path.join(folder, 'other.xml'), Buffer.alloc(f.bytes.length, 2));
  await writeFile(path.join(folder, 'renamed.xml'), f.bytes);
  const pathInCache = await f.resolve();
  expect(await readFile(pathInCache!)).toEqual(f.bytes);
  expect(await readFile(path.join(folder, f.name))).toEqual(Buffer.alloc(f.bytes.length, 1));
  expect(response).not.toHaveBeenCalled();
  await rm(pathInCache!);
  await rm(path.join(folder, 'renamed.xml'));
  f.store.data.settings.source = 'official';
  await expect(f.resolve()).rejects.toThrow('无法连接下载源 · launcher.mojang.com');
  expect(response.mock.calls.map(([url]) => url)).toEqual([f.cdn, f.alternate]);
});

it('rejects damaged mirror and official payloads, and cancellation stops all subsequent source attempts', async () => {
  const f = await fixture();
  const response = vi
    .spyOn(f.net, 'response')
    .mockImplementation(async () => new Response(Buffer.alloc(f.bytes.length)) as any);
  await expect(f.resolve()).rejects.toThrow('哈希校验失败');
  const folder = path.join(f.store.root, 'cache', 'log-configs');
  expect(await readdir(folder)).toEqual([]);
  expect(response.mock.calls.slice(0, 3).map(([url]) => url)).toEqual([
    f.mirror,
    f.cdn,
    f.alternate,
  ]);
  response.mockClear();
  const controller = new AbortController();
  response.mockImplementation(async () => {
    controller.abort(new Error('停止测试'));
    throw new TypeError('fetch failed');
  });
  await expect(f.resolve(controller.signal)).rejects.toThrow('停止测试');
  expect(response).toHaveBeenCalledTimes(1);
});

it('rejects links in the active logging directory and malformed metadata before any network access', async () => {
  const f = await fixture();
  const response = vi.spyOn(f.net, 'response');
  await mkdir(path.join(f.game, 'assets'));
  await symlink(
    f.root,
    path.join(f.game, 'assets', 'log_configs'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(f.resolve()).rejects.toThrow('链接');
  f.version.logging!.client.file.sha1 = undefined;
  await expect(f.resolve()).rejects.toThrow('元数据无效');
  expect(response).not.toHaveBeenCalled();
});

it('does not accept a cached digest when the declared size is inconsistent', async () => {
  const f = await fixture();
  f.version.logging!.client.file.size = f.bytes.length + 1;
  const dest = path.join(f.store.root, 'cache/log-configs', f.hash + '.xml');
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, f.bytes);
  const response = vi
    .spyOn(f.net, 'response')
    .mockImplementation(async () => new Response(f.bytes) as any);
  await expect(f.resolve()).rejects.toThrow('文件大小校验失败');
  expect(response).toHaveBeenCalled();
  expect(await readFile(dest)).toEqual(f.bytes);
});

it.runIf(process.env.KJMCL_VERIFY_MOJANG_LOG === '1')(
  'fetches the exact upstream 1.21.11 XML through managed installation and imported Fabric launch preparation',
  async () => {
    const f = await fixture();
    const signal = new AbortController().signal;
    const metaHash = '673208434aebac19a7317e40f6b1588169e4e1f1';
    const metadataUrl = 'https://piston-meta.mojang.com/v1/packages/' + metaHash + '/1.21.11.json';
    const metadataFile = path.join(f.root, 'official.json');
    f.store.data.settings.source = 'official';
    await f.net.download(metadataUrl, metadataFile, { signal, hash: metaHash });
    const metadata = JSON.parse(await readFile(metadataFile, 'utf8'));
    const file = metadata.logging.client.file;
    expect(file).toMatchObject({
      id: 'client-1.21.2.xml',
      sha1: '39384bd14c0606d812afec88d8aff595b2587dd9',
      size: 1073,
    });
    f.store.data.settings.source = 'bmclapi';
    const id = 'new-1.21.11';
    f.store.data.instances.push({
      ...f.instance,
      id,
      gameDir: path.join(f.store.root, 'instances', id),
      external: undefined,
      loader: 'vanilla',
      status: 'empty',
    });
    const tiny = (data: string, name: string) => ({
      url: 'https://fixture.test/' + name,
      sha1: createHash('sha1').update(data).digest('hex'),
      size: Buffer.byteLength(data),
    });
    const index = '{"objects":{}}';
    // Exercise normal installation with the live Mojang logging descriptor. Other artifacts are fixtures.
    vi.spyOn(f.mc, 'metadata').mockResolvedValue({
      ...metadata,
      libraries: [],
      downloads: { client: tiny('fixture', 'client') },
      assetIndex: { ...tiny(index, 'index'), id: 'empty' },
    });
    const realResponse = f.net.response.bind(f.net);
    vi.spyOn(f.net, 'response').mockImplementation((url, ...args) =>
      url.startsWith('https://fixture.test/')
        ? Promise.resolve(new Response(url.endsWith('/index') ? index : 'fixture') as any)
        : realResponse(url, ...args),
    );
    await f.mc.install(id, { signal, progress: () => {} });
    const installed = path.join(f.store.runtime(id), 'assets', 'log_configs', file.id);
    expect(
      createHash('sha1')
        .update(await readFile(installed))
        .digest('hex'),
    ).toBe(file.sha1);
    await rm(installed); // Force a second network fetch through the imported version's launch path.
    const parent = path.join(f.game, 'versions/1.21.11/1.21.11.json');
    const imported = JSON.parse(await readFile(parent, 'utf8'));
    imported.logging = structuredClone(metadata.logging);
    imported.logging.client.file.url = f.net.url(file.url);
    await atomicJson(parent, imported);
    const { version } = await f.mc.resolved(f.instance.id);
    const prepared = await f.mc.ensureLogging(f.instance.id, version, signal);
    expect(
      createHash('sha1')
        .update(await readFile(prepared!))
        .digest('hex'),
    ).toBe(file.sha1);
    expect(await exists(path.join(f.game, 'assets'))).toBe(false);
  },
  60000,
);
