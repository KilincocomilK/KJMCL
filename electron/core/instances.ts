import path from 'node:path';
import {
  mkdirSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  existsSync,
  lstatSync,
} from 'node:fs';
import {
  mkdir,
  readdir,
  lstat,
  copyFile,
  readFile,
  writeFile,
  stat,
  realpath,
  rm,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { archiveWorld, restoreWorld } from './archives';
import { clientVersion } from './client-version';
import { Store } from './store';
import { atomicJson, exists, inside, json, extractZip, hashFile } from './files';
import { mergeVersions, mavenPath, allowed, type Version } from './minecraft';
import type { Work } from './tasks';
import type { Backup, Instance, MinecraftScan } from '../../shared/types';
export function contains(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}
export function claimDirectory(store: Store, directory: string, id: string) {
  if (!path.isAbsolute(directory) || path.parse(directory).root === path.resolve(directory))
    throw new Error('请选择完整的游戏子目录');
  const requested = path.resolve(directory);
  let ancestor = requested;
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (lstatSync(ancestor).isSymbolicLink()) throw new Error('游戏目录不能是符号链接');
  const dest = path.join(realpathSync.native(ancestor), path.relative(ancestor, requested)),
    legacy = path.join(store.root, 'instances', id);
  if (contains(dest, store.root) || (contains(store.root, dest) && dest !== legacy))
    throw new Error('游戏目录不能覆盖启动器数据目录');
  for (const i of store.data.instances) {
    if (contains(store.dir(i.id), dest) || contains(dest, store.dir(i.id)))
      throw new Error('游戏目录不能与其他实例重叠');
  }
  if (existsSync(dest) && readdirSync(dest).length)
    throw new Error('新实例请选择空目录；已有游戏请使用导入');
  mkdirSync(dest, { recursive: true });
  writeFileSync(path.join(dest, '.kjmcl-owner.json'), JSON.stringify({ app: 'KJMCL', id }));
  return realpathSync.native(dest);
}
export async function assertOwned(store: Store, id: string) {
  const dir = store.dir(id);
  if (!(await exists(dir)) && path.resolve(dir) === path.resolve(store.root, 'instances', id))
    return;
  if (
    (await lstat(dir)).isSymbolicLink() ||
    path.resolve(dir).toLowerCase() !== (await realpath(dir)).toLowerCase()
  )
    throw new Error('实例目录已被替换为链接');
  if (path.resolve(dir) === path.resolve(store.root, 'instances', id)) return;
  const owner = await json<{ app: string; id: string }>(path.join(dir, '.kjmcl-owner.json'));
  if (owner.app !== 'KJMCL' || owner.id !== id) throw new Error('目录所有权标记不匹配，已停止操作');
}
export async function copyTree(
  source: string,
  dest: string,
  ctx: Work,
  filter: (relative: string) => boolean = () => true,
  relative = '',
) {
  if (!(await exists(source))) return;
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error('不复制符号链接：' + relative);
  if (info.isDirectory()) {
    await mkdir(dest, { recursive: true });
    for (const d of await readdir(source)) {
      ctx.signal.throwIfAborted();
      const next = relative ? relative + '/' + d : d;
      if (filter(next)) await copyTree(path.join(source, d), path.join(dest, d), ctx, filter, next);
    }
  } else {
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(source, dest);
  }
}
export class Instances {
  private selections = new Map<string, { root: string; ids: string[] }>();
  constructor(private store: Store) {}
  async clone(sourceId: string, targetId: string, includeSaves: boolean, ctx: Work) {
    const source = this.store.dir(sourceId),
      target = this.store.dir(targetId);
    try {
      await copyTree(
        source,
        target,
        ctx,
        (p) =>
          !['.kjmcl-owner.json', 'session.lock', 'logs', 'crash-reports'].includes(
            p.split('/')[0],
          ) &&
          (includeSaves || p.split('/')[0] !== 'saves'),
      );
      const sourceInstance = this.store.instance(sourceId);
      Object.assign(this.store.instance(targetId), {
        memoryMb: sourceInstance.memoryMb,
        javaPath: sourceInstance.javaPath,
        jvmArgs: [...sourceInstance.jvmArgs],
        width: sourceInstance.width,
        height: sourceInstance.height,
        status: sourceInstance.status,
        playTime: 0,
      });
      ctx.signal.throwIfAborted();
      this.store.save();
      ctx.progress(100, '克隆完成');
    } catch (e) {
      this.store.instance(targetId).status = 'error';
      this.store.instance(targetId).error = '克隆未完成，请删除后重试';
      this.store.save();
      throw e;
    }
  }
  async relocate(id: string, directory: string, ctx: Work) {
    const i = this.store.instance(id),
      source = this.store.dir(id);
    await assertOwned(this.store, id);
    const target = claimDirectory(this.store, directory, id);
    await copyTree(source, target, ctx, (p) => p !== '.kjmcl-owner.json');
    ctx.signal.throwIfAborted();
    i.gameDir = target;
    this.store.save();
    ctx.progress(100, '已更换目录，原目录已保留');
  }
  async scan(directory: string): Promise<MinecraftScan> {
    const root = await realpath(directory);
    const ids = [];
    for (const d of await readdir(path.join(root, 'versions'), { withFileTypes: true }).catch(
      () => [],
    )) {
      if (!d.isDirectory() || !/^[^\\/:*?"<>|\x00-\x1f]+$/.test(d.name)) continue;
      if (await exists(path.join(root, 'versions', d.name, d.name + '.json'))) ids.push(d.name);
    }
    if (!ids.length) throw new Error('未找到 versions/<版本>/<版本>.json');
    const selectionId = randomUUID();
    this.selections.set(selectionId, { root, ids });
    return { selectionId, root, versions: ids.map((id) => ({ id, name: id })) };
  }
  async resolve(
    root: string,
    id: string,
    seen = new Set<string>(),
  ): Promise<{ version: Version; client: string }> {
    if (seen.has(id) || seen.size > 20) throw new Error('版本继承循环');
    seen.add(id);
    const file = inside(root, `versions/${id}/${id}.json`);
    const child = await json<Version & { jar?: string }>(file);
    const parent = child.inheritsFrom
      ? await this.resolve(root, child.inheritsFrom, seen)
      : undefined;
    const jarId = child.jar ?? id;
    const ownJar = inside(root, `versions/${jarId}/${jarId}.jar`);
    const client = (await exists(ownJar)) ? ownJar : parent?.client;
    if (!client) throw new Error('找不到游戏客户端 JAR');
    return { version: parent ? mergeVersions(parent.version, child) : child, client };
  }
  async import(selectionId: string, versionId: string, id: string, ctx: Work) {
    const selection = this.selections.get(selectionId);
    if (!selection?.ids.includes(versionId)) throw new Error('目录选择已失效，请重新选择');
    const root = selection.root,
      target = this.store.dir(id);
    if (contains(root, target) || contains(target, root))
      throw new Error('导入目标不能与原游戏目录重叠');
    const i = this.store.instance(id);
    i.localRuntime = true;
    i.status = 'installing';
    this.store.save();
    try {
      const { version, client } = await this.resolve(root, versionId);
      ctx.progress(5, '复制游戏与运行库');
      await copyFile(client, path.join(target, 'client.jar'));
      await copyTree(
        path.join(root, 'libraries'),
        path.join(this.store.runtime(id), 'libraries'),
        ctx,
      );
      await copyTree(path.join(root, 'assets'), path.join(this.store.runtime(id), 'assets'), ctx);
      const isolated = path.join(root, 'versions', versionId);
      const content =
        (await exists(path.join(isolated, 'mods'))) || (await exists(path.join(isolated, 'saves')))
          ? isolated
          : root;
      for (const name of [
        'mods',
        'saves',
        'config',
        'resourcepacks',
        'shaderpacks',
        'screenshots',
        'options.txt',
        'servers.dat',
      ])
        await copyTree(path.join(content, name), path.join(target, name), ctx);
      await mkdir(path.join(target, 'logs'), { recursive: true });
      await mkdir(path.join(target, 'natives'), { recursive: true });
      // Native classifiers need extraction even when the source launcher stored them elsewhere.
      const osName =
        process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
      for (const lib of version.libraries ?? []) {
        if (!allowed(lib.rules)) continue;
        const classifier = lib.natives?.[osName]?.replace(
          '${arch}',
          process.arch === 'ia32' ? '32' : '64',
        );
        const artifact = classifier ? lib.downloads?.classifiers?.[classifier] : undefined;
        if (artifact) {
          const file = inside(
            path.join(this.store.runtime(id), 'libraries'),
            artifact.path ?? mavenPath(lib.name).replace('.jar', `-${classifier}.jar`),
          );
          if (!(await exists(file))) throw new Error('缺少原生库，请先在原启动器完成安装');
          await extractZip(file, path.join(target, 'natives'), (p) => !p.startsWith('META-INF/'));
        }
      }
      const base = version.assetIndex?.id ?? version.inheritsFrom ?? versionId;
      i.version = base;
      const name = (version.id + ' ' + version.mainClass).toLowerCase();
      i.loader = name.includes('neoforge')
        ? 'neoforge'
        : name.includes('forge') || name.includes('modlauncher')
          ? 'forge'
          : name.includes('quilt')
            ? 'quilt'
            : name.includes('fabric')
              ? 'fabric'
              : 'vanilla';
      // Prefer the original base version in the inheritance chain, never the asset index number.
      let raw = await json<Version>(inside(root, `versions/${versionId}/${versionId}.json`));
      while (raw.inheritsFrom)
        raw = await json<Version>(
          inside(root, `versions/${raw.inheritsFrom}/${raw.inheritsFrom}.json`),
        );
      i.version = await clientVersion(path.join(target, 'client.jar'), raw.id);
      const loaderLibrary = (version.libraries ?? []).find((l) =>
        i.loader === 'fabric'
          ? l.name.startsWith('net.fabricmc:fabric-loader:')
          : i.loader === 'quilt'
            ? l.name.startsWith('org.quiltmc:quilt-loader:')
            : i.loader === 'neoforge'
              ? l.name.startsWith('net.neoforged:neoforge:')
              : i.loader === 'forge'
                ? l.name.startsWith('net.minecraftforge:forge:')
                : false,
      );
      if (loaderLibrary) i.loaderVersion = loaderLibrary.name.split(':')[2];
      await atomicJson(path.join(target, 'version.json'), version);
      ctx.signal.throwIfAborted();
      i.status = 'ready';
      this.store.save();
      ctx.progress(100, '导入完成，原目录未修改');
    } catch (e) {
      i.status = 'error';
      i.error = '游戏目录导入未完成，请删除后重试';
      this.store.save();
      throw e;
    }
  }
}
export class Backups {
  constructor(private store: Store) {}
  async worlds(id: string) {
    const root = path.join(this.store.dir(id), 'saves');
    const result = [];
    for (const d of await readdir(root, { withFileTypes: true }).catch(() => []))
      if (d.isDirectory() && (await exists(path.join(root, d.name, 'level.dat'))))
        result.push({
          name: d.name,
          modifiedAt: (await stat(path.join(root, d.name, 'level.dat'))).mtimeMs,
        });
    return result;
  }
  private root(id: string) {
    this.store.instance(id);
    return path.join(this.store.root, 'backups', id);
  }
  async list(id: string): Promise<Backup[]> {
    const root = this.root(id),
      out: Backup[] = [];
    for (const file of await readdir(root).catch(() => []))
      if (file.endsWith('.json')) out.push(await json<Backup>(inside(root, file)));
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }
  async create(id: string, world: string, ctx: Work) {
    const source = inside(path.join(this.store.dir(id), 'saves'), world);
    if (!(await exists(path.join(source, 'level.dat')))) throw new Error('存档不存在');
    const backupId = randomUUID(),
      root = this.root(id);
    await mkdir(root, { recursive: true });
    const tmp = path.join(root, backupId + '.tmp');
    try {
      await archiveWorld(source, tmp, ctx);
      ctx.signal.throwIfAborted();
      const { rename } = await import('node:fs/promises');
      await rename(tmp, path.join(root, backupId + '.zip'));
      await atomicJson(path.join(root, backupId + '.json'), {
        id: backupId,
        world,
        createdAt: Date.now(),
        size: (await stat(path.join(root, backupId + '.zip'))).size,
        sha256: await hashFile(path.join(root, backupId + '.zip'), 'sha256'),
      });
      ctx.progress(100, '存档已备份');
    } finally {
      await rm(tmp, { force: true });
    }
    return backupId;
  }
  async restore(id: string, backupId: string, ctx: Work) {
    const item = (await this.list(id)).find((b) => b.id === backupId);
    if (!item) throw new Error('备份不存在');
    const archive = inside(this.root(id), backupId + '.zip');
    if (!item.sha256 || (await hashFile(archive, 'sha256')) !== item.sha256)
      throw new Error('备份校验失败，文件可能已损坏');
    const name = item.world + '-恢复-' + Date.now() + '-' + randomUUID().slice(0, 6);
    const dest = inside(path.join(this.store.dir(id), 'saves'), name);
    await mkdir(dest, { recursive: true });
    try {
      ctx.signal.throwIfAborted();
      await restoreWorld(archive, dest, ctx);
      ctx.signal.throwIfAborted();
      ctx.progress(100, '已恢复为 ' + name);
    } catch (e) {
      await rm(dest, { recursive: true, force: true });
      throw e;
    }
  }
  async remove(id: string, backupId: string) {
    if (!(await this.list(id)).some((b) => b.id === backupId)) throw new Error('备份不存在');
    await rm(inside(this.root(id), backupId + '.zip'));
    await rm(inside(this.root(id), backupId + '.json'));
  }
}
