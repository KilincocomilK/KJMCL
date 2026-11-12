import { useState, useEffect } from 'react';
import { ArrowDownToLine, Search, Terminal } from 'lucide-react';
import type { Snapshot, LogLine } from '../../shared/types';
import { api } from '../api';
import { InstanceSelect } from '../components';
import { type Run, size } from '../ui';
export function LogPage({ state, run }: { state: Snapshot; run: Run }) {
  const [lines, setLines] = useState<LogLine[]>([]),
    [query, setQuery] = useState(''),
    [errors, setErrors] = useState(false);
  const id = state.selectedInstanceId;
  useEffect(() => {
    if (!id) return;
    let active = true;
    api
      .logs(id)
      .then((v) => {
        if (active) setLines(v);
      })
      .catch(() => {});
    const off = api.onEvent((e) => {
      if (e.type === 'log' && e.line.instanceId === id)
        setLines((v) => [...v, e.line].slice(-2000));
    });
    return () => {
      active = false;
      off();
    };
  }, [id]);
  return (
    <>
      <div className="toolbar">
        <InstanceSelect state={state} run={run} />
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={errors} onChange={(e) => setErrors(e.target.checked)} />
            仅错误
          </label>
          <button disabled={!id} onClick={() => id && void run(() => api.exportLogs(id))}>
            <ArrowDownToLine size={16} />
            导出
          </button>
        </div>
      </div>
      <div className="search-input">
        <Search size={17} />
        <input
          aria-label="过滤日志"
          placeholder="过滤日志…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="console" role="log" aria-live="off">
        {lines.length ? (
          lines
            .filter(
              (l) =>
                (!errors || l.level === 'error') &&
                l.text.toLowerCase().includes(query.toLowerCase()),
            )
            .map((l, n) => (
              <div key={n} className={l.level}>
                <time>{new Date(l.time).toLocaleTimeString('zh-CN')}</time>
                <pre>{l.text}</pre>
              </div>
            ))
        ) : (
          <div className="console-empty">
            <Terminal size={28} />
            <p>启动游戏后，日志会显示在这里</p>
          </div>
        )}
      </div>
    </>
  );
}
