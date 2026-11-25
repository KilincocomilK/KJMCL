import { ArrowRight, Check, CornerUpLeft, ListChecks, X } from 'lucide-react';
import type { AiChange } from '../../shared/assistant';
import { changeLabels, settingText } from '../../shared/assistant-display';
import { api } from '../api';
import { Feedback, useAction } from './controls';
export function Changes({ changes }: { changes: AiChange[] }) {
  const { act, busy, feedback } = useAction();
  if (!changes.length) return null;
  const pending = changes.filter((p) => p.status === 'pending');
  const done = changes.filter((p) => p.status !== 'pending');
  const row = (p: AiChange) => (
    <article key={p.id} className={'ai-change ' + p.status}>
      <div className="ai-line">
        <strong>
          <ListChecks size={15} />
          {p.target}
        </strong>
        <small>{changeLabels[p.status]}</small>
      </div>
      <dl>
        {p.fields.map((f) => (
          <div key={f.key}>
            <dt>{f.label}</dt>
            <dd>
              {settingText(f.before)} <ArrowRight size={12} /> <b>{settingText(f.after)}</b>
            </dd>
          </div>
        ))}
      </dl>
      {p.status === 'pending' && (
        <div className="ai-actions">
          <button
            className="primary"
            disabled={!!busy}
            onClick={() => void act('apply', () => api.aiDecide({ id: p.id, decision: 'apply' }))}
          >
            <Check size={14} />
            应用修改
          </button>
          <button
            disabled={!!busy}
            onClick={() => void act('reject', () => api.aiDecide({ id: p.id, decision: 'reject' }))}
          >
            <X size={14} />
            拒绝
          </button>
        </div>
      )}
      {p.status === 'applied' && (
        <button
          className="text-button"
          disabled={!!busy}
          onClick={() => void act('undo', () => api.aiDecide({ id: p.id, decision: 'undo' }))}
        >
          <CornerUpLeft size={14} />
          撤销修改
        </button>
      )}
    </article>
  );
  return (
    <section className="ai-changes" aria-label="配置修改">
      {pending.map(row)}
      {done.length > 0 && (
        <details>
          <summary>本次修改记录 · {done.length}</summary>
          {done.map(row)}
        </details>
      )}
      <Feedback feedback={feedback} />
    </section>
  );
}
