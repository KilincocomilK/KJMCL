import { Select } from '../Select';
import { useEffect, useState } from 'react';
import { Copy, Download, Play, Radio, Users } from 'lucide-react';
import type { Snapshot, TerracottaState } from '../../shared/types';
import { api } from '../api';
import type { Run } from '../ui';
const labels: Record<string, string> = {
  offline: '未连接',
  'host-scanning': '等待世界对局域网开放',
  'host-starting': '正在创建房间',
  'host-ok': '房间已开放',
  'guest-connecting': '正在连接房主',
  'guest-starting': '正在建立连接',
  'guest-ok': '已加入房间',
  exception: '联机异常',
};
export function MultiplayerPage({ state, run }: { state: Snapshot; run: Run }) {
  const [status, setStatus] = useState<TerracottaState>(),
    [room, setRoom] = useState(''),
    [player, setPlayer] = useState(
      state.accounts.find((a) => a.id === state.selectedAccountId)?.name ?? '',
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const s = await api.terracottaStatus();
        if (!disposed) {
          setStatus(s);
          setError('');
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      } finally {
        if (!disposed) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);
  const action = async (work: () => Promise<unknown>) => {
    setBusy(true);
    await run(async () => {
      await work();
      setStatus(await api.terracottaStatus());
    });
    setBusy(false);
  };
  const installing = state.tasks.some((t) => t.status === 'running' && t.title === '安装陶瓦联机');
  const waiting = status?.connected && status.state === 'waiting';
  const selected = state.instances.find((i) => i.id === state.selectedInstanceId);
  const copy = (text: string) =>
    void run(async () => navigator.clipboard.writeText(text), '已复制');
  return (
    <div className="multiplayer-page">
      <section className="panel multiplayer-header">
        <Radio size={32} />
        <div>
          <h2>
            陶瓦联机{' '}
            {status?.state !== 'waiting' && (
              <span className="status">
                {status ? (labels[status.state] ?? status.state) : '正在读取…'}
              </span>
            )}
          </h2>
          <small>Terracotta © Burning_TNT 及贡献者 · 基于 EasyTier</small>
        </div>
        {status?.version && <small>{status.version}</small>}
      </section>
      <div className="toolbar">
        <Select
          aria-label="联机游戏实例"
          value={selected?.id ?? ''}
          onChange={(e) => void run(() => api.select({ instanceId: e.target.value }))}
        >
          <option value="" disabled>
            选择游戏实例
          </option>
          {state.instances.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} · {i.version}
            </option>
          ))}
        </Select>
        <button
          disabled={
            !selected ||
            selected.status !== 'ready' ||
            state.running.includes(selected.id) ||
            !state.selectedAccountId
          }
          onClick={() => selected && void run(() => api.launch(selected.id))}
        >
          <Play size={16} />
          启动游戏
        </button>
        <button
          disabled={busy || installing || status?.connected}
          onClick={() => void action(() => api.startTerracotta())}
        >
          启动 / 连接
        </button>
        {!status?.installed && (
          <button
            className="primary"
            disabled={busy || installing || status?.connected}
            onClick={() => void action(() => api.installTerracotta())}
          >
            <Download size={16} />
            {installing ? '正在安装…' : '安装陶瓦组件'}
          </button>
        )}
      </div>
      {(error || status?.error) && (
        <p className="multiplayer-error" role="alert">
          {error || status?.error}
        </p>
      )}
      {!status?.connected && (
        <p className="muted">
          首次使用请安装官方组件。macOS 请先运行官方陶瓦应用，再点击连接。下载进度见“下载任务”。
        </p>
      )}
      <section className="panel multiplayer-identity">
        <label>
          玩家名称
          <input
            value={player}
            maxLength={64}
            placeholder="输入游戏中的名字"
            disabled={busy || (!!status?.connected && !waiting)}
            onChange={(e) => setPlayer(e.target.value)}
          />
        </label>
      </section>
      <div className="multiplayer-grid">
        <section className="panel">
          <h3>创建房间</h3>
          <p>启动游戏 → 进入世界 → 对局域网开放，再创建房间。</p>
          <button
            className="primary"
            disabled={busy || !waiting || !player.trim()}
            onClick={() =>
              void action(() => api.controlTerracotta({ action: 'host', player: player.trim() }))
            }
          >
            <Users size={16} />
            创建房间
          </button>
        </section>
        <section className="panel">
          <h3>加入好友</h3>
          <p>使用与房主兼容的游戏版本和模组。</p>
          <label>
            房间邀请码
            <input
              value={room}
              placeholder="粘贴好友的邀请码"
              maxLength={256}
              onChange={(e) => setRoom(e.target.value)}
              disabled={busy || !waiting}
            />
          </label>
          <button
            className="primary"
            disabled={busy || !waiting || !room.trim() || !player.trim()}
            onClick={() =>
              void action(() =>
                api.controlTerracotta({ action: 'join', room: room.trim(), player: player.trim() }),
              )
            }
          >
            加入房间
          </button>
        </section>
      </div>
      {status?.connected && status.state !== 'waiting' && (
        <section className="panel multiplayer-room">
          <div className="row">
            <h3>{labels[status.state]}</h3>
            <button
              disabled={busy}
              onClick={() => void action(() => api.controlTerracotta({ action: 'leave' }))}
            >
              {status.state === 'exception' ? '重置状态' : '退出 / 关闭房间'}
            </button>
          </div>
          {status.room && (
            <label>
              房间邀请码
              <div className="copy-field">
                <input readOnly value={status.room} />
                <button aria-label="复制邀请码" onClick={() => copy(status.room!)}>
                  <Copy size={16} />
                </button>
              </div>
            </label>
          )}
          {status.address && (
            <label>
              游戏内直连地址
              <div className="copy-field">
                <input readOnly value={status.address} />
                <button aria-label="复制直连地址" onClick={() => copy(status.address!)}>
                  <Copy size={16} />
                </button>
              </div>
            </label>
          )}
          {status.state === 'guest-ok' && (
            <p>打开 Minecraft 多人游戏，选择局域网列表中的陶瓦大厅；也可使用上方地址直连。</p>
          )}
          {status.difficulty && <p>连接难度：{status.difficulty}</p>}
          {status.members.length > 0 && (
            <>
              <h4>房间成员 · {status.members.length}</h4>
              <div className="member-list">
                {status.members.map((m, i) => (
                  <div key={i}>
                    <Users size={16} />
                    <strong>{m.name}</strong>
                    <span>{m.kind === 'HOST' ? '房主' : m.kind === 'LOCAL' ? '本机' : '玩家'}</span>
                    <small>{m.vendor}</small>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}
      <footer className="terracotta-credit">
        Terracotta / 陶瓦联机 © Burning_TNT 及贡献者 · 基于 EasyTier ·
        AGPL-3.0-or-later（含集成例外）
        <button
          className="text-button"
          onClick={() => void run(() => api.external('https://burningtnt.github.io/Terracotta/'))}
        >
          官方文档与下载
        </button>
      </footer>
    </div>
  );
}
