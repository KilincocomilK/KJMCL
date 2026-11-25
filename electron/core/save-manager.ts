import path from 'node:path';
import { spawn } from 'node:child_process';
import { lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Store } from './store';
import { assertOwned } from './instances';
import { inside, json, hashFile } from './files';
import { checkGamePath } from './game-folders';
import type {
  SaveMetadata,
  SaveScan,
  SaveRegionView,
  WorldRef,
  WorldRegionRef,
  SavePatch,
  SavePruneReview,
  SaveSelectionRequest,
  RuleChange,
  TerrainTile,
  TerrainTileRequest,
} from '../../shared/types';

interface NativePlan {
  selected: number[];
  files: { relative: string; before: string; indices?: number[] }[];
  guards: { relative: string; before: string | null }[];
  skipped: SavePruneReview['skipped'];
  reclaimedBytes: number;
  levelHash: string;
}
export class SaveManager {
  private verified?: Promise<string>;
  private active = 0;
  private waiting: (() => void)[] = [];
  private tickets = new Map<
    string,
    { request: WorldRef & { dimension: string }; plan: NativePlan; expires: number }
  >();
  constructor(
    private store: Store,
    private binaryDirectory: string,
  ) {}
  private binary() {
    this.verified ??= (async () => {
      const m = await json<{
        schemaVersion: number;
        platform: string;
        arch: string;
        executable: string;
        sha256: string;
      }>(path.join(this.binaryDirectory, 'manifest.json'));
      if (m.schemaVersion !== 1 || m.platform !== process.platform || m.arch !== process.arch)
        throw new Error('存档核心与当前系统架构不匹配，请重新安装对应版本');
      const expected = 'kjmcl-save-manager' + (process.platform === 'win32' ? '.exe' : '');
      if (m.executable !== expected) throw new Error('存档核心清单无效');
      const file = path.join(this.binaryDirectory, expected);
      if ((await lstat(file)).isSymbolicLink() || (await hashFile(file, 'sha256')) !== m.sha256)
        throw new Error('Rust 存档核心校验失败');
      return file;
    })();
    return this.verified;
  }
  async world(ref: WorldRef) {
    await assertOwned(this.store, ref.id);
    const saves = path.join(this.store.dir(ref.id), 'saves'),
      root = inside(saves, ref.world);
    for (const p of [saves, root, path.join(root, 'level.dat')])
      if ((await lstat(p)).isSymbolicLink()) throw new Error('存档目录不能是链接');
    return root;
  }
  async invoke<T>(
    root: string,
    command: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<{ data: T; elapsedMs: number }> {
    if (this.active < 2) this.active++;
    else {
      if (this.waiting.length >= 16) throw new Error('存档核心繁忙，请稍后再试');
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      signal?.throwIfAborted();
      const binary = await this.binary();
      return await new Promise((resolve, reject) => {
        const child = spawn(binary, [], {
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let output = '',
          error = '',
          failed = false;
        const fail = (e: Error) => {
          if (failed) return;
          failed = true;
          child.kill();
          reject(e);
        };
        const abort = () => fail(new Error('存档操作已取消'));
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(
          () => fail(new Error('存档操作超时；若编辑中断，请从编辑历史恢复')),
          120000,
        );
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
          output += chunk;
          if (output.length > 32 * 1024 * 1024) fail(new Error('存档结果过大'));
        });
        child.stderr.on('data', (chunk) => {
          error = (error + chunk).slice(-1000);
        });
        child.on('error', fail);
        child.stdin.on('error', fail);
        child.on('close', (code) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          if (failed) return;
          try {
            const response = JSON.parse(output);
            if (!response.ok) throw new Error(response.error || '存档核心失败');
            if (code !== 0 || response.result?.protocol !== 1) throw new Error('存档核心协议异常');
            resolve(response.result);
          } catch (e) {
            reject(
              e instanceof SyntaxError
                ? new Error('Rust 存档核心异常退出' + (error ? '：' + error : ''))
                : e,
            );
          }
        });
        child.stdin.end(JSON.stringify({ protocol: 1, root, command, ...args }));
        if (signal?.aborted) abort();
      });
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
  async list(id: string) {
    await assertOwned(this.store, id);
    return (await this.invoke<SaveMetadata[]>(path.join(this.store.dir(id), 'saves'), 'list')).data;
  }
  async metadata(ref: WorldRef): Promise<SaveMetadata> {
    return (await this.invoke<SaveMetadata>(await this.world(ref), 'metadata')).data;
  }
  async metadataDirectory(root: string): Promise<SaveMetadata> {
    await checkGamePath(root);
    await checkGamePath(path.join(root, 'level.dat'));
    return (await this.invoke<SaveMetadata>(root, 'metadata')).data;
  }
  async scan(ref: WorldRef): Promise<SaveScan> {
    const r = await this.invoke<Omit<SaveScan, 'elapsedMs'>>(await this.world(ref), 'scan');
    return { ...r.data, elapsedMs: r.elapsedMs };
  }
  async terrainTiles({ id, world, dimension, side, regions }: TerrainTileRequest) {
    return (
      await this.invoke<TerrainTile[]>(await this.world({ id, world }), 'terrain-tiles', {
        dimension,
        side,
        regions,
      })
    ).data;
  }
  async region(ref: WorldRegionRef): Promise<SaveRegionView> {
    const cache = path.join(this.store.root, 'cache', 'save-manager-v1');
    await mkdir(cache, { recursive: true });
    // Bound the persistent cache. Each file holds one region, never trusted for edits.
    const entries = await readdir(cache);
    if (entries.length > 128) {
      const infos = await Promise.all(
        entries.map(async (name) => ({
          name,
          mtime: (await lstat(path.join(cache, name))).mtimeMs,
        })),
      );
      infos.sort((a, b) => a.mtime - b.mtime);
      for (const f of infos.slice(0, entries.length - 96))
        await rm(inside(cache, f.name), { force: true });
    }
    const result = await this.invoke<Omit<SaveRegionView, 'elapsedMs'>>(
      await this.world(ref),
      'region',
      { dimension: ref.dimension, rx: ref.rx, rz: ref.rz, cache },
    );
    return { ...result.data, elapsedMs: result.elapsedMs };
  }
  async plan(
    ref:
      | SaveSelectionRequest
      | (WorldRegionRef & {
          indices: number[];
          protectSpawn: number;
          maxInhabitedTicks?: number;
          beforeTimestamp?: number;
        }),
  ): Promise<SavePruneReview> {
    const { data: plan } = await this.invoke<NativePlan>(
      await this.world(ref),
      'groups' in ref ? 'plan-many' : 'plan',
      { ...ref },
    );
    const token = randomUUID();
    for (const [key, t] of this.tickets) if (t.expires < Date.now()) this.tickets.delete(key);
    if (this.tickets.size >= 20) this.tickets.delete(this.tickets.keys().next().value!);
    this.tickets.set(token, {
      request: { id: ref.id, world: ref.world, dimension: ref.dimension },
      plan,
      expires: Date.now() + 10 * 60_000,
    });
    return {
      token,
      count: plan.selected.length,
      files: plan.files.length,
      reclaimedBytes: plan.reclaimedBytes,
      skipped: plan.skipped,
    };
  }
  ticket(token: string) {
    const t = this.tickets.get(token);
    if (!t || t.expires < Date.now()) throw new Error('清理预览已过期，请重新预览');
    return t;
  }
  async apply(token: string, signal?: AbortSignal) {
    const t = this.ticket(token);
    this.tickets.delete(token);
    await this.invoke(
      await this.world(t.request),
      'apply',
      { plan: t.plan, transaction: randomUUID() },
      signal,
    );
  }
  async edit(ref: WorldRef, patch: SavePatch) {
    await this.invoke(await this.world(ref), 'edit', { patch, transaction: randomUUID() });
  }
  async editRules(ref: WorldRef, changes: RuleChange[]) {
    await this.invoke(await this.world(ref), 'rules', { changes, transaction: randomUUID() });
  }
  async undo(ref: WorldRef, transaction: string) {
    await this.invoke(await this.world(ref), 'undo', { transaction });
  }
}
