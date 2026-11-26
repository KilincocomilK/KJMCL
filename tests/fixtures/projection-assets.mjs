import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { PNG } from 'pngjs';

// A self-contained, hash-checked model and texture cache for the resource-management UI test.
export async function writeProjectionAssetFixture(data, blocks) {
  const folder = path.join(data, 'projection-workshop', 'assets');
  await mkdir(folder, { recursive: true });
  const zip = new AdmZip();
  const json = (value) => Buffer.from(JSON.stringify(value));
  const sha1 = (bytes) => createHash('sha1').update(bytes).digest('hex');
  const faces = Object.fromEntries(
    ['up', 'down', 'north', 'south', 'west', 'east'].map((side) => [side, { texture: '#all' }]),
  );
  zip.addFile(
    'assets/minecraft/models/block/fixture.json',
    json({
      textures: { all: 'minecraft:block/fixture' },
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces }],
    }),
  );
  const image = new PNG({ width: 16, height: 16 });
  image.data.fill(255);
  zip.addFile('assets/minecraft/textures/block/fixture.png', PNG.sync.write(image));
  for (const name of new Set(blocks)) {
    if (name === 'minecraft:air') continue;
    zip.addFile(
      'assets/minecraft/blockstates/' + name.slice('minecraft:'.length) + '.json',
      json({ variants: { '': { model: 'minecraft:block/fixture' } } }),
    );
  }
  const client = zip.toBuffer();
  const version = '1.21.11';
  const metadata = json({
    id: version,
    downloads: {
      client: {
        url: 'https://piston-data.mojang.com/test-fixture.jar',
        size: client.length,
        sha1: sha1(client),
      },
    },
  });
  const manifest = {
    latest: { release: version },
    versions: [
      {
        id: version,
        type: 'release',
        sha1: sha1(metadata),
        url: 'https://piston-meta.mojang.com/test-fixture.json',
      },
    ],
  };
  await Promise.all([
    writeFile(path.join(folder, sha1(client) + '.jar'), client),
    writeFile(path.join(folder, sha1(metadata) + '.json'), metadata),
    writeFile(path.join(folder, 'manifest-v1.json'), json({ schema: 1, manifest })),
  ]);
}
