import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../electron/core/store';
import { VideoSettings } from '../electron/core/video-settings';
import { claimDirectory } from '../electron/core/instances';
import { AssistantTools, type ToolContext } from '../electron/core/assistant/tools';
import type { AiChange } from '../shared/assistant';
let root: string, store: Store, tools: AssistantTools;
const ctx: ToolContext = {
  source: 'assistant',
  chatId: 'chat',
  instanceId: 'one',
  allowChanges: true,
};
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-ai-tools-'));
  store = new Store(root);
  const dir = claimDirectory(store, path.join(root, 'instances/one'), 'one');
  store.data.instances.push({
    id: 'one',
    name: '实例一',
    version: '1.21',
    loader: 'vanilla',
    status: 'empty',
    gameDir: dir,
    createdAt: 1,
    playTime: 0,
    memoryMb: 2048,
    javaPath: '',
    jvmArgs: [],
    width: 1280,
    height: 720,
    performance: { memory: 'auto', collector: 'g1', gcLogging: false },
  });
  tools = new AssistantTools(
    store,
    new VideoSettings(store),
    async () => [],
    async (_, write) => write(),
    () => {},
  );
});
afterEach(() => rm(root, { recursive: true, force: true }));
it('previews, applies and undoes only the requested instance fields', async () => {
  const args = { instanceId: 'one', changes: { memoryMb: 3072, memoryMode: 'manual' } };
  const plan = (await tools.call('configure_instance', args, ctx)) as AiChange;
  expect(store.instance('one').memoryMb).toBe(2048);
  expect(plan.fields.map((f) => f.key)).toContain('memoryMode');
  expect(((await tools.call('configure_instance', args, ctx)) as AiChange).id).toBe(plan.id);
  store.instance('one').width = 1600;
  await tools.decide({ id: plan.id, decision: 'apply' });
  await expect(tools.decide({ id: plan.id, decision: 'apply' })).rejects.toThrow();
  expect(new Store(root).instance('one')).toMatchObject({
    memoryMb: 3072,
    width: 1600,
    performance: { memory: 'manual', collector: 'g1' },
  });
  await tools.decide({ id: plan.id, decision: 'undo' });
  expect(store.instance('one')).toMatchObject({
    memoryMb: 2048,
    width: 1600,
    performance: { memory: 'auto' },
  });
});
it('keeps the automatic memory policy when only its cap changes and serializes conflicting launcher approvals', async () => {
  const p = (await tools.call(
    'configure_instance',
    { instanceId: 'one', changes: { memoryMb: 3072 } },
    ctx,
  )) as AiChange;
  await tools.decide({ id: p.id, decision: 'apply' });
  expect(store.instance('one').performance?.memory).toBe('auto');
  const plans = (await Promise.all(
    [3, 7].map((concurrency) =>
      tools.call('configure_launcher', { changes: { concurrency } }, ctx),
    ),
  )) as AiChange[];
  const results = await Promise.allSettled(
    plans.map(({ id }) => tools.decide({ id, decision: 'apply' })),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(store.data.settings.concurrency).toBe(3);
});
it('rejects stale plans, unsafe settings, out-of-scope reads and read-only proposals', async () => {
  const args = { changes: { concurrency: 8 } };
  const plan = (await tools.call('configure_launcher', args, ctx)) as AiChange;
  store.data.settings.concurrency = 3;
  await expect(tools.decide({ id: plan.id, decision: 'apply' })).rejects.toThrow('已变化');
  expect(store.data.settings.concurrency).toBe(3);
  await expect(
    tools.call('configure_launcher', { changes: { javaPath: 'other' } }, ctx),
  ).rejects.toThrow('参数');
  await expect(
    tools.call('configure_launcher', args, { ...ctx, allowChanges: false }),
  ).rejects.toThrow();
  await expect(
    tools.call('instance_settings', { instanceId: 'one' }, { ...ctx, instanceId: undefined }),
  ).rejects.toThrow();
  const data = await tools.call('launcher_overview', {}, ctx);
  expect(JSON.stringify(data)).not.toContain('javaPath');
});
it('edits actual options.txt through the existing backup and preserves unrelated lines and line endings', async () => {
  const file = path.join(store.dir('one'), 'options.txt');
  const original = 'renderDistance:18\r\nmaxFps:120\r\nunrelated:value\r\n';
  await writeFile(file, original);
  const plan = (await tools.call(
    'configure_video',
    { instanceId: 'one', changes: { renderDistance: 10, maxFps: 90 } },
    ctx,
  )) as AiChange;
  await tools.decide({ id: plan.id, decision: 'apply' });
  expect(await readFile(file, 'utf8')).toBe(original.replace('18', '10').replace('120', '90'));
  await tools.decide({ id: plan.id, decision: 'undo' });
  expect(await readFile(file, 'utf8')).toBe(original);
});
