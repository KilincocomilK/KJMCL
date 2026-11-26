import { z } from 'zod';
import type { Loader } from './types';

export interface PackItem {
  key: string;
  label: string;
  kind: 'required' | 'optional' | 'skipped' | 'blocked';
  reason?: string;
}
export interface PackPreview {
  token: string;
  format: 'Modrinth' | 'CurseForge' | 'KJMCL';
  name: string;
  version: string;
  loader: Loader;
  loaderVersion?: string;
  items: PackItem[];
}
const optionKeys = z.array(z.string().max(1100)).max(20000);
export const confirmPackSchema = z
  .object({
    token: z.uuid(),
    optional: optionKeys,
    trialSourceId: z.uuid().optional(),
  })
  .strict();
export const packInstallSchema = z.object({
  version: z.literal(1),
  archive: z.string().regex(/^[a-f0-9]{64}$/),
  optional: optionKeys,
  phase: z.enum(['game', 'files', 'complete']),
  baseProfile: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  trial: z.object({ sourceId: z.string(), backups: z.array(z.string()).max(10000) }).optional(),
});
export type PackInstall = z.infer<typeof packInstallSchema>;
export const packContentSourceSchema = packInstallSchema.pick({ archive: true, optional: true });
export type PackContentSource = z.infer<typeof packContentSourceSchema>;
export type ConfirmPack = z.infer<typeof confirmPackSchema>;
