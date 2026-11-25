import { Forge } from './forge';
import path from 'node:path';
import os from 'node:os';
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { Network, pool } from './network';
import { Store } from './store';
import { atomicJson, json, inside, extractZip, hashFile } from './files';
import { assertExternal, checkGamePath, resolveExternalVersion } from './game-folders';
import { fileProgress, type Work } from './tasks';
import type { Loader, VersionSummary } from '../../shared/types';
export interface Rule {
  action: 'allow' | 'disallow';
  os?: { name?: string; arch?: string; version?: string };
  features?: Record<string, boolean>;
}
export interface Artifact {
  path?: string;
  url: string;
  sha1?: string;
  size?: number;
}
export interface Library {
  name: string;
  url?: string;
  rules?: Rule[];
  downloads?: { artifact?: Artifact; classifiers?: Record<string, Artifact> };
  natives?: Record<string, string>;
  extract?: { exclude?: string[] };
}
export type Argument = string | { rules: Rule[]; value: string | string[] };
export interface Version {
  id: string;
  type: string;
  mainClass: string;
  inheritsFrom?: string;
  libraries: Library[];
  arguments?: { game?: Argument[]; jvm?: Argument[] };
  minecraftArguments?: string;
  downloads?: { client: Artifact };
  assetIndex?: Artifact & { id: string };
  assets?: string;
  javaVersion?: { majorVersion: number };
  logging?: { client: { argument: string; file: Artifact & { id: string } } };
}
export const platformName = (p = process.platform) =>
  p === 'win32' ? 'windows' : p === 'darwin' ? 'osx' : 'linux';
export function allowed(
  rules: Rule[] | undefined,
  platform = platformName(),
  arch: string = process.arch,
  features: Record<string, boolean> = { has_custom_resolution: true },
) {
  if (!rules) return true;
  let result = false;
  for (const r of rules) {
    if (r.os?.name && r.os.name !== platform) continue;
    const aliases: Record<string, string[]> = {
      x64: ['x64', 'x86_64', 'amd64'],
      ia32: ['ia32', 'x86', 'i386'],
      arm64: ['arm64', 'aarch64'],
    };
    if (
      r.os?.arch &&
      !(aliases[arch] ?? [arch]).some((a) => new RegExp(`^(?:${r.os!.arch})$`).test(a))
    )
      continue;
    if (r.os?.version && !new RegExp(r.os.version).test(os.release())) continue;
    if (r.features && Object.entries(r.features).some(([k, v]) => (features[k] ?? false) !== v))
      continue;
    result = r.action === 'allow';
  }
  return result;
}
export function mavenPath(name: string) {
  const [coords, extension = 'jar'] = name.split('@');
  const [group, artifact, version, classifier] = coords.split(':');
  if (!group || !artifact || !version) throw new Error('无效的 Maven 坐标');
  return `${group.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? '-' + classifier : ''}.${extension}`;
}
export function libraryKey(name: string) {
  const [g, a, , c] = name.split(':');
  return `${g}:${a}:${c ?? ''}`;
}
export function mergeVersions(parent: Version, child: Version): Version {
  const libs = new Map(parent.libraries.map((l) => [libraryKey(l.name), l]));
  for (const l of child.libraries) libs.set(libraryKey(l.name), l);
  return {
    ...parent,
    ...child,
    downloads: child.downloads ?? parent.downloads,
    assetIndex: child.assetIndex ?? parent.assetIndex,
    libraries: [...libs.values()],
    arguments: {
      game: [...(parent.arguments?.game ?? []), ...(child.arguments?.game ?? [])],
      jvm: [...(parent.arguments?.jvm ?? []), ...(child.arguments?.jvm ?? [])],
    },
  };
}
export function selectArguments(
  args: Argument[],
  features?: Record<string, boolean>,
) {
  return args.flatMap((a) => {
    if (typeof a === 'string') return [a];
    return allowed(a.rules, undefined, undefined, features) ? a.value : [];
  });
}
export function expandArguments(
  args: Argument[],
  variables: Record<string, string>,
  features?: Record<string, boolean>,
) {
  return selectArguments(args, features).map((a) =>
    a.replace(/\$\{([^}]+)\}/g, (_, k) => {
      if (!(k in variables)) throw new Error(`缺少启动参数：${k}`);
      return variables[k];
    }),
  );
}
export class Minecraft {
  constructor(
    public store: Store,
    public net: Network,
  ) {}
  async versions(signal?: AbortSignal) {
    const data = await this.net.json<{ versions: VersionSummary[] }>(
      'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
      { signal },
      true,
    );
    return data.versions;
  }
  async loaders(version: string, loader: Loader, signal?: AbortSignal) {
    if (loader === 'vanilla') return [];
    if (loader === 'forge' || loader === 'neoforge')
      return new Forge(this.store, this.net).versions(version, loader, signal);
    const host = loader === 'fabric' ? 'https://meta.fabricmc.net' : 'https://meta.quiltmc.org';
    const list = await this.net.json<any[]>(
      `${host}/v${loader === 'fabric' ? '2' : '3'}/versions/loader/${encodeURIComponent(version)}`,
      { signal },
    );
    return list.map((x) => x.loader.version);
  }
  profile(id: string) {
    return path.join(this.store.dir(id), 'version.json');
  }
  async resolved(id: string) {
    const i = this.store.instance(id);
    if (i.external) {
      await assertExternal(this.store, id);
      return resolveExternalVersion(this.store.runtime(id), i.external.versionId);
    }
    return {
      version: await json<Version>(this.profile(id)),
      client: path.join(this.store.dir(id), 'client.jar'),
    };
  }
  async prepareNatives(id: string, version: Version) {
    if (!this.store.instance(id).external) return path.join(this.store.dir(id), 'natives');
    const dest = inside(path.join(this.store.root, 'cache', 'external-natives'), id);
    await checkGamePath(dest, true);
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    for (const f of this.libraryFiles(version, id).filter((f) => f.native)) {
      await checkGamePath(f.dest);
      if (f.artifact.sha1 && (await hashFile(f.dest)) !== f.artifact.sha1)
        throw new Error('原生库校验失败，请在原启动器修复');
      await extractZip(f.dest, dest, (p) => !f.exclude.some((e) => p.startsWith(e)));
    }
    return dest;
  }
  async ensureLogging(id: string, version: Version, signal: AbortSignal) {
    const logging = version.logging?.client;
    if (!logging) return undefined;
    const f = logging.file;
    const dest = inside(path.join(this.store.runtime(id), 'assets', 'log_configs'), f.id);
    if (this.store.instance(id).external) await checkGamePath(dest, true);
    try {
      await this.net.download(f.url, dest, { signal, hash: f.sha1, size: f.size });
    } catch (error) {
      throw new Error(
        `无法准备游戏日志配置 ${f.id}：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return dest;
  }
  async metadata(id: string, signal: AbortSignal) {
    const i = this.store.instance(id);
    const item = (await this.versions(signal)).find((v) => v.id === i.version);
    if (!item) throw new Error('找不到 Minecraft 版本');
    const file = path.join(this.store.root, 'cache', 'versions', i.version + '.json');
    await this.net.download(item.url, file, { signal, hash: item.sha1 });
    let v = await json<Version>(file);
    if (i.loader === 'fabric' || i.loader === 'quilt') {
      const lv = i.loaderVersion ?? (await this.loaders(i.version, i.loader, signal))[0];
      if (!lv) throw new Error('没有兼容的加载器');
      i.loaderVersion = lv;
      const host =
        i.loader === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';
      const child = await this.net.json<Version>(
        `${host}/versions/loader/${encodeURIComponent(i.version)}/${encodeURIComponent(lv)}/profile/json`,
        { signal },
      );
      v = mergeVersions(v, child);
    }
    return v;
  }
  libraryFiles(v: Version, id?: string) {
    const runtime = id ? this.store.runtime(id) : this.store.root;
    const files: { artifact: Artifact; dest: string; native: boolean; exclude: string[] }[] = [];
    for (const l of v.libraries) {
      if (!allowed(l.rules)) continue;
      const relative = mavenPath(l.name),
        a =
          l.downloads?.artifact ??
          (!l.downloads
            ? { path: relative, url: (l.url ?? 'https://libraries.minecraft.net/') + relative }
            : undefined);
      if (a)
        files.push({
          artifact: a,
          dest: inside(path.join(runtime, 'libraries'), a.path ?? relative),
          native: false,
          exclude: [],
        });
      const classifier = l.natives?.[platformName()]?.replace(
        '${arch}',
        process.arch === 'ia32' ? '32' : '64',
      );
      const native = classifier ? l.downloads?.classifiers?.[classifier] : undefined;
      if (native)
        files.push({
          artifact: native,
          dest: inside(
            path.join(runtime, 'libraries'),
            native.path ?? relative.replace('.jar', `-${classifier}.jar`),
          ),
          native: true,
          exclude: l.extract?.exclude ?? ['META-INF/'],
        });
    }
    return files;
  }
  async install(id: string, ctx: Work, finalStatus: 'ready' | 'installing' = 'ready') {
    const i = this.store.instance(id);
    if (i.external) throw new Error('外部版本请在原启动器安装或修复，然后刷新游戏文件夹');
    i.status = 'installing';
    delete i.error;
    this.store.save();
    try {
      ctx.progress(1, '获取版本信息');
      let v = await this.metadata(id, ctx.signal);
      if (!v.downloads?.client || !v.assetIndex) throw new Error('版本元数据不完整');
      const root = this.store.dir(id);
      await mkdir(root, { recursive: true });
      for (const d of ['mods', 'saves', 'resourcepacks', 'shaderpacks', 'screenshots', 'logs'])
        await mkdir(path.join(root, d), { recursive: true });
      const files = this.libraryFiles(v, id);
      const libraries = fileProgress(
        ctx,
        files.map((f) => f.artifact.size),
        5,
        35,
      );
      await pool(
        files,
        this.store.data.settings.concurrency,
        async (f, index) => {
          await this.net.download(f.artifact.url, f.dest, {
            signal: ctx.signal,
            hash: f.artifact.sha1,
            size: f.artifact.size,
            onProgress: (fraction) => libraries(index, fraction, '下载运行库'),
          });
        },
        ctx.signal,
      );
      ctx.progress(35, '下载游戏客户端');
      await this.net.download(v.downloads.client.url, path.join(root, 'client.jar'), {
        signal: ctx.signal,
        hash: v.downloads.client.sha1,
        size: v.downloads.client.size,
        onProgress: (fraction) => ctx.progress(35 + 25 * fraction, '下载游戏客户端'),
      });
      const assets = path.join(this.store.runtime(id), 'assets');
      const indexPath = inside(path.join(assets, 'indexes'), v.assetIndex.id + '.json');
      await this.net.download(v.assetIndex.url, indexPath, {
        signal: ctx.signal,
        hash: v.assetIndex.sha1,
        size: v.assetIndex.size,
        onProgress: (fraction) => ctx.progress(60 + 2 * fraction, '下载资源索引'),
      });
      const index = await json<{
        objects: Record<string, { hash: string; size: number }>;
        virtual?: boolean;
        map_to_resources?: boolean;
      }>(indexPath);
      const objects = Object.entries(index.objects);
      const assetsProgress = fileProgress(
        ctx,
        objects.map(([, a]) => a.size),
        62,
        95,
      );
      await pool(
        objects,
        this.store.data.settings.concurrency,
        async ([name, a], item) => {
          if (!/^[0-9a-f]{40}$/.test(a.hash)) throw new Error('无效资源哈希');
          const relative = `${a.hash.slice(0, 2)}/${a.hash}`;
          const dest = path.join(assets, 'objects', relative);
          await this.net.download('https://resources.download.minecraft.net/' + relative, dest, {
            signal: ctx.signal,
            hash: a.hash,
            size: a.size,
            onProgress: (fraction) => assetsProgress(item, fraction, '下载游戏资源'),
          });
          if (index.virtual || index.map_to_resources) {
            const p = inside(
              index.map_to_resources
                ? path.join(root, 'resources')
                : inside(path.join(assets, 'virtual'), v.assetIndex!.id),
              name,
            );
            await mkdir(path.dirname(p), { recursive: true });
            await copyFile(dest, p);
          }
        },
        ctx.signal,
      );
      ctx.progress(95, '整理游戏文件');
      const natives = path.join(root, 'natives');
      await rm(natives, { recursive: true, force: true });
      await mkdir(natives, { recursive: true });
      for (const f of files.filter((f) => f.native)) {
        ctx.signal.throwIfAborted();
        await extractZip(f.dest, natives, (name) => !f.exclude.some((e) => name.startsWith(e)));
      }
      await this.ensureLogging(id, v, ctx.signal);
      ctx.signal.throwIfAborted();
      if (i.loader === 'forge' || i.loader === 'neoforge')
        v = await new Forge(this.store, this.net).install(id, v, ctx);
      await atomicJson(this.profile(id), v);
      i.status = finalStatus;
      this.store.save();
    } catch (e) {
      i.status = 'error';
      i.error = ctx.signal.aborted
        ? '安装已取消，可重新安装'
        : e instanceof Error
          ? e.message
          : '安装失败';
      this.store.save();
      throw e;
    }
  }
}
