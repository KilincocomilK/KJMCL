import type { LogLine } from './types';

export const LOG_HISTORY_LIMIT = 2000;

export class RecentGameLogs {
  private lines: LogLine[] = [];
  private next = 0;

  append(line: LogLine) {
    this.lines[this.next] = line;
    this.next = (this.next + 1) % LOG_HISTORY_LIMIT;
  }

  snapshot() {
    return this.lines.slice(this.next).concat(this.lines.slice(0, this.next));
  }
}
