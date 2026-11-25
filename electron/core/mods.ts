import { catalogQuery } from '../../shared/search';
import path from 'node:path';
import { readdir, stat, rename, rm, mkdir, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Store } from './store';
import { Network } from './network';
import { json, atomicJson, inside, exists, hashFile } from './files';
import type { ModFile, ModProject } from '../../shared/types';
import { progressRange, type Work } from './tasks';
import type { CFLock } from './curseforge';
interface LockEntry {
  projectId: string;
  versionId: string;
  file: string;
  sha512: string;
}
interface RemoteVersion {
  id: string;
  project_id: string;
  game_versions: string[];
  loaders: string[];
  files: {
    filename: string;
    url: string;
    hashes: { sha512: string };
    size: number;
    primary: boolean;
  }[];
  dependencies: { dependency_type: string; project_id?: string; version_id?: string }[];
}
const base = 'https://api.modrinth.com/v2';
export class Mods {
  constructor(
    private store: Store,
    private net: Network,
  ) {}
  dir(id: string) {
    return path.join(this.store.dir(id), 'mods');
  }
  async lock(id: string) {
    const file = path.join(this.store.dir(id), 'mods-lock.json');
    return (await exists(file)) ? json<LockEntry[]>(file) : [];
  }
  async list(id: string): Promise<ModFile[]> {
    const dir = this.dir(id),
      lock = await this.lock(id);
    const cfPath = path.join(this.store.dir(id), 'curseforge-lock.json');
    const cf = (await exists(cfPath)) ? await json<CFLock[]>(cfPath) : [];
    const entries = await readdir(dir).catch(() => []);
    return Promise.all(
      entries
        .filter((n) => /\.jar(?:\.disabled)?$/i.test(n))
        .map(async (name) => {
          const item = lock.find((x) => x.file === name.replace(/\.disabled$/, ''));
          const other = cf.find((x) => x.file === name.replace(/\.disabled$/, ''));
          return {
            name,
            enabled: !name.endsWith('.disabled'),
            size: (await stat(inside(dir, name))).size,
            projectId: item?.projectId ?? (other ? String(other.projectId) : undefined),
            versionId: item?.versionId ?? (other ? String(other.fileId) : undefined),
            source: item ? ('modrinth' as const) : other ? ('curseforge' as const) : undefined,
          };
        }),
    );
  }
  async toggle(id: string, name: string) {
    const dir = this.dir(id);
    if (!/\.jar(?:\.disabled)?$/i.test(name)) throw new Error('不是模组文件');
    const next = name.endsWith('.disabled') ? name.slice(0, -9) : name + '.disabled';
    if (await exists(inside(dir, next))) throw new Error('目标文件已存在');
    await rename(inside(dir, name), inside(dir, next));
  }
  async remove(id: string, name: string, trash?: (file: string) => Promise<void>) {
    if (!/\.jar(?:\.disabled)?$/i.test(name)) throw new Error('不是模组文件');
    if (trash) await trash(inside(this.dir(id), name));
    else await rm(inside(this.dir(id), name));
    const lock = (await this.lock(id)).filter((x) => x.file !== name.replace(/\.disabled$/, ''));
    await atomicJson(path.join(this.store.dir(id), 'mods-lock.json'), lock);
    const cfPath = path.join(this.store.dir(id), 'curseforge-lock.json');
    if (await exists(cfPath))
      await atomicJson(
        cfPath,
        (await json<CFLock[]>(cfPath)).filter((x) => x.file !== name.replace(/\.disabled$/, '')),
      );
  }
  async import(id: string, files: string[], ctx?: Work) {
    await mkdir(this.dir(id), { recursive: true });
    for (const [index, file] of files.entries()) {
      ctx?.signal.throwIfAborted();
      if (!file.toLowerCase().endsWith('.jar')) throw new Error('仅支持 JAR 模组');
      const dest = inside(this.dir(id), path.basename(file));
      if (await exists(dest)) throw new Error('已存在同名模组：' + path.basename(file));
      await copyFile(file, dest);
      ctx?.progress((100 * (index + 1)) / files.length, path.basename(file));
    }
  }
  async search(id: string, query: string, offset: number) {
    const i = this.store.instance(id);
    const facets = [
      ['project_type:mod'],
      ['versions:' + i.version],
      ...(i.loader === 'vanilla' ? [] : [['categories:' + i.loader]]),
    ];
    return this.net.json<{ hits: ModProject[]; total_hits: number }>(
      base +
        '/search?' +
        new URLSearchParams({
          query: catalogQuery(query, [i.loader, i.version, 'mod']),
          facets: JSON.stringify(facets),
          limit: '20',
          offset: String(offset),
        }),
    );
  }
  async compatible(id: string, project: string, signal: AbortSignal) {
    const i = this.store.instance(id);
    if (i.loader === 'vanilla') throw new Error('请先创建带加载器的实例');
    const list = await this.net.json<RemoteVersion[]>(
      `${base}/project/${encodeURIComponent(project)}/version?` +
        new URLSearchParams({
          loaders: JSON.stringify([i.loader]),
          game_versions: JSON.stringify([i.version]),
        }),
      { signal },
    );
    if (!list.length) throw new Error(`没有兼容版本：${project}`);
    return list[0];
  }
  async install(id: string, project: string, ctx: Work, versionId?: string) {
    const instance = this.store.instance(id);
    const old = await this.lock(id);
    const resolved = new Map<string, RemoteVersion>();
    const visit = async (projectId?: string, versionId?: string) => {
      ctx.signal.throwIfAborted();
      if (resolved.size > 100) throw new Error('依赖数量过多');
      if (projectId && resolved.has(projectId)) {
        if (versionId && resolved.get(projectId)!.id !== versionId)
          throw new Error('模组依赖版本冲突');
        return;
      }
      const v = versionId
        ? await this.net.json<RemoteVersion>(base + '/version/' + encodeURIComponent(versionId), {
            signal: ctx.signal,
          })
        : await this.compatible(id, projectId!, ctx.signal);
      if (projectId && v.project_id !== projectId) throw new Error('模组版本不属于指定项目');
      if (resolved.has(v.project_id)) {
        if (resolved.get(v.project_id)!.id !== v.id) throw new Error('模组依赖版本冲突');
        return;
      }
      if (!v.game_versions.includes(instance.version) || !v.loaders.includes(instance.loader))
        throw new Error('依赖与游戏版本或加载器不兼容');
      resolved.set(v.project_id, v);
      for (const dep of v.dependencies) {
        if (dep.dependency_type === 'required') {
          if (!dep.project_id && !dep.version_id) throw new Error('依赖信息不完整');
          await visit(dep.project_id, dep.version_id);
        }
      }
    };
    await visit(project, versionId);
    for (const v of resolved.values())
      for (const d of v.dependencies)
        if (
          d.dependency_type === 'incompatible' &&
          ((d.project_id &&
            (resolved.has(d.project_id) || old.some((l) => l.projectId === d.project_id))) ||
            (d.version_id && [...resolved.values()].some((l) => l.id === d.version_id)))
        )
          throw new Error('检测到不兼容模组依赖');
    const stage = path.join(this.store.dir(id), '.kjmcl-staging', randomUUID());
    await mkdir(stage, { recursive: true });
    const additions: LockEntry[] = [];
    try {
      let n = 0;
      for (const v of resolved.values()) {
        const f = v.files.find((f) => f.primary) ?? v.files[0];
        if (!f || !f.filename.endsWith('.jar')) throw new Error('没有可安装的 JAR 文件');
        if (!/^[a-f\d]{128}$/i.test(f.hashes.sha512))
          throw new Error('模组文件缺少可信 SHA-512 校验');
        if (additions.some((a) => a.file === f.filename)) throw new Error('依赖包含同名模组文件');
        const dest = inside(stage, f.filename);
        await this.net.download(f.url, dest, {
          signal: ctx.signal,
          hash: f.hashes.sha512,
          algorithm: 'sha512',
          size: f.size,
          onProgress: (fraction) =>
            ctx.progress((80 * (n + fraction)) / resolved.size, `下载 ${f.filename}`),
        });
        additions.push({
          projectId: v.project_id,
          versionId: v.id,
          file: f.filename,
          sha512: f.hashes.sha512,
        });
        ctx.progress((80 * ++n) / resolved.size, `下载 ${f.filename}`);
      }
      ctx.signal.throwIfAborted();
      await mkdir(this.dir(id), { recursive: true });
      // Validate every destination before committing. Unmanaged files are never overwritten.
      for (const a of additions) {
        const previous = old.find((x) => x.projectId === a.projectId);
        if (previous) {
          const prev = inside(this.dir(id), previous.file);
          const actual = (await exists(prev)) ? prev : prev + '.disabled';
          if ((await exists(actual)) && (await hashFile(actual, 'sha512')) !== previous.sha512)
            throw new Error('本地模组已修改，请先移除再更新：' + previous.file);
        }
        const dest = inside(this.dir(id), a.file);
        if (
          ((await exists(dest)) || (await exists(dest + '.disabled'))) &&
          !old.some((x) => x.file === a.file && x.projectId === a.projectId)
        )
          throw new Error('存在未托管的同名模组：' + a.file);
      }
      const backups: { original: string; backup: string }[] = [];
      const installed: string[] = [];
      try {
        for (const a of additions) {
          const previous = old.find((x) => x.projectId === a.projectId);
          let disabled = false;
          if (previous) {
            const prev = inside(this.dir(id), previous.file);
            disabled = await exists(prev + '.disabled');
            const original = disabled ? prev + '.disabled' : prev;
            if (await exists(original)) {
              const backup = inside(stage, 'backup-' + backups.length);
              await rename(original, backup);
              backups.push({ original, backup });
            }
          }
          const destination = inside(this.dir(id), a.file + (disabled ? '.disabled' : ''));
          await rename(inside(stage, a.file), destination);
          installed.push(destination);
        }
        await atomicJson(path.join(this.store.dir(id), 'mods-lock.json'), [
          ...old.filter((x) => !additions.some((a) => a.projectId === x.projectId)),
          ...additions,
        ]);
      } catch (e) {
        for (const file of installed) await rm(file, { force: true });
        for (const b of backups) await rename(b.backup, b.original);
        throw e;
      }
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  async update(id: string, ctx: Work) {
    const lock = await this.lock(id);
    if (!lock.length) throw new Error('没有从 Modrinth 安装的模组');
    let n = 0;
    for (const entry of lock) {
      const latest = await this.compatible(id, entry.projectId, ctx.signal);
      if (latest.id !== entry.versionId)
        await this.install(
          id,
          entry.projectId,
          progressRange(ctx, (100 * n) / lock.length, (100 * (n + 1)) / lock.length),
        );
      ctx.progress((100 * ++n) / lock.length, '检查模组更新');
    }
  }
}
