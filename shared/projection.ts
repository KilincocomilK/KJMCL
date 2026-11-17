import { z } from 'zod';
export const projectionBlockSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/)
      .max(160),
    properties: z.record(z.string().max(80), z.string().max(120)).optional(),
  })
  .strict();
export type ProjectionBlock = z.infer<typeof projectionBlockSchema>;
const point = z.tuple([
  z.number().int().min(0).max(2047),
  z.number().int().min(0).max(2047),
  z.number().int().min(0).max(2047),
]);
export const projectionOpSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('replace'),
      indices: z.array(z.number().int().min(0).max(1999999)).min(1).max(250000),
      block: projectionBlockSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('delete'),
      indices: z.array(z.number().int().min(0).max(1999999)).min(1).max(250000),
    })
    .strict(),
  z.object({ kind: z.literal('rotate'), direction: z.enum(['cw', 'ccw']) }).strict(),
  z.object({ kind: z.literal('mirror'), axis: z.enum(['x', 'z']) }).strict(),
  z.object({ kind: z.literal('rename'), name: z.string().trim().min(1).max(80) }).strict(),
]);
export type ProjectionOp = z.infer<typeof projectionOpSchema>;
export const projectionSelectionSchema = z
  .object({
    mode: z.enum(['material', 'layer', 'connected', 'box']),
    index: z.number().int().min(0).max(1999999).optional(),
    min: point.optional(),
    max: point.optional(),
  })
  .strict();
export type ProjectionSelection = z.infer<typeof projectionSelectionSchema>;
export interface ProjectionData {
  name: string;
  format: string;
  dataVersion: number;
  dimensions: [number, number, number];
  origin: [number, number, number];
  palette: ProjectionBlock[];
  blocks: string;
  nonAir: number;
  materials: { palette: number; count: number }[];
  warnings: string[];
}
export interface ProjectionDocument extends ProjectionData {
  id: string;
  revision: string;
  canUndo: boolean;
  canRedo: boolean;
}
export interface ProjectionEntry {
  id: string;
  name: string;
  modifiedAt: number;
}
export interface ProjectionState {
  current: ProjectionDocument | null;
  entries: ProjectionEntry[];
}
export const projectionRefSchema = z.object({ id: z.uuid(), revision: z.uuid() }).strict();
export const projectionExportSchema = projectionRefSchema
  .extend({
    format: z.enum(['litematic', 'schem', 'nbt', 'materials', 'png']),
    image: z
      .string()
      .max(32 * 1024 * 1024)
      .optional(),
  })
  .strict();
export const projectionSchemas = {
  projectionState: z.undefined(),
  projectionRecover: z.undefined(),
  projectionImport: z.string().min(1).max(4096).optional(),
  projectionOpen: z.uuid(),
  projectionEdit: projectionRefSchema.extend({ op: projectionOpSchema }).strict(),
  projectionUndo: projectionRefSchema,
  projectionRedo: projectionRefSchema,
  projectionSelect: projectionRefSchema.extend({ selection: projectionSelectionSchema }).strict(),
  projectionExport: projectionExportSchema,
  projectionRemove: z.uuid(),
  projectionInstall: projectionRefSchema
    .extend({
      instanceId: z.string().min(1).max(160),
      format: z.enum(['litematic', 'schem', 'nbt']),
    })
    .strict(),
};
