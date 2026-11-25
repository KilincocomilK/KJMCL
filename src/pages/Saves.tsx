import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Download,
  FolderOpen,
  Map,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Undo2,
} from 'lucide-react';
import type { Snapshot, SaveMetadata, SavePatch, SaveScan, WorldRef } from '../../shared/types';
import { matchesSearch } from '../../shared/search';
import { worldDimensionName } from '../../shared/world-dimensions';
import { api } from '../api';
import { Empty, InstanceSelect, Modal } from '../components';
import { LocalResourceArt, useLocalCards } from '../components/LocalResourceArt';
import { SplitView } from '../components/SplitView';
import { GameRules } from '../dialogs/GameRules';
import { WorldBackup } from '../dialogs/WorldBackup';
import { Select } from '../Select';
import { WorldMap } from '../save/WorldMap';
import { size, type Run } from '../ui';
import '../save/saves.css';

type PageProps = {
  state: Snapshot;
  run: Run;
  showInstanceSelect?: boolean;
  onSeedMap?: (world: WorldRef) => void;
};
export function SavesPage(props: PageProps) {
  const id = props.state.selectedInstanceId;
  return id ? (
    <Worlds key={id} {...props} id={id} />
  ) : (
    <Empty art="book" title="先选择一个游戏实例" />
  );
}
function Worlds({
  id,
  state,
  run,
  showInstanceSelect = true,
  onSeedMap,
}: PageProps & { id: string }) {
  const [worlds, setWorlds] = useState<SaveMetadata[]>([]),
    [world, setWorld] = useState(''),
    [search, setSearch] = useState('');
  const [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true);
  const names = useMemo(() => worlds.map((w) => w.folder), [worlds]),
    cards = useLocalCards(id, 'worlds', names);
  const taskSignature = state.tasks
    .filter(
      (t) =>
        t.status === 'completed' &&
        t.scope === id &&
        ['清理存档区块', '恢复存档'].includes(t.title),
    )
    .map((t) => t.id + ':' + t.status)
    .join(',');
  useEffect(() => {
    let current = true;
    setLoading(true);
    void run(() => api.saveWorlds(id)).then((data) => {
      if (!current) return;
      if (data) {
        data.sort(
          (a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.folder.localeCompare(b.folder),
        );
        setWorlds(data);
        setWorld((last) =>
          data.some((w) => w.folder === last)
            ? last
            : (data.find((w) => !w.error)?.folder ?? data[0]?.folder ?? ''),
        );
      }
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [id, run, refresh, taskSignature]);
  const locked =
    state.running.includes(id) || state.tasks.some((t) => t.scope === id && t.status === 'running');
  return (
    <div className="save-manager">
      <SplitView
        railLabel="世界列表"
        className="save-browser"
        rail={
          <>
            <div className="pane-heading">
              <h2>世界列表</h2>
              <button
                className="icon"
                aria-label="刷新存档"
                title="刷新存档"
                disabled={loading}
                onClick={() => setRefresh((v) => v + 1)}
              >
                <RefreshCw size={15} />
              </button>
            </div>
            {showInstanceSelect && <InstanceSelect state={state} run={run} />}
            <label className="search-input save-search">
              <Search size={15} />
              <input
                aria-label="搜索存档"
                placeholder="搜索世界"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="rail-list">
              {worlds
                .filter((w) => matchesSearch(search, w.name, w.folder, w.version))
                .map((w) => (
                  <button
                    className="rail-option"
                    key={w.folder}
                    aria-pressed={world === w.folder}
                    title={w.folder}
                    onClick={() => setWorld(w.folder)}
                  >
                    <LocalResourceArt kind="worlds" icon={cards?.get(w.folder)?.icon} />
                    <span>
                      <strong>{w.name || w.folder}</strong>
                      <small>{w.version ?? (w.error ? '无法读取属性' : '未知版本')}</small>
                    </span>
                  </button>
                ))}
              {!worlds.length && <p className="rail-empty">{loading ? '读取存档…' : '暂无存档'}</p>}
            </div>
          </>
        }
      >
        {world ? (
          <WorldDetail
            key={world}
            id={id}
            world={world}
            run={run}
            locked={locked}
            revision={refresh + '|' + taskSignature}
            onSeedMap={onSeedMap}
            onEdited={() => setRefresh((v) => v + 1)}
          />
        ) : (
          <Empty art="book" title={loading ? '读取存档…' : '暂无存档'} />
        )}
      </SplitView>
    </div>
  );
}
function WorldDetail({
  id,
  world,
  run,
  locked,
  revision,
  onEdited,
  onSeedMap,
}: WorldRef & {
  run: Run;
  locked: boolean;
  revision: string;
  onEdited: () => void;
  onSeedMap?: PageProps['onSeedMap'];
}) {
  const [scan, setScan] = useState<SaveScan>(),
    [dimension, selectDimension] = useState('overworld'),
    [dialog, setDialog] = useState<'rules' | 'backup' | 'properties'>(),
    [error, setError] = useState(''),
    [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let current = true;
    void run(async () => {
      try {
        const next = await api.scanWorld({ id, world });
        if (!current) return;
        setScan(next);
        setError('');
        setEpoch((n) => n + 1);
        selectDimension((old) =>
          next.dimensions.some((d) => d.id === old) ? old : (next.dimensions[0]?.id ?? 'overworld'),
        );
      } catch (e) {
        if (current) setError(e instanceof Error ? e.message : String(e));
      }
    });
    return () => {
      current = false;
    };
  }, [id, world, run, revision]);
  if (error || !scan)
    return (
      <div className="save-detail">
        <Empty art="book" title={error || '读取世界地图…'} />
      </div>
    );
  const regions = scan.dimensions.find((d) => d.id === dimension)?.regions ?? [];
  const meta = scan.metadata,
    updated = () => {
      setDialog(undefined);
      onEdited();
    };
  return (
    <div className="save-detail">
      <header className="world-header">
        <div>
          <h2>{meta.name || world}</h2>
          <span>{meta.version ?? '未知版本'}</span>
        </div>
        <div className="save-actions">
          <button disabled={locked} onClick={() => setDialog('rules')}>
            <SlidersHorizontal size={15} />
            游戏规则
          </button>
          <button disabled={locked} onClick={() => setDialog('properties')}>
            <Settings2 size={15} />
            属性
          </button>
          <button disabled={locked} onClick={() => setDialog('backup')}>
            <Archive size={15} />
            备份
          </button>
        </div>
      </header>
      <div className="world-map-heading">
        <h3>世界地图</h3>
        {scan.dimensions.length > 0 && (
          <Select
            aria-label="存档维度"
            value={dimension}
            onChange={(e) => selectDimension(e.target.value)}
          >
            {scan.dimensions.map((d) => (
              <option key={d.id} value={d.id}>
                {worldDimensionName(d.id)}
              </option>
            ))}
          </Select>
        )}
        {onSeedMap && meta.seed != null && (
          <button onClick={() => onSeedMap({ id, world })}>
            <Map size={15} />
            种子地图
          </button>
        )}
      </div>
      <WorldMap
        key={dimension + '|' + epoch}
        {...{ id, world, dimension, regions, locked, run, onEdited }}
        spawn={meta.spawn}
      />
      <details className="atlas-settings">
        <summary>存档信息</summary>
        <p>
          数据版本 {meta.dataVersion ?? '未知'}
          {meta.seed != null && ' · 种子 ' + meta.seed}
        </p>
        <p>
          {regions.length} 个区域 · {regions.reduce((n, r) => n + r.chunks, 0).toLocaleString()}{' '}
          个区块 · {size(regions.reduce((n, r) => n + r.bytes, 0))}
        </p>
        <div className="atlas-fields">
          <button onClick={() => void run(() => api.revealWorld({ id, world }))}>
            <FolderOpen size={15} />
            目录
          </button>
          <button disabled={locked} onClick={() => void run(() => api.exportWorld({ id, world }))}>
            <Download size={15} />
            导出 ZIP
          </button>
        </div>
      </details>
      {!!scan.history.length && (
        <section className="world-history">
          <h3>编辑历史</h3>
          {scan.history.map((h) => (
            <div className="mod-row" key={h.id}>
              <div className="grow">
                <strong>{h.title}</strong>
                <small>
                  {new Date(h.createdAt).toLocaleString('zh-CN')}
                  {h.state === 'undone' ? ' · 已恢复' : ''}
                </small>
              </div>
              <button
                disabled={locked || h.state === 'undone'}
                onClick={() =>
                  void run(async () => {
                    await api.undoWorldEdit({ id, world, transaction: h.id });
                    onEdited();
                  })
                }
              >
                <Undo2 size={15} />
                {h.state === 'prepared' ? '恢复中断操作' : '撤销'}
              </button>
            </div>
          ))}
        </section>
      )}
      {dialog === 'rules' && (
        <GameRules
          id={id}
          world={world}
          run={run}
          rules={meta.rules ?? {}}
          error={meta.ruleError}
          locked={locked}
          onClose={() => setDialog(undefined)}
          onSaved={updated}
        />
      )}
      {dialog === 'backup' && (
        <WorldBackup id={id} world={world} run={run} onClose={() => setDialog(undefined)} />
      )}
      {dialog === 'properties' && (
        <WorldProperties
          id={id}
          world={world}
          run={run}
          meta={meta}
          onClose={() => setDialog(undefined)}
          onSaved={updated}
        />
      )}
    </div>
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
          <Select
            value={form.gameType}
            onChange={(e) => update('gameType', Number(e.target.value))}
          >
            {['生存', '创造', '冒险', '旁观'].map((n, i) => (
              <option key={i} value={i}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        <label>
          难度
          <Select
            value={form.difficulty}
            onChange={(e) => update('difficulty', Number(e.target.value))}
          >
            {['和平', '简单', '普通', '困难'].map((n, i) => (
              <option key={i} value={i}>
                {n}
              </option>
            ))}
          </Select>
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
