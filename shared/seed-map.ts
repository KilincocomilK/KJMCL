import { z } from 'zod';

export const SEED_MAP_BOUND = 30_000_000;
export const seedDimensionSchema = z.enum(['overworld', 'nether', 'end']);
export type SeedDimension = z.infer<typeof seedDimensionSchema>;
const coordinate = z.number().int().min(-SEED_MAP_BOUND).max(SEED_MAP_BOUND);
const viewportCoordinate = z.number().min(-SEED_MAP_BOUND).max(SEED_MAP_BOUND);
const seed = z
  .string()
  .max(20)
  .regex(/^-?\d+$/)
  .refine((value) => {
    try {
      const n = BigInt(value);
      return n >= -(1n << 63n) && n < 1n << 63n;
    } catch {
      return false;
    }
  }, '种子超出 64 位范围');
const requestId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const seedMapQuerySchema = z
  .object({
    seed,
    version: z
      .string()
      .min(1)
      .max(24)
      .regex(/^[a-zA-Z0-9_.-]+$/),
    dimension: seedDimensionSchema,
    y: z.number().int().min(-64).max(320),
    largeBiomes: z.boolean().default(false),
  })
  .strict();
export type SeedMapQuery = z.infer<typeof seedMapQuerySchema>;
export const seedMapTileSchema = seedMapQuerySchema
  .extend({
    requestId,
    x: coordinate,
    z: coordinate,
    step: z.union([z.literal(1), z.literal(4), z.literal(16), z.literal(64), z.literal(256)]),
    size: z.literal(128).default(128),
  })
  .strict()
  .refine((v) => v.x % v.step === 0 && v.z % v.step === 0, '地图像素需对齐坐标');
export type SeedMapTileRequest = z.infer<typeof seedMapTileSchema>;
export const seedMapFeaturesSchema = seedMapQuerySchema
  .extend({
    requestId,
    x0: coordinate,
    z0: coordinate,
    x1: coordinate,
    z1: coordinate,
    types: z
      .array(
        z
          .string()
          .min(1)
          .max(48)
          .regex(/^[A-Za-z_]+$/),
      )
      .max(32),
    limit: z.number().int().min(1).max(1024).default(512),
  })
  .strict()
  .refine(
    (v) => v.x1 >= v.x0 && v.z1 >= v.z0 && v.x1 - v.x0 <= 131072 && v.z1 - v.z0 <= 131072,
    '地图范围过大',
  );
export type SeedMapFeaturesRequest = z.infer<typeof seedMapFeaturesSchema>;
export const seedMapLocateSchema = seedMapQuerySchema
  .extend({
    requestId,
    x: coordinate,
    z: coordinate,
    kind: z.enum(['structure', 'biome']),
    target: z
      .string()
      .min(1)
      .max(48)
      .regex(/^[A-Za-z_0-9]+$/),
    radius: z.number().int().min(64).max(16384),
    limit: z.number().int().min(1).max(32).default(16),
  })
  .strict();
export type SeedMapLocateRequest = z.infer<typeof seedMapLocateSchema>;
export const seedMapPointSchema = seedMapQuerySchema
  .extend({ requestId, x: coordinate, z: coordinate })
  .strict();
export type SeedMapPointRequest = z.infer<typeof seedMapPointSchema>;
export interface SeedMapInfo {
  engine: string;
  revision: string;
  versions: { id: string; name: string }[];
  biomes: {
    id: number;
    name: string;
    color: string;
    dimension: SeedDimension;
    versions?: string[];
  }[];
  structures: {
    id: string;
    name: string;
    dimension: SeedDimension;
    minVersion?: string;
    color?: string;
  }[];
}
export interface SeedMapTile {
  x: number;
  z: number;
  step: number;
  width: number;
  height: number;
  rgba: string;
  biomes: string;
  elapsedMs: number;
  cached?: boolean;
}
export interface SeedMapFeature {
  id: string;
  type: string;
  x: number;
  z: number;
  y?: number;
  approximate: boolean;
  distance?: number;
}
export interface SeedMapFeatures {
  items: SeedMapFeature[];
  spawn?: { x: number; z: number };
  truncated: boolean;
  elapsedMs: number;
}
export interface SeedMapLocation {
  items: SeedMapFeature[];
  searchedRadius: number;
  truncated: boolean;
  elapsedMs: number;
  approximate?: boolean;
  sampleStep?: number;
}
export interface SeedMapBiome {
  id: number;
  name: string;
  color: string;
  slime: boolean;
}
export interface SeedMapWorld {
  name: string;
  seed: string;
  version?: string;
  largeBiomes?: boolean;
  preset?: string;
  spawn?: { x: number; z: number; y?: number };
}
const markerSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(80),
    x: coordinate,
    z: coordinate,
    dimension: seedDimensionSchema,
    color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
    notes: z.string().max(1000).default(''),
  })
  .strict();
export type SeedMapMarker = z.infer<typeof markerSchema>;
export const seedMapDocumentSchema = seedMapQuerySchema
  .extend({
    id: z.uuid(),
    name: z.string().trim().min(1).max(80),
    seedText: z.string().max(256).optional(),
    centerX: viewportCoordinate,
    centerZ: viewportCoordinate,
    zoom: z
      .number()
      .min(1 / 256)
      .max(32),
    structures: z
      .array(
        z
          .string()
          .max(48)
          .regex(/^[A-Za-z_]+$/),
      )
      .max(32),
    grid: z.boolean(),
    slime: z.boolean(),
    highlightBiomes: z.array(z.number().int().min(0).max(255)).max(256).default([]),
    markers: z.array(markerSchema).max(500),
    modifiedAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.markers.map((m) => m.id)).size !== v.markers.length)
      c.addIssue({ code: 'custom', message: '标记编号重复' });
  });
export type SeedMapDocument = z.infer<typeof seedMapDocumentSchema>;
export const seedMapStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    current: seedMapDocumentSchema.nullable(),
    saved: z.array(seedMapDocumentSchema).max(64),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.saved.map((m) => m.id)).size !== v.saved.length)
      c.addIssue({ code: 'custom', message: '地图编号重复' });
  });
export type SeedMapState = z.infer<typeof seedMapStateSchema>;
export const emptySeedMapState = (): SeedMapState => ({
  schemaVersion: 1,
  current: null,
  saved: [],
});
export const seedMapProjectSchema = z
  .object({ schemaVersion: z.literal(1), map: seedMapDocumentSchema })
  .strict();
export const seedMapMarkerFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    seed,
    version: z.string().max(24),
    markers: z.array(markerSchema).max(500),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.markers.map((m) => m.id)).size !== v.markers.length)
      c.addIssue({ code: 'custom', message: '标记编号重复' });
  });

/** Minecraft's Java seed text uses UTF-16 code units and signed 32-bit hashCode. */
export function normalizeSeed(input: string): string {
  const value = input.trim();
  if (!value || value.length > 256) throw new Error('请输入不超过 256 字符的种子');
  if (/^[+-]?\d+$/.test(value)) {
    const n = BigInt(value);
    if (n >= -(1n << 63n) && n < 1n << 63n) return n.toString();
  }
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0;
  return String(hash);
}
/** Java uses int wrapping for x*x before promotion to long in this formula. */
export function isSlimeChunk(seedValue: string, chunkX: number, chunkZ: number): boolean {
  const mask = (1n << 48n) - 1n,
    multiplier = 0x5deece66dn;
  const x = chunkX | 0,
    z = chunkZ | 0;
  const sum =
    BigInt(seedValue) +
    BigInt(Math.imul(Math.imul(x, x), 4987142)) +
    BigInt(Math.imul(x, 5947611)) +
    BigInt(Math.imul(z, z)) * 4392871n +
    BigInt(Math.imul(z, 389711));
  let state = (BigInt.asIntN(64, sum) ^ 987234911n ^ multiplier) & mask;
  for (;;) {
    state = (state * multiplier + 11n) & mask;
    const bits = Number(state >> 17n),
      value = bits % 10;
    if (((bits - value + 9) | 0) >= 0) return value === 0;
  }
}
