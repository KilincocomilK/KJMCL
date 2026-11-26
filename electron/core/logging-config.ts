import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, opendir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { checkGamePath } from './game-folders';
import type { Version } from './minecraft';
import type { Network } from './network';
import type { Store } from './store';

const maxBytes = 1024 * 1024;
const objectHosts = new Set([
  'piston-data.mojang.com',
  'launcher.mojang.com',
  'launchermeta.mojang.com',
  'bmclapi2.bangbang93.com',
]);
type LoggingFile = NonNullable<Version['logging']>['client']['file'];

async function matchingFile(file: string, expected: LoggingFile, signal: AbortSignal) {
  signal.throwIfAborted();
  const info = await lstat(file).catch(() => undefined);
  if (
    !info?.isFile() ||
    info.size > maxBytes ||
    (expected.size !== undefined && info.size !== expected.size)
  )
    return;
  await checkGamePath(file);
  const bytes = await readFile(file, { signal });
  if (createHash('sha1').update(bytes).digest('hex') === expected.sha1) return bytes;
}

async function* localCandidates(store: Store, id: string, name: string, sha1: string) {
  yield path.join(store.root, 'cache', 'log-configs', sha1 + '.xml');
  // Only inspect the active runtime and game roots explicitly registered in this launcher.
  const roots = new Set([
    store.runtime(id),
    store.root,
    ...store.data.gameFolders.map((f) => f.path),
  ]);
  for (const root of roots) {
    const folder = path.join(root, 'assets', 'log_configs');
    yield path.join(folder, name);
    yield path.join(root, 'assets', 'objects', sha1.slice(0, 2), sha1);
    try {
      await checkGamePath(folder);
      const dir = await opendir(folder);
      let inspected = 0;
      for await (const entry of dir) {
        if (++inspected > 64) break;
        if (entry.isFile() && /\.xml$/i.test(entry.name)) yield path.join(folder, entry.name);
      }
    } catch {
      /* Another registered game folder may be offline or have no logging cache. */
    }
  }
}

export async function resolveLoggingFile(
  store: Store,
  net: Network,
  id: string,
  f: LoggingFile,
  signal: AbortSignal,
) {
  if (
    !f ||
    typeof f.id !== 'string' ||
    !/^[^/\\:*?"<>|\x00-\x1f]+\.xml$/i.test(f.id) ||
    f.id.length > 240 ||
    typeof f.sha1 !== 'string' ||
    !/^[a-f\d]{40}$/i.test(f.sha1) ||
    (f.size !== undefined && (!Number.isSafeInteger(f.size) || f.size <= 0 || f.size > maxBytes))
  )
    throw new Error('日志配置元数据无效，请在原启动器修复版本');
  const expected = { ...f, sha1: f.sha1.toLowerCase() };
  const original = path.join(store.runtime(id), 'assets', 'log_configs', f.id);
  // An imported launcher may use a read-only disk. Keep replacement downloads in KJMCL.
  const dest = store.instance(id).external
    ? path.join(store.root, 'cache', 'log-configs', expected.sha1 + '.xml')
    : original;
  await checkGamePath(original, true);
  await checkGamePath(dest, true);
  if (await matchingFile(original, expected, signal)) return original;
  if (dest !== original && (await matchingFile(dest, expected, signal))) return dest;
  const tried = new Set([original, dest]);
  for await (const file of localCandidates(store, id, f.id, expected.sha1)) {
    signal.throwIfAborted();
    if (tried.has(file)) continue;
    tried.add(file);
    const bytes = await matchingFile(file, expected, signal).catch(() => undefined);
    signal.throwIfAborted();
    if (!bytes) continue;
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = dest + '.' + randomUUID() + '.part';
    try {
      await writeFile(tmp, bytes, { flag: 'wx', signal });
      signal.throwIfAborted();
      await rename(tmp, dest);
    } finally {
      await rm(tmp, { force: true });
    }
    return dest;
  }
  const source = new URL(f.url);
  if (source.protocol !== 'https:' || source.username || source.password)
    throw new Error('日志配置需要有效的 HTTPS 下载地址');
  let url = source.href;
  let fallbackUrls: string[] | undefined;
  if (objectHosts.has(source.hostname) && !source.port) {
    const object = '/v1/objects/' + expected.sha1 + '/' + encodeURIComponent(f.id);
    // Imported version JSON can contain a pre-rewritten mirror URL. Honor the user's
    // download-source preference, then try the two official object hosts using the same hash.
    url = 'https://piston-data.mojang.com' + object;
    fallbackUrls = [url, 'https://launcher.mojang.com' + object];
    if (source.hostname !== 'bmclapi2.bangbang93.com') fallbackUrls.push(source.href);
  }
  await net.download(url, dest, {
    signal,
    hash: expected.sha1,
    size: expected.size,
    maxBytes,
    timeoutMs: 15000,
    fallbackUrls,
  });
  return dest;
}
