import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { mkdir, readFile, writeFile, readdir, stat, rename, rm } from 'node:fs/promises';
import { Store } from './store';
import { Minecraft, type Version } from './minecraft';
import { Network, pool } from './network';
import { inside, exists, hashFile, atomicJson } from './files';
import { checkGamePath } from './game-folders';
import { fileProgress, progressRange, Tasks, type Work } from './tasks';
import { z } from 'zod';
import type { Loader } from '../../shared/types';
import type { PackInstall, PackPreview, ConfirmPack } from '../../shared/pack';
import type { CurseForge, CFLock } from './curseforge';
import { loadPackFile, parsePack, readStoredPack, selectedDownloads } from './pack-manifest';

type Archive = ReturnType<typeof parsePack>;
type Ticket = { file: string; hash: string; owned: boolean; expires: number; confirming?: boolean };
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const proofSchema = z
  .array(
    z.object({
      projectId: z.number().int().positive(),
      fileId: z.number().int().positive(),
      file: z
        .string()
        .min(1)
        .max(240)
        .regex(/^[^\\/:*?"<>|]+\.jar$/i),
      sha1: z.string().regex(/^[a-f0-9]{40}$/),
    }),
  )
  .min(1)
  .max(101);
export class Packs {
  private tickets = new Map<string, Ticket>();
  constructor(
    private store: Store,
    private mc: Minecraft,
    private net: Network,
    private tasks: Tasks,
    private create: (v: {
      name: string;
      version: string;
      loader: Loader;
      loaderVersion?: string;
      packInstall?: PackInstall;
    }) => string,
    private cf?: CurseForge,
    private prepareTrial?: (sourceId: string, ctx: Work) => Promise<string[]>,
    private restoreTrial?: (
      sourceId: string,
      targetId: string,
      ids: string[],
      ctx: Work,
      bundledWorlds: string[],
    ) => Promise<void>,
  ) {}
  private archiveFile(hash: string) {
    return path.join(this.store.root, 'pack-archives', hash + '.zip');
  }
  async preview(file: string, temporarySource = false, signal?: AbortSignal): Promise<PackPreview> {
    const bytes = await loadPackFile(file, signal);
    const plan = parsePack(bytes);
    const token = randomUUID(),
      hash = digest(bytes);
    for (const [key, ticket] of this.tickets)
      if (!ticket.confirming && ticket.expires < Date.now()) await this.discard(key);
    if (this.tickets.size >= 12) {
      const previous = [...this.tickets].find(([, ticket]) => !ticket.confirming);
      if (!previous) throw new Error('正在确认其他整合包，请稍后重试');
      await this.discard(previous[0]);
    }
    if (temporarySource) {
      file = path.join(this.store.root, 'cache', 'pack-previews', token + '.zip');
      await checkGamePath(file, true);
      await mkdir(path.dirname(file), { recursive: true });
      try {
        await writeFile(file, bytes, { flag: 'wx', signal });
      } catch (e) {
        await rm(file, { force: true });
        throw e;
      }
    }
    this.tickets.set(token, {
      file,
      hash,
      owned: temporarySource,
      expires: Date.now() + 30 * 60_000,
    });
    return {
      token,
      name: plan.data.name,
      version: plan.data.version,
      loader: plan.data.loader,
      loaderVersion: plan.data.loaderVersion,
      format: plan.format,
      items: plan.items,
    };
  }
  async discard(token: string) {
    const ticket = this.tickets.get(token);
    this.tickets.delete(token);
    if (ticket?.owned) await rm(ticket.file, { force: true });
  }
  // Programmatic import retains the existing return semantics; production UI previews first.
  import(file: string) {
    return this.start(async (ctx) => {
      const preview = await this.preview(file, false, ctx.signal);
      return { token: preview.token, optional: [] };
    });
  }
  async confirm(value: ConfirmPack) {
    const ticket = this.tickets.get(value.token);
    if (!ticket || ticket.expires < Date.now()) throw new Error('预览已过期，请重新选择整合包');
    if (ticket.confirming) throw new Error('正在创建此整合包实例');
    ticket.confirming = true;
    try {
      return await this.start(async () => value);
    } finally {
      ticket.confirming = false;
    }
  }
  private start(input: (ctx: Work) => Promise<ConfirmPack>): Promise<string> {
    return new Promise((accept, reject) => {
      void this.tasks
        .run('导入整合包', randomUUID(), async (ctx) => {
          const value = await input(ctx);
          const ticket = this.tickets.get(value.token);
          if (!ticket || ticket.expires < Date.now())
            throw new Error('预览已过期，请重新选择整合包');
          const bytes = await loadPackFile(ticket.file, ctx.signal);
          if (digest(bytes) !== ticket.hash) throw new Error('整合包在预览后发生变化，请重新选择');
          const plan = parsePack(bytes);
          const blocked = plan.items.find((i) => i.kind === 'blocked');
          if (blocked) throw new Error('无法安装必需文件：' + blocked.label);
          const options = new Set(
            plan.items.filter((i) => i.kind === 'optional').map((i) => i.key),
          );
          if (value.optional.some((o) => !options.has(o)))
            throw new Error('所选文件不属于此整合包的可选项');
          if (plan.format === 'CurseForge' && !this.cf) throw new Error('CurseForge 未初始化');
          const archive = this.archiveFile(ticket.hash);
          await checkGamePath(archive, true);
          await mkdir(path.dirname(archive), { recursive: true });
          if (!(await exists(archive)) || (await hashFile(archive, 'sha256')) !== ticket.hash) {
            const tmp = archive + '.' + randomUUID() + '.part';
            try {
              await writeFile(tmp, bytes, { flag: 'wx', signal: ctx.signal });
              await rename(tmp, archive);
            } finally {
              await rm(tmp, { force: true });
            }
          }
          const record: PackInstall = {
            version: 1,
            archive: ticket.hash,
            optional: [...new Set(value.optional)],
            phase: 'game',
          };
          if (value.trialSourceId) {
            if (!this.prepareTrial || !this.restoreTrial) throw new Error('存档试更服务不可用');
            const source = value.trialSourceId;
            const backups = await this.tasks.exclusive(source, () =>
              this.prepareTrial!(source, ctx),
            );
            record.trial = { sourceId: source, backups };
          }
          ctx.signal.throwIfAborted();
          const { name, version, loader, loaderVersion } = plan.data;
          const id = this.create({ name, version, loader, loaderVersion, packInstall: record });
          this.tickets.delete(value.token);
          if (ticket.owned) await rm(ticket.file, { force: true }).catch(() => {});
          ctx.setTitle?.('导入 ' + plan.data.name);
          ctx.setScope?.(id);
          await this.tasks.exclusive(id, async () => {
            accept(id);
            await this.apply(id, plan, ctx);
          });
        })
        .catch(reject);
    });
  }
  async install(id: string, ctx: Work) {
    const instance = this.store.instance(id),
      record = instance.packInstall;
    if (!record || record.phase === 'complete') {
      if (instance.error?.includes('整合包导入未完成'))
        throw new Error('此旧版实例没有保存原清单，请从整合包重新导入');
      return this.mc.install(id, ctx);
    }
    let plan: Archive;
    try {
      plan = await readStoredPack(this.store.root, record.archive, ctx.signal);
    } catch (error) {
      instance.status = 'error';
      instance.error = error instanceof Error ? error.message : '无法读取整合包';
      this.store.save();
      throw error;
    }
    await this.apply(id, plan, ctx);
  }
  private progressDir(id: string, record: PackInstall) {
    return path.join(this.store.root, 'pack-progress', id, record.archive);
  }
  private async installBase(id: string, record: PackInstall, ctx: Work) {
    const i = this.store.instance(id);
    // Forge's generated libraries and processors must be restored by its installer.
    const cacheable = i.loader !== 'forge' && i.loader !== 'neoforge';
    const saved = path.join(this.progressDir(id, record), 'base.json');
    let profile: Version | undefined;
    if (cacheable && record.baseProfile && (await exists(saved))) {
      await checkGamePath(saved);
      const bytes = await readFile(saved);
      if (digest(bytes) === record.baseProfile) profile = JSON.parse(bytes.toString());
    }
    await this.mc.install(id, progressRange(ctx, 2, 48), 'installing', profile);
    if (cacheable && !profile) {
      const { version } = await this.mc.resolved(id);
      for (const lib of version.libraries) {
        for (const { artifact, dest, native } of this.mc.libraryFiles(
          { ...version, libraries: [lib] },
          id,
        )) {
          if (artifact.sha1) continue;
          await checkGamePath(dest);
          artifact.sha1 = await hashFile(dest);
          artifact.size = (await stat(dest)).size;
          if (!native) lib.downloads = { ...lib.downloads, artifact };
        }
      }
      await checkGamePath(saved, true);
      await atomicJson(saved, version);
      record.baseProfile = await hashFile(saved, 'sha256');
    }
    record.phase = 'files';
    this.store.save();
  }
  private async readProof(id: string, file: string, project: number, pin: number) {
    if (!(await exists(file))) return;
    await checkGamePath(file);
    const proof = proofSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (!proof.some((p) => p.projectId === project && p.fileId === pin)) return;
    const locks = await this.cf!.lock(id);
    for (const p of proof) {
      if (
        !locks.some(
          (l) =>
            l.projectId === p.projectId &&
            l.fileId === p.fileId &&
            l.file === p.file &&
            l.sha1 === p.sha1,
        )
      )
        return;
      const dest = inside(path.join(this.store.dir(id), 'mods'), p.file);
      await checkGamePath(dest, true);
      if (!(await exists(dest)) || (await hashFile(dest)) !== p.sha1) return;
    }
    return proof;
  }
  private async apply(id: string, plan: Archive, ctx: Work) {
    const i = this.store.instance(id),
      root = this.store.dir(id),
      record = i.packInstall!;
    i.status = 'installing';
    delete i.error;
    this.store.save();
    try {
      const selected = new Set(record.optional);
      await this.installBase(id, record, ctx);
      const files = selectedDownloads(plan, selected);
      const projects = plan.curseFiles.filter((f) => f.required || selected.has(f.key));
      const pins = new Map(plan.curseFiles.map((f) => [f.projectID, f.fileID]));
      if (projects.length && !this.cf) throw new Error('CurseForge 未初始化');
      for (const [index, f] of projects.entries()) {
        const proof = path.join(this.progressDir(id, record), String(f.projectID) + '.json');
        await checkGamePath(proof, true);
        const part = progressRange(
          ctx,
          48 + (34 * index) / projects.length,
          48 + (34 * (index + 1)) / projects.length,
        );
        ctx.signal.throwIfAborted();
        let verified = await this.readProof(id, proof, f.projectID, f.fileID);
        if (!verified) {
          let installed: CFLock[] = [];
          await this.cf!.install(id, f.projectID, part, f.fileID, pins, (locks) => {
            installed = locks;
          });
          if (!installed.some((p) => p.projectId === f.projectID && p.fileId === f.fileID))
            throw new Error('CurseForge 未确认所选文件：' + f.projectID);
          await atomicJson(proof, proofSchema.parse(installed));
          verified = await this.readProof(id, proof, f.projectID, f.fileID);
          if (!verified) throw new Error('CurseForge 文件校验失败：' + f.projectID);
        }
        for (const p of verified) pins.set(p.projectId, p.fileId);
      }
      const progress = fileProgress(
        ctx,
        files.map((f) => f.fileSize),
        48,
        82,
      );
      await pool(
        files,
        this.store.data.settings.concurrency,
        async (f, index) => {
          const dest = inside(root, f.path);
          await checkGamePath(dest, true);
          await this.net.download(f.downloads[0], dest, {
            signal: ctx.signal,
            hash: f.hashes.sha512 ?? f.hashes.sha1,
            algorithm: f.hashes.sha512 ? 'sha512' : 'sha1',
            size: f.fileSize,
            fallbackUrls: f.downloads.slice(1),
            onProgress: (part) => progress(index, part, f.path),
          });
          if (f.hashes.sha512 && (await hashFile(dest)) !== f.hashes.sha1)
            throw new Error('清单中的文件校验和不一致：' + f.path);
        },
        ctx.signal,
      );
      for (const [index, { entry, relative }] of plan.overrides.entries()) {
        ctx.signal.throwIfAborted();
        const target = inside(root, relative);
        await checkGamePath(target, true);
        const data = await new Promise<Buffer>((resolve, reject) =>
          entry.getDataAsync((b, e) => (e ? reject(new Error(String(e))) : resolve(b))),
        );
        if (data.length !== entry.header.size) throw new Error('覆盖文件大小不匹配：' + relative);
        if (!(await exists(target)) || (await hashFile(target, 'sha256')) !== digest(data)) {
          await mkdir(path.dirname(target), { recursive: true });
          const tmp = target + '.' + randomUUID() + '.part';
          try {
            await writeFile(tmp, data, { flag: 'wx', signal: ctx.signal });
            await rename(tmp, target);
          } finally {
            await rm(tmp, { force: true });
          }
        }
        ctx.progress(82 + (16 * (index + 1)) / plan.overrides.length, relative);
      }
      if (record.trial) {
        if (!this.restoreTrial) throw new Error('存档试更服务不可用');
        const trial = record.trial;
        const bundledWorlds = new Set<string>();
        for (const name of [
          ...files.map((f) => f.path),
          ...plan.overrides.map((o) => o.relative),
        ]) {
          const [folder, world, child] = name.split('/');
          if (folder.toLowerCase() === 'saves' && world && child) bundledWorlds.add(world);
        }
        await this.tasks.exclusive(trial.sourceId, () =>
          this.restoreTrial!(trial.sourceId, id, trial.backups, ctx, [...bundledWorlds]),
        );
      }
      ctx.signal.throwIfAborted();
      ctx.beginCommit?.();
      i.status = 'ready';
      record.phase = 'complete';
      this.store.save();
    } catch (error) {
      i.status = 'error';
      i.error =
        '整合包安装未完成，可继续安装：' + (error instanceof Error ? error.message : '安装失败');
      this.store.save();
      throw error;
    }
  }
  async export(id: string, file: string) {
    const i = this.store.instance(id),
      zip = new AdmZip(),
      root = this.store.dir(id);
    zip.addFile(
      'kjmcl-instance.json',
      Buffer.from(
        JSON.stringify(
          {
            formatVersion: 1,
            name: i.name,
            version: i.version,
            loader: i.loader,
            loaderVersion: i.loaderVersion,
          },
          null,
          2,
        ),
      ),
    );
    const add = async (dir: string, relative: string) => {
      for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (d.isSymbolicLink()) continue;
        const r = relative + '/' + d.name;
        if (d.isDirectory()) await add(path.join(dir, d.name), r);
        else zip.addLocalFile(path.join(dir, d.name), 'overrides/' + relative);
      }
    };
    for (const folder of [
      'mods',
      'resourcepacks',
      'shaderpacks',
      'config',
      'defaultconfigs',
      'kubejs',
      'scripts',
      'datapacks',
      'global_packs',
    ])
      await add(path.join(root, folder), folder);
    await zip.writeZipPromise(file);
  }
}
