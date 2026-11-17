import path from 'node:path';
import os from 'node:os';
import { constants } from 'node:fs';
import { lstat, open, realpath, writeFile } from 'node:fs/promises';
import { Store } from './store';
import { assertOwned } from './instances';
import { checkGamePath } from './game-folders';
import { redact } from './log-redaction';
import { safeExport } from './safe-export';

// Export the persisted, decoded launcher log, independently of the UI's rolling buffer.
export async function exportCompleteLog(
  store: Store,
  id: string,
  destination: string,
  secrets: string[],
) {
  await assertOwned(store, id);
  const source = path.join(store.dir(id), 'logs', 'kjmcl.log');
  await checkGamePath(source).catch((e) => {
    if (e.code === 'ENOENT') throw new Error('暂无完整启动日志');
    throw e;
  });
  const before = await lstat(source);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('日志文件不可用');
  const handle = await open(
    source,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  let text: string;
  try {
    const info = await handle.stat();
    await checkGamePath(source);
    const current = await lstat(source);
    if (
      !info.isFile() ||
      current.isSymbolicLink() ||
      before.dev !== info.dev ||
      before.ino !== info.ino ||
      current.dev !== info.dev ||
      current.ino !== info.ino
    )
      throw new Error('日志文件已变化，请重试');
    if (info.size > 64 * 1024 ** 2) throw new Error('日志超过 64 MiB，请从日志目录取用');
    // Capture a bounded snapshot even if the running game continues appending.
    const buffer = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) throw new Error('日志读取期间发生变化，请重试');
      offset += bytesRead;
    }
    text = buffer
      .subarray(0, offset)
      .toString('utf8')
      .replace(
        /((?:password|api[_-]?key|client[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi,
        '$1[REDACTED]',
      )
      .replace(
        /(--(?:password|api-key|client-token|accessToken|refreshToken|clientSecret)(?:=|\s+))(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+)/gi,
        '$1[REDACTED]',
      );
    text = redact(
      text,
      [...secrets].sort((a, b) => b.length - a.length),
    ).replace(/\b[A-Z0-9._%+-]{1,128}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}\b/gi, '[EMAIL]');
    const paths = [
      [store.dir(id), '[INSTANCE]'],
      [store.root, '[DATA]'],
      [os.homedir(), '[HOME]'],
    ];
    const configured = process.env.KJMCL_DATA_DIR;
    if (configured && (await realpath(configured).catch(() => undefined)) === store.root) {
      const relative = path.relative(store.root, store.dir(id));
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative))
        paths.unshift([path.join(configured, relative), '[INSTANCE]']);
      paths.push([configured, '[DATA]']);
    }
    for (const [directory, label] of paths) {
      for (const variant of [
        directory,
        directory.replaceAll('\\', '/'),
        directory.replaceAll('\\', '\\\\'),
      ]) {
        text = text.replace(
          new RegExp(
            variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            process.platform === 'win32' ? 'gi' : 'g',
          ),
          label,
        );
      }
    }
    text = text.replace(/\b[A-Z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, '[HOME]');
  } finally {
    await handle.close();
  }
  await safeExport(destination, (temporary) => writeFile(temporary, text, { flag: 'wx' }));
}
