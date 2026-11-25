import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ItemArt, type ItemName } from './components/ItemArt';
import { Select } from './Select';
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current
      ?.querySelector<HTMLElement>(
        'input:not([aria-hidden="true"]),select:not([aria-hidden="true"]),button',
      )
      ?.focus();
    const handle = (event: KeyboardEvent) => {
      const dialogs = Array.from(document.querySelectorAll('[aria-modal="true"]')).filter(
        (dialog) => dialog.getClientRects().length,
      );
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled):not([aria-hidden="true"]),select:not(:disabled):not([aria-hidden="true"]),textarea:not(:disabled),[tabindex="0"]',
          ) ?? [],
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('keydown', handle);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={'modal ' + (wide ? 'wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon" aria-label="关闭" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
  art = 'chest',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  art?: ItemName;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">
        <ItemArt name={art} size={64} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Switch({
  label,
  checked,
  onChange,
  disabled,
  showLabel = false,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  showLabel?: boolean;
}) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
    >
      {showLabel && <span>{label}</span>}
      <span className="switch-track" aria-hidden="true" />
    </button>
  );
}
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={'brand-mark ' + (small ? 'small' : '')}>
      <svg viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
        <path
          fill="currentColor"
          d="M2 2h3v5h2V5h2V3h2V2h4v2h-2v2h-2v2H9v1h2v2h2v2h2v2h-4v-2H9v-2H7V9H5v6H2z"
        />
      </svg>
    </span>
  );
}
import type { Snapshot } from '../shared/types';
import type { Run } from './ui';
import { api } from './api';
export function InstanceSelect({ state, run }: { state: Snapshot; run: Run }) {
  return (
    <Select
      className="instance-select"
      aria-label="选择实例"
      disabled={!state.instances.length}
      value={state.selectedInstanceId ?? ''}
      onChange={(e) => void run(() => api.select({ instanceId: e.target.value }))}
    >
      <option disabled value="">
        选择游戏实例
      </option>
      {state.instances.map((i) => (
        <option value={i.id} key={i.id}>
          {i.name} · {i.version}
        </option>
      ))}
    </Select>
  );
}
