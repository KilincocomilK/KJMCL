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
      throw new Error(`请求失败 (${r.status}) · ${new URL(url).hostname}`);
    }
    return (await r.json()) as T;
  }
  async download(
    url: string,
    dest: string,
    ctx: { signal: AbortSignal; hash?: string; algorithm?: string; size?: number },
  ) {
    if (ctx.hash && (await exists(dest)) && (await hashFile(dest, ctx.algorithm)) === ctx.hash)
      return;
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = dest + '.' + randomUUID() + '.part';
    for (let attempt = 0; attempt < 3; attempt++) {
      ctx.signal.throwIfAborted();
      try {
        const r = await this.response(url, { signal: ctx.signal }, true, 30 * 60 * 1000);
        if (!r.ok || !r.body) {
          await r.body?.cancel();
          throw new Error(`下载失败 (${r.status}) · ${new URL(url).hostname}`);
        }
        let count = 0;
        const limit = ctx.size ?? 2 * 1024 ** 3;
        await pipeline(
          Readable.fromWeb(r.body as any),
          new Transform({
            transform(chunk, _enc, cb) {
              count += chunk.length;
              cb(count > limit ? new Error('下载文件超过预期大小') : null, chunk);
            },
          }),
          createWriteStream(tmp),
          { signal: ctx.signal },
        );
        if (ctx.size !== undefined && count !== ctx.size) throw new Error('文件大小校验失败');
        if (ctx.hash && (await hashFile(tmp, ctx.algorithm)) !== ctx.hash)
          throw new Error('文件哈希校验失败');
        await rename(tmp, dest);
        return;
      } catch (e) {
        await rm(tmp, { force: true });
        if (ctx.signal.aborted || attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
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
