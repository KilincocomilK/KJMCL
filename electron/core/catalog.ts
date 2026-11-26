import { constants } from 'node:fs';
import path from 'node:path';
import { checkGamePath } from './game-folders';
import { rm, copyFile, link, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type {
  Api,
  ContentRef,
  ContentProject,
  ContentVersion,
  ContentKind,
  Instance,
  ModAuditEntry,
} from '../../shared/types';
import type { Store } from './store';
import type { Network } from './network';
import type { Mods } from './mods';
import type { CurseForge, CFFile } from './curseforge';
import type { Resources } from './resources';
import type { Packs } from './packs';
import type { Work } from './tasks';
import { inside, hashFile, exists } from './files';
import { favoriteSchema } from '../../shared/schema';
import { safeExport } from './safe-export';
import { modListText } from './mod-list';
import { catalogQuery } from '../../shared/search';
const base = 'https://api.modrinth.com/v2';
const classes: Record<ContentKind, number> = {
  mod: 6,
  resourcepack: 12,
  shader: 6552,
  modpack: 4471,
};
const cfLoaders = { vanilla: 0, forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const cfPaths = {
  mod: 'mc-mods',
  resourcepack: 'texture-packs',
  shader: 'shaders',
  modpack: 'modpacks',
};
type MRVersion = {
  id: string;
  project_id: string;
  name: string;
  date_published: string;
  version_type: string;
  game_versions: string[];
  loaders: string[];
  dependencies: { dependency_type: string }[];
  files: {
    filename: string;
    primary: boolean;
    size: number;
    url: string;
    hashes: { sha512: string };
  }[];
};
export class Catalog {
  constructor(
    private store: Store,
    private net: Network,
    private mods: Mods,
    private cf: CurseForge,
    private resources: Resources,
    private packs: Packs,
  ) {}
  private numeric(id: string) {
    if (!/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)))
      throw new Error('无效 CurseForge ID');
    return Number(id);
  }
  private mrProject(p: any, ref: ContentRef): ContentProject {
    return {
      ...ref,
      title: String(p.title).slice(0, 300),
      description: String(p.description ?? '').slice(0, 10000),
      author: String(p.author ?? '').slice(0, 1000),
      downloads: Number(p.downloads) || 0,
      icon: p.icon_url || undefined,
      url: `https://modrinth.com/${ref.kind}/${encodeURIComponent(ref.projectId)}`,
    };
  }
  private cfProject(p: any, ref: ContentRef): ContentProject {
    return {
      ...ref,
      title: String(p.name).slice(0, 300),
      description: String(p.summary ?? '').slice(0, 10000),
      author: (p.authors ?? [])
        .map((a: any) => a.name)
        .join(', ')
        .slice(0, 1000),
      downloads: Number(p.downloadCount) || 0,
      icon: p.logo?.thumbnailUrl,
      url: `https://www.curseforge.com/minecraft/${cfPaths[ref.kind]}/${encodeURIComponent(p.slug)}`,
    };
  }
  async project(ref: ContentRef) {
    if (ref.source === 'modrinth') {
      const p = await this.net.json<any>(`${base}/project/${encodeURIComponent(ref.projectId)}`);
      if (p.project_type !== ref.kind || p.id !== ref.projectId)
        throw new Error('内容类型或项目身份不匹配');
      return this.mrProject(p, ref);
    }
    const { data: p } = await this.cf.api<any>(`mods/${this.numeric(ref.projectId)}`);
    if (p.classId !== classes[ref.kind] || p.gameId !== 432 || String(p.id) !== ref.projectId)
      throw new Error('内容类型或项目身份不匹配');
    return this.cfProject(p, ref);
  }
  private filterInstance(v: { kind: ContentKind; id?: string }) {
    if (v.kind === 'modpack') return;
    if (!v.id) throw new Error('请选择游戏实例');
    return this.store.instance(v.id);
  }
  async search(v: Parameters<Api['catalogSearch']>[0]) {
    const i = this.filterInstance(v);
    const filters = !i ? [] : v.kind === 'mod' ? [i.loader, i.version, 'mod'] : [i.version];
    const query = catalogQuery(v.query, filters);
    const page = await this.searchProvider({ ...v, query });
    if (page.total === 0 && query !== v.query) return this.searchProvider(v);
    return page;
  }
  private async searchProvider(v: Parameters<Api['catalogSearch']>[0]) {
    const i = this.filterInstance(v);
    if (v.source === 'modrinth') {
      const facets = [
        [`project_type:${v.kind}`],
        ...(i ? [[`versions:${i.version}`]] : []),
        ...(i && v.kind === 'mod' && i.loader !== 'vanilla' ? [[`categories:${i.loader}`]] : []),
      ];
      const r = await this.net.json<any>(
        base +
          '/search?' +
          new URLSearchParams({
            query: v.query,
            facets: JSON.stringify(facets),
            offset: String(v.offset),
            limit: '20',
            index: v.sort,
          }),
      );
      return {
        items: r.hits
          .slice(0, 20)
          .map((p: any) =>
            this.mrProject(p, { source: v.source, kind: v.kind, projectId: p.project_id }),
          ),
        total: Number(r.total_hits),
      };
    }
    const q = new URLSearchParams({
      gameId: '432',
      classId: String(classes[v.kind]),
      searchFilter: v.query,
      index: String(v.offset),
      pageSize: '20',
    });
    if (i) q.set('gameVersion', i.version);
    if (v.sort !== 'relevance') {
      q.set('sortField', v.sort === 'downloads' ? '6' : '3');
      q.set('sortOrder', 'desc');
    }
    if (i && v.kind === 'mod' && cfLoaders[i.loader])
      q.set('modLoaderType', String(cfLoaders[i.loader]));
    const r = await this.cf.api<any>('mods/search?' + q);
    return {
      items: r.data
        .slice(0, 20)
        .map((p: any) =>
          this.cfProject(p, { source: v.source, kind: v.kind, projectId: String(p.id) }),
        ),
      total: Number(r.pagination.totalCount),
    };
  }
  private compatible(v: MRVersion, kind: ContentKind, i?: Instance) {
    return (
      !i ||
      (v.game_versions.includes(i.version) && (kind !== 'mod' || v.loaders.includes(i.loader)))
    );
  }
  private mrVersion(v: MRVersion): ContentVersion {
    const f = v.files.find((f) => f.primary) ?? v.files[0];
    return {
      id: v.id,
      name: v.name,
      published: v.date_published,
      channel: v.version_type,
      fileName: f?.filename ?? '',
      bytes: f?.size ?? 0,
      gameVersions: v.game_versions,
      loaders: v.loaders,
      dependencies: v.dependencies.filter((d) => d.dependency_type === 'required').length,
      downloadable: !!f,
    };
  }
  private cfVersion(f: CFFile & { displayName?: string; releaseType?: number }): ContentVersion {
    const isLoader = (value: string) => Object.hasOwn(cfLoaders, value.toLowerCase());
    return {
      id: String(f.id),
      name: f.displayName ?? f.fileName,
      published: f.fileDate,
      channel:
        ({ 1: 'release', 2: 'beta', 3: 'alpha' } as Record<number, string>)[f.releaseType ?? 1] ??
        'unknown',
      fileName: f.fileName,
      bytes: f.fileLength,
      gameVersions: f.gameVersions.filter(
        (v) => !isLoader(v) && !/^(java\s?\d|client$|server$|environment:)/i.test(v),
      ),
      loaders: f.gameVersions.filter(isLoader),
      dependencies: f.dependencies.filter((d) => d.relationType === 3).length,
      downloadable: !!f.downloadUrl,
    };
  }
  async versions(v: ContentRef & { id?: string; offset: number }) {
    await this.project(v);
    const i = this.filterInstance(v);
    if (v.source === 'modrinth') {
      const q = new URLSearchParams();
      if (i) q.set('game_versions', JSON.stringify([i.version]));
      if (i && v.kind === 'mod') q.set('loaders', JSON.stringify([i.loader]));
      const all = await this.net.json<MRVersion[]>(
        `${base}/project/${encodeURIComponent(v.projectId)}/version${q.size ? '?' + q : ''}`,
      );
      const list = all
        .filter((f) => f.project_id === v.projectId && this.compatible(f, v.kind, i))
        .sort((a, b) => Date.parse(b.date_published) - Date.parse(a.date_published));
      return {
        items: list.slice(v.offset, v.offset + 20).map((f) => this.mrVersion(f)),
        more: list.length > v.offset + 20,
      };
    }
    const q = new URLSearchParams({
      index: String(v.offset),
      pageSize: '20',
    });
    if (i) q.set('gameVersion', i.version);
    if (i && v.kind === 'mod') q.set('modLoaderType', String(cfLoaders[i.loader]));
    const r = await this.cf.api<{
      data: CFFile[];
      pagination: { totalCount: number; resultCount: number };
    }>(`mods/${this.numeric(v.projectId)}/files?${q}`);
    return {
      items: r.data
        .filter(
          (f) => f.modId === Number(v.projectId) && (!i || f.gameVersions.includes(i.version)),
        )
        .map((f) => this.cfVersion(f)),
      more: v.offset + r.pagination.resultCount < r.pagination.totalCount,
    };
  }
  async favorite(ref: ContentRef, group: string) {
    // A saved favorite is canonical metadata from the provider, never arbitrary renderer URLs.
    const key = (p: ContentRef) =>
      p.source === ref.source && p.projectId === ref.projectId && p.kind === ref.kind;
    const previous = this.store.data.favorites.find(key);
    const project = previous ?? (await this.project(ref));
    const favorite = favoriteSchema.parse({
      ...project,
      group,
      savedAt: previous?.savedAt ?? Date.now(),
    });
    const next = this.store.data.favorites.filter((p) => !key(p));
    if (next.length >= 2000) throw new Error('收藏数量已达上限');
    this.store.data.favorites = [...next, favorite];
    this.store.save();
  }
  removeFavorite(ref: ContentRef) {
    this.store.data.favorites = this.store.data.favorites.filter(
      (p) => !(p.source === ref.source && p.projectId === ref.projectId && p.kind === ref.kind),
    );
    this.store.save();
  }
  async exportModList(
    id: string,
    destination: string,
    secrets: string[],
    metadata: ModAuditEntry[],
  ) {
    const allowed = new Set(
      (await this.resources.list(id)).filter((f) => f.kind === 'mods').map((f) => f.name),
    );
    const files = (await this.mods.list(id)).filter((f) => allowed.has(f.name));
    const text = modListText(this.store.instance(id), files, metadata, secrets);
    await safeExport(destination, (temporary) => writeFile(temporary, text, 'utf8'));
  }
  async install(v: ContentRef & { id: string; versionId: string }, ctx: Work) {
    return this.transfer(v, ctx);
  }
  async previewPack(v: ContentRef & { id?: string; versionId: string }, ctx: Work) {
    if (v.kind !== 'modpack') throw new Error('请选择整合包');
    let preview: import('../../shared/pack').PackPreview | undefined;
    await this.transfer(v, ctx, async (file) => {
      preview = await this.packs.preview(file, true, ctx.signal);
    });
    if (!preview) throw new Error('整合包预览失败');
    return preview;
  }
  private async transfer(
    v: ContentRef & { id?: string; versionId: string },
    ctx: Work,
    preview?: (file: string) => Promise<void>,
  ) {
    const i = this.filterInstance(v);
    const project = await this.project(v);
    ctx.setTitle?.((v.kind === 'modpack' ? '下载 ' : '安装 ') + project.title);
    let file: { filename: string; url: string; size: number; hash: string; algorithm: string };
    if (v.source === 'modrinth') {
      const version = await this.net.json<MRVersion>(
        `${base}/version/${encodeURIComponent(v.versionId)}`,
        { signal: ctx.signal },
      );
      if (
        version.id !== v.versionId ||
        version.project_id !== v.projectId ||
        !this.compatible(version, v.kind, i)
      )
        throw new Error('所选版本与项目或实例不匹配');
      if (v.kind === 'mod') return this.mods.install(i!.id, v.projectId, ctx, v.versionId);
      if (
        v.kind !== 'modpack' &&
        version.dependencies.some((d) => d.dependency_type === 'required')
      )
        throw new Error('该资源有必需依赖，请先通过项目页面核对并手动导入');
      const f = version.files.find((f) => f.primary) ?? version.files[0];
      if (!f || !/^[a-f\d]{128}$/i.test(f.hashes.sha512)) throw new Error('文件缺少可信 SHA-512');
      file = {
        filename: f.filename,
        url: f.url,
        size: f.size,
        hash: f.hashes.sha512,
        algorithm: 'sha512',
      };
    } else {
      const f = await this.cf.file(this.numeric(v.projectId), this.numeric(v.versionId));
      if (
        f.modId !== Number(v.projectId) ||
        f.id !== Number(v.versionId) ||
        (i && !f.gameVersions.includes(i.version))
      )
        throw new Error('所选文件与项目或实例不匹配');
      if (v.kind === 'mod')
        return this.cf.install(i!.id, Number(v.projectId), ctx, Number(v.versionId));
      if (v.kind !== 'modpack' && f.dependencies.some((d) => d.relationType === 3))
        throw new Error('该资源有必需依赖，请先通过项目页面核对并手动导入');
      const hash = f.hashes.find((h) => h.algo === 1)?.value;
      if (!f.downloadUrl || !hash || !/^[a-f\d]{40}$/i.test(hash))
        throw new Error('作者未开放下载或文件缺少 SHA-1 校验');
      file = {
        filename: f.fileName,
        url: f.downloadUrl,
        size: f.fileLength,
        hash,
        algorithm: 'sha1',
      };
    }
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 2 * 1024 ** 3)
      throw new Error('资源大小超限');
    if (!/\.(zip|mrpack)$/i.test(file.filename)) throw new Error('资源文件格式不支持');
    // A pack preview can be opened before the first instance exists.
    const stage =
      v.kind === 'modpack'
        ? path.join(this.store.root, 'cache', 'pack-previews')
        : await this.resources.location(i!.id, 'resourcepacks', '', true);
    if (v.kind === 'modpack') {
      await checkGamePath(stage, true);
      await mkdir(stage, { recursive: true });
    }
    const temporary = inside(stage, `.kjmcl-${randomUUID()}.download`);
    try {
      ctx.progress(5, `下载 ${project.title}`);
      await this.net.download(file.url, temporary, {
        signal: ctx.signal,
        hash: file.hash,
        algorithm: file.algorithm,
        size: file.size,
        onProgress: (fraction) => ctx.progress(5 + 90 * fraction, `下载 ${project.title}`),
      });
      ctx.signal.throwIfAborted();
      if (v.kind === 'modpack') {
        if (preview) await preview(temporary);
        else await this.packs.import(temporary);
        return;
      }
      const kind = v.kind === 'shader' ? 'shaderpacks' : 'resourcepacks';
      const dest = await this.resources.location(i!.id, kind, file.filename, true);
      if (await exists(dest)) {
        if ((await hashFile(dest, file.algorithm)) === file.hash) {
          ctx.progress(100, '相同文件已安装');
          return;
        }
        throw new Error('存在不同内容的同名文件，请先在资源管理中处理');
      }
      try {
        await link(temporary, dest);
      } catch (e: any) {
        if (!['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS'].includes(e.code)) throw e;
        await copyFile(temporary, dest, constants.COPYFILE_EXCL);
      }
      ctx.progress(100, '已安装到实例');
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
