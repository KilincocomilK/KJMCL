import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { openPromise } from 'yauzl';
import { inside } from './files';
import type { ResourcePreview } from '../../shared/types';

// Only bounded metadata is decompressed; recordings and pack assets stay on disk.
export async function zipMetadata(file: string) {
  const zip = await openPromise(file, { strictFileNames: true });
  const data = new Map<string, Buffer>();
  const names = new Set<string>();
  let count = 0,
    bytes = 0,
    metadataBytes = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      inside('/archive', entry.fileName);
      if (++count > 100_000 || (bytes += entry.uncompressedSize) > 16 * 1024 ** 3)
        throw new Error('压缩包超过安全读取限制');
      if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
        throw new Error('压缩包含有符号链接');
      names.add(entry.fileName);
      if (
        ![
          'fabric.mod.json',
          'quilt.mod.json',
          'META-INF/mods.toml',
          'META-INF/neoforge.mods.toml',
          'pack.mcmeta',
          'pack.png',
          'metaData.json',
          'thumb',
          'thumb.jpg',
          'thumbnail.png',
        ].includes(entry.fileName)
      )
        continue;
      if (entry.uncompressedSize > 4 * 1024 ** 2) continue;
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of await zip.openReadStreamPromise(entry)) {
        length += chunk.length;
        metadataBytes += chunk.length;
        if (length > 4 * 1024 ** 2 || metadataBytes > 16 * 1024 ** 2) throw new Error('元数据过大');
        chunks.push(chunk);
      }
      data.set(entry.fileName, Buffer.concat(chunks));
    }
  } finally {
    zip.close();
  }
  return { names, data };
}
export function metadataJson(data: Map<string, Buffer>, name: string): any {
  const value = data.get(name);
  return value ? JSON.parse(value.toString('utf8')) : undefined;
}
export function imageData(data?: Buffer) {
  if (!data) return undefined;
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'data:image/png;base64,' + data.toString('base64');
  if (data[0] === 255 && data[1] === 216 && data[2] === 255)
    return 'data:image/jpeg;base64,' + data.toString('base64');
  return undefined;
}

// Java big-endian NBT, bounded by bytes, depth and tag count, with no prototype setters.
export function readNbt(input: Buffer): any {
  const b =
    input[0] === 31 && input[1] === 139
      ? gunzipSync(input, { maxOutputLength: 32 * 1024 ** 2 })
      : input;
  if (b.length > 32 * 1024 ** 2) throw new Error('原理图超过 32 MiB 预览限制');
  let p = 0,
    tags = 0;
  const take = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0 || p + n > b.length) throw new Error('NBT 数据不完整');
    const at = p;
    p += n;
    return at;
  };
  const u8 = () => b.readUInt8(take(1));
  const i32 = () => b.readInt32BE(take(4));
  const str = () => {
    const n = b.readUInt16BE(take(2));
    return b.toString('utf8', take(n), p);
  };
  const length = () => {
    const n = i32();
    if (n < 0 || n > 4_000_000) throw new Error('NBT 数组过大');
    return n;
  };
  const tag = (type: number, depth: number): any => {
    if (++tags > 1_000_000 || depth > 48) throw new Error('NBT 结构过于复杂');
    switch (type) {
      case 1:
        return b.readInt8(take(1));
      case 2:
        return b.readInt16BE(take(2));
      case 3:
        return i32();
      case 4:
        return b.readBigInt64BE(take(8));
      case 5:
        return b.readFloatBE(take(4));
      case 6:
        return b.readDoubleBE(take(8));
      case 7: {
        const n = length();
        return b.subarray(take(n), p);
      }
      case 8:
        return str();
      case 9: {
        const t = u8(),
          n = length();
        if (!t && n) throw new Error('无效 NBT 列表');
        return Array.from({ length: n }, () => tag(t, depth + 1));
      }
      case 10: {
        const value = Object.create(null);
        for (let t; (t = u8()) !== 0;) {
          const name = str();
          value[name] = tag(t, depth + 1);
        }
        return value;
      }
      case 11:
        return Array.from({ length: length() }, i32);
      case 12:
        return Array.from({ length: length() }, () => b.readBigUInt64BE(take(8)));
      default:
        throw new Error('不支持的 NBT 类型');
    }
  };
  if (u8() !== 10) throw new Error('不是 NBT 原理图');
  str();
  return tag(10, 0);
}
const air = (name: string) => /(^|:)(air|cave_air|void_air)(\[|$)/.test(name);
export async function schematicPreview(file: string): Promise<ResourcePreview> {
  const raw = await readFile(file),
    root = readNbt(raw),
    n = root.Schematic ?? root;
  const result: ResourcePreview = {
    title: String(n.Metadata?.Name || '投影原理图'),
    details: [],
    layers: [],
  };
  const detail = (label: string, value: unknown) => {
    if (value !== undefined) result.details.push({ label, value: String(value) });
  };
  detail('作者', n.Metadata?.Author);
  detail('说明', n.Metadata?.Description);
  detail('数据版本', n.MinecraftDataVersion ?? n.DataVersion);
  detail('方块数', n.Metadata?.TotalBlocks);
  let total = 0;
  const layer = (name: string, w: number, h: number, d: number, get: (i: number) => string) => {
    if (![w, h, d].every((v) => Number.isInteger(v) && v > 0)) throw new Error('原理图尺寸无效');
    detail(name + ' 尺寸', `${w} × ${h} × ${d}`);
    total += w * h * d;
    if (total > 2_000_000 || w * d > 65536 || result.layers!.length >= 16) {
      result.warning = '大型原理图仅显示信息，部分区域未生成俯视图';
      return;
    }
    const cells = new Array<string>(w * d).fill('');
    for (let y = h - 1; y >= 0; y--)
      for (let z = 0; z < d; z++)
        for (let x = 0; x < w; x++) {
          const at = z * w + x;
          if (cells[at]) continue;
          const block = get((y * d + z) * w + x);
          if (!air(block)) cells[at] = block;
        }
    result.layers!.push({ name, width: w, depth: d, cells });
  };
  if (n.Regions) {
    for (const [name, r] of Object.entries<any>(n.Regions)) {
      const palette: string[] = r.BlockStatePalette.map((v: any) => String(v.Name));
      const bits = Math.max(2, Math.ceil(Math.log2(palette.length))),
        mask = (1n << BigInt(bits)) - 1n;
      layer(name, Math.abs(r.Size.x), Math.abs(r.Size.y), Math.abs(r.Size.z), (i) => {
        const offset = i * bits,
          word = Math.floor(offset / 64),
          shift = offset % 64;
        if (typeof r.BlockStates[word] !== 'bigint') throw new Error('方块数据不完整');
        let value = r.BlockStates[word] >> BigInt(shift);
        if (shift + bits > 64) {
          if (typeof r.BlockStates[word + 1] !== 'bigint') throw new Error('方块数据不完整');
          value |= r.BlockStates[word + 1] << BigInt(64 - shift);
        }
        const block = palette[Number(value & mask)];
        if (!block) throw new Error('方块索引无效');
        return block;
      });
    }
  } else if (n.Width && n.Height && n.Length) {
    const blocks = n.Blocks?.Data ?? n.BlockData;
    const palette = n.Blocks?.Palette ?? n.Palette;
    if (palette && Buffer.isBuffer(blocks)) {
      const names: Record<number, string> = {};
      for (const [name, id] of Object.entries(palette)) names[Number(id)] = name;
      const indices: number[] = [];
      let value = 0,
        shift = 0;
      for (const byte of blocks) {
        value |= (byte & 127) << shift;
        if (byte & 128) {
          shift += 7;
          if (shift > 28) throw new Error('方块索引无效');
        } else {
          indices.push(value);
          value = 0;
          shift = 0;
        }
      }
      if (shift) throw new Error('方块数据不完整');
      layer('区域', n.Width & 65535, n.Height & 65535, n.Length & 65535, (i) => {
        const v = names[indices[i]];
        if (!v) throw new Error('方块索引无效');
        return v;
      });
    } else if (Buffer.isBuffer(n.Blocks)) {
      layer('区域', n.Width & 65535, n.Height & 65535, n.Length & 65535, (i) => {
        if (i >= n.Blocks.length) throw new Error('方块数据不完整');
        const extra = n.AddBlocks?.[Math.floor(i / 2)] ?? 0;
        const id = n.Blocks[i] | (((i % 2 ? extra >> 4 : extra) & 15) << 8);
        return id ? `legacy:${id}` : 'minecraft:air';
      });
    }
  } else if (Array.isArray(n.size) && Array.isArray(n.blocks) && Array.isArray(n.palette)) {
    const [w, h, d] = n.size,
      blocks = new Map<number, string>();
    for (const b of n.blocks)
      blocks.set(
        (b.pos[1] * d + b.pos[2]) * w + b.pos[0],
        String(n.palette[b.state]?.Name ?? 'minecraft:air'),
      );
    layer('结构', w, h, d, (i) => blocks.get(i) ?? 'minecraft:air');
  }
  if (!result.layers!.length) result.warning ??= '该格式暂不支持俯视图，可在 Litematica 中打开';
  return result;
}
