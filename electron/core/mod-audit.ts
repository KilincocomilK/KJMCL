import { lstat, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Store } from './store';
import type { Resources } from './resources';
import { zipMetadata, metadataJson } from './resource-preview';
import { hashFile, exists } from './files';
import type { ModAuditEntry, ModBatchReview } from '../../shared/types';
import { pool } from './network';
type Change = { from: string; to: string; hash: string };
export class ModAudit {
  private cache = new Map<string, { stamp: string; entry: ModAuditEntry }>();
  private plans = new Map<string, { id: string; expires: number; changes: Change[] }>();
  constructor(
    private store: Store,
    private resources: Resources,
  ) {}
  async scan(id: string): Promise<ModAuditEntry[]> {
    const files = (await this.resources.list(id)).filter((f) => f.kind === 'mods');
    if (files.length > 5000) throw new Error('模组超过 5000 个，请分批整理');
    const entries: ModAuditEntry[] = [];
    await pool(
      files,
      4,
      async (f) => {
        const file = await this.resources.file(id, 'mods', f.name);
        const s = await lstat(file),
          stamp = `${s.size}:${s.mtimeMs}:${s.ctimeMs}`,
          key = file;
        const cached = this.cache.get(key);
        if (cached?.stamp === stamp) {
          entries.push(structuredClone(cached.entry));
          return;
        }
        const e: ModAuditEntry = {
          name: f.name,
          enabled: !f.name.endsWith('.disabled'),
          ids: [],
          requires: [],
          issues: [],
        };
        try {
          const { data } = await zipMetadata(file);
          const fabric = metadataJson(data, 'fabric.mod.json'),
            quilt = metadataJson(data, 'quilt.mod.json')?.quilt_loader;
          if (fabric) {
            e.loader = 'fabric';
            e.ids = [fabric.id, ...(Array.isArray(fabric.provides) ? fabric.provides : [])].filter(
              (x) => typeof x === 'string',
            );
            e.version = String(fabric.version ?? '');
            e.requires = Object.keys(fabric.depends ?? {});
          } else if (quilt) {
            e.loader = 'quilt';
            e.ids = [quilt.id].filter((x) => typeof x === 'string');
            e.version = String(quilt.version ?? '');
            e.requires = (Array.isArray(quilt.depends) ? quilt.depends : [])
              .filter((d: any) => d && typeof d.id === 'string' && !d.optional && !d.unless)
              .map((d: any) => d.id);
          } else {
            const neo = data.get('META-INF/neoforge.mods.toml'),
              forge = data.get('META-INF/mods.toml');
            if (neo || forge) {
              e.loader = neo ? 'neoforge' : 'forge';
              // Only display unambiguous literal IDs from [[mods]] blocks. TOML dependency
              // expressions and embedded JARs are deliberately not inferred as missing.
              const blocks = (neo ?? forge)!
                .toString('utf8')
                .split(/^\s*\[\[mods\]\]\s*(?:#.*)?$/m)
                .slice(1);
              e.ids = blocks.flatMap((b) => {
                const head = b.split(/^\s*\[/m)[0];
                const m = /^\s*modId\s*=\s*["']([a-zA-Z0-9_.-]+)["']\s*(?:#.*)?$/m.exec(head);
                return m ? [m[1]] : [];
              });
              e.issues.push({
                level: 'warning',
                message:
                  'Forge / NeoForge 仅读取模组 ID；版本约束、依赖和内嵌模组请以加载器检查为准',
              });
            } else
              e.issues.push({
                level: 'warning',
                message: '未识别模组元数据（可能是旧版或特殊模组）',
              });
          }
        } catch (error) {
          e.issues.push({
            level: 'error',
            message: '无法读取 JAR：' + (error instanceof Error ? error.message : String(error)),
          });
        }
        e.ids = [...new Set(e.ids)].slice(0, 200);
        e.requires = e.requires.slice(0, 200);
        if (this.cache.size > 5000) this.cache.clear();
        this.cache.set(key, { stamp, entry: structuredClone(e) });
        entries.push(e);
      },
      new AbortController().signal,
    );
    const enabled = entries.filter((e) => e.enabled),
      present = new Set(enabled.flatMap((e) => e.ids));
    const counts = new Map<string, number>();
    for (const e of enabled) for (const id of e.ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    const builtins = new Set([
      'minecraft',
      'java',
      'fabricloader',
      'quilt_loader',
      'forge',
      'neoforge',
    ]);
    const loader = this.store.instance(id).loader;
    for (const e of enabled) {
      for (const modId of e.ids)
        if ((counts.get(modId) ?? 0) > 1)
          e.issues.push({ level: 'error', message: `重复模组 ID：${modId}` });
      for (const dependency of e.requires)
        if (!present.has(dependency) && !builtins.has(dependency))
          e.issues.push({
            level: 'warning',
            message: `未在顶层已启用 JAR 中找到必需依赖：${dependency}（可能由内嵌模组提供）`,
          });
      if (e.loader && e.loader !== loader && !(loader === 'quilt' && e.loader === 'fabric'))
        e.issues.push({
          level: 'warning',
          message: `元数据声明 ${e.loader}，当前实例为 ${loader}；请核对兼容性`,
        });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }
  async plan(id: string, names: string[], enabled: boolean): Promise<ModBatchReview> {
    const changes: Change[] = [];
    for (const from of new Set(names)) {
      if (!/\.jar(?:\.disabled)?$/i.test(from) || from.includes('/'))
        throw new Error('请选择顶层 JAR 模组');
      const currentlyEnabled = !from.endsWith('.disabled');
      if (currentlyEnabled === enabled) continue;
      const source = await this.resources.file(id, 'mods', from);
      const to = enabled ? from.slice(0, -9) : from + '.disabled';
      if (await exists(await this.resources.location(id, 'mods', to)))
        throw new Error('目标已存在：' + to);
      changes.push({ from, to, hash: await hashFile(source, 'sha256') });
    }
    if (!changes.length) throw new Error('所选模组已经处于目标状态');
    const token = randomUUID();
    for (const [key, p] of this.plans) if (p.expires < Date.now()) this.plans.delete(key);
    if (this.plans.size > 20) this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(token, { id, changes, expires: Date.now() + 10 * 60_000 });
    return { token, changes: changes.map(({ from, to }) => ({ from, to })) };
  }
  ticket(token: string) {
    const p = this.plans.get(token);
    if (!p || p.expires < Date.now()) throw new Error('操作预览已过期');
    return p;
  }
  async apply(token: string) {
    const p = this.ticket(token);
    this.plans.delete(token);
    // Validate all source hashes and destinations before the first rename.
    for (const c of p.changes) {
      if (
        (await hashFile(await this.resources.file(p.id, 'mods', c.from), 'sha256')) !== c.hash ||
        (await exists(await this.resources.location(p.id, 'mods', c.to)))
      )
        throw new Error('模组文件发生变化，请重新预览');
    }
    const done: Change[] = [];
    try {
      for (const c of p.changes) {
        await rename(
          await this.resources.file(p.id, 'mods', c.from),
          await this.resources.location(p.id, 'mods', c.to),
        );
        done.push(c);
      }
    } catch (error) {
      for (const c of done.reverse()) {
        const source = await this.resources.location(p.id, 'mods', c.from);
        if (await exists(source)) throw new Error('批量操作中断，回退目标被占用；请检查模组目录');
        await rename(await this.resources.file(p.id, 'mods', c.to), source);
      }
      throw error;
    }
  }
}
