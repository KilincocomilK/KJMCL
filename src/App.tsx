import { ResourcesPage } from './pages/Resources';
import { AccountPage } from './pages/Accounts';
import { StorageSetup } from './pages/Storage';
import { SettingsPage } from './pages/Settings';
import { MultiplayerPage } from './pages/Multiplayer';
import { ResourceImport } from './dialogs/ResourceImport';
import { LibraryPage, InstanceCard } from './pages/Library';
import type { ResourceCandidate } from '../shared/types';
import { CreateDialog, EditDialog } from './dialogs/InstanceDialogs';
import { type Run, loaderLabel, statusLabel, date } from './ui';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Activity,
  Archive,
  FolderOpen,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  Clock,
  Download,
  Home,
  Layers,
  LoaderCircle,
  Minus,
  Play,
  Plus,
  Settings2,
  SlidersHorizontal,
  Square,
  Upload,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import type { Snapshot, Instance } from '../shared/types';
import { api } from './api';
import { Brand, Empty, Terrain } from './components';
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
  const active = state.instances.find((i) => i.id === state.selectedInstanceId),
    account = state.accounts.find((a) => a.id === state.selectedAccountId),
    running = active && state.running.includes(active.id),
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
  const launch = () => (active ? run(() => api.launch(active.id)) : setCreate(true));
  return (
    <div className="app-shell">
      <ResourceImport state={state} run={run} files={resourceFiles} onFiles={setResourceFiles} />
      {state.storage?.setupRequired && <StorageSetup state={state} run={run} />}
      <aside className="sidebar">
        <div className="brand">
          <Brand />
          <div>
            <strong>KJMCL</strong>
            <small>KJMC LAUNCHER</small>
          </div>
        </div>
        <div className="nav-caption">工作空间</div>
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
              ) : (
                key === 'home' && <ChevronRight size={14} />
              )}
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
              <small>
                {account
                  ? account.kind === 'microsoft'
                    ? 'Microsoft 账户'
                    : account.kind === 'yggdrasil'
                      ? '第三方账户'
                      : '离线账户'
                  : '未登录'}
              </small>
            </span>
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="sidebar-version">
          <i />
          KJMCL <span>{state.appVersion}</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="titlebar">
          <span>
            KJMC <span className="slash">/</span> {page === 'settings' ? '设置' : pageLabels[page]}
          </span>
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
        <main>
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
            <>
              <section className="hero">
                <Terrain />
                <div className="hero-content">
                  <div className="hero-tag">
                    <span />
                    MINECRAFT JAVA EDITION
                  </div>
                  <h2>
                    {active?.name ?? 'Minecraft'}
                    <span>_</span>
                  </h2>
                  <div className="hero-meta">
                    {active ? (
                      <>
                        <span>{active.version}</span>
                        <i />
                        <span>{loaderLabel[active.loader]}</span>
                      </>
                    ) : (
                      <span>Java Edition</span>
                    )}
                  </div>
                  <button
                    className="primary hero-button"
                    disabled={
                      !!running ||
                      (!!active &&
                        (active.status === 'installing' || (active.status === 'ready' && !account)))
                    }
                    onClick={() =>
                      active
                        ? active.status === 'ready'
                          ? launch()
                          : void run(async () => {
                              if (active.external)
                                await api.refreshGameFolder(active.external.folderId);
                              else await api.install(active.id);
                            })
                        : setCreate(true)
                    }
                  >
                    {running ? (
                      <Square size={18} />
                    ) : active && active.status !== 'ready' ? (
                      <Download size={20} />
                    ) : (
                      <Play size={20} fill="currentColor" />
                    )}
                    {running
                      ? '游戏运行中'
                      : !active
                        ? '创建游戏实例'
                        : active.status === 'ready'
                          ? '启动游戏'
                          : active.external
                            ? '刷新版本索引'
                            : '安装游戏'}
                    <ArrowRight size={19} />
                  </button>
                  {running && active && (
                    <button
                      className="text-button"
                      onClick={() => void run(() => api.stop(active.id))}
                    >
                      <Square size={14} />
                      结束游戏
                    </button>
                  )}
                  {active?.status === 'ready' && !account && (
                    <button className="hero-account" onClick={() => navigate('accounts')}>
                      添加账户以启动 <ArrowRight size={14} />
                    </button>
                  )}
                </div>
                <div className="hero-corner">
                  KJMC<span>01 / JAVA</span>
                </div>
              </section>
              <section className="launch-strip">
                <div className="instance-symbol">
                  <Box size={25} />
                </div>
                <div>
                  <small>当前实例</small>
                  <select
                    aria-label="当前游戏实例"
                    value={active?.id ?? ''}
                    onChange={(e) => void run(() => api.select({ instanceId: e.target.value }))}
                  >
                    <option value="" disabled>
                      尚未创建实例
                    </option>
                    {state.instances.map((i) => (
                      <option value={i.id} key={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </div>
                <span className={'status ' + (active?.status === 'ready' ? 'green' : '')}>
                  {active ? statusLabel[active.status] : '等待创建'}
                </span>
                <div className="strip-spacer" />
                <div className="strip-stat">
                  <small>内存分配</small>
                  <strong>
                    {((active?.memoryMb ?? state.settings.memoryMb) / 1024).toFixed(1)}{' '}
                    <span>GB</span>
                  </strong>
                </div>
                <button
                  className="icon"
                  disabled={!active}
                  aria-label="实例设置"
                  onClick={() => setEditing(active)}
                >
                  <SlidersHorizontal size={19} />
                </button>
              </section>
              <div className="section-head">
                <h2>
                  我的实例 <span>{state.instances.length.toString().padStart(2, '0')}</span>
                </h2>
                <button className="text-button" onClick={() => navigate('instances')}>
                  查看全部
                  <ArrowRight size={16} />
                </button>
              </div>
              <div className="instance-grid home-grid">
                {state.instances
                  .slice()
                  .sort(
                    (a, b) =>
                      Number(b.organization?.favorite ?? false) -
                        Number(a.organization?.favorite ?? false) ||
                      (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0),
                  )
                  .slice(0, 2)
                  .map((i) => (
                    <InstanceCard
                      key={i.id}
                      i={i}
                      state={state}
                      run={run}
                      onEdit={() => setEditing(i)}
                    />
                  ))}
                <button className="new-card" onClick={() => setCreate(true)}>
                  <span>
                    <Plus size={24} />
                  </span>
                  <strong>新建游戏实例</strong>
                  <small>原版 · Fabric · Quilt</small>
                </button>
              </div>
              <div className="home-footer">
                <span>
                  <Clock size={11} />
                  最近启动：{date(active?.lastPlayed)}
                </span>
                <span>WINDOWS / macOS / LINUX</span>
              </div>
            </>
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
              <Empty title="没有下载任务" description="安装进度会显示在这里" />
            ))}
          {page === 'settings' && (
            <SettingsPage key={JSON.stringify(state.settings)} state={state} run={run} />
          )}
        </main>
        <footer className="statusbar">
          {state.running.length > 0 && (
            <button onClick={() => void run(() => api.setLightweight(true))}>进入轻量模式</button>
          )}
          <span>
            <i className={pending.length ? 'busy' : ''} />
            {pending.length
              ? `${pending.length} 个任务进行中`
              : state.running.length
                ? '游戏运行中'
                : '就绪'}
          </span>
          <button onClick={() => navigate('downloads')}>
            {pending[0] ? (
              <>
                {pending[0].detail}
                <span>{Math.floor(pending[0].progress)}%</span>
              </>
            ) : (
              <>
                JAVA EDITION <span>·</span> KJMCL
              </>
            )}
          </button>
        </footer>
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
