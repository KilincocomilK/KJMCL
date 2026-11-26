import path from 'node:path';
import { lstat, readdir } from 'node:fs/promises';
import type { Account, InstanceLaunchOptions, LaunchChoices } from '../../shared/types';
import { launchOptionsSchema } from '../../shared/schema';
import {
  allowed,
  expandArguments,
  selectArguments,
  type Minecraft,
  type Version,
} from './minecraft';
import { checkGamePath } from './game-folders';
import { inside } from './files';

export function launchAccount(
  accounts: Account[],
  selected: string | undefined,
  options?: InstanceLaunchOptions,
) {
  const account = accounts.find((a) => a.id === (options?.accountId ?? selected));
  if (!account) throw new Error(options?.accountId ? '实例账户已移除，请重新选择' : '请先选择账户');
  return account;
}

export function quickPlaySupport(version: Version) {
  const supports = (feature: string) =>
    (version.arguments?.game ?? []).some(
      (arg) =>
        typeof arg !== 'string' &&
        arg.rules.some((rule) => rule.action === 'allow' && rule.features?.[feature] === true) &&
        allowed(arg.rules, undefined, undefined, {
          [feature]: true,
          has_quick_plays_support: true,
        }),
    );
  return {
    server: supports('is_quick_play_multiplayer'),
    world: supports('is_quick_play_singleplayer'),
  };
}

export async function launchChoices(version: Version, root: string): Promise<LaunchChoices> {
  const support = quickPlaySupport(version);
  const worlds: string[] = [];
  const saves = path.join(root, 'saves');
  await checkGamePath(saves, true);
  const entries = await readdir(saves, { withFileTypes: true }).catch((e) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  });
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !launchOptionsSchema.safeParse({
        fullscreen: false,
        target: { kind: 'world', name: entry.name },
      }).success
    )
      continue;
    const file = path.join(saves, entry.name, 'level.dat');
    await checkGamePath(file, true);
    if (
      (
        await lstat(file).catch((e) => {
          if (e.code === 'ENOENT') return undefined;
          throw e;
        })
      )?.isFile()
    )
      worlds.push(entry.name);
  }
  return { ...support, worlds: worlds.sort((a, b) => a.localeCompare(b, 'zh-CN')) };
}

export async function prepareLaunchOptions(
  version: Version,
  root: string,
  input?: InstanceLaunchOptions,
  sessionId?: string,
) {
  const options = launchOptionsSchema.parse(
    input ?? { fullscreen: false, target: { kind: 'menu' } },
  );
  const features: Record<string, boolean> = { has_custom_resolution: !options.fullscreen };
  const variables: Record<string, string> = {};
  const support = quickPlaySupport(version);
  // Request the client's world-join record even when the player starts at the main menu.
  const tracksWorld =
    sessionId &&
    selectArguments(version.arguments?.game ?? [], {
      ...features,
      has_quick_plays_support: true,
    }).includes('--quickPlayPath');
  if (tracksWorld || options.target.kind !== 'menu') {
    features.has_quick_plays_support = true;
    variables.quickPlayPath = tracksWorld
      ? `logs/kjmcl-world-${sessionId}.json`
      : 'logs/kjmcl-quick-play.json';
    await checkGamePath(inside(root, variables.quickPlayPath), true);
  }
  if (options.target.kind !== 'menu') {
    const world = options.target.kind === 'world';
    if (!(world ? support.world : support.server))
      throw new Error('此版本不支持快速进入，请在实例设置中选择主菜单');
    features[world ? 'is_quick_play_singleplayer' : 'is_quick_play_multiplayer'] = true;
    if (options.target.kind === 'world') {
      const file = inside(path.join(root, 'saves'), options.target.name + '/level.dat');
      await checkGamePath(file, true);
      const info = await lstat(file).catch((e) => {
        if (e.code === 'ENOENT') return undefined;
        throw e;
      });
      if (!info?.isFile()) throw new Error('存档已不存在，请重新选择');
      variables.quickPlaySingleplayer = options.target.name;
    } else variables.quickPlayMultiplayer = options.target.address;
  }
  return { features, variables, fullscreen: options.fullscreen };
}

// Use one resolved profile and one rule selection for preflight and the game process.
export async function prepareGameLaunch(mc: Minecraft, id: string, sessionId?: string) {
  const { version, client } = await mc.resolved(id);
  const options = await prepareLaunchOptions(
    version,
    mc.store.dir(id),
    mc.store.instance(id).launchOptions,
    sessionId,
  );
  const jvm = selectArguments(
    version.arguments?.jvm?.length
      ? version.arguments.jvm
      : ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
    options.features,
  );
  const classpath = [
    ...mc
      .libraryFiles(version, id)
      .filter((f) => !f.native)
      .map((f) => f.dest),
    client,
  ];
  return { version, client, options, jvm, classpath };
}

export function gameLaunchArguments(
  version: Version,
  variables: Record<string, string>,
  options: { features: Record<string, boolean>; fullscreen: boolean },
) {
  const modern = !!version.arguments?.game?.length;
  const game = expandArguments(
    modern
      ? version.arguments!.game!
      : (version.minecraftArguments ?? '').split(' ').filter(Boolean),
    variables,
    options.features,
  );
  if (!game.length) throw new Error('版本缺少游戏启动参数');
  // Merging a legacy parent with a loader creates arguments.game = [], too.
  if (!modern && !options.fullscreen)
    game.push('--width', variables.resolution_width, '--height', variables.resolution_height);
  if (options.fullscreen && !game.includes('--fullscreen')) game.push('--fullscreen');
  return game;
}
