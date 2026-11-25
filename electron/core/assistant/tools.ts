import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { z } from 'zod';
import { id, instanceSchema, settingsSchema } from '../../../shared/schema';
import type { AiChange, AiDecision, SettingValue } from '../../../shared/assistant';
import type { Instance, LaunchSession, PerformanceSettings } from '../../../shared/types';
import { Store } from '../store';
import { VideoSettings } from '../video-settings';
import { assertOwned } from '../instances';
import { Resources } from '../resources';
import { memoryBudget } from '../performance';

export interface ToolContext {
  source: AiChange['source'];
  chatId?: string;
  instanceId?: string;
  allowChanges: boolean;
  signal?: AbortSignal;
}
type Values = Record<string, SettingValue>;
type Area = 'launcher' | 'instance' | 'video';
type Plan = AiChange & { area: Area };
const launcherFields = settingsSchema
  .pick({
    memoryMb: true,
    source: true,
    concurrency: true,
    closeOnLaunch: true,
    showSnapshots: true,
    backupBeforeLaunch: true,
  })
  .partial()
  .strict();
const performanceFields = instanceSchema.shape.performance.unwrap().shape;
const instanceFields = instanceSchema
  .pick({ memoryMb: true, width: true, height: true })
  .extend({
    memoryMode: performanceFields.memory,
    collector: performanceFields.collector,
    gcLogging: performanceFields.gcLogging,
    fullscreen: z.boolean(),
  })
  .partial()
  .strict();
const videoFields = z.strictObject({
  renderDistance: z.int().min(2).max(64).optional(),
  simulationDistance: z.int().min(2).max(32).optional(),
  maxFps: z.int().min(10).max(260).optional(),
  entityDistanceScaling: z.number().min(0.5).max(5).optional(),
});
const labels: Record<string, string> = {
  memoryMb: '内存上限 (MiB)',
  source: '下载源',
  concurrency: '并行下载数',
  closeOnLaunch: '启动后最小化',
  showSnapshots: '显示快照版',
  backupBeforeLaunch: '启动前备份',
  width: '窗口宽度',
  height: '窗口高度',
  fullscreen: '全屏',
  memoryMode: '内存策略',
  collector: '垃圾收集器',
  gcLogging: 'GC 日志',
  renderDistance: '渲染距离',
  simulationDistance: '模拟距离',
  maxFps: '帧率上限',
  entityDistanceScaling: '实体距离倍率',
};
function instanceValues(i: Instance) {
  return {
    memoryMb: i.memoryMb,
    width: i.width,
    height: i.height,
    fullscreen: i.launchOptions?.fullscreen ?? false,
    memoryMode: i.performance?.memory ?? 'manual',
    collector: i.performance?.collector ?? 'auto',
    gcLogging: i.performance?.gcLogging ?? false,
  };
}
function define<S extends z.ZodObject>(
  name: string,
  title: string,
  description: string,
  schema: S,
  call: (input: z.output<S>, context: ToolContext) => unknown,
  proposes = false,
) {
  return {
    name,
    title,
    description,
    schema: schema as z.ZodObject,
    proposes,
    call: (args: unknown, ctx: ToolContext) => {
      const parsed = schema.safeParse(args);
      if (!parsed.success) throw new Error('工具参数无效，请核对字段、类型和取值范围');
      return call(parsed.data, ctx);
    },
  };
}
export class AssistantTools {
  private plans = new Map<string, Plan>();
  private deciding = new Set<string>();
  private expiry?: NodeJS.Timeout;
  constructor(
    private store: Store,
    private video: VideoSettings,
    private sessions: (id: string) => Promise<LaunchSession[]>,
    private withInstance: (id: string, work: () => Promise<void>) => Promise<void>,
    private changed: () => void,
    private resources = new Resources(store),
  ) {}
  private launcherValues() {
    const {
      memoryMb,
      source,
      concurrency,
      closeOnLaunch,
      showSnapshots,
      backupBeforeLaunch = false,
    } = this.store.data.settings;
    return { memoryMb, source, concurrency, closeOnLaunch, showSnapshots, backupBeforeLaunch };
  }
  private instance(id: string, ctx: ToolContext) {
    if (ctx.source === 'assistant' && ctx.instanceId !== id)
      throw new Error('请在新对话中选择目标实例');
    return this.store.instance(id);
  }
  readonly registry = [
    define(
      'launcher_overview',
      '读取启动器',
      '读取启动器设置、可用物理内存和实例清单。可用 offset 翻页。',
      z.strictObject({
        offset: z.int().nonnegative().optional(),
      }),
      ({ offset = 0 }, ctx) => {
        const instances = this.store.data.instances.filter(
          (i) => !ctx.instanceId || i.id === ctx.instanceId,
        );
        return {
          settings: this.launcherValues(),
          system: {
            platform: process.platform,
            arch: process.arch,
            totalMb: Math.floor(os.totalmem() / 1048576),
            availableMb: Math.floor(os.freemem() / 1048576),
          },
          instances: instances
            .slice(offset, offset + 40)
            .map(({ id, name, version, loader, status }) => ({
              id,
              name,
              version,
              loader,
              status,
            })),
          total: instances.length,
        };
      },
    ),
    define(
      'instance_settings',
      '读取游戏配置',
      '读取指定实例的窗口、内存和已保存的视频设置。',
      z.strictObject({ instanceId: id }),
      async ({ instanceId }, ctx) => {
        const i = this.instance(instanceId, ctx);
        await assertOwned(this.store, i.id);
        const video = await this.video.state(i.id);
        return {
          id: i.id,
          name: i.name,
          version: i.version,
          loader: i.loader,
          ...instanceValues(i),
          estimatedHeapMb: memoryBudget(i, os.totalmem() / 1048576, os.freemem() / 1048576),
          video: this.safeVideo(video.values),
          canRestoreVideo: video.canRestore,
        };
      },
    ),
    define(
      'installed_content',
      '查看已装内容',
      '分页读取实例中的模组、光影或资源包文件名与启用状态。',
      z.strictObject({
        instanceId: id,
        kind: z.enum(['mods', 'shaderpacks', 'resourcepacks']),
        offset: z.int().nonnegative().optional(),
      }),
      async ({ instanceId, kind, offset = 0 }, ctx) => {
        this.instance(instanceId, ctx);
        await assertOwned(this.store, instanceId);
        const files = await this.resources.list(instanceId, [kind]);
        return {
          total: files.length,
          files: files.slice(offset, offset + 30).map(({ name, size }) => ({
            name,
            bytes: size,
            ...(kind === 'mods' ? { enabled: !name.endsWith('.disabled') } : {}),
          })),
        };
      },
    ),
    define(
      'launch_diagnosis',
      '查看启动诊断',
      '读取最近三次或指定一次启动的结果、Java 版本、GC 停顿和诊断结论。',
      z.strictObject({ instanceId: id, sessionId: z.uuid().optional() }),
      async ({ instanceId, sessionId }, ctx) => {
        this.instance(instanceId, ctx);
        const rows = await this.sessions(instanceId);
        return (sessionId ? rows.filter((s) => s.id === sessionId) : rows.slice(0, 3)).map((s) => ({
          id: s.id,
          startedAt: s.startedAt,
          status: s.status,
          exitCode: s.exitCode,
          javaMajor: s.runtime?.major,
          gc: s.gc && {
            pauses: s.gc.pauses,
            maxPauseMs: s.gc.maxPauseMs,
            totalPauseMs: s.gc.totalPauseMs,
          },
          memoryMb: s.memoryMb,
          diagnoses: s.diagnoses.map((d) => d.title),
        }));
      },
    ),
    define(
      'configure_launcher',
      '调整启动器',
      '预览启动器设置修改。memoryMb 是新实例的默认内存。',
      z.strictObject({ changes: launcherFields }),
      ({ changes }, ctx) => this.propose('launcher', undefined, changes, ctx),
      true,
    ),
    define(
      'configure_instance',
      '调整实例',
      '预览指定实例的内存、GC、全屏和窗口尺寸修改。memoryMb 在自动策略下表示上限。固定堆大小时另设 memoryMode 为 manual。',
      z.strictObject({ instanceId: id, changes: instanceFields }),
      ({ instanceId, changes }, ctx) => this.propose('instance', instanceId, changes, ctx),
      true,
    ),
    define(
      'configure_video',
      '调整视频设置',
      '预览已存在的 options.txt 视频字段修改，保留其他字段和可还原备份。',
      z.strictObject({ instanceId: id, changes: videoFields }),
      ({ instanceId, changes }, ctx) => this.propose('video', instanceId, changes, ctx),
      true,
    ),
    define(
      'change_status',
      '查看修改结果',
      '按修改编号查询玩家处理结果。pending 表示等待确认。',
      z.strictObject({ id: z.uuid() }),
      ({ id }, ctx) => {
        const p = this.changes().find(
          (v) => v.id === id && v.source === ctx.source && v.chatId === ctx.chatId,
        );
        if (!p) throw new Error('修改记录不存在');
        return { id, status: p.status, target: p.target, fields: p.fields };
      },
    ),
  ];
  available(ctx: ToolContext) {
    return this.registry.filter((t) => !t.proposes || ctx.allowChanges);
  }
  async call(name: string, args: unknown, ctx: ToolContext) {
    ctx.signal?.throwIfAborted();
    const tool = this.available(ctx).find((t) => t.name === name);
    if (!tool) throw new Error('该工具未开放');
    try {
      return await tool.call(args, ctx);
    } catch (e) {
      if (e instanceof Error && !('code' in e) && !(e instanceof z.ZodError)) throw e;
      throw new Error('无法读取或修改此配置，请在启动器内检查');
    }
  }
  private safeVideo(values: Record<string, string>) {
    return Object.fromEntries(
      Object.entries(values).filter(
        ([key, v]) => Object.hasOwn(videoFields.shape, key) && /^-?\d{1,5}(\.\d{1,16})?$/.test(v),
      ),
    );
  }
  private async values(area: Area, instanceId?: string): Promise<Values> {
    if (area === 'launcher') return this.launcherValues();
    if (area === 'instance') return instanceValues(this.store.instance(instanceId!));
    await assertOwned(this.store, instanceId!);
    return this.safeVideo(await this.video.values(instanceId!));
  }
  changes(): AiChange[] {
    for (const p of this.plans.values())
      if (p.status === 'pending' && !this.deciding.has(p.id) && Date.now() >= p.expiresAt)
        p.status = 'expired';
    return [...this.plans.values()].reverse().map(({ area, ...change }) => change);
  }
  revoke(match: (p: AiChange) => boolean) {
    for (const p of this.plans.values())
      if (p.status === 'pending' && match(p)) p.status = 'expired';
    this.changed();
  }
  private scheduleExpiry() {
    clearTimeout(this.expiry);
    const deadline = Math.min(
      ...[...this.plans.values()]
        .filter((p) => p.status === 'pending' && !this.deciding.has(p.id))
        .map((p) => p.expiresAt),
    );
    if (Number.isFinite(deadline)) {
      this.expiry = setTimeout(
        () => {
          this.changes();
          this.changed();
          this.scheduleExpiry();
        },
        Math.max(1, deadline - Date.now()),
      ).unref();
    }
  }
  private async propose(
    area: Area,
    instanceId: string | undefined,
    edits: Partial<Values>,
    ctx: ToolContext,
  ) {
    const target = instanceId ? this.instance(instanceId, ctx).name : '启动器';
    const current = await this.values(area, instanceId);
    const fields: AiChange['fields'] = [];
    for (const [key, value] of Object.entries(edits)) {
      if (value === undefined) continue;
      if (!Object.hasOwn(current, key)) throw new Error('此游戏版本尚未保存有效的' + labels[key]);
      const after = area === 'video' ? String(value) : value;
      if (area === 'video' ? Number(current[key]) !== value : current[key] !== after)
        fields.push({ key, label: labels[key], before: current[key], after });
    }
    if (!Object.keys(edits).length) throw new Error('请选择至少一个设置');
    if (!fields.length) return { status: 'unchanged', target };
    if (area === 'video' && (await this.video.canRestore(instanceId!)))
      throw new Error('请先在修改记录或性能诊断页还原上次视频修改');
    ctx.signal?.throwIfAborted();
    const pending = this.changes().filter((p) => p.status === 'pending');
    const duplicate = pending.find(
      (p) =>
        p.source === ctx.source &&
        p.chatId === ctx.chatId &&
        p.instanceId === instanceId &&
        this.plans.get(p.id)?.area === area &&
        JSON.stringify(p.fields) === JSON.stringify(fields),
    );
    if (duplicate) return duplicate;
    if (pending.length >= 16) throw new Error('请先处理已有的待确认修改');
    if (this.plans.size >= 100) {
      const oldest = [...this.plans.values()].find(
        (p) => p.status !== 'pending' && !this.deciding.has(p.id),
      );
      if (oldest) this.plans.delete(oldest.id);
    }
    const plan: Plan = {
      id: randomUUID(),
      area,
      target,
      instanceId,
      fields,
      source: ctx.source,
      chatId: ctx.chatId,
      status: 'pending',
      expiresAt: Date.now() + 15 * 60000,
    };
    this.plans.set(plan.id, plan);
    this.scheduleExpiry();
    this.changed();
    return { id: plan.id, status: plan.status, target, fields };
  }
  async decide({ id, decision }: AiDecision) {
    this.changes();
    const p = this.plans.get(id);
    const expectedStatus = decision === 'undo' ? 'applied' : 'pending';
    if (!p || p.status !== expectedStatus || this.deciding.has(id))
      throw new Error('此修改已处理或已过期');
    this.deciding.add(id);
    try {
      if (decision === 'reject') p.status = 'rejected';
      else {
        const undo = decision === 'undo';
        const write = async () => {
          // In-memory comparisons and writes must share one event-loop turn with manual settings edits.
          const current: Values =
            p.area === 'launcher'
              ? this.launcherValues()
              : p.area === 'instance'
                ? instanceValues(this.store.instance(p.instanceId!))
                : await this.values('video', p.instanceId);
          if (p.status !== expectedStatus || (!undo && Date.now() >= p.expiresAt))
            throw new Error('此修改已过期');
          if (p.fields.some((f) => current[f.key] !== (undo ? f.after : f.before))) {
            p.status = 'stale';
            throw new Error('设置已变化，请查看当前值并重新生成修改');
          }
          const values = Object.fromEntries(
            p.fields.map((f) => [f.key, undo ? f.before : f.after]),
          );
          if (p.area === 'video') {
            const before = Object.fromEntries(p.fields.map((f) => [f.key, String(f.before)]));
            const after = Object.fromEntries(p.fields.map((f) => [f.key, String(f.after)]));
            if (undo) await this.video.restore(p.instanceId!, { before, after });
            else await this.video.applyValues(p.instanceId!, after, before);
          } else if (p.area === 'launcher') {
            const old = this.store.data.settings;
            this.store.data.settings = settingsSchema.parse({ ...old, ...values });
            try {
              this.store.save();
            } catch (e) {
              this.store.data.settings = old;
              throw e;
            }
          } else this.writeInstance(p.instanceId!, values);
        };
        if (p.instanceId) await this.withInstance(p.instanceId, write);
        else await write();
        p.status = undo ? 'undone' : 'applied';
      }
      return p;
    } finally {
      this.deciding.delete(id);
      this.scheduleExpiry();
      this.changed();
    }
  }
  private writeInstance(id: string, values: Values) {
    const old = this.store.instance(id);
    const { memoryMode, collector, gcLogging, fullscreen, ...flat } = values;
    const next: Instance = { ...old, ...flat };
    if (memoryMode !== undefined || collector !== undefined || gcLogging !== undefined) {
      const performance: PerformanceSettings = {
        memory: 'manual',
        collector: 'auto',
        gcLogging: false,
        ...old.performance,
      };
      next.performance = performanceFieldsSchema.parse({
        memory: memoryMode ?? performance.memory,
        collector: collector ?? performance.collector,
        gcLogging: gcLogging ?? performance.gcLogging,
      });
    }
    if (fullscreen !== undefined)
      next.launchOptions = {
        target: { kind: 'menu' },
        ...old.launchOptions,
        fullscreen: fullscreen === true,
      };
    instanceSchema.parse(next);
    const index = this.store.data.instances.indexOf(old);
    this.store.data.instances[index] = next;
    try {
      this.store.save();
    } catch (e) {
      this.store.data.instances[index] = old;
      throw e;
    }
  }
}
const performanceFieldsSchema = instanceSchema.shape.performance.unwrap();
