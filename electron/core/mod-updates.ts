import path from 'node:path';
import { copyFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './store';
import type { Network } from './network';
import type { Mods, LockEntry } from './mods';
import type { CurseForge, CFLock } from './curseforge';
import { hashFile, inside } from './files';
import { checkGamePath } from './game-folders';
import type { Work } from './tasks';
import type { ModUpdateItem, ModUpdatePreview } from '../../shared/types';
import { ModUpdateHistory, fingerprint, jarName, regular } from './mod-update-history';

const mrLock = z.array(
  z
    .object({
      projectId: z.string().min(1),
      versionId: z.string().min(1),
      file: jarName,
      sha512: z.string().regex(/^[a-f0-9]{128}$/i),
    })
    .passthrough(),
);
const cfLock = z.array(
  z
    .object({
      projectId: z.number().int().positive(),
      fileId: z.number().int().positive(),
      file: jarName,
      sha1: z.string().regex(/^[a-f0-9]{40}$/i),
    })
    .passthrough(),
);
interface Artifact extends ModUpdateItem {
  url: string;
  digest: string;
  oldDigest?: string;
}
type Source = ModUpdateItem['source'];
interface Plan {
  token: string;
  signature: string;
  items: Artifact[];
  modrinth: LockEntry[];
  curseforge: CFLock[];
}
const lockNames = { modrinth: 'mods-lock.json', curseforge: 'curseforge-lock.json' } as const;
const key = (source: Source, project: string | number) => source + ':' + project;

export class ModUpdates {
  readonly history: ModUpdateHistory;
  private plans = new Map<string, Plan>();
  constructor(
    private store: Store,
    private net: Network,
    private mods: Mods,
    private cf: CurseForge,
  ) {
    this.history = new ModUpdateHistory(store);
  }
  private async signature(id: string) {
    const { version, loader, loaderVersion } = this.store.instance(id),
      dir = this.store.dir(id);
    return JSON.stringify([
      dir,
      version,
      loader,
      loaderVersion,
      await fingerprint(path.join(dir, lockNames.modrinth)),
      await fingerprint(path.join(dir, lockNames.curseforge)),
    ]);
  }
  private async files(id: string) {
    const dir = this.mods.dir(id);
    await checkGamePath(dir, true);
    const names = await readdir(dir).catch((e) => {
      if (e.code === 'ENOENT') return [] as string[];
      throw e;
    });
    const files = new Map<string, string[]>();
    for (const name of names) {
      const base = name.toLowerCase().replace(/\.disabled$/, '');
      files.set(base, [...(files.get(base) ?? []), name]);
    }
    return files;
  }
  async preview(id: string, ctx: Work): Promise<ModUpdatePreview> {
    this.plans.delete(id);
    const signature = await this.signature(id);
    const modrinth = mrLock.parse(await this.mods.lock(id)),
      curseforge = cfLock.parse(await this.cf.lock(id));
    const owners = new Map<string, string>(),
      projects = new Set<string>();
    for (const [source, locks] of [
      ['modrinth', modrinth],
      ['curseforge', curseforge],
    ] as const)
      for (const lock of locks) {
        const name = lock.file.toLowerCase(),
          owner = key(source, lock.projectId);
        if (owners.has(name) || projects.has(owner))
          throw new Error('模组安装记录冲突：' + lock.file);
        owners.set(name, owner);
        projects.add(owner);
      }
    const items: Artifact[] = [];
    const files = await this.files(id);
    const add = (item: Omit<Artifact, 'disabled'>) => {
      if (
        !jarName.safeParse(item.file).success ||
        !Number.isSafeInteger(item.size) ||
        item.size < 0 ||
        !(item.source === 'modrinth' ? /^[a-f0-9]{128}$/i : /^[a-f0-9]{40}$/i).test(item.digest)
      )
        throw new Error('模组文件或校验信息无效：' + item.file);
      const name = item.file.toLowerCase(),
        owner = key(item.source, item.projectId);
      if (owners.has(name) && owners.get(name) !== owner)
        throw new Error('存在其他来源的同名模组：' + item.file);
      const current = item.previousFile ? files.get(item.previousFile.toLowerCase()) : undefined;
      const disabled = !!item.previousFile && current?.[0] === item.previousFile + '.disabled';
      if (
        item.previousFile &&
        (!current || current.length !== 1 || (!disabled && current[0] !== item.previousFile))
      )
        throw new Error('本地模组缺失或有同名文件：' + item.previousFile);
      if (files.has(name) && item.file !== item.previousFile)
        throw new Error('存在同名模组：' + item.file);
      owners.set(name, owner);
      items.push({ ...item, disabled });
    };
    // Resolve the dependency graph once per real provider. Apply uses these exact artifacts.
    for (const v of await this.mods.resolve(
      id,
      modrinth.map((l) => ({ project: l.projectId })),
      ctx,
      modrinth,
      true,
    )) {
      const old = modrinth.find((l) => l.projectId === v.project_id);
      if (old?.versionId === v.id) continue;
      const f = v.files.find((f) => f.primary) ?? v.files[0];
      if (!f || !f.hashes?.sha512) throw new Error('模组缺少下载文件或校验信息：' + v.project_id);
      add({
        source: 'modrinth',
        projectId: v.project_id,
        previousFile: old?.file,
        previousVersion: old?.versionId,
        oldDigest: old?.sha512,
        file: f.filename,
        version: v.id,
        size: f.size,
        url: f.url,
        digest: f.hashes.sha512.toLowerCase(),
      });
    }
    for (const f of await this.cf.resolve(
      id,
      curseforge.map((l) => ({ project: l.projectId })),
      ctx,
      curseforge,
      undefined,
      true,
    )) {
      const old = curseforge.find((l) => l.projectId === f.modId);
      if (old?.fileId === f.id) continue;
      add({
        source: 'curseforge',
        projectId: String(f.modId),
        previousFile: old?.file,
        previousVersion: old && String(old.fileId),
        oldDigest: old?.sha1,
        file: f.fileName,
        version: String(f.id),
        size: f.fileLength,
        url: f.downloadUrl!,
        digest: f.hashes.find((h) => h.algo === 1)!.value.toLowerCase(),
      });
    }
    for (const item of items) {
      ctx.signal.throwIfAborted();
      this.net.url(item.url);
      if (item.previousFile) {
        const file = inside(
          this.mods.dir(id),
          item.previousFile + (item.disabled ? '.disabled' : ''),
        );
        if (
          !(await regular(file)) ||
          (await hashFile(file, item.source === 'modrinth' ? 'sha512' : 'sha1')) !==
            item.oldDigest?.toLowerCase()
        )
          throw new Error('本地模组已改变：' + item.previousFile);
      }
    }
    if ((await this.signature(id)) !== signature) throw new Error('实例已变更，请重新检查更新');
    const token = randomUUID();
    this.plans.set(id, { token, signature, items, modrinth, curseforge });
    return { token, items: items.map(({ url, digest, oldDigest, ...view }) => view) };
  }
  async apply(id: string, token: string, ctx: Work) {
    const plan = this.plans.get(id);
    if (!plan || plan.token !== token || !plan.items.length)
      throw new Error('更新预览已失效，请重新检查');
    this.plans.delete(id);
    if (plan.signature !== (await this.signature(id)))
      throw new Error('更新预览已失效，请重新检查');
    const tx = randomUUID(),
      stage = await this.history.stage(id, tx),
      dir = this.store.dir(id);
    try {
      const desired = new Map<string, string | null>();
      for (const [index, item] of plan.items.entries()) {
        const suffix = item.disabled ? '.disabled' : '',
          old = item.previousFile;
        const algorithm = item.source === 'modrinth' ? 'sha512' : 'sha1';
        if (old) {
          const before = inside(dir, 'mods/' + old + suffix);
          if (
            !(await regular(before)) ||
            (await hashFile(before, algorithm)) !== item.oldDigest!.toLowerCase()
          )
            throw new Error('本地模组已改变：' + old);
          desired.set('mods/' + old + suffix, null);
        }
        const target = 'mods/' + item.file + suffix;
        if (old !== item.file && (await regular(inside(dir, target))))
          throw new Error('目标名称已被使用：' + item.file);
        const download = path.join(stage, 'download-' + index);
        await this.net.download(item.url, download, {
          signal: ctx.signal,
          hash: item.digest,
          algorithm,
          size: item.size,
          onProgress: (p) =>
            ctx.progress((80 * (index + p)) / plan.items.length, '下载 ' + item.file),
        });
        desired.set(target, download);
      }
      for (const source of ['modrinth', 'curseforge'] as const) {
        const changes = plan.items.filter((item) => item.source === source);
        if (!changes.length) continue;
        const locks = [
          ...plan[source].filter((l) => !changes.some((c) => String(l.projectId) === c.projectId)),
          ...changes.map((c) =>
            source === 'modrinth'
              ? { projectId: c.projectId, versionId: c.version, file: c.file, sha512: c.digest }
              : {
                  projectId: Number(c.projectId),
                  fileId: Number(c.version),
                  file: c.file,
                  sha1: c.digest,
                },
          ),
        ];
        const temp = path.join(stage, lockNames[source]);
        await writeFile(temp, JSON.stringify(locks, null, 2));
        desired.set(lockNames[source], temp);
      }
      const changes = [];
      const inventory = await this.files(id);
      for (const item of plan.items) {
        const old = item.previousFile;
        if (old) {
          const names = inventory.get(old.toLowerCase());
          if (names?.length !== 1 || names[0] !== old + (item.disabled ? '.disabled' : ''))
            throw new Error('模组启用状态已改变：' + old);
        }
        if (item.file !== old && inventory.has(item.file.toLowerCase()))
          throw new Error('目标名称已被使用：' + item.file);
      }
      for (const [name, replacement] of desired) {
        ctx.signal.throwIfAborted();
        const index = changes.length,
          dest = inside(dir, name);
        const beforeFile = path.join(stage, 'before-' + index),
          afterFile = path.join(stage, 'after-' + index);
        const before = await fingerprint(dest);
        const original = plan.items.find(
          (item) =>
            item.previousFile &&
            name === 'mods/' + item.previousFile + (item.disabled ? '.disabled' : ''),
        );
        if (name.startsWith('mods/') && !!before !== !!original)
          throw new Error('本地文件已改变：' + name);
        if (before) {
          await copyFile(dest, beforeFile);
          if ((await fingerprint(beforeFile)) !== before)
            throw new Error('文件在操作期间被修改：' + name);
          if (
            original &&
            (await hashFile(beforeFile, original.source === 'modrinth' ? 'sha512' : 'sha1')) !==
              original.oldDigest!.toLowerCase()
          )
            throw new Error('本地模组已改变：' + name);
        }
        if (replacement) await rename(replacement, afterFile);
        changes.push({ name, before, after: replacement ? await fingerprint(afterFile) : null });
      }
      if ((await this.signature(id)) !== plan.signature)
        throw new Error('实例已变更，请重新检查更新');
      await this.history.save(id, tx, plan.items.length, changes);
      await this.history.commit(id, tx, false, ctx);
    } catch (error) {
      const pending = await this.history.pending(id);
      if (pending?.tx !== tx) await rm(stage, { recursive: true, force: true });
      throw error;
    }
  }
}
