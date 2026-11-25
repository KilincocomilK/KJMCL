import path from 'node:path';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { Store } from './store';
import { Minecraft } from './minecraft';
import { Network, pool } from './network';
import { inside } from './files';
import { fileProgress, progressRange, Tasks, type Work } from './tasks';
import { z } from 'zod';
import type { Loader } from '../../shared/types';
import type { CurseForge } from './curseforge';
const own = z.object({
  formatVersion: z.literal(1),
  name: z.string().min(1).max(80),
  version: z.string().regex(/^[\w.+-]+$/),
  loader: z.enum(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']),
  loaderVersion: z
    .string()
    .regex(/^[\w.+-]+$/)
    .optional(),
});
const mrpack = z.object({
  formatVersion: z.literal(1),
  game: z.literal('minecraft'),
  name: z.string().max(80),
  dependencies: z.record(z.string(), z.string()),
  files: z.array(
    z.object({
      path: z.string(),
      hashes: z.object({ sha1: z.string().regex(/^[a-f0-9]{40}$/) }),
      downloads: z.array(z.url()).min(1),
      fileSize: z.number().int().nonnegative(),
      env: z
        .object({ client: z.enum(['required', 'optional', 'unsupported']).optional() })
        .optional(),
    }),
  ),
});
export class Packs {
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
    }) => string,
    private cf?: CurseForge,
  ) {}
  import(file: string): Promise<string> {
    // Return the instance ID as soon as its manifest is accepted and its directory is locked.
    return new Promise((accept, reject) => {
      this.tasks
        .run('导入整合包', randomUUID(), (ctx) => this.importFile(file, ctx, accept))
        .catch(reject);
    });
  }
  private async importFile(file: string, ctx: Work, accept: (id: string) => void) {
    ctx.progress(0, '读取整合包');
    if ((await stat(file)).size > 2 * 1024 ** 3) throw new Error('整合包超过 2 GiB');
    const zip = new AdmZip(await readFile(file, { signal: ctx.signal }));
    const entries = zip.getEntries();
    let total = 0;
    for (const e of entries) {
      inside(this.store.root, e.entryName);
      total += e.header.size;
      if (total > 8 * 1024 ** 3 || ((e.attr >>> 16) & 0xf000) === 0xa000)
        throw new Error('整合包大小超限或含有符号链接');
    }
    const manifest = zip.getEntry('modrinth.index.json');
    const mr = manifest ? mrpack.parse(JSON.parse(manifest.getData().toString())) : undefined;
    const custom = zip.getEntry('kjmcl-instance.json');
    const cfEntry = zip.getEntry('manifest.json');
    const cf = cfEntry
      ? z
          .object({
            manifestType: z.literal('minecraftModpack'),
            manifestVersion: z.literal(1),
            name: z.string().max(80),
            minecraft: z.object({
              version: z.string(),
              modLoaders: z.array(z.object({ id: z.string(), primary: z.boolean() })),
            }),
            files: z.array(
              z.object({
                projectID: z.number().int().positive(),
                fileID: z.number().int().positive(),
                required: z.boolean(),
              }),
            ),
            overrides: z.string().default('overrides'),
          })
          .parse(JSON.parse(cfEntry.getData().toString()))
      : undefined;
    if (!mr && !custom && !cf) throw new Error('不支持的整合包格式');
    if (cf && !this.cf) throw new Error('CurseForge 未初始化');
    const cfLoader = cf?.minecraft.modLoaders.find((l) => l.primary)?.id;
    const loader: Loader = mr?.dependencies['fabric-loader']
      ? 'fabric'
      : mr?.dependencies['quilt-loader']
        ? 'quilt'
        : mr?.dependencies.neoforge
          ? 'neoforge'
          : mr?.dependencies.forge
            ? 'forge'
            : 'vanilla';
    const data = mr
      ? own.parse({
          formatVersion: 1,
          name: mr.name,
          version: mr.dependencies.minecraft,
          loader,
          loaderVersion:
            mr.dependencies['fabric-loader'] ??
            mr.dependencies['quilt-loader'] ??
            mr.dependencies.forge ??
            mr.dependencies.neoforge,
        })
      : cf
        ? own.parse({
            formatVersion: 1,
            name: cf.name,
            version: cf.minecraft.version,
            loader: cfLoader?.split('-')[0] ?? 'vanilla',
            loaderVersion: cfLoader?.slice(cfLoader.indexOf('-') + 1),
          })
        : own.parse(JSON.parse(custom!.getData().toString()));
    ctx.signal.throwIfAborted();
    const id = this.create(data);
    ctx.setTitle?.('导入 ' + data.name);
    await this.tasks.exclusive(id, async () => {
      accept(id);
      try {
        const required = cf?.files.filter((f) => f.required) ?? [];
        const downloads = mr?.files.filter((f) => f.env?.client !== 'unsupported') ?? [];
        const overrides = entries.flatMap((entry) => {
          const prefix =
            mr && entry.entryName.startsWith('client-overrides/')
              ? 'client-overrides/'
              : (cf?.overrides ?? 'overrides').replace(/\/$/, '') + '/';
          if (entry.isDirectory || !entry.entryName.startsWith(prefix)) return [];
          const relative = entry.entryName.slice(prefix.length);
          return /^(mods|resourcepacks|shaderpacks|config|saves)\//.test(relative) ||
            ['options.txt', 'servers.dat'].includes(relative)
            ? [{ entry, relative }]
            : [];
        });
        const filesEnd = overrides.length ? 85 : 99;
        const gameEnd = downloads.length || required.length ? 55 : filesEnd;
        await this.mc.install(id, progressRange(ctx, 2, gameEnd), 'installing');
        const root = this.store.dir(id);
        if (cf) {
          const pins = new Map(cf.files.map((f) => [f.projectID, f.fileID]));
          const step = (filesEnd - gameEnd) / Math.max(1, required.length);
          for (const [index, file] of required.entries()) {
            const part = progressRange(ctx, gameEnd + index * step, gameEnd + (index + 1) * step);
            await this.cf!.install(id, file.projectID, part, file.fileID, pins);
            part.progress(100, '导入整合包模组');
          }
        }
        if (downloads.length) {
          const report = fileProgress(
            ctx,
            downloads.map((file) => file.fileSize),
            gameEnd,
            filesEnd,
          );
          await pool(
            downloads,
            this.store.data.settings.concurrency,
            async (f, index) => {
              if (!/^(mods|resourcepacks|shaderpacks|config)\//.test(f.path))
                throw new Error('整合包包含不支持的文件位置');
              await this.net.download(f.downloads[0], inside(root, f.path), {
                signal: ctx.signal,
                hash: f.hashes.sha1,
                size: f.fileSize,
                onProgress: (fraction) => report(index, fraction, f.path),
              });
            },
            ctx.signal,
          );
        }
        const reportOverride = fileProgress(
          ctx,
          overrides.map(({ entry }) => entry.header.size),
          filesEnd,
          99,
        );
        for (const [index, { entry, relative }] of overrides.entries()) {
          ctx.signal.throwIfAborted();
          const target = inside(root, relative);
          await mkdir(path.dirname(target), { recursive: true });
          const contents = await new Promise<Buffer>((resolve, reject) => {
            entry.getDataAsync((data, error) =>
              error ? reject(new Error(String(error))) : resolve(data),
            );
          });
          ctx.signal.throwIfAborted();
          await writeFile(target, contents);
          reportOverride(index, 1, relative);
        }
        ctx.signal.throwIfAborted();
        this.store.instance(id).status = 'ready';
        this.store.save();
      } catch (e) {
        this.store.instance(id).status = 'error';
        this.store.instance(id).error = '整合包导入未完成，请重新导入';
        this.store.save();
        throw e;
      }
    });
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
    for (const folder of ['mods', 'resourcepacks', 'shaderpacks', 'config'])
      await add(path.join(root, folder), folder);
    await zip.writeZipPromise(file);
  }
}
