import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import type { Account, Instance, Settings, ContentFavorite, GameFolder } from '../../shared/types';
import {
  instanceSchema,
  settingsSchema,
  favoriteSchema,
  gameFolderSchema,
} from '../../shared/schema';
import { z } from 'zod';
interface Data {
  schemaVersion: 5;
  gameFolders: GameFolder[];
  selectedGameFolderId?: string;
  favorites: ContentFavorite[];
  accounts: Account[];
  instances: Instance[];
  settings: Settings;
  selectedAccountId?: string;
  selectedInstanceId?: string;
}
export class Store {
  data: Data;
  private file: string;
  constructor(public root: string) {
    mkdirSync(root, { recursive: true });
    this.root = realpathSync.native(root);
    root = this.root;
    this.file = path.join(root, 'state.json');
    this.data = {
      schemaVersion: 5,
      gameFolders: [],
      favorites: [],
      accounts: [],
      instances: [],
      settings: {
        memoryMb: 4096,
        javaPath: '',
        proxy: '',
        source: 'official',
        concurrency: 6,
        microsoftClientId: '',
        closeOnLaunch: false,
        showSnapshots: false,
      },
    };
    if (existsSync(this.file)) {
      const loaded = JSON.parse(readFileSync(this.file, 'utf8')) as Data;
      if (![1, 2, 3, 4, 5].includes(loaded.schemaVersion))
        throw new Error('不支持的数据格式，请使用匹配的 KJMCL 版本');
      const migrating = Number(loaded.schemaVersion) < 5;
      if (migrating) copyFileSync(this.file, this.file + `.v${loaded.schemaVersion}.bak`);
      loaded.favorites =
        Number(loaded.schemaVersion) < 4
          ? []
          : z.array(favoriteSchema).max(2000).parse(loaded.favorites);
      loaded.gameFolders = migrating
        ? []
        : z.array(gameFolderSchema).max(1000).parse(loaded.gameFolders);
      loaded.schemaVersion = 5;
      loaded.settings = settingsSchema.parse(loaded.settings);
      loaded.instances = loaded.instances.map((v) => {
        if (
          v.external &&
          (!v.gameDir ||
            !path.isAbsolute(v.gameDir) ||
            !loaded.gameFolders.some(
              (f) => f.id === v.external?.folderId && path.isAbsolute(f.path),
            ))
        )
          throw new Error('外部版本索引缺少游戏文件夹或运行目录，请从状态备份恢复');
        return instanceSchema.parse({
          ...v,
          performance: v.performance ?? { memory: 'manual', collector: 'auto', gcLogging: false },
          gameDir: v.gameDir || path.join(root, 'instances', v.id),
        });
      });
      this.data = loaded;
      for (const i of this.data.instances)
        if (i.status === 'installing') {
          i.status = 'error';
          i.error = '上次安装中断，请重试';
        }
      if (migrating) this.save();
    }
  }
  save() {
    if (existsSync(this.file)) copyFileSync(this.file, this.file + '.bak');
    writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2));
    renameSync(this.file + '.tmp', this.file);
  }
  instance(id: string) {
    const i = this.data.instances.find((x) => x.id === id);
    if (!i) throw new Error('实例不存在');
    return i;
  }
  dir(id: string) {
    const instance = this.instance(id);
    return instance.gameDir || path.join(this.root, 'instances', id);
  }
  runtime(id: string) {
    const external = this.instance(id).external;
    if (external) return this.folder(external.folderId).path;
    return this.instance(id).localRuntime ? path.join(this.dir(id), '.kjmcl-runtime') : this.root;
  }
  folder(id: string) {
    const folder = this.data.gameFolders.find((f) => f.id === id);
    if (!folder) throw new Error('游戏文件夹不存在');
    return folder;
  }
  related(id: string) {
    const instance = this.instance(id);
    const overlaps = (a: string, b: string) => {
      const relative = path.relative(a, b);
      return (
        !relative ||
        (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
      );
    };
    return this.data.instances.filter(
      (i) =>
        i.id === id ||
        (instance.external && i.external?.folderId === instance.external.folderId) ||
        overlaps(this.dir(id), this.dir(i.id)) ||
        overlaps(this.dir(i.id), this.dir(id)),
    );
  }
}
