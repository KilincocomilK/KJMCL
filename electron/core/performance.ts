import os from 'node:os';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Instance, JavaRuntime, LaunchCheck, PerformanceSettings } from '../../shared/types';
import type { Store } from './store';
import { checkGamePath } from './game-folders';
import { Java, inspectJava, javaArch, javaEnvironment } from './java';
import { Minecraft, allowed } from './minecraft';
const exec = promisify(execFile);
export const defaults: PerformanceSettings = {
  memory: 'manual',
  collector: 'auto',
  gcLogging: false,
};
export function memoryBudget(i: Instance, totalMb: number, availableMb: number) {
  // Reserve physical memory for the OS, native allocations and the launcher; a heap cap is not total RSS.
  const budget = Math.max(
    512,
    Math.floor(Math.min(totalMb * 0.5, availableMb - 2048, 8192) / 256) * 256,
  );
  return i.performance?.memory === 'auto' ? Math.min(budget, i.memoryMb) : i.memoryMb;
}
export function requiredJava(version: string, metadata?: number) {
  if (metadata) return metadata;
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version);
  if (!m) return 8; // Snapshots and loader-specific requirements must come from metadata.
  const [, major, minor, patch] = m.map(Number);
  if (major === 26) return 25;
  if (major === 1 && (minor > 20 || (minor === 20 && (patch || 0) >= 5))) return 21;
  if (major === 1 && minor >= 18) return 17;
  if (major === 1 && minor === 17) return 16;
  return 8;
}
export function planRuntime(
  i: Instance,
  required: number,
  runtime: JavaRuntime | undefined,
  totalMb: number,
  availableMb: number,
  arch: string = process.arch,
): LaunchCheck {
  const settings = i.performance ?? defaults;
  const memoryMb = memoryBudget(i, totalMb, availableMb);
  const r: LaunchCheck = {
    requiredJava: required,
    runtime,
    memoryMb,
    totalMb,
    availableMb,
    managedArgs: [`-Xmx${memoryMb}M`],
    issues: [],
    checkedFiles: 0,
    tested: false,
  };
  const issue = (code: string, level: 'error' | 'warning', message: string) =>
    r.issues.push({ code, level, message });
  if (!runtime) issue('java-missing', 'error', `未找到 ${arch} Java ${required}，请安装或指定路径`);
  else {
    if (runtime.major < required)
      issue('java-old', 'error', `需要 Java ${required}，当前为 Java ${runtime.major}`);
    else if (runtime.major !== required)
      issue('java-new', 'warning', `建议使用 Java ${required}；较新 Java 可能与加载器或模组不兼容`);
    if (javaArch(runtime.arch) !== arch)
      issue(
        'java-arch',
        'error',
        `Java 架构 ${runtime.arch} 与启动器 ${arch} 不匹配，无法共用本地库`,
      );
    if (
      i.version.match(/^1\.(?:[0-9]|1[0-2])(?:\.|$)/) &&
      runtime.major > 8 &&
      i.loader === 'forge'
    )
      issue('legacy-forge', 'error', '此旧版 Forge 请使用 Java 8');
  }
  if (memoryMb > totalMb - 1536 || memoryMb > availableMb - 1024)
    issue(
      'memory-pressure',
      'warning',
      '可用物理内存偏低；请关闭后台程序或降低堆内存上限，避免系统换页',
    );
  if (memoryMb < 2048 && required >= 17)
    issue('memory-small', 'warning', '现代版本的堆内存不足 2 GiB，可能无法完成加载');
  const collectors = i.jvmArgs.filter((a) => /^-XX:\+Use\w+GC$/.test(a));
  if (i.jvmArgs.some((a) => /^-(?:Xmx|XX:(?:MaxHeapSize|MaxRAM|MaxRAMPercentage)=)/.test(a)))
    issue('heap-conflict', 'error', 'JVM 参数含堆内存上限；请删除该参数并使用内存设置');
  if (collectors.length > 1 || (collectors.length && settings.collector !== 'auto'))
    issue('gc-conflict', 'error', '垃圾收集器参数重复，请使用一处设置');
  if (collectors.length && settings.collector === 'auto')
    issue('custom-gc', 'warning', '自定义 GC 参数将用于游戏，但不包含在安全的 JVM 试运行中');
  const initial = i.jvmArgs.filter((a) => /^-Xms/.test(a));
  if (initial.length > 1) issue('xms-duplicate', 'error', '存在多个初始堆内存参数');
  for (const arg of initial) {
    const match = /^-Xms(\d+)([kmg]?)$/i.exec(arg);
    const mb = match
      ? Number(match[1]) * { '': 1 / 1048576, k: 1 / 1024, m: 1, g: 1024 }[match[2].toLowerCase()]!
      : NaN;
    if (!Number.isFinite(mb) || mb > memoryMb)
      issue('xms-invalid', 'error', '初始堆内存必须为有效值且不超过当前最大堆内存');
  }
  const paired = new Set([
    '--add-opens',
    '--add-exports',
    '--add-reads',
    '--add-modules',
    '--limit-modules',
    '--enable-native-access',
    '--module-path',
    '--upgrade-module-path',
    '--patch-module',
  ]);
  if (
    i.jvmArgs.some(
      (a, n) =>
        a.startsWith('@') ||
        (!a.startsWith('-') && !paired.has(i.jvmArgs[n - 1])) ||
        /^(?:-jar|-cp|-classpath|--class-path|-m|--module)(?:=|$)/.test(a),
    )
  )
    issue('launch-override', 'error', 'JVM 参数不能包含主类、参数文件或 classpath 覆盖项');
  if (settings.collector !== 'auto' && runtime) {
    if (runtime.vm && /openj9|j9 vm/i.test(runtime.vm))
      issue('vm-collector', 'error', '此 GC 选项面向 HotSpot，请对当前虚拟机使用自动模式');
    if (settings.collector === 'zgc' && (runtime.major < 17 || javaArch(runtime.arch) === 'ia32'))
      issue('zgc-version', 'error', 'ZGC 选项需要 64 位 Java 17 或更新版本');
    r.managedArgs.push(settings.collector === 'g1' ? '-XX:+UseG1GC' : '-XX:+UseZGC');
    if (settings.collector === 'zgc' && runtime.major >= 21 && runtime.major <= 22)
      r.managedArgs.push('-XX:+ZGenerational');
  }
  if (settings.gcLogging && runtime && runtime.major < 9)
    issue('gc-log-old', 'error', 'GC 记录需要 Java 9 或更新版本');
  return r;
}
export class Performance {
  constructor(
    private store: Store,
    private mc: Minecraft,
    private java: Java,
  ) {}
  async check(id: string, test = true, signal?: AbortSignal): Promise<LaunchCheck> {
    const i = this.store.instance(id);
    const { version: v, client } = await this.mc.resolved(id);
    const required = requiredJava(i.version, v.javaVersion?.majorVersion);
    const configured = i.javaPath || this.store.data.settings.javaPath;
    let runtime: JavaRuntime | undefined;
    let inspectError = false;
    try {
      runtime = configured
        ? await inspectJava(configured)
        : (await this.java.discover()).find(
            (j) => j.major === required && javaArch(j.arch) === process.arch,
          );
    } catch {
      inspectError = true;
    }
    const r = planRuntime(
      i,
      required,
      runtime,
      Math.floor(os.totalmem() / 1048576),
      Math.floor(os.freemem() / 1048576),
    );
    const metadataArgs = (v.arguments?.jvm ?? []).flatMap((a) =>
      typeof a === 'string'
        ? [a]
        : allowed(a.rules)
          ? Array.isArray(a.value)
            ? a.value
            : [a.value]
          : [],
    );
    if (
      metadataArgs.some((a) => /^-(?:Xmx|XX:(?:MaxHeapSize|MaxRAM|MaxRAMPercentage)=)/.test(a)) ||
      ((i.performance?.collector ?? 'auto') !== 'auto' &&
        metadataArgs.some((a) => /^-XX:\+Use\w+GC$/.test(a)))
    )
      r.issues.push({
        code: 'metadata-conflict',
        level: 'error',
        message: '版本元数据包含冲突的堆内存或 GC 参数，请修复版本配置',
      });
    if (inspectError)
      r.issues.push({
        code: 'java-path',
        level: 'error',
        message: '无法执行指定的 Java，请检查路径及权限',
      });
    const files = [
      client,
      ...this.mc
        .libraryFiles(v, id)
        .filter((f) => !f.native)
        .map((f) => f.dest),
    ];
    const missing: string[] = [];
    for (const file of new Set(files)) {
      signal?.throwIfAborted();
      if (i.external) await checkGamePath(file, true);
      r.checkedFiles++;
      if (
        !(await stat(file)
          .then((s) => s.isFile() && s.size > 0)
          .catch(() => false))
      )
        missing.push(path.basename(file));
    }
    if (missing.length)
      r.issues.push({
        code: 'files-missing',
        level: 'error',
        message: `缺少 ${missing.length} 个游戏文件，${i.external ? '请在原启动器补齐后刷新' : '请在实例设置中修复'}：${missing.slice(0, 3).join('、')}`,
      });
    if (['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS'].some((k) => process.env[k]))
      r.issues.push({
        code: 'environment',
        level: 'warning',
        message: '系统 Java 环境变量还会注入参数；试运行只验证启动器管理的参数',
      });
    if (test && runtime && !r.issues.some((x) => x.level === 'error')) {
      try {
        await exec(
          runtime.path,
          [
            ...r.managedArgs,
            ...i.jvmArgs.filter((a) => /^-Xms\d+[kmg]?$/i.test(a)),
            ...(i.performance?.gcLogging ? ['-Xlog:gc=info:stdout'] : []),
            '-version',
          ],
          {
            cwd: this.store.dir(id),
            timeout: 15000,
            windowsHide: true,
            env: javaEnvironment(),
            signal,
            maxBuffer: 256 * 1024,
          },
        );
        r.tested = true;
      } catch {
        signal?.throwIfAborted();
        r.issues.push({
          code: 'jvm-probe',
          level: 'error',
          message: 'JVM 试运行失败：当前 Java 无法使用所选内存或收集器，请降低内存或恢复自动 GC',
        });
      }
    }
    return r;
  }
}
