import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { ItemArt, type ItemName } from './ItemArt';

export function SettingGroup({
  title,
  art,
  children,
  className = '',
  open,
}: {
  title: string;
  art: ItemName;
  children: ReactNode;
  className?: string;
  open?: boolean;
}) {
  return (
    <details className={'setting-group panel ' + className} open={open}>
      <summary>
        <ItemArt name={art} size={28} />
        <h2>{title}</h2>
        <ChevronDown className="disclosure-arrow" size={16} />
      </summary>
      <div className="setting-body">{children}</div>
    </details>
  );
}
