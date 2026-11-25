import { z } from 'zod';
import { DEFAULT_SIDEBAR_ORDER } from './navigation';
import { redenFile, redenKey, redenSearch } from './reden';
import { assistantSchemas } from './assistant';
import { projectionSchemas } from './projection';
import { projectionAssetsSchema } from './projection-assets';
import { skinProjectSchema } from './skin-schema';
import { skinPaletteSchema } from './skin-palette';
import {
  seedMapTileSchema,
  seedMapFeaturesSchema,
  seedMapLocateSchema,
  seedMapPointSchema,
  seedMapStateSchema,
  seedMapDocumentSchema,
} from './seed-map';
export const systemDialogChoice = z.number().int().nonnegative();
export const systemDialogHeight = z.number().int().positive().max(8192);
export const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_.+-]+$/)
  .refine((v) => v !== '.' && v !== '..');
const fileName = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[^\\/:*?"<>|\x00-\x1f]+$/)
  .refine((v) => v !== '.' && v !== '..');
export const loader = z.enum(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']);
export const organizationSchema = z
  .object({
    favorite: z.boolean(),
    group: z.string().trim().max(40),
    tags: z.array(z.string().trim().min(1).max(24)).max(12),
    notes: z.string().max(2000),
  })
  .strict();
export const contentRefSchema = z.object({
  source: z.enum(['modrinth', 'curseforge']),
  kind: z.enum(['mod', 'resourcepack', 'shader', 'modpack']),
  projectId: id,
});
export const favoriteSchema = contentRefSchema.extend({
  title: z.string().max(300),
  description: z.string().max(10000),
  author: z.string().max(1000),
  downloads: z.number().nonnegative(),
  url: z.url(),
  icon: z.url().optional(),
  group: z.string().max(40),
  savedAt: z.number(),
});
const directory = z
  .string()
  .max(4096)
  .refine((v) => !v.includes('\0'));
export const gameLayoutSchema = z.enum(['auto', 'shared', 'version']);
export const gameFolderSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  path: directory,
  addedAt: z.number(),
  refreshedAt: z.number(),
  error: z.string().optional(),
});
export const settingsSchema = z.object({
  memoryMb: z.number().int().min(512).max(65536),
  javaPath: z.string().max(4096),
  proxy: z.union([
    z.literal(''),
    z.url().refine((v) => ['http:', 'https:'].includes(new URL(v).protocol)),
  ]),
  source: z.enum(['official', 'bmclapi']),
  concurrency: z.number().int().min(1).max(16),
  microsoftClientId: z.union([z.literal(''), z.uuid()]),
  closeOnLaunch: z.boolean(),
  showSnapshots: z.boolean(),
  instancesDir: directory.optional(),
  backupBeforeLaunch: z.boolean().optional(),
});
export const sidebarOrderSchema = z
  .array(z.enum(DEFAULT_SIDEBAR_ORDER))
  .length(DEFAULT_SIDEBAR_ORDER.length)
  .refine((order) => new Set(order).size === order.length, '侧栏入口重复');

export const appearanceControlsSchema = z
  .object({
    dim: z.number().int().min(0).max(80),
    blur: z.number().int().min(0).max(24),
  })
  .strict();
export const appearanceSchema = appearanceControlsSchema.extend({
  backgroundId: z.uuid().optional(),
});
export const launchOptionsSchema = z
  .object({
    accountId: id.optional(),
    fullscreen: z.boolean(),
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('menu') }).strict(),
      z
        .object({
          kind: z.literal('server'),
          address: z
            .string()
            .trim()
            .min(1)
            .max(253)
            .regex(
              /^(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9\u0080-\uffff][a-zA-Z0-9.\-\u0080-\uffff]*)(?::[0-9]{1,5})?$/,
            )
            .refine(
              (v) =>
                !v.includes(':') ||
                v.endsWith(']') ||
                (Number(v.slice(v.lastIndexOf(':') + 1)) > 0 &&
                  Number(v.slice(v.lastIndexOf(':') + 1)) <= 65535),
            ),
        })
        .strict(),
      z.object({ kind: z.literal('world'), name: fileName }).strict(),
    ]),
  })
  .strict();
export const instanceSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  version: fileName,
  loader,
  loaderVersion: id.optional(),
  status: z.enum(['empty', 'installing', 'ready', 'error']),
  createdAt: z.number(),
  lastPlayed: z.number().optional(),
  playTime: z.number(),
  memoryMb: z.number().int().min(512).max(65536),
  javaPath: z.string().max(4096),
  jvmArgs: z.array(z.string().max(4096)).max(64),
  width: z.number().int().min(640).max(7680),
  height: z.number().int().min(480).max(4320),
  error: z.string().optional(),
  gameDir: directory.optional(),
  localRuntime: z.boolean().optional(),
  external: z.object({ folderId: id, versionId: fileName, layout: gameLayoutSchema }).optional(),
  performance: z
    .object({
      memory: z.enum(['manual', 'auto']),
      collector: z.enum(['auto', 'g1', 'zgc']),
      gcLogging: z.boolean(),
    })
    .optional(),
  organization: organizationSchema.optional(),
  launchOptions: launchOptionsSchema.optional(),
});
const none = z.undefined();
export const resourceKind = z.enum([
  'mods',
  'shaderpacks',
  'resourcepacks',
  'replay_recordings',
  'schematics',
]);
const resourcePath = z
  .string()
  .min(1)
  .max(1024)
  .refine((v) => !v.includes('\\') && v.split('/').every((p) => fileName.safeParse(p).success));
const resourceRef = z.object({ id, kind: resourceKind, name: resourcePath });
const worldRef = z.object({ id, world: fileName });
const regionRef = worldRef.extend({
  dimension: z
    .string()
    .min(1)
    .max(512)
    .refine(
      (v) =>
        ['overworld', 'the_nether', 'the_end'].includes(v) ||
        (v.startsWith('dimensions/') && resourcePath.safeParse(v).success),
    ),
  rx: z.number().int().min(-60000).max(60000),
  rz: z.number().int().min(-60000).max(60000),
});
export const schemas = {
  ...assistantSchemas,
  ...projectionSchemas,
  projectionAssets: projectionAssetsSchema,
  projectionImportResource: z.object({ id, name: resourcePath }).strict(),
  seedMapInfo: none,
  seedMapSeed: z.string().trim().min(1).max(256),
  seedMapRandom: none,
  seedMapTile: seedMapTileSchema,
  seedMapFeatures: seedMapFeaturesSchema,
  seedMapBiome: seedMapPointSchema,
  seedMapLocate: seedMapLocateSchema,
  seedMapCancel: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/),
  seedMapState: none,
  seedMapSaveState: seedMapStateSchema,
  seedMapRecoverState: none,
  seedMapImportWorld: z.object({ id, world: fileName }).strict().optional(),
  seedMapImportProject: none,
  seedMapImportMarkers: none,
  seedMapExport: z
    .object({
      map: seedMapDocumentSchema,
      format: z.enum(['project', 'markers', 'png']),
      image: z
        .string()
        .max(32 * 1024 * 1024)
        .startsWith('data:image/png;base64,')
        .optional(),
    })
    .strict(),
  windowFullscreen: z.boolean().optional(),
  skinEditorImportPalette: none,
  skinEditorExportPalette: skinPaletteSchema,
  skinEditorExportAnimation: z
    .object({
      frames: z
        .array(
          z
            .string()
            .max(8 * 1024 * 1024)
            .startsWith('data:image/png;base64,'),
        )
        .min(2)
        .max(120)
        .refine((frames) => frames.reduce((n, f) => n + f.length, 0) <= 48 * 1024 ** 2),
      seconds: z.number().min(0.2).max(30),
    })
    .strict(),
  skinEditorRecoverDraft: none,
  skinEditorVersions: z.uuid(),
  skinEditorRestoreVersion: z.object({ id: z.uuid(), versionId: z.uuid() }).strict(),
  skinEditorImport: z.enum(['skin', 'image']),
  skinEditorImportProject: none,
  skinEditorLoadDraft: none,
  skinEditorSaveDraft: skinProjectSchema,
  skinEditorList: none,
  skinEditorOpen: z.uuid(),
  skinEditorSave: z.object({ id: z.uuid().optional(), project: skinProjectSchema }).strict(),
  skinEditorDelete: z.uuid(),
  skinEditorExport: z
    .object({ project: skinProjectSchema, format: z.enum(['png', 'png64', 'legacy', 'project']) })
    .strict(),
  skinEditorAccount: id,
  skinEditorApply: z.object({ accountId: id, project: skinProjectSchema }).strict(),
  skinEditorCapture: z
    .string()
    .max(24 * 1024 * 1024)
    .startsWith('data:image/png;base64,'),
  exportCompleteLogs: id,
  exportModList: id,
  moveAccount: z.object({ id, direction: z.enum(['up', 'down']) }).strict(),
  launchChoices: id,
  backgroundImage: none,
  pickBackground: none,
  resetBackground: none,
  updateAppearance: appearanceControlsSchema,
  setSidebarOrder: sidebarOrderSchema,
  organizeInstance: z.object({ id, organization: organizationSchema }),
  catalogSearch: contentRefSchema.omit({ projectId: true }).extend({
    id,
    query: z.string().max(120),
    offset: z.number().int().min(0).max(10000),
    sort: z.enum(['relevance', 'downloads', 'updated']),
  }),
  catalogVersions: contentRefSchema.extend({ id, offset: z.number().int().min(0).max(10000) }),
  installContent: contentRefSchema.extend({ id, versionId: id }),
  saveFavorite: contentRefSchema.extend({ group: z.string().trim().max(40) }),
  removeFavorite: contentRefSchema,
  auditMods: id,
  planModBatch: z.object({ id, names: z.array(fileName).min(1).max(2000), enabled: z.boolean() }),
  applyModBatch: z.uuid(),
  diskUsage: none,
  planCacheCleanup: none,
  applyCacheCleanup: z.uuid(),
  crashFiles: id,
  readCrash: z.object({ id, name: resourcePath }),
  exportCrash: z.object({ id, name: resourcePath }),
  saveWorlds: id,
  searchReden: redenSearch,
  redenDetails: redenKey,
  redenDelivery: redenFile,
  openRedenDownload: redenFile,
  previewReden: redenFile,
  installReden: z.object({ id, file: redenFile }).strict(),
  openReden: redenKey,
  scanWorld: worldRef,
  worldRegion: regionRef,
  worldTerrainTiles: worldRef
    .extend({
      dimension: regionRef.shape.dimension,
      side: z.union([z.literal(1), z.literal(8), z.literal(32)]),
      regions: z
        .array(z.object({ rx: regionRef.shape.rx, rz: regionRef.shape.rz }).strict())
        .min(1)
        .max(32),
    })
    .strict(),
  editGameRules: worldRef
    .extend({
      changes: z
        .array(
          z
            .object({
              key: z
                .string()
                .min(1)
                .max(200)
                .regex(/^[a-zA-Z0-9_.:/-]+$/),
              before: z.string().max(128),
              value: z.string().max(128),
            })
            .strict(),
        )
        .min(1)
        .max(128)
        .refine((a) => new Set(a.map((v) => v.key)).size === a.length),
    })
    .strict(),
  planWorldSelection: worldRef
    .extend({
      dimension: regionRef.shape.dimension,
      groups: z
        .array(
          z
            .object({
              rx: regionRef.shape.rx,
              rz: regionRef.shape.rz,
              indices: z.array(z.int().min(0).max(1023)).min(1).max(1024),
            })
            .strict(),
        )
        .min(1)
        .max(64)
        .refine(
          (a) =>
            a.reduce((n, g) => n + g.indices.length, 0) <= 8192 &&
            new Set(a.map((g) => [g.rx, g.rz].join(','))).size === a.length,
        ),
      protectSpawn: z.int().min(0).max(128),
      maxInhabitedTicks: z.int().nonnegative().optional(),
      beforeTimestamp: z.int().min(0).max(4294967295).optional(),
    })
    .strict(),
  planWorldPrune: regionRef.extend({
    indices: z.array(z.number().int().min(0).max(1023)).min(1).max(1024),
    protectSpawn: z.number().int().min(0).max(128),
    maxInhabitedTicks: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    beforeTimestamp: z.number().int().min(0).max(4294967295).optional(),
  }),
  applyWorldPrune: z.uuid(),
  editWorld: worldRef.extend({
    patch: z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        gameType: z.number().int().min(0).max(3).optional(),
        difficulty: z.number().int().min(0).max(3).optional(),
        hardcore: z.boolean().optional(),
        commands: z.boolean().optional(),
        spawnX: z.number().int().min(-30000000).max(30000000).optional(),
        spawnY: z.number().int().min(-2048).max(2048).optional(),
        spawnZ: z.number().int().min(-30000000).max(30000000).optional(),
      })
      .strict(),
  }),
  undoWorldEdit: worldRef.extend({ transaction: id }),
  revealWorld: worldRef,
  exportWorld: worldRef,
  inspectResources: z.array(directory.min(1)).min(1).max(100),
  pickResources: none,
  importResources: z
    .array(
      z.object({ token: z.uuid(), id, kind: resourceKind, conflict: z.enum(['skip', 'rename']) }),
    )
    .min(1)
    .max(100),
  resources: id,
  localResourceCards: z
    .object({
      id,
      kind: z.enum(['mods', 'resourcepacks', 'worlds']),
      names: z.array(fileName).min(1).max(16),
    })
    .strict(),
  previewResource: resourceRef,
  renameResource: resourceRef.extend({ newName: fileName }),
  deleteResource: resourceRef,
  revealResource: resourceRef,
  exportResource: resourceRef,
  terracottaStatus: none,
  installTerracotta: none,
  startTerracotta: none,
  controlTerracotta: z.object({
    action: z.enum(['host', 'join', 'leave']),
    room: z.string().trim().min(1).max(256).optional(),
    player: z.string().trim().min(1).max(64).optional(),
  }),
  finishStorageSetup: none,
  migrateStorage: directory,
  cleanupStorage: none,
  restartLauncher: none,
  snapshot: none,
  checkLauncherUpdate: none,
  openLauncherRelease: none,
  dismissNotification: z.union([
    z.object({ taskId: z.uuid() }).strict(),
    z.object({ version: z.string().min(1).max(128) }).strict(),
  ]),
  lightweightState: none,
  setLightweight: z.boolean(),
  settings: settingsSchema,
  select: z.object({
    accountId: id.optional(),
    instanceId: id.optional(),
    folderId: id.optional(),
  }),
  addOffline: z.string().regex(/^[a-zA-Z0-9_]{3,16}$/),
  removeAccount: id,
  beginLogin: none,
  cancelLogin: none,
  versions: none,
  loaders: z.object({ version: id, loader }),
  createInstance: z.object({
    name: z.string().trim().min(1).max(80),
    version: id,
    loader,
    loaderVersion: id.optional(),
    gameDir: directory.optional(),
  }),
  updateInstance: instanceSchema,
  deleteInstance: id,
  install: id,
  launch: id,
  stop: id,
  checkLaunch: id,
  sessions: id,
  exportDiagnosis: z.object({ id, sessionId: id }),
  videoSettings: id,
  applyVideoPreset: z.object({ id, preset: z.enum(['balanced', 'low']) }),
  restoreVideoPreset: id,
  logs: id,
  exportLogs: id,
  java: none,
  pickJava: none,
  installJava: z
    .number()
    .int()
    .refine((v) => [8, 16, 17, 21, 25].includes(v)),
  mods: id,
  importMods: id,
  toggleMod: z.object({ id, name: fileName }),
  deleteMod: z.object({ id, name: fileName }),
  searchMods: z.object({
    id,
    query: z.string().max(120),
    offset: z.number().int().min(0).max(10000),
  }),
  installMod: z.object({ id, projectId: id }),
  updateMods: id,
  importPack: none,
  exportPack: id,
  pickDirectory: none,
  cloneInstance: z.object({
    id,
    name: z.string().trim().min(1).max(80),
    includeSaves: z.boolean(),
    gameDir: directory.optional(),
  }),
  relocateInstance: z.object({ id, directory }),
  scanMinecraft: none,
  importMinecraft: z.object({
    selectionId: id,
    name: z.string().trim().min(1).max(80),
    layouts: z.array(z.object({ versionId: fileName, layout: gameLayoutSchema })).max(2000),
  }),
  refreshGameFolder: id,
  removeGameFolder: id,
  setGameLayout: z.object({ id, layout: gameLayoutSchema }),
  worlds: id,
  backups: id,
  chooseBackupExport: worldRef,
  backupWorld: worldRef.extend({ exportToken: z.uuid().optional() }).strict(),
  restoreBackup: z.object({ id, backupId: id }),
  deleteBackup: z.object({ id, backupId: id }),
  loginThirdParty: z.object({
    server: z
      .url()
      .refine(
        (v) =>
          new URL(v).protocol === 'https:' &&
          !new URL(v).username &&
          !new URL(v).password &&
          !new URL(v).search &&
          !new URL(v).hash,
      ),
    username: z.string().min(1).max(320),
    password: z.string().min(1).max(4096),
  }),
  selectProfile: z.object({ accountId: id, uuid: z.string().regex(/^[a-fA-F0-9]{32}$/) }),
  skinPreview: id,
  uploadSkin: z.object({ id, variant: z.enum(['classic', 'slim']) }),
  resetSkin: id,
  integrationKey: z.object({
    service: z.enum(['curseforge', 'modrinth']),
    key: z.string().max(4096),
  }),
  searchCurseForge: z.object({
    id,
    query: z.string().max(120),
    offset: z.number().int().min(0).max(9980),
  }),
  installCurseForge: z.object({ id, projectId: z.number().int().positive() }),
  updateCurseForge: id,
  preparePack: z.object({
    id,
    format: z.enum(['mrpack', 'curseforge']),
    name: z.string().min(1).max(80),
    version: z.string().min(1).max(64),
    author: z.string().max(80),
    summary: z.string().max(500),
  }),
  publishPack: z.object({
    ticket: id,
    projectId: id,
    changelog: z.string().max(20000),
    channel: z.enum(['release', 'beta', 'alpha']),
  }),
  openFolder: z.object({
    id: id.optional(),
    folder: z
      .enum([
        'mods',
        'saves',
        'resourcepacks',
        'shaderpacks',
        'screenshots',
        'logs',
        'replay_recordings',
        'schematics',
      ])
      .optional(),
  }),
  cancelTask: id,
  external: z.url(),
  window: z.enum(['minimize', 'maximize', 'close']),
};
