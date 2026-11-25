import { Fragment, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import type { SidebarEntry } from '../../shared/navigation';
import { Brand } from '../components';
import { ItemArt, type ItemName } from './ItemArt';

export const navigation = {
  home: { label: '开始游戏', icon: 'block' },
  instances: { label: '游戏实例', icon: 'versions' },
  resources: { label: '资源管理', icon: 'chest' },
  toolbox: { label: '工具箱', icon: 'pickaxe' },
  assistant: { label: 'AI 助手', icon: 'robot' },
  saves: { label: '存档管理', icon: 'book' },
  multiplayer: { label: '陶瓦联机', icon: 'globe' },
  diagnostics: { label: '诊断与维护', icon: 'dust' },
  downloads: { label: '下载任务', icon: 'hopper' },
  settings: { label: '启动器设置', icon: 'gear' },
  accounts: { label: '账户管理', icon: 'face' },
} satisfies Record<string, { label: string; icon: ItemName }>;
export type Page = keyof typeof navigation;

type Edge = 'before' | 'after';

function dropEdge(event: DragEvent<HTMLButtonElement>): Edge {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
}

export function Sidebar({
  page,
  order,
  onReorder,
  onNavigate,
  downloads,
  assistantPending,
  hasUpdate,
  accountName,
}: {
  page: Page;
  order: readonly SidebarEntry[];
  onReorder: (order: SidebarEntry[]) => void;
  onNavigate: (page: Page) => void;
  downloads: number;
  assistantPending: number;
  hasUpdate: boolean;
  accountName?: string;
}) {
  const sidebar = useRef<HTMLElement>(null);
  const source = useRef<SidebarEntry | null>(null);
  const focusAfterMove = useRef<SidebarEntry | null>(null);
  const [marker, setMarker] = useState<{ key: SidebarEntry; edge: Edge }>();
  useLayoutEffect(() => {
    if (focusAfterMove.current) {
      sidebar.current
        ?.querySelector<HTMLButtonElement>(`[data-entry="${focusAfterMove.current}"]`)
        ?.focus();
      focusAfterMove.current = null;
    }
  }, [order]);
  function move(from: SidebarEntry, target: SidebarEntry, edge: Edge) {
    if (from === target) return;
    const next = order.filter((key) => key !== from);
    next.splice(next.indexOf(target) + (edge === 'after' ? 1 : 0), 0, from);
    if (next.indexOf(from) !== order.indexOf(from)) onReorder(next);
  }
  function endDrag() {
    source.current = null;
    setMarker(undefined);
  }
  const details: Partial<Record<Page, string>> = {
    assistant: assistantPending ? assistantPending + ' 项修改待确认' : undefined,
    downloads: downloads ? downloads + ' 项进行中' : undefined,
    settings: hasUpdate ? '有可用更新' : undefined,
    accounts: accountName,
  };
  function entry(key: Page) {
    const { label, icon } = navigation[key];
    const hintId = 'nav-hint-' + key;
    const detail = details[key];
    const movable = key !== 'home' && key !== 'settings' && key !== 'accounts';
    return (
      <Fragment key={key}>
        <button
          type="button"
          className={'nav-item' + (page === key ? ' active' : '')}
          data-entry={key}
          data-insert={marker?.key === key ? marker.edge : undefined}
          draggable={movable}
          aria-keyshortcuts={movable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
          onDragStart={(e) => {
            if (!movable) return e.preventDefault();
            source.current = key;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('application/x-kjmcl-sidebar', key);
            document.getElementById(hintId)?.hidePopover();
          }}
          onDragOver={(e) => {
            if (!source.current || !movable) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            const edge = dropEdge(e);
            if (key === source.current) setMarker(undefined);
            else if (marker?.key !== key || marker.edge !== edge) setMarker({ key, edge });
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setMarker((old) => (old?.key === key ? undefined : old));
            }
          }}
          onDrop={(e) => {
            if (!source.current || !movable) return;
            e.preventDefault();
            e.stopPropagation();
            move(source.current, key, dropEdge(e));
            endDrag();
          }}
          onDragEnd={endDrag}
          onKeyDown={(e) => {
            if (!movable || !e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
            e.preventDefault();
            const up = e.key === 'ArrowUp';
            const neighbor = order[order.indexOf(key) + (up ? -1 : 1)];
            if (neighbor) {
              focusAfterMove.current = key;
              move(key, neighbor, up ? 'before' : 'after');
            }
          }}
          aria-label={label}
          aria-description={detail}
          aria-current={page === key ? 'page' : undefined}
          {...{ interestfor: hintId }}
          onClick={() => onNavigate(key)}
        >
          <ItemArt name={icon} size={28} />
          {detail && key !== 'accounts' && <i className="nav-dot" aria-hidden="true" />}
        </button>
        <span className="nav-tooltip" id={hintId} popover="hint" role="tooltip">
          {label}
          {detail && ' · ' + detail}
        </span>
      </Fragment>
    );
  }
  return (
    <aside className="sidebar" ref={sidebar}>
      <div className="brand" role="img" aria-label="KJMCL">
        <Brand />
      </div>
      <nav aria-label="工作空间">
        {entry('home')}
        {order.map(entry)}
      </nav>
      <div className="sidebar-bottom">
        {entry('settings')}
        {entry('accounts')}
      </div>
    </aside>
  );
}
