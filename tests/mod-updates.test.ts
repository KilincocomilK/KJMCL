import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import {
  mkdtemp,
  mkdir,
  realpath,
  readFile,
  readdir,
  writeFile,
  rm,
  rename,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../electron/core/store';
import { Network } from '../electron/core/network';
import { Mods } from '../electron/core/mods';
import { CurseForge } from '../electron/core/curseforge';
import { ModUpdates } from '../electron/core/mod-updates';
import { ModUpdateHistory } from '../electron/core/mod-update-history';
import { Tasks } from '../electron/core/tasks';

const roots: string[] = [];
afterEach(async () => {
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});
const ctx = () => ({ signal: new AbortController().signal, progress: vi.fn() });
const digest = (data: string, algo: string) => createHash(algo).update(data).digest('hex');
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kjmcl-mod-updates-')));
  roots.push(root);
  const store = new Store(root);
  store.data.instances.push({
    id: 'x',
    name: 'x',
    version: '1.21.1',
    loader: 'fabric',
    status: 'ready',
    createdAt: 0,
    playTime: 0,
    memoryMb: 2048,
    javaPath: '',
    jvmArgs: [],
    width: 1280,
    height: 720,
  });
  const net = new Network(() => store.data.settings),
    mods = new Mods(store, net);
  const cf = new CurseForge(store, net, {
    get: async () => 'fixture',
    has: async () => true,
    set: async () => {},
  });
  const updates = new ModUpdates(store, net, mods, cf),
    dir = store.dir('x');
  const jars = path.join(dir, 'mods');
  await mkdir(jars, { recursive: true });
  const mr = [{ projectId: 'm', versionId: 'm1', file: 'm1.jar', sha512: digest('m1', 'sha512') }];
  const curse = [{ projectId: 1, fileId: 10, file: 'same.jar', sha1: digest('c1', 'sha1') }];
  await Promise.all([
    writeFile(path.join(dir, 'mods-lock.json'), JSON.stringify(mr) + '\n'),
    writeFile(path.join(dir, 'curseforge-lock.json'), JSON.stringify(curse, null, 4)),
    writeFile(path.join(jars, 'm1.jar.disabled'), 'm1'),
    writeFile(path.join(jars, 'same.jar'), 'c1'),
    writeFile(path.join(jars, 'local.jar'), 'user'),
  ]);
  const result = (project: string, version: string) => ({
    project_id: project,
    id: version,
    game_versions: ['1.21.1'],
    loaders: ['fabric'],
    dependencies: project === 'm' ? [{ dependency_type: 'required', project_id: 'dep' }] : [],
    files: [
      {
        filename: version + '.jar',
        url: 'https://fixture.invalid/' + version,
        hashes: { sha512: digest(version, 'sha512') },
        size: version.length,
        primary: true,
      },
    ],
  });
  vi.spyOn(mods, 'compatible').mockImplementation(async (_id, p) =>
    result(p, p === 'm' ? 'm2' : 'd1'),
  );
  vi.spyOn(cf, 'latest').mockResolvedValue({
    modId: 1,
    id: 11,
    fileName: 'same.jar',
    fileLength: 2,
    fileDate: '2000-01-01',
    gameVersions: ['1.21.1', 'Fabric'],
    dependencies: [],
    downloadUrl: 'https://fixture.invalid/c2',
    hashes: [{ algo: 1, value: digest('c2', 'sha1') }],
  });
  const download = vi
    .spyOn(net, 'response')
    .mockImplementation(async (url) => new Response(url.split('/').at(-1)) as any);
  async function view() {
    const entries = await readdir(jars);
    return {
      files: Object.fromEntries(
        await Promise.all(
          entries.map(async (n) => [n, await readFile(path.join(jars, n), 'utf8')]),
        ),
      ),
      locks: await Promise.all(
        ['mods-lock.json', 'curseforge-lock.json'].map((n) => readFile(path.join(dir, n), 'utf8')),
      ),
    };
  }
  return { store, updates, mods, cf, root, jars, dir, view, download, result };
}
it('previews both providers and required dependencies read-only, pins downloads, and undoes the entire batch after restart and relocation', async () => {
  const { updates, mods, store, jars, dir, root, view, download } = await fixture();
  const original = await view(),
    plan = await updates.preview('x', ctx());
  expect(plan.items.map((i) => [i.source, i.file, i.disabled])).toEqual([
    ['modrinth', 'm2.jar', true],
    ['modrinth', 'd1.jar', false],
    ['curseforge', 'same.jar', false],
  ]);
  expect(await view()).toEqual(original);
  expect(download).not.toHaveBeenCalled();
  expect(existsSync(path.join(root, 'backups', 'x', 'mod-updates'))).toBe(false);
  vi.mocked(mods.compatible).mockRejectedValue(
    new Error('must apply the originally previewed files'),
  );
  await updates.apply('x', plan.token, ctx());
  expect((await view()).files).toEqual({
    'm2.jar.disabled': 'm2',
    'd1.jar': 'd1',
    'same.jar': 'c2',
    'local.jar': 'user',
  });
  const history = new ModUpdateHistory(store);
  expect(await history.last('x')).toMatchObject({ count: 3 });
  await writeFile(path.join(jars, 'local.jar'), 'changed by user');
  const relocated = path.join(root, 'relocated');
  await rename(dir, relocated);
  store.instance('x').gameDir = relocated;
  await history.undo('x');
  expect((await readdir(path.join(relocated, 'mods'))).sort()).toEqual(
    Object.keys(original.files).sort(),
  );
  for (const [name, old] of Object.entries(original.files))
    expect(await readFile(path.join(relocated, 'mods', name), 'utf8')).toBe(
      name === 'local.jar' ? 'changed by user' : old,
    );
  expect(await readFile(path.join(relocated, 'mods-lock.json'), 'utf8')).toBe(original.locks[0]);
  expect(await readFile(path.join(relocated, 'curseforge-lock.json'), 'utf8')).toBe(
    original.locks[1],
  );
  expect(await history.last('x')).toBe(null);
});
it('does not commit earlier downloads when the last provider hash fails', async () => {
  const { updates, view, download } = await fixture(),
    before = await view(),
    preview = await updates.preview('x', ctx());
  download.mockImplementation(
    async (url) => new Response(url.endsWith('c2') ? 'xx' : url.split('/').at(-1)) as any,
  );
  await expect(updates.apply('x', preview.token, ctx())).rejects.toThrow();
  expect(await view()).toEqual(before);
  expect(await updates.history.last('x')).toBe(null);
});
it('rolls back an interrupted commit after the first live replacement', async () => {
  const { updates, view, jars } = await fixture(),
    before = await view(),
    preview = await updates.preview('x', ctx());
  const work = ctx(),
    control = new AbortController();
  work.signal = control.signal;
  const testAbort = work.signal.throwIfAborted.bind(work.signal);
  vi.spyOn(work.signal, 'throwIfAborted').mockImplementation(() => {
    if (!existsSync(path.join(jars, 'm1.jar.disabled')))
      control.abort(new Error('fixture interruption'));
    testAbort();
  });
  await expect(updates.apply('x', preview.token, work)).rejects.toThrow('fixture interruption');
  expect(await view()).toEqual(before);
  expect(await updates.history.pending('x')).toBe(null);
});
it('recovers the pre-update state from a persisted interrupted batch, preserving unrelated files', async () => {
  const { updates, store, view, root, dir } = await fixture(),
    before = await view(),
    preview = await updates.preview('x', ctx());
  await updates.apply('x', preview.token, ctx());
  const journal = path.join(root, 'backups', 'x', 'mod-updates'),
    tx = JSON.parse(await readFile(path.join(journal, 'last.json'), 'utf8'));
  // Simulate a crash after publishing several replacements but before switching the receipt pointer.
  await rm(path.join(journal, 'last.json'));
  await writeFile(path.join(journal, 'pending.json'), JSON.stringify({ tx, attempted: 6 }));
  await writeFile(path.join(dir, 'mods-lock.json'), before.locks[0]);
  const restarted = new ModUpdateHistory(store);
  await restarted.resume('x');
  expect(await view()).toEqual(before);
  expect(await restarted.last('x')).toBe(null);
});
it('rejects stale lock or file changes and does not overwrite edits during undo', async () => {
  const { updates, jars, dir, view } = await fixture();
  let preview = await updates.preview('x', ctx());
  await writeFile(path.join(dir, 'mods-lock.json'), (await view()).locks[0] + ' ');
  await expect(updates.apply('x', preview.token, ctx())).rejects.toThrow('预览已失效');
  preview = await updates.preview('x', ctx());
  await updates.apply('x', preview.token, ctx());
  await writeFile(path.join(jars, 'same.jar'), 'manually changed');
  const edited = await view();
  expect(await updates.history.last('x')).toBe(null);
  await expect(updates.history.undo('x')).rejects.toThrow('本地文件已改变');
  expect(await view()).toEqual(edited);
});
it('rejects conflicting destinations or wrong identities from either source before downloading', async () => {
  const { updates, mods, cf, result, download } = await fixture(),
    target = await cf.latest('x', 1);
  vi.mocked(cf.latest).mockResolvedValueOnce({ ...target, fileName: 'm2.jar' });
  await expect(updates.preview('x', ctx())).rejects.toThrow('同名模组');
  vi.mocked(cf.latest).mockResolvedValueOnce({ ...target, modId: 7 });
  await expect(updates.preview('x', ctx())).rejects.toThrow('身份不匹配');
  vi.mocked(mods.compatible).mockResolvedValueOnce(result('different', 'm2'));
  await expect(updates.preview('x', ctx())).rejects.toThrow('不属于指定项目');
  expect(download).not.toHaveBeenCalled();
});

it('restores earlier replacements without overwriting an external edit to a later file', async () => {
  const { updates, view, jars } = await fixture(),
    before = await view(),
    plan = await updates.preview('x', ctx()),
    work = ctx();
  let changed = false;
  vi.spyOn(work.signal, 'throwIfAborted').mockImplementation(() => {
    if (!changed && !existsSync(path.join(jars, 'm1.jar.disabled'))) {
      changed = true;
      writeFileSync(path.join(jars, 'same.jar'), 'external edit');
    }
  });
  await expect(updates.apply('x', plan.token, work)).rejects.toThrow('修改');
  before.files['same.jar'] = 'external edit';
  expect(await view()).toEqual(before);
  expect(await updates.history.pending('x')).toBe(null);
});
it('can consume a preview only once, and reports a completed update when cancellation follows the commit point', async () => {
  const { updates } = await fixture(),
    plan = await updates.preview('x', ctx()),
    tasks = new Tasks(() => {});
  const applied = tasks.run('fixture', 'x', async (work) => {
    const begin = work.beginCommit!;
    work.beginCommit = () => {
      begin();
      tasks.cancel(tasks.items[0].id);
    };
    await updates.apply('x', plan.token, work);
  });
  await expect(updates.apply('x', plan.token, ctx())).rejects.toThrow('预览已失效');
  await applied;
  expect(tasks.items[0].status).toBe('completed');
  expect(await updates.history.last('x')).toMatchObject({ count: 3 });
});
