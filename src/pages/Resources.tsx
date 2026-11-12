import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Plus, RefreshCw } from 'lucide-react';
import type {
  ResourceCandidate,
  ResourceFile,
  ResourceKind,
  ResourcePreview,
  Snapshot,
} from '../../shared/types';
import { api } from '../api';
import { Empty, Modal } from '../components';
import { resourceLabels } from '../dialogs/ResourceImport';
import { size, type Run } from '../ui';
export function ResourcesPage({
  state,
  run,
  onImport,
}: {
  state: Snapshot;
  run: Run;
  onImport: (files: ResourceCandidate[]) => void;
}) {
  const id = state.selectedInstanceId ?? '',
    [files, setFiles] = useState<ResourceFile[]>([]),
    [kind, setKind] = useState<ResourceKind>('shaderpacks'),
    [query, setQuery] = useState(''),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<{ file: ResourceFile; data: ResourcePreview }>(),
    [renaming, setRenaming] = useState<ResourceFile>(),
    [name, setName] = useState('');
  useEffect(() => {
    let alive = true;
    setFiles([]);
    setPreview(undefined);
    setRenaming(undefined);
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
  }, [id, revision, run]);
  const refresh = () => setRevision((n) => n + 1);
  // Snapshot refreshes follow IPC actions; use the instance identity to reject late previews.
  const current = useRef(id);
  current.current = id;
  const visible = files.filter(
    (f) => f.kind === kind && f.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="toolbar">
        <select
          aria-label="资源实例"
          value={id}
          onChange={(e) => void run(() => api.select({ instanceId: e.target.value }))}
        >
          <option value="" disabled>
            选择实例
          </option>
          {state.instances.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} · {i.version}
            </option>
          ))}
        </select>
        <button disabled={!id} onClick={() => void run(() => api.openFolder({ id, folder: kind }))}>
          <FolderOpen size={16} />
          打开目录
        </button>
        <button disabled={loading || !id} onClick={refresh}>
          <RefreshCw size={16} />
          刷新
        </button>
        <button
          className="primary"
          onClick={async () => {
            const f = await run(() => api.pickResources());
            if (f?.length) onImport(f);
          }}
        >
          <Plus size={16} />
          添加资源
        </button>
      </div>
      <div className="tabs resource-tabs">
        {Object.entries(resourceLabels).map(([key, label]) => (
          <button
            className={key === kind ? 'active' : ''}
            key={key}
            onClick={() => setKind(key as ResourceKind)}
          >
            {label}
            <span>{files.filter((f) => f.kind === key).length}</span>
          </button>
        ))}
      </div>
      <input
        className="resource-search"
        aria-label="搜索资源"
        placeholder="搜索当前实例的资源"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!id ? (
        <Empty title="选择一个游戏实例" description="按实例管理光影、资源包、录像与原理图" />
      ) : !visible.length ? (
        <Empty
          title={loading ? '正在读取资源…' : '没有匹配的资源'}
          description="将文件拖到启动器任意页面，或点击添加资源"
        />
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
              <div className="resource-actions">
                <button
                  onClick={() =>
                    void run(async () => {
                      const data = await api.previewResource({ id, kind, name: file.name });
                      if (current.current === id) setPreview({ file, data });
                    })
                  }
                >
                  预览
                </button>
                <button
                  onClick={() => {
                    setRenaming(file);
                    setName(file.name.split('/').at(-1)!);
                  }}
                >
                  重命名
                </button>
                <button
                  onClick={() => void run(() => api.exportResource({ id, kind, name: file.name }))}
                >
                  导出
                </button>
                <button
                  onClick={() => void run(() => api.revealResource({ id, kind, name: file.name }))}
                >
                  定位
                </button>
                <button
                  className="danger"
                  onClick={() =>
                    void run(async () => {
                      await api.deleteResource({ id, kind, name: file.name });
                      refresh();
                    })
                  }
                >
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
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
    </>
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
