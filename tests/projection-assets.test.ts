import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { PNG } from 'pngjs';
import { ProjectionAssetService, readProjectionAssets } from '../electron/core/projection-assets';
import { projectionAssetsSchema } from '../shared/projection-assets';
import type { Network } from '../electron/core/network';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function root() {
  const value = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-assets-'));
  roots.push(value);
  return value;
}
function png() {
  const image = new PNG({ width: 16, height: 32 });
  image.data.fill(255);
  return PNG.sync.write(image);
}
function archive(extra: Record<string, string | Buffer> = {}) {
  const zip = new AdmZip();
  const files: Record<string, string | Buffer> = {
    'assets/minecraft/blockstates/stone.json': JSON.stringify({
      variants: { '': { model: 'minecraft:block/stone' } },
    }),
    'assets/minecraft/models/block/stone.json': JSON.stringify({
      parent: 'minecraft:block/cube_all',
      textures: { all: 'minecraft:block/stone' },
    }),
    'assets/minecraft/models/block/cube_all.json': JSON.stringify({
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: '#all' } } }],
    }),
    'assets/minecraft/textures/block/stone.png': png(),
    'assets/minecraft/textures/block/water_still.png': png(),
    'assets/minecraft/textures/block/water_still.png.mcmeta': '{"animation":{"frametime":2}}',
    'assets/minecraft/textures/entity/chest/normal.png': png(),
    ...extra,
  };
  for (const [name, data] of Object.entries(files))
    zip.addFile(name, Buffer.isBuffer(data) ? data : Buffer.from(data));
  return zip.toBuffer();
}
async function jar(extra: Record<string, string | Buffer> = {}) {
  const file = path.join(await root(), 'client.jar');
  await writeFile(file, archive(extra));
  return file;
}
describe('projection original assets', () => {
  it('follows parents and texture references; keeps full PNGs and animation metadata', async () => {
    const data = await readProjectionAssets(
      await jar(),
      ['minecraft:stone', 'minecraft:water', 'mod:absent'],
      'test',
      'official',
    );
    expect(Object.keys(data.models).sort()).toEqual([
      'minecraft:block/cube_all',
      'minecraft:block/stone',
    ]);
    expect(
      PNG.sync.read(Buffer.from(data.textures['minecraft:block/stone'], 'base64')).height,
    ).toBe(32);
    expect(data.animations['minecraft:block/water_still']).toEqual({ animation: { frametime: 2 } });
    expect(data.textures['minecraft:entity/chest/normal']).toBeTruthy();
    expect(data.missing).toEqual(['mod:absent']);
  });
  it('loads multipart alternatives and object sprite references', async () => {
    const file = await jar({
      'assets/minecraft/blockstates/fence.json': JSON.stringify({
        multipart: [{ apply: [{ model: 'block/post' }, { model: 'block/stone' }] }],
      }),
      'assets/minecraft/models/block/post.json': JSON.stringify({
        textures: { side: { sprite: 'block/stone' } },
      }),
    });
    expect(
      Object.keys(
        (await readProjectionAssets(file, ['minecraft:fence'], 'test', 'official')).models,
      ),
    ).toContain('minecraft:block/post');
  });
  it('rejects model parent cycles', async () => {
    const file = await jar({
      'assets/minecraft/models/block/cube_all.json': '{"parent":"block/stone"}',
    });
    await expect(
      readProjectionAssets(file, ['minecraft:stone'], 'test', 'official'),
    ).rejects.toThrow('循环');
  });
  it('rejects escaping resource references', async () => {
    const file = await jar({
      'assets/minecraft/models/block/stone.json': '{"parent":"../secrets"}',
    });
    await expect(
      readProjectionAssets(file, ['minecraft:stone'], 'test', 'official'),
    ).rejects.toThrow('引用');
    expect(projectionAssetsSchema.safeParse({ blocks: ['../client.jar'] }).success).toBe(false);
    expect(projectionAssetsSchema.safeParse({ blocks: [], version: '../test' }).success).toBe(
      false,
    );
  });
  it('rejects oversized decoded PNG dimensions before decompression', async () => {
    const image = png();
    image.writeUInt32BE(65536, 16);
    const file = await jar({ 'assets/minecraft/textures/block/stone.png': image });
    await expect(
      readProjectionAssets(file, ['minecraft:stone'], 'test', 'official'),
    ).rejects.toThrow('尺寸');
  });
  it('rejects oversized JSON and prototype setter keys', async () => {
    const big = await jar({
      'assets/minecraft/models/block/stone.json': ' '.repeat(1024 ** 2 + 1),
    });
    await expect(
      readProjectionAssets(big, ['minecraft:stone'], 'test', 'official'),
    ).rejects.toThrow('过大');
    const bad = await jar({
      'assets/minecraft/models/block/stone.json': '{"__proto__":{"polluted":true}}',
    });
    await expect(
      readProjectionAssets(bad, ['minecraft:stone'], 'test', 'official'),
    ).rejects.toThrow('属性');
  });
  it('caps aggregate decompression across many individually valid models', async () => {
    const files: Record<string, string> = {},
      blocks: string[] = [];
    const payload = JSON.stringify({ credit: 'x'.repeat(900 * 1024) });
    for (let i = 0; i < 56; i++) {
      blocks.push('minecraft:test_' + i);
      files[`assets/minecraft/blockstates/test_${i}.json`] = JSON.stringify({
        variants: { '': { model: `block/test_${i}` } },
      });
      files[`assets/minecraft/models/block/test_${i}.json`] = payload;
    }
    await expect(
      readProjectionAssets(await jar(files), blocks, 'test', 'official'),
    ).rejects.toThrow('读取量');
  }, 15000);
});
async function serviceFixture(local = false) {
  const directory = await root();
  const client = archive(),
    hash = (b: Buffer) => createHash('sha1').update(b).digest('hex');
  const metadata = Buffer.from(
    JSON.stringify({
      id: '26.3',
      downloads: {
        client: {
          url: 'https://piston-data.mojang.com/client.jar',
          size: client.length,
          sha1: hash(client),
        },
      },
    }),
  );
  const manifest = {
    latest: { release: '26.3' },
    versions: [
      {
        id: '26.3',
        type: 'release',
        url: 'https://piston-meta.mojang.com/26.3.json',
        sha1: hash(metadata),
      },
    ],
  };
  const response = vi.fn(
    async (url: string) =>
      new Response(url.endsWith('26.3.json') ? metadata : JSON.stringify(manifest)),
  );
  const download = vi.fn(async (url: string, destination: string) => {
    // Test network is deliberately untrusted; the service must verify its bytes itself.
    await writeFile(destination, url.endsWith('client.jar') ? client : metadata);
  });
  const net = { response, download } as unknown as Pick<Network, 'response' | 'download'>;
  const instanceDir = path.join(directory, 'instance');
  if (local) {
    await mkdir(instanceDir);
    await writeFile(path.join(instanceDir, 'client.jar'), client);
  }
  const store = {
    root: directory,
    dir: () => instanceDir,
    data: { instances: local ? [{ id: 'local', version: '26.3' }] : [] },
  };
  const service = new ProjectionAssetService(store as any, net);
  return { directory, service, net, response, download, store, client, metadata };
}
describe('projection asset cache and integrity', () => {
  it('checks both metadata and client bytes and reuses local verified clients', async () => {
    const f = await serviceFixture(true);
    expect((await f.service.load({ blocks: ['minecraft:stone'] })).source).toBe('local');
    expect(f.download).not.toHaveBeenCalled();
  });
  it('cached manifests and verified archives work without network on restart', async () => {
    const f = await serviceFixture();
    await f.service.load({ blocks: ['minecraft:stone'] });
    f.response.mockRejectedValue(new Error('offline'));
    f.download.mockImplementation(async (_url, destination) => {
      await readFile(destination);
    });
    const reopened = new ProjectionAssetService(f.store as any, f.net);
    expect(
      (await reopened.load({ blocks: ['minecraft:stone'] })).textures['minecraft:block/stone'],
    ).toBeTruthy();
    expect(f.response).toHaveBeenCalledTimes(2);
  });
  it('rejects corrupted client data instead of returning textures', async () => {
    const f = await serviceFixture();
    f.download.mockImplementation(async (url, destination) => {
      await writeFile(
        destination,
        url.endsWith('client.jar') ? Buffer.alloc(f.client.length) : f.metadata,
      );
    });
    await expect(f.service.load({ blocks: ['minecraft:stone'] })).rejects.toThrow('校验');
  });
  it('failed requests can retry without a poisoned promise cache', async () => {
    const f = await serviceFixture();
    f.response.mockRejectedValueOnce(new Error('offline'));
    await expect(f.service.load({ blocks: ['minecraft:stone'] })).rejects.toThrow('offline');
    expect((await f.service.load({ blocks: ['minecraft:stone'] })).version).toBe('26.3');
  });
  it('rebuilds a damaged manifest cache and retains the damaged copy', async () => {
    const f = await serviceFixture();
    await f.service.load({ blocks: ['minecraft:stone'] });
    const cacheDir = path.join(f.directory, 'projection-workshop', 'assets');
    await writeFile(path.join(cacheDir, 'manifest-v1.json'), '{broken');
    const reopened = new ProjectionAssetService(f.store as any, f.net);
    expect((await reopened.load({ blocks: ['minecraft:stone'] })).version).toBe('26.3');
    expect(
      (await readdir(cacheDir)).some((name) => name.startsWith('manifest-v1.json.damaged-')),
    ).toBe(true);
  });
  it('rejects metadata whose SHA1 does not match the official manifest', async () => {
    const f = await serviceFixture();
    const response = f.response.getMockImplementation()!;
    f.response.mockImplementation(async (url) =>
      url.endsWith('26.3.json') ? new Response('{}') : response(url),
    );
    await expect(f.service.load({ blocks: ['minecraft:stone'] })).rejects.toThrow('索引校验');
  });
});
