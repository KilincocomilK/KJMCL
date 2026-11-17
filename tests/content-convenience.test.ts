import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { Store } from '../electron/core/store';
import { claimDirectory } from '../electron/core/instances';
import { Resources } from '../electron/core/resources';
import { Mods } from '../electron/core/mods';
import { ModAudit } from '../electron/core/mod-audit';
import { Catalog } from '../electron/core/catalog';
import { libraryHandlers } from '../electron/library-features';
import { dialog } from 'electron';

vi.mock('electron', () => ({ dialog: { showSaveDialog: vi.fn() } }));
const roots: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-content-convenience-'));
  roots.push(root);
  const store = new Store(path.join(root, 'data'));
  const gameDir = claimDirectory(store, path.join(store.root, 'instances', 'test'), 'test');
  store.data.instances.push({
    id: 'test',
    name: 'private-name',
    version: '1.21.1',
    loader: 'fabric',
    status: 'ready',
    createdAt: 1,
    playTime: 0,
    memoryMb: 2048,
    javaPath: '/secret/java',
    jvmArgs: ['-Dpassword=secret'],
    width: 1280,
    height: 720,
    gameDir,
  });
  store.save();
  const net = { json: vi.fn(), download: vi.fn() };
  const resources = new Resources(store),
    mods = new Mods(store, net as any),
    audit = new ModAudit(store, resources);
  const catalog = new Catalog(store, net as any, mods, {} as any, resources, {} as any);
  const jar = async (name: string, version: string) => {
    await mkdir(path.join(gameDir, 'mods'), { recursive: true });
    const zip = new AdmZip();
    zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'example', version })));
    await writeFile(path.join(gameDir, 'mods', name), zip.toBuffer());
  };
  return { root, store, gameDir, net, catalog, audit, jar };
}
it('exports enabled and disabled local/provider mods with exact versions but no account, path or JVM settings', async () => {
  const { root, store, gameDir, catalog, audit, jar } = await fixture();
  await jar('z-local.jar', '2.0');
  await jar('a-secretToken.jar.disabled', '1.0\npassword=hidden');
  await writeFile(
    path.join(gameDir, 'mods-lock.json'),
    JSON.stringify([
      { file: 'a-secretToken.jar', projectId: 'project1', versionId: 'version2', sha512: 'unused' },
    ]),
  );
  const output = path.join(root, 'mods.txt');
  await catalog.exportModList('test', output, ['secretToken'], await audit.scan('test'));
  const text = await readFile(output, 'utf8');
  expect(text).toContain(
    'a-[REDACTED].jar.disabled\t停用\t1.0 password=[REDACTED]\tModrinth\tproject1\tversion2',
  );
  expect(text).toContain('z-local.jar\t启用\t2.0\t本地');
  expect(text.indexOf('a-[REDACTED]')).toBeLessThan(text.indexOf('z-local'));
  for (const value of [
    store.root,
    gameDir,
    'private-name',
    '/secret/java',
    '-Dpassword',
    'secretToken',
    'hidden',
  ])
    expect(text).not.toContain(value);
});
it('never overwrites a mod or an existing export', async () => {
  const { root, gameDir, catalog, audit, jar } = await fixture();
  await jar('keep.jar', '1');
  const source = path.join(gameDir, 'mods', 'keep.jar'),
    original = await readFile(source);
  await expect(
    catalog.exportModList('test', source, [], await audit.scan('test')),
  ).rejects.toThrow();
  expect(await readFile(source)).toEqual(original);
  const output = path.join(root, 'mods.txt');
  await writeFile(output, 'previous');
  await expect(catalog.exportModList('test', output, [], [])).rejects.toThrow();
  expect(await readFile(output, 'utf8')).toBe('previous');
});
it('cancels cleanly and refuses export when secret lookup fails', async () => {
  const { root, store, catalog, audit } = await fixture();
  const secrets = vi.fn(async (): Promise<string[]> => {
    throw new Error('vault unavailable');
  });
  const handlers = libraryHandlers({
    store,
    catalog,
    audit,
    secrets,
    tasks: { exclusive: async (_: string, f: () => Promise<unknown>) => f() } as any,
    window: () => ({}) as any,
  } as any);
  vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: '' });
  expect(await handlers.exportModList('test')).toBeNull();
  expect(secrets).not.toHaveBeenCalled();
  const output = path.join(root, 'mods.txt');
  vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: output });
  await expect(handlers.exportModList('test')).rejects.toThrow('vault unavailable');
  await expect(readFile(output)).rejects.toThrow();
});
it('supports shader discovery and chosen compatible shader version without changing resources', async () => {
  const { root, catalog, net, gameDir } = await fixture();
  const zip = new AdmZip();
  zip.addFile('shaders/main.fsh', Buffer.from('shader fixture'));
  const bytes = zip.toBuffer(),
    hash = createHash('sha512').update(bytes).digest('hex');
  const version = {
    id: 'chosen',
    project_id: 'shaderA',
    name: 'Shader v1',
    date_published: '2026-10-01',
    version_type: 'release',
    game_versions: ['1.21.1'],
    loaders: ['iris'],
    dependencies: [],
    files: [
      {
        filename: 'shader.zip',
        url: 'https://fixture.invalid/shader.zip',
        hashes: { sha512: hash },
        size: bytes.length,
        primary: true,
      },
    ],
  };
  net.json.mockImplementation(async (url: string) =>
    url.includes('/search?')
      ? { hits: [{ project_id: 'shaderA', title: 'Shader' }], total_hits: 1 }
      : url.includes('/version/')
        ? version
        : url.includes('/version?')
          ? [version, { ...version, id: 'foreign', game_versions: ['1.20.1'] }]
          : { id: 'shaderA', title: 'Shader', project_type: 'shader' },
  );
  net.download.mockImplementation(async (_url: string, dest: string, options: any) => {
    expect(options.hash).toBe(hash);
    expect(options.algorithm).toBe('sha512');
    await writeFile(dest, bytes);
  });
  const ref = { source: 'modrinth', kind: 'shader', projectId: 'shaderA' } as const;
  await catalog.search({ ...ref, id: 'test', query: '', offset: 0, sort: 'updated' });
  expect(new URL(net.json.mock.calls[0][0]).searchParams.get('facets')).toContain(
    'project_type:shader',
  );
  expect(
    (await catalog.versions({ ...ref, id: 'test', offset: 0 })).items.map((v) => v.id),
  ).toEqual(['chosen']);
  await catalog.install(
    { ...ref, id: 'test', versionId: 'chosen' },
    { signal: new AbortController().signal, progress: () => {} },
  );
  expect(await readFile(path.join(gameDir, 'shaderpacks/shader.zip'))).toEqual(bytes);
  expect(root).not.toBe(gameDir);
});
it('groups old favorites offline and keeps equal project IDs in other sources or categories', async () => {
  const { store, catalog } = await fixture();
  const base = {
    projectId: '123',
    title: 'Saved',
    description: '',
    author: '',
    downloads: 0,
    url: 'https://modrinth.com/mod/123',
    group: 'old',
    savedAt: 42,
  };
  store.data.favorites = [
    { ...base, source: 'modrinth', kind: 'mod' },
    { ...base, source: 'curseforge', kind: 'mod' },
    { ...base, source: 'modrinth', kind: 'shader' },
  ];
  const ref = { source: 'modrinth', kind: 'mod', projectId: '123' } as const;
  await catalog.favorite(ref, '建筑');
  const saved = new Store(store.root).data.favorites;
  expect(saved.find((f) => f.source === 'modrinth' && f.kind === 'mod')).toMatchObject({
    group: '建筑',
    savedAt: 42,
  });
  catalog.removeFavorite(ref);
  expect(store.data.favorites.map((f) => `${f.source}:${f.kind}`)).toEqual([
    'curseforge:mod',
    'modrinth:shader',
  ]);
});
