import { lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { checkGamePath } from './game-folders';
import type { LaunchSession } from '../../shared/types';

export const milestoneLabel = {
  java: 'Java 已启动',
  loading: '游戏加载中',
  world: '已进入世界',
} as const;
export function advanceLaunch(
  session: LaunchSession,
  milestone: keyof typeof milestoneLabel,
  time: number,
) {
  if (
    session.milestone === milestone ||
    session.milestone === 'world' ||
    (session.milestone === 'loading' && milestone === 'java')
  )
    return false;
  session.milestone = milestone;
  session.phase = milestoneLabel[milestone];
  if (milestone === 'world') session.worldEnteredAt = time;
  return true;
}

// Recognize the Minecraft/loader logger, not chat text or the launcher's own messages.
export function logMilestone(line: string, player: string) {
  const m =
    /^(?:\[\d\d?:\d\d:\d\d(?:\.\d+)?\] )?\[(Render thread|Client thread|main|Server thread)\/INFO\](?: \[[^\]\r\n]{1,200}\])?:? (.+)$/.exec(
      line,
    );
  if (!m) return;
  const [, thread, message] = m;
  if (
    thread === 'Server thread' &&
    message.startsWith(player + '[') &&
    /^\[[^\]\r\n]*\] logged in with entity id -?\d+ at \(/.test(message.slice(player.length))
  )
    return 'world';
  if (
    /^(?:Setting user: |Backend library: LWJGL version |Reloading ResourceManager: |Loading Minecraft \S+ with (?:Fabric|Quilt) Loader |Starting integrated minecraft server version )/i.test(
      message,
    )
  )
    return 'loading';
}

async function quickPlayEntry(file: string, started: number) {
  await checkGamePath(file);
  if (!(await lstat(file)).isFile()) return;
  const handle = await open(
    file,
    constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size === 0 || info.size > 65536) return;
    const buffer = Buffer.alloc(info.size);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    for (const entry of Array.isArray(value) ? value : [value]) {
      const time =
        typeof entry?.lastPlayedTime === 'number'
          ? entry.lastPlayedTime
          : Date.parse(entry?.lastPlayedTime);
      if (
        typeof entry?.type === 'string' &&
        /^(singleplayer|multiplayer|realms)$/i.test(entry.type) &&
        typeof entry.id === 'string' &&
        entry.id.length &&
        Number.isFinite(time) &&
        time >= started - 1000 &&
        time <= Date.now() + 1000
      )
        return Math.max(started, Math.min(time, Date.now()));
    }
  } finally {
    await handle.close();
  }
}

/** Each launch supplies a unique output path. Partial writes are retried until process exit. */
export function observeWorld(file: string, started: number, joined: (time: number) => void) {
  let pending: Promise<void> | undefined;
  let confirmed = false;
  const sample = () => {
    if (confirmed) return Promise.resolve();
    return (pending ??= quickPlayEntry(file, started)
      .then((time) => {
        if (time !== undefined) {
          confirmed = true;
          clearInterval(timer);
          joined(time);
        }
      })
      .catch(() => {})
      .finally(() => {
        pending = undefined;
      }));
  };
  const timer = setInterval(() => void sample(), 1500);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pending;
    await sample();
  };
}
