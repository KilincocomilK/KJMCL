import { useEffect, useMemo, useState } from 'react';
import { LocalResourceArt, useLocalCards } from '../components/LocalResourceArt';
import { RefreshCw, Trash2 } from 'lucide-react';
import type { Snapshot, World, Backup } from '../../shared/types';
import { ItemArt } from '../components/ItemArt';
import { api } from '../api';
import { Empty, InstanceSelect } from '../components';
import { type Run, size } from '../ui';
import { WorldBackup } from '../dialogs/WorldBackup';
export function BackupsPage({
  state,
  run,
  showInstanceSelect = true,
}: {
  state: Snapshot;
  run: Run;
  showInstanceSelect?: boolean;
}) {
  const [worlds, setWorlds] = useState<World[]>([]),
    [backups, setBackups] = useState<Backup[]>([]);
  const [backup, setBackup] = useState<string>();
  const id = state.selectedInstanceId;
  useEffect(() => setBackup(undefined), [id]);
  const names = useMemo(() => worlds.map((w) => w.name), [worlds]);
  const cards = useLocalCards(id, 'worlds', names);
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
    <div className="single-page backups-page">
      {backup && (
        <WorldBackup id={id} world={backup} run={run} onClose={() => setBackup(undefined)} />
      )}
      <div className="toolbar">
        {showInstanceSelect && <InstanceSelect state={state} run={run} />}
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
              <LocalResourceArt kind="worlds" icon={cards?.get(w.name)?.icon} />
              <div className="grow">
                <strong>{w.name}</strong>
                <small>{new Date(w.modifiedAt).toLocaleString('zh-CN')}</small>
              </div>
              <button disabled={running} onClick={() => setBackup(w.name)}>
                备份
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted backup-empty">暂无存档</p>
      )}
      <div className="section-head">
        <h2>备份记录</h2>
        <small>恢复为新存档，保留现有世界</small>
      </div>
      <div className="panel">
        {backups.map((b) => (
          <div className="mod-row" key={b.id}>
            <ItemArt name="book" size={28} />
            <div className="grow">
              <strong>{b.world}</strong>
              <small>
                {new Date(b.createdAt).toLocaleString('zh-CN')} · {size(b.size)}
              </small>
            </div>
            <button
              disabled={running}
              onClick={() => void run(() => api.restoreBackup({ id, backupId: b.id }))}
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
    </div>
  );
}
