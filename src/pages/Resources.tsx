import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { matchesSearch } from '../../shared/search';
import { LocalResourceArt, useLocalCards } from '../components/LocalResourceArt';
import { Select } from '../Select';
import { Eye, FolderOpen, Plus, RefreshCw, Star } from 'lucide-react';
import type {
  ResourceCandidate,
  ResourceFile,
  ResourceKind,
  ResourcePreview,
  Snapshot,
} from '../../shared/types';
import type { ProjectionDocument } from '../../shared/projection';
import { api } from '../api';
import { Empty, Modal, InstanceSelect } from '../components';
import { ItemArt, type ItemName } from '../components/ItemArt';
import { SplitView } from '../components/SplitView';
import { resourceLabels } from '../dialogs/ResourceImport';
import { size, type Run } from '../ui';
import { ModResources } from './ModResources';
import { ContentBrowser } from './ContentBrowser';
import { Favorites } from './Favorites';
import { RedenBrowser } from './RedenBrowser';
import '../resources.css';
const resourceNames = new Intl.Collator('zh-CN', { numeric: true });
const categoryArt: Record<ResourceKind, ItemName> = {
  mods: 'dust',
  shaderpacks: 'sun',
  resourcepacks: 'block',
  replay_recordings: 'reel',
  schematics: 'plan',
};
export interface ResourceView {
  kind: ResourceKind;
  query: string;
}
export function ResourcesPage({
  state,
  run,
  onImport,
  onLibrary,
  refreshKey = 0,
  view,
  onView,
  onProjection,
}: {
  state: Snapshot;
  run: Run;
  onImport: (files: ResourceCandidate[]) => void;
  onLibrary: () => void;
  refreshKey?: number;
  view: ResourceView;
  onView: (value: ResourceView) => void;
  onProjection: (document: ProjectionDocument) => void;
}) {
  const id = state.selectedInstanceId ?? '',
    [files, setFiles] = useState<ResourceFile[]>([]),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0),
    [favorites, setFavorites] = useState(false),
    [openingProjection, setOpeningProjection] = useState(false);
  const { kind, query } = view;
  const [localSort, setLocalSort] = useState<'updated' | 'name' | 'size'>('updated');
  const mounted = useRef(true),
    opening = useRef(false),
    previewGeneration = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      previewGeneration.current++;
    };
  }, []);
  const [preview, setPreview] = useState<{ file: ResourceFile; data: ResourcePreview }>(),
    [renaming, setRenaming] = useState<ResourceFile>(),
    [name, setName] = useState('');
  const completed = state.tasks
    .filter((t) => t.status !== 'running')
    .map((t) => `${t.id}:${t.status}`)
    .join('|');
  useEffect(() => {
    let alive = true;
    if (!id) return;
    setLoading(true);
    void run(async () => {
      const f = await api.resources(id);
      if (alive) setFiles(f);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id, revision, refreshKey, completed, run]);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  const current = useRef(id);
  current.current = id;
  const currentKind = useRef(kind);
  currentKind.current = kind;
  const previewFile = (file: ResourceFile) => {
    if (opening.current) return;
    const generation = ++previewGeneration.current;
    const valid = () =>
      mounted.current &&
      current.current === id &&
      currentKind.current === file.kind &&
      previewGeneration.current === generation;
    if (file.kind === 'schematics') {
      opening.current = true;
      setOpeningProjection(true);
      void run(async () => {
        const document = await api.projectionImportResource({ id, name: file.name });
        if (valid()) onProjection(document);
      }).finally(() => {
        opening.current = false;
        if (mounted.current) setOpeningProjection(false);
      });
    } else {
      void run(async () => {
        const data = await api.previewResource({ id, kind: file.kind, name: file.name });
        if (valid()) setPreview({ file, data });
      });
    }
  };
  const cardKind = kind === 'mods' || kind === 'resourcepacks' ? kind : undefined;
  const names = useMemo(
    () => files.filter((f) => f.kind === cardKind).map((f) => f.name),
    [files, cardKind],
  );
  const cards = useLocalCards(id, cardKind, names);
  const ordered = useMemo(
    () =>
      files
        .filter((f) => f.kind === kind)
        .sort((a, b) => {
          const delta =
            localSort === 'updated'
              ? b.modifiedAt - a.modifiedAt
              : localSort === 'size'
                ? b.size - a.size
                : 0;
          return (
            delta ||
            resourceNames.compare(
              cards?.get(a.name)?.title ?? a.name,
              cards?.get(b.name)?.title ?? b.name,
            )
          );
        }),
    [files, kind, localSort, cards],
  );
  const visible = ordered.filter((f) =>
    matchesSearch(query, f.name, cards?.get(f.name)?.description),
  );
  const localSearch = (
    <div className="local-resource-search">
      <input
        className="resource-search"
        aria-label={kind === 'mods' ? '搜索本地模组' : '搜索资源'}
        placeholder={'搜索本地' + resourceLabels[kind]}
        value={query}
        onChange={(e) => onView({ kind, query: e.target.value })}
      />
      <Select
        aria-label="本地排序"
        value={localSort}
        onChange={(e) => setLocalSort(e.target.value as typeof localSort)}
      >
        <option value="updated">最近修改</option>
        <option value="name">名称</option>
        <option value="size">文件大小</option>
      </Select>
    </div>
  );
  const locked = state.running.includes(id);
  const actions = (file: ResourceFile, allowRename = true) => (
    <div className="resource-actions">
      <button
        type="button"
        className="icon"
        aria-label={'预览 ' + file.name}
        title="预览"
        disabled={openingProjection}
        onClick={() => previewFile(file)}
      >
        <Eye size={18} aria-hidden="true" />
      </button>
      <details
        className="resource-menu"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) e.currentTarget.open = false;
        }}
      >
        <summary aria-label={'更多操作 ' + file.name}>更多</summary>
        <div className="resource-menu-items">
          {allowRename && (
            <button
              disabled={locked}
              onClick={() => {
                setRenaming(file);
                setName(file.name.split('/').at(-1)!);
              }}
            >
              重命名
            </button>
          )}
          <button
            onClick={() =>
              void run(() => api.exportResource({ id, kind: file.kind, name: file.name }))
            }
          >
            导出
          </button>
          <button
            onClick={() =>
              void run(() => api.revealResource({ id, kind: file.kind, name: file.name }))
            }
          >
            定位
          </button>
          <button
            className="danger"
            disabled={locked}
            onClick={() =>
              void run(async () => {
                if (file.kind === 'mods') await api.deleteMod({ id, name: file.name });
                else await api.deleteResource({ id, kind: file.kind, name: file.name });
                refresh();
              })
            }
          >
            删除
          </button>
        </div>
      </details>
    </div>
  );
  return (
    <>
      <SplitView
        className="unified-resources"
        railLabel="资源分类"
        rail={
          <>
            <div className="resource-instance-picker">
              <span>当前实例</span>
              <InstanceSelect state={state} run={run} />
            </div>
            <div
              className="rail-list resource-tabs"
              role="tablist"
              aria-orientation="vertical"
              aria-label="资源分类"
            >
              {Object.entries(resourceLabels).map(([key, label], index) => (
                <button
                  role="tab"
                  id={'resource-tab-' + key}
                  aria-controls="resource-panel"
                  aria-selected={key === kind}
                  tabIndex={key === kind ? 0 : -1}
                  className="rail-option"
                  key={key}
                  onKeyDown={(e) => {
                    const tabs = Array.from(
                      e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                        '[role="tab"]',
                      ),
                    );
                    const next =
                      e.key === 'ArrowDown' || e.key === 'ArrowRight'
                        ? (index + 1) % tabs.length
                        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
                          ? (index - 1 + tabs.length) % tabs.length
                          : e.key === 'Home'
                            ? 0
                            : e.key === 'End'
                              ? tabs.length - 1
                              : undefined;
                    if (next !== undefined) {
                      e.preventDefault();
                      tabs[next]!.click();
                      tabs[next]!.focus();
                    }
                  }}
                  onClick={() => {
                    previewGeneration.current++;
                    onView({ kind: key as ResourceKind, query: '' });
                  }}
                >
                  <ItemArt name={categoryArt[key as ResourceKind]} size={24} />
                  <strong>{label}</strong>
                  {id && (
                    <small className="rail-count">
                      {files.filter((f) => f.kind === key).length}
                    </small>
                  )}
                </button>
              ))}
            </div>
          </>
        }
      >
        <div className="resource-context">
          <h2>{resourceLabels[kind]}</h2>
          <div className="row">
            <button onClick={() => setFavorites(true)}>
              <Star size={16} />
              收藏
            </button>
            {id && kind === 'mods' && (
              <button disabled={!id} onClick={() => void run(() => api.exportModList(id))}>
                导出清单
              </button>
            )}
            {id && (
              <>
                <button
                  className="icon"
                  aria-label="打开资源目录"
                  title="打开目录"
                  disabled={!id}
                  onClick={() => void run(() => api.openFolder({ id, folder: kind }))}
                >
                  <FolderOpen size={17} />
                </button>
                <button
                  className="icon"
                  aria-label="刷新资源"
                  title="刷新"
                  disabled={loading || !id}
                  onClick={refresh}
                >
                  <RefreshCw size={17} />
                </button>
                <button
                  className="primary"
                  disabled={!id || locked}
                  onClick={async () => {
                    const f = await run(() => api.pickResources());
                    if (f?.length) onImport(f);
                  }}
                >
                  <Plus size={16} />
                  添加资源
                </button>
              </>
            )}
          </div>
        </div>
        <div
          key={kind}
          role="tabpanel"
          id="resource-panel"
          aria-labelledby={'resource-tab-' + kind}
        >
          {openingProjection && <p role="status">正在打开投影…</p>}
          {!id ? (
            <Empty
              art={categoryArt[kind]}
              title="选择一个游戏实例"
              action={<button onClick={onLibrary}>管理实例</button>}
            />
          ) : kind === 'mods' ? (
            <ModResources
              key={id}
              state={state}
              run={run}
              files={ordered}
              cards={cards}
              query={query}
              search={localSearch}
              revision={revision + refreshKey}
              onChanged={refresh}
              actions={actions}
            />
          ) : (
            <>
              {kind === 'schematics' && <RedenBrowser key={id} id={id} run={run} locked={locked} />}
              {(kind === 'shaderpacks' || kind === 'resourcepacks') && (
                <ContentBrowser
                  key={id + kind}
                  kind={kind === 'shaderpacks' ? 'shader' : 'resourcepack'}
                  state={state}
                  run={run}
                />
              )}
              <div className="resource-section-head">
                <h2>
                  已安装 <span>{visible.length}</span>
                </h2>
              </div>
              {localSearch}
              {!visible.length ? (
                <Empty title={loading ? '正在读取资源…' : '暂无匹配资源'} />
              ) : (
                <div className="resource-list">
                  {visible.map((file) => (
                    <article className="panel resource-row" key={file.kind + file.name}>
                      {kind === 'resourcepacks' && (
                        <LocalResourceArt kind={kind} icon={cards?.get(file.name)?.icon} />
                      )}
                      <div className="grow">
                        <strong>{file.name}</strong>
                        <small>
                          {size(file.size)} · {new Date(file.modifiedAt).toLocaleString('zh-CN')}
                        </small>
                      </div>
                      {actions(file)}
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </SplitView>
      {favorites && (
        <Favorites key={id} state={state} run={run} onClose={() => setFavorites(false)} />
      )}
      {preview && (
        <Modal wide title={preview.file.name} onClose={() => setPreview(undefined)}>
          <div className="resource-preview">
            {preview.data.title !== preview.file.name && <h3>{preview.data.title}</h3>}
            {preview.data.image && (
              <img className="resource-cover" src={preview.data.image} alt="资源缩略图" />
            )}
            {preview.data.description && <p>{preview.data.description}</p>}
            <dl>
              {!preview.data.details.length && (
                <div>
                  <dt>文件大小</dt>
                  <dd>{size(preview.file.size)}</dd>
                </div>
              )}
              {preview.data.details.map((d, i) => (
                <div key={i}>
                  <dt>{d.label}</dt>
                  <dd>{d.value}</dd>
                </div>
              ))}
            </dl>
            {preview.data.warning && <p>{preview.data.warning}</p>}
          </div>
        </Modal>
      )}
      {renaming && (
        <Modal title="重命名资源" onClose={() => setRenaming(undefined)}>
          <div className="form-body">
            <label className="field">
              文件名
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <div className="modal-footer">
            <button onClick={() => setRenaming(undefined)}>取消</button>
            <button
              className="primary"
              onClick={() =>
                void run(async () => {
                  await api.renameResource({
                    id,
                    kind: renaming.kind,
                    name: renaming.name,
                    newName: name,
                  });
                  setRenaming(undefined);
                  refresh();
                })
              }
            >
              保存
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
