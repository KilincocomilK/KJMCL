import { matchesSearch } from '../../shared/search';
import { useEffect, useRef, useState } from 'react';
import { CheckCheck, RefreshCw } from 'lucide-react';
import type { ModAuditEntry, ModBatchReview, Snapshot } from '../../shared/types';
import { api } from '../api';
import { Modal, Empty } from '../components';
import type { Run } from '../ui';
export function ModAuditPanel({ id, state, run }: { id: string; state: Snapshot; run: Run }) {
  const [entries, setEntries] = useState<ModAuditEntry[]>([]),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(''),
    [issuesOnly, setIssuesOnly] = useState(false),
    [review, setReview] = useState<ModBatchReview>();
  const live = useRef(true);
  const scan = async () => {
    setBusy(true);
    const data = await run(() => api.auditMods(id));
    if (live.current) {
      if (data) {
        setEntries(data);
        setSelected(new Set());
      }
      setBusy(false);
    }
  };
  useEffect(() => {
    live.current = true;
    void scan();
    return () => {
      live.current = false;
    };
  }, []);
  const visible = entries.filter(
    (e) =>
      (!issuesOnly || e.issues.length > 0) &&
      matchesSearch(query, e.name, e.version, ...e.ids),
  );
  const locked =
    busy || state.running.includes(id) || state.tasks.some((t) => t.status === 'running');
  const plan = async (enabled: boolean) => {
    setBusy(true);
    const r = await run(() => api.planModBatch({ id, names: [...selected], enabled }));
    if (live.current) {
      setReview(r);
      setBusy(false);
    }
  };
  return (
    <div className="audit-panel">
      <div className="toolbar">
        <input
          aria-label="筛选模组检查"
          placeholder="文件名或模组 ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={issuesOnly}
            onChange={(e) => setIssuesOnly(e.target.checked)}
          />
          只看提示
        </label>
        <button disabled={busy} onClick={() => void scan()}>
          <RefreshCw size={16} />
          {busy ? '检查中' : '重新检查'}
        </button>
      </div>
      <div className="toolbar">
        <button onClick={() => setSelected(new Set(visible.map((e) => e.name)))}>
          <CheckCheck size={16} />
          选择筛选结果
        </button>
        <button onClick={() => setSelected(new Set())}>清空</button>
        <span>已选 {selected.size} 个</span>
        <button disabled={locked || !selected.size} onClick={() => void plan(true)}>
          批量启用
        </button>
        <button disabled={locked || !selected.size} onClick={() => void plan(false)}>
          批量停用
        </button>
      </div>
      <div className="audit-list">
        {visible.map((e) => (
          <article className="panel audit-row" key={e.name}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(e.name)}
                onChange={(event) =>
                  setSelected((old) => {
                    const next = new Set(old);
                    if (event.target.checked) next.add(e.name);
                    else next.delete(e.name);
                    return next;
                  })
                }
              />
              <strong>{e.name}</strong>
            </label>
            <small>
              {e.enabled ? '启用' : '停用'} · {e.ids.join(', ') || '未知 ID'} ·{' '}
              {e.version ?? '版本未知'} · {e.loader ?? '未知加载器'}
            </small>
            {e.issues.map((issue, n) => (
              <p key={n} className={issue.level === 'error' ? 'error-text' : 'muted'}>
                {issue.message}
              </p>
            ))}
          </article>
        ))}
      </div>
      {!visible.length && <Empty title={busy ? '正在检查模组' : '没有符合条件的模组'} />}
      {review && (
        <Modal
          title="确认批量模组操作"
          onClose={() => {
            if (!busy) setReview(undefined);
          }}
        >
          <div className="form-stack">
            <p>将更改 {review.changes.length} 个模组的启用状态。</p>
            <div className="change-list">
              {review.changes.map((c) => (
                <p key={c.from}>
                  {c.from}
                  <br />→ {c.to}
                </p>
              ))}
            </div>
            <button
              className="primary"
              disabled={locked}
              onClick={() => {
                setBusy(true);
                void run(async () => {
                  await api.applyModBatch(review.token);
                  setReview(undefined);
                  await scan();
                }, '批量操作已完成').finally(() => setBusy(false));
              }}
            >
              应用变更
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
