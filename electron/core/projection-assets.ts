import path from 'node:path';
import { mkdir, readFile, stat, rename, writeFile, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { openPromise, type Entry } from 'yauzl';
import { PNG } from 'pngjs';
import { z } from 'zod';
import type { ProjectionAssets, ProjectionAssetsRequest } from '../../shared/projection-assets';
import { projectionAssetsSchema } from '../../shared/projection-assets';
import type { Store } from './store';
import type { Network } from './network';
import { atomicJson, exists, hashFile, inside } from './files';
import { checkGamePath } from './game-folders';

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const sha1 = z.string().regex(/^[a-f0-9]{40}$/);
const officialUrl = z
  .string()
  .url()
  .refine((s) => {
    const u = new URL(s);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      [
        'piston-meta.mojang.com',
        'piston-data.mojang.com',
        'launcher.mojang.com',
        'launchermeta.mojang.com',
      ].includes(u.hostname)
    );
  });
const manifestSchema = z.object({
  latest: z.object({ release: z.string().max(80) }),
  versions: z
    .array(z.object({ id: z.string().max(80), type: z.string(), url: officialUrl, sha1 }))
    .max(10000),
});
const metadataSchema = z.object({
  id: z.string().max(80),
  downloads: z.object({
    client: z.object({
      url: officialUrl,
      sha1,
      size: z
        .number()
        .int()
        .positive()
        .max(256 * 1024 ** 2),
    }),
  }),
});
const resourceId = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const qualify = (id: string) => (id.includes(':') ? id : 'minecraft:' + id);
const records = <T>() => Object.create(null) as Record<string, T>;
const specialTexture =
  /^minecraft:entity\/(chest|bed|banner|shield|shulker|signs|decorated_pot|conduit|bell|copper_golem|enchanting_table_book|end_portal|end_gateway|skeleton|wither_skeleton|zombie|creeper|enderdragon|piglin)(\/|$)/;

function safeJson(bytes: Buffer): any {
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  let count = 0;
  const visit = (v: unknown, depth: number) => {
    if (++count > 200000 || depth > 48) throw new Error('原版模型结构过于复杂');
    if (v && typeof v === 'object')
      for (const [key, child] of Object.entries(v)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key))
          throw new Error('无效的模型属性');
        visit(child, depth + 1);
      }
  };
  visit(value, 0);
  return value;
}

/** Reads a verified client archive without extracting filesystem paths. */
export async function readProjectionAssets(
  file: string,
  blocks: string[],
  version: string,
  source: ProjectionAssets['source'],
): Promise<ProjectionAssets> {
  const zip = await openPromise(file, { strictFileNames: true, autoClose: false });
  const entries = new Map<string, Entry>();
  let entryCount = 0,
    archiveBytes = 0,
    readBytes = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      inside(path.dirname(file), entry.fileName);
      if (++entryCount > 150000 || (archiveBytes += entry.uncompressedSize) > 1024 ** 3)
        throw new Error('原版资源包过大');
      if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
        throw new Error('原版资源包包含符号链接');
      if (/^assets\/minecraft\/(blockstates|models|textures)\//.test(entry.fileName)) {
        if (entries.has(entry.fileName)) throw new Error('原版资源包包含重复文件');
        entries.set(entry.fileName, entry);
      }
    }
    const read = async (name: string): Promise<Buffer | undefined> => {
      const entry = entries.get(name);
      if (!entry) return undefined;
      const limit = name.endsWith('.png') ? 4 * 1024 ** 2 : 1024 ** 2;
      if (entry.uncompressedSize > limit) throw new Error('原版模型或贴图过大');
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of await zip.openReadStreamPromise(entry)) {
        bytes += chunk.length;
        readBytes += chunk.length;
        if (bytes > limit || readBytes > 48 * 1024 ** 2) throw new Error('原版资源读取量过大');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    };
    const assetPath = (id: string, kind: string, suffix: string) => {
      if (
        !resourceId.test(id) ||
        id
          .split(':')[1]
          .split('/')
          .some((part) => part === '..' || part === '.')
      )
        throw new Error('无效的模型引用');
      const [namespace, resource] = id.split(':');
      return `assets/${namespace}/${kind}/${resource}${suffix}`;
    };
    const result: ProjectionAssets = {
      version,
      source,
      blockstates: records(),
      models: records(),
      textures: records(),
      animations: records(),
      missing: [],
    };
    const textureIds = new Set<string>(
      ['water_still', 'water_flow', 'lava_still', 'lava_flow'].map((n) => 'minecraft:block/' + n),
    );
    const visiting = new Set<string>();
    const model = async (id: string, depth = 0) => {
      id = qualify(id);
      if (id === 'minecraft:builtin/generated' || id === 'minecraft:builtin/entity') return;
      if (visiting.has(id) || depth > 48) throw new Error('原版模型引用形成循环');
      if (Object.hasOwn(result.models, id)) return;
      const raw = await read(assetPath(id, 'models', '.json'));
      if (!raw) return;
      const json = safeJson(raw);
      result.models[id] = json;
      visiting.add(id);
      if (typeof json.parent === 'string') await model(json.parent, depth + 1);
      for (const value of Object.values(json.textures ?? {})) {
        const texture = typeof value === 'string' ? value : (value as { sprite?: unknown })?.sprite;
        if (typeof texture === 'string' && !texture.startsWith('#'))
          textureIds.add(qualify(texture));
      }
      for (const element of json.elements ?? [])
        for (const face of Object.values(element.faces ?? {})) {
          const texture = (face as { texture?: unknown })?.texture;
          if (typeof texture === 'string' && !texture.startsWith('#'))
            textureIds.add(qualify(texture));
        }
      visiting.delete(id);
    };
    for (const id of [...new Set(blocks)]) {
      const raw = await read(assetPath(id, 'blockstates', '.json'));
      if (!raw) {
        if (!/^minecraft:(air|cave_air|void_air|water|lava)$/.test(id)) result.missing.push(id);
        continue;
      }
      const json = safeJson(raw);
      result.blockstates[id] = json;
      const variants: unknown[] = [
        ...Object.values(json.variants ?? {}),
        ...(json.multipart ?? []).map((x: any) => x.apply),
      ];
      for (const variant of variants.flat())
        if (typeof (variant as any)?.model === 'string') await model((variant as any).model);
    }
    // Deepslate's block-entity renderers share these original, full-size atlases.
    for (const name of entries.keys()) {
      const match = /^assets\/minecraft\/textures\/(.+)\.png$/.exec(name);
      if (match && specialTexture.test('minecraft:' + match[1]))
        textureIds.add('minecraft:' + match[1]);
    }
    let pixelCount = 0;
    for (const id of textureIds) {
      const name = assetPath(id, 'textures', '.png');
      const bytes = await read(name);
      if (!bytes) continue;
      if (
        bytes.length < 33 ||
        !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error('原版贴图不是 PNG');
      const width = bytes.readUInt32BE(16),
        height = bytes.readUInt32BE(20);
      if (
        !width ||
        !height ||
        width > 4096 ||
        height > 65536 ||
        width * height > 4 * 1024 ** 2 ||
        (pixelCount += width * height) > 32 * 1024 ** 2
      )
        throw new Error('原版贴图尺寸过大');
      PNG.sync.read(bytes, { checkCRC: true });
      result.textures[id] = bytes.toString('base64');
      const meta = await read(name + '.mcmeta');
      if (meta) result.animations[id] = safeJson(meta);
    }
    return result;
  } finally {
    zip.close();
  }
}

export class ProjectionAssetService {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private abort?: AbortController;
  private closing = false;
  private cached = new Map<string, ProjectionAssets>();
  constructor(
    private store: Pick<Store, 'root' | 'data' | 'dir'>,
    private net: Pick<Network, 'response' | 'download'>,
  ) {}
  flush() {
    return this.tail;
  }
  cancel() {
    this.closing = true;
    this.abort?.abort();
  }
  load(request: ProjectionAssetsRequest): Promise<ProjectionAssets> {
    request = projectionAssetsSchema.parse(request);
    if (this.closing) return Promise.reject(new Error('启动器正在退出'));
    if (this.pending >= 8) return Promise.reject(new Error('贴图正在准备，请稍候'));
    this.pending++;
    const result = this.tail.then(() => {
      if (this.closing) throw new Error('启动器正在退出');
      this.abort = new AbortController();
      return this.loadNow(request);
    });
    this.tail = result
      .catch(() => {})
      .finally(() => {
        this.pending--;
      });
    return result;
  }
  private async responseBytes(url: string, signal: AbortSignal, mirror = false) {
    const response = await this.net.response(url, { signal }, mirror);
    if (!response.ok || !response.body) throw new Error('无法获取原版资源索引');
    const parts: Uint8Array[] = [];
    let count = 0;
    for await (const chunk of response.body) {
      if ((count += chunk.length) > 8 * 1024 ** 2) throw new Error('原版资源索引过大');
      parts.push(chunk);
    }
    return Buffer.concat(parts);
  }
  private async loadNow(request: ProjectionAssetsRequest): Promise<ProjectionAssets> {
    const root = path.join(this.store.root, 'projection-workshop', 'assets');
    await checkGamePath(root, true);
    await mkdir(root, { recursive: true });
    await checkGamePath(root);
    const manifestFile = path.join(root, 'manifest-v1.json');
    let manifest: z.infer<typeof manifestSchema> | undefined;
    if (await exists(manifestFile)) {
      await checkGamePath(manifestFile);
      try {
        if ((await stat(manifestFile)).size > 8 * 1024 ** 2) throw new Error('原版资源索引过大');
        const cache = z
          .object({ schema: z.literal(1), manifest: manifestSchema })
          .parse(JSON.parse(await readFile(manifestFile, 'utf8')));
        manifest = cache.manifest;
      } catch {
        // This is disposable downloaded metadata, never a user's projection or state.
        await rename(manifestFile, manifestFile + '.damaged-' + randomUUID());
      }
    }
    if (!manifest) {
      const bytes = await this.responseBytes(MANIFEST, this.abort!.signal);
      manifest = manifestSchema.parse(JSON.parse(bytes.toString('utf8')));
      await checkGamePath(manifestFile + '.tmp', true);
      await atomicJson(manifestFile, { schema: 1, manifest });
    }
    const version = request.version ?? manifest.latest.release;
    const release = manifest.versions.find((v) => v.id === version && v.type === 'release');
    if (!release) throw new Error('未找到该正式版的原版贴图');
    const key = createHash('sha256')
      .update(version + '\0' + [...new Set(request.blocks)].sort().join('\0'))
      .digest('hex');
    if (this.cached.has(key)) return this.cached.get(key)!;
    const signal = AbortSignal.any([AbortSignal.timeout(5 * 60 * 1000), this.abort!.signal]);
    const metadataFile = path.join(root, release.sha1 + '.json');
    await checkGamePath(metadataFile, true);
    const verifiedMetadata =
      (await exists(metadataFile)) &&
      (await stat(metadataFile)).size <= 8 * 1024 ** 2 &&
      (await hashFile(metadataFile)) === release.sha1;
    if (!verifiedMetadata) {
      const bytes = await this.responseBytes(release.url, signal, true);
      if (createHash('sha1').update(bytes).digest('hex') !== release.sha1)
        throw new Error('原版版本索引校验失败');
      const temporary = metadataFile + '.' + randomUUID() + '.part';
      try {
        await writeFile(temporary, bytes, { flag: 'wx' });
        await rename(temporary, metadataFile);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    const metadata = metadataSchema.parse(JSON.parse(await readFile(metadataFile, 'utf8')));
    if (metadata.id !== version) throw new Error('原版版本索引不匹配');
    const client = metadata.downloads.client;
    let jar = path.join(root, client.sha1 + '.jar'),
      source: ProjectionAssets['source'] = 'official';
    for (const instance of this.store.data.instances.filter((i) => i.version === version)) {
      const candidate = path.join(this.store.dir(instance.id), 'client.jar');
      try {
        await checkGamePath(candidate);
        if (
          (await stat(candidate)).size === client.size &&
          (await hashFile(candidate)) === client.sha1
        ) {
          jar = candidate;
          source = 'local';
          break;
        }
      } catch {
        /* A missing or modified local client must not supply original assets. */
      }
    }
    await checkGamePath(jar, true);
    if (source === 'official')
      await this.net.download(client.url, jar, { signal, hash: client.sha1, size: client.size });
    if ((await stat(jar)).size !== client.size || (await hashFile(jar)) !== client.sha1)
      throw new Error('原版贴图文件校验失败');
    const result = await readProjectionAssets(jar, request.blocks, version, source);
    this.cached.set(key, result);
    while (this.cached.size > 2) this.cached.delete(this.cached.keys().next().value!);
    return result;
  }
}
