import { randomUUID } from 'node:crypto';
import type { Task } from '../../shared/types';
export interface Work {
  signal: AbortSignal;
  progress: (percent: number, detail?: string) => void;
}
export class Tasks {
  items: Task[] = [];
  private controllers = new Map<string, AbortController>();
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
  start(title: string, key: string, work: (ctx: Work) => Promise<void>) {
    if (this.keys.has(key)) throw new Error('该实例有任务正在运行');
    this.keys.add(key);
    const id = randomUUID(),
      control = new AbortController();
    this.controllers.set(id, control);
    const task: Task = {
      id,
      title,
      status: 'running',
      progress: 0,
      detail: '准备中',
      createdAt: Date.now(),
    };
    this.items.unshift(task);
    this.changed();
    void (async () => {
      try {
        await work({
          signal: control.signal,
          progress: (percent, detail) => {
            task.progress = Math.max(0, Math.min(100, percent));
            if (detail) task.detail = detail;
            this.changed();
          },
        });
        control.signal.throwIfAborted();
        task.status = 'completed';
        task.progress = 100;
        task.detail = '已完成';
      } catch (e) {
        task.status = control.signal.aborted ? 'cancelled' : 'failed';
        task.detail = control.signal.aborted
          ? '已取消'
          : e instanceof Error
            ? e.message
            : '任务失败';
      } finally {
        this.controllers.delete(id);
        this.keys.delete(key);
        this.items = this.items.slice(0, 100);
        this.changed();
      }
    })();
    return id;
  }
  cancel(id: string) {
    this.controllers.get(id)?.abort(new Error('已取消'));
  }
  cancelAll() {
    for (const c of this.controllers.values()) c.abort();
  }
}
