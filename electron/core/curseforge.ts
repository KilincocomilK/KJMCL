import { catalogQuery } from '../../shared/search';
import path from 'node:path';
import { mkdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Store } from './store';
import { Network } from './network';
import type { Secrets } from './vault';
import { atomicJson, exists, hashFile, inside, json } from './files';
import { progressRange, type Work } from './tasks';
import type { Loader, ModProject } from '../../shared/types';
export interface CFFile {
  id: number;
  modId: number;
  fileName: string;
  downloadUrl: string | null;
  fileLength: number;
  fileDate: string;
  gameVersions: string[];
  hashes: { algo: number; value: string }[];
  dependencies: { modId: number; relationType: number }[];
}
export interface CFLock {
  projectId: number;
  fileId: number;
  file: string;
  sha1: string;
}
const loaders: Record<Loader, number> = { vanilla: 0, forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
export class CurseForge {
  constructor(
    private store: Store,
    private net: Network,
    private vault: Secrets,
  ) {}
  async api<T>(endpoint: string): Promise<T> {
    const key = await this.vault.get('curseforge');
    if (!key) throw new Error('请先在设置中配置 CurseForge API Key');
    return this.net.json<T>('https://api.curseforge.com/v1/' + endpoint, {
      headers: { 'x-api-key': key },
      redirect: 'error',
    });
  }
  async search(id: string, query: string, offset: number) {
    const i = this.store.instance(id);
    const q = new URLSearchParams({
      gameId: '432',
      classId: '6',
      gameVersion: i.version,
      searchFilter: catalogQuery(query, [i.loader, i.version, 'mod']),
      index: String(offset),
      pageSize: '20',
      sortField: '2',
      sortOrder: 'desc',
    });
    if (loaders[i.loader]) q.set('modLoaderType', String(loaders[i.loader]));
    const r = await this.api<any>('mods/search?' + q);
    return {
      hits: r.data.map((p: any): ModProject => ({
        project_id: String(p.id),
        title: p.name,
        description: p.summary,
        icon_url: p.logo?.thumbnailUrl,
        downloads: p.downloadCount,
        author: p.authors?.map((a: any) => a.name).join(', ') ?? '',
        slug: p.slug,
      })),
      total_hits: r.pagination.totalCount,
    };
  }
  async lock(id: string) {
    const p = path.join(this.store.dir(id), 'curseforge-lock.json');
    return (await exists(p)) ? json<CFLock[]>(p) : [];
  }
  async latest(id: string, project: number) {
    const i = this.store.instance(id);
    if (i.loader === 'vanilla') throw new Error('请先选择模组加载器实例');
    const r = await this.api<{ data: CFFile[] }>(
      `mods/${project}/files?` +
        new URLSearchParams({
          gameVersion: i.version,
          modLoaderType: String(loaders[i.loader]),
          pageSize: '50',
        }),
    );
    const files = r.data
      .filter((f) => f.gameVersions.includes(i.version))
      .sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate));
    if (!files.length) throw new Error('没有兼容文件：' + project);
    return files[0];
  }
  async file(project: number, file: number) {
    return (await this.api<{ data: CFFile }>(`mods/${project}/files/${file}`)).data;
  }
  async install(
    id: string,
    project: number,
    ctx: Work,
    fileId?: number,
    pins?: Map<number, number>,
  ) {
    const old = await this.lock(id),
      resolved = new Map<number, CFFile>(),
      i = this.store.instance(id);
    const visit = async (projectId: number, pinned?: number) => {
      ctx.signal.throwIfAborted();
      pinned ??= pins?.get(projectId);
      if (resolved.has(projectId)) return;
      if (resolved.size >= 100) throw new Error('模组依赖过多');
      const f = pinned ? await this.file(projectId, pinned) : await this.latest(id, projectId);
      if (f.modId !== projectId || (pinned && f.id !== pinned))
        throw new Error('CurseForge 文件身份不匹配');
      if (!f.gameVersions.includes(i.version)) throw new Error('文件与 Minecraft 版本不兼容');
      const loaderTags = f.gameVersions
        .map((v) => v.toLowerCase())
        .filter((v) => ['forge', 'neoforge', 'fabric', 'quilt'].includes(v));
      if (loaderTags.length && !loaderTags.includes(i.loader))
        throw new Error('文件与加载器不兼容');
      if (!f.downloadUrl)
        throw new Error('作者未允许第三方下载：' + projectId + '，请从 CurseForge 网站手动获取');
      const digest = f.hashes.find((h) => h.algo === 1)?.value;
      if (!digest || !/^[a-f0-9]{40}$/i.test(digest)) throw new Error('模组缺少 SHA-1 校验信息');
      if (!f.fileName.endsWith('.jar')) throw new Error('不是 JAR 模组');
      resolved.set(projectId, f);
      for (const d of f.dependencies) if (d.relationType === 3) await visit(d.modId);
    };
    await visit(project, fileId);
    for (const f of resolved.values())
      for (const d of f.dependencies)
        if (
          d.relationType === 5 &&
          (resolved.has(d.modId) || old.some((l) => l.projectId === d.modId))
        )
          throw new Error('检测到不兼容的 CurseForge 模组');
    const stage = path.join(this.store.dir(id), '.kjmcl-staging', randomUUID()),
      dir = path.join(this.store.dir(id), 'mods');
    await mkdir(stage, { recursive: true });
    await mkdir(dir, { recursive: true });
    const additions: CFLock[] = [];
    try {
      let n = 0;
      for (const f of resolved.values()) {
        if (additions.some((a) => a.file === f.fileName)) throw new Error('依赖包含同名文件');
        const sha1 = f.hashes.find((h) => h.algo === 1)!.value.toLowerCase();
        await this.net.download(f.downloadUrl!, inside(stage, f.fileName), {
          signal: ctx.signal,
          hash: sha1,
          size: f.fileLength,
          onProgress: (fraction) => ctx.progress((80 * (n + fraction)) / resolved.size, f.fileName),
        });
        additions.push({ projectId: f.modId, fileId: f.id, file: f.fileName, sha1 });
        ctx.progress((80 * ++n) / resolved.size, f.fileName);
      }
      for (const a of additions) {
        const prev = old.find((p) => p.projectId === a.projectId);
        if (prev) {
          const p = inside(dir, prev.file),
            actual = (await exists(p)) ? p : p + '.disabled';
          if ((await exists(actual)) && (await hashFile(actual)) !== prev.sha1)
            throw new Error('本地模组已修改：' + prev.file);
        }
        const dest = inside(dir, a.file);
        if (
          ((await exists(dest)) || (await exists(dest + '.disabled'))) &&
          !old.some((p) => p.file === a.file && p.projectId === a.projectId)
        )
          throw new Error('存在其他来源的同名模组：' + a.file);
      }
      ctx.signal.throwIfAborted();
      const backups: { file: string; backup: string }[] = [],
        installed: string[] = [];
      try {
        for (const a of additions) {
          const prev = old.find((p) => p.projectId === a.projectId);
          let disabled = false;
          if (prev) {
            const p = inside(dir, prev.file);
            disabled = await exists(p + '.disabled');
            const actual = disabled ? p + '.disabled' : p;
            if (await exists(actual)) {
              const backup = path.join(stage, 'backup-' + backups.length);
              await rename(actual, backup);
              backups.push({ file: actual, backup });
            }
          }
          const target = inside(dir, a.file + (disabled ? '.disabled' : ''));
          await rename(inside(stage, a.file), target);
          installed.push(target);
        }
        await atomicJson(path.join(this.store.dir(id), 'curseforge-lock.json'), [
          ...old.filter((p) => !additions.some((a) => a.projectId === p.projectId)),
          ...additions,
        ]);
      } catch (e) {
        for (const p of installed) await rm(p, { force: true });
        for (const b of backups) await rename(b.backup, b.file);
        throw e;
      }
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  async update(id: string, ctx: Work) {
    const lock = await this.lock(id);
    if (!lock.length) throw new Error('没有托管的 CurseForge 模组');
    for (const [index, l] of lock.entries()) {
      const latest = await this.latest(id, l.projectId);
      const item = progressRange(
        ctx,
        (100 * index) / lock.length,
        (100 * (index + 1)) / lock.length,
      );
      if (latest.id !== l.fileId) await this.install(id, l.projectId, item);
      item.progress(100, '检查模组更新');
    }
  }
}
