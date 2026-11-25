import { useState } from 'react';
import { Cable, Copy, KeyRound, RefreshCw } from 'lucide-react';
import type { AiState } from '../../shared/assistant';
import { api } from '../api';
import { Switch } from '../components';
import { Changes } from './Changes';
import { Feedback, useAction } from './controls';

export function McpPanel({ data }: { data: AiState }) {
  const m = data.mcp;
  const [port, setPort] = useState(String(m.port));
  const { act, busy, feedback } = useAction();
  const portNumber = Number(port),
    valid = Number.isInteger(portNumber) && portNumber >= 1024 && portNumber <= 65535;
  const set = (enabled: boolean, allowChanges = m.allowChanges, nextPort = m.port) =>
    act('settings', () => api.aiSetMcp({ enabled, allowChanges, port: nextPort }));
  return (
    <div className="ai-mcp">
      <section className="ai-surface">
        <div className="ai-line">
          <h2>
            <Cable size={19} />
            本机 MCP 服务
          </h2>
          <Switch
            showLabel
            label={m.listening ? '运行中' : '已停止'}
            checked={m.listening}
            disabled={!!busy || (!valid && !m.listening)}
            onChange={() =>
              void set(!m.listening, m.allowChanges, m.listening ? m.port : portNumber)
            }
          />
        </div>
        <p className="ai-muted">通过 Streamable HTTP，将本机 Agent 接入启动器。</p>
        <div className="ai-mcp-address">
          <div>
            <span className="ai-label">服务地址</span>
            <code>{m.url}</code>
          </div>
          <div>
            <label className="ai-label" htmlFor="mcp-port">
              端口
            </label>
            <div className="ai-input-row">
              <input
                id="mcp-port"
                type="number"
                min="1024"
                max="65535"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
              {portNumber !== m.port && (
                <button
                  disabled={!valid || !!busy}
                  onClick={() => void set(m.listening, m.allowChanges, portNumber)}
                >
                  保存
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="ai-permission">
          <div>
            <strong>允许提交修改</strong>
            <small>在启动器内确认后应用。</small>
          </div>
          <Switch
            label="允许提交修改"
            checked={m.allowChanges}
            disabled={!!busy}
            onChange={() => void set(m.listening, !m.allowChanges)}
          />
        </div>
        <div className="ai-actions">
          <button
            className="primary"
            disabled={!m.listening || !!busy}
            onClick={() =>
              void act('copy', async () => {
                await api.aiCopyMcp('config');
                return '已复制连接配置（含访问令牌）';
              })
            }
          >
            <Copy size={15} />
            复制连接配置
          </button>
          <button
            disabled={!m.listening || !!busy}
            onClick={() =>
              void act('token', async () => {
                await api.aiCopyMcp('token');
                return '已复制访问令牌';
              })
            }
          >
            <KeyRound size={14} />
            复制令牌
          </button>
          <button
            className="text-button"
            disabled={!m.listening || !!busy}
            onClick={() =>
              void act('rotate', async () => {
                await api.aiRotateMcp();
                return '旧令牌已失效，请更新 Agent 的连接配置';
              })
            }
          >
            <RefreshCw size={14} />
            轮换令牌
          </button>
        </div>
        {m.enabled && !m.listening && (
          <button className="text-button" disabled={!!busy} onClick={() => void set(false)}>
            取消下次自动启动
          </button>
        )}
        {m.error && !feedback.error && (
          <p role="alert" className="ai-feedback failed">
            {m.error}
          </p>
        )}
        <Feedback feedback={feedback} />
      </section>
      <Changes changes={data.changes.filter((p) => p.source === 'mcp')} />
    </div>
  );
}
