import path from 'node:path';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import AdmZip from 'adm-zip';
export async function exists(p: string) {
  return stat(p).then(
    () => true,
    () => false,
  );
}
export function inside(root: string, entry: string) {
  if (
    !entry ||
    entry.includes('\\') ||
    entry.includes(':') ||
    entry.includes('\0') ||
    path.posix.isAbsolute(entry) ||
    entry.split('/').includes('..')
  )
    throw new Error('不安全的文件路径');
  const full = path.resolve(root, entry);
  const relative = path.relative(path.resolve(root), full);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('文件路径越界');
  return full;
}
export async function json<T>(p: string): Promise<T> {
  return JSON.parse(await readFile(p, 'utf8'));
}
export async function atomicJson(p: string, value: unknown) {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p + '.tmp', JSON.stringify(value, null, 2));
  await rename(p + '.tmp', p);
}
export async function hashFile(p: string, algorithm = 'sha1') {
  const h = createHash(algorithm);
  for await (const chunk of createReadStream(p)) h.update(chunk);
  return h.digest('hex');
}
export function offlineUuid(name: string) {
  const b = createHash('md5')
    .update('OfflinePlayer:' + name)
    .digest();
  b[6] = (b[6] & 15) | 48;
  b[8] = (b[8] & 63) | 128;
  return b.toString('hex');
}
export async function extractZip(
  file: string,
  target: string,
  filter: (name: string) => boolean = () => true,
) {
  const zip = new AdmZip(file);
  let total = 0;
  for (const entry of zip.getEntries()) {
    if (!filter(entry.entryName)) continue;
    const p = inside(target, entry.entryName);
    total += entry.header.size;
    if (total > 8 * 1024 ** 3) throw new Error('解压大小超过 8 GiB');
    if (((entry.attr >>> 16) & 0xf000) === 0xa000) throw new Error('不允许压缩包中的符号链接');
    if (entry.isDirectory) {
      await mkdir(p, { recursive: true });
      continue;
    }
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, entry.getData());
  }
}
