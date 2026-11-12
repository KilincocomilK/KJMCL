import { useEffect, useRef, type ReactNode } from 'react';
import { X, Box } from 'lucide-react';
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
    ref.current?.querySelector<HTMLElement>('input,select,button')?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
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
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">
        <Box size={30} strokeWidth={1} />
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
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={'brand-mark ' + (small ? 'small' : '')}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path d="M7 7h8v11L26 7h10L23 20l13 13H25L15 23v10H7Z" fill="currentColor" />
        <path d="M28 7h8v8" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    </span>
  );
}
export function Terrain() {
  return (
    <svg
      className="terrain"
      viewBox="0 0 900 440"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sky" x2="0" y2="1">
          <stop stopColor="#202b2d" />
          <stop offset="1" stopColor="#595447" />
        </linearGradient>
        <linearGradient id="mist" x2="0" y2="1">
          <stop stopColor="#c99d66" stopOpacity="0" />
          <stop offset="1" stopColor="#d4a163" stopOpacity=".28" />
        </linearGradient>
        <linearGradient id="shade">
          <stop stopColor="#111310" />
          <stop offset="1" stopColor="#111310" stopOpacity="0" />
        </linearGradient>
        <pattern id="grain" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" fill="#fff" opacity=".025" />
        </pattern>
      </defs>
      <rect width="900" height="440" fill="url(#sky)" />
      <rect x="641" y="64" width="58" height="58" fill="#dcb575" opacity=".8" />
      <path
        d="M0 232h110v-34h60v-32h49v27h55v-49h66v36h47v32h71v-42h55v-35h50v25h46v35h59v-17h65v49h117v213H0Z"
        fill="#53605a"
      />
      <path
        d="M0 283h89v-58h48v-32h32v44h42v38h72v-35h61v-48h53v-27h35v74h75v-20h46v50h66v-42h46v-44h41v42h45v40h107v-23h42v198H0Z"
        fill="#334442"
      />
      <path
        d="M0 332h122v-37h90v17h73v-48h53v-29h66v62h63v36h58v-20h58v-47h75v-35h62v61h58v40h122v108H0Z"
        fill="#233632"
      />
      <rect y="272" width="900" height="168" fill="url(#mist)" />
      <path d="m405 440 139-95h81l-119 95" fill="#b08a5a" opacity=".6" />
      <path d="m552 344 69-48h29l-44 48" fill="#a28c68" opacity=".6" />
      <g fill="#162b24">
        <path d="M760 194h17v-38h16v-38h20v38h16v38h17v47h-86z" />
        <rect x="797" y="224" width="13" height="104" />
        <path d="M682 237h13v-27h12v-31h16v31h12v27h13v31h-66z" />
        <rect x="711" y="260" width="9" height="58" />
        <path d="M842 261h14v-35h16v-30h18v30h10v91h-58z" />
      </g>
      <g fill="#12201b">
        <path d="M46 220h22v-49h19v-58h24v58h21v49h25v63H46z" />
        <rect x="94" y="272" width="15" height="144" />
        <path d="M177 286h17v-43h19v-49h22v49h18v43h18v58h-94z" />
        <rect x="218" y="328" width="13" height="92" />
      </g>
      <path
        d="M0 392h117v-25h87v37h91v-13h103v49H0zm623 48v-39h67v-25h67v-21h62v34h81v51"
        fill="#121e19"
      />
      <rect width="900" height="440" fill="url(#grain)" />
      <rect width="650" height="440" fill="url(#shade)" />
    </svg>
  );
}

import type { Snapshot } from '../shared/types';
import type { Run } from './ui';
import { api } from './api';
export function InstanceSelect({ state, run }: { state: Snapshot; run: Run }) {
  return (
    <select
      className="instance-select"
      aria-label="选择实例"
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
    </select>
  );
}
