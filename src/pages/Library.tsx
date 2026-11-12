import { Select } from '../Select';
import { useState } from 'react';
import {
  ArrowRight,
  Box,
  Star,
  List,
  LayoutGrid,
  MoreHorizontal,
  Tag,
  FolderOpen,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import type { Instance, InstanceOrganization, Snapshot, MinecraftScan } from '../../shared/types';
import { ImportDialog } from '../dialogs/AdvancedDialogs';
import '../game-folders.css';
import { api } from '../api';
import { Modal, Empty, Field } from '../components';
import { type Run, loaderLabel, statusLabel, date } from '../ui';
const blank: InstanceOrganization = { favorite: false, group: '', tags: [], notes: '' };
export function InstanceCard({
  i,
  state,
  run,
  onEdit,
}: {
  i: Instance;
  state: Snapshot;
  run: Run;
  onEdit: () => void;
}) {
  const selected = state.selectedInstanceId === i.id;
  return (
    <article className={'instance-card panel ' + (selected ? 'selected' : '')}>
      <div className="row">
        <div className={'instance-art ' + i.loader}>
          <Box size={27} />
        </div>
        <button className="icon" aria-label={i.name + ' 设置'} onClick={onEdit}>
          <MoreHorizontal size={21} />
        </button>
      </div>
      <button
        className="instance-name"
        onClick={() => void run(() => api.select({ instanceId: i.id }))}
      >
        {i.name}
        {selected && <span className="selected-dot" />}
      </button>
      <div className="instance-meta">
        {i.version}
        <span>/</span>
        {loaderLabel[i.loader]} {i.loaderVersion ?? ''}
      </div>
      <div className="card-bottom">
        <span>
          {state.running.includes(i.id)
            ? '运行中'
            : i.status !== 'ready'
              ? statusLabel[i.status]
              : null}
        </span>
        <button
          className="text-button"
          onClick={() => void run(() => api.select({ instanceId: i.id }), '已选择 ' + i.name)}
        >
          {selected ? '当前实例' : '选择'}
          <ArrowRight size={15} />
        </button>
      </div>
    </article>
  );
}
export function LibraryPage({
  state,
  run,
  onEdit,
}: {
  state: Snapshot;
  run: Run;
  onEdit: (i: Instance) => void;
}) {
  const [query, setQuery] = useState(''),
    [group, setGroup] = useState(''),
    [favorites, setFavorites] = useState(false),
    [view, setView] = useState<'cards' | 'list'>('cards'),
    [sort, setSort] = useState('recent'),
    [editing, setEditing] = useState<Instance>();
  const [scan, setScan] = useState<MinecraftScan>();
  const selectedFolder = state.gameFolders.find((f) => f.id === state.selectedGameFolderId);
  const folderInstances = state.instances.filter((i) =>
    selectedFolder ? i.external?.folderId === selectedFolder.id : !i.external,
  );
  const groups = [
    ...new Set(folderInstances.map((i) => i.organization?.group).filter(Boolean)),
  ] as string[];
  const items = folderInstances
    .filter(
      (i) =>
        (!favorites || i.organization?.favorite) &&
        (!group || i.organization?.group === group) &&
        [i.name, i.version, i.loader, i.organization?.notes, ...(i.organization?.tags ?? [])]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => {
      const pinned =
        Number(b.organization?.favorite ?? false) - Number(a.organization?.favorite ?? false);
      if (pinned) return pinned;
      return sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'time'
          ? b.playTime - a.playTime
          : sort === 'created'
            ? b.createdAt - a.createdAt
            : (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0);
    });
  return (
    <div className="game-library">
      <aside className="game-folders" aria-label="游戏文件夹">
        <div className="nav-caption">游戏文件夹</div>
        <button
          className={'game-folder ' + (!selectedFolder ? 'selected' : '')}
          aria-pressed={!selectedFolder}
          onClick={() => void run(() => api.select({ folderId: 'managed' }))}
        >
          <FolderOpen size={19} />
          <span>
            <strong>KJMCL 实例</strong>
            <small>{state.instances.filter((i) => !i.external).length} 个实例</small>
          </span>
        </button>
        {state.gameFolders.map((folder) => (
          <div className="game-folder-row" key={folder.id}>
            <button
              className={'game-folder ' + (selectedFolder?.id === folder.id ? 'selected' : '')}
              aria-pressed={selectedFolder?.id === folder.id}
              onClick={() => void run(() => api.select({ folderId: folder.id }))}
              title={folder.path}
            >
              <FolderOpen size={19} />
              <span>
                <strong>{folder.name}</strong>
                <small>{folder.path}</small>
              </span>
            </button>
            <button
              className="icon remove-folder"
              aria-label={'移除文件夹索引 ' + folder.name}
              onClick={() => void run(() => api.removeGameFolder(folder.id))}
            >
              <X size={15} />
            </button>
          </div>
        ))}
        <button
          className="text-button add-game-folder"
          onClick={() =>
            void run(async () => {
              const result = await api.scanMinecraft();
              if (result) setScan(result);
            })
          }
        >
          <Plus size={16} />
          添加游戏文件夹
        </button>
      </aside>
      <section className="game-folder-content">
        <div className="folder-heading">
          <div>
            <h2>{selectedFolder?.name ?? 'KJMCL 实例'}</h2>
            <p className="path-value">{selectedFolder?.path ?? '由 KJMCL 创建和管理的实例'}</p>
          </div>
          {selectedFolder && (
            <button
              onClick={() =>
                void run(() => api.refreshGameFolder(selectedFolder.id), '已刷新游戏文件夹')
              }
            >
              <RefreshCw size={16} />
              刷新版本
            </button>
          )}
        </div>
        {selectedFolder?.error && (
          <p role="alert" className="inline-error">
            文件夹暂不可用：{selectedFolder.error}
          </p>
        )}
        <div className="toolbar library-filters">
          <input
            aria-label="搜索实例"
            placeholder="名称、标签、版本…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select aria-label="实例分组" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">全部分组</option>
            {groups.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
          <Select aria-label="实例排序" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">最近游玩</option>
            <option value="name">名称</option>
            <option value="time">游玩时长</option>
            <option value="created">创建时间</option>
          </Select>
          <button aria-pressed={favorites} onClick={() => setFavorites(!favorites)}>
            <Star size={16} />
            只看收藏
          </button>
          <button
            aria-label="切换实例视图"
            onClick={() => setView(view === 'cards' ? 'list' : 'cards')}
          >
            {view === 'cards' ? <List size={17} /> : <LayoutGrid size={17} />}
          </button>
        </div>
        <div className="library-stats">
          <span>{folderInstances.length} 个版本</span>
          <span>
            累计 {Math.floor(folderInstances.reduce((n, i) => n + i.playTime, 0) / 3600000)} 小时
          </span>
          <span>收藏 {folderInstances.filter((i) => i.organization?.favorite).length} 个</span>
        </div>
        <div className={view === 'cards' ? 'instance-grid' : 'instance-list'}>
          {items.map((i) => (
            <article
              key={i.id}
              className={
                'instance-card panel ' + (state.selectedInstanceId === i.id ? 'selected' : '')
              }
            >
              <div className="row">
                <div className={'instance-art ' + i.loader}>
                  <Box size={27} />
                </div>
                <div className="row">
                  <button
                    className="icon"
                    aria-label={'收藏 ' + i.name}
                    aria-pressed={!!i.organization?.favorite}
                    onClick={() =>
                      void run(() =>
                        api.organizeInstance({
                          id: i.id,
                          organization: {
                            ...blank,
                            ...i.organization,
                            favorite: !i.organization?.favorite,
                          },
                        }),
                      )
                    }
                  >
                    <Star size={18} fill={i.organization?.favorite ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    className="icon"
                    aria-label={i.name + ' 分组与备注'}
                    onClick={() => setEditing(i)}
                  >
                    <Tag size={18} />
                  </button>
                  <button className="icon" aria-label={i.name + ' 设置'} onClick={() => onEdit(i)}>
                    <MoreHorizontal size={21} />
                  </button>
                </div>
              </div>
              <button
                className="instance-name"
                onClick={() => void run(() => api.select({ instanceId: i.id }))}
              >
                {i.name}
                {state.selectedInstanceId === i.id && <span className="selected-dot" />}
              </button>
              <div className="instance-meta">
                {i.version} / {loaderLabel[i.loader]} {i.loaderVersion ?? ''}
              </div>
              <div className="library-tags">
                {i.organization?.group && <b>{i.organization.group}</b>}
                {i.organization?.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              <small className="muted">
                最近 {date(i.lastPlayed)} · 游玩 {Math.floor(i.playTime / 60000)} 分钟
              </small>
              {i.external && (
                <small className="external-location" title={i.gameDir}>
                  <FolderOpen size={13} />
                  {i.gameDir === selectedFolder?.path ? '共享游戏目录' : '独立运行目录'}
                </small>
              )}
              {i.error && <small className="inline-error">{i.error}</small>}
              {view === 'list' && i.organization?.notes && (
                <p className="library-note">{i.organization.notes}</p>
              )}
              <div className="card-bottom">
                <span>
                  {state.running.includes(i.id)
                    ? '运行中'
                    : i.status !== 'ready'
                      ? statusLabel[i.status]
                      : null}
                </span>
                <button
                  className="text-button"
                  onClick={() =>
                    void run(() => api.select({ instanceId: i.id }), '已选择 ' + i.name)
                  }
                >
                  {state.selectedInstanceId === i.id ? '当前实例' : '选择'}
                  <ArrowRight size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
        {!items.length && <Empty title="没有符合条件的实例" />}
      </section>
      {scan && <ImportDialog scan={scan} run={run} onClose={() => setScan(undefined)} />}
      {editing && (
        <Organize
          key={editing.id}
          instance={editing}
          run={run}
          groups={groups}
          close={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}
function Organize({
  instance,
  run,
  groups,
  close,
}: {
  instance: Instance;
  run: Run;
  groups: string[];
  close: () => void;
}) {
  const [value, setValue] = useState({ ...blank, ...instance.organization }),
    [tags, setTags] = useState(instance.organization?.tags.join(', ') ?? ''),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title={'整理 ' + instance.name}
      onClose={() => {
        if (!busy) close();
      }}
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void run(async () => {
            await api.organizeInstance({
              id: instance.id,
              organization: {
                ...value,
                tags: [
                  ...new Set(
                    tags
                      .split(/[,，]/)
                      .map((t) => t.trim())
                      .filter(Boolean),
                  ),
                ],
              },
            });
            close();
          }, '实例信息已保存').finally(() => setBusy(false));
        }}
      >
        <Field label="分组">
          <input
            aria-label="分组名称"
            list="library-groups"
            maxLength={40}
            value={value.group}
            onChange={(e) => setValue({ ...value, group: e.target.value })}
          />
          <datalist id="library-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Field>
        <Field label="标签（逗号分隔，最多 12 个）">
          <input aria-label="实例标签" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <Field label="备注">
          <textarea
            aria-label="实例备注"
            rows={4}
            maxLength={2000}
            value={value.notes}
            onChange={(e) => setValue({ ...value, notes: e.target.value })}
          />
        </Field>
        <label>
          <input
            type="checkbox"
            checked={value.favorite}
            onChange={(e) => setValue({ ...value, favorite: e.target.checked })}
          />{' '}
          收藏置顶
        </label>
        <button className="primary" disabled={busy}>
          保存整理
        </button>
      </form>
    </Modal>
  );
}
