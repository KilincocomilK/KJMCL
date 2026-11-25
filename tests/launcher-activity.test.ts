import { describe, expect, it, vi } from 'vitest';
import { Response } from 'undici';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { LauncherUpdates } from '../electron/core/launcher-updates';
import { Network } from '../electron/core/network';
import type { Settings } from '../shared/types';
import { fileProgress, progressRange, Tasks, type Work } from '../electron/core/tasks';

const release = (tag: string) => Response.json({ tag_name: tag, draft: false, prerelease: false });

describe('launcher releases', () => {
  it('checks the public GitHub release on entry without configuration or credentials', async () => {
    const response = vi.fn<Network['response']>().mockResolvedValueOnce(release('v0.7.5'));
    const updates = new LauncherUpdates('0.7.4', { response }, () => {});
    await updates.enter();
    expect(response).toHaveBeenCalledWith(
      'https://api.github.com/repos/KilincocomilK/KJMCL/releases/latest',
      { headers: { Accept: 'application/vnd.github+json' }, redirect: 'error' },
      false,
      12000,
    );
    expect(updates.state).toMatchObject({ status: 'available', version: '0.7.5' });
    expect(updates.releaseUrl).toBe('https://github.com/KilincocomilK/KJMCL/releases/tag/v0.7.5');
  });

  it('reads the HTTPS feed on each entry and only announces a newer stable release', async () => {
    const response = vi.fn<Network['response']>();
    const endpoint = 'https://fixture.invalid/launcher.json',
      releaseUrl = 'https://fixture.invalid/release';
    const updates = new LauncherUpdates('1.0.0', { response }, () => {}, endpoint);
    response.mockImplementation(async () => Response.json({ version: '1.1.0', releaseUrl }));
    await updates.enter();
    updates.dismiss('1.1.0');
    await updates.enter();
    expect(response).toHaveBeenCalledTimes(2);
    expect(response.mock.calls[0][0]).toBe(endpoint);
    expect(updates.state).toMatchObject({ status: 'available', notificationDismissed: false });
    expect(updates.releaseUrl).toBe(releaseUrl);
    response.mockResolvedValueOnce(Response.json({ version: '2.0.0-beta.1' }));
    await updates.enter();
    expect(updates.state.status).toBe('unavailable');
    response.mockResolvedValueOnce(Response.json({ version: '1.0.0' }));
    await updates.enter();
    expect(updates.state.status).toBe('current');
    response.mockResolvedValueOnce(Response.json({ version: '2.0.0', releaseUrl: 'file:///test' }));
    await updates.enter();
    expect(updates.state.status).toBe('unavailable');
  });
  function fixture(version = '0.7.3') {
    const response = vi.fn<Network['response']>();
    return { response, updates: new LauncherUpdates(version, { response }, () => {}, 'github') };
  }

  it('compares stable versions numerically, shares in-flight checks and remembers dismissed versions', async () => {
    const { updates, response } = fixture();
    response.mockResolvedValueOnce(release('v0.10.0'));
    await Promise.all([updates.check(), updates.check()]);
    expect(response).toHaveBeenCalledTimes(1);
    expect(updates.state).toMatchObject({ status: 'available', version: '0.10.0' });
    expect(updates.releaseUrl).toBe('https://github.com/KilincocomilK/KJMCL/releases/tag/v0.10.0');
    updates.dismiss('0.10.0');
    response.mockResolvedValueOnce(release('v0.10.0'));
    await updates.check();
    expect(updates.state.notificationDismissed).toBe(true);
    response.mockResolvedValueOnce(release('v0.10.1'));
    await updates.check();
    expect(updates.state.notificationDismissed).toBe(false);
  });

  it('distinguishes inaccessible releases from an empty public release feed', async () => {
    const { updates, response } = fixture();
    response.mockImplementation(async () => new Response(null, { status: 404 }));
    await updates.check();
    expect(updates.state).toMatchObject({ status: 'unavailable', issue: 'access' });
    expect(response.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
    response
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json([]));
    await updates.check();
    expect(updates.state.status).toBe('unpublished');
  });

  it('does not announce older, identical, prerelease or invalid tags', async () => {
    const { updates, response } = fixture();
    for (const tag of ['v0.6.9', '0.7.3+build.2', '0.8.0-rc.1', 'not-a-release']) {
      response.mockResolvedValueOnce(release(tag));
      await updates.check();
      expect(updates.state.status).toBe(
        tag.startsWith('v0.6') || tag.startsWith('0.7') ? 'current' : 'unavailable',
      );
    }
    response.mockRejectedValueOnce(new Error('offline'));
    await updates.check();
    expect(updates.state).toMatchObject({ status: 'unavailable', issue: 'network' });
  });
});

describe('task activity', () => {
  it('reports received bytes before the verified file is published', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-transfer-progress-'));
    const destination = path.join(root, 'download');
    const net = new Network(() => ({ proxy: '', source: 'official' }) as Settings);
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    const response = new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(Uint8Array.of(1, 2));
          await promise;
          controller.enqueue(Uint8Array.of(3, 4));
          controller.close();
        },
      }),
    );
    vi.spyOn(net, 'response').mockResolvedValue(response);
    const onProgress = vi.fn();
    const ctx = {
      signal: new AbortController().signal,
      size: 4,
      hash: createHash('sha1')
        .update(Buffer.from([1, 2, 3, 4]))
        .digest('hex'),
      onProgress,
    };
    const work = net.download('https://fixture.invalid/file', destination, ctx);
    try {
      await vi.waitFor(() => expect(onProgress).toHaveBeenCalledWith(0.5));
      expect(onProgress).not.toHaveBeenCalledWith(1);
      resolve();
      await work;
      expect(onProgress).toHaveBeenLastCalledWith(1);
      expect(await readFile(destination)).toEqual(Buffer.from([1, 2, 3, 4]));
      onProgress.mockClear();
      await net.download('https://fixture.invalid/file', destination, ctx);
      expect(onProgress.mock.calls).toEqual([[1]]);
      expect(net.response).toHaveBeenCalledTimes(1);
    } finally {
      resolve();
      await work.catch(() => {});
      await rm(destination, { force: true });
      await rmdir(root);
    }
  });
  it('estimates remaining time from measured progress and keeps a dismissed job running', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    try {
      const tasks = new Tasks(() => {});
      let work!: Work;
      let complete!: (value: string) => void;
      const result = tasks.run('导入测试实例', 'folders', (ctx) => {
        work = ctx;
        return new Promise<string>((resolve) => {
          complete = resolve;
        });
      });
      const task = tasks.items[0];
      expect(task.remainingSeconds).toBeUndefined();
      clock.mockReturnValue(3000);
      work.progress(20);
      expect(task.remainingSeconds).toBe(8);
      tasks.dismiss(task.id);
      expect(work.signal.aborted).toBe(false);
      expect(task.notificationDismissed).toBe(true);
      work.progress(5);
      expect(task.progress).toBe(20);
      complete('folder-id');
      await expect(result).resolves.toBe('folder-id');
      expect(task).toMatchObject({
        status: 'completed',
        progress: 100,
        notificationDismissed: true,
      });
      expect(task.remainingSeconds).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
  });

  it('maps overlapping transfers and retries to their share of an import', () => {
    const progress = vi.fn();
    const work = progressRange({ progress, signal: new AbortController().signal }, 50, 90);
    const file = fileProgress(work, [3, 1], 0, 100);
    file(0, 0.5, 'first');
    file(1, 1, 'second');
    file(0, 0.25, 'retry');
    file(0, 1, 'verified');
    expect(progress.mock.calls).toEqual([
      [65, 'first'],
      [75, 'second'],
      [90, 'verified'],
    ]);
  });
});
