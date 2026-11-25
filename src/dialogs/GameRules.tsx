import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import catalog from '../../shared/game-rules.json';
import { matchesSearch } from '../../shared/search';
import type { WorldRef } from '../../shared/types';
import type { Run } from '../ui';
import { api } from '../api';
import { Modal } from '../components';

export function GameRules({
  id,
  world,
  rules,
  error,
  locked,
  run,
  onClose,
  onSaved,
}: WorldRef & {
  rules: Record<string, string>;
  error?: string | null;
  locked: boolean;
  run: Run;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState({ ...rules }),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false);
  const entries = useMemo(
    () =>
      Object.entries(rules)
        .map(([key, value]) => {
          const rank = catalog.findIndex((s) => s.legacy === key || s.modern === key),
            spec = catalog[rank];
          return { key, value, spec, rank: rank < 0 ? Infinity : rank };
        })
        .sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key)),
    [rules],
  );
  const changes = entries
    .filter((row) => values[row.key] !== row.value)
    .map((row) => ({ key: row.key, before: row.value, value: values[row.key] }));
  const invalid = entries.some(
    ({ key, value, spec }) =>
      values[key] !== value &&
      /^-?\d+$/.test(value) &&
      (!/^-?\d+$/.test(values[key]) ||
        +values[key] < (spec ? (spec.min ?? 0) : -2147483648) ||
        +values[key] > (spec?.max ?? 2147483647)),
  );
  return (
    <Modal
      wide
      title="游戏规则"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="form-body">
        <label className="search-input rule-search">
          <Search size={15} />
          <input
            aria-label="搜索游戏规则"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索规则"
          />
        </label>
        <div className="world-rule-list">
          {entries
            .filter(({ key, spec }) => matchesSearch(query, key, spec?.name, spec?.description))
            .map(({ key, value, spec }) => {
              const title = spec?.name ?? key,
                boolean = value === 'true' || value === 'false',
                numeric = /^-?\d+$/.test(value);
              return (
                <div className="world-rule" key={key}>
                  <div>
                    <strong title={key}>{title}</strong>
                    {spec && <small>{spec.description}</small>}
                  </div>
                  {boolean ? (
                    <button
                      type="button"
                      role="switch"
                      aria-label={title}
                      aria-checked={values[key] === 'true'}
                      disabled={locked || busy}
                      onClick={() =>
                        setValues((v) => ({ ...v, [key]: v[key] === 'true' ? 'false' : 'true' }))
                      }
                    >
                      {values[key] === 'true' ? '开启' : '关闭'}
                    </button>
                  ) : (
                    <input
                      aria-label={title}
                      type={numeric ? 'number' : 'text'}
                      step={numeric ? 1 : undefined}
                      min={numeric && spec ? (spec.min ?? 0) : undefined}
                      max={numeric ? spec?.max : undefined}
                      maxLength={128}
                      disabled={locked || busy}
                      value={values[key]}
                      onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                    />
                  )}
                </div>
              );
            })}
          {!entries.some(({ key, spec }) =>
            matchesSearch(query, key, spec?.name, spec?.description),
          ) && (
            <p className="muted">
              {error ?? (entries.length ? '没有匹配的规则' : '此世界没有可编辑的规则')}
            </p>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <button disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="primary"
          disabled={busy || locked || !changes.length || invalid}
          onClick={async () => {
            setBusy(true);
            const ok = await run(() => api.editGameRules({ id, world, changes }));
            setBusy(false);
            if (ok) onSaved();
          }}
        >
          审阅更改{changes.length ? '（' + changes.length + '）' : ''}
        </button>
      </div>
    </Modal>
  );
}
