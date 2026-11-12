import { Select } from '../Select';
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { Download, LoaderCircle, Puzzle, Search, X } from 'lucide-react';
import type { Snapshot, ModFile, ModProject, ResourceFile } from '../../shared/types';
import { api } from '../api';
import { type Run, size } from '../ui';
import { ModAuditPanel } from './ModAudit';

export function ModResources({
  state,
  run,
  files,
  revision,
  onChanged,
  actions,
}: {
  state: Snapshot;
  run: Run;
  files: ResourceFile[];
  revision: number;
  onChanged: () => void;
  actions: (file: ResourceFile, allowRename?: boolean) => ReactNode;
}) {
  const id = state.selectedInstanceId!;
  const instance = state.instances.find((i) => i.id === id)!;
  const [mods, setMods] = useState<ModFile[]>([]);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'modrinth' | 'curseforge'>('modrinth');
  const [result, setResult] = useState<{
    hits: ModProject[];
    total: number;
    offset: number;
    query: string;
  }>();
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(true);
  const [audit, setAudit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Record<string, string>>({});
  const epoch = useRef(0),
    live = useRef(true);
  const terminalTasks = state.tasks
    .filter((t) => t.status !== 'running')
    .map((t) => `${t.id}:${t.status}`)
    .join('|');
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setReading(true);
    void run(async () => {
      const next = await api.mods(id);
      if (active) setMods(next);
    }).finally(() => {
      if (active) setReading(false);
    });
    return () => {
      active = false;
    };
  }, [id, revision, terminalTasks, run]);
  const resetSearch = () => {
    epoch.current++;
    setResult(undefined);
    setLoading(false);
  };
  const search = async (offset = 0, text = query.trim()) => {
    const request = ++epoch.current;
    setLoading(true);
    setResult(undefined);
    const data = await run(() =>
      source === 'modrinth'
        ? api.searchMods({ id, query: text, offset })
        : api.searchCurseForge({ id, query: text, offset }),
    );
    if (request !== epoch.current || !live.current) return;
    if (data) setResult({ hits: data.hits, total: data.total_hits, offset, query: text });
    setLoading(false);
  };
  const mutate = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    const task = await run(work);
    if (live.current) {
      if (typeof task === 'string') setPending((p) => ({ ...p, update: task }));
      setBusy(false);
      onChanged();
    }
  };
  const runningTask = Object.values(pending).some((taskId) =>
    state.tasks.some((t) => t.id === taskId && t.status === 'running'),
  );
  const locked = busy || runningTask || state.running.includes(id);
  const visible = mods.filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()));
  const install = async (project: ModProject) => {
    setBusy(true);
    const key = `${source}:${project.project_id}`;
    const task = await run(() =>
      source === 'modrinth'
        ? api.installMod({ id, projectId: project.project_id })
        : api.installCurseForge({ id, projectId: Number(project.project_id) }),
    );
    if (live.current) {
      if (task) setPending((p) => ({ ...p, [key]: task }));
      setBusy(false);
    }
  };
  return (
    <div className="mod-resources">
      <form
        className="resource-searchbar"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="search-input grow">
          <Search size={17} />
          <input
            aria-label="搜索模组"
            placeholder="搜索模组"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              resetSearch();
            }}
          />
          {query && (
            <button
              className="icon"
              type="button"
              aria-label="清空搜索"
              onClick={() => {
                setQuery('');
                resetSearch();
              }}
            >
              <X size={15} />
            </button>
          )}
        </div>
        <Select
          aria-label="模组来源"
          value={source}
          onChange={(e) => {
            setSource(e.target.value as typeof source);
            resetSearch();
          }}
        >
          <option value="modrinth">Modrinth</option>
          <option value="curseforge">CurseForge</option>
        </Select>
        <button className="primary" disabled={loading}>
          {loading ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}搜索
        </button>
      </form>
      {instance.loader === 'vanilla' && (
        <p className="muted resource-hint">安装模组需要 Fabric、Forge 等加载器</p>
      )}
      {(loading || result) && (
        <section className="mod-search-results" aria-label="模组搜索结果" aria-busy={loading}>
          <div className="resource-section-head">
            <h2>
              搜索结果 <span>{result?.total ?? ''}</span>
            </h2>
            <button className="icon" aria-label="收起搜索结果" onClick={resetSearch}>
              <X size={16} />
            </button>
          </div>
          {loading ? (
            <p className="resource-empty" role="status">
              正在搜索…
            </p>
          ) : result?.hits.length ? (
            <>
              <div className="mod-list panel">
                {result.hits.map((m) => {
                  const installed = mods.some(
                    (local) =>
                      local.projectId === m.project_id && (local.source ?? 'modrinth') === source,
                  );
                  const taskId = pending[`${source}:${m.project_id}`];
                  const task = state.tasks.find((t) => t.id === taskId);
                  const downloading = task?.status === 'running';
                  return (
                    <article className="mod-row" key={m.project_id}>
                      {m.icon_url ? (
                        <img className="mod-logo" src={m.icon_url} alt="" loading="lazy" />
                      ) : (
                        <div className="mod-symbol">
                          <Puzzle size={22} />
                        </div>
                      )}
                      <div className="grow">
                        <strong>{m.title}</strong>
                        <p>{m.description}</p>
                        <small>
                          {m.author} ·{' '}
                          {Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(m.downloads)}{' '}
                          次下载
                        </small>
                      </div>
                      <button
                        disabled={
                          installed ||
                          locked ||
                          instance.loader === 'vanilla' ||
                          (task?.status === 'completed' && reading)
                        }
                        onClick={() => void install(m)}
                      >
                        {downloading ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          !installed && <Download size={16} />
                        )}
                        {installed
                          ? '已安装'
                          : downloading
                            ? '下载中'
                            : task?.status === 'failed' || task?.status === 'cancelled'
                              ? '重试'
                              : '安装'}
                      </button>
                    </article>
                  );
                })}
              </div>
              {result.total > 20 && (
                <div className="pagination">
                  <button
                    disabled={result.offset === 0}
                    onClick={() => void search(result.offset - 20, result.query)}
                  >
                    上一页
                  </button>
                  <span>
                    {result.offset + 1}–{Math.min(result.offset + 20, result.total)} /{' '}
                    {result.total}
                  </span>
                  <button
                    disabled={result.offset + 20 >= result.total}
                    onClick={() => void search(result.offset + 20, result.query)}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="resource-empty" role="status">
              没有找到兼容模组
            </p>
          )}
        </section>
      )}
      <section aria-label="已安装模组">
        <div className="resource-section-head">
          <h2>
            已安装{' '}
            <span>
              {visible.length}
              {query.trim() ? ` / ${mods.length}` : ''}
            </span>
          </h2>
          <div className="row">
            <button
              disabled={locked || !mods.length}
              onClick={() =>
                void mutate(() =>
                  source === 'modrinth' ? api.updateMods(id) : api.updateCurseForge(id),
                )
              }
            >
              检查更新
            </button>
            <button disabled={locked || !mods.length} onClick={() => setAudit(true)}>
              检查与批量操作
            </button>
          </div>
        </div>
        {visible.length ? (
          <div className="mod-list panel">
            {visible.map((m) => {
              const file = files.find((f) => f.kind === 'mods' && f.name === m.name);
              return (
                <article className="mod-row resource-mod-row" key={m.name}>
                  <div className="mod-symbol">
                    <Puzzle size={22} />
                  </div>
                  <div className="grow">
                    <strong title={m.name}>{m.name.replace(/\.disabled$/, '')}</strong>
                    <small>
                      {m.source === 'curseforge' ? 'CurseForge' : m.projectId ? 'Modrinth' : '本地'}{' '}
                      · {size(m.size)}
                      {!m.enabled && ' · 已停用'}
                    </small>
                  </div>
                  <button
                    role="switch"
                    aria-checked={m.enabled}
                    aria-label={'启用 ' + m.name}
                    className={'switch ' + (m.enabled ? 'on' : '')}
                    disabled={locked}
                    onClick={() => void mutate(() => api.toggleMod({ id, name: m.name }))}
                  >
                    <span />
                  </button>
                  {file && actions(file, !m.projectId)}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="resource-empty" role="status">
            {reading ? '正在读取…' : query.trim() ? '没有匹配的已安装模组' : '暂无模组'}
          </p>
        )}
      </section>
      {audit && (
        <section className="resource-audit" aria-label="检查与批量操作">
          <div className="resource-section-head">
            <h2>检查与批量操作</h2>
            <button
              aria-label="收起模组检查"
              className="icon"
              onClick={() => {
                setAudit(false);
                onChanged();
              }}
            >
              <X size={16} />
            </button>
          </div>
          <ModAuditPanel id={id} state={state} run={run} />
        </section>
      )}
    </div>
  );
}
