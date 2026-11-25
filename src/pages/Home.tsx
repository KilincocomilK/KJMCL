import { Download, Layers, Play, Plus, SlidersHorizontal, Square } from 'lucide-react';
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
  const account = state.accounts.find(
    (a) => a.id === (active?.launchOptions?.accountId ?? state.selectedAccountId),
  );
  const running = !!active && state.running.includes(active.id);
  const installing = active?.status === 'installing';
  const needsAccount = active?.status === 'ready' && !account;
  const start = () => {
    if (!active) return onCreate();
    if (needsAccount) return active.launchOptions?.accountId ? onEdit(active) : onAccounts();
    void run(async () => {
      if (active.status === 'ready') await api.launch(active.id);
      else if (active.external) await api.refreshGameFolder(active.external.folderId);
      else await api.install(active.id);
    });
  };
  return (
    <section className="home-stage" aria-label="游戏启动">
      <div className="home-launch">
        <h2 className="home-name">Minecraft</h2>
        {active && (
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
        )}
        <div className="home-launch-actions">
          <button
            className="primary hero-button"
            title={account ? `使用 ${account.name} 启动` : undefined}
            disabled={running || installing}
            onClick={start}
          >
            {running ? (
              <Square size={18} />
            ) : !active ? (
              <Plus size={20} />
            ) : active.status !== 'ready' ? (
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
                    ? active.launchOptions?.accountId
                      ? '重新选择启动账户'
                      : '添加账户以启动'
                    : active.status === 'ready'
                      ? '启动游戏'
                      : active.external
                        ? '刷新版本索引'
                        : '安装游戏'}
          </button>
          {running && (
            <button className="text-button" onClick={() => void run(() => api.stop(active!.id))}>
              结束游戏
            </button>
          )}
          <button className="home-secondary" onClick={onLibrary}>
            <Layers size={16} /> 管理实例
          </button>
          {state.instances.length > 0 && (
            <button
              className="icon home-secondary"
              onClick={onCreate}
              aria-label="新建实例"
              title="新建实例"
            >
              <Plus size={17} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
