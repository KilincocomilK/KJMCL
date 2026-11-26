import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { Response } from 'undici';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Auth } from '../electron/core/auth';
import { kjmclClientId } from '../electron/core/microsoft-client';
import { Network } from '../electron/core/network';
import { Store } from '../electron/core/store';
import { Tasks } from '../electron/core/tasks';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'fixture',
    encryptString: () => Buffer.from([1, 2, 3]),
  },
}));

const authority = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const endpoints = {
  code: authority + '/devicecode',
  token: authority + '/token',
  xbl: 'https://user.auth.xboxlive.com/user/authenticate',
  xsts: 'https://xsts.auth.xboxlive.com/xsts/authorize',
  login: 'https://api.minecraftservices.com/authentication/login_with_xbox',
  profile: 'https://api.minecraftservices.com/minecraft/profile',
};
const fixtureToken = 'private-test-token';
let root: string;
let store: Store;
let tasks: Tasks;
let auth: Auth;
let network: Network;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-welcome-auth-'));
  store = new Store(root);
  store.data.settings.microsoftClientId = randomUUID();
  store.setWelcome({ step: 'account', player: 'new' });
  tasks = new Tasks(() => {});
  network = new Network(() => store.data.settings);
  auth = new Auth(store, network, tasks, () => {});
});
afterEach(async () => {
  await tasks.cancelAll();
  await rm(root, { recursive: true, force: true });
});

function mockEndpoints(overrides: Partial<Record<keyof typeof endpoints, Response | Error>> = {}) {
  const replies = {
    code: Response.json({
      device_code: 'device',
      user_code: 'code',
      verification_uri: 'https://microsoft.com/link',
      expires_in: 60,
      interval: 0,
    }),
    token: Response.json({
      access_token: fixtureToken + '-ms',
      refresh_token: fixtureToken + '-refresh',
    }),
    xbl: Response.json({ Token: fixtureToken + '-xbl' }),
    xsts: Response.json({
      Token: fixtureToken + '-xsts',
      DisplayClaims: { xui: [{ uhs: 'test-uhs' }] },
    }),
    login: Response.json({ access_token: fixtureToken + '-mc', expires_in: 3600 }),
    profile: Response.json({ id: '00000000000000000000000000000001', name: 'WelcomeFixture' }),
    ...overrides,
  };
  const byUrl = new Map(
    Object.entries(endpoints).map(([key, url]) => [url, replies[key as keyof typeof endpoints]]),
  );
  return vi.spyOn(network, 'response').mockImplementation(async (url) => {
    const reply = byUrl.get(url);
    if (!reply) throw new Error('unexpected test endpoint: ' + url);
    if (reply instanceof Error) throw reply;
    return reply;
  });
}

it('reauthorizes with the original application and rejects a different Minecraft profile', async () => {
  const account = {
    id: randomUUID(),
    uuid: '10000000000000000000000000000001',
    name: '原角色',
    kind: 'microsoft' as const,
    microsoftClientId: randomUUID(),
  };
  store.data.accounts.push(account);
  const requests = mockEndpoints();
  await auth.begin(account.id);
  await vi.waitFor(() => expect(tasks.items[0].status).toBe('failed'));
  expect(tasks.items[0].detail).toContain('角色与待授权账户不同');
  const request = requests.mock.calls.find(([url]) => url === endpoints.code)![1]!;
  expect(new URLSearchParams(request.body as string).get('client_id')).toBe(
    account.microsoftClientId,
  );
  expect(store.data.accounts).toEqual([account]);
});

it.each(['builtin', 'custom'])(
  'uses the %s client for device and token requests and remembers it on the account',
  async (choice) => {
    if (choice === 'builtin') store.data.settings.microsoftClientId = '';
    const client = store.data.settings.microsoftClientId || kjmclClientId;
    const requests = mockEndpoints();
    const code = await auth.begin();
    expect(code.userCode).toBe('code');
    expect(auth.pendingCode).toEqual(code);
    expect(store.data.welcomeConfigured).toEqual([]);
    store.setWelcome({ step: 'assistant', player: 'new' });
    await vi.waitFor(() => expect(tasks.items[0].status).toBe('completed'));
    expect(auth.pendingCode).toBeUndefined();
    const saved = new Store(root);
    const account = saved.data.accounts[0];
    expect(account).toMatchObject({
      kind: 'microsoft',
      name: 'WelcomeFixture',
      microsoftClientId: client,
    });
    expect(saved.data.selectedAccountId).toBe(account.id);
    expect(saved.data.welcomeConfigured).toEqual(['account']);
    expect(await auth.token(account)).toBe(fixtureToken + '-mc');
    expect(await readFile(path.join(root, 'state.json'), 'utf8')).not.toContain(fixtureToken);
    expect(requests.mock.calls.map(([url]) => url)).toEqual(Object.values(endpoints));
    const requestFor = (url: string) => requests.mock.calls.find(([target]) => target === url)![1]!;
    for (const url of [endpoints.code, endpoints.token])
      expect(new URLSearchParams(requestFor(url).body as string).get('client_id')).toBe(client);
    for (const url of [endpoints.xbl, endpoints.xsts]) {
      const headers = new Headers(requestFor(url).headers);
      expect(headers.get('accept')).toBe('application/json');
      expect(headers.get('x-xbl-contract-version')).toBe('1');
    }
    expect(JSON.parse(String(requestFor(endpoints.xbl).body)).Properties.RpsTicket).toBe(
      'd=' + fixtureToken + '-ms',
    );
    expect(JSON.parse(String(requestFor(endpoints.login).body)).identityToken).toBe(
      'XBL3.0 x=test-uhs;' + fixtureToken + '-xsts',
    );
    expect(new Headers(requestFor(endpoints.profile).headers).get('authorization')).toBe(
      'Bearer ' + fixtureToken + '-mc',
    );
  },
);

async function failedLogin(stage: 'login' | 'profile', response: Response | Error) {
  const requests = mockEndpoints({ [stage]: response });
  await auth.begin();
  await vi.waitFor(() => expect(tasks.items[0].status).toBe('failed'));
  expect(auth.pendingCode).toBeUndefined();
  const saved = new Store(root);
  expect(saved.data.accounts).toEqual([]);
  expect(saved.data.selectedAccountId).toBeUndefined();
  expect(saved.data.welcomeConfigured).toEqual([]);
  await expect(stat(path.join(root, 'credentials'))).rejects.toMatchObject({ code: 'ENOENT' });
  const called = requests.mock.calls.map(([url]) => url);
  expect(called).toEqual(
    stage === 'login' ? Object.values(endpoints).slice(0, -1) : Object.values(endpoints),
  );
  const message = tasks.items[0].detail;
  expect(message).not.toContain(fixtureToken);
  return message;
}

it.each([
  { error: 'ForbiddenOperationException', errorMessage: 'Invalid app registration' },
  { developerMessage: 'See https://aka.ms/AppRegInfo for more information.' },
  { details: { reason: 'Invalid app registration' } },
])('explains a Minecraft application registration refusal after Xbox sign-in', async (body) => {
  const message = await failedLogin('login', Response.json(body, { status: 403 }));
  expect(message).toMatch(/Client ID/i);
  expect(message).toMatch(/Minecraft/i);
  expect(message).not.toMatch(/未购买|未拥有/);
});

it('distinguishes a missing player profile after Minecraft granted an access token', async () => {
  const message = await failedLogin(
    'profile',
    Response.json({ error: 'NOT_FOUND' }, { status: 404 }),
  );
  expect(message).toMatch(/Java/);
  expect(message).toMatch(/角色|档案/);
  expect(message).toMatch(/创建|设置/);
  expect(message).not.toMatch(/Client ID|未购买|未拥有/i);
});

it('gives a network failure its own diagnosis when loading the player profile', async () => {
  const message = await failedLogin('profile', new Error('fetch failed ' + fixtureToken));
  expect(message).toMatch(/网络|连接|超时/);
  expect(message).not.toMatch(/未购买|未拥有|创建角色|Client ID/i);
});

it('preserves generic Minecraft 403 errors without assigning a registration or ownership cause', async () => {
  const message = await failedLogin(
    'login',
    Response.json({ error: 'ForbiddenOperationException', message: fixtureToken }, { status: 403 }),
  );
  expect(message).toMatch(/拒绝/);
  expect(message).not.toMatch(/Invalid app registration|未购买|未拥有|已暂停|停用/i);
});

it('identifies a suspended Minecraft account separately from a generic refusal', async () => {
  const message = await failedLogin(
    'login',
    Response.json({ details: { reason: 'ACCOUNT_SUSPENDED' } }, { status: 403 }),
  );
  expect(message).toMatch(/封禁|限制|停用|暂停/);
  expect(message).not.toMatch(/Client ID/i);
});

it('clears the public device code on cancellation without exchanging any tokens', async () => {
  const requests = mockEndpoints();
  await auth.begin();
  expect(auth.pendingCode?.userCode).toBe('code');
  auth.cancel();
  await vi.waitFor(() => expect(tasks.items[0].status).toBe('cancelled'));
  expect(auth.pendingCode).toBeUndefined();
  expect(requests.mock.calls.map(([url]) => url)).toEqual([endpoints.code]);
  expect(store.data.accounts).toEqual([]);
});
