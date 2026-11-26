import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { Instance, Backup, VersionTrial } from '../../shared/types';
import { backupMatchesWorld, restoreWorld } from './archives';
import { checkGamePath } from './game-folders';
import { assertOwned, Backups, contains, copyTree } from './instances';
import { hashFile, inside } from './files';
import { isPackContentRoot, readStoredPack, selectedDownloads } from './pack-manifest';
import type { Store } from './store';
import { progressRange, type Work } from './tasks';

const trialContent = [
  'mods',
  'config',
  'defaultconfigs',
  'kubejs',
  'scripts',
  'resourcepacks',
  'shaderpacks',
  'datapacks',
  'global_packs',
  'openloader',
  'patchouli_books',
  'resources',
  'texturepacks',
  'options.txt',
  'servers.dat',
  'hotbar.nbt',
  'mods-lock.json',
  'curseforge-lock.json',
];

async function entryAt(file: string) {
  await checkGamePath(file, true);
  return lstat(file).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

const stageOwner = '.kjmcl-trial-owner';

// Only an interrupted, owned staging directory can be discarded on a new copy attempt.
async function checkStage(stage: string, owner: string) {
  const entry = await entryAt(stage);
  if (!entry) return false;
  if (entry.isDirectory()) {
    const marker = path.join(stage, stageOwner);
    if ((await entryAt(marker))?.isFile() && (await readFile(marker, 'utf8')) === owner)
      return true;
    if (!(await readdir(stage)).length) {
      await rmdir(stage);
      return false;
    }
  }
  throw new Error('副本暂存目录已被修改，请检查文件或删除试更副本');
}

export class TrialUpdates {
  constructor(
    private store: Store,
    private backups: Backups,
  ) {}

  private async archive(source: string, backup: Backup) {
    if (!backup.id || path.basename(backup.id) !== backup.id) throw new Error('备份编号无效');
    const file = inside(path.join(this.store.root, 'backups', source), backup.id + '.zip');
    await checkGamePath(file);
    if (!backup.sha256 || (await hashFile(file, 'sha256')) !== backup.sha256)
      throw new Error('存档备份校验失败');
    return file;
  }

  async prepareTrial(sourceId: string, ctx: Work): Promise<string[]> {
    await assertOwned(this.store, sourceId);
    await checkGamePath(path.join(this.store.dir(sourceId), 'saves'), true);
    const worlds = await this.backups.worlds(sourceId);
    const previous = await this.backups.list(sourceId);
    const result: string[] = [];
    for (const [index, world] of worlds.entries()) {
      const work = progressRange(
        ctx,
        (index * 100) / worlds.length,
        ((index + 1) * 100) / worlds.length,
      );
      work.progress(0, '核对存档 · ' + world.name);
      const saved = previous.find((item) => item.world === world.name);
      const live = inside(path.join(this.store.dir(sourceId), 'saves'), world.name);
      await checkGamePath(live);
      // A missing or damaged older archive is kept and a new verified backup is made.
      const archive = saved && (await this.archive(sourceId, saved).catch(() => undefined));
      if (archive && saved && (await backupMatchesWorld(live, archive, work))) {
        result.push(saved.id);
        continue;
      }
      const id = await this.backups.create(sourceId, world.name, work);
      const created = (await this.backups.list(sourceId)).find((backup) => backup.id === id);
      if (
        !created ||
        !(await backupMatchesWorld(live, await this.archive(sourceId, created), work))
      )
        throw new Error('备份时存档发生变化，请关闭原游戏后重新试更：' + world.name);
      result.push(id);
    }
    return result;
  }

  // Pack retries may arrive after a previous attempt already committed some worlds.
  async restoreTrial(
    sourceId: string,
    targetId: string,
    ids: string[],
    ctx: Work,
    bundledWorlds: string[] = [],
  ) {
    if (sourceId === targetId || this.store.instance(targetId).external)
      throw new Error('请选择独立的试更副本');
    await assertOwned(this.store, targetId);
    await this.restoreInto(sourceId, this.store.dir(targetId), ids, ctx, bundledWorlds);
  }

  private async restoreInto(
    sourceId: string,
    target: string,
    ids: string[],
    ctx: Work,
    bundledWorlds: string[] = [],
  ) {
    const backups = await this.backups.list(sourceId);
    const supplied = new Set(bundledWorlds.map((name) => name.normalize('NFC').toLowerCase()));
    const saves = path.join(target, 'saves');
    await checkGamePath(saves, true);
    await mkdir(saves, { recursive: true });
    for (const id of ids) {
      ctx.signal.throwIfAborted();
      const item = backups.find((entry) => entry.id === id);
      if (!item || !item.world || item.world === '.' || path.basename(item.world) !== item.world)
        throw new Error('试更所需的存档备份已不可用');
      const archive = await this.archive(sourceId, item);
      // A pack may ship a map in the same folder. Use a stable sibling on every retry.
      const name = supplied.has(item.world.normalize('NFC').toLowerCase())
        ? item.world.slice(0, 64) + '-试更-' + item.id.slice(0, 8)
        : item.world;
      const dest = inside(saves, name);
      await checkGamePath(dest, true);
      const stat = await lstat(dest).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (stat) {
        if (stat.isDirectory() && (await backupMatchesWorld(dest, archive, ctx))) continue;
        throw new Error('副本已有不同的同名存档，请先更名：' + name);
      }
      const stage = await mkdtemp(path.join(saves, '.kjmcl-restore-'));
      try {
        await restoreWorld(archive, stage, ctx);
        ctx.signal.throwIfAborted();
        await rename(stage, dest);
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    }
  }

  private checkpoint(target: Instance, next: VersionTrial | undefined) {
    const previous = target.versionTrial;
    target.versionTrial = next;
    try {
      this.store.save();
    } catch (error) {
      target.versionTrial = previous;
      throw error;
    }
  }

  private async copyPackFiles(source: Instance, target: Instance, stage: string, ctx: Work) {
    const record =
      source.packInstall?.phase === 'complete' ? source.packInstall : source.packContentSource;
    if (source.external || !record) {
      delete target.packContentSource;
      return;
    }
    const plan = await readStoredPack(this.store.root, record.archive, ctx.signal);
    const files = [
      ...plan.overrides.map((f) => f.relative),
      ...selectedDownloads(plan, new Set(record.optional)).map((f) => f.path),
    ];
    for (const name of files) {
      ctx.signal.throwIfAborted();
      const top = name.split('/')[0];
      if (top.toLowerCase() === 'saves' || trialContent.includes(top)) continue;
      const src = inside(this.store.dir(source.id), name);
      const entry = await entryAt(src);
      if (!entry) continue;
      if (!entry.isFile()) throw new Error('整合包文件已被替换为目录或特殊文件：' + name);
      const dest = inside(stage, name);
      await checkGamePath(dest, true);
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(src, dest);
    }
    // Future version trials can resolve the original pack paths without reinstalling its old loader.
    target.packContentSource = { archive: record.archive, optional: [...record.optional] };
  }

  private async stageVersionCopy(target: Instance, stage: string, owner: string, ctx: Work) {
    const sourceId = target.versionTrial!.sourceId;
    const source = this.store.dir(sourceId),
      dest = this.store.dir(target.id);
    if (contains(source, dest) || contains(dest, source)) throw new Error('试更目录与原实例重叠');
    const sourceInstance = this.store.instance(sourceId);
    if (sourceInstance.status !== 'ready') throw new Error('请先完成原实例安装');
    if (!(await entryAt(source))?.isDirectory())
      throw new Error('找不到原实例的游戏目录，请恢复后重试');
    if (await checkStage(stage, owner)) await rm(stage, { recursive: true });
    await mkdir(stage);
    await writeFile(path.join(stage, stageOwner), owner, { flag: 'wx' });
    const backups = await this.prepareTrial(sourceId, progressRange(ctx, 0, 35));
    ctx.progress(35, '复制模组与游戏配置');
    for (const name of trialContent) {
      ctx.signal.throwIfAborted();
      const file = path.join(source, name);
      await checkGamePath(file, true);
      await copyTree(file, path.join(stage, name), ctx);
    }
    await this.copyPackFiles(sourceInstance, target, stage, ctx);
    await this.restoreInto(sourceId, stage, backups, progressRange(ctx, 40, 95));
    ctx.signal.throwIfAborted();
    const entries = (await readdir(stage)).filter((name) => name !== stageOwner).sort();
    this.checkpoint(target, { version: 1, sourceId, phase: 'commit', entries });
  }

  async installVersionCopy(
    targetId: string,
    ctx: Work,
    lockSource: (sourceId: string, copy: () => Promise<void>) => Promise<void>,
    install: (ctx: Work) => Promise<void>,
  ) {
    const target = this.store.instance(targetId),
      record = target.versionTrial;
    if (!record || target.external || record.sourceId === target.id)
      throw new Error('试更副本记录无效');
    const dest = this.store.dir(targetId),
      stage = path.join(dest, '.kjmcl-version-trial');
    const owner = ['KJMCL', '1', targetId, record.sourceId].join('\n');
    try {
      await assertOwned(this.store, targetId);
      const marker = path.join(dest, '.kjmcl-owner.json');
      if (!(await entryAt(marker))?.isFile()) throw new Error('试更副本的目录所有权标记缺失');
      const owned = JSON.parse(await readFile(marker, 'utf8'));
      if (owned.app !== 'KJMCL' || owned.id !== targetId)
        throw new Error('试更副本的目录所有权标记不匹配');
      target.status = 'installing';
      delete target.error;
      this.store.save();
      const copy = progressRange(ctx, 0, 40);
      if (record.phase === 'copy') {
        if (!this.store.data.instances.some((i) => i.id === record.sourceId))
          throw new Error('原实例已移除，请删除试更副本后重新创建');
        await lockSource(record.sourceId, () => this.stageVersionCopy(target, stage, owner, copy));
      }
      const pending = target.versionTrial!;
      if (pending.phase === 'commit') {
        if (!(await checkStage(stage, owner)))
          throw new Error('副本暂存文件缺失，请删除试更副本后重试');
        for (const name of pending.entries) {
          if (
            name !== 'saves' &&
            !trialContent.includes(name) &&
            !(target.packContentSource && isPackContentRoot(name))
          )
            throw new Error('副本文件清单无效');
          ctx.signal.throwIfAborted();
          const from = inside(stage, name),
            to = inside(dest, name);
          const staged = await entryAt(from),
            moved = await entryAt(to);
          if (staged && moved) throw new Error('副本中已有同名内容，请先移走或更名：' + name);
          if (!staged && !moved) throw new Error('副本复制内容缺失，请删除试更副本后重试：' + name);
          if (staged) await rename(from, to);
          copy.progress(97, '移入副本 · ' + name);
        }
        this.checkpoint(target, { version: 1, sourceId: record.sourceId, phase: 'install' });
      }
      if (await checkStage(stage, owner)) {
        // All payload entries have been moved. Leave unexpected files for manual inspection.
        if ((await readdir(stage)).some((name) => name !== stageOwner))
          throw new Error('副本暂存目录仍有额外文件，请移走后重试');
        await rm(path.join(stage, stageOwner));
        await rmdir(stage);
      }
      ctx.signal.throwIfAborted();
      await install(progressRange(ctx, 40, 100));
      ctx.signal.throwIfAborted();
      ctx.beginCommit?.();
      target.status = 'ready';
      this.checkpoint(target, undefined);
    } catch (error) {
      target.status = 'error';
      target.error = ctx.signal.aborted
        ? '版本试更已暂停，可继续准备副本'
        : error instanceof Error
          ? error.message
          : String(error);
      this.store.save();
      throw error;
    }
  }
}
