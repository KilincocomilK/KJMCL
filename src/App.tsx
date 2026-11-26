import { ResourcesPage, type ResourceView } from './pages/Resources';
import { flushSync } from 'react-dom';
import type { ProjectionDocument } from '../shared/projection';
import { AccountPage } from './pages/Accounts';
import { ToolboxPage, toolLabels, type ToolId } from './pages/Toolbox';
import { StorageSetup } from './pages/Storage';
import { Welcome } from './pages/Welcome';
import { LauncherImport } from './pages/LauncherImport';
import { SettingsPage } from './pages/Settings';
import { MultiplayerPage } from './pages/Multiplayer';
import { ResourceImport } from './dialogs/ResourceImport';
import { LibraryPage } from './pages/Library';
import { ImportDialog } from './dialogs/AdvancedDialogs';
import type { MinecraftScan } from '../shared/types';
import { HomePage } from './pages/Home';
import { Sidebar, navigation, type Page } from './components/Sidebar';
import { DEFAULT_SIDEBAR_ORDER } from '../shared/navigation';
import { DownloadsPage } from './pages/Downloads';
import { ActivityNotifications } from './components/ActivityNotifications';
import type { ResourceCandidate } from '../shared/types';
import { CreateDialog, EditDialog } from './dialogs/InstanceDialogs';
import { type Run } from './ui';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, LoaderCircle, Minus, Square, X } from 'lucide-react';
import type { ActivityRef, Snapshot, Instance, WorldRef } from '../shared/types';
import { api } from './api';
import { Brand } from './components';
import { Background } from './Background';
import {
  ConsolidatedWorkspace,
  defaultWorkspaceTab,
  isWorkspace,
  normalizeWorkspaceTab,
  type WorkspaceTab,
} from './pages/Workspace';
const AssistantPage = lazy(() => import('./pages/Assistant'));
export function App() {
  const [state, setState] = useState<Snapshot>(),
    [page, setPage] = useState<Page>('home'),
    [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(defaultWorkspaceTab('saves')),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(() =>
      new URLSearchParams(location.search).get('modeNotice') === 'exited'
        ? '已退出轻量模式，完整界面已恢复'
        : '',
    ),
    [create, setCreate] = useState(false),
    [editing, setEditing] = useState<Instance>();
  const [resourceFiles, setResourceFiles] = useState<ResourceCandidate[]>([]);
  const [folderScan, setFolderScan] = useState<MinecraftScan>();
  const [launcherImport, setLauncherImport] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [scanningFolder, setScanningFolder] = useState(false);
  const [resourceViews, setResourceViews] = useState<Record<string, ResourceView>>({}),
    [projectionDocument, setProjectionDocument] = useState<ProjectionDocument>(),
    [projectionReturn, setProjectionReturn] = useState(false);
  const [toolboxVisited, setToolboxVisited] = useState(false),
    [tool, setTool] = useState<ToolId>(),
    [skinAccountId, setSkinAccountId] = useState<string>(),
    [seedWorld, setSeedWorld] = useState<WorldRef>();
  const [assistantVisited, setAssistantVisited] = useState(false);
  const [diagnosisRequest, setDiagnosisRequest] = useState<{ id: string; instanceId: string }>();
  const clearDiagnosisRequest = useCallback(() => setDiagnosisRequest(undefined), []);
  const clearSkinAccount = useCallback(() => setSkinAccountId(undefined), []);
  const clearSeedWorld = useCallback(() => setSeedWorld(undefined), []);
  const clearProjectionDocument = useCallback(() => setProjectionDocument(undefined), []);
  const [windowVisible, setWindowVisible] = useState(false);
  const [selectedTask, setSelectedTask] = useState<string>();
  const main = useRef<HTMLElement>(null);
  const requestedSnapshot = useRef(0),
    appliedSnapshot = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++requestedSnapshot.current;
    const snapshot = await api.snapshot();
    if (request > appliedSnapshot.current) {
      appliedSnapshot.current = request;
      setState(snapshot);
    }
  }, []);
  const navigate = useCallback((next: Page, tab?: WorkspaceTab) => {
    if (next === 'assistant') setAssistantVisited(true);
    if (next === 'toolbox') setToolboxVisited(true);
    else setProjectionReturn(false);
    main.current?.scrollTo({ top: 0 });
    setPage(next);
    if (isWorkspace(next)) setWorkspaceTab(normalizeWorkspaceTab(next, tab));
  }, []);
  const run: Run = useCallback(
    async (work, message) => {
      try {
        const result = await work();
        await refresh();
        if (message) setNotice(message);
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return undefined;
      }
    },
    [refresh],
  );
  const dismiss = useCallback((activity: ActivityRef) => {
    void api.dismissNotification(activity).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
    void api
      .lightweightState()
      .then((s) => setWindowVisible(s.visible))
      .catch(() => {});
    return api.onEvent((e) => {
      if (e.type === 'state') void refresh().catch((e) => setError(String(e)));
      if (e.type === 'mode-error') setError(e.message);
      if (e.type === 'folder-scan') flushSync(() => setScanningFolder(e.active));
      if (e.type === 'window-visibility') setWindowVisible(e.visible);
    });
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    if (!windowVisible) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice, windowVisible]);
  if (!state)
    return (
      <div className="loading">
        <Brand />
        <LoaderCircle className="spin" />
        <p>{error || '正在启动'}</p>
      </div>
    );
  const account = state.accounts.find((a) => a.id === state.selectedAccountId),
    pending = state.tasks.filter((t) => t.status === 'running');
  const welcoming = !!state.welcome && state.welcome.step !== 'done';
  return (
    <div className={'app-shell ' + (page === 'home' ? 'is-home' : '')}>
      {!welcoming && (
        <ResourceImport state={state} run={run} files={resourceFiles} onFiles={setResourceFiles} />
      )}
      {(welcoming ? state.storage?.pendingRestart : state.storage?.setupRequired) && (
        <StorageSetup state={state} run={run} />
      )}
      {!welcoming && (
        <Sidebar
          page={page}
          order={state.sidebarOrder ?? DEFAULT_SIDEBAR_ORDER}
          onReorder={(order) => {
            setState((previous) => previous && { ...previous, sidebarOrder: order });
            void run(async () => {
              try {
                await api.setSidebarOrder(order);
              } catch (error) {
                await refresh();
                throw error;
              }
            });
          }}
          accountName={account?.name}
          downloads={pending.length}
          assistantPending={state.assistantPending ?? 0}
          hasUpdate={state.launcherUpdate?.status === 'available'}
          onNavigate={(next) => {
            if (next === 'toolbox') {
              setTool(undefined);
              setProjectionReturn(false);
            }
            navigate(next);
          }}
        />
      )}
      <div className="main-shell">
        <Background state={state} />
        <header className="titlebar">
          <h1>
            {welcoming
              ? '首次使用引导'
              : page === 'toolbox' && tool
                ? toolLabels[tool]
                : navigation[page].label}
          </h1>
          {!welcoming && page === 'home' && (
            <button
              className="site-link"
              onClick={() => void run(() => api.external('https://kjmc.top'))}
            >
              KJMC 官网 <ArrowUpRight size={14} />
            </button>
          )}
          <div className="window-actions">
            <button aria-label="最小化" onClick={() => void run(() => api.window('minimize'))}>
              <Minus size={15} />
            </button>
            <button aria-label="最大化" onClick={() => void run(() => api.window('maximize'))}>
              <Square size={12} />
            </button>
            <button
              aria-label="关闭启动器"
              className="close"
              onClick={() => void run(() => api.window('close'))}
            >
              <X size={17} />
            </button>
          </div>
        </header>
        {welcoming ? (
          <main data-page="welcome">
            <Welcome
              state={state}
              run={run}
              onFinish={(createInstance) => {
                navigate('home');
                setCreate(createInstance);
              }}
            />
          </main>
        ) : (
          <main
            ref={main}
            data-page={page}
            className={
              page === 'home' ? 'home-main' : page === 'assistant' ? 'assistant-main' : undefined
            }
          >
            {page === 'home' && (
              <HomePage
                state={state}
                run={run}
                onCreate={() => setCreate(true)}
                onEdit={setEditing}
                onAccounts={() => navigate('accounts')}
                onDiagnostics={() => navigate('diagnostics', 'performance')}
                onLibrary={() => navigate('instances')}
              />
            )}
            {page === 'instances' && (
              <LibraryPage
                pickingFolder={pickingFolder}
                onPickFolder={async () => {
                  if (pickingFolder) return;
                  setPickingFolder(true);
                  try {
                    await run(async () => {
                      const scan = await api.scanMinecraft();
                      if (scan) setFolderScan(scan);
                    });
                  } finally {
                    setPickingFolder(false);
                  }
                }}
                state={state}
                run={run}
                onEdit={setEditing}
                onCreate={() => setCreate(true)}
                onHome={() => navigate('home')}
              />
            )}
            {assistantVisited && (
              <Suspense fallback={page === 'assistant' ? <p role="status">正在载入助手…</p> : null}>
                <AssistantPage
                  state={state}
                  active={page === 'assistant'}
                  diagnosis={diagnosisRequest}
                  onDiagnosisReady={clearDiagnosisRequest}
                />
              </Suspense>
            )}
            {page === 'resources' && (
              <ResourcesPage
                key={state.selectedInstanceId}
                state={state}
                run={run}
                refreshKey={resourceFiles.length}
                onImport={setResourceFiles}
                onLibrary={() => navigate('instances')}
                view={resourceViews[state.selectedInstanceId ?? ''] ?? { kind: 'mods', query: '' }}
                onView={(view) =>
                  setResourceViews((values) => ({
                    ...values,
                    [state.selectedInstanceId ?? '']: view,
                  }))
                }
                onProjection={(document) => {
                  setProjectionDocument(document);
                  setProjectionReturn(true);
                  setTool('projection');
                  navigate('toolbox');
                }}
              />
            )}
            {isWorkspace(page) && (
              <ConsolidatedWorkspace
                workspace={page}
                onLibrary={() => navigate('instances')}
                tab={workspaceTab}
                onTab={setWorkspaceTab}
                onDiagnose={(instanceId) => {
                  setDiagnosisRequest({ id: crypto.randomUUID(), instanceId });
                  navigate('assistant');
                }}
                state={state}
                run={run}
                onSeedMap={(world) => {
                  setSeedWorld(world);
                  setTool('seed-map');
                  navigate('toolbox');
                }}
              />
            )}
            {page === 'multiplayer' && <MultiplayerPage state={state} run={run} />}
            {page === 'accounts' && (
              <AccountPage
                state={state}
                run={run}
                onEditSkin={(id) => {
                  setSkinAccountId(id);
                  setTool('skin-editor');
                  navigate('toolbox');
                }}
              />
            )}
            {toolboxVisited && (
              <ToolboxPage
                state={state}
                run={run}
                active={page === 'toolbox'}
                tool={tool}
                onTool={setTool}
                skinAccountId={skinAccountId}
                onSkinImported={clearSkinAccount}
                world={seedWorld}
                onWorldImported={clearSeedWorld}
                projectionDocument={projectionDocument}
                onProjectionImported={clearProjectionDocument}
                onProjectionBack={
                  projectionReturn
                    ? () => {
                        setProjectionReturn(false);
                        navigate('resources');
                      }
                    : undefined
                }
              />
            )}
            {page === 'downloads' && (
              <DownloadsPage tasks={state.tasks} selected={selectedTask} run={run} />
            )}
            {page === 'settings' && (
              <SettingsPage
                key={JSON.stringify(state.settings)}
                state={state}
                run={run}
                onImport={() => setLauncherImport(true)}
                onLibrary={() => navigate('instances')}
              />
            )}
          </main>
        )}
        {state.running.length > 0 && (
          <footer className="statusbar">
            <button onClick={() => void run(() => api.setLightweight(true))}>进入轻量模式</button>
          </footer>
        )}
      </div>
      {folderScan && (
        <ImportDialog scan={folderScan} run={run} onClose={() => setFolderScan(undefined)} />
      )}
      {launcherImport && (
        <LauncherImport state={state} run={run} onClose={() => setLauncherImport(false)} />
      )}
      {create && <CreateDialog state={state} run={run} onClose={() => setCreate(false)} />}
      {editing && (
        <EditDialog
          instance={editing}
          state={state}
          run={run}
          onClose={() => setEditing(undefined)}
        />
      )}
      <ActivityNotifications
        tasks={welcoming ? [] : state.tasks}
        update={welcoming ? undefined : state.launcherUpdate}
        currentVersion={state.appVersion}
        visible={windowVisible}
        dismiss={dismiss}
        openTask={(id) => {
          setSelectedTask(id);
          navigate('downloads');
          dismiss({ taskId: id });
        }}
        openInfo={() => {
          navigate('settings');
          requestAnimationFrame(() =>
            document.getElementById('launcher-info-heading')?.focus({ preventScroll: true }),
          );
          if (state.launcherUpdate?.version) dismiss({ version: state.launcherUpdate.version });
        }}
      >
        {scanningFolder && (
          <div role="status" className="toast scan-notice">
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
            <span>正在读取游戏文件夹…</span>
          </div>
        )}
        {(error || notice) && (
          <div role={error ? 'alert' : 'status'} className={'toast ' + (error ? 'error' : '')}>
            <span>{error || notice}</span>
            <button
              className="icon"
              aria-label="关闭提示"
              onClick={() => {
                setError('');
                setNotice('');
              }}
            >
              <X size={17} />
            </button>
          </div>
        )}
      </ActivityNotifications>
    </div>
  );
}
