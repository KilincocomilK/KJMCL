import type { ReactNode } from 'react';
import './split-view.css';

export function SplitView({
  railLabel,
  rail,
  children,
  className = '',
}: {
  railLabel: string;
  rail: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={'pane-layout ' + className}>
      <aside aria-label={railLabel} className="pane-rail">
        {rail}
      </aside>
      <div className="pane-content">{children}</div>
    </div>
  );
}
