import path from 'node:path';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hashFile, inside } from './files';
import { checkGamePath } from './game-folders';
import type { Store } from './store';
import type { Work } from './tasks';
import type { ModUpdateReceipt } from '../../shared/types';

export const jarName = z
  .string()
  .max(240)
  .regex(/^[^<>:"/\\|?*\x00-\x1f]+\.jar$/i)
  .refine((s) => !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s));
const digest = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .nullable();
const change = z.object({
  name: z
    .string()
    .refine(
      (s) =>
        ['mods-lock.json', 'curseforge-lock.json'].includes(s) ||
        (s.startsWith('mods/') && jarName.safeParse(s.slice(5).replace(/\.disabled$/, '')).success),
    ),
  before: digest,
  after: digest,
});
const manifest = z.object({
  version: z.literal(1),
  instanceId: z.string(),
  updatedAt: z.number(),
  count: z.number().int().positive(),
  files: z.array(change),
});
const marker = z.object({ tx: z.uuid(), attempted: z.number().int().nonnegative() });
type Change = z.infer<typeof change>;
type Side = 'before' | 'after';

export async function regular(file: string) {
  await checkGamePath(file, true);
  try {
    if (!(await lstat(file)).isFile())
      throw new Error('模组或记录文件类型异常：' + path.basename(file));
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}
export async function fingerprint(file: string) {
  return (await regular(file)) ? hashFile(file, 'sha256') : null;
}
async function record<T>(file: string, parse: (v: unknown) => T) {
  try {
    await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return (await regular(file)) ? parse(JSON.parse(await readFile(file, 'utf8'))) : null;
}
async function writeRecord(file: string, value: unknown) {
  await checkGamePath(file, true);
  const temp = path.join(path.dirname(file), '.record-' + randomUUID() + '.tmp');
  try {
    await writeFile(temp, JSON.stringify(value), { flag: 'wx', flush: true });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}
// Keep receipts beside world backups so data migration includes them. Each blob is immutable.
export class ModUpdateHistory {
  constructor(private store: Store) {}
  private root(id: string) {
    this.store.instance(id);
    return inside(this.store.root, 'backups/' + id + '/mod-updates');
  }
  dir(id: string, tx: string) {
    return inside(this.root(id), z.uuid().parse(tx));
  }
  private async lastId(id: string) {
    return record(path.join(this.root(id), 'last.json'), z.uuid().parse);
  }
  private async manifest(id: string, tx: string) {
    const data = await record(path.join(this.dir(id, tx), 'manifest.json'), manifest.parse);
    if (!data || data.instanceId !== id) throw new Error('实例更新记录不完整');
    return data;
  }
  async last(id: string): Promise<ModUpdateReceipt | null> {
    const tx = await this.lastId(id);
    if (!tx) return null;
    if (await this.pending(id)) return null;
    const { updatedAt, count, files } = await this.manifest(id, tx);
    for (const file of files) {
      const dest = inside(this.store.dir(id), file.name);
      if ((await fingerprint(dest)) !== file.after) return null;
      if (
        file.name.startsWith('mods/') &&
        (await regular(dest.endsWith('.disabled') ? dest.slice(0, -9) : dest + '.disabled'))
      )
        return null;
    }
    return { updatedAt, count };
  }
  async stage(id: string, tx: string) {
    const dir = this.dir(id, tx);
    await checkGamePath(dir, true);
    await mkdir(path.dirname(dir), { recursive: true });
    await mkdir(dir);
    return dir;
  }
  async save(id: string, tx: string, count: number, files: Change[]) {
    await writeRecord(
      path.join(this.dir(id, tx), 'manifest.json'),
      manifest.parse({
        version: 1,
        instanceId: id,
        updatedAt: Date.now(),
        count,
        files,
      }),
    );
  }
  private async checkout(
    id: string,
    tx: string,
    files: Change[],
    side: Side,
    recovering: boolean,
    signal?: AbortSignal,
  ) {
    const other = side === 'before' ? 'after' : 'before';
    const root = this.root(id);
    const conflicts: string[] = [];
    for (const [index, file] of files.entries()) {
      signal?.throwIfAborted();
      const dest = inside(this.store.dir(id), file.name);
      const temp = path.join(path.dirname(dest), '.kjmcl-update-' + tx + '-' + index + '.tmp');
      if (recovering && (await regular(temp))) await rm(temp);
      const current = await fingerprint(dest);
      if (recovering && current === file[side]) continue;
      if (current !== file[other]) {
        if (!recovering) throw new Error('文件在操作期间被修改：' + file.name);
        // Restore the rest of the batch while preserving an independently edited file.
        conflicts.push(file.name);
        continue;
      }
      if (current === file[side]) continue;
      if (!recovering)
        await writeRecord(path.join(root, 'pending.json'), { tx, attempted: index + 1 });
      if (!file[side]) {
        await rm(dest);
        continue;
      }
      const source = path.join(this.dir(id, tx), side + '-' + index);
      await checkGamePath(source);
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(source, temp, constants.COPYFILE_EXCL);
      try {
        if ((await fingerprint(temp)) !== file[side])
          throw new Error('更新备份校验失败：' + file.name);
        if ((await fingerprint(dest)) !== current)
          throw new Error('文件在操作期间被修改：' + file.name);
        await rename(temp, dest);
      } finally {
        await rm(temp, { force: true });
      }
    }
    if (conflicts.length) throw new Error('恢复时发现本地修改：' + conflicts.join('、'));
    signal?.throwIfAborted();
  }
  async pending(id: string) {
    return record(path.join(this.root(id), 'pending.json'), marker.parse);
  }
  async resume(id: string) {
    const root = this.root(id);
    const entries = await readdir(root, { withFileTypes: true }).catch((e) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    });
    if (!entries.length) return;
    await checkGamePath(root, true);
    await this.recover(id);
    const last = await this.lastId(id);
    for (const entry of entries) {
      if (entry.isDirectory() && z.uuid().safeParse(entry.name).success && entry.name !== last) {
        const dir = this.dir(id, entry.name);
        await checkGamePath(dir, true);
        await rm(dir, { recursive: true, force: true });
      }
    }
  }
  async recover(id: string) {
    const pending = await this.pending(id);
    if (!pending) return;
    const last = await this.lastId(id);
    const data = await this.manifest(id, pending.tx);
    // The receipt pointer is the commit point, including for undo.
    await this.checkout(
      id,
      pending.tx,
      data.files.slice(0, pending.attempted),
      last === pending.tx ? 'after' : 'before',
      true,
    );
    await rm(path.join(this.root(id), 'pending.json'));
    if (last !== pending.tx) await rm(this.dir(id, pending.tx), { recursive: true, force: true });
  }
  async commit(id: string, tx: string, undo: boolean, ctx?: Work) {
    const root = this.root(id),
      data = await this.manifest(id, tx),
      previous = await this.lastId(id);
    const side = undo ? 'before' : 'after';
    if (undo && previous !== tx) throw new Error('更新记录已过期');
    // Preflight before recording a pending operation. Stale previews/undo requests leave no journal.
    for (const file of data.files) {
      const dest = inside(this.store.dir(id), file.name);
      if ((await fingerprint(dest)) !== file[undo ? 'after' : 'before'])
        throw new Error('本地文件已改变，请重新检查：' + file.name);
      if (file.name.startsWith('mods/')) {
        const sibling = dest.endsWith('.disabled') ? dest.slice(0, -9) : dest + '.disabled';
        if (await regular(sibling)) throw new Error('模组启用状态已改变：' + file.name);
      }
    }
    ctx?.signal.throwIfAborted();
    await writeRecord(path.join(root, 'pending.json'), { tx, attempted: 0 });
    try {
      await this.checkout(id, tx, data.files, side, false, ctx?.signal);
      ctx?.beginCommit?.();
      if (undo) await rm(path.join(root, 'last.json'));
      else await writeRecord(path.join(root, 'last.json'), tx);
    } catch (error) {
      try {
        await this.recover(id);
      } catch (recoveryError) {
        throw new Error('未能恢复整批模组，下次操作将重试：' + String(recoveryError), {
          cause: error,
        });
      }
      throw error;
    }
    // If cleanup fails, recovery can replay the already committed state.
    await rm(path.join(root, 'pending.json'))
      .then(async () => {
        const obsolete = undo ? tx : previous;
        if (obsolete) await rm(this.dir(id, obsolete), { recursive: true, force: true });
      })
      .catch(() => {});
  }
  async undo(id: string, ctx?: Work) {
    const tx = await this.lastId(id);
    if (!tx) throw new Error('没有可撤销的模组更新');
    await this.commit(id, tx, true, ctx);
  }
}
