import { ResourcesPage } from './pages/Resources';
import { AccountPage } from './pages/Accounts';
import { StorageSetup } from './pages/Storage';
import { SettingsPage } from './pages/Settings';
import { MultiplayerPage } from './pages/Multiplayer';
import { ResourceImport } from './dialogs/ResourceImport';
import { LibraryPage } from './pages/Library';
import { HomePage } from './pages/Home';
import type { ResourceCandidate } from '../shared/types';
import { CreateDialog, EditDialog } from './dialogs/InstanceDialogs';
import { type Run } from './ui';
import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Archive,
  FolderOpen,
  ArrowUpRight,
  Check,
  ChevronRight,
  Download,
  Home,
  Layers,
  LoaderCircle,
  Minus,
  Plus,
  Settings2,
  Square,
  Upload,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import type { Snapshot, Instance } from '../shared/types';
import { api } from './api';
import { Brand, Empty } from './components';
import { Background } from './Background';
import {
  ConsolidatedWorkspace,
  defaultWorkspaceTab,
  isWorkspace,
  normalizeWorkspaceTab,
  type WorkspaceId,
  type WorkspaceTab,
} from './pages/Workspace';
type Page =
  | 'home'
  | 'instances'
  | 'resources'
  | WorkspaceId
  | 'multiplayer'
  | 'downloads'
  | 'accounts'
  | 'settings';
const pageLabels: Record<Page, string> = {
  home: '开始游戏',
  instances: '游戏实例',
  resources: '资源管理',
  saves: '存档管理',
  multiplayer: '陶瓦联机',
  diagnostics: '诊断与维护',
  downloads: '下载任务',
  accounts: '账户管理',
  settings: '启动器设置',
};
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
  const [windowVisible, setWindowVisible] = useState(false);
  const refresh = useCallback(async () => setState(await api.snapshot()), []);
  const navigate = useCallback((next: Page, tab?: WorkspaceTab) => {
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
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
    void api
      .lightweightState()
      .then((s) => setWindowVisible(s.visible))
      .catch(() => {});
    return api.onEvent((e) => {
      if (e.type === 'state') void refresh().catch((e) => setError(String(e)));
      if (e.type === 'mode-error') setError(e.message);
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
  const nav: [Page, typeof Home, string][] = [
    ['home', Home, '开始游戏'],
    ['instances', Layers, '游戏实例'],
    ['resources', FolderOpen, '资源管理'],
    ['saves', Archive, '存档管理'],
    ['multiplayer', Users, '陶瓦联机'],
    ['diagnostics', Activity, '诊断与维护'],
    ['downloads', Download, '下载任务'],
  ];
  return (
    <div className={'app-shell ' + (page === 'home' ? 'is-home' : '')}>
      <Background state={state} />
      <ResourceImport state={state} run={run} files={resourceFiles} onFiles={setResourceFiles} />
      {state.storage?.setupRequired && <StorageSetup state={state} run={run} />}
      <aside className="sidebar">
        <div className="brand">
          <Brand />
          <div>
            <strong>KJMCL</strong>
          </div>
        </div>
        <nav aria-label="工作空间">
          {nav.map(([key, Icon, label]) => (
            <button
              key={key}
              className={'nav-item ' + (page === key ? 'active' : '')}
              aria-current={page === key ? 'page' : undefined}
              onClick={() => navigate(key)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {key === 'downloads' && pending.length > 0 ? (
                <b className="count">{pending.length}</b>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={'nav-item ' + (page === 'settings' ? 'active' : '')}
            aria-current={page === 'settings' ? 'page' : undefined}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={18} />
            <span>启动器设置</span>
          </button>
          <button
            className="account-switch"
            aria-label="账户管理"
            aria-current={page === 'accounts' ? 'page' : undefined}
            onClick={() => navigate('accounts')}
          >
            <span className="avatar">
              {account?.name.slice(0, 2).toUpperCase() ?? <UserRound size={20} />}
            </span>
            <span>
              <strong>{account?.name ?? '添加账户'}</strong>
            </span>
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="titlebar">
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
        <main className={page === 'home' ? 'home-main' : undefined}>
          <div className="page-head">
            <div>
              <h1>{pageLabels[page]}</h1>
            </div>
            <div className="head-actions">
              {page === 'home' ? (
                <button
                  className="text-button"
                  onClick={() => void run(() => api.external('https://kjmc.top'))}
                >
                  KJMC 官网
                  <ArrowUpRight size={16} />
                </button>
              ) : page === 'instances' ? (
                <>
                  <button onClick={() => void run(() => api.importPack())}>
                    <Upload size={16} />
                    导入整合包
                  </button>
                  <button className="primary" onClick={() => setCreate(true)}>
                    <Plus size={17} />
                    新建实例
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {page === 'home' && (
            <HomePage
              state={state}
              run={run}
              onCreate={() => setCreate(true)}
              onEdit={setEditing}
              onAccounts={() => navigate('accounts')}
              onLibrary={() => navigate('instances')}
            />
          )}
          {page === 'instances' && <LibraryPage state={state} run={run} onEdit={setEditing} />}
          {page === 'resources' && (
            <ResourcesPage
              key={state.selectedInstanceId}
              state={state}
              run={run}
              refreshKey={resourceFiles.length}
              onImport={setResourceFiles}
            />
          )}
          {isWorkspace(page) && (
            <ConsolidatedWorkspace
              workspace={page}
              tab={workspaceTab}
              onTab={setWorkspaceTab}
              state={state}
              run={run}
            />
          )}
          {page === 'multiplayer' && <MultiplayerPage state={state} run={run} />}
          {page === 'accounts' && <AccountPage state={state} run={run} />}
          {page === 'downloads' &&
            (state.tasks.length ? (
              <div className="task-list">
                {state.tasks.map((t) => (
                  <section className="task panel" key={t.id}>
                    <div className={'task-icon ' + t.status}>
                      {t.status === 'completed' ? (
                        <Check />
                      ) : t.status === 'running' ? (
                        <LoaderCircle className="spin" />
                      ) : t.status === 'failed' ? (
                        <X />
                      ) : (
                        <Square />
                      )}
                    </div>
                    <div className="task-main">
                      <div className="row">
                        <strong>{t.title}</strong>
                        <span>
                          {
                            {
                              running: '进行中',
                              completed: '已完成',
                              failed: '失败',
                              cancelled: '已取消',
                            }[t.status]
                          }{' '}
                          · {Math.floor(t.progress)}%
                        </span>
                      </div>
                      <p>{t.detail}</p>
                      <progress value={t.progress} max={100} />
                    </div>
                    {t.status === 'running' && (
                      <button
                        className="icon"
                        aria-label="取消任务"
                        onClick={() => void run(() => api.cancelTask(t.id))}
                      >
                        <X size={18} />
                      </button>
                    )}
                  </section>
                ))}
              </div>
            ) : (
              <Empty title="没有下载任务" />
            ))}
          {page === 'settings' && (
            <SettingsPage key={JSON.stringify(state.settings)} state={state} run={run} />
          )}
        </main>
        {(pending.length > 0 || state.running.length > 0) && (
          <footer className="statusbar">
            {state.running.length > 0 && (
              <button onClick={() => void run(() => api.setLightweight(true))}>进入轻量模式</button>
            )}
            {pending[0] && (
              <button onClick={() => navigate('downloads')}>
                <LoaderCircle size={12} className="spin" />
                <span>{pending[0].title}</span>
                <span>{Math.floor(pending[0].progress)}%</span>
              </button>
            )}
          </footer>
        )}
      </div>
      {create && <CreateDialog state={state} run={run} onClose={() => setCreate(false)} />}
      {editing && <EditDialog instance={editing} run={run} onClose={() => setEditing(undefined)} />}
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
    </div>
  );
}
