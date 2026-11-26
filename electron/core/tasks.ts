import { randomUUID } from 'node:crypto';
import type { Task } from '../../shared/types';
export interface Work {
  signal: AbortSignal;
  progress: (percent: number, detail?: string) => void;
  setTitle?: (title: string) => void;
  setScope?: (scope: string) => void;
  /** Finish an atomic commit once its cancellable preparation has succeeded. */
  beginCommit?: () => void;
}
export function progressRange(ctx: Work, start: number, end: number): Work {
  return {
    signal: ctx.signal,
    progress: (percent, detail) => ctx.progress(start + ((end - start) * percent) / 100, detail),
  };
}

/** Combine concurrent file transfers by size, or by file count when sizes are unknown. */
export function fileProgress(ctx: Work, sizes: (number | undefined)[], start: number, end: number) {
  const knownSizes = sizes.every(
    (size) => size !== undefined && Number.isFinite(size) && size >= 0,
  );
  const weights = sizes.map((size) => (knownSizes ? Math.max(1, size!) : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const fractions = new Float64Array(weights.length);
  let done = 0;
  return (index: number, fraction: number, detail: string) => {
    // A retried transfer can report bytes that were already counted.
    if (fraction <= fractions[index]) return;
    done += (fraction - fractions[index]) * weights[index];
    fractions[index] = fraction;
    ctx.progress(start + ((end - start) * done) / total, detail);
  };
}

interface ActiveTask {
  control: AbortController;
  committing?: boolean;
  result?: Promise<unknown>;
}

export class Tasks {
  items: Task[] = [];
  private controllers = new Map<string, ActiveTask>();
  private keys = new Set<string>();
  constructor(private changed: () => void) {}
  busy(key: string) {
    return this.keys.has(key);
  }
  async exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (this.keys.has(key)) throw new Error('该实例有任务正在运行');
    this.keys.add(key);
    try {
      return await work();
    } finally {
      this.keys.delete(key);
      this.changed();
    }
  }
  start(title: string, key: string, work: (ctx: Work) => Promise<void>, kind?: Task['kind']) {
    const { id, result } = this.execute(title, key, work, kind);
    // Background failures are delivered in the task record.
    void result.catch(() => {});
    return id;
  }
  run<T>(title: string, key: string, work: (ctx: Work) => Promise<T>) {
    return this.execute(title, key, work).result;
  }
  private execute<T>(
    title: string,
    key: string,
    work: (ctx: Work) => Promise<T>,
    kind?: Task['kind'],
  ) {
    if (this.keys.has(key)) throw new Error('该实例有任务正在运行');
    this.keys.add(key);
    const id = randomUUID(),
      control = new AbortController();
    const active: ActiveTask = { control };
    this.controllers.set(id, active);
    const task: Task = {
      scope: key,
      id,
      title,
      kind,
      status: 'running',
      progress: 0,
      detail: '准备中',
      createdAt: Date.now(),
    };
    this.items.unshift(task);
    this.changed();
    let sampledAt = performance.now(),
      sampledProgress = 0,
      rate = 0;
    const result = (async () => {
      try {
        const value = await work({
          signal: control.signal,
          beginCommit: () => {
            control.signal.throwIfAborted();
            active.committing = true;
          },
          setScope: (scope) => {
            task.scope = scope;
            this.changed();
          },
          setTitle: (title) => {
            task.title = title;
            this.changed();
          },
          progress: (percent, detail) => {
            if (!Number.isFinite(percent)) return;
            task.progress = Math.max(task.progress, Math.min(99.9, percent));
            const now = performance.now(),
              elapsed = (now - sampledAt) / 1000;
            if (elapsed >= 0.5 && task.progress > sampledProgress) {
              const measured = (task.progress - sampledProgress) / elapsed;
              rate = rate ? 0.6 * rate + 0.4 * measured : measured;
              task.remainingSeconds = Math.max(1, Math.ceil((100 - task.progress) / rate));
              sampledAt = now;
              sampledProgress = task.progress;
            }
            if (detail) task.detail = detail;
            this.changed();
          },
        });
        control.signal.throwIfAborted();
        task.status = 'completed';
        task.progress = 100;
        task.detail = '已完成';
        return value;
      } catch (e) {
        task.status = control.signal.aborted ? 'cancelled' : 'failed';
        task.detail = control.signal.aborted
          ? '已取消'
          : e instanceof Error
            ? e.message
            : '任务失败';
        throw e;
      } finally {
        task.finishedAt = Date.now();
        delete task.remainingSeconds;
        this.controllers.delete(id);
        this.keys.delete(key);
        this.items = this.items.filter((item, index) => index < 100 || item.status === 'running');
        this.changed();
      }
    })();
    active.result = result;
    return { id, result };
  }
  dismiss(id: string) {
    const task = this.items.find((item) => item.id === id);
    if (!task || task.notificationDismissed) return;
    task.notificationDismissed = true;
    this.changed();
  }
  cancel(id: string) {
    const active = this.controllers.get(id);
    if (active && !active.committing) active.control.abort(new Error('已取消'));
  }
  async cancelAll() {
    const active = [...this.controllers.values()];
    for (const task of active) if (!task.committing) task.control.abort();
    await Promise.allSettled(active.map((task) => task.result));
  }
}
