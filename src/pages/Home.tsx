import { ArrowRight, Download, Layers, Play, Plus, SlidersHorizontal, Square } from 'lucide-react';
import type { Instance, Snapshot } from '../../shared/types';
import { api } from '../api';
import { Select } from '../Select';
import { loaderLabel, statusLabel, type Run } from '../ui';

export function HomePage({
  state,
  run,
  onCreate,
  onEdit,
  onAccounts,
  onLibrary,
}: {
  state: Snapshot;
  run: Run;
  onCreate: () => void;
  onEdit: (instance: Instance) => void;
  onAccounts: () => void;
  onLibrary: () => void;
}) {
  const active = state.instances.find((i) => i.id === state.selectedInstanceId);
  const account = state.accounts.find((a) => a.id === state.selectedAccountId);
  const running = !!active && state.running.includes(active.id);
  const installing = active?.status === 'installing';
  const needsAccount = active?.status === 'ready' && !account;
  const start = () => {
    if (!active) return onCreate();
    if (needsAccount) return onAccounts();
    void run(async () => {
      if (active.status === 'ready') await api.launch(active.id);
      else if (active.external) await api.refreshGameFolder(active.external.folderId);
      else await api.install(active.id);
    });
  };
  return (
    <section className="home-stage" aria-label="游戏启动">
      <div className="home-launch">
        {active ? (
          <>
            <div className="home-version">
              <span>{active.version}</span>
              <span>{loaderLabel[active.loader]}</span>
              {active.status !== 'ready' && <span>{statusLabel[active.status]}</span>}
            </div>
            <div className="home-instance">
              <Select
                aria-label="当前游戏实例"
                value={active.id}
                onChange={(e) => void run(() => api.select({ instanceId: e.target.value }))}
              >
                {state.instances.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
              <button
                className="icon"
                aria-label="实例设置"
                title="实例设置"
                onClick={() => onEdit(active)}
              >
                <SlidersHorizontal size={20} />
              </button>
            </div>
          </>
        ) : (
          <h2 className="home-name">Minecraft</h2>
        )}
        <div className="home-launch-actions">
          <button className="primary hero-button" disabled={running || installing} onClick={start}>
            {running ? (
              <Square size={18} />
            ) : active && active.status !== 'ready' ? (
              <Download size={19} />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
            {running
              ? '游戏运行中'
              : installing
                ? '正在安装'
                : !active
                  ? '创建游戏实例'
                  : needsAccount
                    ? '添加账户以启动'
                    : active.status === 'ready'
                      ? '启动游戏'
                      : active.external
                        ? '刷新版本索引'
                        : '安装游戏'}
            <ArrowRight size={18} />
          </button>
          {running && (
            <button className="text-button" onClick={() => void run(() => api.stop(active!.id))}>
              结束游戏
            </button>
          )}
        </div>
      </div>
      <div className="home-tools">
        <button className="text-button" onClick={onLibrary}>
          <Layers size={16} />
          管理实例
          <ArrowRight size={14} />
        </button>
        {state.instances.length > 0 && (
          <button className="text-button" onClick={onCreate}>
            <Plus size={17} />
            新建实例
          </button>
        )}
      </div>
    </section>
  );
}
