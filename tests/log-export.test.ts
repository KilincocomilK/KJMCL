import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../electron/core/store';
import { exportCompleteLog } from '../electron/core/log-export';
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-full-log-'));
  roots.push(root);
  const store = new Store(root);
  store.data.instances.push({
    id: 'game',
    name: 'Game',
    version: '1.21',
    loader: 'vanilla',
    status: 'ready',
    createdAt: 1,
    playTime: 0,
    memoryMb: 2048,
    javaPath: '',
    jvmArgs: [],
    width: 1280,
    height: 720,
  });
  const source = path.join(store.dir('game'), 'logs', 'kjmcl.log');
  await mkdir(path.dirname(source), { recursive: true });
  return { root, store, source, destination: path.join(root, 'export.log') };
}
it('exports all persisted lines beyond the display buffer with credentials and paths redacted', async () => {
  const { root, store, source, destination } = await fixture();
  const lines = Array.from({ length: 3500 }, (_, i) => `line ${i}`);
  await writeFile(
    source,
    lines.join('\n') +
      `\nBearer top-secret\napi_key=hidden\nknown-secret\nplayer@example.com\n${store.dir('game')}`,
  );
  await exportCompleteLog(store, 'game', destination, ['known-secret']);
  const result = await readFile(destination, 'utf8');
  expect(result).toContain('line 0\n');
  expect(result).toContain('line 3499\n');
  for (const secret of ['top-secret', 'hidden', 'known-secret', 'player@example.com', root])
    expect(result).not.toContain(secret);
  expect(result).toContain('[INSTANCE]');
  expect((await readdir(root)).some((f) => f.startsWith('.kjmcl-export-'))).toBe(false);
});
it('does not overwrite existing exports or follow linked logs', async () => {
  const { store, source, destination } = await fixture();
  await writeFile(source, 'game log');
  await writeFile(destination, 'keep this');
  await expect(exportCompleteLog(store, 'game', destination, [])).rejects.toThrow();
  expect(await readFile(destination, 'utf8')).toBe('keep this');
  await rm(path.dirname(source), { recursive: true });
  await mkdir(path.join(store.root, 'elsewhere'));
  await symlink(path.join(store.root, 'elsewhere'), path.dirname(source), 'junction');
  await expect(exportCompleteLog(store, 'game', destination, [])).rejects.toThrow('链接');
});
it('reports missing logs without creating an empty export', async () => {
  const { store, destination } = await fixture();
  await expect(exportCompleteLog(store, 'game', destination, [])).rejects.toThrow('暂无');
  await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('redacts full quoted values and overlapping known secrets, retaining surrounding diagnostics', async () => {
  const { store, source, destination } = await fixture();
  await writeFile(
    source,
    [
      'password="two words" next=keep',
      `api_key='escaped \\'quoted\\' words' next=keep`,
      'client_token="quoted \\"value\\"" next=keep',
      '--password "command line value" next=keep',
      'token-prefix-and-suffix',
      'C:\\Users\\OtherPlayer\\game\\logs',
    ].join('\n'),
  );
  await exportCompleteLog(store, 'game', destination, ['token-prefix', 'token-prefix-and-suffix']);
  const text = await readFile(destination, 'utf8');
  expect(text.match(/next=keep/g)).toHaveLength(4);
  for (const value of ['words', 'quoted', 'command line', '-and-suffix', 'OtherPlayer'])
    expect(text).not.toContain(value);
  expect(text).toContain('[HOME]');
});
it('rejects a non-file source and does not allow exporting onto the source', async () => {
  const { store, source, destination } = await fixture();
  await mkdir(source);
  await expect(exportCompleteLog(store, 'game', destination, [])).rejects.toThrow('日志文件不可用');
  await rm(source, { recursive: true });
  await writeFile(source, 'source must stay');
  await expect(exportCompleteLog(store, 'game', source, [])).rejects.toThrow();
  expect(await readFile(source, 'utf8')).toBe('source must stay');
});
