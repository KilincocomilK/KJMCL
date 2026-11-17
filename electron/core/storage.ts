import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  realpathSync,
  lstatSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { mkdir, readdir, lstat, copyFile, rm, rmdir, statfs } from 'node:fs/promises';
import { z } from 'zod';
import { atomicJson, hashFile, inside, json, exists } from './files';
import { contains } from './instances';
import type { Store } from './store';
import type { Work } from './tasks';
import type { StorageInfo } from '../../shared/types';

const marker = '.kjmcl-data.json';
const directories = new Set([
  'instances',
  'libraries',
  'assets',
  'runtimes',
  'tools',
  'cache',
  'authlib',
  'credentials',
  'backups',
  'diagnostics',
  'video-backups',
  'appearance',
  'skin-editor',
  'seed-map',
  'projection-workshop',
]);
const ownedName = (name: string) =>
  directories.has(name) || /^state\.json(?:\.bak|\.v[1-6]\.bak)?$/.test(name);
const configSchema = z.object({
  version: z.literal(1),
  root: z.string().min(1),
  owner: z.uuid(),
  setupComplete: z.boolean(),
  portableHome: z.string().optional(),
});
type Config = z.infer<typeof configSchema>;
export interface StorageLayout {
  control: string;
  root: string;
  config: Config;
  mode: StorageInfo['mode'];
  fresh: boolean;
  rebaseFrom?: string;
}
interface Entry {
  file: string;
  size: number;
  hash: string;
}
interface Migration {
  version: 1;
  source: string;
  target: string;
  owner: string;
  entries: Entry[];
}
function syncJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
  renameSync(file + '.tmp', file);
}
export function canonicalDestination(directory: string) {
  if (!path.isAbsolute(directory) || path.parse(directory).root === path.resolve(directory))
    throw new Error('请选择完整的数据子目录，不能使用磁盘根目录');
  let ancestor = path.resolve(directory);
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (lstatSync(ancestor).isSymbolicLink()) throw new Error('数据目录不能是符号链接');
  return path.join(realpathSync.native(ancestor), path.relative(ancestor, path.resolve(directory)));
}
export function resolveStorage(
  profile: string,
  override?: string,
  portableDir?: string,
): StorageLayout {
  const control = canonicalDestination(
    override || (portableDir ? path.join(portableDir, 'KJMCL-data') : profile),
  );
  const file = path.join(control, 'storage-location.json');
  if (existsSync(file)) {
    const config = configSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    const rebaseFrom =
      portableDir &&
      !override &&
      config.portableHome &&
      config.root === config.portableHome &&
      config.portableHome !== control
        ? config.root
        : undefined;
    const root = canonicalDestination(rebaseFrom ? control : config.root);
    if (!existsSync(root))
      throw new Error('数据目录不可用，请连接原磁盘。原目录记录已保留：' + root);
    assertDataRoot(root, config.owner);
    return {
      control,
      root,
      config: {
        ...config,
        root,
        portableHome: portableDir && !override ? control : config.portableHome,
      },
      fresh: false,
      rebaseFrom,
      mode: override ? 'override' : portableDir ? 'portable' : 'installed',
    };
  }
  const legacy = existsSync(path.join(control, 'state.json'));
  const root = override || portableDir || legacy ? control : path.join(control, 'data');
  return {
    control,
    root,
    mode: override ? 'override' : portableDir ? 'portable' : 'installed',
    fresh: true,
    config: {
      version: 1,
      root,
      owner: randomUUID(),
      setupComplete: !!(override || portableDir || legacy),
      portableHome: portableDir && !override ? control : undefined,
    },
  };
}
export function prepareStorage(layout: StorageLayout) {
  mkdirSync(layout.root, { recursive: true });
  // Existing installations are adopted only at their known profile location.
  if (layout.fresh) {
    if (existsSync(path.join(layout.root, marker))) {
      const saved = JSON.parse(readFileSync(path.join(layout.root, marker), 'utf8'));
      if (saved.app !== 'KJMCL' || saved.version !== 1 || !z.uuid().safeParse(saved.owner).success)
        throw new Error('数据目录归属标记无效');
      layout.config.owner = saved.owner;
    }
    syncJson(path.join(layout.root, marker), {
      app: 'KJMCL',
      version: 1,
      owner: layout.config.owner,
    });
    syncJson(path.join(layout.control, 'storage-location.json'), layout.config);
  }
  assertDataRoot(layout.root, layout.config.owner);
  if (layout.rebaseFrom) {
    const state = path.join(layout.root, 'state.json');
    if (existsSync(state))
      syncJson(
        state,
        remapState(JSON.parse(readFileSync(state, 'utf8')), layout.rebaseFrom, layout.root),
      );
    syncJson(path.join(layout.control, 'storage-location.json'), layout.config);
  }
  const probe = path.join(layout.root, `.write-test-${randomUUID()}`);
  writeFileSync(probe, '');
  // Only the single file created above is removed.
  unlinkSync(probe);
}
export function assertDataRoot(root: string, owner: string) {
  const resolved = path.resolve(root);
  if (
    resolved === path.parse(resolved).root ||
    lstatSync(resolved).isSymbolicLink() ||
    realpathSync.native(resolved) !== resolved
  )
    throw new Error('数据目录已被替换或不是规范路径');
  const value = JSON.parse(readFileSync(path.join(resolved, marker), 'utf8'));
  if (value.app !== 'KJMCL' || value.version !== 1 || value.owner !== owner)
    throw new Error('数据目录归属校验失败');
}
async function walk(root: string, relative: string, output: { file: string; size: number }[]) {
  const file = inside(root, relative),
    s = await lstat(file);
  if (s.isSymbolicLink()) throw new Error('数据中存在符号链接，请先处理：' + relative);
  if (s.isDirectory())
    for (const name of await readdir(file)) await walk(root, relative + '/' + name, output);
  else if (s.isFile()) output.push({ file: relative, size: s.size });
  else throw new Error('无法处理特殊文件：' + relative);
  if (output.length > 300000) throw new Error('数据文件过多，请分实例迁移');
}
export async function inventory(root: string, includeSession = false) {
  const files: { file: string; size: number }[] = [];
  for (const name of await readdir(root))
    if (ownedName(name) || (includeSession && name === '.electron')) await walk(root, name, files);
  return files;
}
export function remapState(value: any, source: string, target: string) {
  const map = (p: string | undefined) =>
    p && path.isAbsolute(p) && contains(source, p)
      ? path.join(target, path.relative(source, p))
      : p;
  const next = structuredClone(value);
  next.settings.javaPath = map(next.settings.javaPath);
  next.settings.instancesDir = map(next.settings.instancesDir);
  for (const i of next.instances) {
    i.gameDir = map(i.gameDir || path.join(source, 'instances', i.id));
    i.javaPath = map(i.javaPath);
  }
  return next;
}
export class Storage {
  pendingRestart?: string;
  private journal: string;
  private savedMigration?: Migration;
  constructor(
    public layout: StorageLayout,
    private program: string,
  ) {
    this.journal = path.join(layout.control, 'storage-migration.json');
    if (existsSync(this.journal)) {
      const m = JSON.parse(readFileSync(this.journal, 'utf8')) as Migration;
      if (m.version !== 1 || m.owner !== layout.config.owner || !Array.isArray(m.entries))
        throw new Error('迁移记录格式无效');
      this.savedMigration = m;
      if (m.owner === layout.config.owner && m.source === layout.root && m.target !== layout.root)
        this.pendingRestart = m.target;
    }
  }
  async info(): Promise<StorageInfo> {
    const migration = await this.migration();
    return {
      mode: this.layout.mode,
      controlPath: this.layout.control,
      setupRequired: !this.layout.config.setupComplete,
      pendingRestart: this.pendingRestart,
      retired:
        migration && migration.target === this.layout.root
          ? {
              path: migration.source,
              files: migration.entries.length,
              bytes: migration.entries.reduce((n, f) => n + f.size, 0),
            }
          : undefined,
    };
  }
  completeSetup() {
    this.layout.config.setupComplete = true;
    syncJson(path.join(this.layout.control, 'storage-location.json'), this.layout.config);
  }
  async commitPending() {
    const m = await this.migration();
    if (!m || m.source !== this.layout.root || m.target !== this.pendingRestart)
      throw new Error('目录切换记录不匹配');
    assertDataRoot(m.target, m.owner);
    for (const f of m.entries)
      if (
        f.file !== 'state.json' &&
        (await hashFile(inside(m.target, f.file), 'sha256')) !== f.hash
      )
        throw new Error('目标文件已变化，未切换：' + f.file);
    const targetState = await json<any>(path.join(m.target, 'state.json'));
    if (
      ![1, 2, 3, 4, 5, 6, 7].includes(targetState.schemaVersion) ||
      !Array.isArray(targetState.instances)
    )
      throw new Error('目标状态无效');
    await atomicJson(path.join(this.layout.control, 'storage-location.json'), {
      ...this.layout.config,
      root: m.target,
      setupComplete: true,
    });
  }
  private async migration() {
    return this.savedMigration;
  }
  async migrate(store: Store, directory: string, ctx: Work) {
    if (this.pendingRestart || (await this.migration()))
      throw new Error('请先重启并清理上次迁移的原数据');
    const source = this.layout.root,
      target = canonicalDestination(directory);
    if (
      contains(source, target) ||
      contains(target, source) ||
      contains(target, this.layout.control) ||
      contains(this.program, target) ||
      contains(target, this.program)
    )
      throw new Error('目标不能与原数据或程序目录重叠');
    for (const i of store.data.instances)
      if (contains(store.dir(i.id), target) || contains(target, store.dir(i.id)))
        throw new Error('目标不能与游戏实例目录重叠');
    for (const folder of store.data.gameFolders)
      if (contains(folder.path, target) || contains(target, folder.path))
        throw new Error('目标不能与已索引的游戏文件夹重叠');
    if (existsSync(target) && readdirSync(target).length) throw new Error('请选择空的数据目录');
    assertDataRoot(source, this.layout.config.owner);
    store.save();
    const list = await inventory(source);
    const total = list.reduce((n, f) => n + f.size, 0);
    await mkdir(target, { recursive: true });
    const space = await statfs(target);
    if (space.bavail * space.bsize < total + 64 * 1024 ** 2)
      throw new Error('目标磁盘可用空间不足');
    syncJson(path.join(target, marker), {
      app: 'KJMCL',
      version: 1,
      owner: this.layout.config.owner,
    });
    const entries: Entry[] = [];
    let copied = 0,
      committed = false;
    try {
      for (const entry of list) {
        ctx.signal.throwIfAborted();
        const from = inside(source, entry.file),
          to = inside(target, entry.file);
        const hash = await hashFile(from, 'sha256');
        await mkdir(path.dirname(to), { recursive: true });
        await copyFile(from, to);
        if ((await hashFile(to, 'sha256')) !== hash || (await hashFile(from, 'sha256')) !== hash)
          throw new Error('复制校验失败或源文件正在变化：' + entry.file);
        entries.push({ ...entry, hash });
        copied += entry.size;
        ctx.progress(
          total ? (copied / total) * 85 : 85,
          `已校验 ${entries.length} / ${list.length} 个文件`,
        );
      }
      const after = await inventory(source);
      const expected = new Map(entries.map((e) => [e.file, e]));
      if (
        after.length !== entries.length ||
        after.some((f) => expected.get(f.file)?.size !== f.size)
      )
        throw new Error('原数据在迁移过程中发生变化');
      for (const f of entries) {
        ctx.signal.throwIfAborted();
        if ((await hashFile(inside(source, f.file), 'sha256')) !== f.hash)
          throw new Error('原文件在迁移期间变化：' + f.file);
      }
      await atomicJson(path.join(target, 'state.json'), remapState(store.data, source, target));
      ctx.signal.throwIfAborted();
      const migration: Migration = {
        version: 1,
        source,
        target,
        owner: this.layout.config.owner,
        entries,
      };
      await atomicJson(this.journal, migration);
      this.savedMigration = migration;
      await atomicJson(path.join(this.layout.control, 'storage-location.json'), {
        ...this.layout.config,
        root: target,
        setupComplete: true,
      });
      committed = true;
      this.pendingRestart = target;
      ctx.progress(100, '复制与校验完成，重启后切换；原数据保留');
    } finally {
      if (!committed) {
        assertDataRoot(target, this.layout.config.owner);
        await rm(target, { recursive: true, force: true });
        await rm(this.journal, { force: true });
        this.savedMigration = undefined;
      }
    }
  }
  async cleanup(ctx: Work) {
    const m = await this.migration();
    if (!m || m.target !== this.layout.root || m.source === m.target)
      throw new Error('请先从新数据目录重新启动');
    assertDataRoot(m.source, m.owner);
    assertDataRoot(m.target, m.owner);
    const files = await inventory(m.source);
    const expected = new Map(m.entries.map((e) => [e.file, e]));
    for (const f of files) {
      ctx.signal.throwIfAborted();
      if (
        !expected.has(f.file) ||
        (await hashFile(inside(m.source, f.file), 'sha256')) !== expected.get(f.file)!.hash
      )
        throw new Error('原文件已修改，未清理：' + f.file);
    }
    // Commit phase is non-cancellable. Delete only files recorded and verified above, never the profile/control directory.
    for (const [n, f] of files.entries()) {
      await rm(inside(m.source, f.file));
      ctx.progress(((n + 1) / files.length) * 100, '清理原数据');
    }
    for (const name of directories) await pruneEmpty(path.join(m.source, name));
    const oldSession = path.join(m.source, '.electron');
    if (await exists(oldSession)) {
      await walk(m.source, '.electron', []);
      await rm(oldSession, { recursive: true });
    }
    await rm(this.journal);
    this.savedMigration = undefined;
  }
  async uninstallRoots() {
    const m = await this.migration();
    const roots = [...new Set([this.layout.root, ...(m ? [m.source] : [])])];
    for (const root of roots)
      if (contains(this.program, root) || contains(root, this.program))
        throw new Error('数据位于程序目录内，请先迁移数据再卸载，避免被程序卸载流程移除');
    return roots;
  }
  async reviewUninstall(choose: (roots: string[]) => Promise<number>) {
    const response = await choose(await this.uninstallRoots());
    if (response === 2) return 2;
    if (response === 1) await this.removeForUninstall();
    return 0;
  }
  async removeForUninstall() {
    await removeManagedData(await this.uninstallRoots(), this.layout.config.owner, this.program);
    await rm(this.journal, { force: true });
    this.savedMigration = undefined;
    this.layout.config.setupComplete = false;
    await atomicJson(path.join(this.layout.control, 'storage-location.json'), this.layout.config);
  }
}
async function pruneEmpty(root: string) {
  if (!(await exists(root))) return;
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isDirectory() && !entry.isSymbolicLink())
      await pruneEmpty(path.join(root, entry.name));
  await rmdir(root).catch(() => {});
}
export async function removeManagedData(roots: string[], owner: string, program: string) {
  // Preflight all roots before any irreversible work. Do not follow directory links or traverse instance paths from state.json.
  const planned: { root: string; entries: string[] }[] = [];
  for (const root of roots) {
    assertDataRoot(root, owner);
    if (contains(program, root) || contains(root, program))
      throw new Error('数据目录与程序目录重叠，已拒绝清理');
    await inventory(root, true);
    planned.push({
      root,
      entries: (await readdir(root)).filter((n) => ownedName(n) || n === '.electron'),
    });
  }
  for (const { root, entries } of planned)
    for (const name of entries) {
      assertDataRoot(root, owner);
      const target = inside(root, name);
      if (!contains(root, target) || target === root) throw new Error('清理路径越界');
      await rm(target, { recursive: true, force: true });
    }
}
