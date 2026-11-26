import { matchesSearch } from '../../shared/search';
import { useState } from 'react';
import type { ContentFavorite, ContentKind, ContentSource, Snapshot } from '../../shared/types';
import { Modal, Empty } from '../components';
import { Select } from '../Select';
import { api } from '../api';
import type { Run } from '../ui';
import { ContentVersions, FavoriteButton, contentLabels } from './ContentBrowser';

export function Favorites({
  state,
  run,
  onClose,
}: {
  state: Snapshot;
  run: Run;
  onClose: () => void;
}) {
  const [source, setSource] = useState<ContentSource | ''>(''),
    [kind, setKind] = useState<ContentKind | ''>(''),
    [group, setGroup] = useState('');
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState<ContentFavorite>();
  const [editing, setEditing] = useState<ContentFavorite>(),
    [name, setName] = useState(''),
    [saving, setSaving] = useState(false);
  const [offset, setOffset] = useState(0);
  const favorites = state.favorites ?? [];
  const groups = [...new Set(favorites.map((f) => f.group).filter(Boolean))].sort();
  const items = favorites
    .filter(
      (f) =>
        (!source || f.source === source) &&
        (!kind || f.kind === kind) &&
        (!group || (group === 'ungrouped' ? !f.group : 'group:' + f.group === group)) &&
        matchesSearch(query, f.title, f.description, f.author, f.group, f.projectId),
    )
    .sort((a, b) => b.savedAt - a.savedAt);
  const currentOffset = Math.min(offset, Math.max(0, Math.ceil(items.length / 20) - 1) * 20);
  return (
    <>
      {!selected && !editing && (
        <Modal wide title="收藏" onClose={onClose}>
          <div className="resource-searchbar">
            <input
              aria-label="搜索收藏"
              placeholder="搜索收藏"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
              }}
            />
            <Select
              aria-label="收藏来源"
              value={source}
              onChange={(e) => {
                setSource(e.target.value as typeof source);
                setOffset(0);
              }}
            >
              <option value="">全部来源</option>
              <option value="modrinth">Modrinth</option>
              <option value="curseforge">CurseForge</option>
            </Select>
            <Select
              aria-label="收藏类别"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as typeof kind);
                setOffset(0);
              }}
            >
              <option value="">全部类别</option>
              {Object.entries(contentLabels).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="收藏分组"
              value={group}
              onChange={(e) => {
                setGroup(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">全部分组</option>
              <option value="ungrouped">未分组</option>
              {groups.map((g) => (
                <option value={'group:' + g} key={g}>
                  {g}
                </option>
              ))}
            </Select>
          </div>
          {!items.length ? (
            <Empty title={favorites.length ? '没有匹配的收藏' : '暂无收藏'} />
          ) : (
            <div className="mod-list panel">
              {items.slice(currentOffset, currentOffset + 20).map((f) => (
                <article className="mod-row" key={`${f.source}:${f.kind}:${f.projectId}`}>
                  <div className="grow">
                    <strong>{f.title}</strong>
                    <p>{f.description}</p>
                    <small>
                      {contentLabels[f.kind]} ·{' '}
                      {f.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}
                      {f.group && ` · ${f.group}`}
                    </small>
                  </div>
                  <FavoriteButton
                    project={{ source: f.source, kind: f.kind, projectId: f.projectId }}
                    state={state}
                    run={run}
                  />
                  <button
                    onClick={() => {
                      setEditing(f);
                      setName(f.group);
                    }}
                  >
                    分组
                  </button>
                  <button
                    disabled={f.kind !== 'modpack' && !state.selectedInstanceId}
                    onClick={() => setSelected(f)}
                  >
                    选择版本
                  </button>
                </article>
              ))}
            </div>
          )}
          {items.length > 20 && (
            <div className="pagination">
              <button disabled={!currentOffset} onClick={() => setOffset(currentOffset - 20)}>
                上一页
              </button>
              <span>
                {currentOffset + 1}–{Math.min(currentOffset + 20, items.length)} / {items.length}
              </span>
              <button
                disabled={currentOffset + 20 >= items.length}
                onClick={() => setOffset(currentOffset + 20)}
              >
                下一页
              </button>
            </div>
          )}
        </Modal>
      )}
      {selected && (
        <ContentVersions
          key={state.selectedInstanceId + selected.source + selected.projectId}
          project={selected}
          state={state}
          run={run}
          onClose={() => setSelected(undefined)}
        />
      )}
      {editing && (
        <Modal title="收藏分组" onClose={() => setEditing(undefined)}>
          <label className="field content-dialog-field">
            分组
            <input
              aria-label="收藏分组名称"
              maxLength={40}
              value={name}
              placeholder="未分组"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="modal-footer">
            <button onClick={() => setEditing(undefined)}>取消</button>
            <button
              className="primary"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                const ok = await run(async () => {
                  await api.saveFavorite({
                    source: editing.source,
                    kind: editing.kind,
                    projectId: editing.projectId,
                    group: name.trim(),
                  });
                  return true;
                });
                setSaving(false);
                if (ok) {
                  setEditing(undefined);
                  setGroup('');
                  setOffset(0);
                }
              }}
            >
              保存
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
