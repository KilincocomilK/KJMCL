import path from 'node:path';
import { spawn } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { hashFile } from './files';
import { checkGamePath } from './game-folders';
import type {
  SeedMapInfo,
  SeedMapTile,
  SeedMapTileRequest,
  SeedMapFeaturesRequest,
  SeedMapFeatures,
  SeedMapLocateRequest,
  SeedMapLocation,
  SeedMapPointRequest,
  SeedMapBiome,
} from '../../shared/seed-map';
import {
  seedMapTileSchema,
  seedMapFeaturesSchema,
  seedMapLocateSchema,
  seedMapPointSchema,
} from '../../shared/seed-map';
import { localBiomeName, seedStructureLabels } from '../../shared/seed-labels';

export interface SeedNativeResponse<T = unknown> {
  protocol: number;
  data: T;
  elapsedMs: number;
}
export type SeedNativeRunner = (
  command: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<SeedNativeResponse>;
type Job = {
  id: string;
  controller: AbortController;
  start: () => void;
  reject: (error: Error) => void;
  started: boolean;
};
export class SeedMapEngine {
  private verified?: Promise<string>;
  private catalog?: Promise<SeedMapInfo>;
  private active = 0;
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private cache = new Map<string, SeedMapTile>();
  private closed = false;
  private cancelled = new Set<string>();
  private epoch = 0;
  constructor(
    private directory: string,
    private runner?: SeedNativeRunner,
  ) {}
  private binary(): Promise<string> {
    this.verified ??= (async () => {
      await checkGamePath(this.directory);
      const manifestFile = path.join(this.directory, 'manifest.json');
      await checkGamePath(manifestFile);
      if ((await lstat(manifestFile)).size > 16384) throw new Error('种子地图核心清单无效');
      const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
      const name = 'kjmcl-seed-map' + (process.platform === 'win32' ? '.exe' : '');
      if (
        manifest.schemaVersion !== 1 ||
        manifest.platform !== process.platform ||
        manifest.arch !== process.arch ||
        manifest.executable !== name
      )
        throw new Error('种子地图核心与系统不匹配');
      const file = path.join(this.directory, name);
      await checkGamePath(file);
      if (
        (await lstat(file)).isSymbolicLink() ||
        (await hashFile(file, 'sha256')) !== manifest.sha256
      )
        throw new Error('种子地图核心校验失败');
      return file;
    })().catch((error) => {
      this.verified = undefined;
      throw error;
    });
    return this.verified;
  }
  private async execute(
    command: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<SeedNativeResponse> {
    signal.throwIfAborted();
    if (this.runner) return this.runner(command, args, signal);
    const binary = await this.binary();
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = spawn(binary, [], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '',
        stderr = '',
        settled = false;
      const finish = (error?: Error, result?: SeedNativeResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (error) {
          child.kill();
          reject(error);
        } else resolve(result!);
      };
      const abort = () => finish(new Error('地图计算已取消'));
      const timer = setTimeout(() => finish(new Error('地图计算超时，请缩小范围')), 60000);
      signal.addEventListener('abort', abort, { once: true });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (data) => {
        output += data;
        if (output.length > 4 * 1024 * 1024) finish(new Error('地图结果超限'));
      });
      child.stderr.on('data', (data) => {
        stderr = (stderr + data).slice(-500);
      });
      child.on('error', (error) => finish(error));
      child.stdin.on('error', (error) => finish(error));
      child.on('close', (code) => {
        if (settled) return;
        try {
          const response = JSON.parse(output);
          if (!response.ok) throw new Error(response.error || '种子地图计算失败');
          if (code !== 0 || response.result?.protocol !== 1) throw new Error('种子地图协议异常');
          finish(undefined, response.result);
        } catch (error) {
          finish(
            error instanceof SyntaxError
              ? new Error('种子地图核心异常退出' + (stderr ? '：' + stderr : ''))
              : (error as Error),
          );
        }
      });
      child.stdin.end(JSON.stringify({ protocol: 1, command, ...args }));
      if (signal.aborted) abort();
    });
  }
  private schedule<T>(
    command: string,
    args: Record<string, unknown>,
    id: string,
  ): Promise<SeedNativeResponse<T>> {
    if (this.closed) return Promise.reject(new Error('地图核心已关闭'));
    if (this.cancelled.has(id)) return Promise.reject(new Error('地图计算已取消'));
    if (this.jobs.has(id)) return Promise.reject(new Error('地图请求编号重复'));
    if (this.jobs.size >= 64) return Promise.reject(new Error('地图请求过多，请稍候'));
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const job: Job = {
        id,
        controller,
        reject,
        started: false,
        start: () => {
          job.started = true;
          this.active++;
          void this.execute(command, args, controller.signal)
            .then((result) => {
              if (controller.signal.aborted) throw new Error('地图计算已取消');
              resolve(result as SeedNativeResponse<T>);
            })
            .catch(reject)
            .finally(() => {
              this.active--;
              this.jobs.delete(id);
              this.pump();
            });
        },
      };
      this.jobs.set(id, job);
      this.queue.push(job);
      this.pump();
    });
  }
  private pump() {
    while (this.active < 2 && this.queue.length) {
      const job = this.queue.shift()!;
      if (!job.controller.signal.aborted) job.start();
    }
  }
  cancel(id: string) {
    this.cancelled.add(id);
    while (this.cancelled.size > 256) this.cancelled.delete(this.cancelled.values().next().value!);
    const job = this.jobs.get(id);
    if (!job) return;
    job.controller.abort();
    if (!job.started) {
      this.queue = this.queue.filter((item) => item !== job);
      this.jobs.delete(id);
      job.reject(new Error('地图计算已取消'));
    }
  }
  cancelAll() {
    this.epoch++;
    for (const id of this.jobs.keys()) this.cancel(id);
  }
  dispose() {
    this.closed = true;
    this.cancelAll();
    this.cache.clear();
  }
  info(): Promise<SeedMapInfo> {
    this.catalog ??= this.schedule<SeedMapInfo>('info', {}, 'info_' + randomUUID())
      .then(({ data }) => {
        if (
          !Array.isArray(data.versions) ||
          !data.versions.length ||
          !Array.isArray(data.biomes) ||
          !Array.isArray(data.structures)
        )
          throw new Error('地图版本目录无效');
        return {
          ...data,
          versions: data.versions.map((v) => ({
            ...v,
            name: v.name.replace('(experimental)', '（实验）'),
          })),
          biomes: data.biomes.map((b) => ({ ...b, name: localBiomeName(b.name) })),
          structures: data.structures.map((s) => ({
            ...s,
            name: seedStructureLabels[s.id] ?? s.name,
          })),
        };
      })
      .catch((error) => {
        this.catalog = undefined;
        throw error;
      });
    return this.catalog;
  }
  private async version(version: string) {
    if (!(await this.info()).versions.some((v) => v.id === version))
      throw new Error('当前核心不支持此游戏版本，请选择列表中的版本');
  }
  private async prepare(version: string, id: string) {
    const epoch = this.epoch;
    await this.version(version);
    if (this.closed || epoch !== this.epoch || this.cancelled.has(id))
      throw new Error('地图计算已取消');
  }
  async tile(value: SeedMapTileRequest): Promise<SeedMapTile> {
    const { requestId, ...query } = seedMapTileSchema.parse(value);
    await this.prepare(query.version, requestId);
    const key = JSON.stringify(query),
      cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return { ...cached, cached: true };
    }
    const response = await this.schedule<SeedMapTile>('tile', query, requestId),
      data = response.data;
    if (
      data.width !== query.size ||
      data.height !== query.size ||
      data.x !== query.x ||
      data.z !== query.z ||
      data.step !== query.step ||
      typeof data.rgba !== 'string' ||
      typeof data.biomes !== 'string' ||
      Buffer.from(data.rgba, 'base64').length !== query.size ** 2 * 4 ||
      Buffer.from(data.biomes, 'base64').length !== query.size ** 2 * 2
    )
      throw new Error('地图像素数据无效');
    const result = { ...data, elapsedMs: response.elapsedMs, cached: false };
    this.cache.set(key, result);
    while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }
  async features(value: SeedMapFeaturesRequest): Promise<SeedMapFeatures> {
    const { requestId, ...query } = seedMapFeaturesSchema.parse(value);
    await this.prepare(query.version, requestId);
    const r = await this.schedule<SeedMapFeatures>('features', query, requestId);
    if (!Array.isArray(r.data.items) || r.data.items.length > query.limit)
      throw new Error('结构结果无效');
    return { ...r.data, elapsedMs: r.elapsedMs };
  }
  async locate(value: SeedMapLocateRequest): Promise<SeedMapLocation> {
    const { requestId, ...query } = seedMapLocateSchema.parse(value);
    await this.prepare(query.version, requestId);
    const r = await this.schedule<SeedMapLocation>('locate', query, requestId);
    if (!Array.isArray(r.data.items) || r.data.items.length > query.limit)
      throw new Error('查找结果无效');
    return { ...r.data, elapsedMs: r.elapsedMs };
  }
  async biome(value: SeedMapPointRequest): Promise<SeedMapBiome> {
    const { requestId, ...query } = seedMapPointSchema.parse(value);
    await this.prepare(query.version, requestId);
    const r = await this.schedule<SeedMapBiome>('biome', query, requestId);
    return { ...r.data, name: localBiomeName(r.data.name) };
  }
}
