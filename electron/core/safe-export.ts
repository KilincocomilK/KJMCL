import path from 'node:path';
import { constants } from 'node:fs';
import { mkdtemp, link, copyFile, rm } from 'node:fs/promises';
// Stage adjacent to the destination and publish without replacing any existing file.
export async function safeExport(destination: string, write: (temporary: string) => Promise<void>) {
  const stage = await mkdtemp(path.join(path.dirname(destination), '.kjmcl-export-'));
  const temporary = path.join(stage, 'payload');
  try {
    await write(temporary);
    try {
      await link(temporary, destination);
    } catch (e: any) {
      if (!['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS'].includes(e.code)) throw e;
      await copyFile(temporary, destination, constants.COPYFILE_EXCL);
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
