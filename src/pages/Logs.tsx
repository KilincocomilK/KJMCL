import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { ArrowDownToLine, Copy, Pause, Play, Search, Terminal } from 'lucide-react';
import type { Snapshot, LogLine } from '../../shared/types';
import { api } from '../api';
import { InstanceSelect } from '../components';
import { Select } from '../Select';
import { type Run } from '../ui';
import { LogViewBuffer, filterLogs, formatLogs, logLevel, type LogFilter } from '../log-view';
import '../logs.css';

export function LogPage({
  state,
  run,
  showInstanceSelect = true,
}: {
  state: Snapshot;
  run: Run;
  showInstanceSelect?: boolean;
}) {
  const id = state.selectedInstanceId;
  const [view, setView] = useState<{ id?: string; lines: readonly LogLine[] }>({ lines: [] });
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<LogFilter>('all');
  const [paused, setPaused] = useState(false);
  const [following, setFollowing] = useState(true);
  const [wrap, setWrap] = useState(true);
  const buffer = useRef<LogViewBuffer | undefined>(undefined);
  const consoleRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  useEffect(() => {
    const current = id ? new LogViewBuffer(id) : undefined;
    buffer.current = current;
    setView({ id, lines: [] });
    setPaused(false);
    followRef.current = true;
    setFollowing(true);
    if (!id || !current) return;
    let active = true;
    const off = api.onEvent((event) => {
      if (event.type !== 'log' || event.line.instanceId !== id) return;
      current.append(event.line);
      if (!current.paused) setView({ id, lines: current.visible });
    });
    void run(async () => {
      const initial = await api.logs(id);
      if (!active) return;
      current.seed(initial);
      if (!current.paused) setView({ id, lines: current.visible });
    });
    return () => {
      active = false;
      off();
    };
  }, [id, run]);

  const visible = useMemo(
    () => filterLogs(view.id === id ? view.lines : [], query, level),
    [view, id, query, level],
  );
  useLayoutEffect(() => {
    if (followRef.current && consoleRef.current)
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [visible, following, wrap]);
  const togglePause = () => {
    const current = buffer.current;
    if (!current || current.instanceId !== id) return;
    if (current.paused) current.resume();
    else current.pause();
    setPaused(current.paused);
    setView({ id, lines: current.visible });
  };
  const toggleFollow = () => {
    followRef.current = !followRef.current;
    setFollowing(followRef.current);
  };

  return (
    <>
      <div className="toolbar log-toolbar">
        {showInstanceSelect && <InstanceSelect state={state} run={run} />}
        <div className="row log-actions">
          <Select
            aria-label="日志等级"
            value={level}
            onChange={(event) => setLevel(event.target.value as LogFilter)}
          >
            <option value="all">全部等级</option>
            <option value="info">信息</option>
            <option value="warn">警告</option>
            <option value="error">错误</option>
            <option value="debug">调试</option>
          </Select>
          <button disabled={!id} aria-pressed={paused} onClick={togglePause}>
            {paused ? <Play size={16} /> : <Pause size={16} />}
            {paused ? '继续' : '暂停'}
          </button>
          <button
            disabled={!visible.length}
            onClick={() =>
              void run(() => navigator.clipboard.writeText(formatLogs(visible)), '已复制日志')
            }
          >
            <Copy size={16} />
            复制
          </button>
          <button disabled={!id} onClick={() => id && void run(() => api.exportCompleteLogs(id))}>
            <ArrowDownToLine size={16} />
            导出完整日志
          </button>
        </div>
      </div>
      <div className="log-filter-row">
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="过滤日志"
            placeholder="过滤日志…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={following} onChange={toggleFollow} />
          跟随
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={wrap}
            onChange={(event) => setWrap(event.target.checked)}
          />
          换行
        </label>
      </div>
      <div
        ref={consoleRef}
        className={'console log-console' + (wrap ? '' : ' log-nowrap')}
        role="log"
        aria-live="off"
        tabIndex={0}
        onScroll={(event) => {
          const node = event.currentTarget;
          const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
          if (atBottom !== followRef.current) {
            followRef.current = atBottom;
            setFollowing(atBottom);
          }
        }}
      >
        {visible.length ? (
          visible.map((line, index) => (
            <div key={index} className={logLevel(line)}>
              <time>{new Date(line.time).toLocaleTimeString('zh-CN')}</time>
              <pre>{line.text}</pre>
            </div>
          ))
        ) : (
          <div className="console-empty">
            <Terminal size={28} />
            <p>{view.id === id && view.lines.length ? '没有匹配的日志' : '暂无日志'}</p>
          </div>
        )}
      </div>
    </>
  );
}
