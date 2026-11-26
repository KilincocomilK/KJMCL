import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Loader } from '../../shared/types';
import type { PackItem } from '../../shared/pack';
import { checkGamePath } from './game-folders';
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
      hashes: z.object({
        sha1: z.string().regex(/^[a-f0-9]{40}$/),
        sha512: z
          .string()
          .regex(/^[a-f0-9]{128}$/)
          .optional(),
      }),
      downloads: z.array(z.url()).min(1),
      fileSize: z.number().int().nonnegative(),
      env: z
        .object({ client: z.enum(['required', 'optional', 'unsupported']).optional() })
        .optional(),
    }),
  ),
});

function protectedFile(name: string) {
  const parts = name.toLowerCase().split('/');
  const root = parts[0],
    leaf = parts.at(-1)!;
  if (parts.some((p) => p.startsWith('.') || p.startsWith('kjmcl-'))) return true;
  if (
    /^(assets|libraries|natives|versions|runtime|runtimes|java|cache|caches|logs|crash-reports|backups|pack-archives|pack-progress|pcl|hmcl)$/.test(
      root,
    )
  )
    return true;
  if (
    /^(client\.jar|version\.json|state\.json(?:\..*)?|.*-lock\.json|.*\.lock|launcher_.*|accounts?\.json|authlib-injector.*|usercache\.json|user_properties\.json|realms_persistence\.json)$/.test(
      leaf,
    )
  )
    return true;
  if (
    /\.(?:exe|com|msi|scr|cmd|bat|ps1|psm1|psd1|vbs|vbe|wsf|wsh|hta|lnk|url|sh|command|app|so|dll|dylib|desktop)$/i.test(
      leaf,
    )
  )
    return true;
  return /\.jar$/i.test(leaf) && root !== 'mods';
}
function pathKey(name: string) {
  const parts = name.replace(/\/$/, '').split('/');
  if (
    !name ||
    name.length > 1000 ||
    parts.some(
      (p) =>
        !p ||
        p === '.' ||
        p === '..' ||
        /[\\:*?"<>|\x00-\x1f]/.test(p) ||
        /[. ]$/.test(p) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
    )
  )
    throw new Error('整合包路径无效：' + name);
  return parts.join('/').normalize('NFC').toLowerCase();
}

export function isPackContentRoot(name: string) {
  const key = pathKey(name);
  return !key.includes('/') && !protectedFile(name);
}

export async function loadPackFile(file: string, signal?: AbortSignal) {
  const info = await stat(file);
  if (!info.isFile() || info.size > 2 * 1024 ** 3)
    throw new Error('整合包不是常规文件或超过 2 GiB');
  return readFile(file, { signal });
}

export async function readStoredPack(root: string, hash: string, signal?: AbortSignal) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('保存的整合包标识无效');
  const file = path.join(root, 'pack-archives', hash + '.zip');
  await checkGamePath(file, true);
  const bytes = await loadPackFile(file, signal).catch((err) => {
    if (err.code === 'ENOENT') throw new Error('找不到保存的整合包，请重新导入');
    throw err;
  });
  if (createHash('sha256').update(bytes).digest('hex') !== hash)
    throw new Error('保存的整合包校验失败，请重新导入');
  return parsePack(bytes);
}

export function selectedDownloads(plan: ReturnType<typeof parsePack>, selected: Set<string>) {
  return plan.downloads.filter(
    (f) => f.kind === 'required' || (f.kind === 'optional' && selected.has(f.key)),
  );
}

export function parsePack(bytes: Buffer) {
  const zip = new AdmZip(bytes);
  const entries = zip.getEntries();
  const names = new Set<string>();
  let total = 0;
  if (entries.length > 20000) throw new Error('整合包条目超过 20000 个');
  for (const entry of entries) {
    const key = pathKey(entry.entryName);
    if (names.has(key)) throw new Error('整合包含有重复路径：' + entry.entryName);
    names.add(key);
    total += entry.header.size;
    if (
      total > 8 * 1024 ** 3 ||
      entry.header.size > 512 * 1024 ** 2 ||
      ((entry.attr >>> 16) & 0xf000) === 0xa000
    )
      throw new Error('整合包大小超限或含有符号链接');
  }
  for (const file of ['manifest.json', 'modrinth.index.json', 'kjmcl-instance.json'])
    if ((zip.getEntry(file)?.header.size ?? 0) > 16 * 1024 ** 2) throw new Error('整合包清单过大');
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
  if ([mr, custom, cf].filter(Boolean).length !== 1)
    throw new Error('缺少清单或检测到多个整合包清单');

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

  const format = mr ? ('Modrinth' as const) : cf ? ('CurseForge' as const) : ('KJMCL' as const);
  const items: PackItem[] = [];
  if (mr) {
    const loaders = Object.keys(mr.dependencies).filter((k) => k !== 'minecraft');
    for (const k of loaders)
      if (!['forge', 'neoforge', 'fabric-loader', 'quilt-loader'].includes(k) || loaders.length > 1)
        items.push({
          key: 'dependency:' + k,
          label: k,
          kind: 'blocked',
          reason: '无法确定所需加载器组合',
        });
  }
  if (
    cf?.minecraft.modLoaders.length &&
    cf.minecraft.modLoaders.filter((l) => l.primary).length !== 1
  )
    items.push({
      key: 'dependency:loader',
      label: 'Minecraft 加载器',
      kind: 'blocked',
      reason: '清单缺少唯一的主加载器',
    });
  const layers = new Map<string, { relative: string; entry: AdmZip.IZipEntry; layer: number }>();
  const prefix = (cf?.overrides ?? 'overrides').replace(/\/$/, '') + '/';
  pathKey(prefix);
  for (const entry of entries) {
    if (
      entry.isDirectory ||
      ['manifest.json', 'modrinth.index.json', 'kjmcl-instance.json'].includes(entry.entryName)
    )
      continue;
    const specific = mr && entry.entryName.startsWith('client-overrides/');
    const base = specific ? 'client-overrides/' : prefix;
    const relative = entry.entryName.slice(base.length);
    if (!entry.entryName.startsWith(base)) {
      items.push({
        key: 'zip:' + entry.entryName,
        label: entry.entryName,
        kind: 'skipped',
        reason: entry.entryName.startsWith('server-overrides/') ? '仅服务端' : '清单覆盖目录之外',
      });
      continue;
    }
    if (protectedFile(relative)) {
      items.push({
        key: 'zip:' + entry.entryName,
        label: relative,
        kind: 'blocked',
        reason: '受保护的路径或系统可执行文件',
      });
      continue;
    }
    const key = pathKey(relative),
      layer = specific ? 1 : 0;
    const previous = layers.get(key);
    if (previous && previous.relative !== relative)
      throw new Error('覆盖路径大小写不一致：' + relative);
    if (previous)
      items.push({
        key: 'shadow:' + key,
        label: relative,
        kind: 'skipped',
        reason: '客户端覆盖优先',
      });
    if (!previous || layer > previous.layer) layers.set(key, { relative, entry, layer });
  }
  const paths = new Set<string>();
  const downloads = (mr?.files ?? []).map((f) => {
    if (f.path.endsWith('/')) throw new Error('清单文件名为空');
    const path = pathKey(f.path),
      key = 'mr:' + path;
    if (paths.has(path)) throw new Error('清单含重复下载路径：' + f.path);
    paths.add(path);
    const env = f.env?.client ?? 'required';
    const unsupported =
      protectedFile(f.path) ||
      f.downloads.some((url) => {
        const u = new URL(url);
        return u.protocol !== 'https:' || !!u.username || !!u.password;
      });
    if (layers.has(path) && f.path !== layers.get(path)!.relative)
      throw new Error('覆盖路径大小写不一致：' + f.path);
    const kind =
      env === 'unsupported' || layers.has(path)
        ? 'skipped'
        : unsupported
          ? env === 'required'
            ? 'blocked'
            : 'skipped'
          : env;
    const reason =
      env === 'unsupported'
        ? '仅服务端'
        : layers.has(path)
          ? '由包内覆盖文件提供'
          : unsupported
            ? '未支持的路径或下载地址'
            : undefined;
    items.push({ key, label: f.path, kind, reason });
    return { ...f, key, kind };
  });
  const projects = new Set<number>();
  const curseFiles = (cf?.files ?? []).map((f) => {
    if (projects.has(f.projectID)) throw new Error('清单含重复 CurseForge 项目');
    projects.add(f.projectID);
    const key = 'cf:' + f.projectID;
    items.push({
      key,
      label: 'CurseForge ' + f.projectID + ' · 文件 ' + f.fileID,
      kind: f.required ? 'required' : 'optional',
    });
    return { ...f, key };
  });
  for (const [key, layer] of layers)
    items.push({
      key: 'override:' + key,
      label: layer.relative,
      kind: 'required',
      reason: layer.layer ? '客户端覆盖' : '包内覆盖',
    });
  if (items.length > 40000) throw new Error('整合包清单过大');
  const targets = new Set([
    ...layers.keys(),
    ...downloads
      .filter((f) => f.kind === 'required' || f.kind === 'optional')
      .map((f) => pathKey(f.path)),
  ]);
  for (const target of targets) {
    let ancestor = target.lastIndexOf('/');
    while (ancestor !== -1) {
      if (targets.has(target.slice(0, ancestor))) throw new Error('包内文件与目录重名：' + target);
      ancestor = target.lastIndexOf('/', ancestor - 1);
    }
  }
  return { data, items, format, downloads, curseFiles, overrides: [...layers.values()] };
}
