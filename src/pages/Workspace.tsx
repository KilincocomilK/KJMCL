import type { KeyboardEvent } from 'react';
import type { ResourceCandidate, Snapshot } from '../../shared/types';
import { InstanceSelect } from '../components';
import type { Run } from '../ui';
import { ResourcesPage } from './Resources';
import { ModPage } from './Mods';
import { CatalogPage } from './Catalog';
import { SavesPage } from './Saves';
import { BackupsPage } from './Backups';
import { PerformancePage } from './Performance';
import { LogPage } from './Logs';
import { CrashesPage } from './Crashes';
import { MaintenancePage } from './Maintenance';
import '../workspace.css';

export type WorkspaceId = 'resources' | 'saves' | 'diagnostics';
export type WorkspaceTab =
  | 'local'
  | 'mods'
  | 'catalog'
  | 'worlds'
  | 'backups'
  | 'performance'
  | 'logs'
  | 'crashes'
  | 'storage';

export const WORKSPACE_LABELS: Record<WorkspaceId, string> = {
  resources: '资源管理',
  saves: '存档管理',
  diagnostics: '诊断与维护',
};

const WORKSPACE_TABS: Record<WorkspaceId, readonly { key: WorkspaceTab; label: string }[]> = {
  resources: [
    { key: 'local', label: '本地资源' },
    { key: 'mods', label: '模组管理' },
    { key: 'catalog', label: '内容发现' },
  ],
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

export function isWorkspace(page: string): page is WorkspaceId {
  return page === 'resources' || page === 'saves' || page === 'diagnostics';
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
  state,
  run,
  resourceFiles,
  onImport,
}: {
  workspace: WorkspaceId;
  tab: WorkspaceTab;
  onTab: (tab: WorkspaceTab) => void;
  state: Snapshot;
  run: Run;
  resourceFiles: ResourceCandidate[];
  onImport: (files: ResourceCandidate[]) => void;
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
  return (
    <section className="workspace" aria-label={label}>
      <div className="workspace-bar">
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
              {item.label}
            </button>
          ))}
        </div>
        <div className="workspace-instance">
          <span>当前实例</span>
          <InstanceSelect state={state} run={run} />
        </div>
      </div>
      <div
        className="workspace-panel"
        id={`${workspace}-panel-${active}`}
        role="tabpanel"
        aria-labelledby={`${workspace}-tab-${active}`}
      >
        <WorkspaceContent
          tab={active}
          state={state}
          run={run}
          resourceFiles={resourceFiles}
          onImport={onImport}
        />
      </div>
    </section>
  );
}

function WorkspaceContent({
  tab,
  state,
  run,
  resourceFiles,
  onImport,
}: {
  tab: WorkspaceTab;
  state: Snapshot;
  run: Run;
  resourceFiles: ResourceCandidate[];
  onImport: (files: ResourceCandidate[]) => void;
}) {
  switch (tab) {
    case 'local':
      return (
        <ResourcesPage
          key={state.selectedInstanceId + ':' + resourceFiles.length}
          state={state}
          run={run}
          onImport={onImport}
          showInstanceSelect={false}
        />
      );
    case 'mods':
      return <ModPage state={state} run={run} showInstanceSelect={false} />;
    case 'catalog':
      return <CatalogPage state={state} run={run} showInstanceSelect={false} />;
    case 'worlds':
      return <SavesPage state={state} run={run} showInstanceSelect={false} />;
    case 'backups':
      return <BackupsPage state={state} run={run} showInstanceSelect={false} />;
    case 'performance':
      return <PerformancePage state={state} run={run} showInstanceSelect={false} />;
    case 'logs':
      return <LogPage state={state} run={run} showInstanceSelect={false} />;
    case 'crashes':
      return <CrashesPage state={state} run={run} showInstanceSelect={false} />;
    case 'storage':
      return <MaintenancePage state={state} run={run} />;
  }
}
