import os from 'node:os';
import { open } from 'node:fs/promises';
import { schematicPreview } from './resource-preview';
import { catalogQuery } from '../../shared/search';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { z } from 'zod';
import {
  redenKey,
  validAxis,
  type RedenAxis,
  type RedenDetails,
  type RedenFile,
  type RedenHit,
  type RedenPreviewData,
} from '../../shared/reden';
import type { Network } from './network';
import type { Work } from './tasks';
import { MAX_RESOURCE_BYTES, type Resources } from './resources';
import type { ProjectionWorkshop } from './projection-workshop';

const site = 'https://redenmc.com';
const catalog = site + '/api/mc-services/yisibite/';
const maxPreviewBytes = 64 * 1024 ** 2;
const fileOrigins = [site, 'https://static.redenmc.com', 'https://api.redenmc.com'];
export function redenDownload(file: RedenFile) {
  const url = catalog + encodeURIComponent(redenKey.parse(file.key));
  if (file.kind === 'attachment') return url + '/download/' + file.index;
  return (
    url +
    '?' +
    new URLSearchParams({
      xSize: String(file.sizes[0]),
      ySize: String(file.sizes[1]),
      zSize: String(file.sizes[2]),
    })
  );
}
const item = z.object({
  key: redenKey,
  name: z.string(),
  type: z.string(),
  author: z.object({ username: z.string().nullish() }).nullish(),
  downloads: z.number().nullish(),
  versions: z.array(z.string()).nullish(),
});
const detail = item.extend({
  attachments: z
    .array(
      z.object({
        name: z.string(),
        size: z.int().nonnegative(),
        sha256: z
          .string()
          .regex(/^[a-f\d]{64}$/i)
          .nullish(),
      }),
    )
    .max(512)
    .nullish(),
  hasX: z.boolean().nullish(),
  hasY: z.boolean().nullish(),
  hasZ: z.boolean().nullish(),
  conditions: z.record(z.string(), z.array(z.string())).nullish(),
});
export const redenPage = (key: string) =>
  site + '/zh_cn/litematica/' + encodeURIComponent(redenKey.parse(key));

function axisDefinition(axis: RedenAxis['axis'], conditions: string[]): RedenAxis {
  const result: RedenAxis = { axis, min: 1, max: 65536, modulo: [] };
  for (const condition of conditions) {
    const match = /^(min|max|mod)\(\s*(-?\d+)\s*(?:,\s*(-?\d+)\s*)?\)$/.exec(condition);
    if (!match) throw new Error('此生成器需要在发布页设置尺寸');
    const n = Number(match[2]);
    if (match[1] === 'min') result.min = Math.max(result.min, n);
    else if (match[1] === 'max') result.max = Math.min(result.max, n);
    else if (n > 0 && match[3] !== undefined) result.modulo.push([n, Number(match[3])]);
    else throw new Error('生成器尺寸条件无效');
  }
  return result;
}

export class Reden {
  constructor(
    private net: Network,
    private workshop: ProjectionWorkshop,
    private resources: Resources,
  ) {}
  async search(query: string, page: number) {
    const result = await this.searchPage(query, page);
    const alternate = catalogQuery(query);
    return !result.items.length && alternate && alternate !== query
      ? this.searchPage(alternate, page)
      : result;
  }
  private async searchPage(query: string, page: number) {
    const url = new URL(query ? site + '/api/mc-services/litematica/search' : catalog);
    url.search = new URLSearchParams({
      lang: 'zh_cn',
      page: String(page),
      pageSize: '12',
      ...(query ? { q: query } : { order: 'downloads' }),
    }).toString();
    const result = z
      .object({
        d: z.array(z.unknown()),
        count: z.number(),
        estimatedTotalHits: z.number().optional(),
      })
      .parse(await this.net.json(url.href));
    const items: RedenHit[] = result.d.flatMap((raw) => {
      const parsed = item.safeParse(raw);
      if (!parsed.success) return [];
      const h = parsed.data;
      return [
        {
          key: h.key,
          name: h.name,
          author: h.author?.username ?? '',
          downloads: h.downloads ?? 0,
          versions: h.versions ?? [],
        },
      ];
    });
    return {
      items,
      more: result.d.length > 0 && page * 12 < (result.estimatedTotalHits ?? result.count),
    };
  }
  async details(key: string): Promise<RedenDetails> {
    const response = z
      .object({ d: z.array(detail) })
      .parse(await this.net.json(catalog + encodeURIComponent(key) + '/info/zh_cn'));
    const post = response.d.find((p) => p.key === key);
    if (!post) throw new Error('投影已下架或不存在');
    const files = (post.attachments ?? []).flatMap((file, i) =>
      /\.(?:litematic|schematic|schem|nbt)$/i.test(file.name)
        ? [{ name: file.name, size: file.size, index: i + 1, sha256: file.sha256?.toLowerCase() }]
        : [],
    );
    const axes =
      post.type === 'LitematicaGen'
        ? (['x', 'y', 'z'] as const)
            .filter((_, i) => [post.hasX, post.hasY, post.hasZ][i])
            .map((axis) => axisDefinition(axis, post.conditions?.[axis] ?? []))
        : undefined;
    return { files, axes };
  }
  async delivery(file: RedenFile) {
    // The same public generator may serve a file or send the player to a hosted share page.
    const url = redenDownload(file);
    const r = await this.net.response(url, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { Referer: redenPage(file.key) },
    });
    await r.body?.cancel();
    const location = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && location) {
      const next = new URL(location, url);
      if (next.protocol !== 'https:' || next.username || next.password)
        throw new Error('发布页返回的下载地址无效');
      if (!fileOrigins.includes(next.origin)) return { host: next.hostname };
    }
    if (r.ok && r.headers.get('content-type')?.includes('text/html'))
      return { host: new URL(url).hostname };
    return null;
  }
  private async stage<T>(
    file: RedenFile,
    signal: AbortSignal,
    maxBytes: number,
    use: (source: string, output: string) => Promise<T>,
    progress?: (value: number) => void,
  ) {
    const metadata = await this.details(file.key);
    const target = redenDownload(file);
    let name: string, size: number | undefined, hash: string | undefined;
    if (file.kind === 'attachment') {
      const attachment = metadata.files.find((f) => f.index === file.index);
      if (!attachment || !attachment.size) throw new Error('投影附件不可用');
      if (attachment.size > maxBytes)
        throw new Error(
          maxBytes === maxPreviewBytes
            ? '此投影超过 64 MiB，可下载到实例'
            : '单个资源不能超过 2 GiB',
        );
      name = attachment.name;
      size = attachment.size;
      hash = attachment.sha256;
    } else {
      if (!metadata.axes) throw new Error('此投影没有生成器');
      for (const [i, key] of (['x', 'y', 'z'] as const).entries()) {
        const axis = metadata.axes.find((a) => a.axis === key);
        if (axis ? !validAxis(axis, file.sizes[i]) : file.sizes[i] !== 0)
          throw new Error('请检查生成尺寸');
      }
      name = file.key + '-' + file.sizes.join('x') + '.litematic';
    }
    const extension = path.extname(name).toLowerCase();
    const stem = path
      .basename(name, path.extname(name))
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .slice(0, 125)
      .trim()
      .replace(/[. ]+$/, '');
    const safeName =
      (!stem || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(stem) ? 'Reden-' + stem : stem) +
      extension;
    const stage = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-reden-'));
    try {
      const source = path.join(stage, safeName);
      await this.net.download(target, source, {
        signal,
        size,
        hash,
        algorithm: 'sha256',
        maxBytes,
        referer: redenPage(file.key),
        allowedOrigins: fileOrigins,
        onProgress: progress,
      });
      signal.throwIfAborted();
      return await use(source, path.join(stage, 'decoded.json'));
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  preview(file: RedenFile): Promise<RedenPreviewData> {
    return this.stage(file, AbortSignal.timeout(120000), maxPreviewBytes, async (source, output) =>
      path.extname(source) === '.schematic'
        ? { kind: 'layers', data: await schematicPreview(source) }
        : { kind: 'model', doc: await this.workshop.readPreview(source, output) },
    );
  }
  async install(id: string, file: RedenFile, ctx: Work) {
    await this.stage(
      file,
      ctx.signal,
      MAX_RESOURCE_BYTES,
      async (source) => {
        // Downloads can exceed the interactive renderer's block budget.
        const stream = await open(source, 'r');
        try {
          const magic = Buffer.alloc(3);
          const { bytesRead } = await stream.read(magic, 0, 3, 0);
          if (
            bytesRead < 3 ||
            !(
              magic[0] === 10 ||
              (magic[0] === 0x1f && magic[1] === 0x8b && magic[2] === 8) ||
              (magic[0] === 0x78 && ((magic[0] << 8) + magic[1]) % 31 === 0)
            )
          )
            throw new Error('下载内容不是 NBT 投影文件');
        } finally {
          await stream.close();
        }
        const [candidate] = await this.resources.inspect([source]);
        if (!candidate || candidate.kind !== 'schematics') throw new Error('无法读取投影文件');
        ctx.signal.throwIfAborted();
        await this.resources.importOne(
          { id, token: candidate.token, kind: 'schematics', conflict: 'rename' },
          ctx,
        );
      },
      (fraction) => ctx.progress(fraction * 65, '下载投影'),
    );
  }
}
