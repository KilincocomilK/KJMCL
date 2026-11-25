import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../electron/core/store';
import { VideoSettings } from '../electron/core/video-settings';
import { AssistantStorage } from '../electron/core/assistant/storage';
import { AssistantTools } from '../electron/core/assistant/tools';
import { LocalMcp } from '../electron/core/assistant/mcp';
import type { Secrets } from '../electron/core/vault';
let root: string, storage: AssistantStorage, mcp: LocalMcp, tools: AssistantTools, store: Store;
let vault: Secrets;
let token = '',
  url = '',
  port = 0;
async function freePort() {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  if (!address || typeof address === 'string') throw new Error('缺少端口');
  return address.port;
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-mcp-'));
  store = new Store(root);
  storage = new AssistantStorage(root);
  tools = new AssistantTools(
    store,
    new VideoSettings(store),
    async () => [],
    async (_, work) => work(),
    () => {},
  );
  const secrets = new Map<string, string>();
  vault = {
    get: async (k) => secrets.get(k),
    set: async (k, v) => {
      secrets.set(k, v);
    },
    has: async (k) => secrets.has(k),
  };
  mcp = new LocalMcp(
    storage,
    vault,
    tools,
    () => true,
    () => {},
  );
  port = await freePort();
  await mcp.set({ enabled: true, allowChanges: false, port });
  url = mcp.state().url;
  mcp.copy('token', (t) => {
    token = t;
  });
});
afterEach(async () => {
  await mcp.dispose();
  await rm(root, { recursive: true, force: true });
});
const post = (method: string, params: object, extra: Record<string, string> = {}) =>
  fetch(url, {
    method: 'POST',
    headers: {
      Connection: 'close',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer ' + token,
      'MCP-Protocol-Version': '2025-11-25',
      ...extra,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
async function rpc(method: string, params: object = {}) {
  const r = await post(method, params);
  expect(r.status).toBe(200);
  const body = await r.text();
  const result = JSON.parse(
    body.startsWith('{')
      ? body
      : body
          .split('\n')
          .find((s) => s.startsWith('data:'))!
          .slice(5),
  );
  expect(result.error).toBeUndefined();
  return result.result;
}
it('negotiates the protocol, serves prompts and enforces origin, token and read-only access', async () => {
  const result = await rpc('initialize', {
    protocolVersion: '2025-11-25',
    clientInfo: { name: 'protocol-fixture', version: '1' },
    capabilities: {},
  });
  expect(result.serverInfo.name).toBe('kjmcl');
  expect((await rpc('tools/list')).tools.map((t: { name: string }) => t.name)).not.toContain(
    'configure_launcher',
  );
  expect((await rpc('prompts/list')).prompts.length).toBeGreaterThan(0);
  expect((await post('ping', {}, { Origin: 'https://unrelated.invalid' })).status).toBe(403);
  expect((await post('ping', {}, { Authorization: '' })).status).toBe(401);
  const state = JSON.stringify(mcp.state());
  expect(state).not.toContain(token);
  await mcp.rotate();
  expect((await post('ping', {})).status).toBe(401);
});
it('stages remote changes for local confirmation, reports receipts and revokes pending changes on stop', async () => {
  await mcp.set({ enabled: true, allowChanges: true, port });
  const configure = async (value: number) =>
    JSON.parse(
      (
        await rpc('tools/call', {
          name: 'configure_launcher',
          arguments: { changes: { concurrency: value } },
        })
      ).content[0].text,
    );
  const plan = await configure(4);
  expect(plan.status).toBe('pending');
  expect(store.data.settings.concurrency).toBe(6);
  await tools.decide({ id: plan.id, decision: 'apply' });
  expect(
    JSON.parse(
      (await rpc('tools/call', { name: 'change_status', arguments: { id: plan.id } })).content[0]
        .text,
    ).status,
  ).toBe('applied');
  const pending = await configure(5);
  await mcp.set({ enabled: false, allowChanges: false, port });
  expect(mcp.state().listening).toBe(false);
  await expect(tools.decide({ id: pending.id, decision: 'apply' })).rejects.toThrow();
});
it('serves per-request MCP discovery on the same endpoint as the legacy handshake', async () => {
  const version = '2026-07-28',
    method = 'server/discover';
  const r = await post(
    method,
    {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': version,
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: 'fixture', version: '1' },
      },
    },
    { 'MCP-Protocol-Version': version, 'Mcp-Method': method },
  );
  const json = await r.json();
  expect(json.error).toBeUndefined();
  expect(json.result.supportedVersions).toContain(version);
  expect(json.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('kjmcl');
});
it('keeps the old listener on a port conflict and restores the saved endpoint and token after restart', async () => {
  const occupied = createServer();
  await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  try {
    const address = occupied.address();
    if (!address || typeof address === 'string') throw new Error('无端口');
    await expect(
      mcp.set({ enabled: true, allowChanges: true, port: address.port }),
    ).rejects.toThrow('更换端口');
    expect(mcp.state()).toMatchObject({ port, listening: true, allowChanges: false });
    await mcp.dispose();
    mcp = new LocalMcp(
      new AssistantStorage(root),
      vault,
      tools,
      () => true,
      () => {},
    );
    await mcp.startSaved();
    expect(mcp.state()).toMatchObject({ url, listening: true });
    expect((await post('ping', {})).status).toBe(200);
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});
