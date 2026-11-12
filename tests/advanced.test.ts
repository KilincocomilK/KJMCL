import { it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  symlink,
  realpath,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { Store } from '../electron/core/store';
import { Network } from '../electron/core/network';
import {
  Instances,
  Backups,
  claimDirectory,
  assertOwned,
  contains,
} from '../electron/core/instances';
import { Forge, forgeCoordinate } from '../electron/core/forge';
import { Yggdrasil, authRoot } from '../electron/core/yggdrasil';
import { CurseForge, type CFFile } from '../electron/core/curseforge';
import { Publishing } from '../electron/core/publishing';
import { archiveWorld, restoreWorld } from '../electron/core/archives';
import { Auth } from '../electron/core/auth';
import { clientVersion } from '../electron/core/client-version';
import { Minecraft } from '../electron/core/minecraft';
import { Packs } from '../electron/core/packs';
import { Tasks } from '../electron/core/tasks';
import { Skins, validateSkin } from '../electron/core/skins';
import { atomicJson, exists, hashFile } from '../electron/core/files';
import type { Instance, PackOptions } from '../shared/types';
import type { Secrets } from '../electron/core/vault';
const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});
class MemorySecrets implements Secrets {
  data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k);
  }
  async set(k: string, v: string) {
    this.data.set(k, v);
  }
  async has(k: string) {
    return this.data.has(k);
  }
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-v2-'));
  roots.push(root);
  const store = new Store(path.join(root, 'data')),
    net = new Network(() => store.data.settings),
    vault = new MemorySecrets(),
    ctx = { signal: new AbortController().signal, progress: vi.fn() };
  const add = (id: string, dir?: string) => {
    const gameDir = claimDirectory(store, dir ?? path.join(store.root, 'instances', id), id);
    const i: Instance = {
      id,
      name: id,
      gameDir,
      version: '1.21.1',
      loader: 'fabric',
      loaderVersion: '0.16.0',
      status: 'ready',
      createdAt: 0,
      playTime: 10,
      memoryMb: 2048,
      javaPath: '',
      jvmArgs: [],
      width: 1280,
      height: 720,
    };
    store.data.instances.push(i);
    store.save();
    return i;
  };
  return { root, store, net, vault, ctx, add };
}
it('migrates v1 without losing directories or the original backup', async () => {
  const { store, add } = await fixture();
  add('source');
  const v1 = JSON.parse(await readFile(path.join(store.root, 'state.json'), 'utf8'));
  v1.schemaVersion = 1;
  delete v1.instances[0].gameDir;
  await atomicJson(path.join(store.root, 'state.json'), v1);
  const migrated = new Store(store.root);
  expect(migrated.data.schemaVersion).toBe(5);
  expect(migrated.dir('source')).toBe(path.join(store.root, 'instances/source'));
  expect(
    JSON.parse(await readFile(path.join(store.root, 'state.json.v1.bak'), 'utf8')).schemaVersion,
  ).toBe(1);
});
it('claims custom empty directories and blocks overlap and nonempty destinations', async () => {
  const { root, store, add } = await fixture();
  const i = add('source', path.join(root, 'custom'));
  await assertOwned(store, i.id);
  expect(() => claimDirectory(store, store.root, 'other')).toThrow();
  expect(() => claimDirectory(store, path.join(i.gameDir!, 'nested'), 'other')).toThrow();
  await mkdir(path.join(root, 'occupied'));
  await writeFile(path.join(root, 'occupied', 'keep.txt'), 'keep');
  expect(() => claimDirectory(store, path.join(root, 'occupied'), 'other')).toThrow('空目录');
  await atomicJson(path.join(i.gameDir!, '.kjmcl-owner.json'), { app: 'other', id: 'source' });
  await expect(assertOwned(store, 'source')).rejects.toThrow('所有权');
  expect(contains('/game/a', '/game/ab')).toBe(false);
});
it('clones content independently with optional worlds and unique ownership', async () => {
  const { store, ctx, add } = await fixture();
  const a = add('a'),
    b = add('b'),
    c = add('c');
  await mkdir(path.join(a.gameDir!, 'saves/world'), { recursive: true });
  await mkdir(path.join(a.gameDir!, 'mods'));
  await writeFile(path.join(a.gameDir!, 'saves/world/level.dat'), 'world');
  await writeFile(path.join(a.gameDir!, 'mods/test.jar'), 'mod');
  const service = new Instances(store);
  await service.clone('a', 'b', false, ctx);
  await service.clone('a', 'c', true, ctx);
  expect(await exists(path.join(b.gameDir!, 'saves'))).toBe(false);
  expect(await readFile(path.join(c.gameDir!, 'saves/world/level.dat'), 'utf8')).toBe('world');
  await writeFile(path.join(b.gameDir!, 'mods/test.jar'), 'changed');
  expect(await readFile(path.join(a.gameDir!, 'mods/test.jar'), 'utf8')).toBe('mod');
  expect(JSON.parse(await readFile(path.join(b.gameDir!, '.kjmcl-owner.json'), 'utf8')).id).toBe(
    'b',
  );
});
it('relocates by copying and retains the old directory', async () => {
  const { root, store, ctx, add } = await fixture();
  const a = add('a');
  const old = a.gameDir!;
  await writeFile(path.join(old, 'options.txt'), 'settings');
  await new Instances(store).relocate('a', path.join(root, 'moved'), ctx);
  expect(await readFile(path.join(store.dir('a'), 'options.txt'), 'utf8')).toBe('settings');
  expect(await exists(path.join(old, 'options.txt'))).toBe(true);
  await assertOwned(store, 'a');
});
it('backs up and restores to a new world without overwriting a current world', async () => {
  const { store, ctx, add } = await fixture();
  const i = add('a');
  const world = path.join(i.gameDir!, 'saves/世界');
  await mkdir(world, { recursive: true });
  await writeFile(path.join(world, 'level.dat'), 'original');
  await writeFile(path.join(world, 'session.lock'), 'lock');
  const backups = new Backups(store);
  const id = await backups.create('a', '世界', ctx);
  await writeFile(path.join(world, 'level.dat'), 'current');
  await backups.restore('a', id, ctx);
  const worlds = await backups.worlds('a');
  expect(worlds).toHaveLength(2);
  const restored = worlds.find((w) => w.name !== '世界')!;
  expect(await readFile(path.join(i.gameDir!, 'saves', restored.name, 'level.dat'), 'utf8')).toBe(
    'original',
  );
  expect(await readFile(path.join(world, 'level.dat'), 'utf8')).toBe('current');
  expect(await exists(path.join(i.gameDir!, 'saves', restored.name, 'session.lock'))).toBe(false);
  expect(await backups.list('a')).toHaveLength(1);
});
it('indexes all versions in place and resolves inherited clients from the source', async () => {
  const { root, store, net } = await fixture();
  const source = path.join(root, 'old-minecraft');
  await mkdir(path.join(source, 'versions/base'), { recursive: true });
  await mkdir(path.join(source, 'versions/中文 Fabric'));
  await mkdir(path.join(source, 'libraries'));
  await mkdir(path.join(source, 'assets'));
  await mkdir(path.join(source, 'saves/world'), { recursive: true });
  await atomicJson(path.join(source, 'versions/base/base.json'), {
    id: '1.21.1',
    type: 'release',
    mainClass: 'Main',
    libraries: [],
    arguments: { game: ['--username', '${auth_player_name}'] },
  });
  await writeFile(path.join(source, 'versions/base/base.jar'), 'client');
  await atomicJson(path.join(source, 'versions/中文 Fabric/中文 Fabric.json'), {
    id: '中文 Fabric',
    inheritsFrom: 'base',
    type: 'release',
    mainClass: 'net.fabricmc.Main',
    libraries: [],
  });
  await writeFile(path.join(source, 'saves/world/level.dat'), 'original');
  const service = new Instances(store).folders,
    scan = await service.scan(source);
  const folderId = await service.add({
    selectionId: scan.selectionId,
    name: '外部游戏',
    layouts: [],
  });
  const i = store.data.instances.find((i) => i.external?.versionId === '中文 Fabric')!;
  expect(store.data.instances).toHaveLength(2);
  expect(i.external?.folderId).toBe(folderId);
  expect(i.status).toBe('ready');
  expect(i.version).toBe('1.21.1');
  expect(i.loader).toBe('fabric');
  const original = await realpath(source);
  expect(store.runtime(i.id)).toBe(original);
  expect(i.gameDir).toBe(original);
  expect((await new Minecraft(store, net).resolved(i.id)).client).toBe(
    path.join(original, 'versions/base/base.jar'),
  );
  expect(await exists(path.join(store.root, 'instances', i.id))).toBe(false);
  expect(await exists(path.join(source, '.kjmcl-owner.json'))).toBe(false);
  expect(await readFile(path.join(source, 'saves/world/level.dat'), 'utf8')).toBe('original');
});
it('resolves Forge and NeoForge Maven metadata without confusing Minecraft versions', async () => {
  const { store, net } = await fixture();
  const forge = new Forge(store, net);
  vi.spyOn(net, 'response').mockImplementation(
    async () =>
      new Response(
        '<metadata><version>1.21.1-52.0.1</version><version>1.20.1-47.0.0</version><version>21.1.1</version><version>21.0.1</version></metadata>',
      ) as any,
  );
  expect(await forge.versions('1.21.1', 'forge')).toEqual(['1.21.1-52.0.1']);
  expect(await forge.versions('1.21.1', 'neoforge')).toEqual(['21.1.1']);
  expect(forgeCoordinate('forge', '1.21.1', '52.0.1').version).toBe('1.21.1-52.0.1');
  expect(forgeCoordinate('neoforge', '1.20.1', '1.20.1-47.1.1').artifact).toBe('forge');
});
it('keeps Yggdrasil credentials out of state and binds profile switching', async () => {
  const { store, net, vault } = await fixture(),
    first = { id: 'a'.repeat(32), name: 'First' },
    second = { id: 'b'.repeat(32), name: 'Second' };
  const request = vi.spyOn(net, 'json').mockImplementation(async (url, options) => {
    if (url.endsWith('/authenticate'))
      return {
        accessToken: 'secret-access',
        clientToken: 'secret-client',
        availableProfiles: [first, second],
      } as any;
    const data = JSON.parse(options!.body as string);
    return {
      accessToken: 'refreshed',
      clientToken: 'secret-client',
      selectedProfile: data.selectedProfile,
    } as any;
  });
  const ygg = new Yggdrasil(store, net, vault);
  const choices = await ygg.login('https://auth.example/api/yggdrasil/', 'user', 'secret-password');
  expect(choices).toHaveLength(2);
  expect(JSON.stringify(store.data)).not.toContain('secret');
  await ygg.select(choices[0].id, second.id);
  expect(store.data.accounts[0].name).toBe('Second');
  expect(request.mock.calls[0][1]?.redirect).toBe('error');
  expect(() => authRoot('http://auth.example')).toThrow();
  expect(() => authRoot('https://user:pass@auth.example')).toThrow();
});
it('requires CurseForge credentials and respects disabled distribution', async () => {
  const { store, net, vault, ctx, add } = await fixture();
  add('a');
  const cf = new CurseForge(store, net, vault);
  await expect(cf.search('a', 'mod', 0)).rejects.toThrow('API Key');
  await vault.set('curseforge', 'fixture-key');
  vi.spyOn(net, 'json').mockResolvedValue({
    data: [
      {
        id: 1,
        modId: 2,
        fileName: 'mod.jar',
        fileDate: '2026-01-01',
        gameVersions: ['1.21.1'],
        downloadUrl: null,
        dependencies: [],
        hashes: [{ algo: 1, value: '0'.repeat(40) }],
      },
    ],
  });
  await expect(cf.install('a', 2, ctx)).rejects.toThrow('作者未允许');
});
it('installs CurseForge dependencies with digests and a distinct lockfile', async () => {
  const { store, net, vault, ctx, add } = await fixture();
  add('a');
  await vault.set('curseforge', 'key');
  const cf = new CurseForge(store, net, vault);
  const file = (project: number): CFFile => ({
    id: project * 10,
    modId: project,
    fileName: project + '.jar',
    downloadUrl: 'https://fixture.test/' + project,
    fileLength: 1,
    fileDate: '2026-01-01',
    gameVersions: ['1.21.1'],
    hashes: [{ algo: 1, value: createHash('sha1').update(String(project)).digest('hex') }],
    dependencies: project === 1 ? [{ modId: 2, relationType: 3 }] : [],
  });
  vi.spyOn(net, 'json').mockImplementation(
    async (url) => ({ data: [file(url.includes('/mods/1/') ? 1 : 2)] }) as any,
  );
  vi.spyOn(net, 'response').mockImplementation(
    async (url) => new Response(url.split('/').at(-1)) as any,
  );
  await cf.install('a', 1, ctx);
  expect(await cf.lock('a')).toHaveLength(2);
  expect(await readFile(path.join(store.dir('a'), 'mods/2.jar'), 'utf8')).toBe('2');
});
it('exports standard mrpack content and rejects changed or repeated publication', async () => {
  const { root, store, net, vault, add } = await fixture();
  const i = add('a');
  await mkdir(path.join(i.gameDir!, 'config'));
  await writeFile(path.join(i.gameDir!, 'config/game.toml'), 'enabled=true');
  await writeFile(path.join(i.gameDir!, 'options.txt'), 'private');
  const publishing = new Publishing(store, net, vault, new CurseForge(store, net, vault)),
    options: PackOptions = {
      id: 'a',
      format: 'mrpack',
      name: 'Pack',
      version: '1.0',
      author: 'Test',
      summary: '',
    };
  const file = path.join(root, 'pack.mrpack');
  const review = await publishing.prepare(options, file);
  const zip = new AdmZip(file);
  expect(zip.getEntry('modrinth.index.json')).toBeTruthy();
  expect(zip.getEntries().map((e) => e.entryName)).toEqual(
    expect.arrayContaining(['overrides/config/game.toml']),
  );
  expect(zip.getEntry('options.txt')).toBeNull();
  await vault.set('modrinth', 'secret');
  await writeFile(file, 'tampered');
  await expect(publishing.publish(review.ticket, 'project', '', 'release')).rejects.toThrow('变化');
  const second = await publishing.prepare(options, file);
  vi.spyOn(net, 'json').mockResolvedValue({ id: 'project', slug: 'pack', project_type: 'modpack' });
  const post = vi
    .spyOn(net, 'response')
    .mockResolvedValue(new Response(JSON.stringify({ id: 'version' })) as any);
  expect(await publishing.publish(second.ticket, 'project', '', 'release')).toContain(
    '/version/version',
  );
  await expect(publishing.publish(second.ticket, 'project', '', 'release')).rejects.toThrow('过期');
  expect(post).toHaveBeenCalledTimes(1);
});
it('validates PNG skin size and rejects foreign files', () => {
  const png = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.write('IHDR', 12);
  png.writeUInt32BE(64, 16);
  png.writeUInt32BE(64, 20);
  expect(validateSkin(png)).toEqual({ width: 64, height: 64 });
  png.writeUInt32BE(256, 16);
  expect(() => validateSkin(png)).toThrow('尺寸');
  expect(() => validateSkin(Buffer.from('not png'))).toThrow('PNG');
});

it('verifies backup digests before touching saved worlds', async () => {
  const { store, ctx, add } = await fixture();
  const i = add('a'),
    world = path.join(i.gameDir!, 'saves/world');
  await mkdir(world, { recursive: true });
  await writeFile(path.join(world, 'level.dat'), 'original');
  const backups = new Backups(store),
    id = await backups.create('a', 'world', ctx);
  await writeFile(path.join(store.root, 'backups/a', id + '.zip'), 'corrupt');
  await expect(backups.restore('a', id, ctx)).rejects.toThrow('校验');
  expect(await backups.worlds('a')).toHaveLength(1);
});
it('streams region files and aborts a backup without leaving a valid archive', async () => {
  const { root, ctx } = await fixture(),
    source = path.join(root, 'world'),
    zip = path.join(root, 'world.zip'),
    dest = path.join(root, 'restored');
  await mkdir(path.join(source, 'region'), { recursive: true });
  await writeFile(path.join(source, 'level.dat'), 'level');
  await writeFile(path.join(source, 'region/r.0.0.mca'), Buffer.alloc(8 * 1024 ** 2, 17));
  await archiveWorld(source, zip, ctx);
  await restoreWorld(zip, dest, ctx);
  expect(await hashFile(path.join(source, 'region/r.0.0.mca'))).toBe(
    await hashFile(path.join(dest, 'region/r.0.0.mca')),
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    archiveWorld(source, path.join(root, 'cancel.zip'), { ...ctx, signal: controller.signal }),
  ).rejects.toThrow();
  expect(await exists(path.join(root, 'cancel.zip'))).toBe(false);
});
it('rejects archive links and duplicate targets while restoring', async () => {
  const { root, ctx } = await fixture(),
    zip = new AdmZip();
  zip.addFile('link', Buffer.from('target'));
  zip.getEntry('link')!.attr = 0xa1ff0000;
  const file = path.join(root, 'unsafe.zip');
  await zip.writeZipPromise(file);
  await expect(restoreWorld(file, path.join(root, 'out'), ctx)).rejects.toThrow('符号链接');
});
it('validates an existing Yggdrasil token without rotating it', async () => {
  const { store, net, vault } = await fixture(),
    profile = { id: 'a'.repeat(32), name: 'Player' };
  const request = vi.spyOn(net, 'json').mockResolvedValue({
    accessToken: 'stable',
    clientToken: 'client',
    availableProfiles: [profile],
    selectedProfile: profile,
  });
  const validate = vi
    .spyOn(net, 'response')
    .mockImplementation(async () => new Response(null, { status: 204 }) as any);
  const ygg = new Yggdrasil(store, net, vault);
  await ygg.login('https://auth.example/api', 'user', 'password');
  expect(
    await Promise.all([ygg.token(store.data.accounts[0]), ygg.token(store.data.accounts[0])]),
  ).toEqual(['stable', 'stable']);
  expect(request).toHaveBeenCalledTimes(1);
  expect(validate).toHaveBeenCalledTimes(2);
});

it('imports a CurseForge manifest with exact dependency pins and exports a standard manifest', async () => {
  const { root, store, net, vault, add } = await fixture(),
    mc = new Minecraft(store, net),
    cf = new CurseForge(store, net, vault),
    tasks = new Tasks(() => {});
  vi.spyOn(mc, 'install').mockResolvedValue();
  const install = vi.spyOn(cf, 'install').mockResolvedValue();
  const zip = new AdmZip();
  zip.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify({
        manifestVersion: 1,
        manifestType: 'minecraftModpack',
        name: 'Neo Pack',
        minecraft: { version: '1.21.1', modLoaders: [{ id: 'neoforge-21.1.1', primary: true }] },
        files: [
          { projectID: 1, fileID: 10, required: true },
          { projectID: 2, fileID: 20, required: true },
        ],
        overrides: 'overrides',
      }),
    ),
  );
  zip.addFile('overrides/config/test.toml', Buffer.from('exact=true'));
  const source = path.join(root, 'cf.zip');
  await zip.writeZipPromise(source);
  const packs = new Packs(
    store,
    mc,
    net,
    tasks,
    (v) => {
      const i = add('imported');
      Object.assign(i, v);
      return i.id;
    },
    cf,
  );
  const id = await packs.import(source);
  await vi.waitFor(() => expect(tasks.items[0].status).toBe('completed'));
  expect(store.instance(id).loader).toBe('neoforge');
  expect(store.instance(id).loaderVersion).toBe('21.1.1');
  expect(install.mock.calls[0][4]).toEqual(
    new Map([
      [1, 10],
      [2, 20],
    ]),
  );
  const output = path.join(root, 'export.zip');
  await new Publishing(store, net, vault, cf).prepare(
    { id, format: 'curseforge', name: 'Neo Pack', version: '1', author: 'Test', summary: '' },
    output,
  );
  const manifest = JSON.parse(new AdmZip(output).getEntry('manifest.json')!.getData().toString());
  expect(manifest.minecraft.modLoaders[0].id).toBe('neoforge-21.1.1');
});
it('refreshes Microsoft skin profiles and sends authenticated uploads and resets', async () => {
  const { root, store, net, vault } = await fixture();
  store.data.accounts.push({
    id: 'account',
    kind: 'microsoft',
    name: 'Player',
    uuid: 'a'.repeat(32),
  });
  const auth = { token: vi.fn().mockResolvedValue('skin-token') } as unknown as Auth,
    ygg = new Yggdrasil(store, net, vault),
    skins = new Skins(store, net, auth, ygg);
  const png = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.write('IHDR', 12);
  png.writeUInt32BE(64, 16);
  png.writeUInt32BE(64, 20);
  const profile = {
    skins: [{ state: 'ACTIVE', url: 'https://textures.minecraft.net/texture/fixture' }],
  };
  vi.spyOn(net, 'json').mockResolvedValue(profile);
  const request = vi
    .spyOn(net, 'response')
    .mockImplementation(async (_url, options) =>
      options?.method === 'POST'
        ? (new Response(JSON.stringify(profile)) as any)
        : options?.method === 'DELETE'
          ? (new Response(null, { status: 204 }) as any)
          : (new Response(png) as any),
    );
  expect(await skins.preview('account')).toBe('data:image/png;base64,' + png.toString('base64'));
  const file = path.join(root, 'skin.png');
  await writeFile(file, png);
  await skins.upload('account', file, 'slim');
  const upload = request.mock.calls.find((c) => c[1]?.method === 'POST')!;
  expect(upload[1]?.headers).toEqual({ Authorization: 'Bearer skin-token' });
  expect((upload[1]?.body as any).get('variant')).toBe('slim');
  await skins.reset('account');
  expect(store.data.accounts[0].skin).toBeUndefined();
});

it('reads the actual Minecraft version from renamed client profiles', async () => {
  const { root } = await fixture(),
    jar = path.join(root, 'client.jar'),
    zip = new AdmZip();
  zip.addFile('version.json', Buffer.from(JSON.stringify({ id: '1.21.11', name: '1.21.11' })));
  await zip.writeZipPromise(jar);
  expect(await clientVersion(jar, '1.21.11-Fabric')).toBe('1.21.11');
  const old = new AdmZip();
  old.addFile('Main.class', Buffer.from('fixture'));
  await old.writeZipPromise(jar);
  expect(await clientVersion(jar, '1.7.10')).toBe('1.7.10');
});
it('repairs missing or corrupted logging configuration before launching imported games', async () => {
  const { store, net, add, ctx } = await fixture();
  const i = add('logging');
  i.localRuntime = true;
  const config = Buffer.from('<Configuration status="WARN"/>'),
    sha1 = createHash('sha1').update(config).digest('hex');
  const version = {
    id: 'renamed',
    type: 'release',
    mainClass: 'Main',
    libraries: [],
    logging: {
      client: {
        argument: '-Dlog4j.configurationFile=${path}',
        file: {
          id: 'client.xml',
          url: 'https://fixture.test/client.xml',
          size: config.length,
          sha1,
        },
      },
    },
  };
  const response = vi
      .spyOn(net, 'response')
      .mockImplementation(async () => new Response(config) as any),
    mc = new Minecraft(store, net);
  const result = await mc.ensureLogging(i.id, version, ctx.signal);
  expect(result).toBe(path.join(store.runtime(i.id), 'assets/log_configs/client.xml'));
  expect(await readFile(result!)).toEqual(config);
  await mc.ensureLogging(i.id, version, ctx.signal);
  expect(response).toHaveBeenCalledTimes(1);
  await writeFile(result!, 'broken');
  await mc.ensureLogging(i.id, version, ctx.signal);
  expect(response).toHaveBeenCalledTimes(2);
});
