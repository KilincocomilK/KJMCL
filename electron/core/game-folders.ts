import path from 'node:path';
import os from 'node:os';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Store } from './store';
import type { Work } from './tasks';
import { inside, exists } from './files';
import { mergeVersions, type Version } from './minecraft';
import { clientVersion } from './client-version';
import {
  numericSettings,
  pclIsolation,
  readOfficialProfiles,
  type ProfileOptions,
} from './launcher-profiles';
import { instanceSchema } from '../../shared/schema';
import type {
  GameFolder,
  GameLayout,
  Instance,
  MinecraftScan,
  Api,
  Loader,
} from '../../shared/types';

const versionName = (v: string) =>
  typeof v === 'string' && !!v.trim() && instanceSchema.shape.version.safeParse(v).success;
const same = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const within = (a: string, b: string) => {
  const r = path.relative(a, b);
  return !r || (r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r));
};

/** Reject substituted links, including intermediate junctions, without writing owner files. */
export async function checkGamePath(file: string, missing = false) {
  if (!path.isAbsolute(file)) throw new Error('游戏路径必须为绝对路径');
  let current = path.parse(file).root;
  for (const segment of path.relative(current, file).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await lstat(current).catch((e) => {
      if (missing && e.code === 'ENOENT') return undefined;
      throw e;
    });
    if (info?.isSymbolicLink()) throw new Error('游戏路径包含符号链接或 junction，已停止操作');
  }
}
async function readConfig<T>(file: string): Promise<T> {
  await checkGamePath(file);
  const info = await lstat(file);
  if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error('版本配置无效或过大');
  return JSON.parse(await readFile(file, 'utf8')) as T;
}
export async function resolveExternalVersion(
  root: string,
  id: string,
  seen = new Set<string>(),
): Promise<{ version: Version; client: string; base: string }> {
  if (!versionName(id)) throw new Error('版本路径无效');
  if (seen.has(id) || seen.size >= 20) throw new Error('版本继承循环或过深');
  seen.add(id);
  const child = await readConfig<Version & { jar?: string }>(
    inside(root, `versions/${id}/${id}.json`),
  );
  if (!versionName(child.id) || (child.libraries !== undefined && !Array.isArray(child.libraries)))
    throw new Error('版本元数据无效');
  child.libraries ??= [];
  const parent = child.inheritsFrom
    ? await resolveExternalVersion(root, child.inheritsFrom, seen)
    : undefined;
  const jarId = child.jar ?? id;
  if (!versionName(jarId)) throw new Error('客户端 JAR 路径无效');
  const own = inside(root, `versions/${jarId}/${jarId}.jar`);
  await checkGamePath(own, true);
  const client = (await exists(own)) ? own : parent?.client;
  if (!client) throw new Error('缺少客户端 JAR，请在原启动器补齐后刷新');
  const version = parent ? mergeVersions(parent.version, child) : child;
  if (typeof version.mainClass !== 'string' || !version.mainClass) throw new Error('缺少游戏主类');
  return { version, client, base: parent?.base ?? child.id };
}
export async function assertExternal(store: Store, id: string) {
  const i = store.instance(id);
  if (!i.external) throw new Error('不是外部索引实例');
  if (i.status === 'error') throw new Error(i.error || '请先刷新游戏文件夹并确认运行目录');
  const folder = store.folder(i.external.folderId);
  await checkGamePath(folder.path);
  await checkGamePath(store.dir(id));
  await checkGamePath(
    inside(folder.path, `versions/${i.external.versionId}/${i.external.versionId}.json`),
  );
}
function metadata(version: Version): { loader: Loader; loaderVersion?: string } {
  const names = (
    version.id +
    ' ' +
    version.mainClass +
    ' ' +
    version.libraries.map((l) => l.name).join(' ')
  ).toLowerCase();
  const loader: Loader = names.includes('neoforge')
    ? 'neoforge'
    : names.includes('forge') || names.includes('modlauncher')
      ? 'forge'
      : names.includes('quilt')
        ? 'quilt'
        : names.includes('fabric')
          ? 'fabric'
          : 'vanilla';
  const prefix = {
    fabric: 'net.fabricmc:fabric-loader:',
    quilt: 'org.quiltmc:quilt-loader:',
    forge: 'net.minecraftforge:forge:',
    neoforge: 'net.neoforged:neoforge:',
    vanilla: '',
  }[loader];
  return {
    loader,
    loaderVersion: prefix
      ? version.libraries.find((l) => l.name.startsWith(prefix))?.name.split(':')[2]
      : undefined,
  };
}
type Entry = MinecraftScan['versions'][number] & {
  version?: string;
  loader?: Loader;
  loaderVersion?: string;
  settings?: ProfileOptions;
  directoryError?: boolean;
};
export class GameFolders {
  private selections = new Map<string, { root: string; expires: number; entries: Entry[] }>();
  constructor(private store: Store) {}
  private async safeRoot(directory: string, stored = false) {
    if (stored) await checkGamePath(directory);
    const root = await realpath(directory);
    if (
      !(await lstat(root)).isDirectory() ||
      same(root, path.parse(root).root) ||
      same(root, await realpath(os.homedir()))
    )
      throw new Error('请选择具体的游戏文件夹');
    await checkGamePath(root);
    if (within(root, this.store.root) || within(this.store.root, root))
      throw new Error('外部游戏文件夹不能与启动器数据目录重叠');
    for (const i of this.store.data.instances.filter((v) => !v.external))
      if (within(root, this.store.dir(i.id)) || within(this.store.dir(i.id), root))
        throw new Error('文件夹与受管实例重叠');
    for (const f of this.store.data.gameFolders)
      if (!same(root, f.path) && (within(root, f.path) || within(f.path, root)))
        throw new Error('游戏文件夹不能相互嵌套');
    return root;
  }
  private async runDirectory(
    root: string,
    versionId: string,
    layout: GameLayout,
    official?: ProfileOptions,
    settings: ProfileOptions = {},
  ) {
    const isolated = inside(root, `versions/${versionId}`);
    let selected = layout === 'version' ? isolated : root;
    if (layout === 'auto') {
      const modern = path.join(isolated, '.hmcl', 'config', 'instance-game-settings.json');
      const hasModern = await exists(modern);
      const config = hasModern ? modern : path.join(isolated, 'hmclversion.cfg');
      if (await exists(path.join(isolated, 'modpack.cfg'))) selected = isolated;
      else if (await exists(config)) {
        const v = await readConfig<{
          gameDirType?: number;
          gameDir?: string;
          runningDirectory?: string;
          overrideProperties?: string[];
          usesGlobal?: boolean;
          maxMemory?: number;
          autoMemory?: boolean;
          width?: number;
          height?: number;
        }>(config);
        const active = (key: string) =>
          hasModern ? v.overrideProperties?.includes(key) : v.usesGlobal !== true;
        Object.assign(
          settings,
          numericSettings(
            active('width') && v.width,
            active('height') && v.height,
            active('maxMemory') && !v.autoMemory && v.maxMemory,
          ),
        );
        if (hasModern) {
          // HMCL keeps dormant per-instance values when this setting inherits its preset.
          if (v.overrideProperties?.includes('runningDirectory'))
            selected = v.runningDirectory?.trim()
              ? path.resolve(root, v.runningDirectory)
              : isolated;
          else selected = await this.detectDirectory(root, isolated);
        } else if (v.gameDirType === 1) selected = isolated;
        else if (v.gameDirType === 2 && v.gameDir) selected = path.resolve(root, v.gameDir);
        else if (v.gameDirType !== 0) selected = await this.detectDirectory(root, isolated);
      } else {
        const indie = await pclIsolation(isolated);
        if (indie !== undefined) selected = indie ? isolated : root;
        else if (official?.ambiguous)
          throw new Error('多个官方配置使用不同运行目录，请手动选择隔离方式');
        else if (official?.gameDir) selected = official.gameDir;
        else selected = await this.detectDirectory(root, isolated);
      }
    }
    await checkGamePath(selected);
    selected = await realpath(selected);
    await this.safeRootForContent(root, selected);
    return selected;
  }
  private async detectDirectory(root: string, isolated: string) {
    for (const name of ['mods', 'saves', 'config', 'options.txt', 'modpack.cfg'])
      if (await exists(path.join(isolated, name))) return isolated;
    return root;
  }
  private async safeRootForContent(root: string, selected: string) {
    await checkGamePath(selected);
    if (!(await lstat(selected)).isDirectory()) throw new Error('运行目录不是文件夹');
    if (!within(root, selected)) await this.safeRoot(selected);
  }
  private async entries(root: string, layouts = new Map<string, GameLayout>(), ctx?: Work) {
    const versions = path.join(root, 'versions');
    await checkGamePath(versions, true);
    if (!(await exists(versions))) return [];
    const names = (await readdir(versions, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && versionName(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    if (names.length > 2000) throw new Error('版本目录超过 2000 个，请分文件夹管理');
    const out: Entry[] = [];
    const profiles = await readOfficialProfiles(root);
    for (const [index, versionId] of names.entries()) {
      ctx?.signal.throwIfAborted();
      ctx?.progress((98 * index) / names.length, versionId);
      if (!(await exists(inside(root, `versions/${versionId}/${versionId}.json`)))) continue;
      const layout = layouts.get(versionId) ?? 'auto';
      const profile = profiles.get(versionId);
      const settings = numericSettings(profile?.width, profile?.height, profile?.memoryMb);
      const entry: Entry = {
        id: versionId,
        name: profile?.name ?? versionId,
        layout,
        gameDir: root,
        settings,
      };
      try {
        entry.gameDir = await this.runDirectory(root, versionId, layout, profile, settings);
      } catch (e) {
        entry.directoryError = true;
        entry.error = e instanceof Error ? e.message : String(e);
      }
      try {
        const { version, client, base } = await resolveExternalVersion(root, versionId);
        const info = metadata(version),
          actualVersion = await clientVersion(client, base);
        if (
          !versionName(actualVersion) ||
          !instanceSchema.shape.loaderVersion.safeParse(info.loaderVersion).success
        )
          throw new Error('游戏或加载器版本标识无效，请在原启动器检查');
        Object.assign(entry, info, { version: actualVersion });
      } catch (e) {
        entry.error ??= e instanceof Error ? e.message : String(e);
      }
      out.push(entry);
    }
    return out;
  }
  async scan(directory: string, allowGameData = false): Promise<MinecraftScan> {
    const root = await this.safeRoot(directory);
    const entries = await this.entries(root);
    if (
      !entries.length &&
      !(
        allowGameData &&
        (await readdir(root)).some((name) =>
          /^(?:saves|mods|options\.txt|resourcepacks|shaderpacks|servers\.dat)$/i.test(name),
        )
      )
    )
      throw new Error('未找到游戏版本、存档或游戏设置');
    const selectionId = randomUUID();
    for (const [key, v] of this.selections) if (v.expires < Date.now()) this.selections.delete(key);
    if (this.selections.size >= 20) this.selections.delete(this.selections.keys().next().value!);
    this.selections.set(selectionId, { root, entries, expires: Date.now() + 10 * 60_000 });
    return { selectionId, root, versions: entries };
  }
  async confirmed(value: Parameters<Api['importMinecraft']>[0], ctx?: Work) {
    const ticket = this.selections.get(value.selectionId);
    if (!ticket || ticket.expires < Date.now()) throw new Error('目录预览已过期，请重新选择');
    if (value.layouts.some((l) => !ticket.entries.some((e) => e.id === l.versionId)))
      throw new Error('版本不属于此目录');
    const root = await this.safeRoot(ticket.root, true);
    const entries = await this.entries(
      root,
      new Map(value.layouts.map((l) => [l.versionId, l.layout])),
      ctx,
    );
    // The displayed custom working directories must not change between preview and confirmation.
    if (entries.length !== ticket.entries.length) throw new Error('游戏版本已变化，请重新预览');
    for (const entry of entries) {
      const before = ticket.entries.find((e) => e.id === entry.id);
      if (!before || (entry.layout === 'auto' && before.gameDir !== entry.gameDir))
        throw new Error('游戏配置已变化，请重新预览');
    }
    await this.safeRoot(root, true);
    ctx?.signal.throwIfAborted();
    return { root, entries };
  }
  async add(value: Parameters<Api['importMinecraft']>[0], ctx?: Work) {
    const { root, entries } = await this.confirmed(value, ctx);
    const existing = this.store.data.gameFolders.find((f) => same(f.path, root));
    const folder = existing ?? {
      id: randomUUID(),
      name: value.name,
      path: root,
      addedAt: Date.now(),
      refreshedAt: 0,
    };
    ctx?.progress(98, '保存实例索引');
    const previous = {
      instances: structuredClone(this.store.data.instances),
      gameFolders: structuredClone(this.store.data.gameFolders),
      selectedInstanceId: this.store.data.selectedInstanceId,
      selectedGameFolderId: this.store.data.selectedGameFolderId,
    };
    try {
      if (!existing) this.store.data.gameFolders.push(folder);
      this.commit(folder, entries);
      this.store.data.selectedGameFolderId = folder.id;
      this.store.data.selectedInstanceId = this.store.data.instances.find(
        (i) => i.external?.folderId === folder.id,
      )?.id;
      this.store.save();
      this.selections.delete(value.selectionId);
    } catch (error) {
      Object.assign(this.store.data, previous);
      throw error;
    }
    return folder.id;
  }
  private commit(folder: GameFolder, entries: Entry[]) {
    const found = new Set(entries.map((e) => e.id));
    for (const entry of entries) {
      let i = this.store.data.instances.find(
        (v) => v.external?.folderId === folder.id && v.external.versionId === entry.id,
      );
      if (!i) {
        i = {
          id: randomUUID(),
          name: entry.name.trim().slice(0, 80),
          version: entry.version ?? entry.id,
          loader: entry.loader ?? 'vanilla',
          status: 'ready',
          createdAt: Date.now(),
          playTime: 0,
          memoryMb: this.store.data.settings.memoryMb,
          javaPath: '',
          jvmArgs: [],
          width: 1280,
          height: 720,
          ...entry.settings,
        };
      }
      const validated = instanceSchema.parse({
        ...i,
        gameDir: entry.gameDir,
        version: entry.version ?? i.version,
        loader: entry.loader ?? i.loader,
        loaderVersion: entry.loaderVersion,
        status: entry.error ? 'error' : 'ready',
        error: entry.error,
        external: { folderId: folder.id, versionId: entry.id, layout: entry.layout },
      });
      Object.assign(i, validated);
      if (!this.store.data.instances.includes(i)) this.store.data.instances.push(i);
    }
    // Keep missing versions and their settings/history; never silently discard user state.
    for (const i of this.store.data.instances.filter((v) => v.external?.folderId === folder.id))
      if (!found.has(i.external!.versionId)) {
        i.status = 'error';
        i.error = '原版本已移除或不可访问，刷新后可恢复';
      }
    folder.refreshedAt = Date.now();
    delete folder.error;
  }
  async refresh(id: string) {
    const folder = this.store.folder(id);
    try {
      await this.safeRoot(folder.path, true);
      const layouts = new Map(
        this.store.data.instances
          .filter((i) => i.external?.folderId === id)
          .map((i) => [i.external!.versionId, i.external!.layout]),
      );
      const entries = await this.entries(folder.path, layouts);
      // Keep accepted working paths stable if another launcher changes its isolation setting.
      for (const e of entries) {
        const old = this.store.data.instances.find(
          (i) => i.external?.folderId === id && i.external.versionId === e.id,
        );
        if (old && old.gameDir !== e.gameDir && e.layout === 'auto') {
          e.gameDir = old.gameDir!;
          e.error = '原启动器的运行目录已变化，请在实例设置中重新确认目录';
        }
      }
      this.commit(folder, entries);
    } catch (e) {
      folder.error = e instanceof Error ? e.message : String(e);
      for (const i of this.store.data.instances.filter((v) => v.external?.folderId === id)) {
        i.status = 'error';
        i.error = '游戏文件夹不可访问，请检查磁盘连接后刷新';
      }
    }
    this.store.save();
  }
  remove(id: string) {
    this.store.folder(id);
    this.store.data.instances = this.store.data.instances.filter(
      (i) => i.external?.folderId !== id,
    );
    this.store.data.gameFolders = this.store.data.gameFolders.filter((f) => f.id !== id);
    if (this.store.data.selectedGameFolderId === id) delete this.store.data.selectedGameFolderId;
    if (!this.store.data.instances.some((i) => i.id === this.store.data.selectedInstanceId))
      this.store.data.selectedInstanceId = this.store.data.instances[0]?.id;
    this.store.save();
  }
  async setLayout(id: string, layout: GameLayout) {
    const i = this.store.instance(id);
    if (!i.external) throw new Error('请选择外部版本');
    const folder = this.store.folder(i.external.folderId);
    const profiles = await readOfficialProfiles(folder.path);
    i.gameDir = await this.runDirectory(
      folder.path,
      i.external.versionId,
      layout,
      profiles.get(i.external.versionId),
    );
    i.external.layout = layout;
    this.store.save();
    await this.refresh(folder.id);
  }
}
