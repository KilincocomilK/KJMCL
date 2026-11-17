import { useState, useEffect } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  Globe,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import type { Snapshot, DeviceCode } from '../../shared/types';
import { api } from '../api';
import { Field } from '../components';
import { type Run, size } from '../ui';
import { SkinDialog } from '../dialogs/AdvancedDialogs';
import type { Account } from '../../shared/types';
import { ThirdPartyLogin } from './ThirdPartyLogin';
export function AccountPage({
  state,
  run,
  onEditSkin,
}: {
  state: Snapshot;
  run: Run;
  onEditSkin?: (id: string) => void;
}) {
  const [name, setName] = useState(''),
    [code, setCode] = useState<DeviceCode>(),
    [busy, setBusy] = useState(false),
    [skin, setSkin] = useState<Account>(),
    [reordering, setReordering] = useState(false);
  const move = async (id: string, direction: 'up' | 'down') => {
    setReordering(true);
    try {
      await run(() => api.moveAccount({ id, direction }));
    } finally {
      setReordering(false);
    }
  };
  const loggingIn = state.tasks.some(
    (task) => task.title === 'Microsoft 登录' && task.status === 'running',
  );
  useEffect(() => {
    if (code && !loggingIn) setCode(undefined);
  }, [code, loggingIn]);
  return (
    <>
      {skin && <SkinDialog account={skin} run={run} onClose={() => setSkin(undefined)} />}
      <div className="account-grid">
        {state.accounts.map((a, index) => (
          <article
            key={a.id}
            className={'account-card panel ' + (state.selectedAccountId === a.id ? 'selected' : '')}
          >
            <div className="row">
              <span className="avatar large">{a.name.slice(0, 2).toUpperCase()}</span>
              <span className="badge">
                {a.kind === 'microsoft' ? <ShieldCheck size={13} /> : <UserRound size={13} />}{' '}
                {a.kind === 'microsoft' ? 'Microsoft' : a.kind === 'yggdrasil' ? '第三方' : '离线'}
              </span>
            </div>
            <h2>{a.name}</h2>
            <p className="uuid">{a.authServer ?? a.uuid}</p>
            <button className="text-button" onClick={() => setSkin(a)}>
              管理皮肤
            </button>
            {onEditSkin && (
              <button className="text-button" onClick={() => onEditSkin(a.id)}>
                编辑皮肤
              </button>
            )}
            {state.accounts.length > 1 && (
              <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                <button
                  className="icon"
                  aria-label={'上移账户 ' + a.name}
                  title="上移"
                  disabled={reordering || index === 0}
                  onClick={() => void move(a.id, 'up')}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  className="icon"
                  aria-label={'下移账户 ' + a.name}
                  title="下移"
                  disabled={reordering || index === state.accounts.length - 1}
                  onClick={() => void move(a.id, 'down')}
                >
                  <ArrowDown size={15} />
                </button>
              </div>
            )}
            <div className="row">
              <button
                className={state.selectedAccountId === a.id ? 'selected-button' : ''}
                onClick={() => void run(() => api.select({ accountId: a.id }))}
              >
                {state.selectedAccountId === a.id ? (
                  <>
                    <Check size={15} />
                    当前账户
                  </>
                ) : (
                  '使用此账户'
                )}
              </button>
              <button
                className="icon danger"
                aria-label={'移除账户 ' + a.name}
                onClick={() => void run(() => api.removeAccount(a.id))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="settings-grid">
        <section className="panel setting-section">
          <div className="section-title">
            <Globe size={19} />
            <h2>Microsoft 账户</h2>
          </div>
          <p className="muted">登录拥有 Minecraft Java 版的账户</p>
          {!state.settings.microsoftClientId && (
            <p className="inline-note">请先在设置中配置 Microsoft Client ID</p>
          )}
          {code ? (
            <div className="login-code">
              <small>在微软验证页面输入</small>
              <strong>{code.userCode}</strong>
              <button
                className="primary"
                onClick={() => void run(() => api.external(code.verificationUri))}
              >
                打开登录页面
                <ArrowUpRight size={16} />
              </button>
              <button
                onClick={() => {
                  void run(() => api.cancelLogin());
                  setCode(undefined);
                }}
              >
                取消登录
              </button>
            </div>
          ) : (
            <button
              className="primary"
              disabled={busy || !state.settings.microsoftClientId}
              onClick={async () => {
                setBusy(true);
                const c = await run(() => api.beginLogin());
                if (c) setCode(c);
                setBusy(false);
              }}
            >
              {busy && <LoaderCircle size={16} className="spin" />}登录 Microsoft
              <ArrowUpRight size={16} />
            </button>
          )}
        </section>
        <section className="panel setting-section">
          <div className="section-title">
            <UserRound size={19} />
            <h2>离线账户</h2>
          </div>
          <p className="muted">用于本地游戏及允许离线账户的服务器</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const a = await run(() => api.addOffline(name));
              if (a) setName('');
            }}
          >
            <Field label="玩家名称">
              <input
                pattern="[a-zA-Z0-9_]{3,16}"
                title="3–16 位英文字母、数字或下划线"
                required
                placeholder="Player"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <button>
              <Plus size={16} />
              添加账户
            </button>
          </form>
        </section>
      </div>
      <ThirdPartyLogin run={run} />
    </>
  );
}
