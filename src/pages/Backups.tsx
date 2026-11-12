import { useEffect, useState } from 'react';
import { Archive, RefreshCw, Trash2 } from 'lucide-react';
import type { Snapshot, World, Backup } from '../../shared/types';
import { api } from '../api';
import { Empty, InstanceSelect } from '../components';
import { type Run, size } from '../ui';
export function BackupsPage({ state, run }: { state: Snapshot; run: Run }) {
  const [worlds, setWorlds] = useState<World[]>([]),
    [backups, setBackups] = useState<Backup[]>([]);
  const id = state.selectedInstanceId;
  const refresh = async () => {
    if (id)
      await run(async () => {
        setWorlds(await api.worlds(id));
        setBackups(await api.backups(id));
      });
  };
  useEffect(() => {
    void refresh();
  }, [id, state.tasks.filter((t) => t.status === 'completed').length]);
  if (!id) return <Empty title="先选择一个游戏实例" />;
  const running = state.running.includes(id);
  return (
    <>
      <div className="toolbar">
        <InstanceSelect state={state} run={run} />
        <button onClick={() => void refresh()}>
          <RefreshCw size={16} />
          刷新
        </button>
      </div>
      <div className="section-head">
        <h2>存档</h2>
      </div>
      {worlds.length ? (
        <div className="panel">
          {worlds.map((w) => (
            <div className="mod-row" key={w.name}>
              <Archive size={24} />
              <div className="grow">
                <strong>{w.name}</strong>
                <small>{new Date(w.modifiedAt).toLocaleString('zh-CN')}</small>
              </div>
              <button
                disabled={running}
                onClick={() => void run(() => api.backupWorld({ id, world: w.name }), '已开始备份')}
              >
                备份
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="没有找到存档" />
      )}
      <div className="section-head">
        <h2>备份记录</h2>
        <small>恢复为新存档，保留现有世界</small>
      </div>
      <div className="panel">
        {backups.map((b) => (
          <div className="mod-row" key={b.id}>
            <Archive size={21} />
            <div className="grow">
              <strong>{b.world}</strong>
              <small>
                {new Date(b.createdAt).toLocaleString('zh-CN')} · {size(b.size)}
              </small>
            </div>
            <button
              disabled={running}
              onClick={() =>
                void run(() => api.restoreBackup({ id, backupId: b.id }), '已开始恢复')
              }
            >
              恢复
            </button>
            <button
              className="icon danger"
              aria-label="删除备份"
              onClick={async () => {
                await run(() => api.deleteBackup({ id, backupId: b.id }));
                await refresh();
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {!backups.length && <p className="muted backup-empty">暂无备份</p>}
      </div>
    </>
  );
}
