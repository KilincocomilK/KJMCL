import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { Backups, claimDirectory } from '../electron/core/instances';
import { Store } from '../electron/core/store';
import { TrialUpdates } from '../electron/core/trial-updates';
import type { Instance } from '../shared/types';

let root: string, store: Store, backups: Backups, trials: TrialUpdates, source: Instance;
const ctx = { signal: new AbortController().signal, progress() {} };
function instance(name: string): Instance {
  const id = randomUUID();
  return {
    id,
    name,
    version: '1.21.1',
    loader: 'vanilla',
    gameDir: claimDirectory(store, path.join(root, 'instances', id), id),
    status: 'ready',
    createdAt: 0,
    playTime: 0,
    javaPath: '',
    memoryMb: 1024,
    width: 1280,
    height: 720,
    jvmArgs: [],
  };
}
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kjmcl-trial-')));
  store = new Store(root);
  backups = new Backups(store);
  trials = new TrialUpdates(store, backups);
  source = instance('原实例');
  store.data.instances.push(source);
  await mkdir(path.join(source.gameDir!, 'saves/World/region'), { recursive: true });
  await writeFile(path.join(source.gameDir!, 'saves/World/level.dat'), 'world');
  await writeFile(path.join(source.gameDir!, 'saves/World/region/r.0.0.mca'), 'old');
});
afterEach(() => rm(root, { recursive: true, force: true }));

function trial() {
  const target = instance('新版本');
  target.status = 'installing';
  target.versionTrial = { version: 1, phase: 'copy', sourceId: source.id };
  store.data.instances.push(target);
  store.save();
  return target;
}
const lockSource = async (sourceId: string, copy: () => Promise<void>) => {
  expect(sourceId).toBe(source.id);
  await copy();
};
const unused = async () => {
  throw new Error('unexpected operation');
};
function restart() {
  store = new Store(root);
  trials = new TrialUpdates(store, new Backups(store));
}

it('reuses verified current backups and notices same-size changes in world regions', async () => {
  const [id] = await trials.prepareTrial(source.id, ctx);
  expect(await trials.prepareTrial(source.id, ctx)).toEqual([id]);
  await writeFile(path.join(source.gameDir!, 'saves/World/region/r.0.0.mca'), 'new');
  const [updated] = await trials.prepareTrial(source.id, ctx);
  expect(updated).not.toBe(id);
  expect(await backups.list(source.id)).toHaveLength(2);
  const target = instance('试更');
  store.data.instances.push(target);
  await trials.restoreTrial(source.id, target.id, [updated], ctx);
  await trials.restoreTrial(source.id, target.id, [updated], ctx);
  expect(await readFile(path.join(target.gameDir!, 'saves/World/region/r.0.0.mca'), 'utf8')).toBe(
    'new',
  );
  await writeFile(path.join(target.gameDir!, 'saves/World/level.dat'), 'played');
  await expect(trials.restoreTrial(source.id, target.id, [updated], ctx)).rejects.toThrow('同名');
  expect(await readFile(path.join(source.gameDir!, 'saves/World/level.dat'), 'utf8')).toBe('world');
});

it('keeps a bundled map and a same-name trial world in separate folders on every retry', async () => {
  const [backup] = await trials.prepareTrial(source.id, ctx);
  const target = instance('整合包');
  store.data.instances.push(target);
  await mkdir(path.join(target.gameDir!, 'saves/World'), { recursive: true });
  await writeFile(path.join(target.gameDir!, 'saves/World/level.dat'), 'template');
  await trials.restoreTrial(source.id, target.id, [backup], ctx, ['World']);
  await trials.restoreTrial(source.id, target.id, [backup], ctx, ['World']);
  expect(await readFile(path.join(target.gameDir!, 'saves/World/level.dat'), 'utf8')).toBe(
    'template',
  );
  const restored = path.join(
    target.gameDir!,
    'saves',
    'World-试更-' + backup.slice(0, 8),
    'level.dat',
  );
  expect(await readFile(restored, 'utf8')).toBe('world');
});

it('prepares a fresh runtime with the original mod configuration and world only in the copy', async () => {
  await mkdir(path.join(source.gameDir!, 'kubejs'));
  await writeFile(path.join(source.gameDir!, 'kubejs/example.js'), 'fixture');
  await writeFile(path.join(source.gameDir!, 'client.jar'), 'old runtime');
  const { id } = trial();
  await trials.installVersionCopy(id, ctx, lockSource, async () => {});
  expect(store.instance(id).status).toBe('ready');
  expect(store.instance(id).versionTrial).toBeUndefined();
  expect(await readFile(path.join(store.dir(id), 'kubejs/example.js'), 'utf8')).toBe('fixture');
  await expect(readFile(path.join(store.dir(id), 'client.jar'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(await readFile(path.join(store.dir(id), 'saves/World/level.dat'), 'utf8')).toBe('world');
});

it('rebuilds an interrupted staging copy from the current source without stale files', async () => {
  const target = trial(),
    dest = store.dir(target.id);
  await mkdir(path.join(source.gameDir!, 'mods'));
  await writeFile(path.join(source.gameDir!, 'mods/removed.jar'), 'removed');
  const control = new AbortController();
  await expect(
    trials.installVersionCopy(
      target.id,
      {
        signal: control.signal,
        progress(_percent, detail) {
          if (detail?.startsWith('还原') || detail?.startsWith('恢复')) control.abort();
        },
      },
      lockSource,
      unused,
    ),
  ).rejects.toThrow();
  expect(target.versionTrial?.phase).toBe('copy');
  await expect(readFile(path.join(dest, 'mods/removed.jar'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(await readFile(path.join(dest, '.kjmcl-version-trial/mods/removed.jar'), 'utf8')).toBe(
    'removed',
  );
  await rm(path.join(source.gameDir!, 'mods/removed.jar'));
  await writeFile(path.join(source.gameDir!, 'mods/current.jar'), 'current');
  restart();
  await trials.installVersionCopy(target.id, ctx, lockSource, async () => {});
  expect(await readFile(path.join(dest, 'mods/current.jar'), 'utf8')).toBe('current');
  await expect(readFile(path.join(dest, 'mods/removed.jar'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

it('resumes a committed snapshot after a collision, preserving edits and retrying installation alone', async () => {
  const target = trial(),
    dest = store.dir(target.id);
  await writeFile(path.join(source.gameDir!, 'options.txt'), 'snapshot');
  await mkdir(path.join(dest, 'saves'));
  await writeFile(path.join(dest, 'saves/keep'), 'player');
  await expect(trials.installVersionCopy(target.id, ctx, lockSource, unused)).rejects.toThrow(
    '同名',
  );
  expect(await readFile(path.join(dest, 'saves/keep'), 'utf8')).toBe('player');
  expect(await readFile(path.join(dest, 'options.txt'), 'utf8')).toBe('snapshot');
  await writeFile(path.join(dest, 'options.txt'), 'edited after failure');
  await rm(path.join(dest, 'saves'), { recursive: true });
  store.data.instances = store.data.instances.filter((i) => i.id !== source.id);
  store.save();
  restart();
  await expect(
    trials.installVersionCopy(target.id, ctx, unused, async () => {
      throw new Error('下载暂时不可用');
    }),
  ).rejects.toThrow('下载暂时不可用');
  expect(store.instance(target.id).versionTrial?.phase).toBe('install');
  expect(await readFile(path.join(dest, 'saves/World/level.dat'), 'utf8')).toBe('world');
  restart();
  await trials.installVersionCopy(target.id, ctx, unused, async () => {});
  expect(await readFile(path.join(dest, 'options.txt'), 'utf8')).toBe('edited after failure');
  restart();
  expect(store.instance(target.id).status).toBe('ready');
  expect(store.instance(target.id).versionTrial).toBeUndefined();
});

it('copies the installed pack’s selected custom files from disk, including later version trials', async () => {
  const zip = new AdmZip();
  const names = ['customdata/selected.json', 'customdata/unused.json'];
  zip.addFile(
    'modrinth.index.json',
    Buffer.from(
      JSON.stringify({
        formatVersion: 1,
        game: 'minecraft',
        name: '内容路径',
        dependencies: { minecraft: '1.21.1' },
        files: names.map((name) => ({
          path: name,
          env: { client: 'optional' },
          downloads: ['https://example.test/file'],
          fileSize: 2,
          hashes: { sha1: createHash('sha1').update('{}').digest('hex') },
        })),
      }),
    ),
  );
  zip.addFile('overrides/customdata/required.json', Buffer.from('{}'));
  zip.addFile('client-overrides/root.json', Buffer.from('{}'));
  const bytes = zip.toBuffer(),
    archive = createHash('sha256').update(bytes).digest('hex');
  await mkdir(path.join(root, 'pack-archives'));
  const cached = path.join(root, 'pack-archives', archive + '.zip');
  await writeFile(cached, bytes);
  source.packInstall = { version: 1, archive, optional: ['mr:' + names[0]], phase: 'complete' };
  await mkdir(path.join(source.gameDir!, 'customdata'));
  for (const name of [...names, 'customdata/required.json', 'root.json'])
    await writeFile(path.join(source.gameDir!, name), 'player content');
  const target = trial();
  await writeFile(cached, 'modified archive');
  await expect(trials.installVersionCopy(target.id, ctx, lockSource, unused)).rejects.toThrow(
    '校验失败',
  );
  expect(target.versionTrial?.phase).toBe('copy');
  await writeFile(cached, bytes);
  await trials.installVersionCopy(target.id, ctx, lockSource, async () => {});
  restart();
  source = store.instance(target.id);
  const second = trial();
  await trials.installVersionCopy(second.id, ctx, lockSource, async () => {});
  for (const name of [names[0], 'customdata/required.json', 'root.json'])
    expect(await readFile(path.join(store.dir(second.id), name), 'utf8')).toBe('player content');
  await expect(readFile(path.join(store.dir(second.id), names[1]))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

it('retains a registered copy on restart and never falls back to vanilla installation if the source is gone', async () => {
  const target = trial();
  store.data.instances = store.data.instances.filter((i) => i.id !== source.id);
  store.save();
  restart();
  expect(store.instance(target.id).status).toBe('error');
  expect(store.instance(target.id).error).toContain('试更中断');
  await expect(trials.installVersionCopy(target.id, ctx, unused, unused)).rejects.toThrow(
    '原实例已移除',
  );
  expect(store.instance(target.id).versionTrial?.phase).toBe('copy');
});
