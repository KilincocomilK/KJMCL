import os from 'node:os';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Instance, JavaRuntime, LaunchCheck, PerformanceSettings } from '../../shared/types';
import type { Store } from './store';
import { checkGamePath } from './game-folders';
import { Java, inspectJava, javaArch, javaEnvironment } from './java';
import { requiredJava } from '../../shared/java';
export { requiredJava } from '../../shared/java';
import type { Minecraft } from './minecraft';
import { prepareGameLaunch } from './launch-options';
const exec = promisify(execFile);
const heapLimit = /^-(?:Xmx|XX:(?:MaxHeapSize|MaxRAM|MaxRAMPercentage)=)/;
const initialHeap = /^-(?:Xms|XX:InitialHeapSize=)/;
const initialHeapSize = /^-(?:Xms|XX:InitialHeapSize=)(\d+)([kKmMgG]?)$/;
// Match collector selectors, leaving policy switches such as UseAdaptiveSizePolicyWithSystemGC alone.
const collectorFlag =
  /^-XX:([+-])(Use(?:Serial|Parallel|ConcMarkSweep|G1|Z|Shenandoah|Epsilon)GC)$/;
const managedCollectors = { auto: undefined, g1: 'UseG1GC', zgc: 'UseZGC' } as const;
export const defaults: PerformanceSettings = {
  memory: 'manual',
  collector: 'auto',
  gcLogging: false,
};
export function recommendedHeap(totalMb: number, availableMb: number, maximumMb: number) {
  // Reserve physical memory for the OS, native allocations and the launcher; a heap cap is not total RSS.
  return Math.max(
    512,
    Math.floor(Math.min(totalMb * 0.5, availableMb - 2048, maximumMb) / 256) * 256,
  );
}
export function memoryBudget(i: Instance, totalMb: number, availableMb: number) {
  return i.performance?.memory === 'auto'
    ? Math.min(recommendedHeap(totalMb, availableMb, 8192), i.memoryMb)
    : i.memoryMb;
}
export function memoryArgumentIssues(i: Instance, memoryMb: number, metadataArgs: string[]) {
  const issues: LaunchCheck['issues'] = [];
  const issue = (code: string, level: 'error' | 'warning', message: string) =>
    issues.push({ code, level, message });
  if (i.jvmArgs.some((a) => heapLimit.test(a)))
    issue('heap-conflict', 'error', 'JVM 参数含堆内存上限；请删除该参数并使用内存设置');
  if (metadataArgs.some((a) => heapLimit.test(a)))
    issue('metadata-conflict', 'error', '版本元数据包含堆内存上限，与实例内存设置冲突');
  const managed = managedCollectors[(i.performance ?? defaults).collector];
  const jvmArgs = [...i.jvmArgs, ...metadataArgs];
  const collectors = new Map<string, boolean>();
  if (managed) collectors.set(managed, true);
  for (const arg of jvmArgs) {
    const flag = collectorFlag.exec(arg);
    if (flag) collectors.set(flag[2], flag[1] === '+');
  }
  const enabled = [...collectors.values()].filter(Boolean).length;
  if (enabled > 1 || (managed && !collectors.get(managed)))
    issue('gc-conflict', 'error', '实例与版本的垃圾收集器参数冲突，请核对 GC 设置和 JVM 参数');
  else if (collectors.size && !managed)
    issue('custom-gc', 'warning', '游戏使用自定义 GC 参数，JVM 试运行只验证启动器管理的 GC 选项');
  const initial = jvmArgs.filter((a) => initialHeap.test(a));
  if (initial.length > 1) issue('xms-duplicate', 'error', '存在多个初始堆内存参数');
  for (const arg of initial) {
    const match = initialHeapSize.exec(arg);
    const mb = match
      ? Number(match[1]) * { '': 1 / 1048576, k: 1 / 1024, m: 1, g: 1024 }[match[2].toLowerCase()]!
      : NaN;
    if (!Number.isFinite(mb) || mb > memoryMb)
      issue('xms-invalid', 'error', '初始堆内存必须为有效值且不超过当前最大堆内存');
  }
  return issues;
}
export function planRuntime(
  i: Instance,
  required: number,
  runtime: JavaRuntime | undefined,
  totalMb: number,
  availableMb: number,
  arch: string = process.arch,
  metadataArgs: string[] = [],
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
  // Check expanded metadata again before spawn. A second heap cap always conflicts, even in a template.
  r.issues.push(
    ...memoryArgumentIssues(
      i,
      memoryMb,
      metadataArgs.filter((a) => !a.includes('${') || heapLimit.test(a)),
    ),
  );
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
  const managedCollector = managedCollectors[settings.collector];
  if (managedCollector && runtime) {
    if (runtime.vm && /openj9|j9 vm/i.test(runtime.vm))
      issue('vm-collector', 'error', '此 GC 选项面向 HotSpot，请对当前虚拟机使用自动模式');
    if (settings.collector === 'zgc' && (runtime.major < 17 || javaArch(runtime.arch) === 'ia32'))
      issue('zgc-version', 'error', 'ZGC 选项需要 64 位 Java 17 或更新版本');
    r.managedArgs.push(`-XX:+${managedCollector}`);
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
  async check(
    id: string,
    test = true,
    signal?: AbortSignal,
    prepared?: Awaited<ReturnType<typeof prepareGameLaunch>>,
  ): Promise<LaunchCheck> {
    const i = this.store.instance(id);
    const { version: v, jvm, classpath } = prepared ?? (await prepareGameLaunch(this.mc, id));
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
      process.arch,
      jvm,
    );
    if (inspectError)
      r.issues.push({
        code: 'java-path',
        level: 'error',
        message: '无法执行指定的 Java，请检查路径及权限',
      });
    const missing: string[] = [];
    for (const file of new Set(classpath)) {
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
            ...[...i.jvmArgs, ...jvm].filter((a) => initialHeapSize.test(a)),
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
