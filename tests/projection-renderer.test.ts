import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  BlockMeshLibrary,
  buildProjectionGeometry,
  isFullCube,
  pickedBlock,
  projectionMaterial,
  type ModelAtlas,
} from '../src/projection/block-renderer';
import type { ProjectionAssets } from '../shared/projection-assets';
import type { ProjectionDocument } from '../shared/projection';

const faces = Object.fromEntries(
  ['up', 'down', 'north', 'south', 'east', 'west'].map((face) => [
    face,
    { texture: '#all', cullface: face },
  ]),
);
const cube = {
  textures: { all: 'minecraft:block/stone' },
  elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces }],
};
const assets: ProjectionAssets = {
  version: 'test-fixture',
  source: 'official',
  textures: {},
  animations: {},
  missing: [],
  blockstates: {
    'minecraft:stone': { variants: { '': { model: 'minecraft:block/cube' } } },
    'minecraft:glass': { variants: { '': { model: 'minecraft:block/cube' } } },
    'minecraft:oak_stairs': {
      variants: {
        'facing=north,half=bottom': { model: 'minecraft:block/stairs' },
        'facing=south,half=top': { model: 'minecraft:block/stairs', x: 180 },
      },
    },
    'minecraft:oak_slab': { variants: { 'type=bottom': { model: 'minecraft:block/slab' } } },
    'minecraft:oak_fence': {
      multipart: [
        { apply: { model: 'minecraft:block/post' } },
        { when: { north: 'true' }, apply: { model: 'minecraft:block/rail' } },
      ],
    },
  },
  models: {
    'minecraft:block/cube': cube,
    'minecraft:block/stairs': {
      textures: cube.textures,
      elements: [
        { from: [0, 0, 0], to: [16, 8, 16], faces },
        { from: [0, 8, 0], to: [16, 16, 8], faces },
      ],
    },
    'minecraft:block/slab': {
      textures: cube.textures,
      elements: [{ from: [0, 0, 0], to: [16, 8, 16], faces }],
    },
    'minecraft:block/post': {
      textures: cube.textures,
      elements: [{ from: [6, 0, 6], to: [10, 16, 10], faces }],
    },
    'minecraft:block/rail': {
      textures: cube.textures,
      elements: [{ from: [7, 6, 0], to: [9, 9, 6], faces }],
    },
  },
};
const atlas: ModelAtlas = {
  getTextureAtlas: () => undefined as unknown as ImageData,
  getTextureUV: () => [0, 0, 1, 1],
  material: () => 'solid',
};
function input(
  palette: ProjectionDocument['palette'],
  blocks: number[],
  dimensions: [number, number, number],
) {
  return {
    doc: { palette, dimensions } as ProjectionDocument,
    blocks: Uint32Array.from(blocks),
    hidden: new Set<number>(),
    layerMin: 0,
    layerMax: dimensions[1] - 1,
    spacing: 0,
  };
}
function raycast(
  batches: Awaited<ReturnType<typeof buildProjectionGeometry>>['batches'],
  origin: number[],
  direction: number[],
) {
  const meshes = batches.map((b) => {
    const mesh = new THREE.Mesh(
      b.geometry,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    mesh.position.copy(b.center);
    mesh.updateMatrixWorld();
    mesh.userData.blockIds = b.ids;
    return mesh;
  });
  const ray = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction));
  const hits = ray.intersectObjects(meshes, false);
  return hits[0] ? pickedBlock(hits[0]) : undefined;
}
describe('Deepslate projection model integration', () => {
  it('does not bake unused palette entries and retains only lightweight visible flags', async () => {
    const library = new BlockMeshLibrary(assets, atlas);
    const parts = vi.spyOn(library, 'parts');
    const value = input(
      [
        { name: 'minecraft:stone' },
        ...Array.from({ length: 4096 }, (_, i) => ({ name: `example:unused_${i}` })),
      ],
      [0],
      [1, 1, 1],
    );
    await buildProjectionGeometry(value, library);
    expect(parts.mock.calls.every(([block]) => block.name === 'minecraft:stone')).toBe(true);
    expect(library.missing.size).toBe(0);
  });
  it('evicts old baked meshes when the quad budget is full while retaining recent entries', () => {
    const material = vi.fn(() => 'solid' as const);
    const library = new BlockMeshLibrary(
      assets,
      { ...atlas, material },
      { entries: 4096, quads: 10 },
    );
    library.parts({ name: 'minecraft:stone' });
    expect(material).toHaveBeenCalledTimes(6);
    library.parts({ name: 'minecraft:glass' });
    expect(material).toHaveBeenCalledTimes(12);
    library.parts({ name: 'minecraft:glass' });
    expect(material).toHaveBeenCalledTimes(12);
    library.parts({ name: 'minecraft:stone' });
    expect(material).toHaveBeenCalledTimes(18);
  });
  it('joins water vertically to a waterlogged slab without a gap, including correct exploded layers', async () => {
    const value = input(
      [
        { name: 'minecraft:water', properties: { level: '0' } },
        { name: 'minecraft:oak_slab', properties: { type: 'bottom', waterlogged: 'true' } },
      ],
      [0, 1],
      [1, 2, 1],
    );
    const maxLowerWaterY = (result: Awaited<ReturnType<typeof buildProjectionGeometry>>) => {
      let max = -Infinity;
      for (const batch of result.batches.filter((b) => b.kind === 'water')) {
        const positions = batch.geometry.getAttribute('position');
        for (let face = 0; face < batch.ids.length; face++)
          if (batch.ids[face] === 0) {
            for (let vertex = 0; vertex < 3; vertex++)
              max = Math.max(max, positions.getY(face * 3 + vertex) + batch.center.y);
          }
      }
      return max;
    };
    expect(
      maxLowerWaterY(await buildProjectionGeometry(value, new BlockMeshLibrary(assets, atlas))),
    ).toBe(1);
    value.spacing = 1;
    expect(
      maxLowerWaterY(await buildProjectionGeometry(value, new BlockMeshLibrary(assets, atlas))),
    ).toBeCloseTo(14.2 / 16);
  });
  it('stops geometry staging at its memory budget so complex views can be sliced', async () => {
    const value = input([{ name: 'minecraft:stone' }], [0, 0], [2, 1, 1]);
    await expect(
      buildProjectionGeometry(value, new BlockMeshLibrary(assets, atlas), () => false, 6),
    ).rejects.toThrow('模型过于复杂，请按层查看');
  });
  it('lets opaque waterlogged surfaces win depth ties without changing glass blending', () => {
    const texture = new THREE.Texture();
    const water = projectionMaterial('water', texture);
    const solid = projectionMaterial('solid', texture);
    const glass = projectionMaterial('transparent', texture);
    expect(water.depthFunc).toBe(THREE.LessDepth);
    expect(water.depthWrite).toBe(false);
    expect(water.transparent).toBe(true);
    expect(solid.depthWrite).toBe(true);
    expect(solid.depthFunc).toBe(THREE.LessEqualDepth);
    expect(glass.depthFunc).toBe(THREE.LessEqualDepth);
    expect(glass.transparent).toBe(true);
    water.dispose();
    solid.dispose();
    glass.dispose();
    texture.dispose();
  });
  it('shows a missing solid model independently of its waterlogged fluid', () => {
    const library = new BlockMeshLibrary(assets, atlas);
    const unknown = library.parts({ name: 'example:unknown', properties: { waterlogged: 'true' } });
    expect(unknown.solid.quads.length).toBe(6);
    expect(unknown.fluid.quads.length).toBe(6);
    expect(library.missing.has('example:unknown')).toBe(true);
    for (const name of [
      'water',
      'lava',
      'bubble_column',
      'kelp',
      'kelp_plant',
      'seagrass',
      'tall_seagrass',
    ]) {
      const parts = library.parts({ name: `minecraft:${name}` });
      expect(parts.solid.quads.length).toBe(0);
      expect(parts.fluid.quads.length).toBe(6);
      expect(library.missing.has(`minecraft:${name}`)).toBe(false);
    }
  });
  it('keeps missing models visible next to an opaque block and does not replace enclosed fluid with cubes', async () => {
    const library = new BlockMeshLibrary(assets, atlas);
    const result = await buildProjectionGeometry(
      input([{ name: 'minecraft:stone' }, { name: 'example:unknown' }], [0, 1], [2, 1, 1]),
      library,
    );
    expect(result.quads).toBe(10);
    expect(raycast(result.batches, [3, 0.5, 0.5], [-1, 0, 0])).toBe(1);
    expect(library.missing.has('example:unknown')).toBe(true);
    const water = library.parts(
      { name: 'minecraft:water' },
      { up: true, down: true, north: true, south: true, east: true, west: true },
    );
    expect(water.solid.isEmpty()).toBe(true);
    expect(water.fluid.isEmpty()).toBe(true);
    expect(library.missing.has('minecraft:water')).toBe(false);
  });
  it('renders actual stair surfaces and does not pick its empty upper corner', async () => {
    const result = await buildProjectionGeometry(
      input(
        [{ name: 'minecraft:oak_stairs', properties: { facing: 'north', half: 'bottom' } }],
        [0],
        [1, 1, 1],
      ),
      new BlockMeshLibrary(assets, atlas),
    );
    expect(result.quads).toBe(12);
    expect(raycast(result.batches, [2, 0.75, 0.75], [-1, 0, 0])).toBeUndefined();
    expect(raycast(result.batches, [2, 0.25, 0.75], [-1, 0, 0])).toBe(0);
    const top = await buildProjectionGeometry(
      input(
        [{ name: 'minecraft:oak_stairs', properties: { facing: 'south', half: 'top' } }],
        [0],
        [1, 1, 1],
      ),
      new BlockMeshLibrary(assets, atlas),
    );
    expect(raycast(top.batches, [2, 0.25, 0.25], [-1, 0, 0])).toBeUndefined();
    expect(raycast(top.batches, [2, 0.75, 0.25], [-1, 0, 0])).toBe(0);
  });
  it('uses upstream water levels and separates the opaque waterlogged slab', () => {
    const library = new BlockMeshLibrary(assets, atlas);
    const height = (level: string) =>
      Math.max(
        ...library
          .parts({ name: 'minecraft:water', properties: { level } })
          .fluid.quads.flatMap((q) => q.vertices().map((v) => v.pos.y)),
      );
    expect(height('0')).toBeCloseTo(14.2 / 16);
    expect(height('5')).toBeCloseTo(5.3 / 16);
    expect(height('8')).toBe(1);
    const slab = library.parts({
      name: 'minecraft:oak_slab',
      properties: { type: 'bottom', waterlogged: 'true' },
    });
    expect(slab.solid.quads).toHaveLength(6);
    expect(slab.fluid.quads).toHaveLength(6);
    expect(slab.water).toBe(true);
    expect(slab.opaque).toBe(false);
    expect(Math.max(...slab.solid.quads.flatMap((q) => q.vertices().map((v) => v.pos.y)))).toBe(
      0.5,
    );
  });
  it('evaluates multipart conditions and does not treat a stair as a full occluder', () => {
    const library = new BlockMeshLibrary(assets, atlas);
    expect(
      library.parts({ name: 'minecraft:oak_fence', properties: { north: 'false' } }).solid.quads
        .length,
    ).toBe(6);
    expect(
      library.parts({ name: 'minecraft:oak_fence', properties: { north: 'true' } }).solid.quads
        .length,
    ).toBe(12);
    expect(isFullCube(library.parts({ name: 'minecraft:stone' }).solid)).toBe(true);
    expect(
      isFullCube(
        library.parts({
          name: 'minecraft:oak_stairs',
          properties: { facing: 'north', half: 'bottom' },
        }).solid,
      ),
    ).toBe(false);
  });
  it('keeps original voxel IDs across visibility, splitting and exploded layers', async () => {
    const value = input([{ name: 'minecraft:stone' }], [0, 0, 0, 0], [2, 2, 1]);
    value.hidden.add(1);
    value.spacing = 1;
    const result = await buildProjectionGeometry(value, new BlockMeshLibrary(assets, atlas));
    expect(result.ids).toEqual([0, 2, 3]);
    expect(raycast(result.batches, [3, 2.5, 0.5], [-1, 0, 0])).toBe(3);
    expect(raycast(result.batches, [3, 1.5, 0.5], [-1, 0, 0])).toBeUndefined();
    expect(raycast(result.batches, [3, 0.5, 0.5], [-1, 0, 0])).toBe(0);
  });
  it('removes all interior faces in a 32³ solid build while keeping batch count bounded', async () => {
    const size = 32;
    const value = input([{ name: 'minecraft:stone' }], Array(size ** 3).fill(0), [
      size,
      size,
      size,
    ]);
    const library = new BlockMeshLibrary(assets, atlas);
    const result = await buildProjectionGeometry(value, library);
    expect(result.quads).toBe(6 * size * size);
    expect(result.batches.length).toBeLessThanOrEqual(8);
    expect(result.ids.length).toBe(size ** 3);
    expect(library.missing.size).toBe(0);
  });
  it('does not cull stone faces behind a transparent or cutout cube', async () => {
    const transparentAtlas = { ...atlas, material: () => 'transparent' as const };
    const library = new BlockMeshLibrary(assets, transparentAtlas);
    const result = await buildProjectionGeometry(
      input([{ name: 'minecraft:stone' }, { name: 'minecraft:glass' }], [0, 1], [2, 1, 1]),
      library,
    );
    expect(result.quads).toBe(12);
    expect(result.batches.every((b) => b.kind === 'transparent')).toBe(true);
  });
});
