import type { AssistantApi } from './assistant';
import type { SidebarEntry } from './navigation';
export type Loader = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge';
export type GameLayout = 'auto' | 'shared' | 'version';
export type WelcomeProgress =
  | { step: 'start' | 'done' }
  | { step: 'folders' | 'java' | 'account' | 'assistant' | 'finish'; player: 'new' | 'returning' };
export const welcomeSections = [
  'newDirectory',
  'importDirectory',
  'java',
  'account',
  'assistant',
] as const;
export type WelcomeSection = (typeof welcomeSections)[number];
export function welcomeSection(progress: WelcomeProgress): WelcomeSection | undefined {
  if (progress.step === 'folders')
    return progress.player === 'new' ? 'newDirectory' : 'importDirectory';
  if (progress.step === 'java' || progress.step === 'account' || progress.step === 'assistant')
    return progress.step;
}
export interface GameFolder {
  id: string;
  name: string;
  path: string;
  addedAt: number;
  refreshedAt: number;
  error?: string;
}
export interface Account {
  id: string;
  name: string;
  uuid: string;
  kind: 'offline' | 'microsoft' | 'yggdrasil';
  skin?: string;
  authServer?: string;
  microsoftClientId?: string;
}
export type VersionTrial = { version: 1; sourceId: string } & (
  { phase: 'copy' | 'install' } | { phase: 'commit'; entries: string[] }
);
export interface Instance {
  versionTrial?: VersionTrial;
  packContentSource?: import('./pack').PackContentSource;
  packInstall?: import('./pack').PackInstall;
  id: string;
  name: string;
  version: string;
  loader: Loader;
  loaderVersion?: string;
  status: 'empty' | 'installing' | 'ready' | 'error';
  createdAt: number;
  lastPlayed?: number;
  lastLaunchedAt?: number;
  playTime: number;
  memoryMb: number;
  javaPath: string;
  jvmArgs: string[];
  width: number;
  height: number;
  error?: string;
  gameDir?: string;
  localRuntime?: boolean;
  performance?: PerformanceSettings;
  organization?: InstanceOrganization;
  external?: { folderId: string; versionId: string; layout: GameLayout };
  launchOptions?: InstanceLaunchOptions;
}
export interface InstanceLaunchOptions {
  accountId?: string;
  fullscreen: boolean;
  target: { kind: 'menu' } | { kind: 'server'; address: string } | { kind: 'world'; name: string };
}
export interface LaunchChoices {
  server: boolean;
  world: boolean;
  worlds: string[];
}
export interface InstanceOrganization {
  favorite: boolean;
  group: string;
  tags: string[];
  notes: string;
}
export type ContentKind = 'mod' | 'resourcepack' | 'shader' | 'modpack';
export type ContentSource = 'modrinth' | 'curseforge';
export interface ContentRef {
  source: ContentSource;
  kind: ContentKind;
  projectId: string;
}
export interface ContentProject extends ContentRef {
  title: string;
  description: string;
  author: string;
  downloads: number;
  url: string;
  icon?: string;
}
export interface ContentFavorite extends ContentProject {
  group: string;
  savedAt: number;
}
export interface ContentVersion {
  id: string;
  name: string;
  published: string;
  channel: string;
  fileName: string;
  bytes: number;
  gameVersions: string[];
  loaders: string[];
  dependencies: number;
  downloadable: boolean;
}
export interface ModAuditEntry {
  name: string;
  enabled: boolean;
  ids: string[];
  version?: string;
  loader?: string;
  requires: string[];
  issues: { level: 'error' | 'warning'; message: string }[];
}
export interface ModBatchReview {
  token: string;
  changes: { from: string; to: string }[];
}
export interface DiskRow {
  key: string;
  label: string;
  bytes: number;
  files: number;
  skipped: number;
}
export interface DiskReport {
  rows: DiskRow[];
  scannedAt: number;
  warnings: string[];
}
export interface CacheReview {
  token: string;
  files: number;
  bytes: number;
}
export interface CrashFile {
  name: string;
  kind: 'crash' | 'jvm' | 'log';
  bytes: number;
  modifiedAt: number;
}
export interface CrashReport {
  file: CrashFile;
  text: string;
  truncated: boolean;
  diagnoses: Diagnosis[];
}
export interface PerformanceSettings {
  memory: 'manual' | 'auto';
  collector: 'auto' | 'g1' | 'zgc';
  gcLogging: boolean;
}
export interface LaunchIssue {
  code: string;
  level: 'error' | 'warning';
  message: string;
}
export interface LaunchCheck {
  requiredJava: number;
  runtime?: JavaRuntime;
  memoryMb: number;
  totalMb: number;
  availableMb: number;
  managedArgs: string[];
  issues: LaunchIssue[];
  checkedFiles: number;
  tested: boolean;
}
export interface Diagnosis {
  title: string;
  suggestion: string;
  evidence: string;
}
export interface LaunchSession {
  id: string;
  instanceId: string;
  startedAt: number;
  endedAt?: number;
  status: 'preparing' | 'running' | 'exited' | 'failed' | 'stopped' | 'interrupted';
  phase: string;
  /** Highest milestone actually observed in this session. Absent on legacy records. */
  milestone?: 'java' | 'loading' | 'world';
  worldEnteredAt?: number;
  failure?: { reason: string; action: 'account' | 'resources' | 'diagnostics'; accountId?: string };
  runtime?: JavaRuntime;
  memoryMb?: number;
  collector?: PerformanceSettings['collector'];
  exitCode?: number | null;
  signal?: string | null;
  gcLog?: string;
  gc?: { pauses: number; maxPauseMs: number; totalPauseMs: number; scope: string };
  diagnoses: Diagnosis[];
  tail: LogLine[];
}
export interface VideoPresetState {
  values: Record<string, string>;
  canRestore: boolean;
}
export interface Settings {
  memoryMb: number;
  javaPath: string;
  proxy: string;
  source: 'official' | 'bmclapi';
  concurrency: number;
  microsoftClientId: string;
  closeOnLaunch: boolean;
  showSnapshots: boolean;
  instancesDir?: string;
  backupBeforeLaunch?: boolean;
}
export interface Appearance {
  backgroundId?: string;
  dim: number;
  blur: number;
}
export interface Task {
  scope?: string;
  kind?: 'download';
  id: string;
  title: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  detail: string;
  createdAt: number;
  remainingSeconds?: number;
  finishedAt?: number;
  notificationDismissed?: boolean;
}
export interface SystemDialogContent {
  message: string;
  detail?: string;
  paths?: string[];
  buttons: string[];
  defaultId: number;
  cancelId: number;
}
export interface SystemDialogApi {
  read(): Promise<SystemDialogContent>;
  ready(height: number): void;
  choose(index: number): void;
}

export interface LauncherUpdate {
  status: 'idle' | 'checking' | 'current' | 'available' | 'unpublished' | 'unavailable';
  version?: string;
  checkedAt?: number;
  issue?: 'access' | 'network' | 'release' | 'rate-limit';
  notificationDismissed?: boolean;
}
export type ActivityRef = { taskId: string } | { version: string };
export type LauncherActivity = { task: Task } | { version: string };
export interface JavaRuntime {
  path: string;
  version: string;
  major: number;
  arch: string;
  vendor?: string;
  vm?: string;
}
export interface ModUpdateItem {
  source: 'modrinth' | 'curseforge';
  projectId: string;
  previousFile?: string;
  previousVersion?: string;
  file: string;
  version: string;
  size: number;
  disabled: boolean;
}
export interface ModUpdatePreview {
  token: string;
  items: ModUpdateItem[];
}
export interface ModUpdateReceipt {
  updatedAt: number;
  count: number;
}
export interface ModFile {
  name: string;
  enabled: boolean;
  size: number;
  projectId?: string;
  versionId?: string;
  source?: 'modrinth' | 'curseforge';
}
export interface ModProject {
  project_id: string;
  title: string;
  description: string;
  icon_url?: string;
  downloads: number;
  author: string;
  slug: string;
}
export interface VersionSummary {
  id: string;
  type: string;
  releaseTime: string;
  url: string;
  sha1?: string;
}
export interface Snapshot {
  selectedLaunch?: Pick<
    LaunchSession,
    'id' | 'instanceId' | 'startedAt' | 'status' | 'phase' | 'failure'
  >;
  /** Public user code for the active Microsoft authorization, held in memory only. */
  microsoftLoginCode?: DeviceCode;
  welcome?: WelcomeProgress;
  welcomeConfigured?: WelcomeSection[];
  sidebarOrder?: SidebarEntry[];
  assistantPending?: number;
  appearance?: Appearance;
  gameFolders: GameFolder[];
  selectedGameFolderId?: string;
  favorites?: ContentFavorite[];
  accounts: Account[];
  instances: Instance[];
  settings: Settings;
  selectedAccountId?: string;
  selectedInstanceId?: string;
  tasks: Task[];
  running: string[];
  dataPath: string;
  platform: string;
  appVersion: string;
  launcherUpdate?: LauncherUpdate;
  integrations?: { curseforge: boolean; modrinth: boolean };
  storage?: StorageInfo;
}
export interface StorageInfo {
  mode: 'installed' | 'portable' | 'override';
  controlPath: string;
  setupRequired: boolean;
  pendingRestart?: string;
  retired?: { path: string; files: number; bytes: number };
}
export interface World {
  name: string;
  modifiedAt: number;
}
export interface Backup {
  sha256: string;
  id: string;
  world: string;
  createdAt: number;
  size: number;
}
export interface MinecraftScan {
  selectionId: string;
  root: string;
  versions: { id: string; name: string; gameDir: string; layout: GameLayout; error?: string }[];
}
export interface MigrationSource {
  id: string;
  root: string;
  launchers: string[];
}
export interface PackOptions {
  id: string;
  format: 'mrpack' | 'curseforge';
  name: string;
  version: string;
  author: string;
  summary: string;
}
export interface PackReview {
  ticket: string;
  path: string;
  sha256: string;
  files: number;
  size: number;
  name: string;
  version: string;
}
export interface DeviceCode {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}
export interface LogLine {
  time: number;
  instanceId: string;
  level: 'info' | 'error';
  text: string;
}
export interface LightweightState {
  active: boolean;
  visible: boolean;
  games: { id: string; name: string; phase?: string }[];
  tasks: number;
  activity?: LauncherActivity;
}
export type LauncherEvent =
  | { type: 'folder-scan'; active: boolean }
  | { type: 'assistant' }
  | { type: 'assistant-progress'; progress: import('./assistant').AiProgress }
  | { type: 'state' }
  | { type: 'log'; line: LogLine }
  | { type: 'lightweight'; state: LightweightState }
  | { type: 'window-visibility'; visible: boolean }
  | { type: 'window-fullscreen'; fullscreen: boolean }
  | { type: 'mode-error'; message: string };
export type ResourceKind =
  'mods' | 'shaderpacks' | 'resourcepacks' | 'replay_recordings' | 'schematics';
export interface ResourceFile {
  name: string;
  kind: ResourceKind;
  size: number;
  modifiedAt: number;
}
export type LocalCardKind = 'mods' | 'resourcepacks' | 'worlds';
export interface LocalResourceCard {
  name: string;
  title?: string;
  localizedTitle?: string;
  description?: string;
  modId?: string;
  version?: string;
  icon?: string;
}
export interface ResourcePreview {
  title: string;
  description?: string;
  image?: string;
  details: { label: string; value: string }[];
  layers?: { name: string; width: number; depth: number; cells: string[] }[];
  warning?: string;
}
export interface ResourceCandidate {
  token: string;
  name: string;
  size: number;
  kind?: ResourceKind;
  reason: string;
  suggestedInstanceId?: string;
  candidateIds: string[];
  error?: string;
}
export interface ResourceImportChoice {
  token: string;
  id: string;
  kind: ResourceKind;
  conflict: 'skip' | 'rename';
}
export interface ResourceImportResult {
  name: string;
  status: 'added' | 'skipped' | 'failed';
  detail: string;
}
export interface TerracottaState {
  installed: boolean;
  connected: boolean;
  version?: string;
  state: string;
  room?: string;
  address?: string;
  difficulty?: string;
  error?: string;
  members: { name: string; kind: string; vendor: string }[];
}
export interface Api extends AssistantApi {
  setWelcome(progress: WelcomeProgress): Promise<void>;
  markWelcomeConfigured(section: WelcomeSection): Promise<void>;
  prepareGameDirectory(choice: 'default' | 'choose'): Promise<string | null>;
  projectionAssets(
    value: import('./projection-assets').ProjectionAssetsRequest,
  ): Promise<import('./projection-assets').ProjectionAssets>;
  projectionState(): Promise<import('./projection').ProjectionState>;
  projectionRecover(): Promise<import('./projection').ProjectionState | null>;
  projectionImport(path?: string): Promise<import('./projection').ProjectionDocument | null>;
  projectionImportResource(value: {
    id: string;
    name: string;
  }): Promise<import('./projection').ProjectionDocument>;
  projectionOpen(id: string): Promise<import('./projection').ProjectionDocument>;
  projectionEdit(value: {
    id: string;
    revision: string;
    op: import('./projection').ProjectionOp;
  }): Promise<import('./projection').ProjectionDocument>;
  projectionUndo(value: {
    id: string;
    revision: string;
  }): Promise<import('./projection').ProjectionDocument>;
  projectionRedo(value: {
    id: string;
    revision: string;
  }): Promise<import('./projection').ProjectionDocument>;
  projectionSelect(value: {
    id: string;
    revision: string;
    selection: import('./projection').ProjectionSelection;
  }): Promise<{ indices: number[] }>;
  projectionExport(value: {
    id: string;
    revision: string;
    format: 'litematic' | 'schem' | 'nbt' | 'materials' | 'png';
    image?: string;
  }): Promise<string | null>;
  projectionInstall(value: {
    id: string;
    revision: string;
    instanceId: string;
    format: 'litematic' | 'schem' | 'nbt';
  }): Promise<string>;
  projectionRemove(id: string): Promise<void>;
  seedMapInfo(): Promise<import('./seed-map').SeedMapInfo>;
  seedMapSeed(input: string): Promise<{ seed: string; input: string }>;
  seedMapRandom(): Promise<string>;
  seedMapTile(
    value: import('./seed-map').SeedMapTileRequest,
  ): Promise<import('./seed-map').SeedMapTile>;
  seedMapFeatures(
    value: import('./seed-map').SeedMapFeaturesRequest,
  ): Promise<import('./seed-map').SeedMapFeatures>;
  seedMapBiome(
    value: import('./seed-map').SeedMapPointRequest,
  ): Promise<import('./seed-map').SeedMapBiome>;
  seedMapLocate(
    value: import('./seed-map').SeedMapLocateRequest,
  ): Promise<import('./seed-map').SeedMapLocation>;
  seedMapCancel(requestId: string): Promise<void>;
  seedMapState(): Promise<import('./seed-map').SeedMapState>;
  seedMapSaveState(value: import('./seed-map').SeedMapState): Promise<void>;
  seedMapRecoverState(): Promise<import('./seed-map').SeedMapState | null>;
  seedMapImportWorld(value?: WorldRef): Promise<import('./seed-map').SeedMapWorld | null>;
  seedMapImportProject(): Promise<import('./seed-map').SeedMapDocument | null>;
  seedMapImportMarkers(): Promise<{
    seed: string;
    version: string;
    markers: import('./seed-map').SeedMapMarker[];
  } | null>;
  seedMapExport(value: {
    map: import('./seed-map').SeedMapDocument;
    format: 'project' | 'markers' | 'png';
    image?: string;
  }): Promise<string | null>;
  windowFullscreen(value?: boolean): Promise<boolean>;
  skinEditorImportPalette(): Promise<import('./skin-palette').SkinPalette | null>;
  skinEditorExportPalette(value: import('./skin-palette').SkinPalette): Promise<string | null>;
  skinEditorExportAnimation(value: { frames: string[]; seconds: number }): Promise<string | null>;
  skinEditorRecoverDraft(): Promise<SkinProject | null>;
  skinEditorVersions(id: string): Promise<SkinEditorVersion[]>;
  skinEditorRestoreVersion(value: { id: string; versionId: string }): Promise<SkinProject>;
  skinEditorImport(mode: 'skin' | 'image'): Promise<SkinEditorImage | null>;
  skinEditorImportProject(): Promise<SkinProject | null>;
  skinEditorLoadDraft(): Promise<SkinProject | null>;
  skinEditorSaveDraft(project: SkinProject): Promise<void>;
  skinEditorList(): Promise<SkinEditorEntry[]>;
  skinEditorOpen(id: string): Promise<SkinProject>;
  skinEditorSave(value: { id?: string; project: SkinProject }): Promise<string>;
  skinEditorDelete(id: string): Promise<boolean>;
  skinEditorExport(value: {
    project: SkinProject;
    format: 'png' | 'png64' | 'legacy' | 'project';
  }): Promise<string | null>;
  skinEditorAccount(id: string): Promise<SkinEditorImage | null>;
  skinEditorApply(value: { accountId: string; project: SkinProject }): Promise<boolean>;
  skinEditorCapture(dataUrl: string): Promise<string | null>;
  exportCompleteLogs(id: string): Promise<string | null>;
  exportModList(id: string): Promise<string | null>;
  moveAccount(value: { id: string; direction: 'up' | 'down' }): Promise<void>;
  launchChoices(id: string): Promise<LaunchChoices>;
  organizeInstance(value: { id: string; organization: InstanceOrganization }): Promise<void>;
  catalogSearch(value: {
    id?: string;
    source: ContentSource;
    kind: ContentKind;
    query: string;
    offset: number;
    sort: 'relevance' | 'downloads' | 'updated';
  }): Promise<{ items: ContentProject[]; total: number }>;
  catalogVersions(
    value: ContentRef & { id?: string; offset: number },
  ): Promise<{ items: ContentVersion[]; more: boolean }>;
  installContent(
    value: ContentRef & { kind: Exclude<ContentKind, 'modpack'>; id: string; versionId: string },
  ): Promise<string>;
  saveFavorite(value: ContentRef & { group: string }): Promise<void>;
  removeFavorite(value: ContentRef): Promise<void>;
  auditMods(id: string): Promise<ModAuditEntry[]>;
  planModBatch(value: { id: string; names: string[]; enabled: boolean }): Promise<ModBatchReview>;
  applyModBatch(token: string): Promise<void>;
  diskUsage(): Promise<DiskReport>;
  planCacheCleanup(): Promise<CacheReview>;
  applyCacheCleanup(token: string): Promise<{ files: number; bytes: number; skipped: number }>;
  crashFiles(id: string): Promise<CrashFile[]>;
  readCrash(value: { id: string; name: string }): Promise<CrashReport>;
  exportCrash(value: { id: string; name: string }): Promise<string | null>;
  saveWorlds(id: string): Promise<SaveMetadata[]>;
  searchReden(value: {
    query: string;
    page: number;
  }): Promise<{ items: import('./reden').RedenHit[]; more: boolean }>;
  redenDelivery(file: import('./reden').RedenFile): Promise<{ host: string } | null>;
  openRedenDownload(file: import('./reden').RedenFile): Promise<void>;
  redenDetails(key: string): Promise<import('./reden').RedenDetails>;
  previewReden(file: import('./reden').RedenFile): Promise<import('./reden').RedenPreviewData>;
  installReden(value: { id: string; file: import('./reden').RedenFile }): Promise<string>;
  openReden(key: string): Promise<void>;
  scanWorld(value: WorldRef): Promise<SaveScan>;
  worldRegion(value: WorldRegionRef): Promise<SaveRegionView>;
  worldTerrainTiles(value: TerrainTileRequest): Promise<TerrainTile[]>;
  planWorldSelection(value: SaveSelectionRequest): Promise<SavePruneReview>;
  editGameRules(value: WorldRef & { changes: RuleChange[] }): Promise<boolean>;
  planWorldPrune(
    value: WorldRegionRef & {
      indices: number[];
      protectSpawn: number;
      maxInhabitedTicks?: number;
      beforeTimestamp?: number;
    },
  ): Promise<SavePruneReview>;
  applyWorldPrune(token: string): Promise<string>;
  editWorld(value: WorldRef & { patch: SavePatch }): Promise<void>;
  undoWorldEdit(value: WorldRef & { transaction: string }): Promise<void>;
  revealWorld(value: WorldRef): Promise<void>;
  exportWorld(value: WorldRef): Promise<string | null>;
  droppedPaths(files: File[]): string[];
  inspectResources(paths: string[]): Promise<ResourceCandidate[]>;
  pickResources(): Promise<ResourceCandidate[]>;
  importResources(choices: ResourceImportChoice[]): Promise<ResourceImportResult[]>;
  resources(id: string): Promise<ResourceFile[]>;
  localResourceCards(value: {
    id: string;
    kind: LocalCardKind;
    names: string[];
  }): Promise<LocalResourceCard[]>;
  previewResource(value: {
    id: string;
    kind: ResourceKind;
    name: string;
  }): Promise<ResourcePreview>;
  renameResource(value: {
    id: string;
    kind: ResourceKind;
    name: string;
    newName: string;
  }): Promise<void>;
  deleteResource(value: { id: string; kind: ResourceKind; name: string }): Promise<void>;
  revealResource(value: { id: string; kind: ResourceKind; name: string }): Promise<void>;
  exportResource(value: { id: string; kind: ResourceKind; name: string }): Promise<void>;
  terracottaStatus(): Promise<TerracottaState>;
  installTerracotta(): Promise<string>;
  startTerracotta(): Promise<void>;
  controlTerracotta(value: {
    action: 'host' | 'join' | 'leave';
    room?: string;
    player?: string;
  }): Promise<void>;
  finishStorageSetup(): Promise<void>;
  migrateStorage(directory: string): Promise<string>;
  cleanupStorage(): Promise<string | null>;
  restartLauncher(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  checkLauncherUpdate(): Promise<void>;
  openLauncherRelease(): Promise<void>;
  dismissNotification(value: ActivityRef): Promise<void>;
  backgroundImage(): Promise<string | null>;
  pickBackground(): Promise<void>;
  resetBackground(): Promise<void>;
  updateAppearance(value: Pick<Appearance, 'dim' | 'blur'>): Promise<void>;
  setSidebarOrder(order: SidebarEntry[]): Promise<void>;
  lightweightState(): Promise<LightweightState>;
  setLightweight(active: boolean): Promise<void>;
  settings(value: Settings): Promise<void>;
  select(value: { accountId?: string; instanceId?: string; folderId?: string }): Promise<void>;
  addOffline(name: string): Promise<Account>;
  removeAccount(id: string): Promise<void>;
  beginLogin(accountId?: string): Promise<DeviceCode>;
  cancelLogin(): Promise<void>;
  versions(): Promise<VersionSummary[]>;
  loaders(value: { version: string; loader: Loader }): Promise<string[]>;
  createInstance(value: {
    name: string;
    version: string;
    loader: Loader;
    loaderVersion?: string;
    gameDir?: string;
  }): Promise<string>;
  trialVersion(value: {
    sourceId: string;
    name: string;
    version: string;
    loader: Loader;
    loaderVersion?: string;
  }): Promise<string>;
  updateInstance(value: Instance): Promise<void>;
  deleteInstance(id: string): Promise<void>;
  install(id: string): Promise<string>;
  launch(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  checkLaunch(id: string): Promise<LaunchCheck>;
  sessions(id: string): Promise<LaunchSession[]>;
  exportDiagnosis(value: { id: string; sessionId: string }): Promise<void>;
  videoSettings(id: string): Promise<VideoPresetState>;
  applyVideoPreset(value: { id: string; preset: 'balanced' | 'low' }): Promise<void>;
  restoreVideoPreset(id: string): Promise<void>;
  logs(id: string): Promise<LogLine[]>;
  exportLogs(id: string): Promise<void>;
  java(): Promise<JavaRuntime[]>;
  welcomeJavaInfo(): Promise<{ available: JavaRuntime[]; memoryMb: number }>;
  configureWelcomeJava(input: { major: number; allowInstall: boolean }): Promise<string>;
  pickJava(): Promise<string | null>;
  installJava(major: number): Promise<string>;
  mods(id: string): Promise<ModFile[]>;
  importMods(id: string): Promise<void>;
  toggleMod(value: { id: string; name: string }): Promise<void>;
  deleteMod(value: { id: string; name: string }): Promise<void>;
  searchMods(value: {
    id: string;
    query: string;
    offset: number;
  }): Promise<{ hits: ModProject[]; total_hits: number }>;
  installMod(value: { id: string; projectId: string }): Promise<string>;
  previewModUpdates(id: string): Promise<ModUpdatePreview>;
  applyModUpdates(value: { id: string; token: string }): Promise<string>;
  lastModUpdate(id: string): Promise<ModUpdateReceipt | null>;
  undoModUpdates(id: string): Promise<void>;
  previewPack(): Promise<import('./pack').PackPreview | null>;
  previewOnlinePack(
    value: ContentRef & { kind: 'modpack'; id?: string; versionId: string },
  ): Promise<import('./pack').PackPreview>;
  confirmPack(value: import('./pack').ConfirmPack): Promise<string>;
  discardPack(token: string): Promise<void>;
  exportPack(id: string): Promise<void>;
  pickDirectory(): Promise<string | null>;
  cloneInstance(value: {
    id: string;
    name: string;
    includeSaves: boolean;
    gameDir?: string;
  }): Promise<string>;
  relocateInstance(value: { id: string; directory: string }): Promise<string>;
  scanMinecraft(): Promise<MinecraftScan | null>;
  discoverLaunchers(): Promise<MigrationSource[]>;
  pickLauncher(): Promise<MigrationSource[] | null>;
  previewLauncher(id: string): Promise<MinecraftScan>;
  copyLauncher(value: Parameters<Api['importMinecraft']>[0]): Promise<string | null>;
  importMinecraft(value: {
    selectionId: string;
    name: string;
    layouts: { versionId: string; layout: GameLayout }[];
  }): Promise<string>;
  refreshGameFolder(id: string): Promise<void>;
  removeGameFolder(id: string): Promise<void>;
  setGameLayout(value: { id: string; layout: GameLayout }): Promise<void>;
  worlds(id: string): Promise<World[]>;
  backups(id: string): Promise<Backup[]>;
  chooseBackupExport(value: WorldRef): Promise<{ path: string; token: string } | null>;
  backupWorld(value: WorldRef & { exportToken?: string }): Promise<string>;
  restoreBackup(value: { id: string; backupId: string }): Promise<string>;
  deleteBackup(value: { id: string; backupId: string }): Promise<void>;
  loginThirdParty(value: {
    server: string;
    username: string;
    password: string;
  }): Promise<Account[]>;
  selectProfile(value: { accountId: string; uuid: string }): Promise<void>;
  skinPreview(id: string): Promise<string | null>;
  uploadSkin(value: { id: string; variant: 'classic' | 'slim' }): Promise<void>;
  resetSkin(id: string): Promise<void>;
  integrationKey(value: { service: 'curseforge' | 'modrinth'; key: string }): Promise<void>;
  searchCurseForge(value: {
    id: string;
    query: string;
    offset: number;
  }): Promise<{ hits: ModProject[]; total_hits: number }>;
  installCurseForge(value: { id: string; projectId: number }): Promise<string>;
  preparePack(value: PackOptions): Promise<PackReview | null>;
  publishPack(value: {
    ticket: string;
    projectId: string;
    changelog: string;
    channel: 'release' | 'beta' | 'alpha';
  }): Promise<string>;
  openFolder(value: {
    id?: string;
    folder?:
      | 'mods'
      | 'saves'
      | 'resourcepacks'
      | 'shaderpacks'
      | 'screenshots'
      | 'logs'
      | 'replay_recordings'
      | 'schematics';
  }): Promise<void>;
  cancelTask(id: string): Promise<void>;
  external(url: string): Promise<void>;
  window(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  onEvent(listener: (event: LauncherEvent) => void): () => void;
}
export interface WorldRef {
  id: string;
  world: string;
}
export interface WorldRegionRef extends WorldRef {
  dimension: string;
  rx: number;
  rz: number;
}
export interface SavePatch {
  name?: string;
  gameType?: number;
  difficulty?: number;
  hardcore?: boolean;
  commands?: boolean;
  spawnX?: number;
  spawnY?: number;
  spawnZ?: number;
}
export interface TerrainTileRequest extends WorldRef {
  dimension: string;
  side: 1 | 8 | 32;
  regions: { rx: number; rz: number }[];
}
export interface TerrainTile {
  rx: number;
  rz: number;
  pixels?: string;
  error?: string;
}
export interface RuleChange {
  key: string;
  before: string;
  value: string;
}
export interface SaveSelectionRequest extends WorldRef {
  dimension: string;
  groups: { rx: number; rz: number; indices: number[] }[];
  protectSpawn: number;
  maxInhabitedTicks?: number;
  beforeTimestamp?: number;
}
export interface SaveMetadata {
  folder: string;
  name?: string;
  version?: string;
  dataVersion?: number;
  seed?: string;
  generation?: { preset?: string | null; largeBiomes: boolean };
  gameType?: number;
  difficulty?: number;
  hardcore?: boolean;
  commands?: boolean;
  lastPlayed?: number;
  spawn?: { x: number | null; y: number | null; z: number | null; dimension?: string };
  rules?: Record<string, string>;
  ruleError?: string | null;
  error?: string;
}
export interface SaveRegion {
  x: number;
  z: number;
  chunks: number;
  bytes: number;
  modified?: number;
  occupancy?: string;
  error?: string;
}
export interface SaveHistory {
  id: string;
  title: string;
  createdAt: number;
  state: 'committed' | 'prepared' | 'undone';
  files: number;
}
export interface SaveScan {
  metadata: SaveMetadata;
  dimensions: { id: string; regions: SaveRegion[] }[];
  history: SaveHistory[];
  elapsedMs: number;
}
export interface SaveChunk {
  x: number;
  z: number;
  index: number;
  timestamp: number;
  bytes: number;
  dataVersion?: number;
  status?: string;
  inhabitedTicks?: number;
  blockEntities?: string[];
  palette?: string[];
  error?: string;
}
export interface SaveRegionView {
  rx: number;
  rz: number;
  chunks: SaveChunk[];
  image: string;
  cached: boolean;
  elapsedMs: number;
}
export interface SavePruneReview {
  token: string;
  count: number;
  files: number;
  reclaimedBytes: number;
  skipped: { x: number; z: number; reason: string }[];
}
declare global {
  interface Window {
    kjmcl?: Api;
  }
}
import type { SkinProject } from './skin';
export interface SkinEditorImage {
  name: string;
  width: number;
  height: number;
  pixels: string;
}
export interface SkinEditorEntry {
  id: string;
  name: string;
  model: 'classic' | 'slim';
  resolution: number;
  modifiedAt: number;
  thumbnail: string;
}
export interface SkinEditorVersion {
  versionId: string;
  name: string;
  createdAt: number;
  model: 'classic' | 'slim';
  resolution: 64 | 128 | 256;
}
