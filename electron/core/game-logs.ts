import type { Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { LogLine } from '../../shared/types';
import { redact } from './log-redaction';

type Level = 'info' | 'error';
const limit = 256 * 1024;
function xmlText(text: string) {
  return text.replace(
    /<!\[CDATA\[([\s\S]*?)\]\]>|&(amp|lt|gt|quot|apos);/g,
    (_, cdata: string | undefined, entity: string) =>
      cdata ?? { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity] ?? '',
  );
}
// Mojang's client XML configuration writes framed Log4j events to stdout.
// Decode those without an XML/DTD evaluator, while preserving plain mod output.
export class GameLogDecoder {
  private buffer = '';
  constructor(
    private fallback: Level,
    private emit: (level: Level, text: string) => void,
  ) {}
  push(chunk: string) {
    this.buffer += chunk;
    while (this.buffer) {
      if (this.buffer.startsWith('<log4j:Event')) {
        const end = this.buffer.indexOf('</log4j:Event>');
        if (end < 0 && this.buffer.length <= limit) return;
        if (end >= 0 && end <= limit) {
          const event = this.buffer.slice(0, end + 14);
          this.buffer = this.buffer.slice(end + 14);
          const header = event.slice(0, event.indexOf('>'));
          const level = /\blevel="([^"]+)"/.exec(header)?.[1] ?? 'INFO';
          const thread = xmlText(/\bthread="([^"]+)"/.exec(header)?.[1] ?? 'main');
          const message = /<log4j:Message>([\s\S]*?)<\/log4j:Message>/.exec(event)?.[1];
          const thrown = /<log4j:Throwable>([\s\S]*?)<\/log4j:Throwable>/.exec(event)?.[1];
          if (message !== undefined || thrown !== undefined) {
            this.emit(
              ['ERROR', 'FATAL'].includes(level) ? 'error' : 'info',
              `[${thread}/${level}] ${xmlText(message ?? '')}${thrown ? '\n' + xmlText(thrown) : ''}`,
            );
            continue;
          }
          this.emit(this.fallback, event);
          continue;
        }
      }
      const newline = this.buffer.indexOf('\n');
      const firstLine = newline < 0 ? this.buffer : this.buffer.slice(0, newline);
      const start = firstLine.indexOf('<log4j:Event');
      const boundary = start > 0 ? start : newline + 1;
      if (boundary > 0) {
        this.plain(this.buffer.slice(0, boundary));
        this.buffer = this.buffer.slice(boundary);
      } else if (this.buffer.length > limit) {
        this.plain(this.buffer.slice(0, limit));
        this.buffer = this.buffer.slice(limit);
      } else return;
    }
  }
  end() {
    this.plain(this.buffer);
    this.buffer = '';
  }
  private plain(text: string) {
    const line = text.replace(/\r?\n$/, '');
    if (line.trim()) this.emit(this.fallback, line);
  }
}
// Each pipe keeps its own decoder. The two share one ordered append stream per game.
export class GameOutput {
  private done: Promise<void>;
  constructor(
    private pipes: { stdout: Readable; stderr: Readable },
    private disk: Writable,
    private instanceId: string,
    private token: string,
    private record: (lines: LogLine[]) => void,
  ) {
    const resume = () => {
      pipes.stdout.resume();
      pipes.stderr.resume();
    };
    disk.on('drain', resume);
    this.done = finished(disk, { readable: false, cleanup: true }).catch(() => {
      resume();
      record([this.line('error', '完整游戏日志写入失败，可在启动器查看最近日志')]);
    });
    this.read(pipes.stdout, 'info');
    this.read(pipes.stderr, 'error');
  }
  private line(level: Level, text: string): LogLine {
    return {
      instanceId: this.instanceId,
      time: Date.now(),
      level,
      text: redact(text, [this.token]),
    };
  }
  private publish(lines: LogLine[]) {
    if (!lines.length) return;
    this.record(lines);
    if (!this.disk.writable) return;
    const text = lines
      .map((line) => new Date(line.time).toISOString() + ' ' + line.text + '\n')
      .join('');
    if (!this.disk.write(text)) {
      this.pipes.stdout.pause();
      this.pipes.stderr.pause();
    }
  }
  private read(stream: Readable, level: Level) {
    let batch: LogLine[] = [];
    const decoder = new GameLogDecoder(level, (severity, text) =>
      batch.push(this.line(severity, text)),
    );
    const flush = () => {
      this.publish(batch);
      batch = [];
    };
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      decoder.push(chunk);
      flush();
    });
    stream.once('end', () => {
      decoder.end();
      flush();
    });
  }
  write(level: Level, text: string) {
    this.publish([this.line(level, text)]);
  }
  // Wait for the records already received when a running game exports its log.
  async flush() {
    if (this.disk.writable) {
      await new Promise<void>((resolve, reject) => {
        this.disk.write('', (error) => (error ? reject(error) : resolve()));
      });
    } else {
      await this.done;
      if (this.disk.errored) throw new Error('完整游戏日志写入失败');
    }
  }
  close() {
    this.disk.end();
    return this.done;
  }
}
