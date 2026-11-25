import path from 'node:path';
import os from 'node:os';
import { readdir, mkdir, chmod, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exists, extractZip } from './files';
import { Store } from './store';
import { Network } from './network';
import type { JavaRuntime } from '../../shared/types';
import type { Work } from './tasks';
const exec = promisify(execFile);
const inspections = new Map<string, { until: number; value: Promise<JavaRuntime> }>();
export function javaEnvironment() {
  const env = { ...process.env };
  for (const key of ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS']) delete env[key];
  return env;
}
export function javaArch(arch: string) {
  return /^(amd64|x86_64|x64)$/i.test(arch)
    ? 'x64'
    : /^(aarch64|arm64)$/i.test(arch)
      ? 'arm64'
      : /^(x86|i[3-6]86|ia32)$/i.test(arch)
        ? 'ia32'
        : arch;
}
export function compareJava(a: JavaRuntime, b: JavaRuntime) {
  const left = a.version.match(/\d+/g)?.map(Number) ?? [],
    right = b.version.match(/\d+/g)?.map(Number) ?? [];
  for (let n = 0; n < Math.max(left.length, right.length); n++) {
    const diff = (right[n] ?? 0) - (left[n] ?? 0);
    if (diff) return diff;
  }
  return a.path.localeCompare(b.path);
}
export async function inspectJava(file: string): Promise<JavaRuntime> {
  const resolved = await realpath(file).catch(() => file);
  const stamp = await stat(resolved)
    .then((s) => `${s.mtimeMs}:${s.size}`)
    .catch(() => 'path');
  const key = `${resolved}:${stamp}`;
  const cached = inspections.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  const value = probeJava(resolved);
  inspections.set(key, { until: Date.now() + 30000, value });
  if (inspections.size > 128) inspections.delete(inspections.keys().next().value!);
  value.catch(() => inspections.delete(key));
  return value;
}
async function probeJava(file: string): Promise<JavaRuntime> {
  const { stderr, stdout } = await exec(file, ['-XshowSettings:properties', '-version'], {
    timeout: 10000,
    windowsHide: true,
    env: javaEnvironment(),
  });
  const out = stderr + stdout;
  const version =
    out.match(/\bjava\.version\s*=\s*(\S+)/)?.[1] ??
    out.match(/(?:openjdk|java) version "([^"]+)"/)?.[1];
  if (!version) throw new Error('无法识别 Java 版本');
  return {
    path: await realpath(
      path.join(
        out.match(/\bjava\.home\s*=\s*(.+)/)?.[1]?.trim() ?? path.dirname(path.dirname(file)),
        'bin',
        process.platform === 'win32' ? 'java.exe' : 'java',
      ),
    ).catch(() => file),
    version,
    major: Number(version.startsWith('1.') ? version.split('.')[1] : version.split('.')[0]),
    arch: out.match(/os.arch\s*=\s*(\S+)/)?.[1] ?? 'unknown',
    vendor: out.match(/java.vendor\s*=\s*(.+)/)?.[1]?.trim(),
    vm: out.match(/java.vm.name\s*=\s*(.+)/)?.[1]?.trim(),
  };
}
export class Java {
  constructor(
    private store: Store,
    private net: Network,
  ) {}
  async discover() {
    const exe = process.platform === 'win32' ? 'java.exe' : 'java';
    const candidates = new Set<string>(['java']);
    if (process.env.JAVA_HOME) candidates.add(path.join(process.env.JAVA_HOME, 'bin', exe));
    if (this.store.data.settings.javaPath) candidates.add(this.store.data.settings.javaPath);
    for (const i of this.store.data.instances) if (i.javaPath) candidates.add(i.javaPath);
    for (const p of (process.env.PATH ?? '').split(path.delimiter))
      if (await exists(path.join(p, exe))) candidates.add(path.join(p, exe));
    const roots = [
      path.join(this.store.root, 'runtimes'),
      ...(process.platform === 'win32'
        ? [
            path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Java'),
            path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Eclipse Adoptium'),
          ]
        : process.platform === 'darwin'
          ? [
              '/Library/Java/JavaVirtualMachines',
              path.join(os.homedir(), 'Library/Java/JavaVirtualMachines'),
            ]
          : ['/usr/lib/jvm']),
    ];
    for (const root of roots) {
      for (const d of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (!d.isDirectory()) continue;
        for (const sub of ['bin', 'Contents/Home/bin']) {
          const p = path.join(root, d.name, sub, exe);
          if (await exists(p)) candidates.add(p);
        }
      }
    }
    const found = await Promise.all([...candidates].map((p) => inspectJava(p).catch(() => null)));
    return found
      .filter((v): v is JavaRuntime => !!v)
      .sort(compareJava)
      .filter(
        (v, n, all) =>
          all.findIndex((x) =>
            process.platform === 'win32'
              ? x.path.toLowerCase() === v.path.toLowerCase()
              : x.path === v.path,
          ) === n,
      );
  }
  async install(major: number, ctx: Work) {
    const platform =
      process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
    if (!['x64', 'arm64'].includes(process.arch)) throw new Error('暂不支持此 CPU 架构的自动安装');
    ctx.progress(2, '查询 Java 运行时');
    const releases = await this.net.json<any[]>(
      `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jre&os=${platform}`,
      { signal: ctx.signal },
    );
    const pkg = releases[0]?.binary?.package;
    if (!pkg) throw new Error('未找到匹配的 Java');
    const archive = path.join(
      this.store.root,
      'cache',
      `java-${major}-${platform}-${arch}.${platform === 'windows' ? 'zip' : 'tar.gz'}`,
    );
    await this.net.download(pkg.link, archive, {
      signal: ctx.signal,
      hash: pkg.checksum,
      algorithm: 'sha256',
      size: pkg.size,
      onProgress: (fraction) => ctx.progress(2 + 78 * fraction, '下载 Java 运行时'),
    });
    ctx.progress(80, '解压 Java');
    ctx.signal.throwIfAborted();
    const target = path.join(this.store.root, 'runtimes');
    await mkdir(target, { recursive: true });
    if (platform === 'windows') await extractZip(archive, target);
    else {
      const { stdout } = await exec('tar', ['-tzf', archive], { maxBuffer: 10 * 1024 ** 2 });
      for (const entry of stdout.split('\n').filter(Boolean)) {
        if (entry.startsWith('/') || entry.split('/').includes('..'))
          throw new Error('运行时压缩包包含不安全路径');
      }
      await exec('tar', ['-xzf', archive, '-C', target], { signal: ctx.signal });
    }
    const runtimes = await this.discover();
    const runtime = runtimes.find((r) => r.major === major && r.path.startsWith(target));
    if (!runtime) throw new Error('运行时已解压，但未找到 Java');
    if (platform !== 'windows') await chmod(runtime.path, 0o755);
    ctx.progress(100, 'Java 已安装');
  }
}
