import type { KeyboardEvent } from 'react';
import type { Snapshot, WorldRef } from '../../shared/types';
import { ItemArt, type ItemName } from '../components/ItemArt';
import { Empty, InstanceSelect } from '../components';
import type { Run } from '../ui';
import { SavesPage } from './Saves';
import { BackupsPage } from './Backups';
import { PerformancePage } from './Performance';
import { LogPage } from './Logs';
import { CrashesPage } from './Crashes';
import { MaintenancePage } from './Maintenance';
import '../workspace.css';

export type WorkspaceId = 'saves' | 'diagnostics';
export type WorkspaceTab = 'worlds' | 'backups' | 'performance' | 'logs' | 'crashes' | 'storage';

export const WORKSPACE_LABELS: Record<WorkspaceId, string> = {
  saves: '存档管理',
  diagnostics: '诊断与维护',
};

const WORKSPACE_TABS: Record<WorkspaceId, readonly { key: WorkspaceTab; label: string }[]> = {
  saves: [
    { key: 'worlds', label: '世界编辑' },
    { key: 'backups', label: '存档备份' },
  ],
  diagnostics: [
    { key: 'performance', label: '性能诊断' },
    { key: 'logs', label: '游戏日志' },
    { key: 'crashes', label: '崩溃报告' },
    { key: 'storage', label: '磁盘管理' },
  ],
};

const tabArt: Record<WorkspaceTab, ItemName> = {
  worlds: 'block',
  backups: 'book',
  performance: 'dust',
  logs: 'reel',
  crashes: 'plan',
  storage: 'chest',
};

export function isWorkspace(page: string): page is WorkspaceId {
  return page === 'saves' || page === 'diagnostics';
}

export function defaultWorkspaceTab(workspace: WorkspaceId): WorkspaceTab {
  return WORKSPACE_TABS[workspace][0]!.key;
}

export function normalizeWorkspaceTab(workspace: WorkspaceId, tab?: WorkspaceTab): WorkspaceTab {
  return WORKSPACE_TABS[workspace].some((item) => item.key === tab)
    ? tab!
    : defaultWorkspaceTab(workspace);
}

export function ConsolidatedWorkspace({
  workspace,
  tab,
  onTab,
  onLibrary,
  state,
  run,
  onSeedMap,
  onDiagnose,
}: {
  workspace: WorkspaceId;
  tab: WorkspaceTab;
  onTab: (tab: WorkspaceTab) => void;
  onLibrary: () => void;
  state: Snapshot;
  run: Run;
  onSeedMap?: (world: WorldRef) => void;
  onDiagnose?: (id: string) => void;
}) {
  const tabs = WORKSPACE_TABS[workspace],
    active = normalizeWorkspaceTab(workspace, tab),
    label = WORKSPACE_LABELS[workspace];
  const move = (event: KeyboardEvent<HTMLButtonElement>, current: WorkspaceTab) => {
    const index = tabs.findIndex((item) => item.key === current);
    let next: number | undefined;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    const target = tabs[next]!;
    onTab(target.key);
    requestAnimationFrame(() => document.getElementById(`${workspace}-tab-${target.key}`)?.focus());
  };
  const picker = active !== 'storage' && state.instances.length > 0 && (
    <div className="workspace-instance">
      <InstanceSelect state={state} run={run} />
    </div>
  );
  return (
    <section className="workspace" aria-label={label}>
      <div className={workspace === 'saves' ? 'workspace-bar save-workspace-bar' : 'workspace-bar'}>
        {workspace === 'saves' && picker}
        <div className="workspace-tabs" role="tablist" aria-label={label + '视图'}>
          {tabs.map((item) => (
            <button
              key={item.key}
              id={`${workspace}-tab-${item.key}`}
              type="button"
              role="tab"
              aria-selected={item.key === active}
              aria-controls={`${workspace}-panel-${item.key}`}
              tabIndex={item.key === active ? 0 : -1}
              onClick={() => onTab(item.key)}
              onKeyDown={(event) => move(event, item.key)}
            >
              <ItemArt name={tabArt[item.key]} size={18} /> {item.label}
            </button>
          ))}
        </div>
        {workspace !== 'saves' && picker}
      </div>
      <div
        className="workspace-panel"
        key={active}
        data-view={active}
        id={`${workspace}-panel-${active}`}
        role="tabpanel"
        aria-labelledby={`${workspace}-tab-${active}`}
      >
        {!state.selectedInstanceId && active !== 'storage' ? (
          <Empty
            art={tabArt[active]}
            title="选择一个游戏实例"
            action={<button onClick={onLibrary}>管理实例</button>}
          />
        ) : (
          <WorkspaceContent
            tab={active}
            state={state}
            run={run}
            onSeedMap={onSeedMap}
            onDiagnose={onDiagnose}
          />
        )}
      </div>
    </section>
  );
}

function WorkspaceContent({
  tab,
  state,
  run,
  onSeedMap,
  onDiagnose,
}: {
  tab: WorkspaceTab;
  state: Snapshot;
  run: Run;
  onSeedMap?: (world: WorldRef) => void;
  onDiagnose?: (id: string) => void;
}) {
  switch (tab) {
    case 'worlds':
      return <SavesPage state={state} run={run} showInstanceSelect={false} onSeedMap={onSeedMap} />;
    case 'backups':
      return <BackupsPage state={state} run={run} showInstanceSelect={false} />;
    case 'performance':
      return (
        <PerformancePage
          state={state}
          run={run}
          showInstanceSelect={false}
          onDiagnose={onDiagnose}
        />
      );
    case 'logs':
      return <LogPage state={state} run={run} showInstanceSelect={false} />;
    case 'crashes':
      return <CrashesPage state={state} run={run} showInstanceSelect={false} />;
    case 'storage':
      return <MaintenancePage state={state} run={run} />;
  }
}
