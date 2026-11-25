import path from 'node:path';
import {
  mkdirSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  existsSync,
  lstatSync,
} from 'node:fs';
import { mkdir, readdir, lstat, copyFile, stat, realpath, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { archiveWorld, restoreWorld } from './archives';
import { safeExport } from './safe-export';
import { GameFolders, assertExternal, checkGamePath } from './game-folders';
import { Store } from './store';
import { atomicJson, exists, inside, json, hashFile } from './files';
import type { Work } from './tasks';
import type { Backup } from '../../shared/types';
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
  for (const folder of store.data.gameFolders)
    if (contains(dest, folder.path) || contains(folder.path, dest))
      throw new Error('新实例目录不能覆盖已索引的游戏文件夹');
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
  if (store.instance(id).external) return assertExternal(store, id);
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
  readonly folders: GameFolders;
  constructor(private store: Store) {
    this.folders = new GameFolders(store);
  }
  async clone(sourceId: string, targetId: string, includeSaves: boolean, ctx: Work) {
    if (this.store.instance(sourceId).external)
      throw new Error('外部版本只保留索引，不复制游戏文件');
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
        launchOptions: sourceInstance.launchOptions
          ? {
              ...structuredClone(sourceInstance.launchOptions),
              target:
                !includeSaves && sourceInstance.launchOptions.target.kind === 'world'
                  ? { kind: 'menu' }
                  : structuredClone(sourceInstance.launchOptions.target),
            }
          : undefined,
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
    if (this.store.instance(id).external)
      throw new Error('外部版本运行位置由游戏文件夹决定，不能搬移');
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
  async checkExport(id: string, world: string, destination: string) {
    const source = inside(path.join(this.store.dir(id), 'saves'), world);
    await checkGamePath(source);
    await checkGamePath(path.dirname(destination));
    if (contains(source, destination)) throw new Error('请选择世界目录以外的位置');
    if (await exists(destination)) throw new Error('文件已存在，请选择新的文件名');
  }
  async create(id: string, world: string, ctx: Work, exportPath?: string) {
    const source = inside(path.join(this.store.dir(id), 'saves'), world);
    await checkGamePath(source);
    if (exportPath) await this.checkExport(id, world, exportPath);
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
      if (exportPath) {
        try {
          await this.checkExport(id, world, exportPath);
          await safeExport(exportPath, (tmp) => copyFile(path.join(root, backupId + '.zip'), tmp));
        } catch (e) {
          throw new Error(
            '已存入备份库，导出失败：' + (e instanceof Error ? e.message : String(e)),
          );
        }
      }
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
