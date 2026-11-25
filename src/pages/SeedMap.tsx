import { matchesSearch } from '../../shared/search';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bookmark,
  Copy,
  Download,
  Expand,
  FolderOpen,
  Home,
  LocateFixed,
  MapPin as PinIcon,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Shrink,
  Trash2,
  X,
} from 'lucide-react';
import type { Snapshot, WorldRef } from '../../shared/types';
import {
  emptySeedMapState,
  isSlimeChunk,
  type SeedDimension,
  type SeedMapDocument,
  type SeedMapFeature,
  type SeedMapInfo,
  type SeedMapMarker,
  type SeedMapQuery,
  type SeedMapState,
  type SeedMapWorld,
} from '../../shared/seed-map';
import { ItemArt } from '../components/ItemArt';
import { api } from '../api';
import { Select } from '../Select';
import { Field, Modal } from '../components';
import type { Run } from '../ui';
import { MapCanvas, type CanvasHover, type MapPin } from '../seed-map/MapCanvas';
import { clampCoordinate, clampZoom, type MapView, type WorldPoint } from '../seed-map/map-math';
import '../seed-map/seed-map.css';

const dimensions: Record<SeedDimension, string> = {
  overworld: '主世界',
  nether: '下界',
  end: '末地',
};
const queryOf = (map: SeedMapDocument): SeedMapQuery => ({
  seed: map.seed,
  version: map.version,
  dimension: map.dimension,
  y: map.y,
  largeBiomes: map.largeBiomes,
});
const supportedPreset = (world: SeedMapWorld) =>
  !world.preset ||
  ['default', 'normal', 'overworld', 'largebiomes', 'large_biomes'].includes(
    world.preset.toLowerCase().replace(/^minecraft:/, ''),
  );
function makeMap(seed: string, version: string, name = '未命名地图'): SeedMapDocument {
  return {
    id: crypto.randomUUID(),
    name,
    seed,
    seedText: seed,
    version,
    dimension: 'overworld',
    y: 64,
    largeBiomes: false,
    centerX: 0,
    centerZ: 0,
    zoom: 0.5,
    structures: [
      'spawn',
      'village',
      'desert_pyramid',
      'jungle_temple',
      'monument',
      'mansion',
      'ancient_city',
      'stronghold',
    ],
    grid: false,
    slime: false,
    highlightBiomes: [],
    markers: [],
    modifiedAt: Date.now(),
  };
}
const decodeIds = (value: string) => {
  const raw = atob(value);
  if (raw.length !== 128 * 128 * 2) throw new Error('群系像素尺寸不匹配');
  return Uint16Array.from(
    { length: 128 * 128 },
    (_, i) => raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8),
  );
};
export function SeedMapPage({
  state,
  run,
  active = true,
  importWorld,
  onImported,
}: {
  state: Snapshot;
  run: Run;
  active?: boolean;
  importWorld?: WorldRef;
  onImported?: () => void;
}) {
  const [info, setInfo] = useState<SeedMapInfo>(),
    [stored, setStored] = useState<SeedMapState>(emptySeedMapState),
    [loaded, setLoaded] = useState(false),
    [blocked, setBlocked] = useState(false),
    [changed, setChanged] = useState(0);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [seedText, setSeedText] = useState(''),
    [version, setVersion] = useState('');
  const [fullscreen, setFullscreen] = useState(false),
    [panel, setPanel] = useState(true),
    [labels, setLabels] = useState(true),
    [modal, setModal] = useState<'library' | 'world' | 'marker' | 'switch' | null>(null);
  const [pendingMap, setPendingMap] = useState<SeedMapDocument>();
  const [status, setStatus] = useState({
      pending: 0,
      loaded: 0,
      error: undefined as string | undefined,
    }),
    [hover, setHover] = useState<CanvasHover | null>(null),
    [hoverName, setHoverName] = useState('');
  const [bounds, setBounds] = useState({ minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 }),
    [features, setFeatures] = useState<SeedMapFeature[]>([]),
    [spawn, setSpawn] = useState<WorldPoint>(),
    [truncated, setTruncated] = useState(false),
    [featuresBusy, setFeaturesBusy] = useState(false);
  const [pick, setPick] = useState<{ point: WorldPoint; pin?: MapPin }>(),
    [jumpX, setJumpX] = useState('0'),
    [jumpZ, setJumpZ] = useState('0');
  const [searchKind, setSearchKind] = useState<'structure' | 'biome'>('structure'),
    [searchTarget, setSearchTarget] = useState(''),
    [searchRadius, setSearchRadius] = useState(4096),
    [searching, setSearching] = useState(false),
    [results, setResults] = useState<SeedMapFeature[]>([]),
    [sampleStep, setSampleStep] = useState<number>(),
    [searched, setSearched] = useState(false);
  const [markerName, setMarkerName] = useState('我的标记'),
    [markerNotes, setMarkerNotes] = useState(''),
    [markerColor, setMarkerColor] = useState('#ff8b3d'),
    [editingMarker, setEditingMarker] = useState<string>();
  const [biomeFilter, setBiomeFilter] = useState(''),
    [structureFilter, setStructureFilter] = useState(''),
    [pendingWorld, setPendingWorld] = useState<SeedMapWorld>();
  const [worldInstance, setWorldInstance] = useState(
      state.selectedInstanceId ?? state.instances[0]?.id ?? '',
    ),
    [worlds, setWorlds] = useState<{ folder: string; name?: string }[]>([]);
  const latest = useRef(stored);
  latest.current = stored;
  const windowUi = useRef({ fullscreen, modal, active });
  windowUi.current = { fullscreen, modal, active };
  const initialized = useRef(false),
    mounted = useRef(true),
    requestGeneration = useRef(0),
    searchRequest = useRef<string | undefined>(undefined),
    exportCapture = useRef<(() => string) | undefined>(undefined),
    importToken = useRef('');
  const map = stored.current,
    supported = !!map && !!info?.versions.some((v) => v.id === map.version);
  const query = useMemo(
    () => (map ? queryOf(map) : null),
    [map?.seed, map?.version, map?.dimension, map?.y, map?.largeBiomes],
  );
  const identity = JSON.stringify(query),
    enabledTypes = useMemo(
      () =>
        info?.structures.filter(
          (s) =>
            s.dimension === map?.dimension &&
            (!s.minVersion ||
              (map?.version ?? '').localeCompare(s.minVersion, undefined, { numeric: true }) >= 0),
        ) ?? [],
      [info, map?.dimension, map?.version],
    );
  const displayedTypes = enabledTypes.filter((s) => matchesSearch(structureFilter, s.name, s.id));
  const biomes = useMemo(
    () =>
      info?.biomes.filter(
        (b) =>
          b.dimension === map?.dimension &&
          (!b.versions || b.versions.includes(map?.version ?? '')),
      ) ?? [],
    [info, map?.dimension, map?.version],
  );
  const mutate = (work: (value: SeedMapState) => SeedMapState) => {
    setStored((value) => work(value));
    setChanged((value) => value + 1);
  };
  function invalidateSearch() {
    const id = searchRequest.current;
    searchRequest.current = undefined;
    setSearching(false);
    setSearched(false);
    setResults([]);
    setSampleStep(undefined);
    if (id) void api.seedMapCancel(id).catch(() => {});
  }
  const update = (patch: Partial<SeedMapDocument>) => {
    if (['seed', 'version', 'dimension', 'y', 'largeBiomes'].some((key) => key in patch))
      invalidateSearch();
    mutate((value) =>
      value.current
        ? { ...value, current: { ...value.current, ...patch, modifiedAt: Date.now() } }
        : value,
    );
  };
  const go = (x: number, z: number, zoom?: number) => {
    update({
      centerX: Math.round(clampCoordinate(x)),
      centerZ: Math.round(clampCoordinate(z)),
      ...(zoom !== undefined ? { zoom: clampZoom(zoom) } : {}),
    });
    setJumpX(String(Math.round(x)));
    setJumpZ(String(Math.round(z)));
  };
  const applyMap = (next: SeedMapDocument) => {
    invalidateSearch();
    mutate((value) => ({ ...value, current: structuredClone(next) }));
    setSeedText(next.seedText ?? next.seed);
    setVersion(next.version);
    setPick(undefined);
    setResults([]);
    setSearched(false);
    setModal(null);
  };
  const switchMap = (next: SeedMapDocument) => {
    const current = latest.current.current;
    const saved = current && latest.current.saved.find((value) => value.id === current.id);
    if (
      current &&
      current.markers.length &&
      JSON.stringify(current.markers) !== JSON.stringify(saved?.markers) &&
      current !== next
    ) {
      setPendingMap(next);
      setModal('switch');
      return;
    }
    applyMap(next);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void Promise.allSettled([api.seedMapInfo(), api.seedMapState()]).then(([engine, saved]) => {
      if (!mounted.current) return;
      if (engine.status === 'fulfilled') {
        setInfo(engine.value);
        setVersion(
          engine.value.versions
            .map((v) => v.id)
            .filter((id) => /^\d/.test(id))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .at(-1) ?? '',
        );
      } else
        setError(engine.reason instanceof Error ? engine.reason.message : String(engine.reason));
      if (saved.status === 'fulfilled') {
        setStored(saved.value);
        if (saved.value.current) {
          setSeedText(saved.value.current.seedText ?? saved.value.current.seed);
          setVersion(saved.value.current.version);
        }
      } else {
        setBlocked(true);
        setError(saved.reason instanceof Error ? saved.reason.message : String(saved.reason));
      }
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!loaded || !changed || blocked) return;
    const snapshot = stored;
    void api.seedMapSaveState(snapshot).catch((e) => {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    });
  }, [changed, loaded, blocked, stored]);
  useEffect(() => {
    if (!active) {
      void api.windowFullscreen(false).catch(() => {});
      setFullscreen(false);
      requestGeneration.current++;
      invalidateSearch();
    }
  }, [active]);
  useEffect(
    () =>
      api.onEvent((event) => {
        if (event.type === 'window-fullscreen') setFullscreen(event.fullscreen);
      }),
    [],
  );
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      const current = windowUi.current;
      if (event.key === 'Escape' && current.active && current.fullscreen && !current.modal) {
        event.preventDefault();
        void api
          .windowFullscreen(false)
          .then(setFullscreen)
          .catch((e) => setError(String(e)));
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  const applyWorld = (world: SeedMapWorld) => {
    setSeedText(world.seed);
    setPendingWorld(world);
    setNotice(supportedPreset(world) ? '' : '按默认地形预测');
    if (!world.version || !info?.versions.some((v) => v.id === world.version)) {
      setVersion('');
      setError(`存档版本 ${world.version ?? '未知'} 暂不支持，请选择生成版本`);
      setModal(null);
      return;
    }
    const next = makeMap(world.seed, world.version, world.name);
    next.largeBiomes = !!world.largeBiomes;
    if (world.spawn) {
      next.centerX = world.spawn.x;
      next.centerZ = world.spawn.z;
    }
    switchMap(next);
    setPendingWorld(undefined);
  };
  useEffect(() => {
    if (!importWorld) {
      importToken.current = '';
      return;
    }
    if (!loaded || !info) return;
    const key = JSON.stringify(importWorld);
    if (importToken.current === key) return;
    importToken.current = key;
    void run(() => api.seedMapImportWorld(importWorld)).then((world) => {
      if (world && mounted.current) applyWorld(world);
      onImported?.();
    });
  }, [importWorld, loaded, info]);
  useEffect(() => {
    if (modal !== 'world' || !worldInstance) return;
    let live = true;
    setWorlds([]);
    void run(() => api.saveWorlds(worldInstance)).then((list) => {
      if (live && list) setWorlds(list);
    });
    return () => {
      live = false;
    };
  }, [modal, worldInstance]);
  useEffect(() => {
    setPick(undefined);
    setResults([]);
    setSearched(false);
    setFeatures([]);
    setSpawn(undefined);
    setSearchTarget('');
    invalidateSearch();
  }, [identity]);
  useEffect(() => {
    if (!active || !query || !supported) return;
    const wide = bounds.maxX - bounds.minX > 131072 || bounds.maxZ - bounds.minZ > 131072;
    if (wide) {
      setFeatures([]);
      setTruncated(true);
    }
    const generation = ++requestGeneration.current,
      requestId = crypto.randomUUID();
    let started = false;
    const timer = setTimeout(() => {
      started = true;
      setFeaturesBusy(true);
      void api
        .seedMapFeatures({
          ...query,
          requestId,
          x0: wide ? 0 : bounds.minX,
          z0: wide ? 0 : bounds.minZ,
          x1: wide ? 1 : bounds.maxX,
          z1: wide ? 1 : bounds.maxZ,
          types: [
            ...new Set([
              ...(query.dimension === 'overworld' && enabledTypes.some((s) => s.id === 'spawn')
                ? ['spawn']
                : []),
              ...(wide ? [] : (map?.structures ?? [])).filter((id) =>
                enabledTypes.some((s) => s.id === id),
              ),
            ]),
          ].slice(0, 32),
          limit: 512,
        })
        .then((data) => {
          if (generation !== requestGeneration.current) return;
          setFeatures(data.items.filter((item) => item.type !== 'spawn'));
          setSpawn(data.spawn);
          setTruncated(wide || data.truncated);
        })
        .catch((e) => {
          if (generation === requestGeneration.current)
            setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (generation === requestGeneration.current) setFeaturesBusy(false);
        });
    }, 220);
    return () => {
      clearTimeout(timer);
      requestGeneration.current++;
      if (started) void api.seedMapCancel(requestId).catch(() => {});
    };
  }, [
    identity,
    active,
    supported,
    bounds.minX,
    bounds.maxX,
    bounds.minZ,
    bounds.maxZ,
    map?.structures.join(','),
  ]);
  useEffect(() => {
    if (!hover || !query || !active) {
      setHoverName('');
      return;
    }
    if (hover.biome !== undefined && hover.step === 1) {
      setHoverName(info?.biomes.find((b) => b.id === hover.biome)?.name ?? String(hover.biome));
      return;
    }
    setHoverName('采样中…');
    const requestId = crypto.randomUUID();
    let live = true,
      started = false;
    const timer = setTimeout(() => {
      started = true;
      void api
        .seedMapBiome({ ...query, requestId, x: hover.x, z: hover.z })
        .then((value) => {
          if (live) setHoverName(value.name);
        })
        .catch(() => {});
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
      if (started) void api.seedMapCancel(requestId).catch(() => {});
    };
  }, [hover?.x, hover?.z, hover?.biome, hover?.step, identity, active]);
  const typeName = (id: string) =>
    info?.structures.find((s) => s.id === id)?.name ?? (id === 'biome' ? '生物群系' : id);
  const toPin = (item: SeedMapFeature): MapPin => ({
    ...item,
    name: typeName(item.type),
    color: info?.structures.find((s) => s.id === item.type)?.color ?? '#ffd15c',
    kind: 'structure',
    detail: item.approximate ? '近似位置' : undefined,
  });
  const pins = useMemo(() => {
    if (!map) return [];
    const list: MapPin[] = [
      ...features,
      ...results.filter((r) => !features.some((f) => f.id === r.id)),
    ].map(toPin);
    list.push(
      ...map.markers
        .filter((m) => m.dimension === map.dimension)
        .map((m) => ({ ...m, type: 'marker', kind: 'marker' as const, detail: m.notes })),
    );
    if (spawn && map.dimension === 'overworld' && map.structures.includes('spawn'))
      list.push({
        ...spawn,
        id: 'spawn',
        type: 'spawn',
        name: '出生点',
        color: '#fff',
        kind: 'spawn',
        detail: '近似位置',
      });
    if (map.slime && map.dimension === 'overworld' && map.zoom >= 1) {
      const x0 = Math.floor(bounds.minX / 16),
        x1 = Math.floor(bounds.maxX / 16),
        z0 = Math.floor(bounds.minZ / 16),
        z1 = Math.floor(bounds.maxZ / 16);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) <= 20000)
        for (let z = z0; z <= z1; z++)
          for (let x = x0; x <= x1; x++)
            if (isSlimeChunk(map.seed, x, z))
              list.unshift({
                id: `slime:${x}:${z}`,
                x: x * 16,
                z: z * 16,
                type: 'slime',
                name: '史莱姆区块',
                color: '#65f35a',
                kind: 'slime',
              });
    }
    return list;
  }, [
    features,
    results,
    spawn,
    map?.markers,
    map?.structures,
    map?.dimension,
    map?.slime,
    map?.zoom,
    map?.seed,
    bounds,
    info,
  ]);
  const generate = async () => {
    if (!version) {
      setError('请选择生成版本');
      return;
    }
    const result = await run(() => api.seedMapSeed(seedText));
    if (!result) return;
    const next = makeMap(result.seed, version, pendingWorld?.name);
    next.seedText = seedText;
    next.largeBiomes = pendingWorld?.largeBiomes ?? false;
    next.structures = next.structures.filter((id) => info?.structures.some((s) => s.id === id));
    if (pendingWorld?.spawn) {
      next.centerX = pendingWorld.spawn.x;
      next.centerZ = pendingWorld.spawn.z;
    }
    switchMap(next);
    setNotice(pendingWorld && !supportedPreset(pendingWorld) ? '按默认地形预测' : '');
    setPendingWorld(undefined);
    setError('');
  };
  const save = () => {
    if (!map) return;
    const existing = stored.saved.some((item) => item.id === map.id);
    if (!existing && stored.saved.length >= 64) {
      setError('最多保存 64 张地图');
      return;
    }
    mutate((value) => ({
      ...value,
      saved: [structuredClone(map), ...value.saved.filter((item) => item.id !== map.id)],
    }));
    setNotice('地图已加入收藏');
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('已复制');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const locate = async () => {
    if (!query || !map || !searchTarget) return;
    invalidateSearch();
    const requestId = crypto.randomUUID();
    searchRequest.current = requestId;
    setSearching(true);
    setSearched(false);
    setResults([]);
    try {
      const found = await api.seedMapLocate({
        ...query,
        requestId,
        x: Math.round(map.centerX),
        z: Math.round(map.centerZ),
        kind: searchKind,
        target: searchTarget,
        radius: searchRadius,
        limit: 16,
      });
      if (searchRequest.current !== requestId) return;
      setResults(found.items);
      setSampleStep(searchKind === 'biome' ? found.sampleStep : undefined);
      setSearched(true);
      if (found.truncated) setNotice('结果较多，已显示前 16 项');
    } catch (e) {
      if (searchRequest.current === requestId) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (searchRequest.current === requestId) {
        setSearching(false);
        searchRequest.current = undefined;
      }
    }
  };
  const editMarker = (marker?: SeedMapMarker) => {
    setEditingMarker(marker?.id);
    setMarkerName(marker?.name ?? pick?.pin?.name ?? '我的标记');
    setMarkerNotes(marker?.notes ?? '');
    setMarkerColor(marker?.color ?? '#ff8b3d');
    if (marker) setPick({ point: marker });
    setModal('marker');
  };
  const saveMarker = () => {
    if (!map || !pick) return;
    if (!editingMarker && map.markers.length >= 500) {
      setError('最多保存 500 个标记');
      return;
    }
    const marker: SeedMapMarker = {
      id: editingMarker ?? crypto.randomUUID(),
      name: markerName.trim() || '我的标记',
      notes: markerNotes,
      color: markerColor,
      x: pick.point.x,
      z: pick.point.z,
      dimension: map.markers.find((m) => m.id === editingMarker)?.dimension ?? map.dimension,
    };
    update({ markers: [...map.markers.filter((m) => m.id !== marker.id), marker] });
    setModal(null);
  };
  const receiveStatus = useCallback(
    (value: { pending: number; loaded: number; error?: string }) =>
      setStatus({ ...value, error: value.error }),
    [],
  );
  const receiveBounds = useCallback(
    (value: typeof bounds) =>
      setBounds((before) =>
        Object.keys(value).every(
          (key) => before[key as keyof typeof bounds] === value[key as keyof typeof bounds],
        )
          ? before
          : value,
      ),
    [],
  );
  if (!loaded)
    return (
      <section hidden={!active}>
        <p role="status">正在准备地图…</p>
      </section>
    );
  const content = (
    <section
      className={'seed-page ' + (fullscreen ? 'is-fullscreen' : '')}
      hidden={!active}
      aria-label="种子地图查看器"
    >
      <form
        className="seed-topbar"
        onSubmit={(event) => {
          event.preventDefault();
          void generate();
        }}
      >
        <input
          aria-label="世界种子"
          placeholder="输入种子或文字"
          value={seedText}
          maxLength={256}
          onChange={(e) => setSeedText(e.target.value)}
        />
        <Select
          aria-label="Minecraft 版本"
          value={version}
          onChange={(e) => {
            setVersion(e.target.value);
            if (map && !pendingWorld) update({ version: e.target.value });
          }}
        >
          <option value="">选择版本</option>
          {info?.versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
        <button className="primary" type="submit" disabled={!info || !seedText.trim() || !version}>
          查看地图
        </button>
        <button
          type="button"
          title="随机种子"
          aria-label="随机种子"
          onClick={() =>
            void run(() => api.seedMapRandom()).then((seed) => {
              if (seed) setSeedText(seed);
            })
          }
        >
          <RefreshCw size={16} />
        </button>
        <button type="button" onClick={() => setModal('world')}>
          <FolderOpen size={16} />
          读取存档
        </button>
        <button type="button" onClick={() => setModal('library')}>
          <Bookmark size={16} />
          我的地图
        </button>
        <button
          type="button"
          className="icon"
          aria-label={fullscreen ? '退出全屏' : '全屏地图'}
          onClick={() =>
            void api
              .windowFullscreen(!fullscreen)
              .then(setFullscreen)
              .catch((e) => setError(String(e)))
          }
        >
          {fullscreen ? <Shrink size={17} /> : <Expand size={17} />}
        </button>
      </form>
      {(error || status.error) && (
        <div className="inline-error" role="alert">
          {error || status.error}
          <button
            onClick={() => {
              setError('');
              setStatus((s) => ({ ...s, error: undefined }));
            }}
          >
            关闭
          </button>
        </div>
      )}
      {blocked && (
        <div className="seed-warning">
          地图记录未能读取
          <button
            onClick={() =>
              void run(() => api.seedMapRecoverState()).then((value) => {
                if (value) {
                  setStored(value);
                  setBlocked(false);
                  setChanged((v) => v + 1);
                  if (value.current) {
                    setSeedText(value.current.seedText ?? value.current.seed);
                    setVersion(value.current.version);
                  }
                  setError('');
                }
              })
            }
          >
            恢复备份
          </button>
          <button
            onClick={() => {
              setBlocked(false);
              setChanged((v) => v + 1);
            }}
          >
            保留原件并继续
          </button>
        </div>
      )}
      {!map ? (
        <div className="seed-empty">
          <ItemArt name="map" size={64} />
          <h2>从一个种子开始</h2>
        </div>
      ) : (
        <>
          <div className="seed-controls">
            <input
              className="seed-title"
              aria-label="地图名称"
              value={map.name}
              maxLength={80}
              onChange={(e) => update({ name: e.target.value || '未命名地图' })}
            />
            <Select
              aria-label="地图维度"
              value={map.dimension}
              onChange={(e) =>
                update({
                  dimension: e.target.value as SeedDimension,
                  y: e.target.value === 'nether' ? 64 : map.y,
                })
              }
            >
              {Object.entries(dimensions).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </Select>
            <label>
              Y{' '}
              <input
                aria-label="群系采样高度"
                type="number"
                min="-64"
                max="320"
                value={map.y}
                onChange={(e) =>
                  update({ y: Math.round(Math.max(-64, Math.min(320, +e.target.value))) })
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={map.largeBiomes}
                onChange={(e) => update({ largeBiomes: e.target.checked })}
              />
              巨型群系
            </label>
            <button onClick={save}>
              <Save size={15} />
              收藏
            </button>
            <details className="seed-menu">
              <summary>导出</summary>
              <div>
                {(['png', 'project', 'markers'] as const).map((format, i) => (
                  <button
                    key={format}
                    disabled={format === 'png' && (!exportCapture.current || status.pending > 0)}
                    onClick={() =>
                      void run(() =>
                        api.seedMapExport({
                          map,
                          format,
                          ...(format === 'png' ? { image: exportCapture.current?.() } : {}),
                        }),
                      )
                    }
                  >
                    {['地图 PNG', '地图工程', '坐标标记'][i]}
                  </button>
                ))}
              </div>
            </details>
            <button onClick={() => setPanel(!panel)}>{panel ? '收起面板' : '显示面板'}</button>
          </div>
          {!supported && <p className="seed-warning">此地图版本暂不支持，请选择生成版本。</p>}
          <div className={'seed-layout ' + (!panel ? 'without-panel' : '')}>
            <div className="seed-map-area">
              {active && supported && query && (
                <MapCanvas
                  identity={identity}
                  view={{ x: map.centerX, z: map.centerZ, zoom: map.zoom }}
                  onView={(view: MapView) =>
                    update({
                      centerX: view.x,
                      centerZ: view.z,
                      zoom: view.zoom,
                    })
                  }
                  fetchTile={async (tile, requestId) => {
                    const result = await api.seedMapTile({
                      ...query,
                      ...tile,
                      step: tile.step as 1 | 4 | 16 | 64 | 256,
                      size: 128,
                      requestId,
                    });
                    return { ...tile, rgba: result.rgba, biomes: decodeIds(result.biomes) };
                  }}
                  cancel={(requestId) => void api.seedMapCancel(requestId).catch(() => {})}
                  pins={pins}
                  grid={map.grid}
                  labels={labels}
                  selected={pick?.pin?.id}
                  highlightBiome={map.highlightBiomes[0]}
                  onPick={(point, pin) => {
                    setPick({ point: pin ?? point, pin });
                    setJumpX(String(pin?.x ?? point.x));
                    setJumpZ(String(pin?.z ?? point.z));
                  }}
                  onHover={setHover}
                  onBounds={receiveBounds}
                  onStatus={receiveStatus}
                  onCaptureReady={(capture) => {
                    exportCapture.current = capture;
                  }}
                />
              )}
              <div className="seed-map-buttons">
                <button
                  aria-label="放大地图"
                  onClick={() => update({ zoom: clampZoom(map.zoom * 2) })}
                >
                  <Plus size={18} />
                </button>
                <button
                  aria-label="缩小地图"
                  onClick={() => update({ zoom: clampZoom(map.zoom / 2) })}
                >
                  <Minus size={18} />
                </button>
                <button title="回到原点" aria-label="回到原点" onClick={() => go(0, 0)}>
                  <Home size={17} />
                </button>
                <button
                  title="出生点（预测）"
                  aria-label="前往出生点"
                  disabled={!spawn || map.dimension !== 'overworld'}
                  onClick={() => spawn && go(spawn.x, spawn.z, 1)}
                >
                  <LocateFixed size={17} />
                </button>
              </div>
              {pick && (
                <div className="seed-point-card">
                  <button
                    className="seed-card-close icon"
                    aria-label="关闭坐标"
                    onClick={() => setPick(undefined)}
                  >
                    <X size={14} />
                  </button>
                  <strong>{pick.pin?.name ?? '坐标'}</strong>
                  <span>
                    {pick.point.x}, {pick.point.z}
                  </span>
                  {pick.pin?.detail && <small>{pick.pin.detail}</small>}
                  <div>
                    <button onClick={() => void copy(`${pick.point.x} ${pick.point.z}`)}>
                      复制坐标
                    </button>
                    <button
                      onClick={() =>
                        void copy(
                          `/execute in minecraft:${map.dimension === 'overworld' ? 'overworld' : map.dimension === 'nether' ? 'the_nether' : 'the_end'} run tp @s ${pick.point.x} ~ ${pick.point.z}`,
                        )
                      }
                    >
                      复制传送指令
                    </button>
                    <button
                      onClick={() => editMarker(map.markers.find((m) => m.id === pick.pin?.id))}
                    >
                      {pick.pin?.kind === 'marker' ? '编辑标记' : '添加标记'}
                    </button>
                  </div>
                </div>
              )}
              <div className="seed-status" role="status">
                <span>
                  {hover
                    ? `X ${hover.x} · Z ${hover.z} · 区块 ${Math.floor(hover.x / 16)}, ${Math.floor(hover.z / 16)}${hoverName ? ' · ' + hoverName : ''}`
                    : `种子 ${map.seed}`}
                </span>
                <span>
                  {status.pending
                    ? `生成地图 ${status.loaded}/${status.loaded + status.pending}`
                    : featuresBusy
                      ? '查询结构…'
                      : notice || `${Math.round(map.zoom * 100)}%`}
                </span>
              </div>
            </div>
            {panel && (
              <aside className="seed-panel">
                <form
                  className="seed-jump"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const x = Number(jumpX),
                      z = Number(jumpZ);
                    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
                    go(x, z);
                  }}
                >
                  <input
                    aria-label="跳转 X"
                    value={jumpX}
                    onChange={(e) => setJumpX(e.target.value)}
                  />
                  <input
                    aria-label="跳转 Z"
                    value={jumpZ}
                    onChange={(e) => setJumpZ(e.target.value)}
                  />
                  <button type="submit">跳转</button>
                </form>
                <div className="seed-layer-toggles">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={map.grid}
                      onChange={(e) => update({ grid: e.target.checked })}
                    />
                    区块网格
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={labels}
                      onChange={(e) => setLabels(e.target.checked)}
                    />
                    名称
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={map.slime}
                      disabled={map.dimension !== 'overworld'}
                      onChange={(e) => update({ slime: e.target.checked })}
                    />
                    史莱姆区块
                  </label>
                  {map.slime && map.zoom < 1 && <small>放大至 100% 查看史莱姆区块</small>}
                </div>
                <details open>
                  <summary>结构</summary>
                  <input
                    aria-label="筛选结构"
                    placeholder="筛选结构"
                    value={structureFilter}
                    onChange={(e) => setStructureFilter(e.target.value)}
                  />
                  <div className="seed-small-actions">
                    <button
                      onClick={() =>
                        update({
                          structures: [
                            ...new Set([...map.structures, ...enabledTypes.map((s) => s.id)]),
                          ].slice(0, 32),
                        })
                      }
                    >
                      全选
                    </button>
                    <button
                      onClick={() =>
                        update({
                          structures: map.structures.filter(
                            (id) => !enabledTypes.some((s) => s.id === id),
                          ),
                        })
                      }
                    >
                      隐藏全部
                    </button>
                  </div>
                  <div className="seed-structures">
                    {displayedTypes.map((item) => (
                      <label className="check" key={item.id}>
                        <input
                          type="checkbox"
                          checked={map.structures.includes(item.id)}
                          onChange={(e) =>
                            update({
                              structures: e.target.checked
                                ? [...new Set([...map.structures, item.id])].slice(0, 32)
                                : map.structures.filter((id) => id !== item.id),
                            })
                          }
                        />
                        <i style={{ background: item.color ?? '#ffd15c' }} />
                        {item.name}
                      </label>
                    ))}
                  </div>
                  {truncated && <small>放大可查看完整结构</small>}
                </details>
                <details open>
                  <summary>附近定位</summary>
                  <Select
                    aria-label="定位类别"
                    value={searchKind}
                    onChange={(e) => {
                      invalidateSearch();
                      setSearchKind(e.target.value as typeof searchKind);
                      setSearchTarget('');
                      setSearched(false);
                    }}
                  >
                    <option value="structure">结构</option>
                    <option value="biome">生物群系</option>
                  </Select>
                  <Select
                    aria-label="定位目标"
                    value={searchTarget}
                    onChange={(e) => {
                      invalidateSearch();
                      setSearchTarget(e.target.value);
                    }}
                  >
                    <option value="">选择目标</option>
                    {(searchKind === 'structure'
                      ? enabledTypes.map((s) => ({ id: s.id, name: s.name }))
                      : biomes.map((b) => ({ id: String(b.id), name: b.name }))
                    ).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    aria-label="定位半径"
                    value={searchRadius}
                    onChange={(e) => {
                      invalidateSearch();
                      setSearchRadius(+e.target.value);
                    }}
                  >
                    {[512, 1024, 4096, 8192, 16384].map((r) => (
                      <option key={r} value={r}>
                        {r.toLocaleString()} 格内
                      </option>
                    ))}
                  </Select>
                  <button
                    disabled={!searchTarget || !supported}
                    onClick={() => {
                      if (searching) {
                        invalidateSearch();
                      } else void locate();
                    }}
                  >
                    {searching ? '取消查找' : '从视图中心查找'}
                  </button>
                  <div className="seed-result-list">
                    {results.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          go(item.x, item.z, Math.max(map.zoom, 1));
                          setPick({ point: item, pin: toPin(item) });
                        }}
                      >
                        <span>
                          {searchKind === 'biome'
                            ? biomes.find((b) => String(b.id) === searchTarget)?.name
                            : typeName(item.type)}
                        </span>
                        <small>
                          {item.x}, {item.z}
                          {item.distance !== undefined ? ` · ${Math.round(item.distance)} 格` : ''}
                          {item.approximate ? ' · 近似' : ''}
                        </small>
                      </button>
                    ))}
                    {searched && sampleStep && <small>每 {sampleStep} 格采样</small>}
                    {searched && !results.length && (
                      <p className="muted">{sampleStep ? '采样未命中' : '范围内未找到'}</p>
                    )}
                  </div>
                </details>
                <details>
                  <summary>生物群系图例</summary>
                  <input
                    aria-label="筛选生物群系"
                    placeholder="筛选群系"
                    value={biomeFilter}
                    onChange={(e) => setBiomeFilter(e.target.value)}
                  />
                  <div className="seed-biomes">
                    {biomes
                      .filter((b) => matchesSearch(biomeFilter, b.name, b.id))
                      .map((biome) => (
                        <button
                          key={biome.id}
                          className={map.highlightBiomes.includes(biome.id) ? 'active' : ''}
                          onClick={() =>
                            update({
                              highlightBiomes: map.highlightBiomes.includes(biome.id)
                                ? []
                                : [biome.id],
                            })
                          }
                        >
                          <i style={{ background: biome.color }} />
                          {biome.name}
                        </button>
                      ))}
                  </div>
                </details>
                <details open>
                  <summary>
                    坐标标记 <small>{map.markers.length}/500</small>
                  </summary>
                  <div className="seed-small-actions">
                    <button
                      onClick={() => {
                        setPick({
                          point: { x: Math.round(map.centerX), z: Math.round(map.centerZ) },
                        });
                        setEditingMarker(undefined);
                        setMarkerName('我的标记');
                        setMarkerNotes('');
                        setModal('marker');
                      }}
                    >
                      标记中心
                    </button>
                    <button
                      onClick={async () => {
                        const origin = map.id,
                          file = await run(() => api.seedMapImportMarkers());
                        if (!file || latest.current.current?.id !== origin) return;
                        if (file.seed !== map.seed || file.version !== map.version) {
                          setError('标记文件的种子或版本不同');
                          return;
                        }
                        const currentMap = latest.current.current!;
                        const markers = [
                          ...currentMap.markers,
                          ...file.markers.filter(
                            (m) => !currentMap.markers.some((old) => old.id === m.id),
                          ),
                        ];
                        if (markers.length > 500) {
                          setError('合并后超过 500 个标记');
                          return;
                        }
                        update({ markers });
                      }}
                    >
                      导入标记
                    </button>
                  </div>
                  <div className="seed-marker-list">
                    {map.markers.map((marker) => (
                      <div key={marker.id}>
                        <button
                          onClick={() => {
                            update({
                              dimension: marker.dimension,
                              centerX: marker.x,
                              centerZ: marker.z,
                            });
                            setPick({
                              point: marker,
                              pin: { ...marker, type: 'marker', kind: 'marker' },
                            });
                          }}
                        >
                          <i style={{ background: marker.color }} />
                          <span>
                            {marker.name}
                            <small>
                              {dimensions[marker.dimension]} · {marker.x}, {marker.z}
                            </small>
                          </span>
                        </button>
                        <button
                          className="icon"
                          aria-label={'编辑标记 ' + marker.name}
                          onClick={() => editMarker(marker)}
                        >
                          <PinIcon size={13} />
                        </button>
                        <button
                          className="icon"
                          aria-label={'删除标记 ' + marker.name}
                          onClick={() =>
                            update({ markers: map.markers.filter((m) => m.id !== marker.id) })
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              </aside>
            )}
          </div>
        </>
      )}
      {modal === 'switch' && pendingMap && (
        <Modal
          title="保留当前地图？"
          onClose={() => {
            setModal(null);
            setPendingMap(undefined);
          }}
        >
          <div className="form-body">
            <p>当前标记尚未加入收藏。</p>
          </div>
          <div className="modal-footer">
            <button
              onClick={() => {
                setModal(null);
                setPendingMap(undefined);
              }}
            >
              取消
            </button>
            <button
              onClick={() => {
                applyMap(pendingMap);
                setPendingMap(undefined);
              }}
            >
              切换地图
            </button>
            <button
              className="primary"
              onClick={() => {
                const current = latest.current.current;
                if (current) {
                  if (!stored.saved.some((m) => m.id === current.id) && stored.saved.length >= 64) {
                    setError('最多保存 64 张地图');
                    return;
                  }
                  mutate((value) => ({
                    ...value,
                    saved: [
                      structuredClone(current),
                      ...value.saved.filter((m) => m.id !== current.id),
                    ],
                  }));
                }
                applyMap(pendingMap);
                setPendingMap(undefined);
              }}
            >
              收藏并切换
            </button>
          </div>
        </Modal>
      )}
      {modal === 'library' && (
        <Modal title="我的地图" onClose={() => setModal(null)}>
          <div className="form-body">
            <button
              onClick={() =>
                void run(() => api.seedMapImportProject()).then((project) => {
                  if (project) switchMap(project);
                })
              }
            >
              <FolderOpen size={16} />
              打开地图工程
            </button>
            <div className="seed-library">
              {!stored.saved.length && <p className="muted">暂无收藏地图</p>}
              {stored.saved.map((item) => (
                <article key={item.id}>
                  <button onClick={() => switchMap(item)}>
                    <strong>{item.name}</strong>
                    <small>
                      {item.version} · {dimensions[item.dimension]}
                      <br />
                      {item.seed}
                    </small>
                  </button>
                  <button
                    className="icon"
                    aria-label={'移除地图 ' + item.name}
                    onClick={() =>
                      mutate((value) => ({
                        ...value,
                        saved: value.saved.filter((m) => m.id !== item.id),
                      }))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
            </div>
          </div>
        </Modal>
      )}
      {modal === 'world' && (
        <Modal title="读取存档种子" onClose={() => setModal(null)}>
          <div className="form-body">
            <Select
              aria-label="存档所属实例"
              value={worldInstance}
              onChange={(e) => setWorldInstance(e.target.value)}
            >
              <option value="">选择实例</option>
              {state.instances.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
            <div className="seed-result-list">
              {worlds.map((world) => (
                <button
                  key={world.folder}
                  onClick={() =>
                    void run(() =>
                      api.seedMapImportWorld({ id: worldInstance, world: world.folder }),
                    ).then((world) => world && applyWorld(world))
                  }
                >
                  {world.name || world.folder}
                </button>
              ))}
              {worldInstance && !worlds.length && <p className="muted">暂无存档</p>}
            </div>
            <button
              onClick={() =>
                void run(() => api.seedMapImportWorld()).then((world) => world && applyWorld(world))
              }
            >
              选择 level.dat
            </button>
          </div>
        </Modal>
      )}
      {modal === 'marker' && pick && (
        <Modal title={editingMarker ? '编辑标记' : '添加标记'} onClose={() => setModal(null)}>
          <div className="form-body">
            <Field label="名称">
              <input
                aria-label="标记名称"
                value={markerName}
                maxLength={80}
                onChange={(e) => setMarkerName(e.target.value)}
              />
            </Field>
            <p>
              {pick.point.x}, {pick.point.z}
            </p>
            <Field label="颜色">
              <input
                aria-label="标记颜色"
                type="color"
                value={markerColor}
                onChange={(e) => setMarkerColor(e.target.value)}
              />
            </Field>
            <Field label="备注">
              <textarea
                aria-label="标记备注"
                maxLength={1000}
                value={markerNotes}
                onChange={(e) => setMarkerNotes(e.target.value)}
              />
            </Field>
          </div>
          <div className="modal-footer">
            <button onClick={() => setModal(null)}>取消</button>
            <button className="primary" onClick={saveMarker}>
              保存标记
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
  return fullscreen ? createPortal(content, document.body) : content;
}
