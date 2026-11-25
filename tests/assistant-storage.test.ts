import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { AssistantStorage } from '../electron/core/assistant/storage';
import { Providers } from '../electron/core/assistant/provider';
import type { Network } from '../electron/core/network';
import { apiBase } from '../shared/assistant';
import { Response } from 'undici';

describe('assistant settings and credentials', () => {
  let root: string, storage: AssistantStorage, providers: Providers;
  let keys: Map<string, string>;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-assistant-'));
    storage = new AssistantStorage(root);
    keys = new Map();
    providers = new Providers(
      storage,
      {
        get: async (id) => keys.get(id),
        has: async (id) => keys.has(id),
        set: async (id, value) => {
          if (value) keys.set(id, value);
          else keys.delete(id);
        },
      },
      {} as Network,
    );
  });
  afterEach(() => rm(root, { recursive: true, force: true }));
  it('keeps keys in the vault, preserves them on ordinary edits and detaches them on an endpoint change', async () => {
    const p = {
      id: randomUUID(),
      name: 'Test',
      baseUrl: 'https://fixture.invalid/v1',
      enabled: true,
      models: ['local'],
    };
    await providers.save({ ...p, key: 'fixture-private-key' });
    await providers.save({ ...p, name: 'Renamed' });
    expect(keys.size).toBe(1);
    expect(new AssistantStorage(root).config.selection).toEqual({
      providerId: p.id,
      model: 'local',
    });
    expect(await readFile(path.join(root, 'assistant/config.json'), 'utf8')).not.toContain(
      'fixture-private-key',
    );
    expect(providers.list().find((v) => v.id === p.id)).not.toHaveProperty('credential');
    await providers.save({ ...p, baseUrl: 'https://fixture.invalid/other' });
    expect(keys.size).toBe(0);
    expect(providers.get(p.id).credential).toBeUndefined();
    await providers.remove(p.id);
    expect(storage.config.selection).toBeUndefined();
  });
  it('preserves unknown versions and rejects URLs with inline secrets or nonlocal HTTP', async () => {
    expect(storage.config.mcp.enabled).toBe(false);
    const file = path.join(root, 'assistant/config.json');
    await writeFile(file, '{"schemaVersion":99}');
    expect(() => new AssistantStorage(root).config).toThrow('匹配版本');
    expect(await readFile(file, 'utf8')).toBe('{"schemaVersion":99}');
    for (const url of [
      'file:///tmp/model',
      'http://server.test/v1',
      'https://u:p@server.test',
      'https://server.test?key=123',
    ])
      expect(apiBase.safeParse(url).success).toBe(false);
  });
  it('reconciles discontinued remote models while preserving manually added IDs', async () => {
    let advertised = ['old', 'current'];
    const manager = new Providers(
      storage,
      { has: async () => false, get: async () => undefined, set: async () => {} },
      {
        response: async () => Response.json({ data: advertised.map((id) => ({ id })) }),
      } as unknown as Network,
    );
    const p = {
      id: randomUUID(),
      name: 'Test',
      baseUrl: 'https://fixture.invalid',
      enabled: true,
      models: ['manual'],
    };
    await manager.save(p);
    await manager.models(p.id, true);
    manager.select({ providerId: p.id, model: 'old' });
    advertised = ['current', 'new'];
    await manager.models(p.id, true);
    expect(manager.get(p.id).models).toEqual(['manual', 'current', 'new']);
    expect(storage.config.selection?.model).toBe('manual');
    await manager.save({ ...p, baseUrl: 'https://new.invalid', models: manager.get(p.id).models });
    expect(manager.get(p.id).models).toEqual(['manual']);
  });
  it('migrates v1 model profiles and conversations with backups and keeps damaged chats isolated', async () => {
    const current = storage.config;
    const file = path.join(root, 'assistant/config.json');
    await writeFile(
      file,
      JSON.stringify({
        ...current,
        schemaVersion: 1,
        providers: current.providers.map(({ manualModels, ...p }) => ({
          ...p,
          models: ['custom'],
        })),
      }),
    );
    storage.list();
    const id = randomUUID();
    const chatFile = path.join(root, 'assistant/chats', id + '.json');
    const old = {
      schemaVersion: 1,
      id,
      title: '旧对话',
      updatedAt: 12,
      providerId: current.providers[0].id,
      baseUrl: current.providers[0].baseUrl,
      model: 'custom',
      mode: 'chat',
      messages: [{ role: 'user', text: '历史消息', at: 12 }],
    };
    await writeFile(chatFile, JSON.stringify(old));
    const broken = path.join(root, 'assistant/chats', randomUUID() + '.json');
    await writeFile(broken, 'broken');
    const next = new AssistantStorage(root);
    expect(next.config.providers[0].manualModels).toEqual(['custom']);
    expect(JSON.parse(await readFile(file + '.v1.bak', 'utf8')).schemaVersion).toBe(1);
    expect(next.list()).toHaveLength(1);
    expect(next.historyIssue).toContain('无法读取');
    expect(next.chat(id)).toMatchObject({ schemaVersion: 2, messages: old.messages });
    expect(JSON.parse(await readFile(chatFile + '.v1.bak', 'utf8'))).toEqual(old);
    expect(await readFile(broken, 'utf8')).toBe('broken');
  });
});
