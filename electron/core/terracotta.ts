import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rename, rm, lstat, chmod } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { get } from 'node:http';
import { z } from 'zod';
import { hashFile, inside, json, atomicJson } from './files';
import type { Network } from './network';
import type { Work } from './tasks';
import type { TerracottaState } from '../../shared/types';

const version = '0.4.2';
// Pinned official release digests, retrieved from GitHub release metadata. Never execute an unverified download.
const assets: Record<string, { platform: string; arch: string; hash: string }> = {
  'win32-x64': {
    platform: 'windows',
    arch: 'x86_64',
    hash: '07ebe139e3ca5f74576e58b1a96efe59abdfbe148d3f1a49bfdca8b6f70745f0',
  },
  'win32-arm64': {
    platform: 'windows',
    arch: 'arm64',
    hash: 'acfab0a87a02dedc6dab7c05303186c8907f56f815548b693fb3324358da7d14',
  },
  'linux-x64': {
    platform: 'linux',
    arch: 'x86_64',
    hash: '675c4fd6c74d49ed8165151ba2be5b6582e0af20fb6d912074543c2484b1e10a',
  },
  'linux-arm64': {
    platform: 'linux',
    arch: 'arm64',
    hash: '845285ff264ac5fbc16db1a1605ad190e7fa64196516068cc309de5a1d2bf66d',
  },
};
const exceptions = [
  '无法连接房主，请检查房间码或网络',
  '与房主的连接中断',
  '加入方联机进程异常',
  '房主联机进程异常',
  '房主已关闭世界或局域网',
  '联机协议异常，请更新陶瓦',
];
const remoteState = z.object({
  state: z.enum([
    'waiting',
    'host-scanning',
    'host-starting',
    'host-ok',
    'guest-connecting',
    'guest-starting',
    'guest-ok',
    'exception',
  ]),
  index: z.number().int().nonnegative(),
  room: z.string().max(256).optional(),
  url: z.string().max(256).optional(),
  difficulty: z.string().max(40).optional(),
  type: z.number().optional(),
  profiles: z
    .array(
      z.object({
        name: z.string().max(256),
        kind: z.string().max(40),
        vendor: z.string().max(256),
      }),
    )
    .max(256)
    .optional(),
});
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.literal(version),
  executable: z.string(),
  files: z
    .array(z.object({ name: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/) }))
    .min(1)
    .max(2000),
});

export function unpackTerracotta(input: Buffer) {
  const tar = gunzipSync(input, { maxOutputLength: 256 * 1024 ** 2 }),
    files = new Map<string, Buffer>();
  for (let at = 0; at + 512 <= tar.length;) {
    const h = tar.subarray(at, at + 512);
    if (h.every((v) => v === 0)) break;
    const text = (a: number, b: number) => h.toString('utf8', a, b).replace(/\0.*$/, '');
    let sum = 0;
    for (let n = 0; n < 512; n++) sum += n >= 148 && n < 156 ? 32 : h[n];
    if (sum !== parseInt(text(148, 156).trim(), 8)) throw new Error('陶瓦压缩包校验头损坏');
    const name = [text(345, 500), text(0, 100)].filter(Boolean).join('/').replace(/^\.\//, '');
    inside('/terracotta', name);
    const size = parseInt(text(124, 136).trim(), 8),
      type = text(156, 157);
    if (!Number.isSafeInteger(size) || size < 0 || at + 512 + size > tar.length)
      throw new Error('陶瓦压缩包不完整');
    if (type === '0' || type === '') {
      if (files.has(name) || files.size > 2000) throw new Error('陶瓦压缩包条目异常');
      files.set(name, tar.subarray(at + 512, at + 512 + size));
    } else if (!['5', 'x', 'g'].includes(type)) throw new Error('陶瓦压缩包含不支持的链接或条目');
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

export class Terracotta {
  private port?: number;
  private owned = false;
  private lastIndex = -1;
  private last?: TerracottaState;
  private starting?: Promise<void>;
  private polling?: Promise<TerracottaState>;
  private cacheAt = 0;
  private directory: string;
  get active() {
    return !!this.port || !!this.starting;
  }
  constructor(
    root: string,
    private net: Network,
  ) {
    this.directory = path.join(root, 'tools', 'terracotta', version);
  }
  private async manifest() {
    return manifestSchema.parse(await json(path.join(this.directory, 'manifest.json')));
  }
  async installed() {
    try {
      await this.manifest();
      return true;
    } catch {
      return false;
    }
  }
  async install(ctx: Work) {
    if (this.port || this.starting) throw new Error('请先退出陶瓦再安装');
    if (await this.installed()) return;
    const asset = assets[process.platform + '-' + process.arch];
    if (!asset) throw new Error('此平台请先从陶瓦官网安装并运行，然后点击“启动 / 连接”');
    const parent = path.dirname(this.directory);
    await mkdir(parent, { recursive: true });
    const stage = await mkdtemp(path.join(parent, '.install-'));
    try {
      const name = `terracotta-${version}-${asset.platform}-${asset.arch}`;
      const archive = path.join(stage, 'download.tar.gz');
      ctx.progress(5, '下载陶瓦官方组件');
      const assetPath = `/burningtnt/Terracotta/releases/download/v${version}/${name}-pkg.tar.gz`;
      const download = (host: string) => this.net.download(host + assetPath, archive, {
        signal: ctx.signal,
        hash: asset.hash,
        algorithm: 'sha256',
        onProgress: (fraction) => ctx.progress(5 + 65 * fraction, '下载陶瓦官方组件'),
      });
      try {
        await download('https://gitee.com');
      } catch {
        ctx.signal.throwIfAborted();
        await download('https://github.com');
      }
      ctx.progress(70, '校验并解包陶瓦');
      const files = unpackTerracotta(await readFile(archive));
      const executable = [...files.keys()].find(
        (n) => path.basename(n) === name + (process.platform === 'win32' ? '.exe' : ''),
      );
      if (!executable) throw new Error('官方包中没有匹配的可执行文件');
      const entries: { name: string; hash: string }[] = [];
      for (const [name, data] of files) {
        ctx.signal.throwIfAborted();
        const file = inside(stage, name);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, data, { flag: 'wx' });
        entries.push({ name, hash: createHash('sha256').update(data).digest('hex') });
      }
      if (process.platform !== 'win32') await chmod(inside(stage, executable), 0o755);
      await rm(archive);
      await atomicJson(path.join(stage, 'manifest.json'), {
        schemaVersion: 1,
        version,
        executable,
        files: entries,
      });
      ctx.signal.throwIfAborted();
      await rename(stage, this.directory);
      ctx.progress(100, '陶瓦已安装');
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  // Direct loopback requests intentionally bypass user proxy, redirects and renderer networking.
  private request(route: string, port = this.port): Promise<string> {
    if (!port || !Number.isInteger(port) || port < 1 || port > 65535)
      return Promise.reject(new Error('陶瓦尚未连接'));
    return new Promise((resolve, reject) => {
      const req = get({ hostname: '127.0.0.1', port, path: route, agent: false }, (res) => {
        if (res.statusCode !== 200 && res.statusCode !== 204) {
          res.resume();
          reject(new Error(`陶瓦请求失败 (${res.statusCode})`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk) => {
          if ((size += chunk.length) > 1024 ** 2) req.destroy(new Error('陶瓦响应过大'));
          else chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      });
      const timeout = setTimeout(() => req.destroy(new Error('陶瓦响应超时')), 3000);
      req.on('close', () => clearTimeout(timeout));
      req.on('error', reject);
    });
  }
  private async attach(port: number) {
    const meta = JSON.parse(await this.request('/meta', port));
    if (typeof meta.version !== 'string' || typeof meta.easytier_version !== 'string')
      throw new Error('本机服务不是受支持的陶瓦');
    remoteState.parse(JSON.parse(await this.request('/state', port)));
    this.port = port;
    this.lastIndex = -1;
    this.last = undefined;
    this.cacheAt = 0;
    this.last = {
      installed: await this.installed(),
      connected: true,
      version: meta.version.slice(0, 80),
      state: 'waiting',
      members: [],
    };
  }
  async start() {
    if (this.starting) return this.starting;
    this.starting = this.startImpl();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }
  private async startImpl() {
    if (this.port && (await this.status()).connected) return;
    const lock = path.join(
      process.platform === 'darwin' ? os.homedir() : os.tmpdir(),
      'terracotta',
      'terracotta.lock',
    );
    try {
      const b = await readFile(lock);
      if (b.length === 2) {
        await this.attach(b.readUInt16BE());
        this.owned = false;
        return;
      }
    } catch {
      /* stale or absent lock: start our verified component */
    }
    if (!(await this.installed())) throw new Error('请先安装陶瓦组件；macOS 请先运行官方陶瓦应用');
    const manifest = await this.manifest();
    for (const f of manifest.files) {
      const file = inside(this.directory, f.name);
      if ((await lstat(file)).isSymbolicLink() || (await hashFile(file, 'sha256')) !== f.hash)
        throw new Error('陶瓦组件校验失败，请删除组件目录后重新安装');
    }
    if (!manifest.files.some((f) => f.name === manifest.executable))
      throw new Error('组件清单无效');
    const handshakeDir = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-terracotta-')),
      handshake = path.join(handshakeDir, 'port.json');
    const child = spawn(inside(this.directory, manifest.executable), ['--hmcl', handshake], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
      cwd: this.directory,
    });
    let failure: Error | undefined;
    child.on('error', (e) => {
      failure = e;
    });
    child.unref();
    try {
      for (let i = 0; i < 80; i++) {
        if (failure) throw new Error('陶瓦启动失败：' + failure.message);
        try {
          const value = await json<{ port: number }>(handshake);
          await this.attach(value.port);
          this.owned = true;
          return;
        } catch {
          /* handshake not ready */
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      child.kill();
      throw new Error('陶瓦启动超时，请检查系统权限或安全软件后重试');
    } finally {
      await rm(handshakeDir, { recursive: true, force: true });
    }
  }
  async status(): Promise<TerracottaState> {
    if (this.polling) return this.polling;
    if (this.last && Date.now() - this.cacheAt < 400) return this.last;
    this.polling = this.readStatus();
    try {
      return await this.polling;
    } finally {
      this.polling = undefined;
    }
  }
  private async readStatus(): Promise<TerracottaState> {
    const installed = await this.installed();
    if (!this.port) return { installed, connected: false, state: 'offline', members: [] };
    try {
      const s = remoteState.parse(JSON.parse(await this.request('/state')));
      if (s.index > this.lastIndex || !this.last?.connected) {
        this.lastIndex = s.index;
        this.last = {
          installed,
          connected: true,
          version: this.last?.version,
          state: s.state,
          room: s.room,
          address: s.url,
          difficulty: s.difficulty,
          error: s.state === 'exception' ? (exceptions[s.type ?? -1] ?? '未知联机错误') : undefined,
          members: s.profiles ?? [],
        };
      }
      this.cacheAt = Date.now();
      return this.last!;
    } catch {
      this.port = undefined;
      this.lastIndex = -1;
      return (this.last = {
        installed,
        connected: false,
        state: 'offline',
        members: [],
        error: '与陶瓦的连接已断开，请重新连接',
      });
    }
  }
  async control(value: { action: 'host' | 'join' | 'leave'; room?: string; player?: string }) {
    const s = await this.status();
    if (!s.connected) throw new Error('请先启动陶瓦');
    if (value.action !== 'leave' && s.state !== 'waiting')
      throw new Error('请先退出当前房间或重置异常状态');
    if (value.action === 'join' && !value.room?.trim()) throw new Error('请输入房间邀请码');
    const query = new URLSearchParams();
    if (value.player) query.set('player', value.player);
    if (value.action === 'join') query.set('room', value.room!.trim());
    await this.request(
      value.action === 'leave'
        ? '/state/ide'
        : '/state/' + (value.action === 'host' ? 'scanning' : 'guesting') + '?' + query,
    );
    this.cacheAt = 0;
  }
  async dispose() {
    if (this.owned && this.port) await this.request('/panic?peaceful=true').catch(() => {});
    this.port = undefined;
    this.last = undefined;
    this.cacheAt = 0;
    this.owned = false;
  }
}
