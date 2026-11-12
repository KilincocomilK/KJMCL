import path from 'node:path';
import type { Stats } from 'node:fs';
import { lstat, readdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Store } from './store';
import { assertOwned, contains } from './instances';
import { inside } from './files';
import type { DiskReport, DiskRow, CacheReview } from '../../shared/types';
type Candidate = { name: string; bytes: number; stamp: string };
export class DiskUsage {
  private reviews = new Map<string, { expires: number; files: Candidate[] }>();
  constructor(private store: Store) {}
  private async walk(
    root: string,
    visit: (file: string, s: Stats) => void,
    warnings: string[],
    depth = 0,
  ) {
    if (depth > 40) {
      warnings.push('部分目录超过深度限制');
      return;
    }
    const s = await lstat(root).catch((e) => {
      if (e.code !== 'ENOENT') warnings.push(`无法读取：${path.basename(root)}`);
      return undefined;
    });
    if (!s) return;
    if (s.isSymbolicLink()) {
      warnings.push(`跳过链接：${path.basename(root)}`);
      return;
    }
    if (s.isFile()) {
      visit(root, s);
      return;
    }
    if (!s.isDirectory()) return;
    const entries = await readdir(root).catch(() => {
      warnings.push(`无法列出：${path.basename(root)}`);
      return [];
    });
    for (const entry of entries)
      await this.walk(path.join(root, entry), visit, warnings, depth + 1);
  }
  async scan(): Promise<DiskReport> {
    const rows: DiskRow[] = [],
      warnings: string[] = [];
    const measure = async (key: string, label: string, root: string) => {
      const row = { key, label, bytes: 0, files: 0, skipped: 0 };
      const start = warnings.length;
      await this.walk(
        root,
        (_file, s) => {
          if (++row.files > 500000) throw new Error('目录文件超过 50 万，请分目录检查');
          row.bytes += s.size;
        },
        warnings,
      );
      row.skipped = warnings.length - start;
      rows.push(row);
    };
    for (const i of this.store.data.instances) {
      try {
        await assertOwned(this.store, i.id);
        await measure('instance:' + i.id, i.name, this.store.dir(i.id));
      } catch (e) {
        warnings.push(`实例 ${i.name}：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    for (const [key, label] of [
      ['assets', '共享资源'],
      ['libraries', '共享运行库'],
      ['runtimes', '托管 Java'],
      ['backups', '世界备份'],
      ['cache', '可重建缓存'],
      ['tools', '联机与其他工具'],
    ] as const)
      await measure(key, label, path.join(this.store.root, key));
    return { rows, scannedAt: Date.now(), warnings: warnings.slice(0, 100) };
  }
  private stamp(s: Stats) {
    return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
  }
  async plan(): Promise<CacheReview> {
    const root = path.join(this.store.root, 'cache'),
      files: Candidate[] = [],
      warnings: string[] = [];
    await this.walk(
      root,
      (file, s) => {
        if (files.length >= 200000) throw new Error('缓存文件过多，请分批整理');
        // Leave recent downloads and temp files alone, even when no foreground task exists.
        if (s.mtimeMs > Date.now() - 24 * 60 * 60_000) return;
        files.push({
          name: path.relative(root, file).split(path.sep).join('/'),
          bytes: s.size,
          stamp: this.stamp(s),
        });
      },
      warnings,
    );
    const token = randomUUID();
    this.reviews.clear();
    this.reviews.set(token, { expires: Date.now() + 10 * 60_000, files });
    return { token, files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0) };
  }
  async apply(token: string) {
    const p = this.reviews.get(token);
    this.reviews.delete(token);
    if (!p || p.expires < Date.now()) throw new Error('缓存清理预览已过期');
    const root = path.join(this.store.root, 'cache');
    let files = 0,
      bytes = 0,
      skipped = 0;
    for (const candidate of p.files) {
      const file = inside(root, candidate.name);
      if (!contains(root, file)) throw new Error('缓存路径越界');
      let current = root,
        linked = false;
      for (const part of ['', ...candidate.name.split('/')]) {
        if (part) current = path.join(current, part);
        const s = await lstat(current).catch(() => undefined);
        if (!s || s.isSymbolicLink()) {
          linked = true;
          break;
        }
      }
      if (linked) {
        skipped++;
        continue;
      }
      const s = await lstat(file);
      if (!s.isFile() || this.stamp(s) !== candidate.stamp) {
        skipped++;
        continue;
      }
      await unlink(file);
      files++;
      bytes += candidate.bytes;
    }
    return { files, bytes, skipped };
  }
}
