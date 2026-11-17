import { useEffect, useRef, useState, useCallback } from 'react';
import { FolderOpen, Plus, RefreshCw, Star } from 'lucide-react';
import type {
  ResourceCandidate,
  ResourceFile,
  ResourceKind,
  ResourcePreview,
  Snapshot,
} from '../../shared/types';
import { api } from '../api';
import { Empty, Modal, InstanceSelect } from '../components';
import { resourceLabels } from '../dialogs/ResourceImport';
import { size, loaderLabel, type Run } from '../ui';
import { ModResources } from './ModResources';
import { ContentBrowser } from './ContentBrowser';
import { Favorites } from './Favorites';
import '../resources.css';
export function ResourcesPage({
  state,
  run,
  onImport,
  refreshKey = 0,
}: {
  state: Snapshot;
  run: Run;
  onImport: (files: ResourceCandidate[]) => void;
  refreshKey?: number;
}) {
  const id = state.selectedInstanceId ?? '',
    [files, setFiles] = useState<ResourceFile[]>([]),
    [kind, setKind] = useState<ResourceKind>('mods'),
    [query, setQuery] = useState(''),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0),
    [favorites, setFavorites] = useState(false);
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
  const visible = files.filter(
    (f) => f.kind === kind && f.name.toLowerCase().includes(query.toLowerCase()),
  );
  const instance = state.instances.find((i) => i.id === id);
  const locked = state.running.includes(id);
  const actions = (file: ResourceFile, allowRename = true) => (
    <details
      className="resource-menu"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) e.currentTarget.open = false;
      }}
    >
      <summary aria-label={'更多操作 ' + file.name}>更多</summary>
      <div className="resource-menu-items">
        <button
          onClick={() =>
            void run(async () => {
              const data = await api.previewResource({ id, kind: file.kind, name: file.name });
              if (current.current === id) setPreview({ file, data });
            })
          }
        >
          预览
        </button>
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
  );
  return (
    <div className="unified-resources">
      <div className="resource-context">
        <div className="resource-instance">
          <InstanceSelect state={state} run={run} />
          {instance && <span className="badge">{loaderLabel[instance.loader]}</span>}
        </div>
        <div className="row">
          <button onClick={() => setFavorites(true)}>
            <Star size={16} />
            收藏
          </button>
          {kind === 'mods' && (
            <button disabled={!id} onClick={() => void run(() => api.exportModList(id))}>
              导出清单
            </button>
          )}
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
        </div>
      </div>
      <div className="tabs resource-tabs" role="tablist" aria-label="资源分类">
        {Object.entries(resourceLabels).map(([key, label], index) => (
          <button
            role="tab"
            id={'resource-tab-' + key}
            aria-controls="resource-panel"
            aria-selected={key === kind}
            tabIndex={key === kind ? 0 : -1}
            className={key === kind ? 'active' : ''}
            key={key}
            onKeyDown={(e) => {
              const tabs = Array.from(
                e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
              );
              const next =
                e.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : e.key === 'ArrowLeft'
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
              setKind(key as ResourceKind);
              setQuery('');
            }}
          >
            {label}
            <span>{files.filter((f) => f.kind === key).length}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id="resource-panel" aria-labelledby={'resource-tab-' + kind}>
        {!id ? (
          <Empty title="选择一个游戏实例" />
        ) : kind === 'mods' ? (
          <ModResources
            key={id}
            state={state}
            run={run}
            files={files}
            revision={revision + refreshKey}
            onChanged={refresh}
            actions={actions}
          />
        ) : (
          <>
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
            <input
              className="resource-search"
              aria-label="搜索资源"
              placeholder={'搜索' + resourceLabels[kind]}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {!visible.length ? (
              <Empty title={loading ? '正在读取资源…' : '暂无匹配资源'} />
            ) : (
              <div className="resource-list">
                {visible.map((file) => (
                  <article className="panel resource-row" key={file.kind + file.name}>
                    <div>
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
      {favorites && (
        <Favorites key={id} state={state} run={run} onClose={() => setFavorites(false)} />
      )}
      {preview && (
        <Modal wide title={preview.file.name} onClose={() => setPreview(undefined)}>
          <div className="resource-preview">
            <h3>{preview.data.title}</h3>
            {preview.data.image && (
              <img className="resource-cover" src={preview.data.image} alt="资源缩略图" />
            )}
            {preview.data.description && <p>{preview.data.description}</p>}
            <dl>
              {preview.data.details.map((d, i) => (
                <div key={i}>
                  <dt>{d.label}</dt>
                  <dd>{d.value}</dd>
                </div>
              ))}
            </dl>
            {preview.data.warning && <p>{preview.data.warning}</p>}
            {preview.data.layers?.map((layer, i) => (
              <SchematicLayer key={i} layer={layer} />
            ))}
            {preview.data.layers?.length ? (
              <p className="muted">方块俯视图 · 颜色用于区分方块类型，不代表游戏材质</p>
            ) : null}
          </div>
        </Modal>
      )}
      {renaming && (
        <Modal title="重命名资源" onClose={() => setRenaming(undefined)}>
          <div className="form">
            <label>
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
    </div>
  );
}
function SchematicLayer({ layer }: { layer: NonNullable<ResourcePreview['layers']>[number] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, layer.width, layer.depth);
    layer.cells.forEach((block, i) => {
      if (!block) return;
      let hash = 0;
      for (const c of block) hash = (hash * 31 + c.charCodeAt(0)) | 0;
      ctx.fillStyle = `hsl(${Math.abs(hash) % 360} 40% 60%)`;
      ctx.fillRect(i % layer.width, Math.floor(i / layer.width), 1, 1);
    });
  }, [layer]);
  return (
    <figure className="schematic-preview">
      <figcaption>
        {layer.name} · {layer.width} × {layer.depth}
      </figcaption>
      <canvas
        ref={canvas}
        width={layer.width}
        height={layer.depth}
        aria-label={layer.name + ' 方块俯视图'}
      />
    </figure>
  );
}
