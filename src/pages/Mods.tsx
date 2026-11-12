import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowRight,
  Download,
  FolderOpen,
  LoaderCircle,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import type { Snapshot, ModFile, ModProject } from '../../shared/types';
import { api } from '../api';
import { Empty, InstanceSelect } from '../components';
import { type Run, loaderLabel, size } from '../ui';
import { ModAuditPanel } from './ModAudit';
export function ModPage({
  state,
  run,
  showInstanceSelect = true,
}: {
  state: Snapshot;
  run: Run;
  showInstanceSelect?: boolean;
}) {
  const [tab, setTab] = useState<'local' | 'discover' | 'audit'>('local'),
    [mods, setMods] = useState<ModFile[]>([]),
    [query, setQuery] = useState(''),
    [hits, setHits] = useState<ModProject[]>([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(false),
    [source, setSource] = useState<'modrinth' | 'curseforge'>('modrinth');
  const id = state.selectedInstanceId;
  const searchEpoch = useRef(0);
  useEffect(() => {
    searchEpoch.current++;
    setHits([]);
    setTotal(0);
    setOffset(0);
    setLoading(false);
  }, [id, source]);
  const instance = state.instances.find((i) => i.id === id);
  const refresh = useCallback(() => {
    if (id) void run(async () => setMods(await api.mods(id)));
  }, [id, run]);
  useEffect(refresh, [refresh, state.tasks.filter((t) => t.status === 'completed').length]);
  const search = async (start = 0) => {
    if (!id) return;
    const epoch = ++searchEpoch.current;
    setLoading(true);
    const result = await run(() =>
      source === 'modrinth'
        ? api.searchMods({ id, query, offset: start })
        : api.searchCurseForge({ id, query, offset: start }),
    );
    if (result && epoch === searchEpoch.current) {
      setHits(result.hits);
      setTotal(result.total_hits);
      setOffset(start);
    }
    if (epoch === searchEpoch.current) setLoading(false);
  };
  if (!id) return <Empty title="先创建一个游戏实例" description="模组与每个实例单独关联" />;
  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          <button className={tab === 'local' ? 'active' : ''} onClick={() => setTab('local')}>
            已安装 <span>{mods.length}</span>
          </button>
          <button className={tab === 'discover' ? 'active' : ''} onClick={() => setTab('discover')}>
            发现模组
          </button>
          <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>
            检查与批量操作
          </button>
        </div>
        {showInstanceSelect && <InstanceSelect state={state} run={run} />}
        <select
          aria-label="模组来源"
          className="source-select"
          value={source}
          onChange={(e) => {
            setSource(e.target.value as typeof source);
            setHits([]);
            setTotal(0);
          }}
        >
          <option value="modrinth">Modrinth</option>
          <option value="curseforge">CurseForge</option>
        </select>
      </div>
      {tab === 'audit' ? (
        <ModAuditPanel key={id} id={id} state={state} run={run} />
      ) : tab === 'local' ? (
        <>
          <div className="toolbar">
            <div className="search-input">
              <Search size={17} />
              <input
                aria-label="筛选已安装模组"
                placeholder="筛选模组…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="row">
              <button
                onClick={() =>
                  void run(() =>
                    source === 'modrinth' ? api.updateMods(id) : api.updateCurseForge(id),
                  )
                }
              >
                <RefreshCw size={16} />
                检查更新
              </button>
              <button
                onClick={async () => {
                  await run(() => api.importMods(id));
                  refresh();
                }}
              >
                <Plus size={16} />
                导入 JAR
              </button>
              <button
                className="icon"
                aria-label="打开模组目录"
                onClick={() => void run(() => api.openFolder({ id, folder: 'mods' }))}
              >
                <FolderOpen size={18} />
              </button>
            </div>
          </div>
          {mods.length ? (
            <div className="mod-list panel">
              {mods
                .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
                .map((m) => (
                  <div className="mod-row" key={m.name}>
                    <div className="mod-symbol">
                      <Puzzle size={23} />
                    </div>
                    <div className="grow">
                      <strong>{m.name.replace(/\.jar(?:\.disabled)?$/, '')}</strong>
                      <small>
                        {m.source === 'curseforge'
                          ? 'CurseForge'
                          : m.projectId
                            ? 'Modrinth'
                            : '本地模组'}{' '}
                        <span>·</span> {size(m.size)}
                      </small>
                    </div>
                    <button
                      role="switch"
                      aria-checked={m.enabled}
                      aria-label={'启用 ' + m.name}
                      className={'switch ' + (m.enabled ? 'on' : '')}
                      onClick={async () => {
                        await run(() => api.toggleMod({ id, name: m.name }));
                        refresh();
                      }}
                    >
                      <span />
                    </button>
                    <button
                      className="icon danger"
                      aria-label={'删除 ' + m.name}
                      onClick={async () => {
                        await run(() => api.deleteMod({ id, name: m.name }));
                        refresh();
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
            </div>
          ) : (
            <Empty
              title="还没有安装模组"
              action={
                <button onClick={() => setTab('discover')}>
                  发现模组
                  <ArrowRight size={16} />
                </button>
              }
            />
          )}
        </>
      ) : (
        <>
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <div className="search-input grow">
              <Search size={17} />
              <input
                placeholder={
                  '在 ' + (source === 'modrinth' ? 'Modrinth' : 'CurseForge') + ' 搜索模组'
                }
                aria-label="搜索模组"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <span className="badge">
              {instance?.version} / {instance && loaderLabel[instance.loader]}
            </span>
            <button className="primary" disabled={loading}>
              {loading ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}搜索
            </button>
          </form>
          {hits.length ? (
            <>
              <div className="mod-list panel">
                {hits.map((m) => (
                  <div className="mod-row" key={m.project_id}>
                    {m.icon_url ? (
                      <img className="mod-logo" src={m.icon_url} alt="" loading="lazy" />
                    ) : (
                      <div className="mod-symbol">
                        <Puzzle />
                      </div>
                    )}
                    <div className="grow">
                      <strong>{m.title}</strong>
                      <p>{m.description}</p>
                      <small>
                        {m.author} <span>·</span>{' '}
                        {Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(m.downloads)}{' '}
                        次下载
                      </small>
                    </div>
                    <button
                      disabled={instance?.loader === 'vanilla'}
                      onClick={() =>
                        void run(
                          () =>
                            source === 'modrinth'
                              ? api.installMod({ id, projectId: m.project_id })
                              : api.installCurseForge({ id, projectId: Number(m.project_id) }),
                          '已加入下载任务',
                        )
                      }
                    >
                      <Download size={16} />
                      安装
                    </button>
                  </div>
                ))}
              </div>
              <div className="pagination">
                <button disabled={offset === 0 || loading} onClick={() => void search(offset - 20)}>
                  上一页
                </button>
                <span>
                  {offset + 1}–{Math.min(offset + 20, total)} / {total}
                </span>
                <button
                  disabled={offset + 20 >= total || loading}
                  onClick={() => void search(offset + 20)}
                >
                  下一页
                </button>
              </div>
            </>
          ) : (
            <Empty
              title={loading ? '正在搜索…' : '查找你的下一个模组'}
              description={
                instance?.loader === 'vanilla'
                  ? '安装模组需要加载器实例'
                  : '结果会根据游戏版本和加载器筛选'
              }
            />
          )}
        </>
      )}
    </>
  );
}
