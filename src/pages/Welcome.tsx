import { useCallback, useEffect, useRef, useState } from 'react';
import { welcomeSection, type Snapshot, type WelcomeProgress } from '../../shared/types';
import { api } from '../api';
import { Brand } from '../components';
import { ItemArt } from '../components/ItemArt';
import { WelcomeJava } from '../components/WelcomeJava';
import { AccountSetup } from './Accounts';
import { WelcomeAssistant } from './WelcomeAssistant';
import { LauncherImport } from './LauncherImport';
import { StorageSettings } from './Storage';
import type { Run } from '../ui';
import '../welcome.css';

const steps = ['start', 'folders', 'java', 'account', 'assistant', 'finish'] as const;
const labels = ['欢迎', '游戏目录', 'Java 环境', '游戏账户', 'AI 助手', '完成'];
const titles = [
  '欢迎使用 KJMCL',
  '准备游戏文件夹',
  '配置 Java 环境',
  '添加游戏账户',
  '配置 AI 助手',
  '准备完成',
];

function NewGameDirectory({ state, run }: { state: Snapshot; run: Run }) {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async (choice: 'default' | 'choose') => {
    setBusy(true);
    const dir = await run(() => api.prepareGameDirectory(choice));
    if (dir) setPath(dir);
    setBusy(false);
  };
  return (
    <div className="welcome-folder">
      <p>每个游戏版本都有自己的文件夹，用来存放世界、模组和设置。</p>
      <div className="row">
        <button type="button" disabled={busy} onClick={() => void create('default')}>
          使用默认文件夹
        </button>
        <button type="button" disabled={busy} onClick={() => void create('choose')}>
          在其他位置新建
        </button>
      </div>
      {path ? (
        <p role="status" className="path-value">
          文件夹已就绪 · {path}
        </p>
      ) : (
        <small className="path-value">
          当前目录 ·{' '}
          {state.settings.instancesDir ||
            state.dataPath + (state.platform === 'win32' ? '\\instances' : '/instances')}
        </small>
      )}
    </div>
  );
}

export function Welcome({
  state,
  run,
  onFinish,
}: {
  state: Snapshot;
  run: Run;
  onFinish: (create: boolean) => void;
}) {
  const progress = state.welcome!;
  const step = progress.step === 'done' ? 'start' : progress.step;
  const player = 'player' in progress ? progress.player : 'new';
  const index = steps.indexOf(step);
  const section = welcomeSection(progress);
  const configured = section && state.welcomeConfigured?.includes(section);
  const markConfigured = useCallback(() => {
    if (section) void run(() => api.markWelcomeConfigured(section));
  }, [section, run]);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const save = async (next: WelcomeProgress, create = false) => {
    setBusy(true);
    const saved = await run(async () => {
      await api.setWelcome(next);
      return true;
    });
    setBusy(false);
    if (saved && next.step === 'done') onFinish(create);
  };
  const move = (offset: number) => {
    const next = steps[index + offset];
    if (next === 'start') void save({ step: 'start' });
    else if (next) void save({ step: next, player });
  };
  return (
    <section className="welcome-layout" aria-label="首次使用引导">
      <aside className="welcome-rail">
        <div className="welcome-brand">
          <Brand small /> KJMCL
        </div>
        <ol aria-label="设置步骤">
          {labels.map((label, i) => (
            <li
              key={label}
              aria-current={i === index ? 'step' : undefined}
              className={i < index ? 'past' : ''}
            >
              <span aria-hidden="true" />
              {label}
            </li>
          ))}
        </ol>
      </aside>
      <div className="welcome-page">
        <header className={'welcome-banner' + (index === 0 || step === 'finish' ? ' scenic' : '')}>
          <small>
            {index + 1} / {steps.length}
          </small>
          <h2 ref={heading} tabIndex={-1}>
            {step === 'folders' && player === 'returning' ? '找回已有游戏' : titles[index]}
          </h2>
        </header>
        <div className="welcome-body" key={step}>
          {step === 'start' && (
            <>
              <p>你以前玩过 Minecraft Java 版吗？</p>
              <div className="welcome-choices">
                {(['new', 'returning'] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    disabled={busy}
                    onClick={() => void save({ step: 'folders', player: value })}
                  >
                    <ItemArt name={value === 'new' ? 'block' : 'versions'} size={40} />
                    <strong>{value === 'new' ? '第一次玩' : '我玩过'}</strong>
                    <small>
                      {value === 'new' ? '从新建游戏文件夹开始' : '带上已有的版本和存档'}
                    </small>
                  </button>
                ))}
              </div>
            </>
          )}
          {step === 'folders' && (
            <>
              {player === 'new' ? (
                <NewGameDirectory state={state} run={run} />
              ) : (
                <LauncherImport state={state} run={run} onConfigured={markConfigured} />
              )}
              <details className="welcome-more">
                <summary>启动器数据位置</summary>
                <StorageSettings state={state} run={run} />
              </details>
            </>
          )}
          {step === 'java' && <WelcomeJava state={state} run={run} />}
          {step === 'account' && (
            <AccountSetup welcome state={state} run={run} onConfigured={markConfigured} />
          )}
          {step === 'assistant' && <WelcomeAssistant onConfigured={markConfigured} />}
          {step === 'finish' && (
            <>
              <p>
                {state.instances.length
                  ? '从首页选择已有版本，使用你的账户启动游戏。'
                  : '接下来创建第一个游戏实例，选好版本，再点击「安装游戏」。'}
              </p>
              <dl className="welcome-summary">
                <div>
                  <dt>游戏实例</dt>
                  <dd>{state.instances.length ? state.instances.length + ' 个' : '尚未创建'}</dd>
                </div>
                <div>
                  <dt>当前账户</dt>
                  <dd>
                    {state.accounts.find((a) => a.id === state.selectedAccountId)?.name ||
                      '尚未选择'}
                  </dd>
                </div>
              </dl>
              <small>以后可在设置中导入游戏，在侧栏管理账户和助手。</small>
            </>
          )}
        </div>
        <footer className="welcome-footer">
          {index === 0 ? (
            <button
              type="button"
              disabled={busy}
              className="text-button"
              title="跳过整个欢迎引导"
              onClick={() => void save({ step: 'done' })}
            >
              跳过
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => move(-1)}>
              上一步
            </button>
          )}
          {step === 'finish' ? (
            <div className="row">
              {!state.instances.length && (
                <button type="button" disabled={busy} onClick={() => void save({ step: 'done' })}>
                  进入首页
                </button>
              )}
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void save({ step: 'done' }, !state.instances.length)}
              >
                {state.instances.length ? '进入首页' : '创建游戏实例'}
              </button>
            </div>
          ) : (
            index > 0 && (
              <button type="button" className="primary" disabled={busy} onClick={() => move(1)}>
                {configured ? '下一步' : '跳过'}
              </button>
            )
          )}
        </footer>
      </div>
    </section>
  );
}
