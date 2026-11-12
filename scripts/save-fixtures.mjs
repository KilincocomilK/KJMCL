import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, deflateSync } from 'node:zlib';
const i16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
};
const i32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const i64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(BigInt(n));
  return b;
};
const str = (s) => Buffer.concat([i16(Buffer.byteLength(s)), Buffer.from(s)]);
const tag = (type, name, payload) => Buffer.concat([Buffer.from([type]), str(name), payload]);
const compound = (...tags) => Buffer.concat([...tags, Buffer.from([0])]);
const string = (name, value) => tag(8, name, str(value));
const integer = (name, value) => tag(3, name, i32(value));
const byte = (name, value) => tag(1, name, Buffer.from([value]));
export function levelFixture() {
  return gzipSync(
    tag(
      10,
      '',
      compound(
        tag(
          10,
          'Data',
          compound(
            string('LevelName', '测试世界'),
            integer('DataVersion', 3955),
            tag(10, 'Version', compound(string('Name', '1.21.1'))),
            tag(10, 'WorldGenSettings', compound(tag(4, 'seed', i64(9007199254740993n)))),
            integer('GameType', 0),
            byte('Difficulty', 2),
            byte('hardcore', 0),
            byte('allowCommands', 0),
            integer('SpawnX', 0),
            integer('SpawnY', 64),
            integer('SpawnZ', 0),
            tag(10, 'GameRules', compound(string('keepInventory', 'false'))),
            tag(4, 'LastPlayed', i64(1700000000000n)),
          ),
        ),
      ),
    ),
  );
}
function chunkFixture(block, index) {
  const palette = tag(
    9,
    'palette',
    Buffer.concat([Buffer.from([10]), i32(1), compound(string('Name', block))]),
  );
  const section = compound(byte('Y', 0), tag(10, 'block_states', compound(palette)));
  return deflateSync(
    tag(
      10,
      '',
      compound(
        integer('DataVersion', 3955),
        string('Status', 'minecraft:full'),
        tag(4, 'InhabitedTime', i64(index * 1200)),
        tag(9, 'sections', Buffer.concat([Buffer.from([10]), i32(1), section])),
        tag(9, 'block_entities', Buffer.concat([Buffer.from([10]), i32(0)])),
      ),
    ),
  );
}
export function regionFixture(count = 1024) {
  const out = Buffer.alloc((count + 2) * 4096);
  const blocks = [
    'minecraft:water',
    'minecraft:sand',
    'minecraft:grass_block',
    'minecraft:oak_leaves',
    'minecraft:stone',
    'minecraft:snow_block',
  ];
  for (let n = 0; n < count; n++) {
    const x = n % 32,
      z = Math.floor(n / 32),
      band = Math.max(0, Math.min(5, Math.floor((x + Math.sin(z / 4) * 5) / 6)));
    const payload = chunkFixture(blocks[band], n);
    out.writeUInt32BE(((n + 2) << 8) | 1, n * 4);
    out.writeUInt32BE(1700000000 + n, 4096 + n * 4);
    out.writeUInt32BE(payload.length + 1, (n + 2) * 4096);
    out[(n + 2) * 4096 + 4] = 2;
    payload.copy(out, (n + 2) * 4096 + 5);
  }
  return out;
}
export async function createSaveFixture(root, count = 1024) {
  await mkdir(path.join(root, 'region'), { recursive: true });
  await writeFile(path.join(root, 'level.dat'), levelFixture());
  const region = regionFixture(count);
  await writeFile(path.join(root, 'region', 'r.0.0.mca'), region);
  return region;
}
