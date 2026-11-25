import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  gameLaunchArguments,
  launchAccount,
  launchChoices,
  prepareLaunchOptions,
  quickPlaySupport,
} from '../electron/core/launch-options';
import { expandArguments, mergeVersions, type Version } from '../electron/core/minecraft';
import { Store } from '../electron/core/store';
import { launchOptionsSchema } from '../shared/schema';
import type { Account } from '../shared/types';

const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-launch-options-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const version: Version = {
  id: 'custom-name',
  type: 'release',
  mainClass: 'Main',
  libraries: [],
  arguments: {
    game: [
      '--username',
      '${auth_player_name}',
      {
        rules: [{ action: 'allow', features: { has_custom_resolution: true } }],
        value: ['--width', '${resolution_width}'],
      },
      {
        rules: [{ action: 'allow', features: { has_quick_plays_support: true } }],
        value: ['--quickPlayPath', '${quickPlayPath}'],
      },
      {
        rules: [{ action: 'allow', features: { is_quick_play_singleplayer: true } }],
        value: ['--quickPlaySingleplayer', '${quickPlaySingleplayer}'],
      },
      {
        rules: [{ action: 'allow', features: { is_quick_play_multiplayer: true } }],
        value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'],
      },
    ],
  },
};
const variables = { auth_player_name: 'Player', resolution_width: '1280' };
describe('instance launch preferences', () => {
  it('selects the bound account without changing the global selection or falling back when missing', () => {
    const accounts: Account[] = [
      { id: 'one', name: 'One', uuid: '1', kind: 'offline' },
      { id: 'two', name: 'Two', uuid: '2', kind: 'offline' },
    ];
    expect(launchAccount(accounts, 'one').id).toBe('one');
    expect(
      launchAccount(accounts, 'one', {
        accountId: 'two',
        fullscreen: false,
        target: { kind: 'menu' },
      }).id,
    ).toBe('two');
    expect(() =>
      launchAccount(accounts, 'one', {
        accountId: 'removed',
        fullscreen: false,
        target: { kind: 'menu' },
      }),
    ).toThrow('已移除');
  });
  it('derives Quick Play support from inherited metadata rather than version names', async () => {
    const inherited = mergeVersions(version, {
      id: 'custom-loader',
      mainClass: 'Loader',
      libraries: [],
      type: 'release',
    });
    expect(quickPlaySupport(inherited)).toEqual({ server: true, world: true });
    expect(quickPlaySupport({ ...version, id: '1.21.1', arguments: undefined })).toEqual({
      server: false,
      world: false,
    });
    await expect(
      prepareLaunchOptions({ ...version, arguments: undefined }, await temp(), {
        fullscreen: false,
        target: { kind: 'server', address: 'mc.example.com' },
      }),
    ).rejects.toThrow('不支持');
  });
  it('only enables the chosen target and preserves server addresses as a single argument', async () => {
    const root = await temp();
    const launch = await prepareLaunchOptions(version, root, {
      fullscreen: true,
      target: { kind: 'server', address: '[::1]:25565' },
    });
    expect(launch.fullscreen).toBe(true);
    expect(
      expandArguments(
        version.arguments!.game!,
        { ...variables, ...launch.variables },
        launch.features,
      ),
    ).toEqual([
      '--username',
      'Player',
      '--quickPlayPath',
      'logs/kjmcl-quick-play.json',
      '--quickPlayMultiplayer',
      '[::1]:25565',
    ]);
    const normal = await prepareLaunchOptions(version, root);
    expect(expandArguments(version.arguments!.game!, variables, normal.features)).toEqual([
      '--username',
      'Player',
      '--width',
      '1280',
    ]);
  });
  it('lists real worlds and passes names with spaces without splitting, rejecting vanished worlds', async () => {
    const root = await temp();
    await mkdir(path.join(root, 'saves', '我的 世界'), { recursive: true });
    await mkdir(path.join(root, 'saves', 'not-a-world'));
    await writeFile(path.join(root, 'saves', '我的 世界', 'level.dat'), 'fixture');
    expect((await launchChoices(version, root)).worlds).toEqual(['我的 世界']);
    const launch = await prepareLaunchOptions(version, root, {
      fullscreen: false,
      target: { kind: 'world', name: '我的 世界' },
    });
    expect(
      expandArguments(
        version.arguments!.game!,
        { ...variables, ...launch.variables },
        launch.features,
      ).slice(-2),
    ).toEqual(['--quickPlaySingleplayer', '我的 世界']);
    await expect(
      prepareLaunchOptions(version, root, {
        fullscreen: false,
        target: { kind: 'world', name: 'gone' },
      }),
    ).rejects.toThrow('存档已不存在');
  });
  it('applies window size to inherited legacy arguments and replaces it with fullscreen', async () => {
    const legacy = mergeVersions(
      { ...version, arguments: undefined, minecraftArguments: '--username ${auth_player_name}' },
      { id: 'loader', type: 'release', mainClass: 'Loader', libraries: [] },
    );
    const vars = { ...variables, resolution_height: '720' };
    const options = await prepareLaunchOptions(legacy, await temp());
    expect(gameLaunchArguments(legacy, vars, options)).toEqual([
      '--username',
      'Player',
      '--width',
      '1280',
      '--height',
      '720',
    ]);
    expect(gameLaunchArguments(legacy, vars, { ...options, fullscreen: true })).toEqual([
      '--username',
      'Player',
      '--fullscreen',
    ]);
    const fullscreen = await prepareLaunchOptions(version, await temp(), {
      fullscreen: true,
      target: { kind: 'menu' },
    });
    expect(gameLaunchArguments(version, vars, fullscreen)).toEqual([
      '--username',
      'Player',
      '--fullscreen',
    ]);
  });
  it('does not let a Quick Play log path follow a linked directory', async () => {
    const root = await temp(),
      outside = await temp();
    await writeFile(path.join(outside, 'kjmcl-quick-play.json'), 'unchanged');
    await symlink(outside, path.join(root, 'logs'), 'junction');
    await expect(
      prepareLaunchOptions(version, root, {
        fullscreen: false,
        target: { kind: 'server', address: 'example.com' },
      }),
    ).rejects.toThrow('链接');
    expect(await readFile(path.join(outside, 'kjmcl-quick-play.json'), 'utf8')).toBe('unchanged');
  });
  it('rejects traversal, malformed server input and linked world directories', async () => {
    for (const address of [
      'https://example.com',
      'host --username Fake',
      'host:0',
      'host:65536',
      '-server',
      'host\nother',
    ])
      expect(
        launchOptionsSchema.safeParse({ fullscreen: false, target: { kind: 'server', address } })
          .success,
      ).toBe(false);
    for (const name of ['../world', 'C:\\world', '.', '..', 'world/sub'])
      expect(
        launchOptionsSchema.safeParse({ fullscreen: false, target: { kind: 'world', name } })
          .success,
      ).toBe(false);
    const root = await temp(),
      outside = await temp();
    await mkdir(path.join(root, 'saves'));
    await writeFile(path.join(outside, 'level.dat'), 'unchanged');
    await symlink(outside, path.join(root, 'saves', 'linked'), 'junction');
    await expect(
      prepareLaunchOptions(version, root, {
        fullscreen: false,
        target: { kind: 'world', name: 'linked' },
      }),
    ).rejects.toThrow('链接');
    expect(await readFile(path.join(outside, 'level.dat'), 'utf8')).toBe('unchanged');
  });
  it('migrates v6 without resetting appearance, accounts or instances and retains the original backup', async () => {
    const root = await temp(),
      store = new Store(root);
    store.data.appearance = {
      backgroundId: '1c02d27c-b946-49b1-b59a-0787757dd169',
      dim: 50,
      blur: 4,
    };
    store.data.accounts = [{ id: 'account', name: 'Player', uuid: '1', kind: 'offline' }];
    store.data.selectedAccountId = 'account';
    store.data.instances = [
      {
        id: 'game',
        name: 'Game',
        version: '1.21.1',
        loader: 'vanilla',
        status: 'ready',
        createdAt: 1,
        playTime: 22,
        memoryMb: 2048,
        javaPath: '',
        jvmArgs: [],
        width: 1280,
        height: 720,
      },
    ];
    const original = { ...store.data, schemaVersion: 6 };
    await writeFile(path.join(root, 'state.json'), JSON.stringify(original));
    const migrated = new Store(root);
    expect(migrated.data.schemaVersion).toBe(9);
    expect(migrated.data.appearance).toEqual(original.appearance);
    expect(migrated.data.accounts).toEqual(original.accounts);
    expect(migrated.data.instances[0].playTime).toBe(22);
    expect(migrated.data.instances[0].launchOptions).toBeUndefined();
    expect(JSON.parse(await readFile(path.join(root, 'state.json.v6.bak'), 'utf8'))).toEqual(
      original,
    );
    migrated.data.instances[0].launchOptions = {
      accountId: 'account',
      fullscreen: true,
      target: { kind: 'server', address: 'example.com' },
    };
    migrated.save();
    expect(new Store(root).data.instances[0].launchOptions).toEqual(
      migrated.data.instances[0].launchOptions,
    );
  });
});
