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
import type { Account, Instance, Settings, ContentFavorite } from '../../shared/types';
import { instanceSchema, settingsSchema, favoriteSchema } from '../../shared/schema';
import { z } from 'zod';
interface Data {
  schemaVersion: 4;
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
      schemaVersion: 4,
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
      if (![1, 2, 3, 4].includes(loaded.schemaVersion))
        throw new Error('不支持的数据格式，请使用匹配的 KJMCL 版本');
      const migrating = Number(loaded.schemaVersion) < 4;
      if (migrating) copyFileSync(this.file, this.file + `.v${loaded.schemaVersion}.bak`);
      loaded.favorites = migrating ? [] : z.array(favoriteSchema).max(2000).parse(loaded.favorites);
      loaded.schemaVersion = 4;
      loaded.settings = settingsSchema.parse(loaded.settings);
      loaded.instances = loaded.instances.map((v) =>
        instanceSchema.parse({
          ...v,
          performance: v.performance ?? { memory: 'manual', collector: 'auto', gcLogging: false },
          gameDir: v.gameDir || path.join(root, 'instances', v.id),
        }),
      );
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
    return this.instance(id).localRuntime ? path.join(this.dir(id), '.kjmcl-runtime') : this.root;
  }
}
