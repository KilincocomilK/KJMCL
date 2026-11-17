import { z } from 'zod';

export const projectionAssetsSchema = z
  .object({
    blocks: z
      .array(
        z
          .string()
          .max(160)
          .regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/)
          .refine(
            (v) =>
              !v
                .split(':')[1]
                ?.split('/')
                .some((p) => p === '.' || p === '..'),
          ),
      )
      .max(65536),
    version: z
      .string()
      .max(80)
      .regex(/^[a-zA-Z0-9_.+-]+$/)
      .optional(),
  })
  .strict();
export type ProjectionAssetsRequest = z.infer<typeof projectionAssetsSchema>;
export interface ProjectionAssets {
  version: string;
  source: 'official' | 'local';
  blockstates: Record<string, unknown>;
  models: Record<string, unknown>;
  /** Original PNG bytes, base64 encoded. Keys are namespaced resource identifiers. */
  textures: Record<string, string>;
  /** Original texture .mcmeta JSON, keyed by the same texture identifier. */
  animations: Record<string, unknown>;
  missing: string[];
}
