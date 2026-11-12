import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Download,
  FolderOpen,
  RefreshCw,
  Map,
  Settings2,
  Undo2,
  Search,
} from 'lucide-react';
import { api } from '../api';
import { Empty, InstanceSelect, Modal } from '../components';
import { size, type Run } from '../ui';
import type {
  Snapshot,
  SaveMetadata,
  SaveScan,
  SaveRegion,
  SaveRegionView,
  SaveChunk,
  SavePruneReview,
  SavePatch,
} from '../../shared/types';
const dims: Record<string, string> = { overworld: '主世界', the_nether: '下界', the_end: '末地' };
export function SavesPage({
  state,
  run,
  showInstanceSelect = true,
}: {
  state: Snapshot;
  run: Run;
  showInstanceSelect?: boolean;
}) {
  const id = state.selectedInstanceId ?? '',
    [worlds, setWorlds] = useState<SaveMetadata[]>([]),
    [world, setWorld] = useState(''),
    [search, setSearch] = useState('');
  const [scan, setScan] = useState<SaveScan>(),
    [dimension, setDimension] = useState('overworld'),
    [region, setRegion] = useState<SaveRegion>(),
    [tile, setTile] = useState<SaveRegionView>(),
    [busy, setBusy] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set()),
    [chunk, setChunk] = useState<SaveChunk>(),
    [review, setReview] = useState<SavePruneReview>(),
    [editing, setEditing] = useState(false);
  const [maxMinutes, setMaxMinutes] = useState(''),
    [before, setBefore] = useState(''),
    [protection, setProtection] = useState(8),
    [rx, setRx] = useState('0'),
    [rz, setRz] = useState('0'),
    [grid, setGrid] = useState(true),
    [heat, setHeat] = useState(false);
  const generation = useRef(0),
    tileGeneration = useRef(0);
  const stopped = !state.running.includes(id),
    hasTask = state.tasks.some((t) => t.status === 'running');
  const refreshList = useCallback(async () => {
    const current = ++generation.current;
    setBusy('读取存档');
    await run(async () => {
      const data = await api.saveWorlds(id);
      if (current === generation.current) setWorlds(data);
    });
    if (current === generation.current) setBusy('');
  }, [id, run]);
  useEffect(() => {
    setWorld('');
    setWorlds([]);
    setScan(undefined);
    setTile(undefined);
    setRegion(undefined);
    setReview(undefined);
    setSelected(new Set());
    if (id) void refreshList();
    return () => {
      generation.current++;
      tileGeneration.current++;
    };
  }, [id, refreshList]);
  const load = async (name: string) => {
    const current = ++generation.current;
    tileGeneration.current++;
    setBusy('扫描区域索引');
    setWorld(name);
    setScan(undefined);
    setTile(undefined);
    setRegion(undefined);
    setSelected(new Set());
    setChunk(undefined);
    setReview(undefined);
    await run(async () => {
      const data = await api.scanWorld({ id, world: name });
      if (current === generation.current) {
        setScan(data);
        setDimension(data.dimensions[0]?.id ?? 'overworld');
      }
    });
    if (current === generation.current) setBusy('');
  };
  const openRegion = async (r: SaveRegion) => {
    const current = ++tileGeneration.current;
    setRegion(r);
    setRx(String(r.x));
    setRz(String(r.z));
    setTile(undefined);
    setSelected(new Set());
    setChunk(undefined);
    setReview(undefined);
    setBusy('生成区域地图');
    await run(async () => {
      const data = await api.worldRegion({ id, world, dimension, rx: r.x, rz: r.z });
      if (current === tileGeneration.current) setTile(data);
    });
    if (current === tileGeneration.current) setBusy('');
  };
  const regions = scan?.dimensions.find((d) => d.id === dimension)?.regions ?? [];
  const totalChunks = regions.reduce((n, r) => n + r.chunks, 0),
    bytes = regions.reduce((n, r) => n + r.bytes, 0);
  const filter = (c: SaveChunk) =>
    !c.error &&
    (!maxMinutes || (c.inhabitedTicks != null && c.inhabitedTicks <= Number(maxMinutes) * 1200)) &&
    (!before || (c.timestamp > 0 && c.timestamp < Date.parse(before) / 1000));
  const selectionCount = selected.size;
  const taskSignature = state.tasks
    .filter((t) => t.status !== 'running')
    .map((t) => t.id)
    .join(',');
  const lastTasks = useRef(taskSignature);
  useEffect(() => {
    if (lastTasks.current !== taskSignature) {
      lastTasks.current = taskSignature;
      if (world && !busy) void load(world);
    }
  }, [taskSignature]);
  if (!id)
    return <Empty title="先选择一个游戏实例" description="按实例查看存档、预览地形与备份编辑" />;
  return (
    <div className="save-manager">
      <div className="toolbar">
        {showInstanceSelect && <InstanceSelect state={state} run={run} />}
        <button disabled={!!busy} onClick={() => void refreshList()}>
          <RefreshCw size={16} />
          刷新存档
        </button>
        <span className="engine-badge">{worlds.length} 个存档</span>
      </div>
      <div className="save-workspace">
        <aside className="save-library panel">
          <label className="save-search">
            <Search size={15} />
            <input
              aria-label="搜索存档"
              placeholder="搜索世界"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {worlds
            .filter((w) => (w.name ?? w.folder).toLowerCase().includes(search.toLowerCase()))
            .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
            .map((w) => (
              <button
                key={w.folder}
                disabled={!!busy}
                className={'save-world ' + (world === w.folder ? 'active' : '')}
                onClick={() => void load(w.folder)}
              >
                <Archive size={19} />
                <span>
                  <strong>{w.name || w.folder}</strong>
                  <small>{w.version ?? (w.error ? '无法读取属性' : '未知版本')}</small>
                  <small>{w.folder}</small>
                </span>
              </button>
            ))}
          {!worlds.length && <p className="muted">{busy || '当前实例没有存档'}</p>}
        </aside>
        <div className="save-detail">
          {!scan ? (
            <Empty
              title={busy || '选择一个存档'}
              description="快速索引 · 多维度地图 · 可恢复编辑"
            />
          ) : (
            <>
              <section className="panel save-summary">
                <div>
                  <h2>{scan.metadata.name || world}</h2>
                  <p>
                    {scan.metadata.version ?? '未知版本'} · 数据版本{' '}
                    {scan.metadata.dataVersion ?? '未知'} · 种子 {scan.metadata.seed ?? '未知'}
                  </p>
                  <small>
                    区域索引 {scan.elapsedMs.toFixed(1)} ms · {regions.length} 个区域 ·{' '}
                    {totalChunks.toLocaleString()} 个区块 · 区域文件 {size(bytes)}
                  </small>
                </div>
                <div className="save-actions">
                  <button disabled={!stopped || !!busy || hasTask} onClick={() => setEditing(true)}>
                    <Settings2 size={15} />
                    属性
                  </button>
                  <button
                    disabled={!stopped || hasTask}
                    onClick={() => void run(() => api.backupWorld({ id, world }), '已开始完整备份')}
                  >
                    <Archive size={15} />
                    备份
                  </button>
                  <button
                    disabled={!stopped || hasTask}
                    onClick={() => void run(() => api.exportWorld({ id, world }))}
                  >
                    <Download size={15} />
                    导出 ZIP
                  </button>
                  <button onClick={() => void run(() => api.revealWorld({ id, world }))}>
                    <FolderOpen size={15} />
                    目录
                  </button>
                </div>
              </section>
              {!stopped && (
                <p className="save-warning">游戏运行中，可浏览地图；停止游戏后可编辑。</p>
              )}
              <div className="toolbar">
                <select
                  aria-label="存档维度"
                  value={dimension}
                  disabled={!!busy}
                  onChange={(e) => {
                    setDimension(e.target.value);
                    setRegion(undefined);
                    setTile(undefined);
                    setSelected(new Set());
                    setReview(undefined);
                    setChunk(undefined);
                  }}
                >
                  {scan.dimensions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {dims[d.id] ?? d.id}
                    </option>
                  ))}
                </select>
                <label>
                  区域 X
                  <input
                    aria-label="区域 X"
                    type="number"
                    value={rx}
                    onChange={(e) => setRx(e.target.value)}
                  />
                </label>
                <label>
                  Z
                  <input
                    aria-label="区域 Z"
                    type="number"
                    value={rz}
                    onChange={(e) => setRz(e.target.value)}
                  />
                </label>
                <button
                  disabled={
                    !!busy || !regions.some((r) => r.x === Number(rx) && r.z === Number(rz))
                  }
                  onClick={() =>
                    void openRegion(regions.find((r) => r.x === Number(rx) && r.z === Number(rz))!)
                  }
                >
                  跳转
                </button>
                <button
                  disabled={!!busy || dimension !== 'overworld' || scan.metadata.spawn?.x == null}
                  onClick={() => {
                    const x = Math.floor((scan.metadata.spawn?.x ?? 0) / 512),
                      z = Math.floor((scan.metadata.spawn?.z ?? 0) / 512);
                    setRx(String(x));
                    setRz(String(z));
                    const r = regions.find((r) => r.x === x && r.z === z);
                    if (r) void openRegion(r);
                  }}
                >
                  出生点
                </button>
              </div>
              <RegionOverview
                regions={regions}
                selected={region}
                onSelect={(r) => {
                  if (!busy) void openRegion(r);
                }}
              />
              <div className="save-map-heading">
                <h3>{region ? `区域 ${region.x}, ${region.z}` : '点击总览中的区域以加载地图'}</h3>
                <small>
                  {busy ||
                    (tile
                      ? `${tile.cached ? '缓存命中' : '地表解码'} · ${tile.elapsedMs.toFixed(1)} ms`
                      : '仅按需解码当前区域')}
                </small>
              </div>
              {tile && (
                <>
                  <div className="save-map-tools">
                    <label>
                      <input
                        type="checkbox"
                        checked={grid}
                        onChange={(e) => setGrid(e.target.checked)}
                      />
                      区块网格
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={heat}
                        onChange={(e) => setHeat(e.target.checked)}
                      />
                      停留时间热图
                    </label>
                    <span>拖动框选 · Ctrl 追加 · 点击查看区块</span>
                  </div>
                  <ChunkMap
                    tile={tile}
                    selected={selected}
                    setSelected={setSelected}
                    onChunk={setChunk}
                    grid={grid}
                    heat={heat}
                  />
                  <div className="save-filter panel">
                    <h3>区块筛选与清理</h3>
                    <div className="save-filter-fields">
                      <label>
                        停留时间不超过（分钟）
                        <input
                          aria-label="最大停留分钟"
                          type="number"
                          min="0"
                          placeholder="不限"
                          value={maxMinutes}
                          onChange={(e) => setMaxMinutes(e.target.value)}
                        />
                      </label>
                      <label>
                        最后修改早于
                        <input
                          aria-label="区块截止日期"
                          type="date"
                          value={before}
                          onChange={(e) => setBefore(e.target.value)}
                        />
                      </label>
                      <label>
                        出生点保护（区块半径）
                        <input
                          aria-label="出生点保护半径"
                          type="number"
                          min="0"
                          max="128"
                          value={protection}
                          onChange={(e) => setProtection(Number(e.target.value))}
                        />
                      </label>
                    </div>
                    <div className="save-actions">
                      <button
                        onClick={() =>
                          setSelected(new Set(tile.chunks.filter(filter).map((c) => c.index)))
                        }
                      >
                        选择符合条件的区块
                      </button>
                      <button
                        onClick={() =>
                          setSelected(
                            new Set(
                              tile.chunks.filter((c) => !selected.has(c.index)).map((c) => c.index),
                            ),
                          )
                        }
                      >
                        反选
                      </button>
                      <button onClick={() => setSelected(new Set())}>清空选择</button>
                      <span>已选 {selectionCount} 个</span>
                      <button
                        className="primary"
                        disabled={!stopped || hasTask || !!busy || !selectionCount}
                        onClick={async () => {
                          setBusy('验证选区与保护条件');
                          const result = await run(() =>
                            api.planWorldPrune({
                              id,
                              world,
                              dimension,
                              rx: tile.rx,
                              rz: tile.rz,
                              indices: [...selected],
                              protectSpawn: protection,
                              ...(maxMinutes
                                ? { maxInhabitedTicks: Math.floor(Number(maxMinutes) * 1200) }
                                : {}),
                              ...(before
                                ? { beforeTimestamp: Math.floor(Date.parse(before) / 1000) }
                                : {}),
                            }),
                          );
                          if (result) setReview(result);
                          setBusy('');
                        }}
                      >
                        预览清理
                      </button>
                    </div>
                    <p className="muted">
                      只清理当前区域中的所选区块。末地折跃门始终保护，无法验证的区块会跳过。
                    </p>
                  </div>
                  {chunk && (
                    <section className="panel save-inspector">
                      <h3>
                        区块 {chunk.x}, {chunk.z}
                      </h3>
                      <p>
                        方块范围 {chunk.x * 16}～{chunk.x * 16 + 15} / {chunk.z * 16}～
                        {chunk.z * 16 + 15}
                      </p>
                      <dl>
                        <dt>状态</dt>
                        <dd>{chunk.status ?? '未知'}</dd>
                        <dt>停留时间</dt>
                        <dd>
                          {chunk.inhabitedTicks == null
                            ? '未知'
                            : (chunk.inhabitedTicks / 1200).toFixed(2) + ' 分钟'}
                        </dd>
                        <dt>最后修改</dt>
                        <dd>
                          {chunk.timestamp
                            ? new Date(chunk.timestamp * 1000).toLocaleString('zh-CN')
                            : '未知'}
                        </dd>
                        <dt>占用空间</dt>
                        <dd>{size(chunk.bytes)}</dd>
                        <dt>数据版本</dt>
                        <dd>{chunk.dataVersion ?? '未知'}</dd>
                      </dl>
                      {chunk.error && <p role="alert">{chunk.error}</p>}
                      <details>
                        <summary>方块实体（最多 128 项）</summary>
                        <p>{chunk.blockEntities?.join('、') || '无'}</p>
                      </details>
                      <details>
                        <summary>地表分节方块类型（最多 256 项）</summary>
                        <p>{chunk.palette?.join('、') || '未知'}</p>
                      </details>
                    </section>
                  )}
                </>
              )}
              <section className="panel save-history">
                <h3>编辑历史</h3>
                <p className="muted">
                  原文件校验恢复；游戏再次保存后会拒绝覆盖。完整世界恢复请使用“存档备份”。
                </p>
                {scan.history.length ? (
                  scan.history.map((h) => (
                    <div key={h.id}>
                      <span>
                        <strong>{h.title}</strong>
                        <small>
                          {new Date(h.createdAt).toLocaleString('zh-CN')} · {h.files} 个文件 ·{' '}
                          {h.state === 'prepared'
                            ? '中断待恢复'
                            : h.state === 'undone'
                              ? '已恢复'
                              : '已完成'}
                        </small>
                      </span>
                      <button
                        disabled={!stopped || !!busy || hasTask || h.state === 'undone'}
                        onClick={async () => {
                          setBusy('恢复原文件');
                          const ok = await run(async () => {
                            await api.undoWorldEdit({ id, world, transaction: h.id });
                            return true;
                          });
                          setBusy('');
                          if (ok) void load(world);
                        }}
                      >
                        <Undo2 size={15} />
                        {h.state === 'prepared' ? '恢复中断操作' : '撤销'}
                      </button>
                    </div>
                  ))
                ) : (
                  <p>暂无编辑记录</p>
                )}
              </section>
              <details className="panel save-rules">
                <summary>查看游戏规则（只读）</summary>
                <dl>
                  {Object.entries(scan.metadata.rules ?? {}).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </>
          )}
        </div>
      </div>
      {scan && editing && (
        <WorldProperties
          meta={scan.metadata}
          run={run}
          id={id}
          world={world}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load(world);
          }}
        />
      )}
      {review && (
        <Modal title="确认区块清理范围" wide onClose={() => setReview(undefined)}>
          <div className="save-review">
            <p>
              将清理 <strong>{review.count}</strong> 个区块，更新 {review.files}{' '}
              个区域文件，预计压缩回收 {size(review.reclaimedBytes)}。
            </p>
            <p>
              先保存原文件和校验记录，再清理地形、实体与 POI。外部 .mcc
              数据保留。进入游戏后，被清理的区域会重新生成。
            </p>
            <h3>保护或跳过 {review.skipped.length} 个区块</h3>
            <div className="save-skipped">
              {review.skipped.map((c) => (
                <p key={c.x + ',' + c.z}>
                  {c.x}, {c.z} · {c.reason}
                </p>
              ))}
            </div>
          </div>
          <div className="modal-footer">
            <button onClick={() => setReview(undefined)}>取消</button>
            <button
              className="primary"
              disabled={!review.count || !!busy}
              onClick={async () => {
                const task = await run(() => api.applyWorldPrune(review.token));
                if (task) setReview(undefined);
              }}
            >
              备份并清理
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function RegionOverview({
  regions,
  selected,
  onSelect,
}: {
  regions: SaveRegion[];
  selected?: SaveRegion;
  onSelect: (r: SaveRegion) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bounds = useMemo(() => {
    let minX = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxZ = -Infinity;
    for (const r of regions) {
      minX = Math.min(minX, r.x);
      maxX = Math.max(maxX, r.x);
      minZ = Math.min(minZ, r.z);
      maxZ = Math.max(maxZ, r.z);
    }
    return { minX, minZ, width: maxX - minX + 1, height: maxZ - minZ + 1 };
  }, [regions]);
  const cell = Math.min(24, 680 / Math.max(bounds.width, 1), 180 / Math.max(bounds.height, 1));
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 700, 200);
    for (const r of regions) {
      ctx.fillStyle = r.error
        ? '#b54b3d'
        : selected?.x === r.x && selected?.z === r.z
          ? '#f26b21'
          : `rgba(135,155,113,${0.25 + (0.75 * r.chunks) / 1024})`;
      ctx.fillRect(
        10 + (r.x - bounds.minX) * cell,
        10 + (r.z - bounds.minZ) * cell,
        Math.max(1, cell - 1),
        Math.max(1, cell - 1),
      );
    }
  }, [regions, selected, bounds, cell]);
  return (
    <div className="save-overview">
      <span>
        <Map size={14} />
        区域总览 · 橙色为当前区域 · 红色为异常
      </span>
      {regions.length ? (
        <canvas
          ref={canvas}
          width={700}
          height={200}
          aria-label="存档区域总览"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect(),
              x =
                Math.floor((((e.clientX - box.left) * 700) / box.width - 10) / cell) + bounds.minX,
              z =
                Math.floor((((e.clientY - box.top) * 200) / box.height - 10) / cell) + bounds.minZ;
            const r = regions.find((r) => r.x === x && r.z === z);
            if (r) onSelect(r);
          }}
        />
      ) : (
        <p className="muted">此维度还没有生成区域</p>
      )}
    </div>
  );
}
function ChunkMap({
  tile,
  selected,
  setSelected,
  onChunk,
  grid,
  heat,
}: {
  tile: SaveRegionView;
  selected: Set<number>;
  setSelected: (s: Set<number>) => void;
  onChunk: (c: SaveChunk) => void;
  grid: boolean;
  heat: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    drag = useRef<{ x: number; z: number; add: boolean } | undefined>(undefined),
    [zoom, setZoom] = useState(1),
    [hover, setHover] = useState('');
  const image = useMemo(() => {
    const img = new Image();
    img.src = tile.image;
    return img;
  }, [tile.image]);
  const render = useCallback(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 512, 512);
    ctx.imageSmoothingEnabled = false;
    if (image.complete) ctx.drawImage(image, 0, 0);
    for (const c of tile.chunks) {
      const x = (c.index % 32) * 16,
        z = Math.floor(c.index / 32) * 16;
      if (c.error) {
        ctx.fillStyle = '#a53e3e';
        ctx.fillRect(x, z, 16, 16);
      } else if (heat) {
        ctx.fillStyle = `hsla(${120 - Math.min(120, Math.log2(1 + (c.inhabitedTicks ?? 0) / 1200) * 18)} 65% 48% / .7)`;
        ctx.fillRect(x, z, 16, 16);
      }
      if (selected.has(c.index)) {
        ctx.fillStyle = '#f26b2170';
        ctx.fillRect(x, z, 16, 16);
        ctx.strokeStyle = '#ff9d47';
        ctx.strokeRect(x + 0.5, z + 0.5, 15, 15);
      }
    }
    if (grid) {
      ctx.strokeStyle = '#0005';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 512; i += 16) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 512);
        ctx.moveTo(0, i);
        ctx.lineTo(512, i);
        ctx.stroke();
      }
    }
  }, [tile, image, selected, grid, heat]);
  useEffect(() => {
    image.onload = render;
    render();
    return () => {
      image.onload = null;
    };
  }, [image, render]);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(31, Math.floor(((e.clientX - b.left) * 32) / b.width))),
      z: Math.max(0, Math.min(31, Math.floor(((e.clientY - b.top) * 32) / b.height))),
    };
  };
  return (
    <>
      <div className="save-map-viewport">
        <canvas
          ref={canvas}
          width={512}
          height={512}
          style={{ width: 512 * zoom, height: 512 * zoom }}
          aria-label="区块地表地图"
          onPointerDown={(e) => {
            const p = point(e);
            drag.current = { ...p, add: e.ctrlKey || e.metaKey };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const p = point(e);
            setHover(
              `方块 ${(tile.rx * 32 + p.x) * 16}, ${(tile.rz * 32 + p.z) * 16} · 区块 ${tile.rx * 32 + p.x}, ${tile.rz * 32 + p.z}`,
            );
          }}
          onPointerUp={(e) => {
            const start = drag.current;
            drag.current = undefined;
            if (!start) return;
            const end = point(e),
              next = new Set(start.add ? selected : []);
            for (const c of tile.chunks) {
              const x = c.index % 32,
                z = Math.floor(c.index / 32);
              if (
                x >= Math.min(start.x, end.x) &&
                x <= Math.max(start.x, end.x) &&
                z >= Math.min(start.z, end.z) &&
                z <= Math.max(start.z, end.z)
              )
                next.add(c.index);
            }
            setSelected(next);
            const c = tile.chunks.find((c) => c.index === end.z * 32 + end.x);
            if (c) onChunk(c);
          }}
        />
      </div>
      <div className="save-map-footer">
        <span>{hover || '地表示意色，不是游戏材质；下界显示最高可见方块'}</span>
        <label>
          缩放
          <input
            aria-label="地图缩放"
            type="range"
            min="0.5"
            max="3"
            step="0.25"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
      </div>
    </>
  );
}
function WorldProperties({
  meta,
  run,
  id,
  world,
  onClose,
  onSaved,
}: {
  meta: SaveMetadata;
  run: Run;
  id: string;
  world: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<SavePatch>({
      name: meta.name ?? world,
      gameType: meta.gameType ?? 0,
      difficulty: meta.difficulty ?? 2,
      commands: meta.commands ?? false,
      hardcore: meta.hardcore ?? false,
      spawnX: meta.spawn?.x ?? 0,
      spawnY: meta.spawn?.y ?? 64,
      spawnZ: meta.spawn?.z ?? 0,
    }),
    [busy, setBusy] = useState(false);
  const update = (key: keyof SavePatch, value: unknown) => setForm((v) => ({ ...v, [key]: value }));
  return (
    <Modal
      title="存档属性"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="save-properties">
        <label>
          世界名称
          <input
            value={form.name}
            maxLength={80}
            onChange={(e) => update('name', e.target.value)}
          />
        </label>
        <label>
          游戏模式
          <select
            value={form.gameType}
            onChange={(e) => update('gameType', Number(e.target.value))}
          >
            {['生存', '创造', '冒险', '旁观'].map((n, i) => (
              <option key={i} value={i}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          难度
          <select
            value={form.difficulty}
            onChange={(e) => update('difficulty', Number(e.target.value))}
          >
            {['和平', '简单', '普通', '困难'].map((n, i) => (
              <option key={i} value={i}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.commands}
            onChange={(e) => update('commands', e.target.checked)}
          />
          允许作弊
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.hardcore}
            onChange={(e) => update('hardcore', e.target.checked)}
          />
          硬核模式
        </label>
        <div className="save-filter-fields">
          {(['spawnX', 'spawnY', 'spawnZ'] as const).map((key) => (
            <label key={key}>
              {key.replace('spawn', '出生点 ')}
              <input
                type="number"
                value={form[key]}
                onChange={(e) => update(key, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
        <p className="muted">保存前自动备份 level.dat；种子和玩家数据保持原样。</p>
      </div>
      <div className="modal-footer">
        <button disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const initial = {
              name: meta.name ?? world,
              gameType: meta.gameType ?? 0,
              difficulty: meta.difficulty ?? 2,
              commands: meta.commands ?? false,
              hardcore: meta.hardcore ?? false,
              spawnX: meta.spawn?.x ?? 0,
              spawnY: meta.spawn?.y ?? 64,
              spawnZ: meta.spawn?.z ?? 0,
            };
            const patch = Object.fromEntries(
              Object.entries(form).filter(([k, v]) => initial[k as keyof typeof initial] !== v),
            );
            const ok = await run(async () => {
              await api.editWorld({ id, world, patch });
              return true;
            });
            setBusy(false);
            if (ok) onSaved();
          }}
        >
          备份并保存
        </button>
      </div>
    </Modal>
  );
}
