import { matchesSearch } from '../shared/search';
import type { LogLine } from '../shared/types';
import { RecentGameLogs } from '../shared/recent-logs';

export { LOG_HISTORY_LIMIT as LOG_VIEW_LIMIT } from '../shared/recent-logs';
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogFilter = LogLevel | 'all';

export function logLevel(line: LogLine): LogLevel {
  // Both decoded Log4j events and plain Minecraft output carry this prefix.
  const explicit = /^(?:\[[^\]\r\n]*\]\s*)?\[[^\]\r\n]*\/(INFO|WARN|ERROR|FATAL|DEBUG|TRACE)\]/i
    .exec(line.text)?.[1]
    ?.toUpperCase();
  if (explicit === 'WARN') return 'warn';
  if (explicit === 'ERROR' || explicit === 'FATAL') return 'error';
  if (explicit === 'DEBUG' || explicit === 'TRACE') return 'debug';
  if (explicit === 'INFO') return 'info';
  return line.level;
}

export function filterLogs(lines: readonly LogLine[], query: string, level: LogFilter) {
  return lines.filter(
    (line) => (level === 'all' || logLevel(line) === level) && matchesSearch(query, line.text),
  );
}

export function formatLogs(lines: readonly LogLine[]) {
  return lines
    .map(
      (line) =>
        `${new Date(line.time).toISOString()} [${logLevel(line).toUpperCase()}] ${line.text}`,
    )
    .join('\n');
}

/** Receives already-redacted lines from the named preload bridge. */
export class LogViewBuffer {
  private live = new RecentGameLogs();
  private frozen?: LogLine[];
  constructor(readonly instanceId: string) {}

  get paused() {
    return this.frozen !== undefined;
  }
  get visible(): readonly LogLine[] {
    return this.frozen ?? this.live.snapshot();
  }

  append(line: LogLine) {
    if (line.instanceId !== this.instanceId) return;
    this.live.append(line);
  }

  seed(snapshot: readonly LogLine[]) {
    // The snapshot can overlap events received while its IPC reply was in flight.
    // Count occurrences, rather than using a Set: identical same-ms lines are valid.
    const lines = snapshot.filter((line) => line.instanceId === this.instanceId);
    const counts = new Map<string, number>();
    const key = (line: LogLine) => JSON.stringify([line.time, line.level, line.text]);
    for (const line of lines) counts.set(key(line), (counts.get(key(line)) ?? 0) + 1);
    const pending = this.live.snapshot().filter((line) => {
      const token = key(line),
        count = counts.get(token) ?? 0;
      if (!count) return true;
      counts.set(token, count - 1);
      return false;
    });
    this.live = new RecentGameLogs();
    for (const line of lines) this.live.append(line);
    for (const line of pending) this.live.append(line);
  }

  pause() {
    this.frozen ??= this.live.snapshot();
  }
  resume() {
    this.frozen = undefined;
  }
}
