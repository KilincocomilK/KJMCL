import { z } from 'zod';
export const skinPaletteSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    colors: z
      .array(z.string().regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i))
      .min(1)
      .max(64),
  })
  .strict();
export const skinPaletteFileSchema = skinPaletteSchema.extend({ schemaVersion: z.literal(1) });
export type SkinPalette = z.infer<typeof skinPaletteSchema>;
