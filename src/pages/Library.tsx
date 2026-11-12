import { useState } from 'react';
import { ArrowRight, Box, Star, List, LayoutGrid, MoreHorizontal, Tag } from 'lucide-react';
import type { Instance, InstanceOrganization, Snapshot } from '../../shared/types';
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
        <span>{state.running.includes(i.id) ? '运行中' : statusLabel[i.status]}</span>
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
  const groups = [
    ...new Set(state.instances.map((i) => i.organization?.group).filter(Boolean)),
  ] as string[];
  const items = state.instances
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
    <>
      <div className="toolbar library-filters">
        <input
          aria-label="搜索实例"
          placeholder="名称、标签、版本…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select aria-label="实例分组" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">全部分组</option>
          {groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <select aria-label="实例排序" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recent">最近游玩</option>
          <option value="name">名称</option>
          <option value="time">游玩时长</option>
          <option value="created">创建时间</option>
        </select>
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
        <span>{state.instances.length} 个实例</span>
        <span>
          累计 {Math.floor(state.instances.reduce((n, i) => n + i.playTime, 0) / 3600000)} 小时
        </span>
        <span>收藏 {state.instances.filter((i) => i.organization?.favorite).length} 个</span>
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
            {view === 'list' && i.organization?.notes && (
              <p className="library-note">{i.organization.notes}</p>
            )}
            <div className="card-bottom">
              <span>{state.running.includes(i.id) ? '运行中' : statusLabel[i.status]}</span>
              <button
                className="text-button"
                onClick={() => void run(() => api.select({ instanceId: i.id }), '已选择 ' + i.name)}
              >
                {state.selectedInstanceId === i.id ? '当前实例' : '选择'}
                <ArrowRight size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!items.length && <Empty title="没有符合条件的实例" />}
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
