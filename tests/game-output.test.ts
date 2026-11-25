import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { GameOutput } from '../electron/core/game-logs';
import { RecentGameLogs } from '../shared/recent-logs';

it('archives a burst in order with one batch, retains the last 2000 lines and drains the final partial line', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-game-output-'));
  try {
    const file = path.join(root, 'kjmcl.log');
    await writeFile(file, 'previous session\n');
    const disk = createWriteStream(file, { flags: 'a' });
    const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
    const ends = Promise.all([once(pipes.stdout, 'end'), once(pipes.stderr, 'end')]);
    const history = new RecentGameLogs();
    const batches: number[] = [];
    const output = new GameOutput(pipes, disk, 'game', 'private-fixture', (lines) => {
      for (const line of lines) history.append(line);
      batches.push(lines.length);
    });
    const texts = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    const writes = vi.spyOn(disk, 'write');
    pipes.stdout.write(texts.join('\n') + '\n');
    expect(writes).toHaveBeenCalledTimes(1);
    expect(batches).toEqual([5000]);
    await output.flush();
    const snapshot = await readFile(file, 'utf8');
    expect(snapshot).toMatch(/^previous session\n/);
    expect(
      snapshot
        .trimEnd()
        .split('\n')
        .slice(1)
        .map((line) => line.slice(25)),
    ).toEqual(texts);
    pipes.stdout.end();
    pipes.stderr.write('partial private-');
    pipes.stderr.end('fixture');
    await ends;
    output.write('info', 'exit');
    await output.close();
    const recent = history.snapshot();
    expect(recent).toHaveLength(2000);
    expect(recent[0].text).toBe('line 3002');
    expect(recent.at(-2)).toMatchObject({ text: 'partial [REDACTED]', level: 'error' });
    const complete = await readFile(file, 'utf8');
    expect(complete).not.toContain('private-fixture');
    expect(
      complete
        .trimEnd()
        .split('\n')
        .slice(-2)
        .map((line) => line.slice(25)),
    ).toEqual(['partial [REDACTED]', 'exit']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('resumes both pipes after a stalled disk write fails and keeps receiving diagnostics', async () => {
  let finishWrite!: (error?: Error | null) => void;
  const disk = new Writable({
    highWaterMark: 1,
    write(_data, _encoding, callback) {
      finishWrite = callback;
    },
  });
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const ends = Promise.all([once(pipes.stdout, 'end'), once(pipes.stderr, 'end')]);
  const history = new RecentGameLogs();
  const output = new GameOutput(pipes, disk, 'game', '', (lines) => {
    for (const line of lines) history.append(line);
  });
  pipes.stdout.write('first\n');
  expect(pipes.stdout.isPaused()).toBe(true);
  expect(pipes.stderr.isPaused()).toBe(true);
  pipes.stdout.end('last stdout');
  pipes.stderr.end('last stderr');
  finishWrite(new Error('disk full'));
  await ends;
  await expect(output.flush()).rejects.toThrow('日志写入失败');
  await output.close();
  expect(history.snapshot().map((line) => line.text)).toEqual(
    expect.arrayContaining([
      'first',
      'last stdout',
      'last stderr',
      expect.stringContaining('日志写入失败'),
    ]),
  );
});
