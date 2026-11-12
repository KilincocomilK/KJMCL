/** Runtime-only policy. Game ownership and background jobs stay with the launcher. */
export class LightweightMode {
  active = false;
  private wanted = false;
  private count = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private switching = false;
  private disposed = false;
  constructor(
    private replace: (lightweight: boolean) => Promise<void>,
    private idle: () => boolean,
    private changed: () => void,
    private failed: (error: unknown) => void,
  ) {}

  running(count: number) {
    const previous = this.count;
    this.count = count;
    // One automatic entry per play session; an explicit full view lasts until all games exit.
    if (!count) this.wanted = false;
    else if (!previous) this.wanted = true;
    this.schedule(this.wanted ? 1500 : 0);
  }

  request(lightweight: boolean) {
    if (lightweight && !this.count) throw new Error('游戏运行时可进入轻量模式');
    this.wanted = lightweight;
    // Reply to the initiating IPC before replacing its renderer.
    this.schedule(50);
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  private schedule(delay: number) {
    clearTimeout(this.timer);
    if (this.disposed || this.switching || this.wanted === this.active) return;
    this.timer = setTimeout(() => void this.apply(), delay);
    this.timer.unref?.();
  }

  private async apply() {
    if (this.disposed || this.wanted === this.active) return;
    // Never unload a renderer while it is awaiting a native dialog or mutation.
    if (!this.idle()) return this.schedule(250);
    this.switching = true;
    const target = this.wanted;
    try {
      await this.replace(target);
      this.active = target;
      this.changed();
    } catch (error) {
      this.wanted = this.active;
      this.failed(error);
    } finally {
      this.switching = false;
      this.schedule(0);
    }
  }
}
