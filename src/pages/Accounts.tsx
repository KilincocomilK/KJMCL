import { useState, useEffect } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, Check, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import type { Snapshot, DeviceCode } from '../../shared/types';
import { api } from '../api';
import { Field } from '../components';
import { ItemArt } from '../components/ItemArt';
import { SettingGroup } from '../components/SettingGroup';
import { type Run } from '../ui';
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
  const [skin, setSkin] = useState<Account>(),
    [reordering, setReordering] = useState(false);
  const move = async (id: string, direction: 'up' | 'down') => {
    setReordering(true);
    try {
      await run(() => api.moveAccount({ id, direction }));
    } finally {
      setReordering(false);
    }
  };
  return (
    <div className="single-page accounts-page">
      {skin && <SkinDialog account={skin} run={run} onClose={() => setSkin(undefined)} />}
      <div className="account-grid">
        {state.accounts.map((a, index) => (
          <article
            key={a.id}
            className={'account-card panel ' + (state.selectedAccountId === a.id ? 'selected' : '')}
          >
            <div className="account-identity">
              <ItemArt name="face" size={40} />
              <div>
                <h2>{a.name}</h2>
                <small>
                  {a.kind === 'microsoft'
                    ? 'Microsoft'
                    : a.kind === 'yggdrasil'
                      ? '第三方'
                      : '离线'}
                </small>
              </div>
            </div>
            <div className="account-actions">
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
            </div>
            <details className="minor-details">
              <summary>账户详情</summary>
              <p className="uuid">{a.authServer ?? a.uuid}</p>
            </details>
          </article>
        ))}
      </div>
      <AccountSetup state={state} run={run} />
    </div>
  );
}
export function AccountSetup({
  state,
  run,
  welcome = false,
  onConfigured,
}: {
  state: Snapshot;
  run: Run;
  welcome?: boolean;
  onConfigured?: () => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState<DeviceCode>();
  const [busy, setBusy] = useState(false);
  const [draftClientId, setDraftClientId] = useState<string>();
  const clientId = draftClientId ?? state.settings.microsoftClientId;
  const clientChanged = clientId.trim() !== state.settings.microsoftClientId;
  const saveClientId = async () => {
    if (!clientChanged) return;
    await api.settings({ ...(await api.snapshot()).settings, microsoftClientId: clientId.trim() });
    setDraftClientId(undefined);
    onConfigured?.();
  };
  const currentAccount = state.accounts.find((account) => account.id === state.selectedAccountId);
  const loginTask = state.tasks.find((task) => task.title === 'Microsoft 登录');
  const loggingIn = loginTask?.status === 'running';
  useEffect(() => {
    if (!loggingIn) setCode(undefined);
  }, [loggingIn]);
  return (
    <>
      {welcome && !currentAccount && (
        <p>单人游戏可用离线账户。正版联机选 Microsoft，皮肤站用户选第三方。</p>
      )}
      {welcome && currentAccount && (
        <p className="inline-note" role="status">
          当前账户 · {currentAccount.name}
        </p>
      )}
      <SettingGroup title="离线账户" art="face" open={state.accounts.length === 0}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            try {
              const a = await run(() => api.addOffline(name));
              if (a) {
                setName('');
                onConfigured?.();
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="玩家名称">
            <input
              pattern="[a-zA-Z0-9_]{3,16}"
              title="3–16 位英文字母、数字或下划线"
              required
              disabled={busy}
              placeholder="Player"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <button className="primary" disabled={busy}>
            <Plus size={16} />
            添加账户
          </button>
        </form>
      </SettingGroup>
      <SettingGroup title="Microsoft 账户" art="globe">
        <details className="minor-details" open={!state.settings.microsoftClientId}>
          <summary>应用客户端 ID</summary>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await run(saveClientId, '客户端 ID 已保存');
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Microsoft Client ID" hint="使用已获 Minecraft 授权的应用客户端 ID。">
              <input
                aria-label="Microsoft Client ID"
                value={clientId}
                disabled={busy || loggingIn}
                onChange={(e) => setDraftClientId(e.target.value)}
              />
            </Field>
            {clientChanged && <button disabled={busy || loggingIn}>保存客户端 ID</button>}
          </form>
        </details>
        {code || loggingIn ? (
          <div className="login-code">
            {code ? (
              <>
                <small>在微软验证页面输入</small>
                <strong>{code.userCode}</strong>
                <button
                  className="primary"
                  onClick={() => void run(() => api.external(code.verificationUri))}
                >
                  打开登录页面
                  <ArrowUpRight size={16} />
                </button>
              </>
            ) : (
              <p>正在等待 Microsoft 授权</p>
            )}
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
            disabled={busy || !clientId.trim()}
            onClick={async () => {
              setBusy(true);
              const c = await run(async () => {
                await saveClientId();
                return api.beginLogin();
              });
              if (c) setCode(c);
              setBusy(false);
            }}
          >
            {busy && <LoaderCircle size={16} className="spin" />}登录 Microsoft
            <ArrowUpRight size={16} />
          </button>
        )}
      </SettingGroup>
      <ThirdPartyLogin run={run} onConfigured={onConfigured} />
    </>
  );
}
