import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { Auth } from '../electron/core/auth';
import { Store } from '../electron/core/store';
import { Tasks } from '../electron/core/tasks';
import type { Network } from '../electron/core/network';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'fixture',
    encryptString: () => Buffer.from([1, 2, 3]),
  },
}));

it('records welcome account setup when device authorization finishes on a later page', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-welcome-auth-'));
  const tasks = new Tasks(() => {});
  try {
    const store = new Store(root);
    store.data.settings.microsoftClientId = randomUUID();
    store.setWelcome({ step: 'account', player: 'new' });
    const responses = [
      { device_code: 'device', user_code: 'code', expires_in: 60, interval: 0 },
      { Token: 'xbl' },
      { Token: 'xsts', DisplayClaims: { xui: [{ uhs: 'fixture' }] } },
      { access_token: 'minecraft', expires_in: 3600 },
      { id: '00000000000000000000000000000001', name: 'WelcomeFixture' },
    ];
    const network = {
      json: async () => responses.shift(),
      response: async () => Response.json({ access_token: 'fixture', refresh_token: 'fixture' }),
    } as unknown as Network;
    await new Auth(store, network, tasks, () => {}).begin();
    expect(store.data.welcomeConfigured).toEqual([]);
    store.setWelcome({ step: 'assistant', player: 'new' });
    await vi.waitFor(() => expect(tasks.items[0].status).toBe('completed'));
    const saved = new Store(root);
    expect(saved.data.accounts[0].kind).toBe('microsoft');
    expect(saved.data.welcomeConfigured).toEqual(['account']);
  } finally {
    await tasks.cancelAll();
    await rm(root, { recursive: true, force: true });
  }
});
