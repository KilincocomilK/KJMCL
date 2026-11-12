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
      const start = this.buffer.indexOf('<log4j:Event');
      if (start === 0) {
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
      const boundary =
        start > 0 && (newline < 0 || start < newline) ? start : newline >= 0 ? newline + 1 : -1;
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
