import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/core/store';
import { prepareGameDirectory } from '../electron/core/welcome-directory';
import { schemas } from '../shared/schema';

let base: string;
let store: Store;
beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kjmcl-welcome-test-')));
  store = new Store(path.join(base, 'data'));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

it('remembers both the player route and step, and rejects incomplete progress', async () => {
  expect(store.data.welcome).toEqual({ step: 'start' });
  store.setWelcome({ step: 'account', player: 'returning' });
  expect(new Store(store.root).data.welcome).toEqual(store.data.welcome);
  expect(schemas.setWelcome.safeParse({ step: 'account' }).success).toBe(false);
  store.setWelcome({ step: 'done' });
  expect(new Store(store.root).data.welcome).toEqual({ step: 'done' });
});

it('upgrades a v9 profile without showing onboarding or changing user settings', async () => {
  const { welcome, ...data } = store.data;
  const legacy = { ...data, schemaVersion: 9, settings: { ...data.settings, memoryMb: 3072 } };
  const original = JSON.stringify(legacy);
  await writeFile(path.join(store.root, 'state.json'), original);
  const upgraded = new Store(store.root);
  expect(upgraded.data.welcome).toEqual({ step: 'done' });
  expect(upgraded.data.settings).toEqual(legacy.settings);
  expect(await readFile(path.join(store.root, 'state.json.v9.bak'), 'utf8')).toBe(original);
});

it('resumes v10 at the same step and records successful actions only for the current guide', async () => {
  const { welcomeConfigured: _, ...previous } = store.data;
  const legacy = {
    ...previous,
    schemaVersion: 10,
    welcome: { step: 'account', player: 'returning' },
  };
  const original = JSON.stringify(legacy);
  await writeFile(path.join(store.root, 'state.json'), original);
  const next = new Store(store.root);
  expect(next.data.welcome).toEqual(legacy.welcome);
  expect(next.data.welcomeConfigured).toEqual([]);
  expect(await readFile(path.join(store.root, 'state.json.v10.bak'), 'utf8')).toBe(original);
  next.markWelcomeConfigured('account');
  next.markWelcomeConfigured('account');
  next.setWelcome({ step: 'assistant', player: 'returning' });
  expect(new Store(store.root).data.welcomeConfigured).toEqual(['account']);
  next.setWelcome({ step: 'done' });
  next.markWelcomeConfigured('account');
  next.setWelcome({ step: 'start' });
  expect(new Store(store.root).data.welcomeConfigured).toEqual([]);
});

it('prepares the root for future instances, supports retry, and preserves existing files', async () => {
  const parent = path.join(base, 'games');
  await mkdir(parent);
  const target = await prepareGameDirectory(store, parent);
  expect(new Store(store.root).data.settings.instancesDir).toBe(target);
  expect(store.data.instances).toEqual([]);
  await writeFile(path.join(target, 'player.txt'), 'owned by user');
  expect(await prepareGameDirectory(store, parent)).toBe(target);
  expect(await prepareGameDirectory(store)).toBe(path.join(store.root, 'instances'));
  expect((await stat(path.join(store.root, 'instances'))).isDirectory()).toBe(true);
  await expect(prepareGameDirectory(store, parent)).rejects.toThrow('已有');
  await expect(prepareGameDirectory(store, store.root)).rejects.toThrow();
  expect(await readFile(path.join(target, 'player.txt'), 'utf8')).toBe('owned by user');
  expect(store.data.settings.instancesDir).toBeUndefined();
});
