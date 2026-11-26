import os from 'node:os';
import path from 'node:path';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { LauncherMigration } from '../electron/core/launcher-migration';
import { GameFolders } from '../electron/core/game-folders';
import { Store } from '../electron/core/store';
import { exists } from '../electron/core/files';

const temporary: string[] = [];
const work = () => ({ signal: new AbortController().signal, progress: () => {} });
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});

it('automatically finds a portable launcher within a disposable home and ignores unrelated config directories', async () => {
  const f = await fixture();
  await f.version('portable');
  vi.spyOn(os, 'homedir').mockReturnValue(f.base);
  for (const key of [
    'APPDATA',
    'HMCL_USER_HOME',
    'HMCL_LOCAL_HOME',
    'XDG_DATA_HOME',
    'MINECRAFT_HOME',
    'SystemRoot',
  ])
    vi.stubEnv(key, f.base);
  await writeFile(path.join(f.launcher, 'HMCL.jar'), '');
  await mkdir(path.join(f.base, 'Documents/config'), { recursive: true });
  const results = await f.migration.discover();
  expect(results.find((r) => r.root === f.root)?.launchers).toContain('HMCL');
  expect(results.some((r) => r.root === path.join(f.base, 'Documents'))).toBe(false);
});

async function fixture() {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kjmcl-migration-')));
  temporary.push(base);
  const store = new Store(path.join(base, 'kjmcl'));
  const folders = new GameFolders(store);
  const migration = new LauncherMigration(store, folders);
  const launcher = path.join(base, '游戏启动器');
  const root = path.join(launcher, '.minecraft');
  const output = path.join(base, '副本');
  await Promise.all([mkdir(root, { recursive: true }), mkdir(output)]);
  async function file(relative: string, value: string) {
    const dest = path.join(root, relative);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, value);
  }
  async function version(id: string) {
    await file(
      'versions/' + id + '/' + id + '.json',
      JSON.stringify({ id, mainClass: 'Main', libraries: [] }),
    );
    await file('versions/' + id + '/' + id + '.jar', 'client');
  }
  async function selection() {
    const results = await migration.inspect(launcher);
    const scan = await migration.preview(results[0].id);
    return { scan, input: { name: '迁移', selectionId: scan.selectionId, layouts: [] } };
  }
  return { base, store, folders, migration, launcher, root, output, version, file, selection };
}

it('recognizes portable launcher roots, deduplicates configured directories and rejects arbitrary preview paths', async () => {
  const f = await fixture();
  await f.version('1.20.4');
  await f.file('launcher_profiles_microsoft_store.json', '{}');
  await writeFile(path.join(f.launcher, 'HMCL.jar'), '');
  await writeFile(path.join(f.launcher, 'Plain Craft Launcher 2.exe'), '');
  const custom = path.join(f.base, '自定义游戏');
  await mkdir(path.join(custom, 'versions'), { recursive: true });
  await writeFile(
    path.join(f.launcher, 'hmcl.json'),
    JSON.stringify({
      configurations: { portable: { gameDir: '.minecraft' }, other: { gameDir: custom } },
    }),
  );
  const list = await f.migration.inspect(f.launcher);
  expect(list).toHaveLength(2);
  expect(list.find((x) => x.root === f.root)?.launchers).toEqual(['官方启动器', 'HMCL', 'PCL2']);
  expect(list.find((x) => x.root === custom)?.launchers).toEqual(['HMCL']);
  await expect(f.migration.preview(f.root)).rejects.toThrow('过期');
  expect((await f.migration.inspect(f.root)).find((x) => x.root === f.root)?.id).toBe(list[0].id);
});

it('copies independent game data, relocates custom profile directories and imports only supported launcher options', async () => {
  const f = await fixture();
  for (const id of ['官方', 'PCL隔离', 'PCL共享', 'HMCL', '损坏']) await f.version(id);
  await rm(path.join(f.root, 'versions/损坏/损坏.jar'));
  const external = path.join(f.base, '其他运行目录');
  await mkdir(path.join(external, 'saves/世界'), { recursive: true });
  await writeFile(path.join(external, 'saves/世界/level.dat'), 'world');
  const config = {
    profiles: {
      player: {
        name: '窗口设置',
        gameDir: external,
        lastVersionId: '官方',
        resolution: { width: 1600, height: 900 },
        javaArgs: '-Xmx4G -javaagent:untrusted.jar',
        javaDir: 'untrusted',
      },
    },
    authenticationDatabase: { secret: 'token' },
  };
  await f.file('launcher_profiles.json', JSON.stringify(config));
  await f.file('launcher_accounts.json', 'secret');
  await f.file('versions/PCL隔离/PCL/Setup.ini', 'VersionArgumentIndieV2:True\r\n');
  await f.file('versions/PCL共享/PCL/Setup.ini', 'VersionArgumentIndie:2\r\n');
  await f.file('versions/PCL共享/saves/留存/level.dat', 'retained');
  await f.file(
    'versions/HMCL/hmclversion.cfg',
    JSON.stringify({
      gameDirType: 1,
      width: 1280,
      height: 800,
      maxMemory: 3072,
      preLaunchCommand: 'untrusted',
    }),
  );
  for (const file of [
    'assets/objects/ab/file',
    'mods/mod.jar',
    'config/mod.conf',
    'resourcepacks/pack.zip',
    'screenshots/shot.png',
    'servers.dat',
    'options.txt',
    'libraries/local/file.jar',
  ])
    await f.file(file, 'data');
  const { scan, input } = await f.selection();
  expect(scan.versions.find((v) => v.id === '官方')?.gameDir).toBe(external);
  const id = await f.migration.copy(input, f.output, work());
  const copy = f.store.folder(id).path;
  const lookup = (id: string) => f.store.data.instances.find((i) => i.external?.versionId === id)!;
  expect(lookup('官方')).toMatchObject({
    name: '窗口设置',
    width: 1600,
    height: 900,
    memoryMb: 4096,
    javaPath: '',
    jvmArgs: [],
  });
  expect(lookup('PCL隔离').gameDir).toBe(path.join(copy, 'versions/PCL隔离'));
  expect(lookup('PCL共享').gameDir).toBe(copy);
  expect(lookup('HMCL')).toMatchObject({ height: 800, memoryMb: 3072 });
  expect(lookup('损坏').status).toBe('error');
  expect(await readFile(path.join(copy, 'versions/PCL共享/saves/留存/level.dat'), 'utf8')).toBe(
    'retained',
  );
  expect(lookup('官方').gameDir?.startsWith(copy + path.sep)).toBe(true);
  expect(await readFile(path.join(lookup('官方').gameDir!, 'saves/世界/level.dat'), 'utf8')).toBe(
    'world',
  );
  const exported = await readFile(path.join(copy, 'launcher_profiles.json'), 'utf8');
  for (const name of ['token', 'secret', 'untrusted', external])
    expect(exported).not.toContain(name);
  expect(await exists(path.join(copy, 'launcher_accounts.json'))).toBe(false);
  expect(await readFile(path.join(f.root, 'launcher_profiles.json'), 'utf8')).toBe(
    JSON.stringify(config),
  );
  lookup('官方').width = 1024;
  await f.folders.refresh(id);
  expect(lookup('官方').width).toBe(1024);
  await expect(f.migration.copy((await f.selection()).input, f.output, work())).rejects.toThrow(
    '已登记过副本',
  );
  expect(f.store.data.gameFolders).toHaveLength(1);
});

it('preserves an old world-only .minecraft and can index newly restored versions later', async () => {
  const f = await fixture();
  await f.file('saves/世界/level.dat', 'preserved');
  const { scan, input } = await f.selection();
  expect(scan.versions).toEqual([]);
  const id = await f.migration.copy(input, f.output, work());
  expect(f.store.data.instances).toHaveLength(0);
  expect(await readFile(path.join(f.store.folder(id).path, 'saves/世界/level.dat'), 'utf8')).toBe(
    'preserved',
  );
  const linked = await f.folders.add(input);
  await f.version('新版本');
  await f.folders.refresh(linked);
  expect(f.store.data.instances).toHaveLength(1);
});

it('rejects nested destinations, cleans up on cancellation and does not follow a junction in world data', async () => {
  const f = await fixture();
  await f.version('old');
  const { input } = await f.selection();
  await expect(f.migration.copy(input, f.root, work())).rejects.toThrow('重叠');
  await expect(
    f.migration.copy(input, f.output, {
      ...work(),
      progress: (n) => {
        if (n >= 4) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      },
    }),
  ).rejects.toThrow('目标磁盘空间不足');
  expect(await readdir(f.output)).toEqual([]);
  const controller = new AbortController();
  await expect(
    f.migration.copy(input, f.output, {
      signal: controller.signal,
      progress: (n) => {
        if (n >= 4) controller.abort(new Error('cancelled'));
      },
    }),
  ).rejects.toThrow('cancelled');
  await mkdir(path.join(f.root, 'saves'));
  await symlink(
    f.output,
    path.join(f.root, 'saves/link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(f.migration.copy(input, f.output, work())).rejects.toThrow('链接');
  expect(await readdir(f.output)).toEqual([]);
  expect(f.store.data.gameFolders).toEqual([]);
});
