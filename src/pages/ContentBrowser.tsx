import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Search, Star, X } from 'lucide-react';
import type {
  ContentKind,
  ContentProject,
  ContentRef,
  ContentSource,
  ContentVersion,
  Snapshot,
} from '../../shared/types';
import { api } from '../api';
import { Modal } from '../components';
import { Select } from '../Select';
import { size, type Run } from '../ui';

export const contentLabels: Record<ContentKind, string> = {
  mod: '模组',
  resourcepack: '资源包',
  shader: '光影',
  modpack: '整合包',
};
export const sameContent = (a: ContentRef, b: ContentRef) =>
  a.source === b.source && a.kind === b.kind && a.projectId === b.projectId;

export function FavoriteButton({
  project,
  state,
  run,
}: {
  project: ContentRef;
  state: Snapshot;
  run: Run;
}) {
  const saved = state.favorites?.some((f) => sameContent(f, project));
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="icon"
      aria-label={saved ? '取消收藏' : '收藏'}
      title={saved ? '取消收藏' : '收藏'}
      aria-pressed={!!saved}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await run(() =>
          saved ? api.removeFavorite(project) : api.saveFavorite({ ...project, group: '' }),
        );
        setBusy(false);
      }}
    >
      <Star size={16} fill={saved ? 'currentColor' : 'none'} />
    </button>
  );
}

export function ContentVersions({
  project,
  state,
  run,
  onClose,
}: {
  project: ContentProject;
  state: Snapshot;
  run: Run;
  onClose: () => void;
}) {
  const id = state.selectedInstanceId!;
  const [page, setPage] = useState<{ items: ContentVersion[]; more: boolean }>();
  const [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState<string>(),
    [selected, setSelected] = useState('');
  const [failed, setFailed] = useState(false),
    [revision, setRevision] = useState(0);
  const live = useRef(true);
  const ref: ContentRef = {
    source: project.source,
    kind: project.kind,
    projectId: project.projectId,
  };
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    setSelected('');
    setTaskId(undefined);
    setPage(undefined);
    void run(() => api.catalogVersions({ ...ref, id, offset })).then((next) => {
      if (!active) return;
      setPage(next);
      setFailed(!next);
      setLoading(false);
      setSelected(next?.items.find((v) => v.downloadable)?.id ?? '');
    });
    return () => {
      active = false;
    };
  }, [id, project.source, project.kind, project.projectId, offset, revision, run]);
  const task = state.tasks.find((t) => t.id === taskId);
  const locked = busy || task?.status === 'running' || state.running.includes(id);
  const instance = state.instances.find((i) => i.id === id);
  const version = page?.items.find((v) => v.id === selected);
  return (
    <Modal title={project.title} onClose={onClose}>
      <div className="row content-version-head">
        <span className="badge">
          {instance?.version} · {contentLabels[project.kind]}
        </span>
        <button className="text-button" onClick={() => void run(() => api.external(project.url))}>
          项目页面 <ExternalLink size={14} />
        </button>
      </div>
      {loading ? (
        <p className="resource-empty" role="status">
          正在读取版本…
        </p>
      ) : failed ? (
        <p className="resource-empty">
          读取失败 <button onClick={() => setRevision((r) => r + 1)}>重试</button>
        </p>
      ) : !page?.items.length ? (
        <p className="resource-empty">没有兼容版本</p>
      ) : (
        <>
          <label className="field content-dialog-field">
            版本
            <Select
              aria-label="内容版本"
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setTaskId(undefined);
              }}
              disabled={locked}
            >
              <option value="" disabled>
                选择版本
              </option>
              {page.items.map((v) => (
                <option key={v.id} value={v.id} disabled={!v.downloadable}>
                  {v.name} ·{' '}
                  {v.channel === 'release'
                    ? '正式版'
                    : v.channel === 'beta'
                      ? '测试版'
                      : v.channel === 'alpha'
                        ? '预览版'
                        : v.channel}
                  {!v.downloadable ? ' · 未开放下载' : ''}
                </option>
              ))}
            </Select>
          </label>
          {version && (
            <p className="muted content-file">
              {version.fileName} · {size(version.bytes)}
              {version.dependencies > 0 && ` · ${version.dependencies} 项依赖`}
            </p>
          )}
          <div className="pagination">
            <button
              disabled={loading || locked || !offset}
              onClick={() => setOffset((v) => Math.max(0, v - 20))}
            >
              上一页
            </button>
            <span>{offset / 20 + 1}</span>
            <button
              disabled={loading || locked || !page.more}
              onClick={() => setOffset((v) => v + 20)}
            >
              下一页
            </button>
          </div>
        </>
      )}
      {task && (
        <p className="muted" role="status">
          {task.status === 'running'
            ? '正在安装…'
            : task.status === 'completed'
              ? '安装完成'
              : task.status === 'cancelled'
                ? '已取消'
                : '安装失败，可重试'}
        </p>
      )}
      <div className="modal-footer">
        <FavoriteButton project={ref} state={state} run={run} />
        <button onClick={onClose}>关闭</button>
        <button
          className="primary"
          disabled={
            !version?.downloadable ||
            loading ||
            locked ||
            task?.status === 'completed' ||
            (project.kind === 'mod' && instance?.loader === 'vanilla')
          }
          onClick={async () => {
            if (!version || locked) return;
            setBusy(true);
            const task = await run(() => api.installContent({ ...ref, id, versionId: version.id }));
            if (live.current) {
              setTaskId(task);
              setBusy(false);
            }
          }}
        >
          {project.kind === 'modpack' ? '创建新实例' : '安装'}
        </button>
      </div>
    </Modal>
  );
}

export function ContentBrowser({
  kind,
  state,
  run,
}: {
  kind: ContentKind;
  state: Snapshot;
  run: Run;
}) {
  const id = state.selectedInstanceId!;
  const [query, setQuery] = useState(''),
    [source, setSource] = useState<ContentSource>('modrinth');
  const [sort, setSort] = useState<'relevance' | 'downloads' | 'updated'>('relevance');
  const [loading, setLoading] = useState(false),
    [failed, setFailed] = useState(false);
  const [result, setResult] = useState<{
    items: ContentProject[];
    total: number;
    offset: number;
    query: string;
  }>();
  const [project, setProject] = useState<ContentProject>();
  const epoch = useRef(0);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  const reset = () => {
    epoch.current++;
    setResult(undefined);
    setLoading(false);
    setFailed(false);
  };
  const search = async (offset = 0, text = query.trim()) => {
    const request = ++epoch.current;
    setLoading(true);
    setFailed(false);
    const next = await run(() =>
      api.catalogSearch({ id, kind, query: text, source, offset, sort }),
    );
    if (request !== epoch.current) return;
    setResult(next ? { ...next, offset, query: text } : undefined);
    setLoading(false);
    setFailed(!next);
  };
  return (
    <section className="content-browser" aria-label={'在线' + contentLabels[kind]}>
      <form
        className="resource-searchbar"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="search-input grow">
          <Search size={16} />
          <input
            aria-label={'搜索在线' + contentLabels[kind]}
            placeholder={'搜索在线' + contentLabels[kind]}
            value={query}
            maxLength={120}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select
          aria-label="内容来源"
          value={source}
          onChange={(e) => {
            setSource(e.target.value as ContentSource);
            reset();
          }}
        >
          <option value="modrinth">Modrinth</option>
          <option value="curseforge">CurseForge</option>
        </Select>
        <Select
          aria-label="内容排序"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as typeof sort);
            reset();
          }}
        >
          <option value="relevance">相关度</option>
          <option value="downloads">下载量</option>
          <option value="updated">最近更新</option>
        </Select>
        <button className="primary" disabled={loading}>
          搜索
        </button>
      </form>
      {(result || loading || failed) && (
        <div aria-busy={loading}>
          <div className="resource-section-head">
            <h2>
              搜索结果 <span>{result?.total}</span>
            </h2>
            <button className="icon" aria-label="收起在线搜索" onClick={reset}>
              <X size={16} />
            </button>
          </div>
          {loading && (
            <p className="resource-empty" role="status">
              正在搜索…
            </p>
          )}
          {failed && (
            <p className="resource-empty">
              搜索失败 <button onClick={() => void search()}>重试</button>
            </p>
          )}
          {!loading && result && !result.items.length && (
            <p className="resource-empty">没有找到兼容内容</p>
          )}
          {result && (
            <div className="mod-list panel">
              {result.items.map((p) => (
                <article className="mod-row" key={p.source + p.projectId}>
                  <div className="grow">
                    <strong>{p.title}</strong>
                    <p>{p.description}</p>
                    <small>
                      {p.author} ·{' '}
                      {Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(p.downloads)}{' '}
                      次下载
                    </small>
                  </div>
                  <FavoriteButton
                    project={{ source: p.source, kind: p.kind, projectId: p.projectId }}
                    state={state}
                    run={run}
                  />
                  <button disabled={loading} onClick={() => setProject(p)}>
                    选择版本
                  </button>
                </article>
              ))}
            </div>
          )}
          {result && result.total > 20 && (
            <div className="pagination">
              <button
                disabled={loading || !result.offset}
                onClick={() => void search(result.offset - 20, result.query)}
              >
                上一页
              </button>
              <span>
                {result.offset + 1}–{Math.min(result.offset + 20, result.total)} / {result.total}
              </span>
              <button
                disabled={loading || result.offset + 20 >= result.total}
                onClick={() => void search(result.offset + 20, result.query)}
              >
                下一页
              </button>
            </div>
          )}
        </div>
      )}
      {project && (
        <ContentVersions
          key={id + project.source + project.projectId}
          project={project}
          state={state}
          run={run}
          onClose={() => setProject(undefined)}
        />
      )}
    </section>
  );
}
