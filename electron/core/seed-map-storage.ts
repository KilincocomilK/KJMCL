import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, copyFile, writeFile, rename } from 'node:fs/promises';
import { PNG } from 'pngjs';
import {
  seedMapStateSchema,
  seedMapProjectSchema,
  seedMapMarkerFileSchema,
  seedMapDocumentSchema,
  emptySeedMapState,
  type SeedMapState,
  type SeedMapDocument,
} from '../../shared/seed-map';
import type { Store } from './store';
import { checkGamePath } from './game-folders';
import { safeExport } from './safe-export';
const MAX_JSON = 16 * 1024 * 1024;
type PendingSave = {
  bytes: Buffer;
  waiters: { resolve: () => void; reject: (error: unknown) => void }[];
};
async function readBounded(file: string, max = MAX_JSON): Promise<Buffer> {
  await checkGamePath(file);
  const handle = await open(file, constants.O_RDONLY);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > max) throw new Error('地图文件过大');
    const data = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
      if (!bytesRead) throw new Error('地图文件读取不完整');
      offset += bytesRead;
    }
    return data;
  } finally {
    await handle.close();
  }
}
export class SeedMapStorage {
  private writes: Promise<void> = Promise.resolve();
  private pending?: PendingSave;
  private draining = false;
  private failure?: unknown;
  constructor(private store: Pick<Store, 'root'>) {}
  async flush() {
    let pending;
    do {
      pending = this.writes;
      await pending;
    } while (pending !== this.writes);
    if (this.failure) throw this.failure;
  }
  private async file() {
    const dir = path.join(this.store.root, 'seed-map');
    await checkGamePath(dir, true);
    await mkdir(dir, { recursive: true });
    await checkGamePath(dir);
    return path.join(dir, 'workspace.json');
  }
  private async read(file: string) {
    return seedMapStateSchema.parse(JSON.parse((await readBounded(file)).toString('utf8')));
  }
  async state(): Promise<SeedMapState> {
    await this.writes;
    try {
      return await this.read(await this.file());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptySeedMapState();
      throw error;
    }
  }
  async recover(): Promise<SeedMapState | null> {
    await this.writes;
    try {
      return await this.read((await this.file()) + '.bak');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  save(value: SeedMapState): Promise<void> {
    const checked = seedMapStateSchema.parse(value);
    const bytes = Buffer.from(JSON.stringify(checked, null, 2), 'utf8');
    if (bytes.length > MAX_JSON) throw new Error('地图记录过大，请先导出部分收藏');
    const result = new Promise<void>((resolve, reject) => {
      if (this.pending) {
        this.pending.bytes = bytes;
        this.pending.waiters.push({ resolve, reject });
      } else this.pending = { bytes, waiters: [{ resolve, reject }] };
    });
    if (!this.draining) {
      this.draining = true;
      this.writes = this.drain();
    }
    return result;
  }
  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        const batch = this.pending;
        this.pending = undefined;
        try {
          await this.persist(batch.bytes);
          this.failure = undefined;
          for (const waiter of batch.waiters) waiter.resolve();
        } catch (error) {
          this.failure = error;
          for (const waiter of batch.waiters) waiter.reject(error);
        }
      }
    } finally {
      this.draining = false;
    }
  }
  private async persist(bytes: Buffer): Promise<void> {
    const file = await this.file();
    await checkGamePath(file, true);
    await checkGamePath(file + '.bak', true);
    await checkGamePath(file + '.tmp', true);
    let previous = false;
    try {
      await this.read(file);
      previous = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      } else if (error instanceof SyntaxError || (error as { name?: string }).name === 'ZodError') {
        const archive = path.join(
          path.dirname(file),
          'workspace.corrupt-' + randomUUID() + '.json',
        );
        await copyFile(file, archive, constants.COPYFILE_EXCL);
      } else throw error;
    }
    if (previous) await copyFile(file, file + '.bak');
    await writeFile(file + '.tmp', bytes);
    await rename(file + '.tmp', file);
  }
  async importProject(file: string) {
    return seedMapProjectSchema.parse(JSON.parse((await readBounded(file)).toString('utf8'))).map;
  }
  async importMarkers(file: string) {
    const { seed, version, markers } = seedMapMarkerFileSchema.parse(
      JSON.parse((await readBounded(file)).toString('utf8')),
    );
    return { seed, version, markers };
  }
  async export(
    map: SeedMapDocument,
    format: 'project' | 'markers' | 'png',
    destination: string,
    image?: string,
  ) {
    const checked = seedMapDocumentSchema.parse(map);
    await checkGamePath(destination, true);
    let bytes: Buffer;
    if (format === 'png') {
      if (
        !image ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image) ||
        image.length > 32 * 1024 * 1024
      )
        throw new Error('地图截图无效');
      const data = Buffer.from(image.slice(22), 'base64');
      if (
        data.length < 33 ||
        !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        data.toString('ascii', 12, 16) !== 'IHDR'
      )
        throw new Error('地图截图格式无效');
      const width = data.readUInt32BE(16),
        height = data.readUInt32BE(20);
      if (!width || !height || width > 8192 || height > 8192 || width * height > 16_777_216)
        throw new Error('地图截图尺寸过大');
      bytes = PNG.sync.write(PNG.sync.read(data, { checkCRC: true }));
    } else {
      const value =
        format === 'project'
          ? { schemaVersion: 1, map: checked }
          : {
              schemaVersion: 1,
              seed: checked.seed,
              version: checked.version,
              markers: checked.markers,
            };
      bytes = Buffer.from(JSON.stringify(value, null, 2));
      if (bytes.length > MAX_JSON) throw new Error('地图文件过大');
    }
    await safeExport(destination, (temporary) => writeFile(temporary, bytes, { flag: 'wx' }));
  }
}
