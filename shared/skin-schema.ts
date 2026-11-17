import { z } from 'zod';
import { skinWorkspaceSchema } from './skin-workspace';
const base64 = z
  .string()
  .max(350000)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/)
  .refine((value) => value.length % 4 === 0, '无效的像素编码');
export const skinProjectSchema = z
  .object({
    workspace: skinWorkspaceSchema.optional(),
    schemaVersion: z.literal(1),
    name: z.string().trim().min(1).max(80),
    resolution: z.union([z.literal(64), z.literal(128), z.literal(256)]),
    model: z.enum(['classic', 'slim']),
    layers: z
      .array(
        z
          .object({
            id: z
              .string()
              .min(1)
              .max(80)
              .regex(/^[a-zA-Z0-9_-]+$/),
            name: z.string().trim().min(1).max(80),
            visible: z.boolean(),
            locked: z.boolean(),
            opacity: z.number().min(0).max(1),
            blend: z.enum([
              'normal',
              'add',
              'multiply',
              'screen',
              'overlay',
              'darken',
              'lighten',
              'colorDodge',
              'colorBurn',
              'hardLight',
              'softLight',
              'difference',
              'exclusion',
              'hue',
              'saturation',
              'color',
              'luminosity',
            ]),
            pixels: base64,
            alphaLock: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    activeLayerId: z.string().min(1).max(80),
    palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/)).max(64),
  })
  .strict()
  .superRefine((project, ctx) => {
    if (new Set(project.layers.map((l) => l.id)).size !== project.layers.length)
      ctx.addIssue({ code: 'custom', message: '图层标识重复' });
    if (!project.layers.some((l) => l.id === project.activeLayerId))
      ctx.addIssue({ code: 'custom', message: '活动图层不存在' });
    for (const [i, layer] of project.layers.entries()) {
      const bytes =
        (layer.pixels.length / 4) * 3 -
        (layer.pixels.endsWith('==') ? 2 : layer.pixels.endsWith('=') ? 1 : 0);
      if (bytes !== project.resolution ** 2 * 4)
        ctx.addIssue({
          code: 'custom',
          path: ['layers', i, 'pixels'],
          message: '图层像素尺寸不匹配',
        });
    }
  });
