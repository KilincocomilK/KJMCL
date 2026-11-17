import path from 'node:path';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, lstat, open, writeFile, copyFile, unlink } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { z } from 'zod';
import type { SkinProject } from '../../shared/skin';
import type { SkinEditorEntry, SkinEditorImage, SkinEditorVersion } from '../../shared/types';
import { skinProjectSchema } from '../../shared/skin-schema';
import { skinPaletteFileSchema, type SkinPalette } from '../../shared/skin-palette';
import { compositeProject, resizePixels } from '../../shared/skin-pixels';
import { Store } from './store';
import { atomicJson } from './files';
import { checkGamePath } from './game-folders';
import { safeExport } from './safe-export';

const entrySchema = z.object({
  id: z.uuid(),
  name: z.string().max(80),
  model: z.enum(['classic', 'slim']),
  resolution: z.number(),
  modifiedAt: z.number(),
  thumbnail: z.string().max(100000).startsWith('data:image/png;base64,'),
});
const versionSchema = z
  .object({
    schemaVersion: z.literal(1),
    createdAt: z.number().int().positive(),
    project: skinProjectSchema,
  })
  .strict();
const versionFile = /^[a-f0-9-]{36}\.json$/;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function decodeSkinEditorImage(
  data: Buffer,
  name: string,
  mode: 'skin' | 'image' = 'skin',
): SkinEditorImage {
  if (
    data.length < 33 ||
    data.length > 8 * 1024 * 1024 ||
    !data.subarray(0, 8).equals(signature) ||
    data.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error('请选择有效的 PNG 图片');
  const width = data.readUInt32BE(16),
    height = data.readUInt32BE(20);
  if (
    mode === 'skin'
      ? ![64, 128, 256].includes(width) || ![width, width / 2].includes(height)
      : width < 1 || height < 1 || width > 2048 || height > 2048
  )
    throw new Error(
      mode === 'skin' ? '皮肤宽度需为 64、128 或 256 像素' : '参考图片不能超过 2048×2048',
    );
  let decoded: PNG;
  try {
    decoded = PNG.sync.read(data, { checkCRC: true });
  } catch {
    throw new Error('PNG 文件已损坏');
  }
  return {
    name: path.basename(name, path.extname(name)).slice(0, 80) || '未命名',
    width,
    height,
    pixels: decoded.data.toString('base64'),
  };
}
export function encodeSkinPng(project: SkinProject, format: 'png' | 'png64' | 'legacy' = 'png') {
  const checked = skinProjectSchema.parse(project);
  if (format === 'legacy' && checked.model !== 'classic') throw new Error('旧版皮肤仅支持经典模型');
  const width = format === 'png' ? checked.resolution : 64;
  let pixels = compositeProject(checked);
  if (width !== checked.resolution) pixels = resizePixels(pixels, checked.resolution, width);
  const height = format === 'legacy' ? 32 : width;
  const image = new PNG({ width, height });
  image.data = Buffer.from(pixels.subarray(0, width * height * 4));
  return PNG.sync.write(image);
}
async function readBounded(file: string, max = 32 * 1024 * 1024) {
  await checkGamePath(file);
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > max) throw new Error('文件过大或不可读取');
    const result = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < result.length) {
      const next = await handle.read(result, offset, result.length - offset, offset);
      if (!next.bytesRead) throw new Error('文件已变化，请重试');
      offset += next.bytesRead;
    }
    return result;
  } finally {
    await handle.close();
  }
}
export class SkinEditorStorage {
  private writes: Promise<unknown> = Promise.resolve();
  private writeErrors = new Map<string, unknown>();
  constructor(private store: Store) {}
  async flush(): Promise<void> {
    let pending: Promise<unknown>;
    do {
      pending = this.writes;
      await pending;
    } while (pending !== this.writes);
    const errors = [...this.writeErrors.values()];
    if (errors.length)
      throw new AggregateError(
        errors,
        '皮肤编辑器保存未完成：\n' +
          errors
            .map((error) => (error instanceof Error ? error.message : String(error)))
            .join('\n'),
      );
  }
  private async directory() {
    const dir = path.join(this.store.root, 'skin-editor');
    await checkGamePath(dir, true);
    await mkdir(dir, { recursive: true });
    await checkGamePath(dir);
    return dir;
  }
  private serial<T>(work: () => Promise<T>, target: string): Promise<T> {
    const next = this.writes.then(work);
    this.writes = next.then(
      () => {
        this.writeErrors.delete(target);
      },
      (error) => {
        this.writeErrors.set(target, error);
      },
    );
    return next;
  }
  private async saveJson(file: string, data: unknown) {
    await checkGamePath(file, true);
    await checkGamePath(file + '.tmp', true);
    await checkGamePath(file + '.bak', true);
    await copyFile(file, file + '.bak').catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
    await atomicJson(file, data);
  }
  async importImage(file: string, mode: 'skin' | 'image') {
    return decodeSkinEditorImage(await readBounded(file, 8 * 1024 * 1024), file, mode);
  }
  async importProject(file: string) {
    return skinProjectSchema.parse(JSON.parse((await readBounded(file)).toString('utf8')));
  }
  async importPalette(file: string): Promise<SkinPalette> {
    const { name, colors } = skinPaletteFileSchema.parse(
      JSON.parse((await readBounded(file, 32 * 1024)).toString('utf8')),
    );
    return { name, colors };
  }
  async exportPalette(palette: SkinPalette, destination: string) {
    const data = skinPaletteFileSchema.parse({ ...palette, schemaVersion: 1 });
    await checkGamePath(destination, true);
    await safeExport(destination, (temporary) =>
      writeFile(temporary, JSON.stringify(data, null, 2), { flag: 'wx' }),
    );
  }
  async draft() {
    await this.writes;
    const file = path.join(await this.directory(), 'draft.json');
    try {
      return await this.importProject(file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  async recoverDraft() {
    await this.writes;
    const file = path.join(await this.directory(), 'draft.json.bak');
    try {
      return await this.importProject(file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  saveDraft(project: SkinProject) {
    const checked = skinProjectSchema.parse(project);
    return this.serial(async () => {
      const dir = await this.directory(),
        file = path.join(dir, 'draft.json');
      let corrupt = false;
      try {
        await this.importProject(file);
      } catch (e) {
        if (e instanceof SyntaxError || e instanceof z.ZodError) corrupt = true;
        else if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      if (!corrupt) {
        await this.saveJson(file, checked);
        return;
      }
      const retained = path.join(dir, 'draft.corrupt-' + randomUUID() + '.json');
      await checkGamePath(file, true);
      await checkGamePath(file + '.tmp', true);
      await checkGamePath(retained, true);
      await copyFile(file, retained, constants.COPYFILE_EXCL);
      await atomicJson(file, checked);
    }, 'draft');
  }
  private async versionDirectory(id: string) {
    const dir = path.join(await this.directory(), 'versions', z.uuid().parse(id));
    await checkGamePath(dir, true);
    return dir;
  }
  private async readVersion(id: string, versionId: string) {
    const file = path.join(await this.versionDirectory(id), z.uuid().parse(versionId) + '.json');
    return versionSchema.parse(JSON.parse((await readBounded(file)).toString('utf8')));
  }
  private async versionEntries(id: string): Promise<SkinEditorVersion[]> {
    const dir = await this.versionDirectory(id);
    const names = await readdir(dir).catch((e) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    });
    const entries: SkinEditorVersion[] = [];
    for (const file of names.filter((name) => versionFile.test(name))) {
      const versionId = file.slice(0, -5),
        value = await this.readVersion(id, versionId);
      entries.push({
        versionId,
        createdAt: value.createdAt,
        name: value.project.name,
        model: value.project.model,
        resolution: value.project.resolution,
      });
    }
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }
  async versions(id: string) {
    await this.writes;
    return this.versionEntries(id);
  }
  async restoreVersion(id: string, versionId: string) {
    await this.writes;
    return (await this.readVersion(id, versionId)).project;
  }
  private async snapshot(id: string, project: SkinProject) {
    const entries = await this.versionEntries(id),
      dir = await this.versionDirectory(id);
    const file = path.join(dir, randomUUID() + '.json');
    await mkdir(dir, { recursive: true });
    await checkGamePath(file, true);
    await checkGamePath(file + '.tmp', true);
    await atomicJson(file, {
      schemaVersion: 1,
      createdAt: Math.max(Date.now(), (entries[0]?.createdAt ?? 0) + 1),
      project,
    });
    for (const entry of entries.slice(19)) {
      const expired = path.join(dir, z.uuid().parse(entry.versionId) + '.json');
      await checkGamePath(expired);
      await unlink(expired);
    }
  }
  async list(): Promise<SkinEditorEntry[]> {
    await this.writes;
    const dir = await this.directory();
    const entries: SkinEditorEntry[] = [];
    for (const name of (await readdir(dir))
      .filter((name) => /^[a-f0-9-]{36}\.meta\.json$/.test(name))
      .slice(0, 200)) {
      const entry = entrySchema.parse(
        JSON.parse((await readBounded(path.join(dir, name), 128 * 1024)).toString('utf8')),
      );
      if (name !== entry.id + '.meta.json') throw new Error('作品索引不匹配');
      entries.push(entry);
    }
    return entries.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }
  async open(id: string) {
    await this.writes;
    return this.importProject(path.join(await this.directory(), z.uuid().parse(id) + '.kjskin'));
  }
  save(value: { id?: string; project: SkinProject }) {
    const project = skinProjectSchema.parse(value.project),
      id = value.id ? z.uuid().parse(value.id) : randomUUID();
    return this.serial(
      async () => {
        const dir = await this.directory();
        if (!value.id && (await readdir(dir)).filter((f) => f.endsWith('.kjskin')).length >= 200)
          throw new Error('作品库已满，请先导出或移除部分作品');
        if (value.id) {
          const previous = await this.importProject(path.join(dir, id + '.kjskin'));
          await this.snapshot(id, previous);
        }
        await this.saveJson(path.join(dir, id + '.kjskin'), project);
        await this.saveJson(path.join(dir, id + '.meta.json'), {
          id,
          name: project.name,
          model: project.model,
          resolution: project.resolution,
          modifiedAt: Date.now(),
          thumbnail: 'data:image/png;base64,' + encodeSkinPng(project, 'png64').toString('base64'),
        });
        return id;
      },
      value.id ? 'project:' + id : 'new-project',
    );
  }
  async remove(id: string, trash: (file: string) => Promise<void>) {
    return this.serial(async () => {
      const dir = await this.directory();
      z.uuid().parse(id);
      const files: string[] = [];
      for (const ext of ['.kjskin', '.kjskin.bak', '.meta.json', '.meta.json.bak']) {
        const file = path.join(dir, id + ext);
        await checkGamePath(file, true);
        if (
          await lstat(file).then(
            () => true,
            (e) => {
              if (e.code === 'ENOENT') return false;
              throw e;
            },
          )
        )
          files.push(file);
      }
      const versions = await this.versionDirectory(id);
      const children = await readdir(versions).catch((e) => {
        if (e.code === 'ENOENT') return null;
        throw e;
      });
      if (children) {
        for (const child of children) {
          const file = path.join(versions, child);
          await checkGamePath(file);
          if (!(await lstat(file)).isFile() || !/^[a-f0-9-]{36}\.json(?:\.tmp)?$/.test(child))
            throw new Error('快照目录包含未知文件');
        }
        files.push(versions);
      }
      for (const file of files) await trash(file);
    }, 'project:' + id);
  }
  async export(
    project: SkinProject,
    format: 'png' | 'png64' | 'legacy' | 'project',
    destination: string,
  ) {
    const checked = skinProjectSchema.parse(project);
    const bytes =
      format === 'project' ? Buffer.from(JSON.stringify(checked)) : encodeSkinPng(checked, format);
    await checkGamePath(destination, true);
    await safeExport(destination, (temporary) => writeFile(temporary, bytes, { flag: 'wx' }));
  }
  async exportCapture(dataUrl: string, destination: string) {
    if (
      !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl) ||
      dataUrl.length > 24 * 1024 * 1024
    )
      throw new Error('截图数据无效');
    const data = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
    const image = decodeSkinEditorImage(data, '预览', 'image');
    const png = new PNG({ width: image.width, height: image.height });
    png.data = Buffer.from(image.pixels, 'base64');
    const bytes = PNG.sync.write(png);
    await checkGamePath(destination, true);
    await safeExport(destination, (temporary) => writeFile(temporary, bytes, { flag: 'wx' }));
  }
}
