import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  Brush,
  Crosshair,
  Eraser,
  Grid2X2,
  Hand,
  Home,
  LocateFixed,
  Maximize,
  Minus,
  Plus,
  SquarePlus,
  SquareMinus,
  Thermometer,
} from 'lucide-react';
import type {
  SaveChunk,
  SaveMetadata,
  SavePruneReview,
  SaveRegion,
  WorldRef,
} from '../../shared/types';
import { useTerrainThumbnails } from './useTerrainThumbnails';
import { PAN_MARGIN, paintTerrain, paintViewport, type TerrainLayer } from './drawTerrain';
import { worldDimensionName } from '../../shared/world-dimensions';
import { api } from '../api';
import { Modal } from '../components';
import { size, type Run } from '../ui';
import {
  cellKey,
  chunkAt,
  groupsFrom,
  inBox,
  regionsNear,
  regionBounds,
  startCamera,
  type Camera,
  type MapTool,
  type Point,
  type SelectionBox,
  type Tile,
} from './terrain';

type Props = WorldRef & {
  dimension: string;
  regions: SaveRegion[];
  spawn: SaveMetadata['spawn'];
  locked: boolean;
  run: Run;
  onEdited: () => void;
};
const toolList = [
  ['pan', '平移', Hand],
  ['rectangle-add', '框选添加', SquarePlus],
  ['rectangle-remove', '框选移除', SquareMinus],
  ['brush', '画笔', Brush],
  ['erase', '擦除', Eraser],
  ['spawn', '设置出生点', Home],
] as const;
const bound = (n: number) => Math.max(-30000000, Math.min(30000000, n));
function screenPoint(e: PointerEvent<HTMLCanvasElement>): Point {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: e.clientX - r.left - r.width / 2, z: e.clientY - r.top - r.height / 2 };
}
function blockAt(screen: Point, camera: Camera): Point {
  return {
    x: Math.floor(camera.x + screen.x / camera.zoom),
    z: Math.floor(camera.z + screen.z / camera.zoom),
  };
}
function panCamera(camera: Camera, start: Point, end: Point): Camera {
  return {
    zoom: camera.zoom,
    x: bound(camera.x - (end.x - start.x) / camera.zoom),
    z: bound(camera.z - (end.z - start.z) / camera.zoom),
  };
}
export function WorldMap({ id, world, dimension, regions, spawn, locked, run, onEdited }: Props) {
  const dimId = dimension.startsWith('dimensions/')
    ? dimension.slice(11).replace('/', ':')
    : 'minecraft:' + dimension;
  const spawnHere = dimId === (spawn?.dimension ?? 'minecraft:overworld');
  const spawnPos = useMemo(
    () => (spawnHere && spawn?.x != null && spawn.z != null ? { x: spawn.x, z: spawn.z } : null),
    [spawnHere, spawn?.x, spawn?.z],
  );
  const initial = useMemo(() => startCamera(regions, spawnPos), [regions, spawnPos]);
  const [camera, setCamera] = useState<Camera>(initial),
    [view, setView] = useState({ w: 640, h: 400 });
  const [tool, setTool] = useState<MapTool>('pan'),
    [grid, setGrid] = useState(false),
    [heat, setHeat] = useState(false);
  const [selection, setSelection] = useState(new Set<string>()),
    [box, setBox] = useState<SelectionBox>(),
    [cursor, setCursor] = useState<Point>();
  const [inspect, setInspect] = useState<SaveChunk>(),
    [pin, setPin] = useState<Point>(),
    [spawnY, setSpawnY] = useState(String(spawn?.y ?? 64));
  const [jumpX, setJumpX] = useState(String(Math.round(initial.x))),
    [jumpZ, setJumpZ] = useState(String(Math.round(initial.z)));
  const [minutes, setMinutes] = useState(''),
    [date, setDate] = useState(''),
    [radius, setRadius] = useState('8');
  const [review, setReview] = useState<SavePruneReview>(),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null),
    tiles = useRef(new Map<string, Tile>()),
    errors = useRef(new Map<string, string>()),
    loading = useRef(false);
  const [revision, redraw] = useState(0),
    mounted = useRef(true);
  const currentSelection = useRef(selection);
  const groups = useMemo(() => groupsFrom(selection), [selection]);
  const buffer = useRef<HTMLCanvasElement | null>(null);
  const previousLayer = useRef<TerrainLayer | null>(null);
  const pointerFrame = useRef<number | null>(null);
  const pendingPointer = useRef<{ cursor: Point; camera?: Camera; box?: SelectionBox } | null>(
    null,
  );
  function replaceSelection(next: Set<string>) {
    currentSelection.current = next;
    setSelection(next);
  }
  const drag = useRef<
    | {
        id: number;
        screen: Point;
        start: Point;
        last: Point;
        camera: Camera;
        tool: MapTool;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const index = useMemo(
    () =>
      new Map(regions.filter((r) => r.chunks > 0 && !r.error).map((r) => [cellKey(r.x, r.z), r])),
    [regions],
  );
  const anchorX = (Math.round((camera.x * camera.zoom) / PAN_MARGIN) * PAN_MARGIN) / camera.zoom;
  const anchorZ = (Math.round((camera.z * camera.zoom) / PAN_MARGIN) * PAN_MARGIN) / camera.zoom;
  const anchor = useMemo(
    () => ({ x: anchorX, z: anchorZ, zoom: camera.zoom }),
    [anchorX, anchorZ, camera.zoom],
  );
  const nearby = useMemo(() => regionsNear(index, anchor, view, PAN_MARGIN), [index, anchor, view]);
  const { left, right, top, bottom } = regionBounds(camera, view);
  const visible = useMemo(
    () => nearby.filter((r) => r.x >= left && r.x <= right && r.z >= top && r.z <= bottom),
    [nearby, left, right, top, bottom],
  );
  const entireWorld = useMemo(() => {
    if (!index.size) return initial;
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity;
    for (const r of index.values()) {
      left = Math.min(left, r.x * 512);
      right = Math.max(right, (r.x + 1) * 512);
      top = Math.min(top, r.z * 512);
      bottom = Math.max(bottom, (r.z + 1) * 512);
    }
    return {
      x: (left + right) / 2,
      z: (top + bottom) / 2,
      zoom: Math.min(2, (view.w * 0.94) / (right - left), (view.h * 0.94) / (bottom - top)),
    };
  }, [index, view, initial]);
  const side =
    camera.zoom >= Math.max(0.27, view.w / 3072, view.h / 3072)
      ? 0
      : camera.zoom * 512 >= 40
        ? 32
        : camera.zoom * 512 >= 8
          ? 8
          : 1;
  const thumbnails = useTerrainThumbnails({ id, world }, dimension, side, nearby);
  const { needed, loaded, failure } = useMemo(() => {
    let needed: SaveRegion | undefined,
      loaded = 0,
      failure: string | undefined;
    for (const r of visible) {
      const key = cellKey(r.x, r.z);
      const preview = side ? thumbnails.get(r) : undefined;
      const error = side ? preview?.error : errors.current.get(key);
      if (side ? preview : tiles.current.has(key)) loaded++;
      else if (!error) needed ??= r;
      failure ??= error;
    }
    return { needed, loaded, failure };
  }, [visible, side, revision, thumbnails.get, thumbnails.revision]);
  const detailRegions = useMemo(() => {
    if (side) return [];
    if (nearby.length <= 64) return nearby;
    const keep = new Set(visible);
    for (const region of nearby) {
      if (keep.size >= 64) break;
      keep.add(region);
    }
    return [...keep];
  }, [side, nearby, visible]);
  const nextDetail = useMemo(
    () =>
      side
        ? undefined
        : (needed ??
          detailRegions.find((r) => {
            const key = cellKey(r.x, r.z);
            return !tiles.current.has(key) && !errors.current.has(key);
          })),
    [side, needed, detailRegions, revision],
  );
  const keepTiles = useRef(new Set<string>());
  useLayoutEffect(() => {
    keepTiles.current = new Set(detailRegions.map((r) => cellKey(r.x, r.z)));
  }, [detailRegions]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      discardPointerFrame();
    };
  }, []);
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width && rect.height)
        setView({ w: Math.round(rect.width), h: Math.round(rect.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (loading.current || !nextDetail) return;
    const { x: rx, z: rz } = nextDetail,
      key = cellKey(rx, rz);
    loading.current = true;
    void (async () => {
      try {
        const data = await api.worldRegion({ id, world, dimension, rx, rz });
        if (!mounted.current) return;
        const image = new Image();
        image.src = data.image;
        await image.decode();
        if (!mounted.current) return;
        tiles.current.set(key, { image, chunks: data.chunks });
        if (tiles.current.size > 64) {
          for (const k of tiles.current.keys())
            if (!keepTiles.current.has(k)) {
              tiles.current.delete(k);
              if (tiles.current.size <= 56) break;
            }
        }
      } catch (e) {
        if (mounted.current) errors.current.set(key, e instanceof Error ? e.message : String(e));
      } finally {
        loading.current = false;
        if (mounted.current) redraw((v) => v + 1);
      }
    })();
  }, [nextDetail, id, world, dimension, revision]);
  function zoom(camera: Camera, factor: number, anchor = { x: 0, z: 0 }): Camera {
    const scale = Math.max(
      Math.max(0.000002, Math.min(0.05, entireWorld.zoom / 2)),
      Math.min(8, camera.zoom * factor),
    );
    return {
      zoom: scale,
      x: bound(camera.x + anchor.x * (1 / camera.zoom - 1 / scale)),
      z: bound(camera.z + anchor.z * (1 / camera.zoom - 1 / scale)),
    };
  }
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = {
        x: e.clientX - rect.left - rect.width / 2,
        z: e.clientY - rect.top - rect.height / 2,
      };
      const pendingCamera = pendingPointer.current?.camera;
      cancelGesture();
      setCamera((c) => zoom(pendingCamera ?? c, Math.exp(-Math.sign(e.deltaY) * 0.23), anchor));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [view, entireWorld]);
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const layer = useMemo<TerrainLayer>(
    () => ({
      anchor,
      view,
      ratio,
      regions: nearby,
      tiles: tiles.current,
      thumbnail: thumbnails.preview,
      detailed: !side,
      heat,
      grid,
      groups,
      spawn: spawnPos,
    }),
    [
      anchor,
      view,
      ratio,
      nearby,
      thumbnails.preview,
      side,
      heat,
      grid,
      groups,
      spawnPos,
      revision,
      thumbnails.revision,
    ],
  );
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const surface = (buffer.current ??= document.createElement('canvas'));
    if (layer !== previousLayer.current) {
      paintTerrain(surface, layer);
      previousLayer.current = layer;
    }
    paintViewport(el, surface, layer, camera, box);
  }, [layer, camera, box]);
  function discardPointerFrame() {
    if (pointerFrame.current !== null) cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = null;
    pendingPointer.current = null;
  }
  function queuePointer(cursor: Point, camera?: Camera, box?: SelectionBox) {
    pendingPointer.current = { cursor, camera, box };
    if (pointerFrame.current !== null) return;
    pointerFrame.current = requestAnimationFrame(() => {
      pointerFrame.current = null;
      const sample = pendingPointer.current;
      pendingPointer.current = null;
      if (!sample) return;
      setCursor((old) =>
        old?.x === sample.cursor.x && old.z === sample.cursor.z ? old : sample.cursor,
      );
      if (sample.camera) setCamera(sample.camera);
      if (sample.box) setBox(sample.box);
    });
  }
  function cancelGesture() {
    discardPointerFrame();
    const active = drag.current;
    drag.current = undefined;
    if (active && canvas.current?.hasPointerCapture(active.id))
      canvas.current.releasePointerCapture(active.id);
    setBox(undefined);
  }
  function applyKeys(keys: string[], mode: 'add' | 'erase' | 'replace' | 'invert') {
    const next = mode === 'replace' ? new Set<string>() : new Set(currentSelection.current);
    for (const key of keys) {
      if (mode === 'erase' || (mode === 'invert' && next.has(key))) next.delete(key);
      else next.add(key);
    }
    if (next.size > 8192 || groupsFrom(next).length > 64) {
      setNotice('每次最多选择 8192 个区块、64 个区域');
      return;
    }
    setNotice('');
    replaceSelection(next);
  }
  function brush(a: Point, b: Point, erase: boolean) {
    const steps = Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)),
      keys: string[] = [];
    for (let n = 0; n <= steps; n++) {
      const t = steps ? n / steps : 0,
        p = { x: Math.round(a.x + (b.x - a.x) * t), z: Math.round(a.z + (b.z - a.z) * t) };
      keys.push(...inBox(index, p, p));
    }
    applyKeys(keys, erase ? 'erase' : 'add');
  }
  function pointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (drag.current || (e.button !== 0 && e.button !== 1)) return;
    discardPointerFrame();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    const screen = screenPoint(e),
      c = chunkAt(blockAt(screen, camera)),
      mode = e.button === 1 || side ? 'pan' : tool;
    drag.current = { id: e.pointerId, screen, start: c, last: c, camera, tool: mode, moved: false };
    if (mode === 'rectangle-add' || mode === 'rectangle-remove')
      setBox({ a: c, b: c, remove: mode === 'rectangle-remove' });
    if (mode === 'brush' || mode === 'erase') brush(c, c, mode === 'erase');
  }
  function pointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (d && e.pointerId !== d.id) return;
    const screen = screenPoint(e);
    const block = blockAt(screen, camera);
    if (!d) return queuePointer(block);
    if (Math.hypot(screen.x - d.screen.x, screen.z - d.screen.z) > 3) d.moved = true;
    if (d.tool === 'pan' && d.moved) {
      const next = panCamera(d.camera, d.screen, screen);
      return queuePointer(blockAt(screen, next), next);
    }
    const c = chunkAt(block);
    if (d.tool === 'rectangle-add' || d.tool === 'rectangle-remove')
      return queuePointer(block, undefined, {
        a: d.start,
        b: c,
        remove: d.tool === 'rectangle-remove',
      });
    queuePointer(block);
    if ((d.tool === 'brush' || d.tool === 'erase') && (c.x !== d.last.x || c.z !== d.last.z))
      brush(d.last, c, d.tool === 'erase');
    d.last = c;
  }
  function pointerUp(e: PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    discardPointerFrame();
    const screen = screenPoint(e);
    const moved = d.moved || Math.hypot(screen.x - d.screen.x, screen.z - d.screen.z) > 3;
    const finalCamera = d.tool === 'pan' && moved ? panCamera(d.camera, d.screen, screen) : camera;
    if (finalCamera !== camera) setCamera(finalCamera);
    const block = blockAt(screen, finalCamera),
      c = chunkAt(block),
      key = cellKey(Math.floor(c.x / 32), Math.floor(c.z / 32));
    setCursor(block);
    if (d.tool === 'rectangle-add' || d.tool === 'rectangle-remove')
      applyKeys(inBox(index, d.start, c), d.tool === 'rectangle-remove' ? 'erase' : 'add');
    if ((d.tool === 'brush' || d.tool === 'erase') && (c.x !== d.last.x || c.z !== d.last.z))
      brush(d.last, c, d.tool === 'erase');
    if (!moved && d.tool === 'pan')
      setInspect(tiles.current.get(key)?.chunks.find((v) => v.x === c.x && v.z === c.z));
    if (d.tool === 'spawn' && !locked && spawnHere) {
      if (inBox(index, c, c).length) {
        setPin(block);
        setSpawnY(String(spawn?.y ?? 64));
      } else setNotice('请选择已生成的区块');
    }
    setBox(undefined);
    drag.current = undefined;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }
  const maxTicks = minutes === '' ? undefined : Math.floor(Number(minutes) * 1200),
    before = date ? Math.floor(Date.parse(date) / 1000) : undefined;
  const validFilters =
    (maxTicks === undefined || (Number.isSafeInteger(maxTicks) && maxTicks >= 0)) &&
    Number.isInteger(+radius) &&
    +radius >= 0 &&
    +radius <= 128 &&
    (!date || before! >= 0);
  const loadedKeys = (filter: boolean) =>
    visible.flatMap((r) =>
      (tiles.current.get(cellKey(r.x, r.z))?.chunks ?? [])
        .filter(
          (c) =>
            !c.error &&
            (!filter ||
              ((maxTicks === undefined ||
                (c.inhabitedTicks != null && c.inhabitedTicks <= maxTicks)) &&
                (!before || (c.timestamp > 0 && c.timestamp < before)))),
        )
        .map((c) => cellKey(c.x, c.z)),
    );
  return (
    <section className="world-atlas" aria-label="世界地图">
      <div className="atlas-tools" role="toolbar" aria-label="地图工具">
        {toolList.map(([id, label, Icon]) => (
          <button
            key={id}
            aria-pressed={(side ? 'pan' : tool) === id}
            disabled={
              (!!side && id !== 'pan') ||
              (id === 'spawn' && (!spawnHere || locked || spawn?.y == null))
            }
            title={label}
            onClick={() => setTool(id)}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
        <div className="atlas-spacer" />
        <button
          className="icon"
          aria-label="区块网格"
          title="区块网格"
          aria-pressed={grid}
          onClick={() => setGrid(!grid)}
        >
          <Grid2X2 size={16} />
        </button>
        <button
          className="icon"
          aria-label="停留热力图"
          disabled={!!side}
          title="停留热力图"
          aria-pressed={heat}
          onClick={() => setHeat(!heat)}
        >
          <Thermometer size={16} />
        </button>
      </div>
      <div className="atlas-frame">
        <canvas
          ref={canvas}
          tabIndex={0}
          aria-label="区块地表地图"
          data-tool={side ? 'pan' : tool}
          data-resolution={side || 512}
          data-tiles={loaded}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onLostPointerCapture={(e) => {
            if (drag.current?.id === e.pointerId) cancelGesture();
          }}
          onPointerCancel={(e) => {
            if (drag.current?.id === e.pointerId) cancelGesture();
          }}
          onPointerLeave={() => {
            if (!drag.current) {
              discardPointerFrame();
              setCursor(undefined);
            }
          }}
          onKeyDown={(e) => {
            const delta = 80 / camera.zoom;
            if (e.key === '+' || e.key === '=') setCamera((c) => zoom(c, 1.5));
            else if (e.key === '-') setCamera((c) => zoom(c, 1 / 1.5));
            else if (e.key === 'Home') setCamera(initial);
            else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
              setCamera((c) => ({
                ...c,
                x: bound(
                  c.x + (e.key === 'ArrowLeft' ? -delta : e.key === 'ArrowRight' ? delta : 0),
                ),
                z: bound(c.z + (e.key === 'ArrowUp' ? -delta : e.key === 'ArrowDown' ? delta : 0)),
              }));
            } else return;
            e.preventDefault();
          }}
        />
        <div className="atlas-zoom">
          <button aria-label="放大地图" title="放大" onClick={() => setCamera((c) => zoom(c, 1.5))}>
            <Plus size={16} />
          </button>
          <button
            aria-label="缩小地图"
            title="缩小"
            onClick={() => setCamera((c) => zoom(c, 1 / 1.5))}
          >
            <Minus size={16} />
          </button>
          <button aria-label="适应全图" title="适应全图" onClick={() => setCamera(entireWorld)}>
            <Maximize size={16} />
          </button>
          <button aria-label="回到世界中心" title="回到世界中心" onClick={() => setCamera(initial)}>
            <LocateFixed size={16} />
          </button>
        </div>
        <span className="atlas-coordinate">
          X {Math.floor((cursor ?? camera).x)}　Z {Math.floor((cursor ?? camera).z)}
        </span>
        {needed && (
          <span className="atlas-status" role="status">
            读取地形…
          </span>
        )}
        {!needed && !visible.length && (
          <span className="atlas-status">
            {index.size ? '此处没有已生成区块' : '暂无已生成地形'}
          </span>
        )}
      </div>
      {failure && (
        <p role="alert">
          {failure}{' '}
          <button
            onClick={() => {
              errors.current.clear();
              thumbnails.retry();
              redraw((n) => n + 1);
            }}
          >
            重试
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="atlas-selection">
        <span>已选 {selection.size} 个</span>
        <button disabled={!selection.size} onClick={() => replaceSelection(new Set())}>
          清空选择
        </button>
        <button
          className="primary"
          disabled={locked || busy || !selection.size || !validFilters}
          onClick={async () => {
            setBusy(true);
            const value = await run(() =>
              api.planWorldSelection({
                id,
                world,
                dimension,
                groups,
                protectSpawn: +radius,
                maxInhabitedTicks: maxTicks,
                beforeTimestamp: before,
              }),
            );
            if (value) setReview(value);
            setBusy(false);
          }}
        >
          {busy ? '正在核对…' : '删除区块'}
        </button>
      </div>
      <details className="atlas-settings">
        <summary>定位与筛选</summary>
        <form
          className="atlas-fields"
          onSubmit={(e) => {
            e.preventDefault();
            setCamera((c) => ({ ...c, x: bound(+jumpX), z: bound(+jumpZ) }));
          }}
        >
          <label>
            方块 X
            <input
              type="number"
              required
              min="-30000000"
              max="30000000"
              value={jumpX}
              onChange={(e) => setJumpX(e.target.value)}
            />
          </label>
          <label>
            方块 Z
            <input
              type="number"
              required
              min="-30000000"
              max="30000000"
              value={jumpZ}
              onChange={(e) => setJumpZ(e.target.value)}
            />
          </label>
          <button type="submit">
            <Crosshair size={14} />
            跳转
          </button>
        </form>
        <div className="atlas-fields">
          <label>
            最大停留分钟
            <input
              type="number"
              min={0}
              value={minutes}
              placeholder="不限"
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <label>
            最后修改早于
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            出生点保护半径
            <input
              type="number"
              min={0}
              max={128}
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
            />
          </label>
        </div>
        <div className="atlas-fields">
          <button
            disabled={!!side || !!needed || !visible.length || !validFilters}
            title="筛选地图视野涉及的区域文件"
            onClick={() => applyKeys(loadedKeys(true), 'replace')}
          >
            选择符合条件的区块
          </button>
          <button
            disabled={!!side || !!needed || !visible.length}
            onClick={() => applyKeys(loadedKeys(false), 'invert')}
          >
            反选视野内区域
          </button>
        </div>
      </details>
      {inspect && (
        <details open className="atlas-settings">
          <summary>
            区块 {inspect.x}, {inspect.z}
          </summary>
          <p>
            {inspect.status} · {size(inspect.bytes)}
            {inspect.inhabitedTicks != null &&
              ' · 停留 ' + (inspect.inhabitedTicks / 1200).toFixed(1) + ' 分钟'}
          </p>
          {inspect.timestamp > 0 && (
            <p>{new Date(inspect.timestamp * 1000).toLocaleString('zh-CN')}</p>
          )}
          {inspect.error && <p role="alert">{inspect.error}</p>}
          {!!inspect.blockEntities?.length && <p>{inspect.blockEntities.join('、')}</p>}
          {!!inspect.palette?.length && <p>{inspect.palette.join('、')}</p>}
        </details>
      )}
      {pin && (
        <Modal title="设置世界出生点" onClose={() => setPin(undefined)}>
          <div className="form-body world-backup-fields">
            <p>
              X {pin.x}　Z {pin.z}
            </p>
            <label>
              出生点 Y
              <input
                type="number"
                min={-2048}
                max={2048}
                value={spawnY}
                onChange={(e) => setSpawnY(e.target.value)}
              />
            </label>
          </div>
          <div className="modal-footer">
            <button onClick={() => setPin(undefined)}>取消</button>
            <button
              className="primary"
              disabled={
                locked ||
                busy ||
                spawnY === '' ||
                !Number.isInteger(+spawnY) ||
                +spawnY < -2048 ||
                +spawnY > 2048
              }
              onClick={async () => {
                setBusy(true);
                const ok = await run(async () => {
                  await api.editWorld({
                    id,
                    world,
                    patch: { spawnX: pin.x, spawnY: +spawnY, spawnZ: pin.z },
                  });
                  return true;
                });
                setBusy(false);
                if (ok) {
                  setPin(undefined);
                  onEdited();
                }
              }}
            >
              保存出生点
            </button>
          </div>
        </Modal>
      )}
      {review && (
        <Modal title="区块清理预览" onClose={() => setReview(undefined)}>
          <div className="save-review">
            <strong>
              {world} · {worldDimensionName(dimension)}
            </strong>
            <p>
              可清理 {review.count} 个区块，涉及 {review.files} 个文件，预计回收{' '}
              {size(review.reclaimedBytes)}。
            </p>
            {!!review.skipped.length && (
              <details>
                <summary>跳过 {review.skipped.length} 个区块</summary>
                <div className="save-skipped">
                  {review.skipped.slice(0, 150).map((c) => (
                    <p key={cellKey(c.x, c.z)}>
                      {c.x}, {c.z} · {c.reason}
                    </p>
                  ))}
                </div>
              </details>
            )}
          </div>
          <div className="modal-footer">
            <button onClick={() => setReview(undefined)}>取消</button>
            <button
              className="danger"
              disabled={!review.count || locked || busy}
              onClick={async () => {
                setBusy(true);
                const task = await run(() => api.applyWorldPrune(review.token));
                setBusy(false);
                if (task) setReview(undefined);
              }}
            >
              继续清理…
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
