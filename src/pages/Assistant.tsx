import { useCallback, useEffect, useRef, useState } from 'react';
import { Cable, MessagesSquare, SlidersHorizontal } from 'lucide-react';
import type { AiState } from '../../shared/assistant';
import type { Snapshot } from '../../shared/types';
import { api } from '../api';
import { ChatPanel } from '../assistant/ChatPanel';
import { ProvidersPanel } from '../assistant/ProvidersPanel';
import { McpPanel } from '../assistant/McpPanel';
import { errorText } from '../assistant/controls';
import '../assistant/assistant.css';

const tabs = [
  { id: 'chat', title: '对话', icon: MessagesSquare },
  { id: 'providers', title: '模型服务', icon: SlidersHorizontal },
  { id: 'mcp', title: 'MCP 接入', icon: Cable },
] as const;
export default function AssistantPage({
  state,
  active,
  diagnosis,
  onDiagnosisReady,
}: {
  state: Snapshot;
  active: boolean;
  diagnosis?: { id: string; instanceId: string };
  onDiagnosisReady: () => void;
}) {
  const [data, setData] = useState<AiState>();
  const [error, setError] = useState('');
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>(
    state.assistantPending ? 'mcp' : 'chat',
  );
  const version = useRef(0);
  useEffect(() => {
    if (diagnosis) setTab('chat');
  }, [diagnosis]);
  const refresh = useCallback(async () => {
    const current = ++version.current;
    try {
      const next = await api.aiState();
      if (current === version.current) {
        setData(next);
        setError('');
      }
    } catch (e) {
      if (current === version.current) setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const off = api.onEvent((e) => {
      if (e.type === 'assistant') void refresh();
      if (e.type === 'assistant-progress') setData((old) => old && { ...old, run: e.progress });
    });
    return () => {
      version.current++;
      off();
    };
  }, [active, refresh]);
  const pending = data?.changes.filter((p) => p.status === 'pending') ?? [];
  const nextExpiry = Math.min(...pending.map((p) => p.expiresAt));
  useEffect(() => {
    if (active && Number.isFinite(nextExpiry)) {
      const timer = setTimeout(() => void refresh(), Math.max(100, nextExpiry - Date.now() + 50));
      return () => clearTimeout(timer);
    }
  }, [nextExpiry, refresh, active]);
  return (
    <div hidden={!active} className="ai-page">
      <div role="tablist" aria-label="AI 助手" className="ai-tabs">
        {tabs.map(({ id, title, icon: Icon }, index) => (
          <button
            key={id}
            id={'ai-tab-' + id}
            role="tab"
            aria-selected={tab === id}
            aria-controls={'ai-panel-' + id}
            tabIndex={id === tab ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
              e.preventDefault();
              const n =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? 2
                    : (index + (e.key === 'ArrowLeft' ? 2 : 1)) % 3;
              setTab(tabs[n].id);
              document.getElementById('ai-tab-' + tabs[n].id)?.focus();
            }}
          >
            <Icon size={15} />
            {title}
            {id === 'mcp' && pending.some((p) => p.source === 'mcp') && <i className="ai-dot" />}
          </button>
        ))}
      </div>
      {error && (
        <div className="ai-feedback failed" role="alert">
          {error} <button onClick={() => void refresh()}>重试</button>
        </div>
      )}
      {!data && !error && <p role="status">正在读取助手设置…</p>}
      {data && (
        <>
          <div
            id="ai-panel-chat"
            aria-labelledby="ai-tab-chat"
            className="ai-chat-panel"
            role="tabpanel"
            hidden={tab !== 'chat'}
          >
            <ChatPanel
              data={data}
              launcher={state}
              onProviders={() => setTab('providers')}
              diagnosis={diagnosis}
              onDiagnosisReady={onDiagnosisReady}
            />
          </div>
          <div
            id="ai-panel-providers"
            aria-labelledby="ai-tab-providers"
            role="tabpanel"
            hidden={tab !== 'providers'}
          >
            <ProvidersPanel data={data} />
          </div>
          <div
            id="ai-panel-mcp"
            aria-labelledby="ai-tab-mcp"
            role="tabpanel"
            hidden={tab !== 'mcp'}
          >
            <McpPanel data={data} />
          </div>
        </>
      )}
    </div>
  );
}
