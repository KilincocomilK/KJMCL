import { useEffect, useState } from 'react';
import type { Account, Instance, LaunchSession } from '../../shared/types';
import { api } from '../api';
import { Modal } from '../components';
import { ThirdPartyLogin } from '../pages/ThirdPartyLogin';
import type { Run } from '../ui';

export function LaunchFailure({
  instance,
  failure,
  startedAt,
  account,
  run,
  busy,
  onAccounts,
  onDiagnostics,
}: {
  instance: Instance;
  failure: NonNullable<LaunchSession['failure']>;
  startedAt: number;
  account?: Account;
  run: Run;
  busy: boolean;
  onAccounts: () => void;
  onDiagnostics: () => void;
}) {
  const [canUndo, setCanUndo] = useState(false);
  const [working, setWorking] = useState(false);
  const [thirdParty, setThirdParty] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    let active = true;
    void api
      .lastModUpdate(instance.id)
      .then((receipt) => {
        if (active) setCanUndo(!!receipt && receipt.updatedAt <= startedAt);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [instance.id, startedAt]);
  const locked = busy || working;
  const act = async (work: () => Promise<unknown>, message: string) => {
    setWorking(true);
    try {
      if (
        await run(async () => {
          await work();
          return true;
        })
      )
        setNote(message);
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="home-launch-failure" aria-label="上次启动失败">
      <strong>上次启动失败</strong>
      <p>{failure.reason}</p>
      <div className="row">
        {failure.action === 'account' && (
          <button
            disabled={locked}
            onClick={() => {
              if (account?.kind === 'yggdrasil' && account.authServer) setThirdParty(true);
              else {
                onAccounts();
                if (account?.kind === 'microsoft') void run(() => api.beginLogin(account.id));
              }
            }}
          >
            {account ? `重新授权 · ${account.name}` : '选择启动账户'}
          </button>
        )}
        {failure.action === 'resources' &&
          (instance.external ? (
            <button
              disabled={locked}
              onClick={() =>
                void act(
                  () => api.refreshGameFolder(instance.external!.folderId),
                  '已重新读取游戏目录，可重试启动。',
                )
              }
            >
              在原启动器修复后刷新
            </button>
          ) : (
            <button
              disabled={locked}
              onClick={() => void act(() => api.install(instance.id), '已提交资源修复任务。')}
            >
              补齐游戏资源
            </button>
          ))}
        {canUndo && (
          <button
            disabled={locked}
            onClick={() =>
              void act(async () => {
                await api.undoModUpdates(instance.id);
                setCanUndo(false);
              }, '已撤销模组更新，可重试启动。')
            }
          >
            撤销上次模组更新
          </button>
        )}
        <button disabled={working} onClick={onDiagnostics}>
          查看启动诊断
        </button>
      </div>
      {note && <small role="status">{note}</small>}
      {thirdParty && account?.authServer && (
        <Modal title={`重新授权 · ${account.name}`} onClose={() => setThirdParty(false)}>
          <ThirdPartyLogin
            run={run}
            initialServer={account.authServer}
            onConfigured={() => {
              setThirdParty(false);
              setNote('已完成账户登录，可重试启动。');
            }}
          />
        </Modal>
      )}
    </section>
  );
}
