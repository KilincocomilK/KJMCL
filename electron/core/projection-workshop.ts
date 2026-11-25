import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mkdir, lstat, readFile, writeFile, copyFile, unlink, rmdir } from 'node:fs/promises';
import { z } from 'zod';
import { PNG } from 'pngjs';
import { checkGamePath } from './game-folders';
import { hashFile, atomicJson } from './files';
import { safeExport } from './safe-export';
import {
  projectionOpSchema,
  projectionBlockSchema,
  projectionSelectionSchema,
  type ProjectionData,
  type ProjectionDocument,
  type ProjectionState,
  type ProjectionOp,
  type ProjectionSelection,
} from '../../shared/projection';
const entrySchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(80),
    modifiedAt: z.number(),
    history: z.array(z.uuid()).min(1).max(21),
    cursor: z.number().int().min(0).max(20),
  })
  .strict()
  .refine((v) => v.cursor < v.history.length);
const indexSchema = z
  .object({
    schemaVersion: z.literal(1),
    current: z.uuid().nullable(),
    entries: z.array(entrySchema).max(32),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.entries.map((e) => e.id)).size === v.entries.length &&
      (!v.current || v.entries.some((e) => e.id === v.current)),
  );
type Index = z.infer<typeof indexSchema>;
type Ref = { id: string; revision: string };
export type ProjectionRunner = (command: string, args: Record<string, unknown>) => Promise<unknown>;
export class ProjectionWorkshop {
  private queue: Promise<unknown> = Promise.resolve();
  private count = 0;
  private verified?: Promise<string>;
  constructor(
    private store: { root: string },
    private directory: string,
    private runner?: ProjectionRunner,
  ) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    if (this.count >= 32) return Promise.reject(new Error('投影任务较多，请稍候'));
    this.count++;
    const next = this.queue.then(work);
    this.queue = next
      .catch(() => {})
      .finally(() => {
        this.count--;
      });
    return next;
  }
  async flush() {
    let pending;
    do {
      pending = this.queue;
      await pending;
    } while (pending !== this.queue);
  }
  private async root() {
    const root = path.join(this.store.root, 'projection-workshop');
    await checkGamePath(root, true);
    await mkdir(root, { recursive: true });
    await checkGamePath(root);
    return root;
  }
  private async index(): Promise<Index> {
    const file = path.join(await this.root(), 'index.json');
    await checkGamePath(file, true);
    try {
      if ((await lstat(file)).size > 128 * 1024) throw new Error('投影目录过大');
      return indexSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { schemaVersion: 1, current: null, entries: [] };
      throw new Error('投影目录无法读取，原文件已保留：' + String(error));
    }
  }
  private async commit(index: Index) {
    indexSchema.parse(index);
    const file = path.join(await this.root(), 'index.json');
    for (const suffix of ['', '.tmp', '.bak']) await checkGamePath(file + suffix, true);
    try {
      await copyFile(file, file + '.bak');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await atomicJson(file, index);
  }
  private async file(revision: string) {
    z.uuid().parse(revision);
    const file = path.join(await this.root(), revision + '.kjprojection');
    await checkGamePath(file, true);
    return file;
  }
  private async binary() {
    this.verified ??= (async () => {
      await checkGamePath(this.directory);
      const mf = path.join(this.directory, 'manifest.json');
      await checkGamePath(mf);
      if ((await lstat(mf)).size > 16384) throw new Error('投影核心清单无效');
      const m = JSON.parse(await readFile(mf, 'utf8')),
        name = 'kjmcl-projection' + (process.platform === 'win32' ? '.exe' : '');
      if (
        m.schemaVersion !== 1 ||
        m.platform !== process.platform ||
        m.arch !== process.arch ||
        m.executable !== name
      )
        throw new Error('投影核心与当前系统不匹配');
      const file = path.join(this.directory, name);
      await checkGamePath(file);
      if ((await hashFile(file, 'sha256')) !== m.sha256) throw new Error('投影核心校验失败');
      return file;
    })().catch((e) => {
      this.verified = undefined;
      throw e;
    });
    return this.verified;
  }
  private async invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
    if (this.runner) return (await this.runner(command, args)) as T;
    const binary = await this.binary();
    return new Promise((resolve, reject) => {
      const child = spawn(binary, [], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '',
        done = false;
      const finish = (error?: Error, value?: T) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error) {
          child.kill();
          reject(error);
        } else resolve(value!);
      };
      const timer = setTimeout(() => finish(new Error('投影处理超时，请使用较小的区域')), 120000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data) => {
        output += data;
        if (output.length > 32 * 1024 * 1024) finish(new Error('投影结果过大'));
      });
      child.stderr.resume();
      child.on('error', (e) => finish(e));
      child.stdin.on('error', (e) => finish(e));
      child.on('close', (code) => {
        if (done) return;
        try {
          const r = JSON.parse(output);
          if (!r.ok) throw new Error(r.error || '投影处理失败');
          if (code !== 0 || r.result?.protocol !== 1) throw new Error('投影核心协议无效');
          finish(undefined, r.result.data);
        } catch (e) {
          finish(e instanceof SyntaxError ? new Error('投影核心异常退出') : (e as Error));
        }
      });
      child.stdin.end(JSON.stringify({ protocol: 1, command, ...args }));
    });
  }
  private check(data: ProjectionData): ProjectionData {
    const volume = data.dimensions?.reduce((a, b) => a * b, 1);
    if (
      data.dimensions?.length !== 3 ||
      !data.dimensions?.every((n) => Number.isInteger(n) && n > 0 && n <= 2048) ||
      !volume ||
      volume > 2_000_000 ||
      !Array.isArray(data.palette) ||
      !data.palette.length ||
      !Array.isArray(data.materials) ||
      !Array.isArray(data.warnings) ||
      typeof data.blocks !== 'string' ||
      Buffer.from(data.blocks, 'base64').length !== volume * 4 ||
      !Number.isInteger(data.nonAir) ||
      data.nonAir < 0 ||
      data.nonAir > 250000 ||
      data.palette.length > 65536 ||
      typeof data.name !== 'string' ||
      !data.name.trim() ||
      data.name.length > 256 ||
      typeof data.format !== 'string' ||
      data.format.length > 80 ||
      !Number.isInteger(data.dataVersion) ||
      data.dataVersion < 0 ||
      data.origin?.length !== 3 ||
      !data.origin.every(Number.isSafeInteger) ||
      data.warnings.length > 50 ||
      data.warnings.some((v) => typeof v !== 'string' || v.length > 1000)
    )
      throw new Error('投影体素数据无效');
    for (const block of data.palette) projectionBlockSchema.parse(block);
    const bytes = Buffer.from(data.blocks, 'base64'),
      counts = new Map<number, number>();
    let solids = 0;
    for (let i = 0; i < volume; i++) {
      const id = bytes.readUInt32LE(i * 4);
      if (id >= data.palette.length) throw new Error('投影调色板索引无效');
      if (
        !['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(
          data.palette[id].name,
        )
      ) {
        solids++;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    if (
      solids !== data.nonAir ||
      counts.size !== data.materials.length ||
      new Set(data.materials.map((m) => m.palette)).size !== counts.size ||
      data.materials.some((m) => !Number.isInteger(m.palette) || counts.get(m.palette) !== m.count)
    )
      throw new Error('投影材料统计无效');
    return data;
  }
  private entry(index: Index, id: string) {
    z.uuid().parse(id);
    const e = index.entries.find((e) => e.id === id);
    if (!e) throw new Error('投影作品不存在');
    return e;
  }
  private revision(index: Index, ref: Ref) {
    const e = this.entry(index, ref.id);
    if (e.history[e.cursor] !== ref.revision) throw new Error('投影已更新，请重新打开后操作');
    return e;
  }
  private async document(
    e: Index['entries'][number],
    data?: ProjectionData,
  ): Promise<ProjectionDocument> {
    const revision = e.history[e.cursor];
    const value = this.check(
      data ?? (await this.invoke<ProjectionData>('read', { input: await this.file(revision) })),
    );
    return {
      ...value,
      id: e.id,
      revision,
      canUndo: e.cursor > 0,
      canRedo: e.cursor < e.history.length - 1,
    };
  }
  state(): Promise<ProjectionState> {
    return this.serial(async () => {
      const index = await this.index();
      return {
        current: index.current ? await this.document(this.entry(index, index.current)) : null,
        entries: index.entries.map(({ id, name, modifiedAt }) => ({ id, name, modifiedAt })),
      };
    });
  }
  recover(): Promise<ProjectionState | null> {
    return this.serial(async () => {
      const file = path.join(await this.root(), 'index.json'),
        backup = file + '.bak';
      await checkGamePath(backup, true);
      let index: Index;
      try {
        if ((await lstat(backup)).size > 128 * 1024) throw new Error('投影备份目录过大');
        index = indexSchema.parse(JSON.parse(await readFile(backup, 'utf8')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      for (const e of index.entries) await this.document(e);
      await checkGamePath(file, true);
      await checkGamePath(file + '.tmp', true);
      try {
        await copyFile(
          file,
          path.join(path.dirname(file), 'index.damaged-' + randomUUID() + '.json'),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await atomicJson(file, index);
      return {
        current: index.current ? await this.document(this.entry(index, index.current)) : null,
        entries: index.entries.map(({ id, name, modifiedAt }) => ({ id, name, modifiedAt })),
      };
    });
  }
  async readPreview(input: string, output: string): Promise<ProjectionDocument> {
    const data = this.check(await this.invoke<ProjectionData>('import', { input, output }));
    return { ...data, id: randomUUID(), revision: randomUUID(), canUndo: false, canRedo: false };
  }
  importFile(source: string, resourceKey?: string): Promise<ProjectionDocument> {
    return this.serial(async () => {
      if (!path.isAbsolute(source)) throw new Error('请选择完整文件路径');
      await checkGamePath(source);
      const stat = await lstat(source);
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('投影文件超过 64 MiB');
      let stagingDirectory: string | undefined, stagedSource: string | undefined;
      try {
        let projectId: string = randomUUID();
        if (resourceKey !== undefined) {
          // Hash and parse the same bounded snapshot, even if another app edits the source.
          const directory = path.join(await this.root(), '.import-' + randomUUID());
          await mkdir(directory);
          stagingDirectory = directory;
          stagedSource = path.join(directory, path.basename(source));
          const hash = createHash('sha256');
          let bytes = 0;
          await pipeline(
            createReadStream(source),
            new Transform({
              transform(chunk, _encoding, callback) {
                bytes += chunk.length;
                if (bytes > 64 * 1024 * 1024) return callback(new Error('投影文件超过 64 MiB'));
                hash.update(chunk);
                callback(null, chunk);
              },
            }),
            createWriteStream(stagedSource, { flags: 'wx' }),
          );
          const uuid = createHash('sha256')
            .update('kjmcl-resource-projection-v1\0')
            .update(resourceKey)
            .update('\0')
            .update(hash.digest('hex'))
            .digest()
            .subarray(0, 16);
          uuid[6] = (uuid[6] & 0x0f) | 0x80;
          uuid[8] = (uuid[8] & 0x3f) | 0x80;
          const hex = uuid.toString('hex');
          projectId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        }
        const index = await this.index();
        const existing = index.entries.find((entry) => entry.id === projectId);
        if (existing) {
          const document = await this.document(existing);
          index.current = existing.id;
          await this.commit(index);
          return document;
        }
        if (index.entries.length >= 32) throw new Error('作品库最多保存 32 个投影');
        const revision = randomUUID(),
          file = await this.file(revision);
        try {
          const data = this.check(
            await this.invoke<ProjectionData>('import', {
              input: stagedSource ?? source,
              output: file,
            }),
          );
          const e = {
            id: projectId,
            name: data.name.trim().slice(0, 80) || '未命名投影',
            modifiedAt: Date.now(),
            history: [revision],
            cursor: 0,
          };
          index.entries.unshift(e);
          index.current = e.id;
          await this.commit(index);
          return await this.document(e, data);
        } catch (error) {
          await unlink(file).catch(() => {});
          throw error;
        }
      } finally {
        if (stagedSource) await unlink(stagedSource).catch(() => {});
        if (stagingDirectory) await rmdir(stagingDirectory).catch(() => {});
      }
    });
  }
  open(id: string): Promise<ProjectionDocument> {
    return this.serial(async () => {
      const index = await this.index(),
        e = this.entry(index, id),
        doc = await this.document(e);
      index.current = id;
      await this.commit(index);
      return doc;
    });
  }
  edit(ref: Ref & { op: ProjectionOp }): Promise<ProjectionDocument> {
    return this.serial(async () => {
      projectionOpSchema.parse(ref.op);
      const index = await this.index(),
        e = this.revision(index, ref),
        revision = randomUUID(),
        file = await this.file(revision);
      try {
        const data = this.check(
          await this.invoke<ProjectionData>('edit', {
            input: await this.file(ref.revision),
            output: file,
            op: ref.op,
          }),
        );
        const retained = [...e.history.slice(0, e.cursor + 1), revision].slice(-21),
          removed = e.history.filter((r) => !retained.includes(r));
        e.history = retained;
        e.cursor = retained.length - 1;
        e.modifiedAt = Date.now();
        e.name = data.name.trim().slice(0, 80) || e.name;
        index.current = e.id;
        await this.commit(index);
        for (const r of removed)
          await this.file(r)
            .then((file) => unlink(file))
            .catch(() => {});
        return await this.document(e, data);
      } catch (error) {
        await unlink(file).catch(() => {});
        throw error;
      }
    });
  }
  private move(ref: Ref, delta: number): Promise<ProjectionDocument> {
    return this.serial(async () => {
      const index = await this.index(),
        e = this.revision(index, ref),
        cursor = e.cursor + delta;
      if (cursor < 0 || cursor >= e.history.length)
        throw new Error(delta < 0 ? '没有可撤销的操作' : '没有可重做的操作');
      e.cursor = cursor;
      const doc = await this.document(e);
      e.name = doc.name;
      e.modifiedAt = Date.now();
      index.current = e.id;
      await this.commit(index);
      return doc;
    });
  }
  undo(ref: Ref) {
    return this.move(ref, -1);
  }
  redo(ref: Ref) {
    return this.move(ref, 1);
  }
  select(ref: Ref & { selection: ProjectionSelection }): Promise<{ indices: number[] }> {
    return this.serial(async () => {
      projectionSelectionSchema.parse(ref.selection);
      this.revision(await this.index(), ref);
      const data = await this.invoke<{ indices: number[] }>('select', {
        input: await this.file(ref.revision),
        ...ref.selection,
      });
      if (
        !Array.isArray(data.indices) ||
        data.indices.length > 250000 ||
        data.indices.some((i) => !Number.isInteger(i) || i < 0 || i >= 2_000_000)
      )
        throw new Error('投影选择结果无效');
      return data;
    });
  }
  export(
    ref: Ref,
    format: 'litematic' | 'schem' | 'nbt' | 'materials' | 'png',
    destination: string,
    image?: string,
  ): Promise<void> {
    return this.serial(async () => {
      const e = this.revision(await this.index(), ref);
      await checkGamePath(destination, true);
      await safeExport(destination, async (output) => {
        if (format === 'materials') {
          const doc = await this.document(e);
          const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
          const rows = [
            '方块,属性,数量,组（64）,余数',
            ...doc.materials.map((m) => {
              const b = doc.palette[m.palette];
              return [
                quote(b.name),
                quote(JSON.stringify(b.properties ?? {})),
                m.count,
                Math.floor(m.count / 64),
                m.count % 64,
              ].join(',');
            }),
          ];
          await writeFile(output, '\ufeff' + rows.join('\r\n'), { flag: 'wx' });
        } else if (format === 'png') {
          if (
            !image ||
            image.length > 32 * 1024 * 1024 ||
            !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image)
          )
            throw new Error('截图无效');
          const bytes = Buffer.from(image.slice(22), 'base64');
          if (bytes.length < 33 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a')
            throw new Error('截图无效');
          const width = bytes.readUInt32BE(16),
            height = bytes.readUInt32BE(20);
          if (!width || !height || width > 8192 || height > 8192 || width * height > 16777216)
            throw new Error('截图尺寸过大');
          await writeFile(output, PNG.sync.write(PNG.sync.read(bytes, { checkCRC: true })), {
            flag: 'wx',
          });
        } else if (['litematic', 'schem', 'nbt'].includes(format)) {
          await this.invoke('export', { input: await this.file(ref.revision), output, format });
        } else throw new Error('投影导出格式无效');
      });
    });
  }
  remove(id: string): Promise<void> {
    return this.serial(async () => {
      const index = await this.index(),
        e = this.entry(index, id);
      index.entries = index.entries.filter((i) => i.id !== id);
      if (index.current === id) index.current = null;
      await this.commit(index);
      for (const revision of e.history)
        await this.file(revision)
          .then((file) => unlink(file))
          .catch(() => {});
    });
  }
}
