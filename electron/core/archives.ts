import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, readdir, mkdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { openPromise } from 'yauzl';
import { inside } from './files';
import type { Work } from './tasks';

const maxBytes = 64 * 1024 ** 3;
const maxEntries = 200_000;

// World data is streamed one file at a time; memory does not grow with region-file size.
async function worldFiles(source: string, ctx: Work) {
  const files: { path: string; relative: string; size: number; mtime: Date }[] = [];
  let total = 0;
  const collect = async (directory: string, prefix = '') => {
    if ((await lstat(directory)).isSymbolicLink()) throw new Error('存档含有符号链接');
    for (const name of await readdir(directory)) {
      ctx.signal.throwIfAborted();
      if (name === 'session.lock') continue;
      const file = path.join(directory, name),
        relative = prefix + name,
        info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error('存档含有符号链接');
      if (info.isDirectory()) await collect(file, relative + '/');
      else {
        if (!info.isFile()) throw new Error('存档含有不支持的文件类型');
        total += info.size;
        if (total > maxBytes || files.length >= maxEntries)
          throw new Error('存档超过 64 GiB 或 20 万文件');
        files.push({ path: file, relative, size: info.size, mtime: info.mtime });
      }
    }
  };
  await collect(source);
  return { files, total };
}

/** Compare current contents with an existing backup, including nested region and player files. */
export async function backupMatchesWorld(source: string, archive: string, ctx: Work) {
  const { files } = await worldFiles(source, ctx);
  const current = new Map(files.map((file) => [file.relative, file]));
  const zip = await openPromise(archive, { strictFileNames: true });
  try {
    if (zip.entryCount !== current.size) return false;
    for await (const entry of zip.eachEntry()) {
      ctx.signal.throwIfAborted();
      const file = current.get(entry.fileName);
      if (!file || file.size !== entry.uncompressedSize) return false;
      const saved = createHash('sha256'),
        live = createHash('sha256');
      for await (const chunk of await zip.openReadStreamPromise(entry)) {
        ctx.signal.throwIfAborted();
        saved.update(chunk);
      }
      for await (const chunk of createReadStream(file.path, { signal: ctx.signal }))
        live.update(chunk);
      if (!saved.digest().equals(live.digest())) return false;
      current.delete(entry.fileName);
    }
    return current.size === 0;
  } finally {
    zip.close();
  }
}

export async function archiveWorld(source: string, destination: string, ctx: Work) {
  const { files, total } = await worldFiles(source, ctx);
  ctx.signal.throwIfAborted();
  const zip = new ZipFile(),
    output = zip.outputStream as Readable;
  let active: Readable | undefined,
    done = 0;
  const result = pipeline(output, createWriteStream(destination, { flags: 'wx' }), {
    signal: ctx.signal,
  });
  // Attach immediately so an I/O failure while adding entries cannot become unhandled.
  void result.catch(() => {});
  zip.on('error', (error: Error) => output.destroy(error));
  const abort = () => {
    active?.destroy();
    output.destroy(new Error('备份已取消'));
  };
  ctx.signal.addEventListener('abort', abort, { once: true });
  try {
    for (const file of files) {
      zip.addReadStreamLazy(
        file.relative,
        { size: file.size, mtime: file.mtime, mode: 0o100644 },
        (cb) => {
          if (ctx.signal.aborted || output.destroyed) {
            cb(new Error('备份已取消'), undefined!);
            return;
          }
          active = createReadStream(file.path);
          active.once('end', () => {
            done += file.size;
            ctx.progress(Math.floor((done / Math.max(total, 1)) * 95), '压缩存档');
          });
          cb(null, active);
        },
      );
    }
    zip.end();
    await result;
  } catch (error) {
    active?.destroy();
    output.destroy();
    await result.catch(() => {});
    throw error;
  } finally {
    ctx.signal.removeEventListener('abort', abort);
  }
}

export async function restoreWorld(archive: string, destination: string, ctx: Work) {
  const zip = await openPromise(archive, { strictFileNames: true });
  let total = 0,
    count = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      ctx.signal.throwIfAborted();
      const dest = inside(destination, entry.fileName);
      total += entry.uncompressedSize;
      if (total > maxBytes || ++count > maxEntries) throw new Error('备份超过解压限制');
      if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
        throw new Error('备份含有符号链接');
      if (entry.fileName.endsWith('/')) {
        await mkdir(dest, { recursive: true });
        continue;
      }
      await mkdir(path.dirname(dest), { recursive: true });
      const input = await zip.openReadStreamPromise(entry);
      await pipeline(input, createWriteStream(dest, { flags: 'wx' }), { signal: ctx.signal });
      ctx.progress(Math.floor((count / Math.max(zip.entryCount, 1)) * 95), '恢复存档');
    }
  } finally {
    zip.close();
  }
}
