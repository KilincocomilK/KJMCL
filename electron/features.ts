import { showSystemDialog } from './system-dialog';
import { LauncherMigration } from './core/launcher-migration';
import { dialog, type BrowserWindow } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Api } from '../shared/types';
import type { Store } from './core/store';
import type { Tasks } from './core/tasks';
import type { Instances, Backups } from './core/instances';
import type { Vault } from './core/vault';
import type { Yggdrasil } from './core/yggdrasil';
import type { Skins } from './core/skins';
import type { CurseForge } from './core/curseforge';
import type { Publishing } from './core/publishing';
type Extra = Pick<
  Api,
  | 'pickDirectory'
  | 'cloneInstance'
  | 'relocateInstance'
  | 'scanMinecraft'
  | 'discoverLaunchers'
  | 'pickLauncher'
  | 'previewLauncher'
  | 'copyLauncher'
  | 'importMinecraft'
  | 'refreshGameFolder'
  | 'removeGameFolder'
  | 'setGameLayout'
  | 'worlds'
  | 'backups'
  | 'chooseBackupExport'
  | 'backupWorld'
  | 'restoreBackup'
  | 'deleteBackup'
  | 'loginThirdParty'
  | 'selectProfile'
  | 'skinPreview'
  | 'uploadSkin'
  | 'resetSkin'
  | 'integrationKey'
  | 'searchCurseForge'
  | 'installCurseForge'
  | 'preparePack'
  | 'publishPack'
>;
export function featureHandlers(c: {
  window: () => BrowserWindow;
  store: Store;
  tasks: Tasks;
  instances: Instances;
  backups: Backups;
  vault: Vault;
  ygg: Yggdrasil;
  skins: Skins;
  cf: CurseForge;
  publishing: Publishing;
  create: (v: Parameters<Api['createInstance']>[0]) => string;
  writable: (id: string) => Promise<void>;
  assertIdle: (id: string) => void;
  changed: () => void;
  folderScan: (active: boolean) => void;
  gameRunning: () => boolean;
}): Extra {
  const {
    store,
    tasks,
    instances,
    backups,
    vault,
    ygg,
    skins,
    cf,
    publishing,
    create,
    writable,
    changed,
  } = c;
  let exportChoice: { id: string; world: string; token: string; path: string } | undefined;
  let authenticating = false;
  let scanningFolders = 0;
  const migration = new LauncherMigration(store, instances.folders);
  const accountWritable = () => {
    if (tasks.busy('auth') || authenticating) throw new Error('请先完成当前登录');
    if (c.gameRunning()) throw new Error('请先停止游戏再更换第三方角色');
  };
  return {
    pickDirectory: async () => {
      const r = await dialog.showOpenDialog(c.window(), {
        properties: ['openDirectory', 'createDirectory'],
      });
      return r.canceled ? null : r.filePaths[0];
    },
    cloneInstance: async (v) => {
      await writable(v.id);
      const i = store.instance(v.id);
      if (i.external) throw new Error('外部版本只保留索引，不复制游戏文件');
      if (i.status === 'installing' || i.status === 'error')
        throw new Error('请先完成或修复源实例');
      const target = create({
        name: v.name,
        version: i.version,
        loader: i.loader,
        loaderVersion: i.loaderVersion,
        gameDir: v.gameDir,
      });
      store.instance(target).localRuntime = i.localRuntime;
      store.instance(target).status = 'installing';
      store.save();
      tasks.start('克隆 ' + i.name, v.id, (ctx) =>
        instances.clone(v.id, target, v.includeSaves, ctx),
      );
      return target;
    },
    relocateInstance: async (v) => {
      await writable(v.id);
      return tasks.start('更换游戏目录', v.id, (ctx) => instances.relocate(v.id, v.directory, ctx));
    },
    scanMinecraft: async () => {
      const r = await dialog.showOpenDialog(c.window(), {
        title: '添加游戏文件夹（包含 versions）',
        properties: ['openDirectory'],
      });
      if (r.canceled || !r.filePaths.length) return null;
      if (++scanningFolders === 1) c.folderScan(true);
      try {
        return await instances.folders.scan(r.filePaths[0]);
      } finally {
        if (--scanningFolders === 0) c.folderScan(false);
      }
    },
    discoverLaunchers: () => migration.discover(),
    pickLauncher: async () => {
      const r = await dialog.showOpenDialog(c.window(), {
        title: '选择游戏文件夹或启动器所在目录',
        properties: ['openDirectory'],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      return migration.inspect(r.filePaths[0]);
    },
    previewLauncher: (id) => migration.preview(id),
    copyLauncher: async (value) => {
      const r = await dialog.showOpenDialog(c.window(), {
        title: '选择副本的存放位置',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      for (const i of store.data.instances) c.assertIdle(i.id);
      return tasks.run('复制游戏文件夹', 'game-folders', (ctx) =>
        migration.copy(value, r.filePaths[0], ctx),
      );
    },
    importMinecraft: async (v) => {
      for (const i of store.data.instances) c.assertIdle(i.id);
      return tasks.run('导入 ' + v.name, 'game-folders', (ctx) => instances.folders.add(v, ctx));
    },
    refreshGameFolder: async (id) => {
      for (const i of store.data.instances.filter((v) => v.external?.folderId === id))
        c.assertIdle(i.id);
      await tasks.exclusive('game-folders', () => instances.folders.refresh(id));
      changed();
    },
    removeGameFolder: async (id) => {
      const folder = store.folder(id);
      for (const i of store.data.instances.filter((v) => v.external?.folderId === id))
        c.assertIdle(i.id);
      const response = await showSystemDialog(c.window(), {
        message: `移除“${folder.name}”的索引？`,
        detail: '游戏文件与存档会留在原位置。',
        buttons: ['取消', '移除索引'],
        defaultId: 0,
        cancelId: 0,
      });
      if (response.response !== 1) return;
      for (const i of store.data.instances.filter((v) => v.external?.folderId === id))
        c.assertIdle(i.id);
      await tasks.exclusive('game-folders', async () => instances.folders.remove(id));
      changed();
    },
    setGameLayout: async (v) => {
      c.assertIdle(v.id);
      await tasks.exclusive('game-folders', () => instances.folders.setLayout(v.id, v.layout));
      changed();
    },
    worlds: (id) => backups.worlds(id),
    backups: (id) => backups.list(id),
    chooseBackupExport: async (v) => {
      await writable(v.id);
      const result = await dialog.showSaveDialog(c.window(), {
        title: '选择备份导出路径',
        defaultPath: v.world + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.zip',
        filters: [{ name: 'ZIP 备份', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePath) return null;
      await backups.checkExport(v.id, v.world, result.filePath);
      const token = randomUUID();
      exportChoice = { ...v, token, path: result.filePath };
      return { path: result.filePath, token };
    },
    backupWorld: async (v) => {
      await writable(v.id);
      const choice = exportChoice;
      if (
        v.exportToken &&
        (!choice ||
          choice.token !== v.exportToken ||
          choice.id !== v.id ||
          choice.world !== v.world)
      )
        throw new Error('请重新选择导出路径');
      if (v.exportToken) exportChoice = undefined;
      return tasks.start('备份 ' + v.world, v.id, async (ctx) => {
        await backups.create(v.id, v.world, ctx, v.exportToken ? choice?.path : undefined);
      });
    },
    restoreBackup: async (v) => {
      await writable(v.id);
      return tasks.start('恢复存档', v.id, (ctx) => backups.restore(v.id, v.backupId, ctx));
    },
    deleteBackup: async (v) => {
      await writable(v.id);
      const r = await showSystemDialog(c.window(), {
        message: '删除此备份？',
        buttons: ['取消', '删除'],
        cancelId: 0,
        defaultId: 0,
      });
      if (r.response === 1) await backups.remove(v.id, v.backupId);
      changed();
    },
    loginThirdParty: async (v) => {
      accountWritable();
      authenticating = true;
      try {
        const result = await ygg.login(v.server, v.username, v.password);
        changed();
        return result;
      } finally {
        authenticating = false;
      }
    },
    selectProfile: async (v) => {
      accountWritable();
      authenticating = true;
      try {
        await ygg.select(v.accountId, v.uuid);
        changed();
      } finally {
        authenticating = false;
      }
    },
    skinPreview: (id) => skins.preview(id),
    uploadSkin: async (v) => {
      const r = await dialog.showOpenDialog(c.window(), {
        title: '选择 PNG 皮肤',
        properties: ['openFile'],
        filters: [{ name: 'PNG', extensions: ['png'] }],
      });
      if (!r.canceled) {
        await skins.upload(v.id, r.filePaths[0], v.variant);
        changed();
      }
    },
    resetSkin: async (id) => {
      await skins.reset(id);
      changed();
    },
    integrationKey: async (v) => {
      await vault.set(v.service, v.key.trim());
      changed();
    },
    searchCurseForge: (v) => cf.search(v.id, v.query, v.offset),
    installCurseForge: async (v) => {
      await writable(v.id);
      return tasks.start(
        '安装 CurseForge 模组',
        v.id,
        (ctx) => cf.install(v.id, v.projectId, ctx),
        'download',
      );
    },
    preparePack: async (v) => {
      await writable(v.id);
      const extension = v.format === 'mrpack' ? 'mrpack' : 'zip';
      const r = await dialog.showSaveDialog(c.window(), {
        defaultPath:
          v.name.replace(/[<>:"/\\|?*]/g, '_') +
          '-' +
          v.version.replace(/[<>:"/\\|?*]/g, '_') +
          '.' +
          extension,
        filters: [{ name: '整合包', extensions: [extension] }],
      });
      return r.filePath ? publishing.prepare(v, r.filePath) : null;
    },
    publishPack: async (v) => {
      const r = await showSystemDialog(c.window(), {
        message: `向 Modrinth 项目 ${v.projectId} 发布已预览的整合包？`,
        buttons: ['取消', '发布'],
        cancelId: 0,
        defaultId: 0,
      });
      if (r.response !== 1) return '';
      return publishing.publish(v.ticket, v.projectId, v.changelog, v.channel);
    },
  };
}
