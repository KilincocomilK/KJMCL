export type Loader = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge';
export type GameLayout = 'auto' | 'shared' | 'version';
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
}
export interface Instance {
  id: string;
  name: string;
  version: string;
  loader: Loader;
  loaderVersion?: string;
  status: 'empty' | 'installing' | 'ready' | 'error';
  createdAt: number;
  lastPlayed?: number;
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
  id: string;
  title: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  detail: string;
  createdAt: number;
}
export interface JavaRuntime {
  path: string;
  version: string;
  major: number;
  arch: string;
  vendor?: string;
  vm?: string;
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
  games: { id: string; name: string }[];
  tasks: number;
}
export type LauncherEvent =
  | { type: 'state' }
  | { type: 'log'; line: LogLine }
  | { type: 'lightweight'; state: LightweightState }
  | { type: 'window-visibility'; visible: boolean }
  | { type: 'mode-error'; message: string };
export type ResourceKind =
  'mods' | 'shaderpacks' | 'resourcepacks' | 'replay_recordings' | 'schematics';
export interface ResourceFile {
  name: string;
  kind: ResourceKind;
  size: number;
  modifiedAt: number;
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
export interface Api {
  organizeInstance(value: { id: string; organization: InstanceOrganization }): Promise<void>;
  catalogSearch(value: {
    id: string;
    source: ContentSource;
    kind: ContentKind;
    query: string;
    offset: number;
    sort: 'relevance' | 'downloads' | 'updated';
  }): Promise<{ items: ContentProject[]; total: number }>;
  catalogVersions(
    value: ContentRef & { id: string; offset: number },
  ): Promise<{ items: ContentVersion[]; more: boolean }>;
  installContent(value: ContentRef & { id: string; versionId: string }): Promise<string>;
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
  scanWorld(value: WorldRef): Promise<SaveScan>;
  worldRegion(value: WorldRegionRef): Promise<SaveRegionView>;
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
  backgroundImage(): Promise<string | null>;
  pickBackground(): Promise<void>;
  resetBackground(): Promise<void>;
  updateAppearance(value: Pick<Appearance, 'dim' | 'blur'>): Promise<void>;
  lightweightState(): Promise<LightweightState>;
  setLightweight(active: boolean): Promise<void>;
  settings(value: Settings): Promise<void>;
  select(value: { accountId?: string; instanceId?: string; folderId?: string }): Promise<void>;
  addOffline(name: string): Promise<Account>;
  removeAccount(id: string): Promise<void>;
  beginLogin(): Promise<DeviceCode>;
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
  updateMods(id: string): Promise<string>;
  importPack(): Promise<string | null>;
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
  backupWorld(value: { id: string; world: string }): Promise<string>;
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
  updateCurseForge(id: string): Promise<string>;
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
export interface SaveMetadata {
  folder: string;
  name?: string;
  version?: string;
  dataVersion?: number;
  seed?: string;
  gameType?: number;
  difficulty?: number;
  hardcore?: boolean;
  commands?: boolean;
  lastPlayed?: number;
  spawn?: { x: number | null; y: number | null; z: number | null };
  rules?: Record<string, string>;
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
