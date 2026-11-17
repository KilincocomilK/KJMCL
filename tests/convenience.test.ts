import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../electron/core/store';
import { moveAccount } from '../electron/core/account-order';
import { redact } from '../electron/core/log-redaction';
import { LogViewBuffer, LOG_VIEW_LIMIT, filterLogs, formatLogs, logLevel } from '../src/log-view';
import type { LogLine } from '../shared/types';
import { schemas } from '../shared/schema';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-convenience-'));
  roots.push(root);
  const store = new Store(root);
  store.data.accounts = ['first', 'second', 'third'].map((id) => ({
    id,
    name: id,
    kind: 'offline',
    uuid: id,
  }));
  store.data.selectedAccountId = 'second';
  store.save();
  return store;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const line = (
  text: string,
  time = 0,
  instanceId = 'game',
  level: LogLine['level'] = 'info',
): LogLine => ({ text, time, instanceId, level });

describe('account ordering', () => {
  it('persists moves while preserving selected identity and all account details', async () => {
    const store = await fixture(),
      accounts = [...store.data.accounts];
    moveAccount(store, 'second', 'up');
    let reopened = new Store(store.root);
    expect(reopened.data.accounts).toEqual([accounts[1], accounts[0], accounts[2]]);
    expect(reopened.data.selectedAccountId).toBe('second');
    moveAccount(store, 'second', 'down');
    reopened = new Store(store.root);
    expect(reopened.data.accounts).toEqual(accounts);
    expect(reopened.data.selectedAccountId).toBe('second');
  });
  it('does not rewrite state for an end-of-list move or a stale account', async () => {
    const store = await fixture(),
      save = vi.spyOn(store, 'save');
    moveAccount(store, 'first', 'up');
    moveAccount(store, 'third', 'down');
    expect(() => moveAccount(store, 'missing', 'up')).toThrow('账户不存在');
    expect(save).not.toHaveBeenCalled();
    expect(() => schemas.moveAccount.parse({ id: 'first', direction: 'sideways' })).toThrow();
    expect(() =>
      schemas.moveAccount.parse({ id: 'first', direction: 'up', path: 'state.json' }),
    ).toThrow();
  });
  it('restores the in-memory order when a save fails', async () => {
    const store = await fixture(),
      previous = store.data.accounts;
    const original = await readFile(path.join(store.root, 'state.json'), 'utf8');
    vi.spyOn(store, 'save').mockImplementation(() => {
      throw new Error('disk failure');
    });
    expect(() => moveAccount(store, 'first', 'down')).toThrow('disk failure');
    expect(store.data.accounts).toBe(previous);
    expect(await readFile(path.join(store.root, 'state.json'), 'utf8')).toBe(original);
  });
});

describe('live log reading', () => {
  it('freezes the visible text while receiving and restores the pending lines on resume', () => {
    const buffer = new LogViewBuffer('game');
    buffer.append(line('before'));
    buffer.pause();
    const frozen = buffer.visible;
    buffer.append(line('during'));
    buffer.append(line('another instance', 0, 'other'));
    expect(buffer.visible).toBe(frozen);
    expect(buffer.visible.map((entry) => entry.text)).toEqual(['before']);
    buffer.resume();
    expect(buffer.visible.map((entry) => entry.text)).toEqual(['before', 'during']);
    buffer.append(line('after'));
    expect(buffer.visible.map((entry) => entry.text)).toEqual(['before', 'during', 'after']);
  });
  it('merges an in-flight snapshot with events without double-counting or deleting repeated messages', () => {
    const buffer = new LogViewBuffer('game');
    buffer.append(line('repeat', 1));
    buffer.append(line('repeat', 1));
    buffer.append(line('later', 2));
    buffer.seed([line('earlier'), line('repeat', 1), line('wrong', 0, 'other')]);
    expect(buffer.visible.map((entry) => entry.text)).toEqual([
      'earlier',
      'repeat',
      'repeat',
      'later',
    ]);
  });
  it('can pause before initial history arrives and keeps bounded history on long-running games', () => {
    const buffer = new LogViewBuffer('game');
    buffer.pause();
    buffer.seed([line('initial')]);
    for (let index = 0; index < LOG_VIEW_LIMIT + 5; index++)
      buffer.append(line(String(index), index));
    expect(buffer.visible).toEqual([]);
    buffer.resume();
    expect(buffer.visible).toHaveLength(LOG_VIEW_LIMIT);
    expect(buffer.visible[0].text).toBe('5');
    expect(buffer.visible.at(-1)?.text).toBe(String(LOG_VIEW_LIMIT + 4));
  });
  it('filters actual Log4j levels and copies only matching already-redacted output', () => {
    const lines = [
      line('[12:00:00] [main/WARN] Warning --accessToken secret'),
      line('[main/INFO] word ERROR inside a message'),
      line('[main/DEBUG] details'),
      line('[main/FATAL] crash'),
      line('plain stderr', 0, 'game', 'error'),
    ].map((entry) => ({ ...entry, text: redact(entry.text) }));
    expect(lines.map(logLevel)).toEqual(['warn', 'info', 'debug', 'error', 'error']);
    const filtered = filterLogs(lines, ' WARNING ', 'warn');
    const copied = formatLogs(filtered);
    expect(copied).toContain('[WARN]');
    expect(copied).toContain('[REDACTED]');
    expect(copied).not.toContain('secret');
    expect(copied).not.toContain('plain stderr');
    expect(filterLogs(lines, '', 'error')).toHaveLength(2);
    expect(filterLogs(lines, 'no match', 'all')).toEqual([]);
  });
});
