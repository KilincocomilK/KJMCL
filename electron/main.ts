import { Instances, Backups, claimDirectory, assertOwned } from './core/instances';
import { Vault } from './core/vault';
import { Yggdrasil } from './core/yggdrasil';
import { Skins } from './core/skins';
import { CurseForge } from './core/curseforge';
import { Publishing } from './core/publishing';
import { featureHandlers } from './features';
import { skinEditorHandlers } from './skin-editor-features';
import { SkinEditorStorage } from './core/skin-editor';
import { SeedMapEngine } from './core/seed-map';
import { SeedMapStorage } from './core/seed-map-storage';
import { seedMapHandlers } from './seed-map-features';
import { ProjectionWorkshop } from './core/projection-workshop';
import { ProjectionAssetService } from './core/projection-assets';
import { projectionHandlers } from './projection-features';
import { exportSkinAnimation } from './core/skin-animation';
import { resourceHandlers } from './resource-features';
import { Resources } from './core/resources';
import { Terracotta } from './core/terracotta';
import { SaveManager } from './core/save-manager';
import { saveHandlers } from './save-features';
import { libraryHandlers } from './library-features';
import { Catalog } from './core/catalog';
import { ModAudit } from './core/mod-audit';
import { DiskUsage } from './core/disk-usage';
import { CrashReports } from './core/crash-reports';
import { AppearanceManager } from './core/appearance';
import { privateValues } from './core/private-values';
import { launchChoices } from './core/launch-options';
import { moveAccount } from './core/account-order';
import { exportCompleteLog } from './core/log-export';
import { LightweightMode } from './core/lightweight';
import { WindowHost } from './window-host';
import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Store } from './core/store';
import { Tasks } from './core/tasks';
import { Network } from './core/network';
import { Minecraft } from './core/minecraft';
import { Java } from './core/java';
import { Auth } from './core/auth';
import { Mods } from './core/mods';
import { Packs } from './core/packs';
import { Launcher } from './core/launcher';
import { VideoSettings } from './core/video-settings';
import { Storage, resolveStorage, prepareStorage, type StorageLayout } from './core/storage';
import { uninstallData } from './uninstall';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { offlineUuid } from './core/files';
import { schemas } from '../shared/schema';
import type { Api, Instance, LauncherEvent, LightweightState } from '../shared/types';
app.setName('KJMCL');
const uninstalling = process.argv.includes('--kjmcl-uninstall-data');
let layout: StorageLayout | undefined, bootError: unknown;
try {
  layout = resolveStorage(
    app.getPath('userData'),
    process.env.KJMCL_DATA_DIR,
    app.isPackaged ? process.env.PORTABLE_EXECUTABLE_DIR : undefined,
  );
  if (uninstalling) {
    // The review process must not hold Chromium files open in a directory the player may remove.
    app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'kjmcl-uninstall-')));
  } else {
    app.setPath('userData', layout.control);
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      layout = undefined;
    } else {
      prepareStorage(layout);
      const session = path.join(layout.root, '.electron');
      mkdirSync(session, { recursive: true });
      // Chromium's Local State also anchors safeStorage. Preserve the original profile location
      // across game-data moves and 0.3.x upgrades; only the large domain data moves.
      app.setPath('sessionData', layout.control);
      app.commandLine.appendSwitch('disk-cache-size', String(32 * 1024 * 1024));
      app.setAppLogsPath(path.join(session, 'logs'));
    }
  }
} catch (e) {
  bootError = e;
}
let window: BrowserWindow | undefined;
app.on('second-instance', () => {
  window?.show();
  window?.focus();
});
app
  .whenReady()
  .then(async () => {
    if (bootError) throw bootError;
    if (!layout) return;
    if (uninstalling) {
      prepareStorage(layout);
      app.exit(await uninstallData(layout));
      return;
    }
    const storage = new Storage(layout, path.dirname(app.getPath('exe')));
    let lightweight: LightweightMode | undefined;
    let host: WindowHost | undefined;
    let lastLightState = '';
    const emit = (event: LauncherEvent) => {
      if (host?.lightweight && (event.type === 'log' || event.type === 'state')) return;
      if (window && !window.isDestroyed()) window.webContents.send('kjmcl:event', event);
    };
    const lightState = (): LightweightState => ({
      active: host?.lightweight ?? false,
      visible:
        !!window &&
        !window.isDestroyed() &&
        window.isVisible() &&
        !window.isMinimized() &&
        window.isFocused(),
      games: [...launcher.processes.keys()].map((id) => ({ id, name: store.instance(id).name })),
      tasks: tasks.items.filter((task) => task.status === 'running').length,
    });
    let timer: NodeJS.Timeout | undefined;
    const changed = () => {
      if (!timer)
        timer = setTimeout(
          () => {
            timer = undefined;
            if (host?.lightweight) {
              const state = lightState(),
                key = JSON.stringify(state);
              if (key !== lastLightState) emit({ type: 'lightweight', state });
              lastLightState = key;
            } else {
              lastLightState = '';
              emit({ type: 'state' });
            }
          },
          host?.lightweight ? 1000 : 100,
        );
    };
    const store = new Store(layout.root),
      appearance = new AppearanceManager(store, (data) => nativeImage.createFromBuffer(data)),
      tasks = new Tasks(changed),
      net = new Network(() => store.data.settings),
      mc = new Minecraft(store, net),
      java = new Java(store, net),
      auth = new Auth(store, net, tasks, changed),
      mods = new Mods(store, net),
      launcher = new Launcher(
        store,
        mc,
        java,
        auth,
        changed,
        (line) => emit({ type: 'log', line }),
        (count) => lightweight?.running(count),
      );
    const vault = new Vault(store.root),
      ygg = new Yggdrasil(store, net, vault),
      skins = new Skins(store, net, auth, ygg),
      cf = new CurseForge(store, net, vault),
      instances = new Instances(store),
      backups = new Backups(store),
      publishing = new Publishing(store, net, vault, cf);
    const skinEditorStorage = new SkinEditorStorage(store);
    const seedMapStorage = new SeedMapStorage(store);
    const projectionWorkshop = new ProjectionWorkshop(
      store,
      app.isPackaged
        ? path.join(process.resourcesPath, 'native', 'projection')
        : path.join(__dirname, '../dist-native/projection'),
    );
    const projectionAssets = new ProjectionAssetService(store, net);
    const seedMapEngine = new SeedMapEngine(
      app.isPackaged
        ? path.join(process.resourcesPath, 'native', 'seed-map')
        : path.join(__dirname, '../dist-native/seed-map'),
    );
    auth.thirdParty = ygg;
    const assertIdle = (id: string) => {
      if (
        tasks.busy('game-folders') ||
        store.related(id).some((i) => tasks.busy(i.id) || launcher.processes.has(i.id))
      )
        throw new Error('请先停止此游戏文件夹中的游戏或等待任务完成');
    };
    const writable = async (id: string) => {
      assertIdle(id);
      if (store.instance(id).status === 'installing') throw new Error('实例正在安装');
      await assertOwned(store, id);
      assertIdle(id);
    };
    const create = (value: Parameters<Api['createInstance']>[0]) => {
      if (tasks.busy('game-folders')) throw new Error('请等待游戏文件夹索引完成');
      const id = randomUUID();
      const gameDir = claimDirectory(
        store,
        value.gameDir ||
          path.join(store.data.settings.instancesDir || path.join(store.root, 'instances'), id),
        id,
      );
      const i: Instance = {
        ...value,
        id,
        gameDir,
        localRuntime: value.loader === 'forge' || value.loader === 'neoforge',
        status: 'empty',
        createdAt: Date.now(),
        playTime: 0,
        memoryMb: store.data.settings.memoryMb,
        javaPath: '',
        jvmArgs: [],
        width: 1280,
        height: 720,
      };
      store.data.instances.push(i);
      store.data.selectedInstanceId = id;
      delete store.data.selectedGameFolderId;
      store.save();
      changed();
      return id;
    };
    const packs = new Packs(store, mc, net, tasks, create, cf);
    const video = new VideoSettings(store);
    const resources = new Resources(store),
      terracotta = new Terracotta(store.root, net);
    const saves = new SaveManager(
      store,
      app.isPackaged
        ? path.join(process.resourcesPath, 'native')
        : path.join(__dirname, '../dist-native'),
    );
    let exitingTerracotta = false,
      quitReady = false;
    app.on('before-quit', (event) => {
      if (quitReady) return;
      event.preventDefault();
      if (exitingTerracotta) return;
      exitingTerracotta = true;
      seedMapEngine.cancelAll();
      projectionAssets.cancel();
      void Promise.allSettled([
        terracotta.dispose(),
        skinEditorStorage.flush(),
        seedMapStorage.flush(),
        projectionWorkshop.flush(),
        projectionAssets.flush(),
      ]).then(async (results) => {
        try {
          // A final drain includes writes submitted while Terracotta was still stopping.
          const saved = await Promise.allSettled([
            skinEditorStorage.flush(),
            seedMapStorage.flush(),
            projectionWorkshop.flush(),
            projectionAssets.flush(),
          ]);
          const errors = [results[0], ...saved].filter(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
          );
          if (errors.length)
            dialog.showErrorBox(
              'KJMCL 退出时出现问题',
              errors.map((result) => String(result.reason)).join('\n'),
            );
        } finally {
          quitReady = true;
          app.quit();
        }
      });
    });
    app.on('will-quit', () => {
      seedMapEngine.dispose();
      lightweight?.dispose();
      host?.dispose();
    });
    const requireIdle = () => {
      if (launcher.processes.size || tasks.items.some((t) => t.status === 'running'))
        throw new Error('请先停止游戏并等待所有任务完成');
    };
    const handlers: Omit<Api, 'onEvent' | 'droppedPaths'> = {
      ...projectionHandlers({
        workshop: projectionWorkshop,
        assets: projectionAssets,
        store,
        window: () => window!,
        writable,
      }),
      ...seedMapHandlers({
        engine: seedMapEngine,
        storage: seedMapStorage,
        saves,
        window: () => window!,
      }),
      windowFullscreen: async (value) => {
        if (!window || window.isDestroyed()) return false;
        if (value === undefined) return window.isFullScreen();
        window.setFullScreen(value);
        return value;
      },
      skinEditorExportAnimation: async ({ frames, seconds }) => {
        const result = await dialog.showSaveDialog(window!, {
          defaultPath: 'skin-preview.gif',
          filters: [{ name: 'GIF 动画', extensions: ['gif'] }],
        });
        if (result.canceled || !result.filePath) return null;
        return tasks.start('导出皮肤动画', 'skin-animation', (ctx) =>
          exportSkinAnimation(frames, seconds, result.filePath!, ctx),
        );
      },
      ...skinEditorHandlers({
        store,
        skins,
        window: () => window!,
        changed,
        storage: skinEditorStorage,
      }),
      ...libraryHandlers({
        secrets: async () => [...auth.redactionValues(), ...(await privateValues(store.root))],
        store,
        tasks,
        catalog: new Catalog(store, net, mods, cf, resources, packs),
        audit: new ModAudit(store, resources),
        disk: new DiskUsage(store),
        crashes: new CrashReports(store, async () => [
          ...auth.redactionValues(),
          ...(await privateValues(store.root)),
        ]),
        writable,
        idle: requireIdle,
        changed,
        window: () => window!,
      }),
      ...saveHandlers({ saves, tasks, writable, window: () => window!, changed }),
      ...resourceHandlers({
        window: () => window!,
        resources,
        terracotta,
        tasks,
        writable,
        changed,
      }),
      finishStorageSetup: async () => {
        storage.completeSetup();
        changed();
      },
      migrateStorage: async (directory) => {
        requireIdle();
        if (terracotta.active) throw new Error('请重启启动器后，在启动陶瓦前迁移数据目录');
        return tasks.start('迁移数据目录', 'storage', (ctx) =>
          storage.migrate(store, directory, ctx),
        );
      },
      cleanupStorage: async () => {
        requireIdle();
        if (terracotta.active) throw new Error('请重启启动器后，在启动陶瓦前清理原数据');
        const retired = (await storage.info()).retired;
        if (!retired) throw new Error('没有待清理的原数据');
        const r = await dialog.showMessageBox(window!, {
          type: 'warning',
          message: '清理迁移前的原数据？',
          detail:
            retired.path +
            '\n\n删除已复制且未被修改的文件及旧应用日志。当前数据和外部游戏目录保留。',
          buttons: ['取消', '清理原数据'],
          defaultId: 0,
          cancelId: 0,
        });
        if (r.response !== 1) return null;
        requireIdle();
        return tasks.start('清理原数据', 'storage', (ctx) => storage.cleanup(ctx));
      },
      restartLauncher: async () => {
        requireIdle();
        await skinEditorStorage.flush();
        await seedMapStorage.flush();
        await projectionWorkshop.flush();
        await projectionAssets.flush();
        await terracotta.dispose();
        if (storage.pendingRestart) await storage.commitPending();
        // Restart the outer portable wrapper: its predecessor removes the old extraction directory.
        // Each wrapper uses an independent extraction directory (see docs/STORAGE.md).
        if (app.isPackaged && process.env.PORTABLE_EXECUTABLE_FILE)
          app.relaunch({
            execPath: process.env.PORTABLE_EXECUTABLE_FILE,
            args: process.argv.slice(1),
          });
        else app.relaunch();
        app.exit(0);
      },
      ...featureHandlers({
        window: () => window!,
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
        assertIdle,
        changed,
        gameRunning: () => launcher.processes.size > 0,
      }),
      snapshot: async () => ({
        ...store.data,
        tasks: tasks.items,
        running: [...launcher.processes.keys()],
        dataPath: store.root,
        platform: process.platform,
        appVersion: app.getVersion(),
        integrations: {
          curseforge: await vault.has('curseforge'),
          modrinth: await vault.has('modrinth'),
        },
        storage: await storage.info(),
      }),
      lightweightState: async () => lightState(),
      backgroundImage: async () => appearance.image(),
      pickBackground: async () => {
        if (!window) return;
        const result = await dialog.showOpenDialog(window, {
          title: '选择背景图片',
          properties: ['openFile'],
          filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }],
        });
        if (result.canceled || !result.filePaths[0]) return;
        await appearance.import(result.filePaths[0]);
        changed();
      },
      resetBackground: async () => {
        await appearance.reset();
        changed();
      },
      updateAppearance: async (value) => {
        appearance.update(value);
        changed();
      },
      setLightweight: async (active) => lightweight?.request(active),
      settings: async (value) => {
        store.data.settings = value;
        store.save();
        changed();
      },
      select: async (value) => {
        if (value.accountId) {
          if (!store.data.accounts.some((a) => a.id === value.accountId))
            throw new Error('账户不存在');
          store.data.selectedAccountId = value.accountId;
        }
        if (value.instanceId) {
          const instance = store.instance(value.instanceId);
          store.data.selectedInstanceId = value.instanceId;
          store.data.selectedGameFolderId = instance.external?.folderId;
        }
        if (value.folderId) {
          if (value.folderId !== 'managed') store.folder(value.folderId);
          store.data.selectedGameFolderId =
            value.folderId === 'managed' ? undefined : value.folderId;
          const members = store.data.instances.filter(
            (i) => i.external?.folderId === store.data.selectedGameFolderId,
          );
          if (!members.some((i) => i.id === store.data.selectedInstanceId))
            store.data.selectedInstanceId = members[0]?.id;
        }
        store.save();
        changed();
      },
      addOffline: async (name) => {
        if (
          store.data.accounts.some(
            (a) => a.kind === 'offline' && a.name.toLowerCase() === name.toLowerCase(),
          )
        )
          throw new Error('账户已存在');
        const account = {
          id: randomUUID(),
          name,
          uuid: offlineUuid(name),
          kind: 'offline' as const,
        };
        store.data.accounts.push(account);
        store.data.selectedAccountId = account.id;
        store.save();
        changed();
        return account;
      },
      removeAccount: async (id) => {
        if (launcher.processes.size) throw new Error('请先停止游戏');
        await auth.remove(id);
        await vault.set('ygg-' + id, '');
        store.data.accounts = store.data.accounts.filter((a) => a.id !== id);
        if (store.data.selectedAccountId === id)
          store.data.selectedAccountId = store.data.accounts[0]?.id;
        store.save();
        changed();
      },
      moveAccount: async ({ id, direction }) => {
        moveAccount(store, id, direction);
        changed();
      },
      beginLogin: () => auth.begin(),
      cancelLogin: async () => auth.cancel(),
      versions: () => mc.versions(),
      loaders: (v) => mc.loaders(v.version, v.loader),
      createInstance: async (value) => create(value),
      updateInstance: async (value) => {
        await writable(value.id);
        if (
          value.launchOptions?.accountId &&
          !store.data.accounts.some((a) => a.id === value.launchOptions?.accountId)
        )
          throw new Error('账户不存在，请重新选择');
        const old = store.instance(value.id);
        Object.assign(old, {
          name: value.name,
          memoryMb: value.memoryMb,
          javaPath: value.javaPath,
          jvmArgs: value.jvmArgs,
          width: value.width,
          height: value.height,
          performance: value.performance,
          launchOptions: value.launchOptions,
        });
        store.save();
        changed();
      },
      deleteInstance: async (id) => {
        const i = store.instance(id);
        if (i.external) assertIdle(id);
        else await writable(id);
        const result = await dialog.showMessageBox(window!, {
          type: 'warning',
          message: i.external ? `移除“${i.name}”的版本索引？` : `将“${i.name}”及其存档移入回收站？`,
          detail: i.external ? '游戏文件与存档保留。刷新游戏文件夹后可重新发现此版本。' : '',
          buttons: ['取消', i.external ? '移除索引' : '移入回收站'],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response !== 1) return;
        assertIdle(id);
        await tasks.exclusive(id, async () => {
          const current = store.instance(id);
          if (!current.external) {
            await assertOwned(store, id);
            const dir = store.dir(id);
            await mkdir(dir, { recursive: true });
            await shell.trashItem(dir);
          }
          store.data.instances = store.data.instances.filter((x) => x.id !== id);
          if (store.data.selectedInstanceId === id)
            store.data.selectedInstanceId = store.data.instances[0]?.id;
          store.save();
          changed();
        });
      },
      install: async (id) => {
        await writable(id);
        return tasks.start('安装 ' + store.instance(id).name, id, (ctx) => mc.install(id, ctx));
      },
      launch: async (id) => {
        await writable(id);
        tasks.start('启动 ' + store.instance(id).name, id, async (ctx) => {
          if (store.data.settings.backupBeforeLaunch)
            for (const world of await backups.worlds(id)) await backups.create(id, world.name, ctx);
          await launcher.launch(id, ctx.signal);
          if (store.data.settings.closeOnLaunch) window?.minimize();
        });
      },
      launchChoices: async (id) => {
        const instance = store.instance(id);
        if (instance.status !== 'ready') return { server: false, world: false, worlds: [] };
        return launchChoices((await mc.resolved(id)).version, store.dir(id));
      },
      stop: async (id) => launcher.stop(id),
      checkLaunch: async (id) => {
        await writable(id);
        return tasks.exclusive(id, () => launcher.performance.check(id));
      },
      sessions: (id) => launcher.diagnostics.list(id),
      exportDiagnosis: async ({ id, sessionId }) => {
        const session = (await launcher.diagnostics.list(id)).find((s) => s.id === sessionId);
        if (!session) throw new Error('诊断记录不存在');
        const file = await dialog.showSaveDialog(window!, {
          defaultPath: 'kjmcl-diagnosis.json',
          filters: [{ name: '诊断', extensions: ['json'] }],
        });
        if (file.filePath)
          await writeFile(
            file.filePath,
            JSON.stringify(
              {
                launcher: app.getVersion(),
                platform: process.platform,
                arch: process.arch,
                game: store.instance(id).version,
                loader: store.instance(id).loader,
                session,
              },
              null,
              2,
            ),
          );
      },
      videoSettings: (id) => video.state(id),
      applyVideoPreset: async ({ id, preset }) => {
        await writable(id);
        await tasks.exclusive(id, () => video.apply(id, preset));
        changed();
      },
      restoreVideoPreset: async (id) => {
        await writable(id);
        await tasks.exclusive(id, () => video.restore(id));
        changed();
      },
      logs: async (id) => launcher.logs(id),
      exportCompleteLogs: async (id) => {
        store.instance(id);
        const file = await dialog.showSaveDialog(window!, {
          defaultPath: 'kjmcl-complete.log',
          filters: [{ name: '日志', extensions: ['log'] }],
        });
        if (!file.filePath) return null;
        await exportCompleteLog(store, id, file.filePath, [
          ...auth.redactionValues(),
          ...(await privateValues(store.root)),
        ]);
        return file.filePath;
      },
      exportLogs: async (id) => {
        const file = await dialog.showSaveDialog(window!, {
          defaultPath: 'kjmcl-game.log',
          filters: [{ name: '日志', extensions: ['log'] }],
        });
        if (file.filePath)
          await writeFile(
            file.filePath,
            launcher
              .logs(id)
              .map((l) => new Date(l.time).toISOString() + ' ' + l.text)
              .join('\n'),
          );
      },
      java: () => java.discover(),
      pickJava: async () => {
        const r = await dialog.showOpenDialog(window!, {
          title: '选择 Java 可执行文件',
          properties: ['openFile'],
        });
        return r.canceled ? null : r.filePaths[0];
      },
      installJava: async (major) =>
        tasks.start('安装 Java ' + major, 'java', (ctx) => java.install(major, ctx)),
      mods: (id) => mods.list(id),
      importMods: async (id) => {
        await writable(id);
        const r = await dialog.showOpenDialog(window!, {
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'Minecraft 模组', extensions: ['jar'] }],
        });
        if (!r.canceled) await mods.import(id, r.filePaths);
        changed();
      },
      toggleMod: async (v) => {
        await writable(v.id);
        await mods.toggle(v.id, v.name);
        changed();
      },
      deleteMod: async (v) => {
        await writable(v.id);
        await mods.remove(v.id, v.name, (p) => shell.trashItem(p));
        changed();
      },
      searchMods: (v) => mods.search(v.id, v.query, v.offset),
      installMod: async (v) => {
        await writable(v.id);
        return tasks.start('安装模组', v.id, (ctx) => mods.install(v.id, v.projectId, ctx));
      },
      updateMods: async (id) => {
        await writable(id);
        return tasks.start('更新模组', id, (ctx) => mods.update(id, ctx));
      },
      importPack: async () => {
        const r = await dialog.showOpenDialog(window!, {
          properties: ['openFile'],
          filters: [{ name: '整合包', extensions: ['mrpack', 'zip'] }],
        });
        return r.canceled ? null : packs.import(r.filePaths[0]);
      },
      exportPack: async (id) => {
        await writable(id);
        const r = await dialog.showSaveDialog(window!, {
          defaultPath: store.instance(id).name.replace(/[<>:"/\\|?*]/g, '_') + '.zip',
          filters: [{ name: 'KJMCL 整合包', extensions: ['zip'] }],
        });
        if (r.filePath) await packs.export(id, r.filePath);
      },
      openFolder: async (v) => {
        const p =
          v.id &&
          v.folder &&
          ['mods', 'shaderpacks', 'resourcepacks', 'replay_recordings', 'schematics'].includes(
            v.folder,
          )
            ? await resources.location(
                v.id,
                v.folder as import('../shared/types').ResourceKind,
                '',
                true,
              )
            : v.id
              ? path.join(store.dir(v.id), v.folder ?? '')
              : store.root;
        await mkdir(p, { recursive: true });
        const error = await shell.openPath(p);
        if (error) throw new Error(error);
      },
      cancelTask: async (id) => tasks.cancel(id),
      external: async (url) => {
        const u = new URL(url);
        if (
          u.protocol !== 'https:' ||
          ![
            'kjmc.top',
            'burningtnt.github.io',
            'www.minecraft.net',
            'modrinth.com',
            'www.curseforge.com',
            'curseforge.com',
            'microsoft.com',
            'www.microsoft.com',
            'login.microsoftonline.com',
            'microsoft.com',
          ].some((h) => u.hostname === h)
        )
          throw new Error('不支持的外部链接');
        await shell.openExternal(url);
      },
      window: async (action) => {
        if (action === 'minimize') window?.minimize();
        else if (action === 'maximize') {
          if (window?.isMaximized()) window.unmaximize();
          else window?.maximize();
        } else window?.close();
      },
    };
    let activeOperations = 0;
    const lightMethods = new Set(['lightweightState', 'setLightweight', 'stop', 'window']);
    const storageReadOnly = new Set([
      'seedMapInfo',
      'seedMapSeed',
      'seedMapRandom',
      'seedMapTile',
      'seedMapFeatures',
      'seedMapBiome',
      'seedMapLocate',
      'seedMapCancel',
      'seedMapState',
      'seedMapRecoverState',
      'windowFullscreen',
      'snapshot',
      'backgroundImage',
      'lightweightState',
      'setLightweight',
      'logs',
      'sessions',
      'window',
      'cancelTask',
      'openFolder',
      'stop',
      'external',
    ]);
    ipcMain.handle('kjmcl:invoke', async (event, method: unknown, arg: unknown) => {
      if (
        event.sender !== window?.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error('无效调用来源');
      if (typeof method !== 'string' || !Object.hasOwn(schemas, method))
        throw new Error('未知操作');
      const key = method as keyof typeof schemas;
      if (host?.lightweight && !lightMethods.has(key)) throw new Error('请先打开完整界面');
      const parsed = schemas[key].parse(arg);
      if (
        (tasks.busy('storage') || storage.pendingRestart) &&
        !storageReadOnly.has(key) &&
        key !== 'restartLauncher'
      )
        throw new Error('数据目录正在迁移或等待重启');
      if (
        ['migrateStorage', 'cleanupStorage', 'restartLauncher', 'applyCacheCleanup'].includes(
          key,
        ) &&
        activeOperations
      )
        throw new Error('请等待当前操作完成');
      if (tasks.busy('maintenance') && !storageReadOnly.has(key))
        throw new Error('正在清理缓存，请稍候');
      const tracked = !storageReadOnly.has(key);
      if (tracked) activeOperations++;
      try {
        return await (handlers[key] as (v: any) => unknown)(parsed);
      } finally {
        if (tracked) activeOperations--;
      }
    });
    host = new WindowHost(
      (closing, event) => {
        if (launcher.processes.size || tasks.items.some((t) => t.status === 'running')) {
          const result = dialog.showMessageBoxSync(closing, {
            type: 'question',
            message: '退出 KJMCL？正在运行的游戏将继续运行，下载任务会取消。',
            buttons: ['取消', '退出'],
            defaultId: 0,
            cancelId: 0,
          });
          if (result === 0) event.preventDefault();
          else {
            auth.cancel();
            tasks.cancelAll();
          }
        }
        if (!event.defaultPrevented) {
          lightweight?.dispose();
          host?.dispose();
        } else {
          exitingTerracotta = false;
          quitReady = false;
        }
      },
      (current) => {
        window = current;
        current?.webContents.once('destroyed', () => seedMapEngine.cancelAll());
      },
    );
    lightweight = new LightweightMode(
      (active) => host!.open(active, true),
      () => activeOperations === 0,
      changed,
      () => emit({ type: 'mode-error', message: '界面切换失败，已保留原界面，请重试' }),
    );
    await host.open();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0)
        void host!.open(lightweight!.active).catch(() => {});
    });
  })
  .catch((e) => {
    dialog.showErrorBox('KJMCL 启动失败', String(e));
    app.exit(1);
  });
app.on('window-all-closed', () => app.quit());
