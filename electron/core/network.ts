import { VERSION } from '../../shared/version';
import { fetch, ProxyAgent, type Dispatcher, type FormData } from 'undici';
import { mkdir, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { exists, hashFile } from './files';
import type { Settings } from '../../shared/types';

class DownloadHttpError extends Error {
  constructor(
    readonly status: number,
    responseUrl: string,
  ) {
    super(`下载失败 (${status}) · ${new URL(responseUrl).hostname}`);
  }
}

export class Network {
  private proxy = '';
  private agent?: Dispatcher;
  constructor(private settings: () => Settings) {}
  private dispatcher() {
    const p = this.settings().proxy;
    if (p !== this.proxy) {
      void this.agent?.close();
      this.proxy = p;
      this.agent = p ? new ProxyAgent(p) : undefined;
    }
    return this.agent;
  }
  url(url: string) {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new Error('下载地址必须使用 HTTPS');
    if (this.settings().source === 'bmclapi') {
      const map: Record<string, string> = {
        'piston-meta.mojang.com': 'https://bmclapi2.bangbang93.com',
        'launchermeta.mojang.com': 'https://bmclapi2.bangbang93.com',
        'piston-data.mojang.com': 'https://bmclapi2.bangbang93.com',
        'launcher.mojang.com': 'https://bmclapi2.bangbang93.com',
        'resources.download.minecraft.net': 'https://bmclapi2.bangbang93.com/assets',
        'libraries.minecraft.net': 'https://bmclapi2.bangbang93.com/maven',
      };
      if (map[u.hostname]) return map[u.hostname] + u.pathname + u.search;
    }
    return url;
  }
  async response(
    url: string,
    options: {
      method?: string;
      body?: string | FormData;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      redirect?: 'follow' | 'error' | 'manual';
    } = {},
    mirror = false,
    timeoutMs = 60000,
  ) {
    if (new URL(url).protocol !== 'https:') throw new Error('仅允许 HTTPS 请求');
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeoutMs),
      ...(options.signal ? [options.signal] : []),
    ]);
    const r = await fetch(mirror ? this.url(url) : url, {
      ...options,
      signal,
      dispatcher: this.dispatcher(),
      headers: { 'User-Agent': `KJMCL/${VERSION} (https://kjmc.top)`, ...options.headers },
    });
    return r;
  }
  async json<T = any>(
    url: string,
    options: Parameters<Network['response']>[1] = {},
    mirror = false,
  ): Promise<T> {
    const r = await this.response(url, options, mirror);
    if (!r.ok) {
      await r.body?.cancel();
      const target = r.url || (mirror ? this.url(url) : url);
      throw new Error(`请求失败 (${r.status}) · ${new URL(target).hostname}`);
    }
    return (await r.json()) as T;
  }
  async download(
    url: string,
    dest: string,
    ctx: {
      signal: AbortSignal;
      hash?: string;
      algorithm?: string;
      size?: number;
      maxBytes?: number;
      allowedOrigins?: readonly string[];
      referer?: string;
      onProgress?: (fraction: number) => void;
    },
  ) {
    if (ctx.hash && (await exists(dest)) && (await hashFile(dest, ctx.algorithm)) === ctx.hash) {
      ctx.onProgress?.(1);
      return;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = dest + '.' + randomUUID() + '.part';
    const preferred = ctx.allowedOrigins ? url : this.url(url);
    let source = preferred;
    let retries = 0;
    for (;;) {
      ctx.signal.throwIfAborted();
      try {
        let target = source;
        const headers = ctx.referer ? { Referer: ctx.referer } : undefined;
        let r = await this.response(
          target,
          { signal: ctx.signal, headers, redirect: ctx.allowedOrigins ? 'manual' : 'follow' },
          false,
          30 * 60 * 1000,
        );
        if (ctx.allowedOrigins) {
          for (let i = 0; [301, 302, 303, 307, 308].includes(r.status); i++) {
            await r.body?.cancel();
            const next = new URL(r.headers.get('location') || '', target);
            if (
              i >= 4 ||
              next.username ||
              next.password ||
              !ctx.allowedOrigins.includes(next.origin)
            )
              throw new Error('下载源返回了不支持的重定向');
            target = next.href;
            r = await this.response(
              target,
              { signal: ctx.signal, headers, redirect: 'manual' },
              false,
              60000,
            );
          }
        }
        if (!r.ok || !r.body) {
          await r.body?.cancel();
          throw new DownloadHttpError(r.status, r.url || target);
        }
        let count = 0,
          reportedAt = -Infinity;
        const limit = Math.min(ctx.size ?? ctx.maxBytes ?? 2 * 1024 ** 3, ctx.maxBytes ?? Infinity);
        const total =
          ctx.size ??
          (r.headers.has('content-encoding') ? 0 : Number(r.headers.get('content-length')));
        await pipeline(
          Readable.fromWeb(r.body as any),
          new Transform({
            transform(chunk, _enc, cb) {
              count += chunk.length;
              if (count > limit) return cb(new Error('下载文件超过预期大小'));
              if (ctx.onProgress && total > 0 && performance.now() - reportedAt >= 160) {
                reportedAt = performance.now();
                ctx.onProgress(Math.min(0.999, count / total));
              }
              cb(null, chunk);
            },
          }),
          createWriteStream(tmp),
          { signal: ctx.signal },
        );
        if (ctx.size !== undefined && count !== ctx.size) throw new Error('文件大小校验失败');
        if (ctx.hash && (await hashFile(tmp, ctx.algorithm)) !== ctx.hash)
          throw new Error('文件哈希校验失败');
        await rename(tmp, dest);
        ctx.onProgress?.(1);
        return;
      } catch (e) {
        await rm(tmp, { force: true });
        ctx.signal.throwIfAborted();
        if (
          preferred !== url &&
          e instanceof DownloadHttpError &&
          (e.status === 404 || e.status === 410)
        ) {
          if (source === url) throw e;
          source = url;
          continue;
        }
        if (retries >= 2) throw e;
        retries++;
        await new Promise((r) => setTimeout(r, 500 * retries));
      }
    }
  }
}
export async function pool<T>(
  items: T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<void>,
  signal: AbortSignal,
) {
  let index = 0;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(items.length, concurrency) }, async () => {
      while (index < items.length && !failure) {
        signal.throwIfAborted();
        const n = index++;
        try {
          await work(items[n], n);
        } catch (e) {
          failure = e;
        }
      }
    }),
  );
  if (failure) throw failure;
  signal.throwIfAborted();
}
