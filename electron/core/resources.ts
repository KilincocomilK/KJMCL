import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, mkdir, readdir, copyFile, rm, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Store } from './store';
import { assertOwned } from './instances';
import { hashFile, inside } from './files';
import { zipMetadata, metadataJson, imageData, schematicPreview } from './resource-preview';
import type {
  ResourceKind,
  ResourceCandidate,
  ResourceFile,
  ResourceImportChoice,
  ResourceImportResult,
  ResourcePreview,
  Loader,
} from '../../shared/types';

export const resourceKinds: ResourceKind[] = [
  'mods',
  'shaderpacks',
  'resourcepacks',
  'replay_recordings',
  'schematics',
];
const extensions: Record<ResourceKind, RegExp> = {
  mods: /\.jar(?:\.disabled)?$/i,
  shaderpacks: /\.zip$/i,
  resourcepacks: /\.zip$/i,
  replay_recordings: /\.mcpr$/i,
  schematics: /\.(litematic|schematic|schem|nbt)$/i,
};
const safeName = (v: string) =>
  v.length <= 240 &&
  !/[\\/:*?"<>|\x00-\x1f]/.test(v) &&
  !/[. ]$/.test(v) &&
  !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(v) &&
  v !== '.' &&
  v !== '..';
async function publishFile(source: string, destination: string) {
  try {
    await link(source, destination);
  } catch (e: any) {
    if (!['EPERM', 'ENOTSUP', 'ENOSYS', 'EXDEV'].includes(e.code)) throw e;
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  }
}
type Ticket = { file: string; hash: string; expires: number; candidate: ResourceCandidate };
export class Resources {
  private tickets = new Map<string, Ticket>();
  constructor(private store: Store) {}
  async location(id: string, kind: ResourceKind, name = '', create = false) {
    await assertOwned(this.store, id);
    if (!resourceKinds.includes(kind)) throw new Error('未知资源类型');
    const root = this.store.dir(id),
      parts = [kind, ...name.split('/').filter(Boolean)];
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      if (!safeName(parts[i])) throw new Error('无效资源路径');
      current = inside(current, parts[i]);
      let info = await lstat(current).catch((e) => {
        if (e.code === 'ENOENT') return undefined;
        throw e;
      });
      if (!info && create && (i < parts.length - 1 || !name)) {
        await mkdir(current);
        info = await lstat(current);
      }
      if (info?.isSymbolicLink()) throw new Error('资源目录或文件不能是链接');
      if (info && i < parts.length - 1 && !info.isDirectory()) throw new Error('资源路径不是目录');
    }
    return current;
  }
  async inspect(paths: string[]): Promise<ResourceCandidate[]> {
    for (const [key, ticket] of this.tickets)
      if (ticket.expires < Date.now()) this.tickets.delete(key);
    const result: ResourceCandidate[] = [];
    for (const file of [...new Set(paths)].slice(0, 100)) {
      const c: ResourceCandidate = {
        token: randomUUID(),
        name: path.basename(file),
        size: 0,
        candidateIds: [],
        reason: '',
      };
      try {
        if (!path.isAbsolute(file) || !safeName(c.name)) throw new Error('请选择有效的本地文件');
        const info = await lstat(file);
        c.size = info.size;
        if (info.isSymbolicLink() || !info.isFile())
          throw new Error('仅支持文件，不支持文件夹或链接');
        if (info.size > 2 * 1024 ** 3) throw new Error('单个资源不能超过 2 GiB');
        let loaders: Loader[] = [],
          exactVersion: string | undefined;
        if (/\.(litematic|schematic|schem|nbt)$/i.test(file)) c.kind = 'schematics';
        else if (/\.(zip|jar|mcpr)$/i.test(file)) {
          const { names, data } = await zipMetadata(file);
          if (/\.mcpr$/i.test(file)) {
            if (!names.has('metaData.json') || !names.has('recording.tmcpr'))
              throw new Error('不是有效的 Replay 录像');
            c.kind = 'replay_recordings';
            exactVersion = metadataJson(data, 'metaData.json')?.mcversion;
          } else if (/\.jar$/i.test(file)) {
            c.kind = 'mods';
            const fabric = metadataJson(data, 'fabric.mod.json'),
              quilt = metadataJson(data, 'quilt.mod.json');
            if (fabric) {
              loaders.push('fabric', 'quilt');
              const range = fabric.depends?.minecraft;
              if (typeof range === 'string' && /^=?\d+\.\d+(\.\d+)?$/.test(range))
                exactVersion = range.replace(/^=/, '');
            }
            if (quilt) loaders.push('quilt');
            if (names.has('META-INF/neoforge.mods.toml')) loaders.push('neoforge');
            if (names.has('META-INF/mods.toml')) loaders.push('forge');
          } else if (names.has('pack.mcmeta')) c.kind = 'resourcepacks';
          else if ([...names].some((n) => n.startsWith('shaders/'))) c.kind = 'shaderpacks';
          else if (
            names.has('modrinth.index.json') ||
            names.has('manifest.json') ||
            names.has('kjmcl-pack.json')
          )
            throw new Error('整合包请使用“游戏实例 → 导入整合包”');
          else c.reason = '无法识别 ZIP 用途，请选择资源类型与实例';
        } else throw new Error('不支持此文件，支持 JAR、ZIP、MCPR 和原理图');
        const candidates = this.store.data.instances.filter(
          (i) =>
            (!loaders.length || loaders.includes(i.loader)) &&
            (!exactVersion || i.version === exactVersion),
        );
        c.candidateIds = candidates.map((i) => i.id);
        // A loader or exact version is evidence. Current selection alone is not a compatibility match.
        if (exactVersion && candidates.length === 1) c.suggestedInstanceId = candidates[0].id;
        c.reason ||= [
          loaders.length ? [...new Set(loaders)].join(' / ') : '',
          exactVersion ? 'Minecraft ' + exactVersion : '',
          c.suggestedInstanceId ? '已推荐实例，请确认' : '请选择实例；未验证完整依赖兼容性',
        ]
          .filter(Boolean)
          .join(' · ');
        const hash = await hashFile(file, 'sha256');
        this.tickets.set(c.token, { file, hash, expires: Date.now() + 30 * 60_000, candidate: c });
        while (this.tickets.size > 300) this.tickets.delete(this.tickets.keys().next().value!);
      } catch (e) {
        c.error = e instanceof Error ? e.message : String(e);
      }
      result.push(c);
    }
    return result;
  }
  async importOne(choice: ResourceImportChoice): Promise<ResourceImportResult> {
    const ticket = this.tickets.get(choice.token);
    if (!ticket || ticket.expires < Date.now()) throw new Error('导入已过期，请重新选择文件');
    const { file, candidate: c } = ticket;
    if (!extensions[choice.kind].test(c.name) || (c.kind && c.kind !== choice.kind))
      throw new Error('文件类型与目标目录不匹配');
    const source = await lstat(file);
    if (!source.isFile() || source.isSymbolicLink() || source.size !== c.size)
      throw new Error('源文件已改变，请重新拖入');
    const dir = await this.location(choice.id, choice.kind, '', true);
    const tmp = path.join(dir, '.kjmcl-import-' + randomUUID());
    try {
      await copyFile(file, tmp, constants.COPYFILE_EXCL);
      if ((await hashFile(tmp, 'sha256')) !== ticket.hash)
        throw new Error('源文件已改变，请重新拖入');
      const ext = path.extname(c.name),
        stem = c.name.slice(0, -ext.length);
      for (let n = 0; n < 1000; n++) {
        const name = n ? `${stem} (${n})${ext}` : c.name;
        if (!safeName(name)) throw new Error('文件名过长，请先缩短文件名');
        const dest = await this.location(choice.id, choice.kind, name);
        try {
          await publishFile(tmp, dest);
          this.tickets.delete(choice.token);
          return { name, status: 'added', detail: this.store.instance(choice.id).name };
        } catch (e: any) {
          if (e.code !== 'EEXIST') throw e;
          if (choice.conflict === 'skip')
            return { name, status: 'skipped', detail: '同名文件已存在' };
        }
      }
      throw new Error('同名副本过多');
    } finally {
      await rm(tmp, { force: true });
    }
  }
  async list(id: string): Promise<ResourceFile[]> {
    const result: ResourceFile[] = [];
    let visited = 0;
    for (const kind of resourceKinds) {
      const root = await this.location(id, kind);
      const walk = async (dir: string, prefix = '', depth = 0) => {
        if (depth > 8) return;
        for (const entry of await readdir(dir, { withFileTypes: true }).catch((e) => {
          if (e.code === 'ENOENT') return [];
          throw e;
        })) {
          if (++visited > 20_000) throw new Error('资源目录文件过多，请整理后重试');
          if (entry.isSymbolicLink() || !safeName(entry.name)) continue;
          const name = prefix + entry.name;
          if (entry.isDirectory()) {
            if (kind === 'schematics' || kind === 'replay_recordings')
              await walk(path.join(dir, entry.name), name + '/', depth + 1);
          } else if (entry.isFile() && extensions[kind].test(entry.name)) {
            const s = await lstat(await this.location(id, kind, name));
            result.push({ name, kind, size: s.size, modifiedAt: s.mtimeMs });
          }
        }
      };
      await walk(root);
    }
    return result.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }
  async file(id: string, kind: ResourceKind, name: string) {
    if (!extensions[kind].test(name)) throw new Error('不支持的资源文件');
    const file = await this.location(id, kind, name),
      info = await lstat(file);
    if (!info.isFile()) throw new Error('资源不是普通文件');
    return file;
  }
  async rename(id: string, kind: ResourceKind, name: string, newName: string) {
    if (
      !safeName(newName) ||
      !extensions[kind].test(newName) ||
      path.extname(name).toLowerCase() !== path.extname(newName).toLowerCase()
    )
      throw new Error('请保留原文件扩展名');
    const source = await this.file(id, kind, name);
    const target = await this.location(
      id,
      kind,
      path.posix.join(path.posix.dirname(name), newName),
    );
    if (source === target) return;
    await publishFile(source, target);
    await unlink(source);
  }
  async preview(id: string, kind: ResourceKind, name: string): Promise<ResourcePreview> {
    const file = await this.file(id, kind, name),
      info = await lstat(file);
    if (kind === 'schematics') {
      if (info.size > 32 * 1024 ** 2) throw new Error('原理图超过 32 MiB 预览限制');
      return schematicPreview(file);
    }
    const { data } = await zipMetadata(file),
      preview: ResourcePreview = { title: path.basename(name), details: [] };
    const detail = (label: string, value: unknown) => {
      if (value !== undefined) preview.details.push({ label, value: String(value).slice(0, 2000) });
    };
    preview.image = imageData(
      data.get('pack.png') ??
        data.get('thumb') ??
        data.get('thumb.jpg') ??
        data.get('thumbnail.png'),
    );
    if (kind === 'replay_recordings') {
      const m = metadataJson(data, 'metaData.json') ?? {};
      detail('游戏版本', m.mcversion);
      detail('服务器', m.serverName);
      detail(
        '录制时长',
        typeof m.duration === 'number' ? (m.duration / 1000).toFixed(1) + ' 秒' : undefined,
      );
      detail(
        '录制日期',
        typeof m.date === 'number' ? new Date(m.date).toLocaleString('zh-CN') : undefined,
      );
      detail('玩家数量', Array.isArray(m.players) ? m.players.length : undefined);
      preview.description = '在此实例的 Replay Viewer 中回放录像';
    } else if (kind === 'resourcepacks') {
      const p = metadataJson(data, 'pack.mcmeta')?.pack;
      detail('资源包格式', p?.pack_format);
      preview.description =
        typeof p?.description === 'string' ? p.description : JSON.stringify(p?.description);
    } else if (kind === 'mods') {
      const m =
        metadataJson(data, 'fabric.mod.json') ?? metadataJson(data, 'quilt.mod.json')?.quilt_loader;
      detail('模组 ID', m?.id);
      detail('版本', m?.version);
      preview.description = String(m?.description ?? '请在模组中心启用、禁用或更新模组');
    } else preview.description = '在游戏的光影设置中启用；效果取决于光影加载器与显卡';
    return preview;
  }
}
