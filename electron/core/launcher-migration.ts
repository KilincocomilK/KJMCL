import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import type { Api } from '../../shared/types';
import type { Store } from './store';
import { GameFolders, checkGamePath } from './game-folders';
import { contains } from './instances';
import { configObject, record } from './launcher-profiles';
import { progressRange, type Work } from './tasks';

type Import = Parameters<Api['importMinecraft']>[0];
interface Candidate {
  id: string;
  root: string;
  launchers: string[];
}

const pathKey = (file: string) => (process.platform === 'win32' ? file.toLowerCase() : file);
const fingerprint = (file: string) =>
  createHash('sha256').update(pathKey(file)).digest('hex').slice(0, 16);
const localPath = (value: unknown): value is string =>
  typeof value === 'string' &&
  !!value.trim() &&
  value.length < 4096 &&
  !value.includes('\0') &&
  !/^(?:\\\\|\/\/|[a-z]+:\/\/)/i.test(value);

async function names(folder: string, limit: number) {
  const out = [];
  const dir = await opendir(folder);
  for await (const item of dir) {
    out.push(item);
    if (out.length === limit) break;
  }
  return out;
}

async function pclRegistryFolders() {
  if (process.platform !== 'win32' || !process.env.SystemRoot) return [];
  // Fixed read-only registry query, including Unicode paths on non-English Windows.
  const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const command =
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); foreach($k in 'HKCU:\\Software\\PCL','HKCU:\\Software\\PCL2'){ Get-ItemPropertyValue -LiteralPath $k -Name LaunchFolders -ErrorAction SilentlyContinue }; exit 0";
  const result = await promisify(execFile)(
    shell,
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { windowsHide: true, timeout: 3500, maxBuffer: 256 * 1024 },
  ).catch(() => ({ stdout: '' }));
  return result.stdout
    .split(/[\r\n|]+/)
    .map((row) => row.slice(row.indexOf('>') + 1).trim())
    .filter((value) => localPath(value) && path.isAbsolute(value));
}

async function isDirectory(dir: string) {
  return (await lstat(dir).catch(() => undefined))?.isDirectory() === true;
}

const runFiles =
  /^(?:saves|mods|config|defaultconfigs|resourcepacks|texturepacks|shaderpacks|screenshots|backups|schematics|litematics|journeymap|xaeroworldmap|xaerominimap|xaerowaypoints|xaero|kubejs|scripts|patchouli_books|global_packs|datapacks|resourcepackoverrides|openloader|config-overrides|replay_recordings|essential_mod|options(?:[a-z0-9_-]+)?\.txt|servers\.dat(?:_old)?|hotbar\.nbt|command_history\.txt|realms_persistence\.json)$/i;
const runtimeFiles = /^(?:versions|assets|libraries|resources)$/i;

/** Copy only game payloads. Launcher accounts, commands and JVM options never enter the copy. */
async function copyGame(source: string, dest: string, ctx: Work, includeRuntime: boolean) {
  const groups = (await readdir(source)).filter(
    (name) => runFiles.test(name) || (includeRuntime && runtimeFiles.test(name)),
  );
  let files = 0,
    bytes = 0,
    groupPercent = 0,
    lastReport = 0;
  const amount = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
  async function walk(input: string, output: string, depth: number, versions: boolean) {
    ctx.signal.throwIfAborted();
    const info = await lstat(input);
    if (info.isSymbolicLink())
      throw new Error('游戏内容包含链接，请改用原目录或先移除链接：' + path.basename(input));
    if (info.isDirectory()) {
      await mkdir(output);
      for (const entry of await readdir(input, { withFileTypes: true })) {
        if (entry.name === 'session.lock') continue;
        if (versions && depth === 0 && entry.isFile()) continue;
        // A version directory may itself be a complete game directory. Its launcher metadata
        // is replaced below with an allow-listed profile that points exclusively into the copy.
        if (
          versions &&
          depth === 1 &&
          !runFiles.test(entry.name) &&
          !(
            entry.name === path.basename(input) + '.json' ||
            entry.name === path.basename(input) + '.jar'
          )
        )
          continue;
        await walk(
          path.join(input, entry.name),
          path.join(output, entry.name),
          depth + 1,
          versions,
        );
      }
    } else if (info.isFile()) {
      await copyFile(input, output, constants.COPYFILE_EXCL);
      const after = await lstat(input);
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ino !== info.ino)
        throw new Error('源文件正在变化，请关闭游戏后重试：' + path.basename(input));
      bytes += info.size;
      files++;
      if (performance.now() - lastReport >= 500) {
        lastReport = performance.now();
        ctx.progress(
          groupPercent,
          '已复制 ' + files + ' 个文件 · ' + amount.format(bytes / 1024 ** 2) + ' MiB',
        );
      }
    } else throw new Error('不支持的游戏文件：' + path.basename(input));
  }
  for (const [i, name] of groups.entries()) {
    groupPercent = (100 * i) / groups.length;
    ctx.progress(groupPercent, '复制 ' + name);
    await checkGamePath(source);
    await checkGamePath(dest);
    await walk(
      path.join(source, name),
      path.join(dest, name),
      0,
      name.toLowerCase() === 'versions',
    );
  }
}

export class LauncherMigration {
  private candidates = new Map<string, Candidate>();
  private copying = new Set<string>();
  constructor(
    private store: Store,
    private folders: GameFolders,
  ) {}

  private async locate(bases: string[], registered: string[] = []) {
    const results = new Map<string, Set<string>>();
    const add = async (location: string, labels: string[]) => {
      if (!localPath(location)) return;
      if (!(await isDirectory(path.join(location, 'versions')))) {
        if (!/^\.?minecraft$/i.test(path.basename(location)) || !(await isDirectory(location)))
          return;
        const items = await readdir(location, { withFileTypes: true });
        if (
          !items.some(
            (e) =>
              (e.isDirectory() && /^(?:saves|mods|resourcepacks|shaderpacks)$/i.test(e.name)) ||
              (e.isFile() && /^(?:options\.txt|servers\.dat)$/i.test(e.name)),
          )
        )
          return;
      }
      await checkGamePath(location);
      const root = await realpath(location);
      if (contains(this.store.root, root) || contains(root, this.store.root)) return;
      let labelsForRoot = results.get(root);
      if (!labelsForRoot) {
        labelsForRoot = new Set();
        results.set(root, labelsForRoot);
        const entries = await names(root, 512);
        if (entries.some((e) => /^launcher_(profiles|accounts).*\.json$/i.test(e.name)))
          labelsForRoot.add('官方启动器');
        if (entries.some((e) => /^\.hmcl$|^hmclversion\.cfg$/i.test(e.name)))
          labelsForRoot.add('HMCL');
        if (entries.some((e) => /^PCL$/i.test(e.name))) labelsForRoot.add('PCL2');
      }
      for (const label of labels) labelsForRoot.add(label);
    };
    for (const dir of registered.slice(0, 128)) await add(dir, ['PCL2']).catch(() => {});
    for (const base of new Set(bases.map((b) => path.resolve(b)))) {
      try {
        if (!(await isDirectory(base))) continue;
        await checkGamePath(base);
        const children = await names(base, 512);
        const labels: string[] = [];
        if (children.some((e) => /^(?:\.hmcl|hmcl\.json|hmcl.*\.(?:exe|jar))$/i.test(e.name)))
          labels.push('HMCL');
        if (children.some((e) => /^(?:pcl|pcl2.*\.exe|plain craft launcher.*\.exe)$/i.test(e.name)))
          labels.push('PCL2');
        for (const file of [base, path.join(base, '.minecraft')]) await add(file, labels);
        // HMCL 3.x stores legacy profiles beside the launcher. Current releases have separate
        // local and user directory lists. Inspect only the path fields, never account records.
        for (const file of [
          'hmcl.json',
          '.hmcl/hmcl.json',
          '.hmcl/config/game-directories.json',
          'config/game-directories.json',
          'config/user-game-directories.json',
        ]) {
          const data = await configObject(path.join(base, file));
          const profiles = Array.isArray(data.profiles)
            ? data.profiles
            : Object.values(record(data.profiles));
          const paths = profiles.map((p) => record(p).gameDir);
          for (const configuration of Object.values(record(data.configurations))) {
            const p = record(configuration);
            paths.push(p.gameDir ?? p.path);
          }
          if (Array.isArray(data.directories))
            paths.push(...data.directories.map((p) => record(p).path));
          for (const p of paths.slice(0, 128))
            if (localPath(p)) await add(path.resolve(base, p), ['HMCL']);
        }
      } catch {
        /* Offline disks and unreadable launcher directories do not block other results. */
      }
    }
    return Array.from(results, ([root, labels]) => {
      const key = pathKey(root);
      const previous = this.candidates.get(key);
      const result = {
        id: previous?.id ?? randomUUID(),
        root,
        launchers: labels.size ? [...labels] : ['独立目录'],
      };
      if (!previous && this.candidates.size >= 512)
        this.candidates.delete(this.candidates.keys().next().value!);
      this.candidates.set(key, result);
      return result;
    });
  }

  async discover() {
    const home = os.homedir();
    const support = path.join(home, 'Library', 'Application Support');
    const roam = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    const bases = [
      path.join(home, '.minecraft'),
      path.join(home, '.hmcl'),
      path.dirname(process.execPath),
    ];
    if (process.platform === 'win32')
      bases.push(path.join(roam, '.minecraft'), path.join(roam, '.hmcl'), path.join(roam, 'hmcl'));
    if (process.platform === 'darwin')
      bases.push(path.join(support, 'minecraft'), path.join(support, 'hmcl'));
    if (process.platform === 'linux')
      bases.push(
        path.join(process.env.XDG_DATA_HOME || path.join(home, '.local/share'), 'hmcl'),
        path.join(home, '.var/app/com.mojang.Minecraft/data/minecraft'),
        path.join(home, 'snap/minecraft-launcher/common/.minecraft'),
      );
    for (const key of ['HMCL_USER_HOME', 'HMCL_LOCAL_HOME', 'MINECRAFT_HOME']) {
      const dir = process.env[key];
      if (dir && localPath(dir) && path.isAbsolute(dir)) bases.push(dir);
    }
    for (const parent of [
      home,
      ...['Desktop', 'Downloads', 'Documents', 'Games', '游戏'].map((d) => path.join(home, d)),
    ]) {
      bases.push(parent);
      const children = await names(parent, 256).catch(() => []);
      for (const d of children)
        if (d.isDirectory() && /minecraft|hmcl|pcl|我的世界|启动器/i.test(d.name))
          bases.push(path.join(parent, d.name));
    }
    return this.locate(bases, await pclRegistryFolders());
  }
  async inspect(directory: string) {
    await checkGamePath(directory);
    // Also inspect siblings of a directly selected .minecraft to identify portable launchers.
    const bases = [directory];
    if (path.basename(directory).toLowerCase() === '.minecraft')
      bases.push(path.dirname(directory));
    const results = await this.locate(bases);
    if (!results.length) throw new Error('未找到游戏版本目录，请选择 .minecraft 或启动器所在目录');
    return results;
  }
  async preview(id: string) {
    const candidate = [...this.candidates.values()].find((c) => c.id === id);
    if (!candidate) throw new Error('目录列表已过期，请重新检测');
    await checkGamePath(candidate.root);
    return this.folders.scan(candidate.root, true);
  }

  async copy(value: Import, destinationParent: string, ctx: Work) {
    const { root, entries } = await this.folders.confirmed(value, progressRange(ctx, 0, 4));
    if (entries.some((e) => e.directoryError))
      throw new Error('部分版本的运行目录无法确定，请先选择隔离方式');
    await checkGamePath(destinationParent);
    const parent = await realpath(destinationParent);
    const target = path.join(parent, 'KJMCL-' + fingerprint(root));
    const sources = new Set([root, ...entries.map((e) => e.gameDir)]);
    for (const source of sources)
      if (contains(source, target) || contains(target, source))
        throw new Error('副本与原游戏目录不能重叠');
    if (this.store.data.gameFolders.some((f) => !path.relative(target, f.path)))
      throw new Error('此位置已登记过副本。要复制最新数据，请选择另一个位置');
    for (const protectedPath of [
      this.store.root,
      ...this.store.data.gameFolders.map((f) => f.path),
      ...this.store.data.instances.map((i) => this.store.dir(i.id)),
    ])
      if (contains(protectedPath, target) || contains(target, protectedPath))
        throw new Error('目标与现有游戏或启动器目录重叠');
    if (this.copying.has(pathKey(target))) throw new Error('此目录正在迁移');
    this.copying.add(pathKey(target));
    let staged: string | undefined;
    let identity: Awaited<ReturnType<typeof lstat>> | undefined;
    try {
      const checkVacant = async () => {
        try {
          await lstat(target);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw e;
        }
        throw new Error('目标已有同名副本，请选择其他位置或直接导入该目录');
      };
      await checkVacant();
      staged = await mkdtemp(path.join(parent, '.kjmcl-import-'));
      identity = await lstat(staged);
      await copyGame(root, staged, progressRange(ctx, 4, 76), true);
      const relocated = new Map<string, string>([[root, '.']]);
      const profiles: Record<string, unknown> = Object.create(null);
      for (const [index, entry] of entries.entries()) {
        ctx.signal.throwIfAborted();
        let dir = relocated.get(entry.gameDir);
        if (!dir) {
          // Shared and version-local trees were copied above. Custom runtime folders, including
          // paths outside .minecraft, get independent relative locations inside the new copy.
          const relative = path.relative(root, entry.gameDir);
          const segments = relative.split(path.sep);
          if (segments.length === 2 && segments[0] === 'versions') dir = relative;
          else {
            dir = path.join('game-directories', fingerprint(entry.gameDir));
            const local = path.join(staged, dir);
            await mkdir(local, { recursive: true });
            await checkGamePath(entry.gameDir);
            await copyGame(entry.gameDir, local, progressRange(ctx, 76, 89), false);
          }
          relocated.set(entry.gameDir, dir);
        }
        const settings = entry.settings;
        profiles[entry.id] = {
          name: entry.name,
          lastVersionId: entry.id,
          gameDir: dir,
          resolution: { width: settings?.width, height: settings?.height },
          javaArgs: settings?.memoryMb ? '-Xmx' + settings.memoryMb + 'M' : undefined,
        };
        ctx.progress(89 + (4 * index) / entries.length, entry.name);
      }
      await writeFile(path.join(staged, 'launcher_profiles.json'), JSON.stringify({ profiles }), {
        flag: 'wx',
      });
      await checkGamePath(parent);
      await checkVacant();
      ctx.signal.throwIfAborted();
      await rename(staged, target);
      staged = target;
      const preview = await this.folders.scan(target, true);
      const originals = new Map(entries.map((e) => [e.id, e]));
      if (
        preview.versions.length !== entries.length ||
        preview.versions.some(
          (e) =>
            !originals.has(e.id) ||
            (e.error && !originals.get(e.id)?.error) ||
            !contains(target, e.gameDir),
        )
      )
        throw new Error('副本校验失败，请检查源目录后重试');
      const id = await this.folders.add(
        { ...value, selectionId: preview.selectionId },
        progressRange(ctx, 93, 100),
      );
      staged = undefined;
      return id;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOSPC' || code === 'EDQUOT')
        throw new Error('目标磁盘空间不足，请释放空间或选择其他磁盘后重试');
      if (code === 'EFBIG') throw new Error('文件超过目标磁盘支持的大小，请选择其他磁盘');
      throw error;
    } finally {
      this.copying.delete(pathKey(target));
      if (staged && identity) {
        // Only clean up the exact new directory this operation created.
        await checkGamePath(parent);
        const now = await lstat(staged).catch(() => undefined);
        if (now?.isDirectory() && now.dev === identity.dev && now.ino === identity.ino)
          await rm(staged, { recursive: true, force: true });
      }
    }
  }
}
