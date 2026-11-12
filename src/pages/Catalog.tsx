import { useEffect, useRef, useState } from 'react';
import { Download, Search, Star, ExternalLink, Box } from 'lucide-react';
import type {
  ContentKind,
  ContentProject,
  ContentSource,
  ContentVersion,
  Snapshot,
} from '../../shared/types';
import { api } from '../api';
import { Empty, InstanceSelect, Modal } from '../components';
import { type Run, size } from '../ui';
const kinds: Record<ContentKind, string> = {
  mod: '模组',
  resourcepack: '资源包',
  shader: '光影',
  modpack: '整合包',
};
export function CatalogPage({
  state,
  run,
  showInstanceSelect = true,
}: {
  state: Snapshot;
  run: Run;
  showInstanceSelect?: boolean;
}) {
  const id = state.selectedInstanceId ?? '';
  const [tab, setTab] = useState<'discover' | 'favorites'>('discover'),
    [kind, setKind] = useState<ContentKind>('mod'),
    [source, setSource] = useState<ContentSource>('modrinth'),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState<'relevance' | 'downloads' | 'updated'>('downloads'),
    [offset, setOffset] = useState(0),
    [total, setTotal] = useState(0),
    [items, setItems] = useState<ContentProject[]>([]),
    [busy, setBusy] = useState(false),
    [group, setGroup] = useState(''),
    [favoriteKind, setFavoriteKind] = useState('all'),
    [opened, setOpened] = useState<ContentProject>();
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setItems([]);
    setTotal(0);
    setOffset(0);
    setOpened(undefined);
    setBusy(false);
    return () => {
      epoch.current++;
    };
  }, [id, kind, source, tab]);
  const search = async (start = 0) => {
    if (!id) return;
    const n = ++epoch.current;
    setBusy(true);
    const result = await run(() =>
      api.catalogSearch({ id, kind, source, query, offset: start, sort }),
    );
    if (n === epoch.current) {
      if (result) {
        setItems(result.items);
        setTotal(result.total);
        setOffset(start);
      }
      setBusy(false);
    }
  };
  const saved = state.favorites ?? [],
    groups = [...new Set(saved.map((f) => f.group).filter(Boolean))];
  const favorite = (p: ContentProject) =>
    saved.find((f) => f.source === p.source && f.projectId === p.projectId && f.kind === p.kind);
  const visible =
    tab === 'discover'
      ? items
      : saved.filter(
          (p) =>
            (favoriteKind === 'all' || p.kind === favoriteKind) &&
            (!group || p.group === group) &&
            [p.title, p.description, p.author]
              .join(' ')
              .toLowerCase()
              .includes(query.toLowerCase()),
        );
  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          <button className={tab === 'discover' ? 'active' : ''} onClick={() => setTab('discover')}>
            发现内容
          </button>
          <button
            className={tab === 'favorites' ? 'active' : ''}
            onClick={() => setTab('favorites')}
          >
            收藏夹 · {saved.length}
          </button>
        </div>
        {showInstanceSelect && <InstanceSelect state={state} run={run} />}
      </div>
      <form
        className="toolbar catalog-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          aria-label="搜索内容"
          placeholder="搜索模组、资源或收藏…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {tab === 'discover' ? (
          <>
            <select
              aria-label="内容类型"
              value={kind}
              onChange={(e) => setKind(e.target.value as ContentKind)}
            >
              {Object.entries(kinds).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select
              aria-label="内容来源"
              value={source}
              onChange={(e) => setSource(e.target.value as ContentSource)}
            >
              <option value="modrinth">Modrinth</option>
              <option value="curseforge">CurseForge</option>
            </select>
            <select
              aria-label="内容排序"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
            >
              <option value="downloads">下载量</option>
              <option value="updated">最近更新</option>
              <option value="relevance">相关度</option>
            </select>
            <button disabled={busy || !id}>
              <Search size={16} />
              {busy ? '搜索中' : '搜索'}
            </button>
          </>
        ) : (
          <>
            <select
              aria-label="收藏类别"
              value={favoriteKind}
              onChange={(e) => setFavoriteKind(e.target.value)}
            >
              <option value="all">全部类别</option>
              {Object.entries(kinds).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select aria-label="收藏分组" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">全部分组</option>
              {groups.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </>
        )}
      </form>
      {!id && <p className="muted">选择实例后，可按该实例的游戏版本查询和安装内容。</p>}
      <div className="catalog-grid">
        {visible.map((p) => (
          <article className="panel catalog-card" key={p.source + ':' + p.projectId}>
            <div className="row">
              {p.icon ? (
                <img className="catalog-icon" src={p.icon} alt="" loading="lazy" />
              ) : (
                <Box size={36} />
              )}
              <div className="grow">
                <h3>{p.title}</h3>
                <small>
                  {kinds[p.kind]} · {p.source} · {p.author}
                </small>
              </div>
              <button
                className="icon"
                aria-label={(favorite(p) ? '取消收藏 ' : '收藏 ') + p.title}
                onClick={() =>
                  void run(() =>
                    favorite(p) ? api.removeFavorite(p) : api.saveFavorite({ ...p, group: '' }),
                  )
                }
              >
                <Star size={18} fill={favorite(p) ? 'currentColor' : 'none'} />
              </button>
            </div>
            <p>{p.description}</p>
            <small>{p.downloads.toLocaleString()} 次下载</small>
            {tab === 'favorites' && (
              <label className="favorite-group">
                分组
                <input
                  aria-label={p.title + ' 收藏分组'}
                  defaultValue={favorite(p)?.group ?? ''}
                  maxLength={40}
                  list="favorite-groups"
                  onBlur={(e) => {
                    if (e.target.value !== (favorite(p)?.group ?? ''))
                      void run(() => api.saveFavorite({ ...p, group: e.target.value }));
                  }}
                />
              </label>
            )}
            <div className="row">
              <button disabled={!id} onClick={() => setOpened(p)}>
                <Download size={16} />
                选择版本
              </button>
              <button
                className="icon"
                aria-label={'打开 ' + p.title + ' 项目页'}
                onClick={() => void run(() => api.external(p.url))}
              >
                <ExternalLink size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
      <datalist id="favorite-groups">
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      {!visible.length && (
        <Empty
          title={
            busy
              ? '正在查询内容'
              : tab === 'favorites'
                ? '没有符合条件的收藏'
                : '输入关键词或直接搜索'
          }
          description={
            tab === 'favorites' ? '收藏可离线浏览和分组，安装需要联网' : '结果按当前实例版本筛选'
          }
        />
      )}
      {tab === 'discover' && total > 0 && (
        <div className="toolbar">
          <button
            disabled={busy || offset === 0}
            onClick={() => void search(Math.max(0, offset - 20))}
          >
            上一页
          </button>
          <span>
            {offset + 1}–{offset + items.length} / {total}
          </span>
          <button disabled={busy || offset + 20 >= total} onClick={() => void search(offset + 20)}>
            下一页
          </button>
        </div>
      )}
      {opened && (
        <VersionDialog
          key={id + opened.source + opened.projectId}
          id={id}
          project={opened}
          state={state}
          run={run}
          close={() => setOpened(undefined)}
        />
      )}
    </>
  );
}
function VersionDialog({
  id,
  project: p,
  state,
  run,
  close,
}: {
  id: string;
  project: ContentProject;
  state: Snapshot;
  run: Run;
  close: () => void;
}) {
  const [items, setItems] = useState<ContentVersion[]>([]),
    [chosen, setChosen] = useState(''),
    [busy, setBusy] = useState(false),
    [more, setMore] = useState(false),
    [offset, setOffset] = useState(0);
  const live = useRef(true);
  const load = async (start: number) => {
    setBusy(true);
    const result = await run(() => api.catalogVersions({ ...p, id, offset: start }));
    if (live.current) {
      if (result) {
        setItems(result.items);
        setChosen(result.items[0]?.id ?? '');
        setMore(result.more);
        setOffset(start);
      }
      setBusy(false);
    }
  };
  useEffect(() => {
    live.current = true;
    void load(0);
    return () => {
      live.current = false;
    };
  }, []);
  const v = items.find((v) => v.id === chosen),
    locked = busy || state.running.includes(id) || state.tasks.some((t) => t.status === 'running');
  return (
    <Modal title={p.title + ' · 选择版本'} onClose={close}>
      <div className="form-stack">
        <p>
          目标：{state.instances.find((i) => i.id === id)?.name} ·{' '}
          {state.instances.find((i) => i.id === id)?.version}
        </p>
        {busy ? (
          <p>正在读取版本…</p>
        ) : !items.length ? (
          <p>本页没有兼容版本。</p>
        ) : (
          <select aria-label="安装版本" value={chosen} onChange={(e) => setChosen(e.target.value)}>
            {items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.channel} · {v.published.slice(0, 10)}
              </option>
            ))}
          </select>
        )}
        {v && (
          <div className="panel content-review">
            <strong>{v.fileName}</strong>
            <p>
              {size(v.bytes)} · {v.channel} · 必需依赖 {v.dependencies} 项
            </p>
            <small>{v.gameVersions.slice(0, 20).join(' / ')}</small>
          </div>
        )}
        {p.kind === 'modpack' ? (
          <p>将创建独立实例并下载游戏，保留当前实例。</p>
        ) : p.kind === 'shader' ? (
          <p>光影需要游戏已安装兼容的渲染模组。</p>
        ) : (
          p.kind === 'mod' && <p>安装器会解析必需依赖并校验下载文件；同名非托管文件不会被覆盖。</p>
        )}
        <div className="row">
          <button
            disabled={busy || offset === 0}
            onClick={() => void load(Math.max(0, offset - 20))}
          >
            上一页
          </button>
          <button disabled={busy || !more} onClick={() => void load(offset + 20)}>
            下一页
          </button>
          <button
            className="primary"
            disabled={locked || !v?.downloadable}
            onClick={() => {
              if (v)
                void run(async () => {
                  await api.installContent({ ...p, id, versionId: v.id });
                  close();
                }, '已开始安装，请在下载任务中查看');
            }}
          >
            安装所选版本
          </button>
        </div>
        {v && !v.downloadable && <p>作者未开放 API 下载，请访问项目页获取。</p>}
      </div>
    </Modal>
  );
}
