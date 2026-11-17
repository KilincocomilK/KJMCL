import type { LogLine } from '../shared/types';

export const LOG_VIEW_LIMIT = 2000;
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
  const text = query.trim().toLowerCase();
  return lines.filter(
    (line) =>
      (level === 'all' || logLevel(line) === level) && line.text.toLowerCase().includes(text),
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
  private live: LogLine[] = [];
  private frozen?: LogLine[];
  constructor(readonly instanceId: string) {}

  get paused() {
    return this.frozen !== undefined;
  }
  get visible(): readonly LogLine[] {
    return this.frozen ?? this.live;
  }

  append(line: LogLine) {
    if (line.instanceId !== this.instanceId) return;
    this.live = [...this.live, line].slice(-LOG_VIEW_LIMIT);
  }

  seed(snapshot: readonly LogLine[]) {
    // The snapshot can overlap events received while its IPC reply was in flight.
    // Count occurrences, rather than using a Set: identical same-ms lines are valid.
    const lines = snapshot.filter((line) => line.instanceId === this.instanceId);
    const counts = new Map<string, number>();
    const key = (line: LogLine) => JSON.stringify([line.time, line.level, line.text]);
    for (const line of lines) counts.set(key(line), (counts.get(key(line)) ?? 0) + 1);
    const pending = this.live.filter((line) => {
      const token = key(line),
        count = counts.get(token) ?? 0;
      if (!count) return true;
      counts.set(token, count - 1);
      return false;
    });
    this.live = [...lines, ...pending].slice(-LOG_VIEW_LIMIT);
  }

  pause() {
    this.frozen ??= this.live;
  }
  resume() {
    this.frozen = undefined;
  }
}
