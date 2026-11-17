import { gzipSync, gunzipSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Independent binary NBT test fixture writer/reader. No production codec is imported.
const T = {
  byte: 1,
  short: 2,
  int: 3,
  long: 4,
  float: 5,
  double: 6,
  bytes: 7,
  string: 8,
  list: 9,
  compound: 10,
  ints: 11,
  longs: 12,
};
export const tag = (type, value) => [T[type], value];
const i32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const str = (s) => {
  const b = Buffer.from(s),
    h = Buffer.alloc(2);
  h.writeUInt16BE(b.length);
  return Buffer.concat([h, b]);
};
function payload([type, value]) {
  if (type === 1) return Buffer.from([value & 255]);
  if (type === 2) {
    const b = Buffer.alloc(2);
    b.writeInt16BE(value);
    return b;
  }
  if (type === 3) return i32(value);
  if (type === 4) {
    const b = Buffer.alloc(8);
    b.writeBigInt64BE(BigInt.asIntN(64, BigInt(value)));
    return b;
  }
  if (type === 5 || type === 6) {
    const b = Buffer.alloc(type === 5 ? 4 : 8);
    if (type === 5) b.writeFloatBE(value);
    else b.writeDoubleBE(value);
    return b;
  }
  if (type === 8) return str(value);
  if (type === 10)
    return Buffer.concat([
      ...Object.entries(value).map(([name, t]) =>
        Buffer.concat([Buffer.from([t[0]]), str(name), payload(t)]),
      ),
      Buffer.from([0]),
    ]);
  if (type === 9)
    return Buffer.concat([
      Buffer.from([value[0]]),
      i32(value[1].length),
      ...value[1].map((v) => payload([value[0], v])),
    ]);
  if (type === 7) return Buffer.concat([i32(value.length), Buffer.from(value)]);
  if (type === 11 || type === 12)
    return Buffer.concat([
      i32(value.length),
      ...value.map((v) => payload([type === 11 ? 3 : 4, v])),
    ]);
  throw new Error('Unknown fixture NBT type ' + type);
}
export function encodeNbt(value, name = '') {
  return gzipSync(Buffer.concat([Buffer.from([10]), str(name), payload(tag('compound', value))]));
}
export function decodeNbt(input) {
  const data = input[0] === 31 && input[1] === 139 ? gunzipSync(input) : input;
  let p = 0;
  const take = (n) => {
    if (n < 0 || p + n > data.length) throw new Error('Truncated NBT fixture');
    const b = data.subarray(p, p + n);
    p += n;
    return b;
  };
  const text = () => take(take(2).readUInt16BE()).toString('utf8');
  function read(type) {
    if (type === 1) return take(1).readInt8();
    if (type === 2) return take(2).readInt16BE();
    if (type === 3) return take(4).readInt32BE();
    if (type === 4) return take(8).readBigInt64BE();
    if (type === 5) return take(4).readFloatBE();
    if (type === 6) return take(8).readDoubleBE();
    if (type === 8) return text();
    if (type === 7) return take(take(4).readInt32BE());
    if (type === 9) {
      const t = take(1)[0],
        n = take(4).readInt32BE();
      if (n < 0 || n > 2e6) throw new Error('Bad fixture list');
      return Array.from({ length: n }, () => read(t));
    }
    if (type === 10) {
      const result = {};
      for (;;) {
        const t = take(1)[0];
        if (!t) return result;
        const name = text();
        result[name] = read(t);
      }
    }
    if (type === 11 || type === 12) {
      const n = take(4).readInt32BE();
      if (n < 0 || n > 2e6) throw new Error('Bad fixture array');
      return Array.from({ length: n }, () => read(type === 11 ? 3 : 4));
    }
    throw new Error('Unknown NBT ' + type);
  }
  if (take(1)[0] !== 10) throw new Error('Root is not a compound');
  text();
  const result = read(10);
  if (p !== data.length) throw new Error('Trailing NBT');
  return result;
}
const compound = (value) => tag('compound', value),
  list = (type, values) => tag('list', [T[type], values]);
const vector = ([x, y, z]) => compound({ x: tag('int', x), y: tag('int', y), z: tag('int', z) });
const stateTag = (state) => ({
  Name: tag('string', state.name),
  ...(state.properties
    ? {
        Properties: compound(
          Object.fromEntries(
            Object.entries(state.properties).map(([k, v]) => [k, tag('string', v)]),
          ),
        ),
      }
    : {}),
});
const stateString = (s) =>
  s.name +
  (s.properties
    ? '[' +
      Object.entries(s.properties)
        .map(([k, v]) => `${k}=${v}`)
        .join(',') +
      ']'
    : '');
export function packed(values, bits) {
  const words = Array(Math.ceil((values.length * bits) / 64)).fill(0n);
  values.forEach((value, i) => {
    const offset = i * bits,
      w = Math.floor(offset / 64),
      shift = offset % 64;
    words[w] |= BigInt(value) << BigInt(shift);
    if (shift + bits > 64) words[w + 1] |= BigInt(value) >> BigInt(64 - shift);
  });
  return words.map((v) => BigInt.asIntN(64, v));
}
const varints = (values) =>
  values.flatMap((value) => {
    const bytes = [];
    do {
      const b = value & 127;
      value >>>= 7;
      bytes.push(b | (value ? 128 : 0));
    } while (value);
    return bytes;
  });
export function fixtureGeometry() {
  const dimensions = [8, 5, 7],
    palette = [
      { name: 'minecraft:air' },
      { name: 'minecraft:stone' },
      { name: 'minecraft:oak_planks' },
      { name: 'minecraft:glass' },
      {
        name: 'minecraft:oak_stairs',
        properties: { facing: 'north', half: 'bottom', shape: 'straight', waterlogged: 'false' },
      },
      { name: 'minecraft:oak_log', properties: { axis: 'x' } },
    ];
  const blocks = Array(8 * 5 * 7).fill(0),
    at = (x, y, z) => x + z * 8 + y * 56;
  for (let z = 0; z < 7; z++) for (let x = 0; x < 8; x++) blocks[at(x, 0, z)] = 1;
  for (const x of [0, 7])
    for (const z of [0, 6]) for (let y = 1; y < 4; y++) blocks[at(x, y, z)] = 5;
  for (let z = 0; z < 7; z++)
    for (let x = 0; x < 8; x++)
      if (x === 0 || x === 7 || z === 0 || z === 6) blocks[at(x, 4, z)] = 2;
  blocks[at(3, 1, 2)] = 4;
  blocks[at(3, 2, 3)] = 4;
  blocks[at(3, 3, 4)] = 4;
  for (let x = 2; x < 6; x++) blocks[at(x, 2, 0)] = 3;
  return { dimensions, palette, blocks };
}
export function litematicFixture(
  geometry = fixtureGeometry(),
  negative = false,
  version = 7,
  regionExtras = {},
) {
  const { dimensions, palette, blocks } = geometry;
  return encodeNbt({
    Version: tag('int', version),
    SubVersion: tag('int', 1),
    MinecraftDataVersion: tag('int', 4189),
    Metadata: compound({
      Name: tag('string', '投影夹具'),
      Author: tag('string', 'KJMCL test'),
      EnclosingSize: vector(dimensions),
      TotalBlocks: tag('int', blocks.filter(Boolean).length),
      TotalVolume: tag('int', blocks.length),
      RegionCount: tag('int', 1),
      TimeCreated: tag('long', 1),
      TimeModified: tag('long', 1),
    }),
    Regions: compound({
      main: compound({
        Position: vector(negative ? [11, 2, -7] : [0, 0, 0]),
        Size: vector(negative ? dimensions.map((x) => -x) : dimensions),
        BlockStatePalette: list('compound', palette.map(stateTag)),
        BlockStates: tag(
          'longs',
          packed(blocks, Math.max(2, Math.ceil(Math.log2(palette.length)))),
        ),
        TileEntities: list('compound', []),
        Entities: list('compound', []),
        PendingBlockTicks: list('compound', []),
        PendingFluidTicks: list('compound', []),
        ...regionExtras,
      }),
    }),
  });
}
export function spongeFixture(geometry = fixtureGeometry(), version = 3) {
  const { dimensions, palette, blocks } = geometry;
  const pal = compound(Object.fromEntries(palette.map((s, i) => [stateString(s), tag('int', i)]))),
    empty = list('compound', []);
  const inner = {
    Version: tag('int', version),
    DataVersion: tag('int', 4189),
    Width: tag('short', dimensions[0]),
    Height: tag('short', dimensions[1]),
    Length: tag('short', dimensions[2]),
    Offset: tag('ints', [-5, 10, 17]),
    Metadata: compound({ Name: tag('string', 'Sponge夹具') }),
    Entities: empty,
    ...(version === 3
      ? {
          Blocks: compound({
            Palette: pal,
            Data: tag('bytes', varints(blocks)),
            BlockEntities: empty,
          }),
        }
      : {
          Palette: pal,
          PaletteMax: tag('int', palette.length),
          BlockData: tag('bytes', varints(blocks)),
          BlockEntities: empty,
        }),
  };
  return encodeNbt(
    version === 3 ? { Schematic: compound(inner) } : inner,
    version === 3 ? '' : 'Schematic',
  );
}
export function structureFixture(geometry = fixtureGeometry()) {
  const { dimensions, palette, blocks } = geometry;
  return encodeNbt({
    DataVersion: tag('int', 4189),
    size: list('int', dimensions),
    palette: list('compound', palette.map(stateTag)),
    blocks: list(
      'compound',
      blocks.flatMap((p, i) =>
        p
          ? [
              {
                state: tag('int', p),
                pos: list('int', [
                  i % dimensions[0],
                  Math.floor(i / (dimensions[0] * dimensions[2])),
                  Math.floor(i / dimensions[0]) % dimensions[2],
                ]),
              },
            ]
          : [],
      ),
    ),
    entities: list('compound', []),
  });
}
export async function writeProjectionFixtures(directory) {
  const files = {
    litematic: path.join(directory, 'fixture.litematic'),
    negative: path.join(directory, 'negative-v6.litematic'),
    schem: path.join(directory, 'fixture.schem'),
    schem2: path.join(directory, 'fixture-v2.schem'),
    nbt: path.join(directory, 'fixture.nbt'),
  };
  await Promise.all([
    writeFile(files.litematic, litematicFixture()),
    writeFile(files.negative, litematicFixture(undefined, true, 6)),
    writeFile(files.schem, spongeFixture()),
    writeFile(files.schem2, spongeFixture(undefined, 2)),
    writeFile(files.nbt, structureFixture()),
  ]);
  return files;
}
export function readProjection(input) {
  const root = decodeNbt(input),
    format = root.Regions ? 'litematic' : root.Schematic || root.BlockData ? 'schem' : 'nbt';
  let dimensions, palette, blocks;
  if (format === 'litematic') {
    const r = Object.values(root.Regions)[0];
    dimensions = [r.Size.x, r.Size.y, r.Size.z].map(Math.abs);
    palette = r.BlockStatePalette;
    const bits = Math.max(2, Math.ceil(Math.log2(palette.length))),
      mask = (1n << BigInt(bits)) - 1n;
    blocks = Array.from({ length: dimensions.reduce((a, b) => a * b, 1) }, (_, i) => {
      const b = i * bits,
        w = Math.floor(b / 64),
        shift = b % 64;
      let n = BigInt.asUintN(64, r.BlockStates[w]) >> BigInt(shift);
      if (shift + bits > 64) n |= BigInt.asUintN(64, r.BlockStates[w + 1]) << BigInt(64 - shift);
      return Number(n & mask);
    });
  } else if (format === 'schem') {
    const r = root.Schematic || root;
    dimensions = [r.Width & 65535, r.Height & 65535, r.Length & 65535];
    const c = r.Blocks || r,
      p = c.Palette;
    palette = [];
    for (const [state, index] of Object.entries(p)) palette[index] = { Name: state };
    const data = c.Data || r.BlockData;
    blocks = [];
    let n = 0,
      shift = 0;
    for (const byte of data) {
      n |= (byte & 127) << shift;
      if (byte & 128) shift += 7;
      else {
        blocks.push(n);
        n = shift = 0;
      }
    }
    if (shift) throw new Error('Truncated varint');
  } else {
    dimensions = root.size;
    palette = root.palette;
    blocks = Array(dimensions.reduce((a, b) => a * b, 1)).fill(
      palette.findIndex((s) => s.Name === 'minecraft:air'),
    );
    for (const b of root.blocks) {
      const [x, y, z] = b.pos;
      blocks[x + z * dimensions[0] + y * dimensions[0] * dimensions[2]] = b.state;
    }
  }
  return { root, format, dimensions, palette, blocks };
}
