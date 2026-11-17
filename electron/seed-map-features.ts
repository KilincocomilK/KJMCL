import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { dialog, type BrowserWindow } from 'electron';
import type { Api, SaveMetadata } from '../shared/types';
import { normalizeSeed, type SeedMapWorld } from '../shared/seed-map';
import { SeedMapEngine } from './core/seed-map';
import { SeedMapStorage } from './core/seed-map-storage';
import type { SaveManager } from './core/save-manager';
import { checkGamePath } from './core/game-folders';

function worldSeed(value: SaveMetadata): SeedMapWorld {
  if (!value.seed) throw new Error('此存档没有可读取的 Java 种子');
  return {
    name: value.name || value.folder,
    seed: value.seed,
    version: value.version,
    largeBiomes: value.generation?.largeBiomes,
    preset: value.generation?.preset ?? undefined,
    spawn:
      value.spawn && value.spawn.x !== null && value.spawn.z !== null
        ? {
            x: value.spawn.x,
            z: value.spawn.z,
            ...(value.spawn.y !== null ? { y: value.spawn.y } : {}),
          }
        : undefined,
  };
}
export function seedMapHandlers(c: {
  engine: SeedMapEngine;
  storage: SeedMapStorage;
  saves: SaveManager;
  window: () => BrowserWindow;
}) {
  const choose = async (title: string, extensions: string[]) => {
    const choice = await dialog.showOpenDialog(c.window(), {
      title,
      properties: ['openFile'],
      filters: [{ name: title, extensions }],
    });
    return choice.canceled ? undefined : choice.filePaths[0];
  };
  return {
    seedMapInfo: () => c.engine.info(),
    seedMapSeed: async (input) => ({ seed: normalizeSeed(input), input: input.trim() }),
    seedMapRandom: async () => randomBytes(8).readBigInt64LE().toString(),
    seedMapTile: (value) => c.engine.tile(value),
    seedMapFeatures: (value) => c.engine.features(value),
    seedMapBiome: (value) => c.engine.biome(value),
    seedMapLocate: (value) => c.engine.locate(value),
    seedMapCancel: async (id) => c.engine.cancel(id),
    seedMapState: () => c.storage.state(),
    seedMapSaveState: (value) => c.storage.save(value),
    seedMapRecoverState: () => c.storage.recover(),
    seedMapImportWorld: async (ref) => {
      if (ref) return worldSeed(await c.saves.metadata(ref));
      const file = await choose('读取 Java 存档 level.dat', ['dat']);
      if (!file) return null;
      if (path.basename(file).toLowerCase() !== 'level.dat')
        throw new Error('请选择存档中的 level.dat');
      await checkGamePath(file);
      return worldSeed(await c.saves.metadataDirectory(path.dirname(file)));
    },
    seedMapImportProject: async () => {
      const file = await choose('打开地图工程', ['kjmap', 'json']);
      return file ? c.storage.importProject(file) : null;
    },
    seedMapImportMarkers: async () => {
      const file = await choose('导入地图标记', ['json']);
      return file ? c.storage.importMarkers(file) : null;
    },
    seedMapExport: async ({ map, format, image }) => {
      const extension = format === 'project' ? 'kjmap' : format === 'markers' ? 'json' : 'png';
      const name =
        map.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\.+$/, '') || 'seed-map';
      const choice = await dialog.showSaveDialog(c.window(), {
        title: '导出地图',
        defaultPath: name + '.' + extension,
        filters: [
          {
            name:
              format === 'project' ? '地图工程' : format === 'markers' ? '地图标记' : '地图 PNG',
            extensions: [extension],
          },
        ],
      });
      if (choice.canceled || !choice.filePath) return null;
      await c.storage.export(map, format, choice.filePath, image);
      return choice.filePath;
    },
  } satisfies Pick<
    Api,
    | 'seedMapInfo'
    | 'seedMapSeed'
    | 'seedMapRandom'
    | 'seedMapTile'
    | 'seedMapFeatures'
    | 'seedMapBiome'
    | 'seedMapLocate'
    | 'seedMapCancel'
    | 'seedMapState'
    | 'seedMapSaveState'
    | 'seedMapRecoverState'
    | 'seedMapImportWorld'
    | 'seedMapImportProject'
    | 'seedMapImportMarkers'
    | 'seedMapExport'
  >;
}
