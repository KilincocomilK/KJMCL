import { z } from 'zod';

export const redenKey = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[\p{L}\p{N}_.-]+$/u)
  .refine((k) => k !== '.' && k !== '..');
export const redenSearch = z
  .object({ query: z.string().trim().max(160), page: z.number().int().min(1).max(1000) })
  .strict();
export const redenFile = z.discriminatedUnion('kind', [
  z
    .object({
      key: redenKey,
      kind: z.literal('attachment'),
      index: z.number().int().min(1).max(512),
    })
    .strict(),
  z
    .object({
      key: redenKey,
      kind: z.literal('generator'),
      sizes: z.tuple([
        z.int().min(0).max(65536),
        z.int().min(0).max(65536),
        z.int().min(0).max(65536),
      ]),
    })
    .strict(),
]);
export type RedenPreviewData =
  | { kind: 'model'; doc: import('./projection').ProjectionDocument }
  | { kind: 'layers'; data: import('./types').ResourcePreview };
export type RedenFile = z.infer<typeof redenFile>;
export interface RedenHit {
  key: string;
  name: string;
  author: string;
  downloads: number;
  versions: string[];
}
export interface RedenAxis {
  axis: 'x' | 'y' | 'z';
  min: number;
  max: number;
  modulo: [number, number][];
}
export interface RedenDetails {
  files: { index: number; name: string; size: number; sha256?: string }[];
  axes?: RedenAxis[];
}
export const validAxis = (axis: RedenAxis, value: number) =>
  Number.isInteger(value) &&
  value >= axis.min &&
  value <= axis.max &&
  axis.modulo.every(([m, r]) => value % m === r);
