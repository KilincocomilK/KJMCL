import { dialog, type BrowserWindow } from 'electron';
import path from 'node:path';
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
  | 'importMinecraft'
  | 'worlds'
  | 'backups'
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
  | 'updateCurseForge'
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
  changed: () => void;
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
  let authenticating = false;
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
        title: '选择已有 .minecraft 目录',
        properties: ['openDirectory'],
      });
      return r.canceled ? null : instances.scan(r.filePaths[0]);
    },
    importMinecraft: async (v) => {
      const id = create({
        name: v.name,
        version: 'importing',
        loader: 'vanilla',
        gameDir: v.gameDir,
      });
      store.instance(id).status = 'installing';
      store.save();
      tasks.start('导入 ' + v.name, id, (ctx) =>
        instances.import(v.selectionId, v.versionId, id, ctx),
      );
      return id;
    },
    worlds: (id) => backups.worlds(id),
    backups: (id) => backups.list(id),
    backupWorld: async (v) => {
      await writable(v.id);
      return tasks.start('备份 ' + v.world, v.id, async (ctx) => {
        await backups.create(v.id, v.world, ctx);
      });
    },
    restoreBackup: async (v) => {
      await writable(v.id);
      return tasks.start('恢复存档', v.id, (ctx) => backups.restore(v.id, v.backupId, ctx));
    },
    deleteBackup: async (v) => {
      await writable(v.id);
      const r = await dialog.showMessageBox(c.window(), {
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
      return tasks.start('安装 CurseForge 模组', v.id, (ctx) => cf.install(v.id, v.projectId, ctx));
    },
    updateCurseForge: async (id) => {
      await writable(id);
      return tasks.start('更新 CurseForge 模组', id, (ctx) => cf.update(id, ctx));
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
      const r = await dialog.showMessageBox(c.window(), {
        type: 'question',
        message: `向 Modrinth 项目 ${v.projectId} 发布已预览的整合包？`,
        detail: '这会创建远程版本。请确保你已检查发布包及配置文件清单。',
        buttons: ['取消', '发布'],
        cancelId: 0,
        defaultId: 0,
      });
      if (r.response !== 1) return '';
      return publishing.publish(v.ticket, v.projectId, v.changelog, v.channel);
    },
  };
}
