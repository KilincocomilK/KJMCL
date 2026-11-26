import path from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { checkGamePath } from './game-folders';
import { instanceSchema } from '../../shared/schema';

/** Launcher configuration files can also contain access tokens. Only return supported game fields. */
export async function configText(file: string) {
  try {
    await checkGamePath(file);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return;
    return (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function configObject(file: string) {
  const text = await configText(file);
  if (text) {
    try {
      return record(JSON.parse(text));
    } catch {
      /* Ignore unrelated or obsolete metadata. */
    }
  }
  return {};
}

export interface ProfileOptions {
  name?: string;
  gameDir?: string;
  ambiguous?: boolean;
  width?: number;
  height?: number;
  memoryMb?: number;
}

export function numericSettings(width: unknown, height: unknown, memory: unknown) {
  const out: ProfileOptions = {};
  if (instanceSchema.shape.width.safeParse(width).success) out.width = Number(width);
  if (instanceSchema.shape.height.safeParse(height).success) out.height = Number(height);
  if (instanceSchema.shape.memoryMb.safeParse(memory).success) out.memoryMb = Number(memory);
  return out;
}

export async function readOfficialProfiles(root: string) {
  const profiles = new Map<string, ProfileOptions>();
  for (const file of ['launcher_profiles.json', 'launcher_profiles_microsoft_store.json']) {
    const config = await configObject(path.join(root, file));
    for (const value of Object.values(record(config.profiles))) {
      const entry = record(value);
      if (typeof entry.lastVersionId !== 'string') continue;
      const gameDir =
        typeof entry.gameDir === 'string' && entry.gameDir.trim()
          ? path.resolve(root, entry.gameDir)
          : root;
      const old = profiles.get(entry.lastVersionId);
      if (old) {
        // KJMCL indexes a version once. Never silently pick one of several worlds.
        if (path.relative(gameDir, old.gameDir!) !== '') old.ambiguous = true;
        continue;
      }
      const heap =
        typeof entry.javaArgs === 'string' &&
        /(?:^|\s)-Xmx(\d+)([mg])(?:\s|$)/i.exec(entry.javaArgs);
      const size = record(entry.resolution);
      profiles.set(entry.lastVersionId, {
        gameDir,
        name:
          typeof entry.name === 'string' ? entry.name.trim().slice(0, 80) || undefined : undefined,
        ...numericSettings(
          size.width,
          size.height,
          heap ? Number(heap[1]) * (heap[2].toLowerCase() === 'g' ? 1024 : 1) : undefined,
        ),
      });
    }
  }
  return profiles;
}

export async function pclIsolation(version: string) {
  const text = await configText(path.join(version, 'PCL', 'Setup.ini'));
  if (!text) return;
  const modern = /^VersionArgumentIndieV2\s*[:=]\s*(True|False)\s*$/im.exec(text);
  if (modern) return modern[1].toLowerCase() === 'true';
  const legacy = /^VersionArgumentIndie\s*[:=]\s*([12])\s*$/im.exec(text);
  if (legacy) return legacy[1] === '1';
}
