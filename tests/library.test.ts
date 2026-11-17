import { afterEach, expect, it, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  utimes,
  rename,
  symlink,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { Store } from '../electron/core/store';
import { claimDirectory } from '../electron/core/instances';
import { Resources } from '../electron/core/resources';
import { ModAudit } from '../electron/core/mod-audit';
import { DiskUsage } from '../electron/core/disk-usage';
import { CrashReports } from '../electron/core/crash-reports';
import { safeExport } from '../electron/core/safe-export';
import { Catalog } from '../electron/core/catalog';
import { Mods } from '../electron/core/mods';
import { schemas } from '../shared/schema';
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-library-test-'));
  roots.push(root);
  const store = new Store(path.join(root, 'data'));
  const gameDir = claimDirectory(store, path.join(store.root, 'instances', 'test'), 'test');
  store.data.instances.push({
    id: 'test',
    name: '测试',
    version: '1.21.1',
    loader: 'fabric',
    status: 'ready',
    createdAt: 1,
    playTime: 120000,
    memoryMb: 2048,
    javaPath: '',
    jvmArgs: [],
    width: 1280,
    height: 720,
    gameDir,
  });
  store.save();
  const resources = new Resources(store),
    audit = new ModAudit(store, resources),
    disk = new DiskUsage(store);
  const zip = async (name: string, entries: Record<string, unknown>) => {
    const z = new AdmZip();
    for (const [file, value] of Object.entries(entries))
      z.addFile(file, Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)));
    await mkdir(path.join(gameDir, 'mods'), { recursive: true });
    const p = path.join(gameDir, 'mods', name);
    await writeFile(p, z.toBuffer());
    return p;
  };
  return { root, store, gameDir, resources, audit, disk, zip };
}
it('migrates v3 without losing accounts, paths, settings or playtime and keeps exact backup', async () => {
  const { store } = await setup(),
    file = path.join(store.root, 'state.json');
  const original = JSON.parse(await readFile(file, 'utf8'));
  original.schemaVersion = 3;
  delete original.favorites;
  original.accounts = [{ id: 'offline', kind: 'offline', name: 'Player', uuid: 'abc' }];
  const bytes = JSON.stringify(original);
  await writeFile(file, bytes);
  const next = new Store(store.root);
  expect(next.data.schemaVersion).toBe(7);
  expect(next.data.favorites).toEqual([]);
  expect(next.data.accounts).toEqual(original.accounts);
  expect(next.data.instances[0].gameDir).toBe(original.instances[0].gameDir);
  expect(next.data.instances[0].playTime).toBe(120000);
  expect(next.data.settings).toEqual(original.settings);
  expect(await readFile(file + '.v3.bak', 'utf8')).toBe(bytes);
  await writeFile(file, JSON.stringify({ ...next.data, favorites: [{ broken: true }] }));
  expect(() => new Store(store.root)).toThrow();
  expect(JSON.parse(await readFile(file, 'utf8')).favorites).toEqual([{ broken: true }]);
});
it('audits enabled duplicate IDs, declared dependencies, disabled mods and unreadable jars', async () => {
  const { audit, zip } = await setup();
  await zip('one.jar', {
    'fabric.mod.json': {
      id: 'same',
      version: '1.0',
      depends: { minecraft: '1.21.1', missing: '*' },
    },
  });
  await zip('two.jar', { 'fabric.mod.json': { id: 'same', version: '2.0' } });
  await zip('disabled.jar.disabled', { 'fabric.mod.json': { id: 'same' } });
  await zip('forge.jar', {
    'META-INF/mods.toml':
      '[[mods]]\nmodId="forge_test"\nversion="1.0"\n[[dependencies.forge_test]]\nmodId="minecraft"',
  });
  const entries = await audit.scan('test');
  expect(
    entries
      .find((e) => e.name === 'one.jar')
      ?.issues.map((i) => i.message)
      .join(' '),
  ).toContain('重复模组 ID：same');
  expect(
    entries
      .find((e) => e.name === 'one.jar')
      ?.issues.map((i) => i.message)
      .join(' '),
  ).toContain('missing');
  expect(entries.find((e) => e.name === 'disabled.jar.disabled')?.issues).toEqual([]);
  expect(entries.find((e) => e.name === 'forge.jar')?.ids).toEqual(['forge_test']);
  await zip('two.jar', { 'fabric.mod.json': { id: 'different' } });
  const refreshed = await audit.scan('test');
  expect(
    refreshed.find((e) => e.name === 'one.jar')?.issues.some((i) => i.message.includes('重复')),
  ).toBe(false);
});
it('batch review detects changes before touching any file and preserves contents on apply', async () => {
  const { audit, zip, gameDir } = await setup();
  await zip('a.jar', { 'fabric.mod.json': { id: 'a' } });
  await zip('b.jar', { 'fabric.mod.json': { id: 'b' } });
  const original = await readFile(path.join(gameDir, 'mods/a.jar'));
  const stale = await audit.plan('test', ['a.jar', 'b.jar'], false);
  await zip('b.jar', { 'fabric.mod.json': { id: 'changed' } });
  await expect(audit.apply(stale.token)).rejects.toThrow('发生变化');
  expect(await readFile(path.join(gameDir, 'mods/a.jar'))).toEqual(original);
  const valid = await audit.plan('test', ['a.jar', 'b.jar'], false);
  await audit.apply(valid.token);
  expect(await readFile(path.join(gameDir, 'mods/a.jar.disabled'))).toEqual(original);
  expect(await readdir(path.join(gameDir, 'mods'))).toEqual(
    expect.arrayContaining(['a.jar.disabled', 'b.jar.disabled']),
  );
  await expect(audit.apply(valid.token)).rejects.toThrow('过期');
  const restore = await audit.plan('test', ['a.jar.disabled', 'b.jar.disabled'], true);
  await audit.apply(restore.token);
  expect(await readFile(path.join(gameDir, 'mods/a.jar'))).toEqual(original);
});
it('rejects target collisions and traversal in mod batch requests', async () => {
  const { audit, zip } = await setup();
  await zip('a.jar', {});
  await zip('a.jar.disabled', {});
  await expect(audit.plan('test', ['a.jar'], false)).rejects.toThrow('目标已存在');
  expect(
    schemas.planModBatch.safeParse({ id: 'test', names: ['../escape.jar'], enabled: false })
      .success,
  ).toBe(false);
});
it('disk cleanup only removes old reviewed cache files and skips changed entries', async () => {
  const { disk, store, gameDir } = await setup(),
    cache = path.join(store.root, 'cache');
  await mkdir(cache);
  const old = new Date(Date.now() - 48 * 3600000);
  for (const n of ['old', 'changed', 'fresh']) {
    await writeFile(path.join(cache, n), n);
    if (n !== 'fresh') await utimes(path.join(cache, n), old, old);
  }
  await mkdir(path.join(gameDir, 'saves'));
  await writeFile(path.join(gameDir, 'saves/keep.dat'), 'world');
  const report = await disk.scan();
  expect(report.rows.find((r) => r.key === 'cache')?.files).toBe(3);
  const review = await disk.plan();
  expect(review.files).toBe(2);
  await writeFile(path.join(cache, 'changed'), 'new content');
  const result = await disk.apply(review.token);
  expect(result).toMatchObject({ files: 1, skipped: 1 });
  expect(await readdir(cache)).toEqual(expect.arrayContaining(['changed', 'fresh']));
  expect(await readFile(path.join(gameDir, 'saves/keep.dat'), 'utf8')).toBe('world');
});
it('cache review refuses a directory replaced by a junction', async () => {
  const { disk, store, root } = await setup(),
    cache = path.join(store.root, 'cache'),
    external = path.join(root, 'external');
  await mkdir(cache);
  await mkdir(external);
  await writeFile(path.join(cache, 'old'), 'cache');
  await writeFile(path.join(external, 'old'), 'must retain');
  const old = new Date(Date.now() - 48 * 3600000);
  await utimes(path.join(cache, 'old'), old, old);
  const review = await disk.plan();
  await rename(cache, cache + '-retained');
  await symlink(external, cache, process.platform === 'win32' ? 'junction' : 'dir');
  expect((await disk.apply(review.token)).files).toBe(0);
  expect(await readFile(path.join(external, 'old'), 'utf8')).toBe('must retain');
});
it('diagnostics redact known tokens, paths and emails and export only the selected report', async () => {
  const { store, gameDir, root } = await setup();
  await mkdir(path.join(gameDir, 'crash-reports'));
  await writeFile(
    path.join(gameDir, 'crash-reports/crash-fixture.txt'),
    `OutOfMemoryError: Java heap space\naccessToken=abc123\npassword=secretpass\nknownToken\n${gameDir}\nhello@example.org`,
  );
  const service = new CrashReports(store, async () => ['knownToken']);
  const list = await service.list('test');
  expect(list).toHaveLength(1);
  const r = await service.read('test', list[0].name);
  expect(r.diagnoses[0].title).toBe('Java 堆内存不足');
  for (const s of ['abc123', 'secretpass', 'knownToken', gameDir, 'hello@example.org'])
    expect(r.text).not.toContain(s);
  const dest = path.join(root, 'report.zip');
  await service.export('test', list[0].name, dest);
  const archive = new AdmZip(dest);
  expect(
    archive
      .getEntries()
      .map((e) => e.entryName)
      .sort(),
  ).toEqual(['README.txt', 'diagnosis.json', 'report.txt']);
  expect(archive.readAsText('report.txt')).toBe(r.text);
  await expect(service.export('test', list[0].name, dest)).rejects.toThrow();
  expect(new AdmZip(dest).readAsText('report.txt')).toBe(r.text);
  await expect(service.read('test', '../state.json')).rejects.toThrow('允许读取');
});
it('diagnostics fail closed when secrets are unavailable and bound report size', async () => {
  const { store, gameDir } = await setup();
  await mkdir(path.join(gameDir, 'logs'));
  await writeFile(path.join(gameDir, 'logs/latest.log'), 'x'.repeat(5 * 1024 ** 2));
  const failed = new CrashReports(store, async () => {
    throw new Error('locked credentials');
  });
  await expect(failed.read('test', 'logs/latest.log')).rejects.toThrow('locked credentials');
  const r = await new CrashReports(store, async () => []).read('test', 'logs/latest.log');
  expect(r.truncated).toBe(true);
  expect(r.text.length).toBe(4 * 1024 ** 2);
});
it('failed staged exports leave no final archive or temporary folder', async () => {
  const { root } = await setup();
  await expect(
    safeExport(path.join(root, 'incomplete.zip'), async (file) => {
      await writeFile(file, 'partial');
      throw new Error('cancelled');
    }),
  ).rejects.toThrow('cancelled');
  expect(
    (await readdir(root)).filter((n) => n === 'incomplete.zip' || n.startsWith('.kjmcl-export-')),
  ).toEqual([]);
});
async function catalogFixture() {
  const s = await setup(),
    bytes = Buffer.from('verified-resource'),
    sha = createHash('sha512').update(bytes).digest('hex');
  const version = {
    id: 'versionA',
    project_id: 'projectA',
    name: 'release',
    date_published: '2026-11-01',
    version_type: 'release',
    game_versions: ['1.21.1'],
    loaders: ['minecraft'],
    dependencies: [],
    files: [
      {
        filename: 'pack.zip',
        url: 'https://cdn.modrinth.com/pack.zip',
        primary: true,
        size: bytes.length,
        hashes: { sha512: sha },
      },
    ],
  };
  const net = {
    json: vi.fn(async (url: string) =>
      url.includes('/version/')
        ? version
        : url.includes('/version?')
          ? [version]
          : url.includes('/search?')
            ? { hits: [{ project_id: 'projectA', title: 'Project', downloads: 10 }], total_hits: 1 }
            : { id: 'projectA', title: 'Project', project_type: 'resourcepack', downloads: 10 },
    ),
    download: vi.fn(async (_url: string, dest: string) => {
      await writeFile(dest, bytes);
    }),
  };
  const mods = { install: vi.fn() },
    cf = { api: vi.fn(), file: vi.fn(), install: vi.fn() },
    packs = { import: vi.fn() };
  const c = new Catalog(s.store, net as any, mods as any, cf as any, s.resources, packs as any);
  return {
    ...s,
    c,
    net,
    mods,
    cf,
    packs,
    version,
    bytes,
    ref: { source: 'modrinth', kind: 'resourcepack', projectId: 'projectA' } as const,
  };
}
it('catalog search applies version/type facets, lists compatible versions and preserves favorite identity', async () => {
  const { c, net, ref, store } = await catalogFixture();
  await c.search({
    id: 'test',
    source: 'modrinth',
    kind: 'resourcepack',
    query: 'pack',
    sort: 'downloads',
    offset: 0,
  });
  const q = new URL(net.json.mock.calls[0][0]);
  expect(q.searchParams.get('facets')).toContain('project_type:resourcepack');
  expect(q.searchParams.get('facets')).toContain('versions:1.21.1');
  expect((await c.versions({ ...ref, id: 'test', offset: 0 })).items[0].id).toBe('versionA');
  await c.favorite(ref, '建筑');
  net.json.mockRejectedValue(new Error('offline'));
  await c.favorite(ref, '视觉');
  expect(new Store(store.root).data.favorites[0].group).toBe('视觉');
  c.removeFavorite({ ...ref, source: 'curseforge' });
  expect(store.data.favorites).toHaveLength(1);
  c.removeFavorite(ref);
  expect(store.data.favorites).toEqual([]);
});
it('catalog installs a hash-verified resource without overwriting unrelated same-name content', async () => {
  const { c, net, ref, gameDir, bytes } = await catalogFixture(),
    ctx = { signal: new AbortController().signal, progress: () => {} };
  await c.install({ ...ref, id: 'test', versionId: 'versionA' }, ctx);
  expect(await readFile(path.join(gameDir, 'resourcepacks/pack.zip'))).toEqual(bytes);
  expect(net.download.mock.calls[0]).toHaveLength(3);
  expect((net.download.mock.calls[0] as any)[2].algorithm).toBe('sha512');
  await writeFile(path.join(gameDir, 'resourcepacks/pack.zip'), 'local');
  await expect(c.install({ ...ref, id: 'test', versionId: 'versionA' }, ctx)).rejects.toThrow(
    '同名',
  );
  expect(await readFile(path.join(gameDir, 'resourcepacks/pack.zip'), 'utf8')).toBe('local');
  expect(
    (await readdir(path.join(gameDir, 'resourcepacks'))).filter((n) => n.endsWith('.download')),
  ).toEqual([]);
});
it('catalog rejects foreign versions, wrong project types and resources requiring unresolved dependencies', async () => {
  const { c, version, ref } = await catalogFixture(),
    ctx = { signal: new AbortController().signal, progress: () => {} };
  version.project_id = 'another';
  await expect(c.install({ ...ref, id: 'test', versionId: 'versionA' }, ctx)).rejects.toThrow(
    '不匹配',
  );
  version.project_id = 'projectA';
  (version.dependencies as any[]).push({ dependency_type: 'required' });
  await expect(c.install({ ...ref, id: 'test', versionId: 'versionA' }, ctx)).rejects.toThrow(
    '必需依赖',
  );
  await expect(c.project({ ...ref, kind: 'shader' })).rejects.toThrow('类型');
});
it('pinned Modrinth installs reject a version belonging to a different project', async () => {
  const { store } = await setup();
  const mods = new Mods(store, {
    json: async () => ({
      project_id: 'foreign',
      id: 'version',
      game_versions: ['1.21.1'],
      loaders: ['fabric'],
      files: [],
      dependencies: [],
    }),
  } as any);
  await expect(
    mods.install(
      'test',
      'expected',
      { signal: new AbortController().signal, progress: () => {} },
      'version',
    ),
  ).rejects.toThrow('不属于');
});
it('CurseForge resource discovery paginates and checks file ownership and download permission', async () => {
  const { c, cf, net, bytes, gameDir } = await catalogFixture();
  const project = {
    id: 123,
    classId: 12,
    gameId: 432,
    name: 'CF pack',
    slug: 'cf-pack',
    downloadCount: 8,
    authors: [],
  };
  const file = {
    id: 456,
    modId: 123,
    fileName: 'cf.zip',
    downloadUrl: 'https://mediafilez.forgecdn.net/cf.zip',
    fileLength: bytes.length,
    fileDate: '2026-11-01',
    gameVersions: ['1.21.1'],
    dependencies: [],
    hashes: [{ algo: 1, value: createHash('sha1').update(bytes).digest('hex') }],
  };
  cf.api.mockImplementation(async (endpoint: string) =>
    endpoint.startsWith('mods/search?')
      ? { data: [project], pagination: { totalCount: 21 } }
      : endpoint.includes('/files?')
        ? { data: [file], pagination: { totalCount: 21, resultCount: 1 } }
        : { data: project },
  );
  cf.file.mockResolvedValue(file);
  const ref = { source: 'curseforge', kind: 'resourcepack', projectId: '123' } as const;
  const search = await c.search({ ...ref, id: 'test', query: 'CF', sort: 'downloads', offset: 20 });
  expect(search.items[0].title).toBe('CF pack');
  expect(cf.api.mock.calls[0][0]).toContain('classId=12');
  expect(cf.api.mock.calls[0][0]).toContain('index=20');
  expect((await c.versions({ ...ref, id: 'test', offset: 0 })).more).toBe(true);
  const ctx = { signal: new AbortController().signal, progress: () => {} };
  await c.install({ ...ref, id: 'test', versionId: '456' }, ctx);
  expect(await readFile(path.join(gameDir, 'resourcepacks/cf.zip'))).toEqual(bytes);
  expect((net.download.mock.calls.at(-1) as any)[2].algorithm).toBe('sha1');
  cf.file.mockResolvedValue({ ...file, modId: 999 });
  await expect(c.install({ ...ref, id: 'test', versionId: '456' }, ctx)).rejects.toThrow('不匹配');
  cf.file.mockResolvedValue({ ...file, downloadUrl: null });
  await expect(c.install({ ...ref, id: 'test', versionId: '456' }, ctx)).rejects.toThrow('未开放');
});
it('modpack catalog downloads route to the existing isolated importer and never replace current instance', async () => {
  const { c, net, packs, version, store, gameDir } = await catalogFixture();
  const old = structuredClone(store.instance('test'));
  net.json.mockImplementation(async (url: string) =>
    url.includes('/version/')
      ? version
      : { id: 'projectA', title: 'Pack', project_type: 'modpack', downloads: 1 },
  );
  version.files[0].filename = 'project.mrpack';
  await c.install(
    {
      source: 'modrinth',
      kind: 'modpack',
      projectId: 'projectA',
      id: 'test',
      versionId: 'versionA',
    },
    { signal: new AbortController().signal, progress: () => {} },
  );
  expect(packs.import).toHaveBeenCalledOnce();
  expect(store.instance('test')).toEqual(old);
  expect(await readdir(path.join(gameDir, 'resourcepacks'))).toEqual([]);
});
