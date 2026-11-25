import { matchesSearch } from '../../shared/search';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Download,
  Expand,
  FolderOpen,
  Layers,
  Maximize2,
  Redo2,
  Save,
  Shrink,
  Undo2,
} from 'lucide-react';
import type { Snapshot } from '../../shared/types';
import type { ProjectionAssets } from '../../shared/projection-assets';
import type {
  ProjectionDocument,
  ProjectionEntry,
  ProjectionOp,
  ProjectionSelection,
} from '../../shared/projection';
import { api } from '../api';
import type { Run } from '../ui';
import { ItemArt } from '../components/ItemArt';
import { Modal } from '../components';
import { Select } from '../Select';
import {
  ProjectionViewport,
  type ViewActions,
  type ViewMode,
} from '../projection/ProjectionViewport';
import {
  blockName,
  blockState,
  coordinates,
  decodeBlocks,
  distance,
  isAir,
  parseBlock,
  type Point,
} from '../projection/model';
import '../projection/projection.css';

export function ProjectionWorkshopPage({
  state,
  active = true,
  importDocument,
  onImported,
}: {
  state: Snapshot;
  run: Run;
  active?: boolean;
  importDocument?: ProjectionDocument;
  onImported?: () => void;
}) {
  const [doc, setDoc] = useState<ProjectionDocument | null>(null),
    [entries, setEntries] = useState<ProjectionEntry[]>([]),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [assets, setAssets] = useState<ProjectionAssets | null>(null),
    [assetError, setAssetError] = useState(''),
    [assetLoading, setAssetLoading] = useState(false),
    [assetRetry, setAssetRetry] = useState(0),
    [renderStatus, setRenderStatus] = useState('');
  const [selected, setSelected] = useState(new Set<number>()),
    [hidden, setHidden] = useState(new Set<number>()),
    [hover, setHover] = useState<number>(),
    [mode, setMode] = useState<ViewMode>('select'),
    [measure, setMeasure] = useState<number[]>([]);
  const [layerMin, setLayerMin] = useState(0),
    [layerMax, setLayerMax] = useState(0),
    [spacing, setSpacing] = useState(0),
    [grid, setGrid] = useState(true),
    [fullscreen, setFullscreen] = useState(false),
    [panel, setPanel] = useState(true),
    [tab, setTab] = useState<'edit' | 'materials'>('edit');
  const [modal, setModal] = useState<'library' | 'install' | 'remove' | null>(null),
    [removeId, setRemoveId] = useState(''),
    [name, setName] = useState(''),
    [replacement, setReplacement] = useState('minecraft:stone'),
    [filter, setFilter] = useState('');
  const [instanceId, setInstanceId] = useState(
      state.selectedInstanceId ?? state.instances[0]?.id ?? '',
    ),
    [format, setFormat] = useState<'litematic' | 'schem' | 'nbt'>('litematic'),
    [from, setFrom] = useState<Point>([0, 0, 0]),
    [to, setTo] = useState<Point>([0, 0, 0]);
  const actions = useRef<ViewActions | undefined>(undefined),
    current = useRef({ doc, active, fullscreen, modal, busy }),
    mounted = useRef(true),
    selectionGeneration = useRef(0);
  current.current = { doc, active, fullscreen, modal, busy };
  const ref = doc ? { id: doc.id, revision: doc.revision } : null;
  const decoded = useMemo(() => {
    try {
      return { blocks: doc ? decodeBlocks(doc) : new Uint32Array() };
    } catch (e) {
      return { blocks: new Uint32Array(), error: String(e) };
    }
  }, [doc?.revision]);
  const blocks = decoded.blocks;
  const assetNames = useMemo(
    () => (doc ? JSON.stringify([...new Set(doc.palette.map((block) => block.name))].sort()) : ''),
    [doc?.palette],
  );
  useEffect(() => {
    if (!assetNames) return;
    let canceled = false;
    setAssetLoading(true);
    setAssetError('');
    setAssets(null);
    void api.projectionAssets({ blocks: JSON.parse(assetNames) as string[] }).then(
      (value) => {
        if (!canceled) {
          setAssets(value);
          setAssetLoading(false);
        }
      },
      (failure) => {
        if (!canceled) {
          setAssetError(failure instanceof Error ? failure.message : String(failure));
          setAssetLoading(false);
        }
      },
    );
    return () => {
      canceled = true;
    };
  }, [assetNames, assetRetry]);
  const apply = (value: ProjectionDocument) => {
    selectionGeneration.current++;
    setDoc(value);
    setName(value.name);
    setSelected(new Set());
    setHidden(new Set());
    setMeasure([]);
    setHover(undefined);
    setLayerMin(0);
    setLayerMax(value.dimensions[1] - 1);
    setFrom([0, 0, 0]);
    setTo(value.dimensions.map((v) => v - 1) as Point);
    setModal(null);
    setEntries((old) => [
      { id: value.id, name: value.name, modifiedAt: Date.now() },
      ...old.filter((v) => v.id !== value.id),
    ]);
  };
  const execute = async <T,>(work: () => Promise<T>, receive?: (value: T) => void) => {
    if (current.current.busy) return;
    setBusy(true);
    current.current.busy = true;
    setError('');
    setNotice('');
    try {
      const value = await work();
      if (mounted.current) receive?.(value);
      return value;
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(false);
      current.current.busy = false;
    }
  };
  const load = () =>
    execute(
      () => api.projectionState(),
      (value) => {
        setEntries(value.entries);
        if (value.current) apply(value.current);
        setLoaded(true);
      },
    );
  useEffect(() => {
    mounted.current = true;
    void load().finally(() => setLoaded(true));
    return () => {
      mounted.current = false;
      selectionGeneration.current++;
    };
  }, []);
  useEffect(() => {
    if (!importDocument || !loaded || busy || !active) return;
    setError('');
    setNotice('');
    apply(importDocument);
    onImported?.();
  }, [importDocument, loaded, busy, active, onImported]);
  useEffect(
    () =>
      api.onEvent((event) => {
        if (event.type === 'window-fullscreen') setFullscreen(event.fullscreen);
      }),
    [],
  );
  useEffect(() => {
    if (!active && current.current.fullscreen) void api.windowFullscreen(false).catch(() => {});
  }, [active]);
  const edit = (op: ProjectionOp) => {
    if (ref) void execute(() => api.projectionEdit({ ...ref, op }), apply);
  };
  const undo = (redo = false) => {
    if (ref) void execute(() => (redo ? api.projectionRedo(ref) : api.projectionUndo(ref)), apply);
  };
  const exportFile = (exportFormat: 'litematic' | 'schem' | 'nbt' | 'materials' | 'png') => {
    if (!ref) return;
    void execute(
      () =>
        api.projectionExport({
          ...ref,
          format: exportFormat,
          ...(exportFormat === 'png' ? { image: actions.current?.capture() } : {}),
        }),
      (value) => {
        if (value) setNotice('已导出');
      },
    );
  };
  const callbacks = useRef({ undo, exportFile, edit, selected });
  callbacks.current = { undo, exportFile, edit, selected };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const c = current.current;
      if (!c.active) return;
      if (e.key === 'Escape' && c.fullscreen && !c.modal) {
        e.preventDefault();
        void api
          .windowFullscreen(false)
          .then(setFullscreen)
          .catch((error) => setError(String(error)));
        return;
      }
      if (
        c.modal ||
        c.busy ||
        (e.target as HTMLElement)?.closest('input,textarea,[contenteditable="true"]')
      )
        return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          const d = c.doc;
          if (e.shiftKey ? d?.canRedo : d?.canUndo) callbacks.current.undo(e.shiftKey);
        }
        if (e.key.toLowerCase() === 'y' && c.doc?.canRedo) {
          e.preventDefault();
          callbacks.current.undo(true);
        }
        if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          callbacks.current.exportFile('litematic');
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const importFile = (path?: string) =>
    void execute(
      () => api.projectionImport(path),
      (value) => {
        if (value) apply(value);
      },
    );
  const select = async (selection: ProjectionSelection) => {
    if (!ref || busy) return;
    const generation = ++selectionGeneration.current;
    await execute(
      () => api.projectionSelect({ ...ref, selection }),
      (value) => {
        if (
          generation === selectionGeneration.current &&
          current.current.doc?.revision === ref.revision
        )
          setSelected(new Set(value.indices));
      },
    );
  };
  const pick = (index: number, add: boolean) => {
    if (busy) return;
    if (mode === 'measure') {
      setMeasure((old) => (old.length === 1 ? [old[0], index] : [index]));
      return;
    }
    selectionGeneration.current++;
    setSelected((old) => {
      const next = add ? new Set(old) : new Set<number>();
      if (add && next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };
  const first = [...selected][0],
    chosen = first === undefined ? undefined : doc?.palette[blocks[first]],
    position = first === undefined || !doc ? undefined : coordinates(first, doc.dimensions),
    hoverPosition = hover === undefined || !doc ? undefined : coordinates(hover, doc.dimensions);
  const materialRows = useMemo(() => {
    if (!doc) return [];
    const counts = new Map<number, number>();
    for (const id of selected) counts.set(blocks[id], (counts.get(blocks[id]) ?? 0) + 1);
    return doc.materials
      .filter(
        (m) =>
          !isAir(doc.palette[m.palette]) &&
          matchesSearch(filter, blockState(doc.palette[m.palette])),
      )
      .map((m) => ({ ...m, selected: counts.get(m.palette) ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }, [doc, selected, filter, blocks]);
  const setVisible = (only: boolean) => {
    if (!doc) return;
    setHidden((old) => {
      const next = only ? new Set<number>() : new Set(old);
      if (only) {
        for (let i = 0; i < blocks.length; i++)
          if (!selected.has(i) && !isAir(doc.palette[blocks[i]])) next.add(i);
      } else for (const i of selected) next.add(i);
      return next;
    });
  };
  const content = (
    <section
      className={'projection-page' + (fullscreen ? ' is-fullscreen' : '')}
      hidden={!active}
      aria-label="投影工坊"
      data-projection-drop
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) {
          const paths = api.droppedPaths(Array.from(event.dataTransfer.files));
          if (paths.length) importFile(paths[0]);
        }
      }}
    >
      <div className="projection-toolbar">
        {doc && (
          <div className="projection-summary">
            <strong>{doc.name}</strong>
            <small>
              {doc.dimensions.join(' × ')} · {doc.nonAir.toLocaleString()} 方块 · {doc.format}
              {assets && ` · 原版贴图 ${assets.version}`}
            </small>
          </div>
        )}
        <div className="projection-actions">
          <button
            hidden={!doc}
            title="撤销 Ctrl+Z"
            aria-label="撤销投影编辑"
            disabled={busy || !doc?.canUndo}
            onClick={() => undo()}
          >
            <Undo2 size={17} />
          </button>
          <button
            hidden={!doc}
            title="重做 Ctrl+Y"
            aria-label="重做投影编辑"
            disabled={busy || !doc?.canRedo}
            onClick={() => undo(true)}
          >
            <Redo2 size={17} />
          </button>
          <button hidden={!doc} disabled={busy} onClick={() => importFile()}>
            <FolderOpen size={16} />
            打开投影
          </button>
          <button disabled={busy} onClick={() => setModal('library')}>
            <Layers size={16} />
            作品库
          </button>
          {doc && (
            <details className="projection-menu">
              <summary>导出投影</summary>
              <div>
                {(['litematic', 'schem', 'nbt', 'materials', 'png'] as const).map((value, i) => (
                  <button
                    key={value}
                    disabled={busy || (value === 'png' && !assets)}
                    onClick={() => exportFile(value)}
                  >
                    {['Litematic', 'Sponge Schem', '结构 NBT', '材料清单 CSV', '视图 PNG'][i]}
                  </button>
                ))}
              </div>
            </details>
          )}
          <button
            aria-label={fullscreen ? '退出工坊全屏' : '全屏投影'}
            title={fullscreen ? '退出全屏 Esc' : '全屏'}
            onClick={() =>
              void api
                .windowFullscreen(!fullscreen)
                .then(setFullscreen)
                .catch((error) => setError(String(error)))
            }
          >
            {fullscreen ? <Shrink size={17} /> : <Expand size={17} />}
          </button>
        </div>
      </div>
      {error && (
        <div className="projection-error" role="alert">
          {error}
          <button onClick={() => setError('')}>关闭</button>
        </div>
      )}
      {decoded.error && <p role="alert">{decoded.error}</p>}
      {doc && assetLoading && <p role="status">正在准备原版贴图…</p>}
      {doc && assetError && (
        <div className="projection-error" role="alert">
          {assetError}
          <button onClick={() => setAssetRetry((value) => value + 1)}>重试贴图</button>
        </div>
      )}
      {!loaded ? (
        <p role="status">正在读取作品…</p>
      ) : !doc ? (
        <div className="projection-empty">
          <ItemArt name="plan" size={64} />
          <h2>打开你的投影</h2>
          <p>可拖入 Litematic、Schem 或结构 NBT 文件</p>
          <button className="primary" disabled={busy} onClick={() => importFile()}>
            打开投影
          </button>
          {error && (
            <>
              <button onClick={() => void load()}>重新读取作品库</button>
              <button
                disabled={busy}
                onClick={() =>
                  void execute(
                    () => api.projectionRecover(),
                    (value) => {
                      if (value) {
                        setEntries(value.entries);
                        if (value.current) apply(value.current);
                        setLoaded(true);
                      } else setError('没有可恢复的目录备份');
                    },
                  )
                }
              >
                恢复目录备份
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="projection-tools">
            <div className="segmented">
              {(
                [
                  ['orbit', '漫游'],
                  ['select', '单选'],
                  ['box', '框选'],
                  ['measure', '测量'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={mode === value}
                  className={mode === value ? 'active' : ''}
                  onClick={() => {
                    setMode(value);
                    setMeasure([]);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label>
              层间距
              <input
                aria-label="层间距"
                type="range"
                min="0"
                max="4"
                step="0.1"
                value={spacing}
                onChange={(event) => setSpacing(+event.target.value)}
              />
              <span>{spacing.toFixed(1)}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={grid}
                onChange={(event) => setGrid(event.target.checked)}
              />
              网格
            </label>
            <button onClick={() => actions.current?.fit()} title="适应投影">
              <Maximize2 size={15} />
              复位
            </button>
            <Select
              aria-label="投影视角"
              defaultValue="iso"
              onChange={(event) =>
                actions.current?.view(event.target.value as 'iso' | 'top' | 'front' | 'side')
              }
            >
              <option value="iso">透视</option>
              <option value="top">俯视</option>
              <option value="front">正视</option>
              <option value="side">侧视</option>
            </Select>
            <button onClick={() => setPanel(!panel)}>{panel ? '收起面板' : '显示面板'}</button>
          </div>
          <div className={'projection-layout' + (!panel ? ' without-panel' : '')}>
            <div className="projection-stage">
              <ProjectionViewport
                doc={doc}
                assets={assets}
                onStatus={setRenderStatus}
                blocks={blocks}
                selected={selected}
                hidden={hidden}
                layerMin={layerMin}
                layerMax={layerMax}
                spacing={spacing}
                mode={mode}
                grid={grid}
                measure={measure}
                active={active && !decoded.error}
                onPick={pick}
                onBox={(ids, add) => {
                  selectionGeneration.current++;
                  setSelected((old) => new Set(add ? [...old, ...ids] : ids));
                }}
                onHover={setHover}
                onReady={(value) => {
                  actions.current = value;
                }}
              />
              <div className="projection-layer-control">
                <strong>Y</strong>
                <label>
                  下层
                  <input
                    aria-label="起始层"
                    type="number"
                    min="0"
                    max={layerMax}
                    value={layerMin}
                    onChange={(e) => setLayerMin(Math.max(0, Math.min(layerMax, +e.target.value)))}
                  />
                </label>
                <label>
                  上层
                  <input
                    aria-label="结束层"
                    type="number"
                    min={layerMin}
                    max={doc.dimensions[1] - 1}
                    value={layerMax}
                    onChange={(e) =>
                      setLayerMax(
                        Math.max(layerMin, Math.min(doc.dimensions[1] - 1, +e.target.value)),
                      )
                    }
                  />
                </label>
                <input
                  aria-label="逐层查看"
                  type="range"
                  min="0"
                  max={doc.dimensions[1] - 1}
                  value={layerMax}
                  onChange={(e) => {
                    const value = +e.target.value;
                    setLayerMax(value);
                    setLayerMin(Math.min(layerMin, value));
                  }}
                />
                <button onClick={() => setLayerMin(layerMax)}>仅此层</button>
                <button
                  onClick={() => {
                    setLayerMin(0);
                    setLayerMax(doc.dimensions[1] - 1);
                  }}
                >
                  全部层
                </button>
              </div>
              <div className="projection-view-status">
                <span>
                  {hoverPosition
                    ? `${hoverPosition.join(', ')} · ${blockName(doc.palette[blocks[hover!]])}`
                    : `原点 ${doc.origin.join(', ')} · 已选 ${selected.size.toLocaleString()} 个`}
                </span>
                <span>
                  {busy ? '处理中…' : notice || renderStatus || `Y ${layerMin}–${layerMax}`}
                </span>
              </div>
              {mode === 'measure' && (
                <div className="projection-measure">
                  {measure.length === 2
                    ? `${coordinates(measure[0], doc.dimensions).join(', ')} → ${coordinates(measure[1], doc.dimensions).join(', ')} · ${distance(coordinates(measure[0], doc.dimensions), coordinates(measure[1], doc.dimensions)).toFixed(2)} 格`
                    : '依次点击两个方块'}
                </div>
              )}
            </div>
            {panel && (
              <aside className="projection-panel">
                <div className="segmented">
                  <button className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>
                    编辑
                  </button>
                  <button
                    className={tab === 'materials' ? 'active' : ''}
                    onClick={() => setTab('materials')}
                  >
                    材料
                  </button>
                </div>
                {tab === 'edit' ? (
                  <>
                    <h3>已选 {selected.size.toLocaleString()} 个</h3>
                    <div className="projection-selected-info">
                      <strong>{blockName(chosen)}</strong>
                      <small>{position?.join(', ')}</small>
                      {chosen && <code title={blockState(chosen)}>{blockState(chosen)}</code>}
                    </div>
                    <div className="projection-button-grid">
                      <button
                        disabled={busy || first === undefined}
                        onClick={() => void select({ mode: 'material', index: first })}
                      >
                        相同材料
                      </button>
                      <button
                        disabled={busy || first === undefined}
                        onClick={() => void select({ mode: 'layer', index: first })}
                      >
                        同一层
                      </button>
                      <button
                        disabled={busy || first === undefined}
                        onClick={() => void select({ mode: 'connected', index: first })}
                      >
                        连通方块
                      </button>
                      <button
                        onClick={() => {
                          selectionGeneration.current++;
                          setSelected(new Set());
                        }}
                      >
                        清除选择
                      </button>
                    </div>
                    <details>
                      <summary>坐标框选</summary>
                      {(
                        [
                          ['起点', from, setFrom],
                          ['终点', to, setTo],
                        ] as const
                      ).map(([label, point, setPoint]) => (
                        <div className="projection-coordinates" key={label}>
                          <span>{label}</span>
                          {point.map((value, i) => (
                            <input
                              key={i}
                              aria-label={`${label} ${'XYZ'[i]}`}
                              type="number"
                              min="0"
                              max={doc.dimensions[i] - 1}
                              value={value}
                              onChange={(e) =>
                                setPoint(
                                  (old) =>
                                    old.map((v, j) =>
                                      j === i
                                        ? Math.max(
                                            0,
                                            Math.min(
                                              doc.dimensions[i] - 1,
                                              Math.round(+e.target.value),
                                            ),
                                          )
                                        : v,
                                    ) as Point,
                                )
                              }
                            />
                          ))}
                        </div>
                      ))}
                      <button
                        disabled={busy}
                        onClick={() =>
                          void select({
                            mode: 'box',
                            min: from.map((v, i) => Math.min(v, to[i])) as Point,
                            max: from.map((v, i) => Math.max(v, to[i])) as Point,
                          })
                        }
                      >
                        选择范围
                      </button>
                    </details>
                    <h3>可见性</h3>
                    <div className="projection-button-grid">
                      <button disabled={!selected.size} onClick={() => setVisible(false)}>
                        隐藏所选
                      </button>
                      <button disabled={!selected.size} onClick={() => setVisible(true)}>
                        仅显示所选
                      </button>
                      <button onClick={() => setHidden(new Set())}>全部显示</button>
                      <button
                        disabled={!position}
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(position!.map((v, i) => v + doc.origin[i]).join(', '))
                            .then(() => setNotice('已复制坐标'))
                            .catch((error) => setError(String(error)))
                        }
                      >
                        复制坐标
                      </button>
                    </div>
                    <h3>方块编辑</h3>
                    <input
                      aria-label="替换方块"
                      value={replacement}
                      onChange={(e) => setReplacement(e.target.value)}
                      placeholder="minecraft:stone"
                    />
                    <div className="projection-button-grid">
                      <button
                        className="primary"
                        disabled={busy || !selected.size}
                        onClick={() => {
                          try {
                            edit({
                              kind: 'replace',
                              indices: [...selected],
                              block: parseBlock(replacement),
                            });
                          } catch (e) {
                            setError(String(e));
                          }
                        }}
                      >
                        替换所选
                      </button>
                      <button
                        disabled={busy || !selected.size}
                        onClick={() => edit({ kind: 'delete', indices: [...selected] })}
                      >
                        删除所选
                      </button>
                    </div>
                    <h3>整体变换</h3>
                    <div className="projection-button-grid">
                      <button
                        disabled={busy}
                        onClick={() => edit({ kind: 'rotate', direction: 'ccw' })}
                      >
                        逆时针旋转
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => edit({ kind: 'rotate', direction: 'cw' })}
                      >
                        顺时针旋转
                      </button>
                      <button disabled={busy} onClick={() => edit({ kind: 'mirror', axis: 'x' })}>
                        沿 X 轴镜像
                      </button>
                      <button disabled={busy} onClick={() => edit({ kind: 'mirror', axis: 'z' })}>
                        沿 Z 轴镜像
                      </button>
                    </div>
                    <h3>作品</h3>
                    <input
                      aria-label="投影名称"
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={() => {
                        if (name.trim() && name.trim() !== doc.name)
                          edit({ kind: 'rename', name: name.trim() });
                      }}
                    />
                    <button
                      disabled={busy || !state.instances.length}
                      onClick={() => setModal('install')}
                    >
                      <Save size={14} />
                      放入游戏实例
                    </button>
                  </>
                ) : (
                  <>
                    <h3>
                      {doc.nonAir.toLocaleString()} 方块 · {doc.materials.length} 类
                    </h3>
                    <input
                      aria-label="筛选材料"
                      placeholder="搜索材料"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                    <button disabled={busy} onClick={() => exportFile('materials')}>
                      <Download size={14} />
                      导出材料清单
                    </button>
                    <small>数量 · 组（64）</small>
                    <div className="projection-materials">
                      {materialRows.map((item) => (
                        <button
                          key={item.palette}
                          title={blockState(doc.palette[item.palette])}
                          onClick={() => {
                            const index = blocks.findIndex((value) => value === item.palette);
                            if (index >= 0) void select({ mode: 'material', index });
                          }}
                        >
                          <span>
                            {blockName(doc.palette[item.palette])}
                            <small>{blockState(doc.palette[item.palette])}</small>
                          </span>
                          <strong>
                            {item.count.toLocaleString()}
                            <small>
                              {Math.floor(item.count / 64)} 组 + {item.count % 64}
                            </small>
                            {item.selected > 0 && <small>已选 {item.selected}</small>}
                          </strong>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {doc.warnings.length > 0 && (
                  <details className="projection-format-notes">
                    <summary>格式说明 ({doc.warnings.length})</summary>
                    {doc.warnings.map((warning, i) => (
                      <p key={i}>{warning}</p>
                    ))}
                  </details>
                )}
              </aside>
            )}
          </div>
        </>
      )}
      {modal === 'library' && (
        <Modal title="投影作品库" onClose={() => setModal(null)}>
          <div className="form-body projection-library">
            {entries.length ? (
              entries.map((entry) => (
                <div className="projection-library-item" key={entry.id}>
                  <button
                    disabled={busy}
                    onClick={() => void execute(() => api.projectionOpen(entry.id), apply)}
                  >
                    <ItemArt name="plan" size={24} />
                    <span>
                      {entry.name}
                      <small>{new Date(entry.modifiedAt).toLocaleString()}</small>
                    </span>
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setRemoveId(entry.id);
                      setModal('remove');
                    }}
                  >
                    移除
                  </button>
                </div>
              ))
            ) : (
              <p>还没有投影作品。</p>
            )}
          </div>
        </Modal>
      )}
      {modal === 'remove' && (
        <Modal title="移除投影作品" onClose={() => setModal('library')}>
          <div className="form-body">
            <p>移除作品库副本及编辑历史，原文件保留。</p>
          </div>
          <div className="modal-footer">
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                void execute(
                  () => api.projectionRemove(removeId),
                  () => {
                    setEntries((old) => old.filter((item) => item.id !== removeId));
                    if (doc?.id === removeId) setDoc(null);
                    setModal('library');
                  },
                )
              }
            >
              移除作品
            </button>
          </div>
        </Modal>
      )}
      {modal === 'install' && doc && ref && (
        <Modal title="放入游戏实例" onClose={() => setModal(null)}>
          <div className="form-body">
            <Select
              aria-label="投影目标实例"
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
            >
              {state.instances.map((instance) => (
                <option value={instance.id} key={instance.id}>
                  {instance.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="投影安装格式"
              value={format}
              onChange={(e) => setFormat(e.target.value as typeof format)}
            >
              <option value="litematic">Litematic</option>
              <option value="schem">Sponge Schem</option>
              <option value="nbt">结构 NBT</option>
            </Select>
          </div>
          <div className="modal-footer">
            <button
              className="primary"
              disabled={busy || !instanceId}
              onClick={() =>
                void execute(
                  () => api.projectionInstall({ ...ref, instanceId, format }),
                  () => {
                    setModal(null);
                    setNotice('已放入实例 schematics 目录');
                  },
                )
              }
            >
              放入实例
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
  return fullscreen && active ? createPortal(content, document.body) : content;
}
