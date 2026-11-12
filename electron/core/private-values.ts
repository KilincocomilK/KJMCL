import { safeStorage } from 'electron';
import path from 'node:path';
import { readdir, readFile, lstat } from 'node:fs/promises';
// Values are used only inside the main process to redact diagnostic reports.
export async function privateValues(root: string) {
  const dir = path.join(root, 'credentials');
  const directory = await lstat(dir).catch((e) => {
    if (e.code === 'ENOENT') return undefined;
    throw e;
  });
  if (directory && (!directory.isDirectory() || directory.isSymbolicLink()))
    throw new Error('凭据目录异常，已停止诊断读取和导出');
  const files = await readdir(dir).catch((e) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  });
  const values: string[] = [];
  const collect = (v: unknown) => {
    const queue = [v];
    let count = 0;
    while (queue.length) {
      if (++count > 10000) throw new Error('凭据结构异常，已停止诊断导出');
      const value = queue.pop();
      if (typeof value === 'string' && value.length > 1) values.push(value);
      else if (value && typeof value === 'object') {
        const entries = Object.values(value);
        if (entries.length + queue.length > 10000) throw new Error('凭据结构异常，已停止诊断导出');
        queue.push(...entries);
      }
    }
  };
  if (files.length > 1000) throw new Error('凭据数量异常，已停止诊断导出');
  for (const file of files.filter((f) => /\.(bin|vault)$/.test(f))) {
    const p = path.join(dir, file),
      s = await lstat(p);
    if (!s.isFile() || s.isSymbolicLink() || s.size > 1024 ** 2)
      throw new Error('凭据文件异常，已停止诊断读取和导出');
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error('安全存储不可用，无法可靠遮蔽诊断信息');
    const text = safeStorage.decryptString(await readFile(p));
    values.push(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* plain encrypted token */
    }
    if (parsed !== undefined) collect(parsed);
  }
  return values;
}
