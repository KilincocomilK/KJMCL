import { afterEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Terracotta, unpackTerracotta } from '../electron/core/terracotta';
import { Network } from '../electron/core/network';
import { Store } from '../electron/core/store';
const roots: string[] = [],
  servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});
it('uses official HTTP routes, encodes names and room codes, handles errors and stale responses', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-terra-test-'));
  roots.push(root);
  const store = new Store(root);
  let state: any = { state: 'waiting', index: 1 };
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url!);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/meta') res.end(JSON.stringify({ version: 'v0.4.2', easytier_version: 'v2' }));
    else if (req.url === '/state') res.end(JSON.stringify(state));
    else if (req.url?.includes('/state/guesting') && req.url.includes('bad')) {
      res.statusCode = 400;
      res.end();
    } else res.end();
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port,
    t = new Terracotta(root, new Network(() => store.data.settings));
  await (t as any).attach(port);
  expect((await t.status()).state).toBe('waiting');
  await t.control({ action: 'host', player: '测试 & 玩家' });
  expect(requests.at(-1)).toContain('player=%E6%B5%8B%E8%AF%95');
  expect(requests.at(-1)).toContain('%26');
  state = {
    state: 'host-ok',
    index: 2,
    room: 'test-room',
    profiles: [{ name: 'host', kind: 'HOST', vendor: 'KJMCL' }],
  };
  (t as any).cacheAt = 0;
  expect((await t.status()).room).toBe('test-room');
  await expect(t.control({ action: 'join', room: 'x' })).rejects.toThrow('退出');
  state = { state: 'waiting', index: 1 };
  (t as any).cacheAt = 0;
  expect((await t.status()).state).toBe('host-ok');
  state = { state: 'exception', index: 3, type: 4 };
  (t as any).cacheAt = 0;
  expect((await t.status()).error).toContain('关闭世界');
  await t.control({ action: 'leave' });
  expect(requests.at(-1)).toBe('/state/ide');
  state = { state: 'waiting', index: 4 };
  (t as any).cacheAt = 0;
  await expect(t.control({ action: 'join', room: 'bad' })).rejects.toThrow('400');
  state = { state: 'unrecognized', index: 5 };
  (t as any).cacheAt = 0;
  expect((await t.status()).connected).toBe(false);
});
it('rejects corrupt compressed component archives', () => {
  expect(() => unpackTerracotta(Buffer.from('not gzip'))).toThrow();
});

it.skipIf(
  !['win32', 'linux'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch),
)('tries Gitee first, keeps the pinned digest on fallback and respects cancellation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-terra-source-'));
  roots.push(root);
  const store = new Store(root),
    net = new Network(() => store.data.settings);
  const download = vi.spyOn(net, 'download').mockRejectedValue(new Error('offline'));
  const terracotta = new Terracotta(root, net);
  const abort = new AbortController(),
    ctx = { signal: abort.signal, progress: vi.fn(), setTitle: vi.fn() };
  await expect(terracotta.install(ctx)).rejects.toThrow('offline');
  const [primary, fallback] = download.mock.calls;
  expect(new URL(primary[0]).hostname).toBe('gitee.com');
  expect(fallback[0]).toBe(primary[0].replace('gitee.com', 'github.com'));
  expect(primary[2]).toMatchObject({
    algorithm: 'sha256',
    hash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(fallback[2].hash).toBe(primary[2].hash);
  download.mockClear().mockImplementationOnce(async () => {
    abort.abort();
    throw new Error('cancelled');
  });
  await expect(terracotta.install(ctx)).rejects.toThrow();
  expect(download).toHaveBeenCalledTimes(1);
  expect(await terracotta.installed()).toBe(false);
});
