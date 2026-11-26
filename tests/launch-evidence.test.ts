import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { LaunchSession } from '../shared/types';
import { advanceLaunch, logMilestone, observeWorld } from '../electron/core/launch-evidence';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('recognizes initialization and the current player joining, excluding chat, other users and server startup', () => {
  const join = '[local] logged in with entity id 4 at (2.2, 67.0, -7.1)';
  expect(logMilestone('[17:05:42] [Render thread/INFO]: Setting user: Steve', 'Steve')).toBe(
    'loading',
  );
  expect(
    logMilestone(
      '[Server thread/INFO] Starting integrated minecraft server version 1.21.1',
      'Steve',
    ),
  ).toBe('loading');
  expect(logMilestone('[Server thread/INFO] [minecraft/PlayerList]: Steve' + join, 'Steve')).toBe(
    'world',
  );
  for (const line of [
    'JDK initialized',
    '[Server thread/INFO]: Alex' + join,
    '[Render thread/INFO]: [CHAT] Steve' + join,
    '[Server thread/WARN]: Steve' + join,
    '[Render thread/INFO]: Connecting to server.example, 25565',
    '[Render thread/INFO]: Loaded 171 advancements',
  ]) {
    expect(logMilestone(line, 'Steve')).toBeUndefined();
  }
});

it('records first world entry exactly once and ignores later out-of-order startup evidence', () => {
  const session: LaunchSession = {
    id: 's',
    instanceId: 'i',
    startedAt: 100,
    phase: '启动',
    status: 'running',
    diagnoses: [],
    tail: [],
  };
  expect(advanceLaunch(session, 'java', 100)).toBe(true);
  expect(session.worldEnteredAt).toBeUndefined();
  expect(advanceLaunch(session, 'loading', 150)).toBe(true);
  expect(advanceLaunch(session, 'world', 200)).toBe(true);
  expect(advanceLaunch(session, 'loading', 250)).toBe(false);
  expect(advanceLaunch(session, 'world', 300)).toBe(false);
  expect(session).toMatchObject({ phase: '已进入世界', worldEnteredAt: 200 });
});

it('checks the current launch Quick Play record on exit, rejecting stale, malformed and unrecognized entries', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kjmcl-world-evidence-')));
  roots.push(root);
  const file = path.join(root, 'world.json'),
    now = Date.now();
  const joined = vi.fn();
  const entry = {
    type: 'multiplayer',
    id: 'example.test',
    name: 'Fixture',
    gamemode: 'survival',
    lastPlayedTime: new Date(now).toISOString(),
  };
  for (const bytes of [
    '{',
    '[]',
    JSON.stringify([{ ...entry, type: 'other' }]),
    JSON.stringify([{ ...entry, lastPlayedTime: new Date(now - 3600000).toISOString() }]),
  ]) {
    await writeFile(file, bytes);
    await observeWorld(file, now, joined)();
  }
  expect(joined).not.toHaveBeenCalled();
  await writeFile(file, JSON.stringify([entry]));
  const stop = observeWorld(file, now, joined);
  await stop();
  await stop();
  expect(joined.mock.calls).toEqual([[now]]);
});
