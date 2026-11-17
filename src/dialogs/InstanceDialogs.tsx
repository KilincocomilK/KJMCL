import { Select } from '../Select';
import { useState, useEffect, type FormEvent } from 'react';
import { Download, FolderOpen, LoaderCircle, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { Snapshot, Instance, Loader, VersionSummary } from '../../shared/types';
import { api } from '../api';
import { Field, Modal } from '../components';
import { type Run, loaderLabel, date, size } from '../ui';
import { DirectoryField, CloneDialog, PublishDialog } from './AdvancedDialogs';
import { LaunchOptionsSettings } from '../components/LaunchOptionsSettings';
export function CreateDialog({
  state,
  run,
  onClose,
}: {
  state: Snapshot;
  run: Run;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<VersionSummary[]>([]),
    [version, setVersion] = useState(''),
    [name, setName] = useState(''),
    [loader, setLoader] = useState<Loader>('vanilla'),
    [lv, setLv] = useState(''),
    [loaders, setLoaders] = useState<string[]>([]),
    [snap, setSnap] = useState(state.settings.showSnapshots),
    [old, setOld] = useState(false),
    [versionQuery, setVersionQuery] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [gameDir, setGameDir] = useState('');
  const visibleVersions = versions.filter(
    (v) =>
      (v.type === 'release' ||
        (snap && v.type === 'snapshot') ||
        (old && ['old_alpha', 'old_beta'].includes(v.type))) &&
      v.id.toLowerCase().includes(versionQuery.trim().toLowerCase()),
  );
  useEffect(() => {
    if (versions.length && !visibleVersions.some((v) => v.id === version))
      setVersion(visibleVersions[0]?.id ?? '');
  }, [versions, snap, old, versionQuery, version]);
  useEffect(() => {
    let live = true;
    api
      .versions()
      .then((v) => {
        if (live) {
          setVersions(v);
          setVersion(v.find((x) => x.type === 'release')?.id ?? '');
        }
      })
      .catch((e) => {
        if (live) setError(String(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    setLoaders([]);
    setLv('');
    if (loader === 'vanilla' || !version) return;
    let live = true;
    api
      .loaders({ version, loader })
      .then((v) => {
        if (live) {
          setLoaders(v);
          setLv(v[0] ?? '');
        }
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [version, loader]);
  const submit = async (e: FormEvent, install = true) => {
    e.preventDefault();
    setBusy(true);
    const id = await run(() =>
      api.createInstance({
        name: name.trim() || `Minecraft ${version}`,
        version,
        loader,
        loaderVersion: lv || undefined,
        gameDir: gameDir || undefined,
      }),
    );
    if (id) {
      if (install) await run(() => api.install(id));
      onClose();
    }
    setBusy(false);
  };
  return (
    <Modal title="新建游戏实例" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="form-body">
          <Field label="实例名称">
            <input
              placeholder={version ? `Minecraft ${version}` : '我的世界'}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <DirectoryField value={gameDir} onChange={setGameDir} />
          <div className="row">
            <span className="label">游戏版本</span>
            <label className="check">
              <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
              快照版本
            </label>
            <label className="check">
              <input type="checkbox" checked={old} onChange={(e) => setOld(e.target.checked)} />
              远古版本
            </label>
          </div>
          {!!versions.length && (
            <input
              aria-label="搜索游戏版本"
              placeholder="搜索版本，如 1.21"
              value={versionQuery}
              onChange={(e) => setVersionQuery(e.target.value)}
            />
          )}
          {versions.length ? (
            <Select
              aria-label="游戏版本"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            >
              {!visibleVersions.length && <option value="">没有匹配的版本</option>}
              {visibleVersions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id} ·{' '}
                  {v.type === 'release' ? '正式版' : v.type === 'snapshot' ? '快照' : '远古版'}
                </option>
              ))}
            </Select>
          ) : (
            <input
              required
              aria-label="游戏版本"
              placeholder={loading ? '正在获取版本…' : '手动输入版本，如 1.21.1'}
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          )}
          {error && <p className="inline-error">版本信息暂不可用，可稍后重试或手动填写。</p>}
          <Field label="加载器">
            <div className="segmented">
              {(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'] as Loader[]).map((v) => (
                <button
                  type="button"
                  key={v}
                  className={loader === v ? 'active' : ''}
                  onClick={() => setLoader(v)}
                >
                  {loaderLabel[v]}
                </button>
              ))}
            </div>
          </Field>
          {loader !== 'vanilla' && (
            <Field label="加载器版本">
              {loaders.length ? (
                <Select value={lv} onChange={(e) => setLv(e.target.value)}>
                  {loaders.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </Select>
              ) : (
                <input
                  placeholder="自动选择最新兼容版本"
                  value={lv}
                  onChange={(e) => setLv(e.target.value)}
                />
              )}
            </Field>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" disabled={!version || busy} onClick={(e) => void submit(e, false)}>
            仅创建
          </button>
          <button className="primary" disabled={!version || busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}创建并安装
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function EditDialog({
  instance,
  state,
  run,
  onClose,
}: {
  instance: Instance;
  state: Snapshot;
  run: Run;
  onClose: () => void;
}) {
  const [i, set] = useState({ ...instance }),
    [args, setArgs] = useState(instance.jvmArgs.join('\n')),
    [advanced, setAdvanced] = useState<'clone' | 'publish'>();
  if (advanced === 'clone')
    return <CloneDialog instance={instance} run={run} onClose={() => setAdvanced(undefined)} />;
  if (advanced === 'publish')
    return <PublishDialog instance={instance} run={run} onClose={() => setAdvanced(undefined)} />;
  return (
    <Modal title="实例设置" wide onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const result = await run(async () => {
            if (i.external && i.external.layout !== instance.external?.layout)
              await api.setGameLayout({ id: i.id, layout: i.external.layout });
            await api.updateInstance({
              ...i,
              jvmArgs: args
                .split('\n')
                .map((v) => v.trim())
                .filter(Boolean),
            });
            return true;
          }, '设置已保存');
          if (result) onClose();
        }}
      >
        <div className="form-body">
          <Field label="名称">
            <input
              value={i.name}
              required
              maxLength={80}
              onChange={(e) => set({ ...i, name: e.target.value })}
            />
          </Field>
          <div className="row">
            <div className="path-value grow">{instance.gameDir || '默认游戏目录'}</div>
            {!instance.external && (
              <button
                type="button"
                onClick={async () => {
                  const dir = await run(() => api.pickDirectory());
                  if (dir) {
                    const task = await run(
                      () => api.relocateInstance({ id: i.id, directory: dir }),
                      '正在复制到新目录，原目录保留',
                    );
                    if (task) onClose();
                  }
                }}
              >
                更换目录
              </button>
            )}
          </div>
          {i.external && (
            <Field label="运行位置">
              <Select
                value={i.external.layout}
                onChange={(e) =>
                  set({
                    ...i,
                    external: {
                      ...i.external!,
                      layout: e.target.value as 'auto' | 'shared' | 'version',
                    },
                  })
                }
              >
                <option value="auto">沿用原配置 / 自动识别</option>
                <option value="shared">共享游戏文件夹</option>
                <option value="version">版本独立目录</option>
              </Select>
              <small>只改变运行位置的索引，不搬动游戏或存档。</small>
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    await api.setGameLayout({ id: i.id, layout: 'auto' });
                    onClose();
                  }, '已重新识别运行位置')
                }
              >
                重新识别运行位置
              </button>
            </Field>
          )}
          <div className="row">
            {!instance.external && (
              <button type="button" onClick={() => setAdvanced('clone')}>
                克隆实例
              </button>
            )}
            <button type="button" onClick={() => setAdvanced('publish')}>
              整合包发布
            </button>
          </div>
          <div className="form-grid">
            <Field label="内存（MiB）">
              <input
                type="number"
                min={512}
                max={65536}
                step={256}
                value={i.memoryMb}
                onChange={(e) => set({ ...i, memoryMb: Number(e.target.value) })}
              />
            </Field>
            <Field label="Java 路径">
              <input
                placeholder="跟随全局设置"
                value={i.javaPath}
                onChange={(e) => set({ ...i, javaPath: e.target.value })}
              />
            </Field>
            <Field label="窗口宽度">
              <input
                type="number"
                min={640}
                max={7680}
                value={i.width}
                onChange={(e) => set({ ...i, width: Number(e.target.value) })}
              />
            </Field>
            <Field label="窗口高度">
              <input
                type="number"
                min={480}
                max={4320}
                value={i.height}
                onChange={(e) => set({ ...i, height: Number(e.target.value) })}
              />
            </Field>
          </div>
          <LaunchOptionsSettings instance={i} state={state} onChange={set} />
          <Field label="JVM 参数" hint="每行一个参数">
            <textarea rows={3} value={args} onChange={(e) => setArgs(e.target.value)} />
          </Field>
          <div className="folder-actions">
            {(['saves', 'mods', 'resourcepacks', 'shaderpacks', 'screenshots'] as const).map(
              (f, n) => (
                <button
                  type="button"
                  key={f}
                  onClick={() => void run(() => api.openFolder({ id: i.id, folder: f }))}
                >
                  <FolderOpen size={14} />
                  {['存档', '模组', '资源包', '光影', '截图'][n]}
                </button>
              ),
            )}
          </div>
          {i.error && <p className="inline-error">{i.error}</p>}
          <div className="row">
            <small>最近启动：{date(i.lastPlayed)}</small>
            <small>累计游玩：{Math.floor(i.playTime / 60000)} 分钟</small>
          </div>
        </div>
        <div className="modal-footer split">
          <button
            type="button"
            className="danger text-button"
            onClick={async () => {
              await run(() => api.deleteInstance(i.id));
              onClose();
            }}
          >
            <Trash2 size={16} />
            {i.external ? '移除版本索引' : '删除实例'}
          </button>
          <div className="row">
            <button
              type="button"
              onClick={() => void run(() => api.exportPack(i.id), '已导出整合包')}
            >
              <Upload size={16} />
              导出
            </button>
            <button
              type="button"
              onClick={() =>
                void run(
                  async () => {
                    if (i.external) await api.refreshGameFolder(i.external.folderId);
                    else await api.install(i.id);
                  },
                  i.external ? '已刷新版本索引' : '已开始校验安装',
                )
              }
            >
              <RefreshCw size={16} />
              {i.external ? '刷新索引' : '修复'}
            </button>
            <button className="primary">保存</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
