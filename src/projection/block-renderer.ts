import * as THREE from 'three';
import {
  BlockDefinition,
  BlockModel,
  BlockState,
  Cull,
  Identifier,
  Mesh,
  SpecialRenderers,
  type TextureAtlasProvider,
  type Quad,
} from 'deepslate/render';
import type { ProjectionAssets } from '../../shared/projection-assets';
import type { ProjectionBlock, ProjectionDocument } from '../../shared/projection';
import { coordinates, isAir } from './model';

export type MaterialKind = 'solid' | 'cutout' | 'transparent' | 'water';
// Bound CPU staging arrays and GPU buffers for highly fragmented projections.
export const MAX_RENDER_QUADS = 300_000;
export function projectionMaterial(kind: MaterialKind, texture: THREE.Texture) {
  return new THREE.MeshLambertMaterial({
    map: texture,
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: kind === 'water' || kind === 'transparent',
    depthWrite: kind !== 'water' && kind !== 'transparent',
    // Waterlogged model surfaces share planes with the fluid. The opaque surface wins ties.
    depthFunc: kind === 'water' ? THREE.LessDepth : THREE.LessEqualDepth,
    alphaTest: 0.01,
    opacity: kind === 'water' ? 0.72 : 1,
  });
}
export interface ModelAtlas extends TextureAtlasProvider {
  material(quad: Quad): Exclude<MaterialKind, 'water'>;
}
export interface BlockParts {
  solid: Mesh;
  fluid: Mesh;
  water: boolean;
  full: boolean;
  opaque: boolean;
}
const directions = ['west', 'east', 'down', 'up', 'north', 'south'] as const;
const qualified = (name: string) => (name.includes(':') ? name : `minecraft:${name}`);

/** Minecraft models, multipart states, UVs and special/fluid meshes come from Deepslate. */
export class BlockMeshLibrary {
  private models = new Map<string, BlockModel>();
  private definitions = new Map<string, BlockDefinition>();
  private cache = new Map<string, BlockParts>();
  private cachedQuads = 0;
  readonly missing = new Set<string>();
  constructor(
    private assets: ProjectionAssets,
    readonly atlas: ModelAtlas,
    private cacheBudget = { entries: 4096, quads: 16384 },
  ) {
    for (const [key, value] of Object.entries(assets.models))
      this.models.set(qualified(key), BlockModel.fromJson(value));
    for (const [key, value] of Object.entries(assets.blockstates))
      this.definitions.set(qualified(key), BlockDefinition.fromJson(value));
    for (const model of this.models.values())
      model.flatten({ getBlockModel: (id) => this.models.get(id.toString()) ?? null });
  }
  parts(block: ProjectionBlock, cull: Cull = Cull.none(), fluidCull: Cull = cull): BlockParts {
    const key = `${block.name}|${JSON.stringify(block.properties ?? {})}|${directions.map((d) => (cull[d] ? 1 : 0)).join('')}|${directions.map((d) => (fluidCull[d] ? 1 : 0)).join('')}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const properties = { ...block.properties };
    const name = Identifier.parse(block.name);
    const solid = new Mesh();
    let fluid = new Mesh();
    const water =
      block.name === 'minecraft:water' ||
      properties.waterlogged === 'true' ||
      [
        'minecraft:kelp',
        'minecraft:kelp_plant',
        'minecraft:seagrass',
        'minecraft:tall_seagrass',
        'minecraft:bubble_column',
      ].includes(block.name);
    const lava = block.name === 'minecraft:lava';
    const definition = this.definitions.get(block.name);
    try {
      if (definition)
        solid.merge(
          definition.getMesh(
            name,
            properties,
            this.atlas,
            { getBlockModel: (id) => this.models.get(id.toString()) ?? null },
            cull,
          ),
        );
      if (!water && !lava)
        solid.merge(
          SpecialRenderers.getBlockMesh(
            new BlockState(name, properties),
            undefined,
            this.atlas,
            cull,
          ),
        );
      else {
        if (
          block.name !== 'minecraft:water' &&
          !lava &&
          ![
            'minecraft:kelp',
            'minecraft:kelp_plant',
            'minecraft:seagrass',
            'minecraft:tall_seagrass',
            'minecraft:bubble_column',
          ].includes(block.name)
        )
          solid.merge(
            SpecialRenderers.getBlockMesh(
              new BlockState(name, { ...properties, waterlogged: 'false' }),
              undefined,
              this.atlas,
              cull,
            ),
          );
        fluid = SpecialRenderers.getBlockMesh(
          new BlockState(lava ? 'minecraft:lava' : 'minecraft:water', {
            level: properties.level ?? '0',
          }),
          undefined,
          this.atlas,
          fluidCull,
        );
      }
    } catch {
      this.missing.add(block.name);
      solid.clear();
      fluid.clear();
    }
    if (
      !isAir(block) &&
      block.name !== 'minecraft:water' &&
      block.name !== 'minecraft:lava' &&
      block.name !== 'minecraft:bubble_column' &&
      ![
        'minecraft:kelp',
        'minecraft:kelp_plant',
        'minecraft:seagrass',
        'minecraft:tall_seagrass',
      ].includes(block.name) &&
      solid.isEmpty() &&
      (!definition || this.missing.has(block.name) || !directions.some((d) => cull[d]))
    ) {
      this.missing.add(block.name);
      solid.merge(
        BlockDefinition.fromJson({ variants: { '': { model: 'kjmcl:missing' } } }).getMesh(
          undefined,
          {},
          this.atlas,
          {
            getBlockModel: () =>
              BlockModel.fromJson({
                textures: { all: 'kjmcl:missing' },
                elements: [
                  {
                    from: [0, 0, 0],
                    to: [16, 16, 16],
                    faces: Object.fromEntries(
                      directions.map((d) => [d, { texture: '#all', cullface: d }]),
                    ),
                  },
                ],
              }),
          },
          cull,
        ),
      );
    }
    const full = isFullCube(solid);
    const result = {
      solid,
      fluid,
      water,
      full,
      opaque: full && solid.quads.every((q) => this.atlas.material(q) === 'solid'),
    };
    this.cache.set(key, result);
    this.cachedQuads += solid.quads.length + fluid.quads.length;
    while (
      this.cache.size > this.cacheBudget.entries ||
      this.cachedQuads > this.cacheBudget.quads
    ) {
      const oldest = this.cache.entries().next().value;
      if (!oldest) break;
      this.cache.delete(oldest[0]);
      this.cachedQuads -= oldest[1].solid.quads.length + oldest[1].fluid.quads.length;
    }
    return result;
  }
}

export function isFullCube(mesh: Mesh): boolean {
  if (mesh.quads.length !== 6) return false;
  const faces = new Set<string>();
  for (const q of mesh.quads) {
    const vertices = q.vertices();
    const bounds = (axis: 'x' | 'y' | 'z') => [
      Math.min(...vertices.map((v) => v.pos[axis])),
      Math.max(...vertices.map((v) => v.pos[axis])),
    ];
    const limits = [bounds('x'), bounds('y'), bounds('z')];
    const axis = limits.findIndex(
      ([a, b]) => Math.abs(a - b) < 0.00001 && (Math.abs(a) < 0.00001 || Math.abs(a - 1) < 0.00001),
    );
    if (
      axis < 0 ||
      limits.some(([a, b], i) => i !== axis && (Math.abs(a) > 0.00001 || Math.abs(b - 1) > 0.00001))
    )
      return false;
    faces.add(`${axis}:${Math.round(limits[axis][0])}`);
  }
  return faces.size === 6;
}

export interface RenderInput {
  doc: ProjectionDocument;
  blocks: Uint32Array;
  hidden: Set<number>;
  layerMin: number;
  layerMax: number;
  spacing: number;
}
interface Batch {
  position: number[];
  uv: number[];
  normal: number[];
  color: number[];
  ids: number[];
  kind: MaterialKind;
  center: THREE.Vector3;
}
export interface RenderGeometry {
  geometry: THREE.BufferGeometry;
  kind: MaterialKind;
  center: THREE.Vector3;
  ids: Uint32Array;
}

/** Adapt library quads to GPU batches. Face IDs retain exact model picking (including stairs' empty corners). */
export async function buildProjectionGeometry(
  input: RenderInput,
  library: BlockMeshLibrary,
  cancelled: () => boolean = () => false,
  maxQuads = MAX_RENDER_QUADS,
): Promise<{ batches: RenderGeometry[]; ids: number[]; quads: number }> {
  const { doc, blocks, hidden, layerMin, layerMax, spacing } = input;
  const [w, h, d] = doc.dimensions;
  const base = new Map<number, Pick<BlockParts, 'full' | 'opaque' | 'water'>>();
  const flags = (id: number) => {
    let result = base.get(id);
    if (!result) {
      const { full, opaque, water } = library.parts(doc.palette[id]);
      result = { full, opaque, water };
      base.set(id, result);
    }
    return result;
  };
  const visible = (x: number, y: number, z: number) =>
    x >= 0 &&
    x < w &&
    z >= 0 &&
    z < d &&
    y >= Math.max(0, layerMin) &&
    y < h &&
    y <= layerMax &&
    !hidden.has(x + z * w + y * w * d);
  const batches = new Map<string, Batch>();
  const ids: number[] = [];
  let quads = 0;
  const offsets = [
    [-1, 0, 0],
    [1, 0, 0],
    [0, -1, 0],
    [0, 1, 0],
    [0, 0, -1],
    [0, 0, 1],
  ];
  const append = (
    mesh: Mesh,
    forced: MaterialKind | undefined,
    index: number,
    x: number,
    y: number,
    z: number,
  ) => {
    for (const q of mesh.quads) {
      if (quads >= maxQuads) throw new Error('模型过于复杂，请按层查看');
      const kind = forced ?? library.atlas.material(q);
      // Transparent chunks stay small so Three can sort them around the camera.
      const size = kind === 'water' || kind === 'transparent' ? 4 : 16;
      const cx = Math.floor(x / size),
        cy = Math.floor(y / size),
        cz = Math.floor(z / size);
      const key = `${cx},${cy},${cz},${kind}`;
      let batch = batches.get(key);
      if (!batch) {
        batch = {
          position: [],
          uv: [],
          normal: [],
          color: [],
          ids: [],
          kind,
          center: new THREE.Vector3(
            (cx + 0.5) * size,
            (cy + 0.5) * size * (1 + spacing),
            (cz + 0.5) * size,
          ),
        };
        batches.set(key, batch);
      }
      const n = q.normal();
      const vs = q.vertices();
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const v = vs[i];
        batch.position.push(
          v.pos.x + x - batch.center.x,
          v.pos.y + y * (1 + spacing) - batch.center.y,
          v.pos.z + z - batch.center.z,
        );
        const limit = v.textureLimit;
        const pixel = library.atlas.getPixelSize?.() ?? 0;
        // Clamp inside the sprite/face to avoid neighboring atlas texels at exact boundaries.
        batch.uv.push(
          limit
            ? THREE.MathUtils.clamp(
                v.texture?.[0] ?? 0,
                limit[0] + pixel * 0.02,
                limit[2] - pixel * 0.02,
              )
            : (v.texture?.[0] ?? 0),
          limit
            ? THREE.MathUtils.clamp(
                v.texture?.[1] ?? 0,
                limit[1] + pixel * 0.02,
                limit[3] - pixel * 0.02,
              )
            : (v.texture?.[1] ?? 0),
        );
        batch.normal.push(n.x, n.y, n.z);
        batch.color.push(...v.color);
      }
      batch.ids.push(index, index);
      quads++;
    }
  };
  for (let index = 0; index < blocks.length; index++) {
    if ((index & 8191) === 0) {
      if (cancelled()) return { batches: [], ids: [], quads: 0 };
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const block = doc.palette[blocks[index]];
    if (isAir(block)) continue;
    const [x, y, z] = coordinates(index, doc.dimensions);
    if (!visible(x, y, z)) continue;
    ids.push(index);
    const cull: Cull = {},
      fluidCull: Cull = {};
    for (let direction = 0; direction < 6; direction++) {
      if (spacing && (direction === 2 || direction === 3)) continue;
      const [dx, dy, dz] = offsets[direction],
        nx = x + dx,
        ny = y + dy,
        nz = z + dz;
      if (!visible(nx, ny, nz)) continue;
      const ni = blocks[nx + nz * w + ny * w * d];
      const neighbor = flags(ni);
      cull[directions[direction]] =
        neighbor.opaque || (neighbor.full && flags(blocks[index]).full && ni === blocks[index]);
      const water = flags(blocks[index]).water;
      const sameFluid = water
        ? neighbor.water
        : block.name === 'minecraft:lava' && doc.palette[ni].name === 'minecraft:lava';
      // Water above (including waterlogged models) fills this column up to the layer boundary.
      // Horizontal partial models still expose neighboring fluid faces.
      const fullFluid = ['minecraft:water', 'minecraft:lava', 'minecraft:bubble_column'].includes(
        doc.palette[ni].name,
      );
      const level = Number(block.properties?.level ?? 0),
        neighborLevel = Number(doc.palette[ni].properties?.level ?? 0);
      fluidCull[directions[direction]] =
        neighbor.opaque ||
        (dy > 0 && water && neighbor.water) ||
        (sameFluid &&
          fullFluid &&
          (dy !== 0 ||
            neighborLevel === 0 ||
            neighborLevel >= 8 ||
            (level < 8 && neighborLevel <= level)));
    }
    const parts = library.parts(block, cull, fluidCull);
    append(parts.solid, undefined, index, x, y, z);
    append(parts.fluid, parts.water ? 'water' : undefined, index, x, y, z);
  }
  if (cancelled()) return { batches: [], ids: [], quads: 0 };
  return {
    ids,
    quads,
    batches: [...batches.values()].map((b) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.position, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(b.normal, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(b.color, 3));
      geometry.computeBoundingSphere();
      return { geometry, kind: b.kind, center: b.center, ids: Uint32Array.from(b.ids) };
    }),
  };
}

export function pickedBlock(intersection: THREE.Intersection): number | undefined {
  const ids: Uint32Array | undefined = intersection.object.userData.blockIds;
  return intersection.faceIndex == null ? undefined : ids?.[intersection.faceIndex];
}
