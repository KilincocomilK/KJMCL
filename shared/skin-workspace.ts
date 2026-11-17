import { z } from 'zod';
const color = z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/);
const part = z.enum(['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']);
const angles = z.partialRecord(
  part,
  z
    .object({
      x: z.number().min(-180).max(180),
      y: z.number().min(-180).max(180),
      z: z.number().min(-180).max(180),
    })
    .strict(),
);
const image = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().max(80),
    width: z.number().int().min(1).max(512),
    height: z.number().int().min(1).max(512),
    pixels: z
      .string()
      .max(1400000)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    const size =
      (value.pixels.length / 4) * 3 -
      (value.pixels.endsWith('==') ? 2 : value.pixels.endsWith('=') ? 1 : 0);
    if (size !== value.width * value.height * 4)
      ctx.addIssue({ code: 'custom', message: '素材像素尺寸不匹配' });
  });
export const skinWorkspaceSchema = z
  .object({
    palettes: z
      .array(z.object({ name: z.string().min(1).max(40), colors: z.array(color).max(64) }).strict())
      .max(20)
      .default([]),
    references: z.array(image).max(4).default([]),
    brushes: z.array(image).max(8).default([]),
    shortcuts: z.record(z.string().max(40), z.string().regex(/^[a-wyz0-9]$/i)).default({}),
    poseAngles: angles.default({}),
    poses: z
      .array(z.object({ name: z.string().min(1).max(40), angles }).strict())
      .max(20)
      .default([]),
    background: z
      .string()
      .regex(/^#[a-f0-9]{6}$/i)
      .default('#151719'),
    checkerboard: z.boolean().default(true),
  })
  .strict();
export type SkinWorkspace = z.infer<typeof skinWorkspaceSchema>;
export type SkinAsset = SkinWorkspace['references'][number];
export const emptyWorkspace = (): SkinWorkspace => ({
  palettes: [],
  references: [],
  brushes: [],
  shortcuts: {},
  poseAngles: {},
  poses: [],
  background: '#151719',
  checkerboard: true,
});
