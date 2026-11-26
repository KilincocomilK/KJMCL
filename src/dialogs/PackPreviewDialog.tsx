import { useState } from 'react';
import type { PackPreview } from '../../shared/pack';
import type { Snapshot } from '../../shared/types';
import { api } from '../api';
import { Field, Modal } from '../components';
import { Select } from '../Select';
import { type Run, loaderLabel } from '../ui';

export function PackPreviewDialog({
  preview,
  state,
  run,
  onClose,
  initialTrialSourceId,
}: {
  preview: PackPreview;
  state: Snapshot;
  run: Run;
  onClose: () => void;
  initialTrialSourceId?: string;
}) {
  const [optional, setOptional] = useState<Set<string>>(new Set());
  const [trial, setTrial] = useState(initialTrialSourceId ?? '');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(80);
  const blocked = preview.items.some((i) => i.kind === 'blocked');
  const summary = { required: '必需', optional: '可选', skipped: '跳过', blocked: '无法安装' };
  const close = () => {
    if (!busy) {
      void run(() => api.discardPack(preview.token));
      onClose();
    }
  };
  return (
    <Modal title="预览整合包" onClose={close} wide>
      <div className="form-body">
        <strong>{preview.name}</strong>
        <span>
          {preview.format} · Minecraft {preview.version} · {loaderLabel[preview.loader]}{' '}
          {preview.loaderVersion}
        </span>
        <input
          type="search"
          aria-label="筛选包内文件"
          placeholder="筛选包内文件"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(80);
          }}
        />
        {(Object.keys(summary) as (keyof typeof summary)[]).map((kind) => {
          const items = preview.items.filter((i) => i.kind === kind);
          const filtered = items.filter((i) =>
            (i.label + ' ' + (i.reason || '')).toLowerCase().includes(query.toLowerCase()),
          );
          if (!items.length) return null;
          return (
            <details
              key={kind}
              open={kind === 'blocked' || kind === 'optional' || !!query || undefined}
            >
              <summary>
                {summary[kind]} · {items.length}
              </summary>
              <div style={{ maxHeight: 208, overflowY: 'auto' }}>
                {filtered.slice(0, limit).map((i) => (
                  <div key={i.key} style={{ overflowWrap: 'anywhere' }}>
                    {kind === 'optional' ? (
                      <label>
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={optional.has(i.key)}
                          onChange={(e) => {
                            const next = new Set(optional);
                            if (e.target.checked) next.add(i.key);
                            else next.delete(i.key);
                            setOptional(next);
                          }}
                        />{' '}
                        {i.label}
                      </label>
                    ) : (
                      i.label
                    )}
                    {i.reason && <small> · {i.reason}</small>}
                  </div>
                ))}
                {filtered.length > limit && (
                  <button onClick={() => setLimit(limit + 80)}>显示更多</button>
                )}
              </div>
            </details>
          );
        })}
        <details open={!!initialTrialSourceId || undefined}>
          <summary>用已有存档试更</summary>
          <Field label="存档来源">
            <Select value={trial} onChange={(e) => setTrial(e.target.value)} disabled={busy}>
              <option value="">使用整合包默认存档</option>
              {state.instances
                .filter((i) => i.status === 'ready' && !state.running.includes(i.id))
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </Select>
          </Field>
          {trial && <small>先备份原实例存档，再恢复到新实例。同名的包内存档将分别保留。</small>}
        </details>
        {blocked && <p role="alert">有必需文件无法安装，请检查清单。</p>}
      </div>
      <div className="modal-footer">
        <button disabled={busy} onClick={close}>
          取消
        </button>
        <button
          className="primary"
          disabled={busy || blocked}
          onClick={async () => {
            setBusy(true);
            const id = await run(() =>
              api.confirmPack({
                token: preview.token,
                optional: [...optional],
                trialSourceId: trial || undefined,
              }),
            );
            setBusy(false);
            if (id) onClose();
          }}
        >
          {busy ? '正在准备…' : trial ? '创建试更副本' : '创建实例并安装'}
        </button>
      </div>
    </Modal>
  );
}
