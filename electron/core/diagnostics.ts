import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { open, readdir, rm } from 'node:fs/promises';
import { Store } from './store';
import { checkGamePath } from './game-folders';
import { atomicJson, exists, json } from './files';
import type { Diagnosis, LaunchSession, LogLine } from '../../shared/types';

export function diagnose(lines: string[], status: LaunchSession['status']): Diagnosis[] {
  if (status === 'stopped' || status === 'exited') return [];
  const rules: [RegExp, string, string][] = [
    [
      /OutOfMemoryError: (?:Java heap space|GC overhead limit exceeded)/i,
      'Java 堆内存不足',
      '检查可用物理内存，再调整堆上限或减少模组、资源包。',
    ],
    [
      /insufficient memory|Could not reserve enough space|Native memory allocation.*failed/i,
      '系统或本地内存不足',
      '关闭后台程序并降低堆内存上限；本地内存不包含在 Xmx 内。',
    ],
    [
      /UnsupportedClassVersionError|class file version \d+.*only recognizes/i,
      'Java 版本不兼容',
      '按游戏和模组的版本要求选择 Java，再执行启动检查。',
    ],
    [
      /Unrecognized VM option|Unrecognized option:|Multiple garbage collectors selected|Invalid maximum heap size/i,
      'JVM 参数无效',
      '恢复自动 GC，移除过期或重复的自定义 JVM 参数。',
    ],
    [
      /GLFW error 65542|Pixel format not accelerated|Failed to create.*(?:OpenGL|GLX)|does not support OpenGL/i,
      '图形初始化失败',
      '检查显卡驱动与 OpenGL 支持；先停用光影和渲染替换模组。',
    ],
    [
      /UnsatisfiedLinkError|wrong ELF class|incompatible architecture/i,
      '本地库或架构不匹配',
      '核对 Java 架构，并使用实例修复功能重建本地库。',
    ],
    [
      /Incompatible mods found|Mod resolution encountered|Missing or unsupported mandatory dependencies/i,
      '模组依赖不兼容',
      '按加载器日志核对依赖、游戏版本及加载器；不要直接删除存档。',
    ],
    [
      /MixinApplyError|Mixin apply.*failed|InvalidMixinException|InjectionError/i,
      '模组注入失败',
      '查看证据所指的模组，核对其依赖及兼容版本。仅凭此信息不能确定唯一责任模组。',
    ],
  ];
  const result: Diagnosis[] = [];
  for (const [pattern, title, suggestion] of rules) {
    const evidence = lines.find((l) => pattern.test(l));
    if (evidence) result.push({ title, suggestion, evidence: evidence.slice(0, 1000) });
  }
  if (!result.length && status === 'failed')
    result.push({
      title: '未识别的异常退出',
      suggestion: '查看日志末尾和游戏 crash-reports。退出信号本身不能证明是模组崩溃。',
      evidence: lines.at(-1)?.slice(0, 1000) ?? '',
    });
  return result;
}
export function gcSummary(text: string): NonNullable<LaunchSession['gc']> {
  // Only completed stop-the-world pause records, never concurrent cycle durations or [gc,start].
  const values = text.split(/\r?\n/).flatMap((line) => {
    if (!/\bPause\b/.test(line) || /\[gc,start\]/.test(line)) return [];
    const m = /\s(\d+(?:\.\d+)?)ms\s*$/.exec(line);
    return m ? [Number(m[1])] : [];
  });
  return {
    pauses: values.length,
    maxPauseMs: values.reduce((a, b) => Math.max(a, b), 0),
    totalPauseMs: values.reduce((a, b) => a + b, 0),
    scope: '本次启动保留的 GC 日志；不是帧时间或 FPS',
  };
}
async function tailFile(file: string, max = 2 * 1024 * 1024) {
  const f = await open(file, 'r');
  try {
    const s = await f.stat(),
      size = Math.min(s.size, max),
      b = Buffer.alloc(size);
    await f.read(b, 0, size, s.size - size);
    const text = b.toString('utf8');
    return s.size > size ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    await f.close();
  }
}
export class Diagnostics {
  private records = new Map<string, LaunchSession[]>();
  private writes = new Map<string, Promise<void>>();
  constructor(private store: Store) {}
  private file(id: string) {
    this.store.instance(id);
    return path.join(this.store.root, 'diagnostics', id + '.json');
  }
  async list(id: string) {
    if (!this.records.has(id)) {
      const file = this.file(id);
      const saved = (await exists(file)) ? await json<LaunchSession[]>(file) : [];
      for (const s of saved)
        if (s.status === 'running' || s.status === 'preparing') {
          s.status = 'interrupted';
          s.phase = '启动器已退出，游戏结果未知';
        }
      // Concurrent readers must not replace a live session created after their read began.
      if (!this.records.has(id)) this.records.set(id, saved.slice(0, 12));
    }
    return this.records.get(id)!;
  }
  async save(id: string) {
    const snapshot = JSON.parse(JSON.stringify(await this.list(id)));
    const previous = this.writes.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => atomicJson(this.file(id), snapshot));
    this.writes.set(id, next);
    await next;
  }
  async latest(id?: string) {
    if (!id) return;
    const session = (await this.list(id))[0];
    if (!session) return;
    const { instanceId, startedAt, status, phase } = session;
    const diagnosis = session.diagnoses[0];
    const failure =
      session.failure ??
      (status === 'failed' && diagnosis
        ? { reason: diagnosis.evidence || diagnosis.title, action: 'diagnostics' as const }
        : undefined);
    return { id: session.id, instanceId, startedAt, status, phase, failure };
  }
  runningPhase(id: string) {
    const session = this.records.get(id)?.[0];
    return session?.status === 'running' ? session.phase : undefined;
  }
  async start(id: string) {
    const list = await this.list(id);
    const s: LaunchSession = {
      id: randomUUID(),
      instanceId: id,
      startedAt: Date.now(),
      status: 'preparing',
      phase: '检查运行环境',
      diagnoses: [],
      tail: [],
    };
    list.unshift(s);
    const removed = list.splice(12);
    const logs = path.join(this.store.dir(id), 'logs');
    const names: string[] = await readdir(logs).catch(() => []);
    for (const old of removed) {
      if (/^[a-f0-9-]{36}$/.test(old.id) && names.includes(`kjmcl-world-${old.id}.json`)) {
        const file = path.join(logs, `kjmcl-world-${old.id}.json`);
        await checkGamePath(file);
        await rm(file, { force: true });
      }
      if (old.gcLog && /^kjmcl-gc-[a-f0-9-]+\.log$/.test(old.gcLog)) {
        for (const n of names.filter(
          (n) => n === old.gcLog || [0, 1, 2, 3, 4].some((k) => n === `${old.gcLog}.${k}`),
        ))
          await rm(path.join(logs, n), { force: true });
      }
    }
    await this.save(id);
    return s;
  }
  async finish(s: LaunchSession, tail: LogLine[]) {
    s.endedAt = Date.now();
    s.tail = tail.slice(-150).map((l) => ({ ...l, text: l.text.slice(0, 4000) }));
    s.diagnoses = diagnose(
      tail.map((l) => l.text),
      s.status,
    );
    if (s.status === 'failed' && !s.failure) {
      const diagnosis = s.diagnoses[0];
      const specific = diagnosis && diagnosis.title !== '未识别的异常退出';
      const lastError = tail
        .slice(0, -1)
        .reverse()
        .find((l) => l.level === 'error' || /(?:Exception|Error): /.test(l.text));
      s.failure = {
        reason: specific
          ? diagnosis.title + ' · ' + diagnosis.evidence.slice(0, 350)
          : (lastError?.text || tail.at(-1)?.text || s.phase).slice(0, 500),
        action: 'diagnostics',
      };
    }
    if (s.gcLog) {
      const root = path.join(this.store.dir(s.instanceId), 'logs');
      const files = await readdir(root).catch(() => []);
      const names = files.filter(
        (n) => n === s.gcLog || [0, 1, 2, 3, 4].some((k) => n === `${s.gcLog}.${k}`),
      );
      let text = '';
      for (const n of names) text += (await tailFile(path.join(root, n)).catch(() => '')) + '\n';
      s.gc = gcSummary(text);
    }
    await this.save(s.instanceId);
  }
}
