import { matchesSearch } from '../../shared/search';
import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  FolderOpen,
  List,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Star,
  Tag,
  Upload,
  X,
} from 'lucide-react';
import type { Instance, InstanceOrganization, Snapshot } from '../../shared/types';
import { api } from '../api';
import { Modal, Empty, Field } from '../components';
import { ItemArt } from '../components/ItemArt';
import { SplitView } from '../components/SplitView';
import { Select } from '../Select';
import { type Run, loaderLabel, statusLabel, date } from '../ui';
import '../game-folders.css';

const blank: InstanceOrganization = { favorite: false, group: '', tags: [], notes: '' };
export function LibraryPage({
  state,
  run,
  onEdit,
  onCreate,
  onHome,
  pickingFolder,
  onPickFolder,
}: {
  state: Snapshot;
  run: Run;
  onEdit: (i: Instance) => void;
  onCreate: () => void;
  onHome: () => void;
  pickingFolder: boolean;
  onPickFolder: () => void;
}) {
  const [query, setQuery] = useState(''),
    [group, setGroup] = useState(''),
    [favorites, setFavorites] = useState(false),
    [compact, setCompact] = useState(false),
    [filterOpen, setFilterOpen] = useState(false),
    [sort, setSort] = useState('recent'),
    [editing, setEditing] = useState<Instance>();
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
        matchesSearch(
          query,
          i.name,
          i.version,
          i.loader,
          i.organization?.group,
          i.organization?.notes,
          ...(i.organization?.tags ?? []),
        ),
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
  const current = items.find((i) => i.id === state.selectedInstanceId) ?? items[0];
  const filtered = !!(query || group || favorites);
  const clearFilters = () => {
    setQuery('');
    setGroup('');
    setFavorites(false);
  };
  return (
    <>
      <SplitView
        className="game-library"
        railLabel="游戏版本"
        rail={
          <>
            <div className="pane-heading">
              <h2>{selectedFolder?.name ?? '游戏版本'}</h2>
              <button className="icon" aria-label="新建实例" title="新建实例" onClick={onCreate}>
                <Plus size={18} />
              </button>
            </div>
            <div className="rail-search">
              <label className="search-input">
                <Search size={15} />
                <input
                  aria-label="搜索实例"
                  placeholder="搜索版本"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <button
                className="icon"
                aria-label="筛选实例"
                title="筛选实例"
                aria-expanded={filterOpen}
                aria-controls="version-filters"
                onClick={() => setFilterOpen(!filterOpen)}
              >
                <SlidersHorizontal size={16} />
              </button>
            </div>
            <div id="version-filters" className="rail-filters" hidden={!filterOpen}>
              <Select
                aria-label="实例分组"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
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
              <div className="rail-filter-actions">
                <button aria-pressed={favorites} onClick={() => setFavorites(!favorites)}>
                  <Star size={14} />
                  只看收藏
                </button>
                <button
                  aria-label="切换实例视图"
                  title="紧凑列表"
                  aria-pressed={compact}
                  onClick={() => setCompact(!compact)}
                >
                  <List size={16} />
                </button>
              </div>
            </div>
            <div className={'rail-list' + (compact ? ' compact' : '')}>
              {items.map((i) => (
                <button
                  key={i.id}
                  className="rail-option"
                  aria-label={i.name}
                  aria-pressed={i.id === current?.id}
                  onClick={() => void run(() => api.select({ instanceId: i.id }))}
                >
                  <ItemArt name={i.loader === 'vanilla' ? 'block' : 'pickaxe'} size={32} />
                  <span>
                    <strong>{i.name}</strong>
                    {!compact && (
                      <small>
                        {i.version} · {loaderLabel[i.loader]}
                      </small>
                    )}
                  </span>
                  {i.organization?.favorite && <Star size={12} className="favorite-star" />}
                </button>
              ))}
              {!items.length && (
                <p className="rail-empty">{filtered ? '没有匹配的版本' : '暂无版本'}</p>
              )}
            </div>
            <div className="rail-footer">
              <Select
                aria-label="游戏文件夹"
                value={selectedFolder?.id ?? 'managed'}
                onChange={(e) => {
                  clearFilters();
                  void run(() => api.select({ folderId: e.target.value }));
                }}
              >
                <option value="managed">KJMCL 实例</option>
                {state.gameFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </Select>
              <div className="rail-folder-actions">
                <button className="text-button" disabled={pickingFolder} onClick={onPickFolder}>
                  <FolderOpen size={15} />
                  添加游戏文件夹
                </button>
                {selectedFolder && (
                  <>
                    <button
                      className="icon"
                      aria-label="刷新版本"
                      title="刷新版本"
                      onClick={() =>
                        void run(() => api.refreshGameFolder(selectedFolder.id), '已刷新游戏文件夹')
                      }
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      className="icon"
                      aria-label={'移除文件夹索引 ' + selectedFolder.name}
                      title="移除文件夹索引"
                      onClick={() => void run(() => api.removeGameFolder(selectedFolder.id))}
                    >
                      <X size={15} />
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        }
      >
        <div className="detail-toolbar">
          {selectedFolder && (
            <span className="folder-path" title={selectedFolder.path}>
              {selectedFolder.path}
            </span>
          )}
          <button onClick={() => void run(() => api.importPack())}>
            <Upload size={15} />
            导入整合包
          </button>
        </div>
        {selectedFolder?.error && (
          <p className="inline-error" role="alert">
            文件夹暂不可用：{selectedFolder.error}
          </p>
        )}
        {current ? (
          <section key={current.id} className="version-detail">
            <div className="version-cover">
              <div className="version-emblem">
                <ItemArt name={current.loader === 'vanilla' ? 'block' : 'pickaxe'} size={64} />
              </div>
              <div>
                <h2>{current.name}</h2>
                <p>
                  {current.version} · {loaderLabel[current.loader]} {current.loaderVersion}
                </p>
              </div>
              <button
                className="icon"
                title="收藏"
                aria-label={'收藏 ' + current.name}
                aria-pressed={!!current.organization?.favorite}
                onClick={() =>
                  void run(() =>
                    api.organizeInstance({
                      id: current.id,
                      organization: {
                        ...blank,
                        ...current.organization,
                        favorite: !current.organization?.favorite,
                      },
                    }),
                  )
                }
              >
                <Star size={19} fill={current.organization?.favorite ? 'currentColor' : 'none'} />
              </button>
            </div>
            <div className="version-actions">
              <button
                className="primary"
                onClick={() => {
                  if (state.selectedInstanceId === current.id) onHome();
                  else
                    void run(async () => {
                      await api.select({ instanceId: current.id });
                      onHome();
                    });
                }}
              >
                前往启动 <ArrowRight size={16} />
              </button>
              <button aria-label={current.name + ' 设置'} onClick={() => onEdit(current)}>
                <Settings2 size={16} />
                实例设置
              </button>
              <button
                title="分组与备注"
                aria-label={current.name + ' 分组与备注'}
                onClick={() => setEditing(current)}
              >
                <Tag size={15} />
                整理
              </button>
            </div>
            {current.error && (
              <p role="alert" className="inline-error">
                {current.error}
              </p>
            )}
            <dl className="version-facts">
              <div>
                <dt>状态</dt>
                <dd>
                  {state.running.includes(current.id) ? '运行中' : statusLabel[current.status]}
                </dd>
              </div>
              <div>
                <dt>最近启动</dt>
                <dd>{date(current.lastPlayed)}</dd>
              </div>
              <div>
                <dt>游玩时长</dt>
                <dd>{Math.floor(current.playTime / 60000)} 分钟</dd>
              </div>
              {current.organization?.group && (
                <div>
                  <dt>分组</dt>
                  <dd>{current.organization.group}</dd>
                </div>
              )}
              {!!current.organization?.tags.length && (
                <div>
                  <dt>标签</dt>
                  <dd>{current.organization.tags.join(' · ')}</dd>
                </div>
              )}
              {current.organization?.notes && (
                <div>
                  <dt>备注</dt>
                  <dd>{current.organization.notes}</dd>
                </div>
              )}
            </dl>
            {current.external && (
              <details className="minor-details">
                <summary>游戏目录</summary>
                <p>
                  {current.gameDir === selectedFolder?.path ? '共享游戏目录' : '独立运行目录'} ·{' '}
                  {current.gameDir}
                </p>
              </details>
            )}
          </section>
        ) : (
          <Empty
            art={filtered ? 'map' : 'block'}
            title={filtered ? '没有符合条件的实例' : '还没有游戏实例'}
            action={
              <button className="primary" onClick={filtered ? clearFilters : onCreate}>
                {filtered ? '清除筛选' : '创建游戏实例'}
              </button>
            }
          />
        )}
      </SplitView>
      {editing && (
        <Organize
          key={editing.id}
          instance={editing}
          run={run}
          groups={groups}
          close={() => setEditing(undefined)}
        />
      )}
    </>
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
        <GroupField
          groups={groups}
          value={value.group}
          onChange={(group) => setValue({ ...value, group })}
        />
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

function GroupField({
  groups,
  value,
  onChange,
}: {
  groups: string[];
  value: string;
  onChange: (group: string) => void;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = groups.includes(value)
    ? groups
    : groups.filter((group) => matchesSearch(value, group));
  const expanded = open && matches.length > 0;
  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const choose = (group: string) => {
    onChange(group);
    close();
  };
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <div className="field">
      <label htmlFor={id}>分组</label>
      <div className="group-combobox">
        <input
          id={id}
          role="combobox"
          aria-label="分组名称"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? id + '-groups' : undefined}
          aria-activedescendant={expanded && active >= 0 ? id + '-' + active : undefined}
          autoComplete="off"
          maxLength={40}
          value={value}
          onClick={() => setOpen(true)}
          onBlur={close}
          onChange={(event) => {
            onChange(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (matches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault();
              setOpen(true);
              setActive(
                event.key === 'ArrowDown'
                  ? (active + 1) % matches.length
                  : (active <= 0 ? matches.length : active) - 1,
              );
            } else if (expanded && event.key === 'Enter' && active >= 0) {
              event.preventDefault();
              choose(matches[active]);
            } else if (expanded && event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
        />
        {groups.length > 0 && <ChevronDown size={15} aria-hidden="true" />}
        {expanded && (
          <div
            id={id + '-groups'}
            ref={list}
            role="listbox"
            aria-label="已有分组"
            className="launcher-select-menu"
          >
            {matches.map((group, index) => (
              <div
                id={id + '-' + index}
                key={group}
                role="option"
                aria-selected={group === value}
                className={'launcher-select-option' + (index === active ? ' highlighted' : '')}
                onPointerMove={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(group)}
              >
                <span>{group}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
