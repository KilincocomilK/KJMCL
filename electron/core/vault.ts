import { safeStorage } from 'electron';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { exists } from './files';
export interface Secrets {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  has(key: string): Promise<boolean>;
}
export class Vault implements Secrets {
  constructor(private root: string) {}
  private file(key: string) {
    if (!/^[\w-]+$/.test(key)) throw new Error('无效凭据标识');
    return path.join(this.root, 'credentials', key + '.vault');
  }
  private secure() {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error('请启用系统安全存储后使用账户与 API 凭据');
  }
  has(key: string) {
    return exists(this.file(key));
  }
  async get(key: string) {
    if (!(await this.has(key))) return undefined;
    this.secure();
    return safeStorage.decryptString(await readFile(this.file(key)));
  }
  async set(key: string, value: string) {
    const file = this.file(key);
    if (!value) {
      await rm(file, { force: true });
      return;
    }
    this.secure();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file + '.tmp', safeStorage.encryptString(value), { mode: 0o600 });
    await rename(file + '.tmp', file);
  }
}
