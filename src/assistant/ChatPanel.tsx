import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, MessageSquare, Plus, RotateCcw, Settings2, Square, Trash2 } from 'lucide-react';
import type { AiMessage, AiSend, AiState } from '../../shared/assistant';
import { assistantScenarios } from '../../shared/assistant-scenarios';
import { changeLabels } from '../../shared/assistant-display';
import type { Snapshot } from '../../shared/types';
import { api } from '../api';
import { ItemArt } from '../components/ItemArt';
import { SplitView } from '../components/SplitView';
import { Select } from '../Select';
import { Changes } from './Changes';
import { errorText, Feedback, Spinner, useAction } from './controls';

function Reply({ text }: { text: string }) {
  // All model output is rendered as React text nodes, including fenced blocks.
  return (
    <>
      {text.split(/(\x60\x60\x60[\s\S]*?(?:\x60\x60\x60|$))/g).map((part, index) => {
        if (part.startsWith('\x60\x60\x60'))
          return (
            <pre key={index}>
              <code>{part.replace(/^\x60{3}[^\n]*\n?/, '').replace(/\x60{3}$/, '')}</code>
            </pre>
          );
        return (
          <Fragment key={index}>
            {part
              .split(/(\*\*[^*\n]+\*\*)/g)
              .map((line, i) =>
                line.startsWith('**') && line.endsWith('**') ? (
                  <strong key={i}>{line.slice(2, -2)}</strong>
                ) : (
                  line
                ),
              )}
          </Fragment>
        );
      })}
    </>
  );
}
export function ChatPanel({
  data,
  launcher,
  onProviders,
  diagnosis,
  onDiagnosisReady,
}: {
  data: AiState;
  launcher: Snapshot;
  onProviders: () => void;
  diagnosis?: { id: string; instanceId: string };
  onDiagnosisReady: () => void;
}) {
  const [id, setId] = useState<string>(
    () => data.run?.chatId ?? data.chats[0]?.id ?? crypto.randomUUID(),
  );
  const [scope, setScope] = useState(launcher.selectedInstanceId ?? '');
  const [mode, setMode] = useState<AiSend['mode']>('assist');
  const [text, setText] = useState(''),
    [deleting, setDeleting] = useState('');
  const [record, setRecord] = useState<{ id: string; messages: AiMessage[] }>();
  const [readError, setReadError] = useState('');
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const viewport = useRef<HTMLDivElement>(null),
    pinned = useRef(true),
    inputRef = useRef<HTMLTextAreaElement>(null);
  const { act, busy, feedback } = useAction();
  const session = data.chats.find((s) => s.id === id);
  const selection = session ?? data.selection;
  const provider = data.providers.find((p) => p.id === selection?.providerId);
  const ready = !!(
    provider?.enabled &&
    selection &&
    provider.models.includes(selection.model) &&
    (!session || session.baseUrl === provider.baseUrl)
  );
  const chatScope = session ? (session.instanceId ?? '') : scope;
  const chatMode = session?.mode ?? mode;
  const run = data.run?.chatId === id ? data.run : undefined;
  const messages = record?.id === id ? record.messages : [];
  const changes = data.changes.filter((p) => p.chatId === id);
  const revision = session?.updatedAt;
  useEffect(() => {
    if (!diagnosis) return;
    setId(diagnosis.id);
    setScope(diagnosis.instanceId);
    setMode('assist');
    setText(assistantScenarios.find((s) => s.name === 'diagnose_launch')!.text);
    pinned.current = true;
    onDiagnosisReady();
  }, [diagnosis, onDiagnosisReady]);
  useEffect(() => {
    let current = true;
    setReadError('');
    if (revision !== undefined)
      void api
        .aiHistory(id)
        .then((rows) => {
          if (current) setRecord({ id, messages: rows });
        })
        .catch((e) => {
          if (current) setReadError(errorText(e));
        });
    return () => {
      current = false;
    };
  }, [id, revision, historyRefresh]);
  useLayoutEffect(() => {
    if (pinned.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [id, record, run?.text, run?.activity, data.changes]);
  function selectChat(next: string) {
    pinned.current = true;
    setId(next);
    setText('');
    setDeleting('');
  }
  const fresh = () => {
    selectChat(crypto.randomUUID());
    setScope(launcher.selectedInstanceId ?? '');
    inputRef.current?.focus();
  };
  const send = (message: string, retry = false) => {
    if (!message.trim() || busy || data.run || !ready || !selection) return;
    const value = message.trim();
    pinned.current = true;
    if (!retry) setText('');
    void act('send', async () => {
      try {
        await api.aiSend({
          chatId: id,
          providerId: selection.providerId,
          model: selection.model,
          instanceId: chatMode === 'assist' ? chatScope || undefined : session?.instanceId,
          mode: chatMode,
          text: value,
          retry,
        });
      } catch (e) {
        if (!retry) setText((draft) => draft || value);
        throw e;
      }
    });
  };
  const last = messages.at(-1);
  const retry =
    last?.role === 'user'
      ? last.text
      : last?.role === 'error' && messages.at(-2)?.role === 'user'
        ? messages.at(-2)?.text
        : undefined;
  const value = selection ? JSON.stringify([selection.providerId, selection.model]) : '';
  const options = data.providers.filter((p) => p.enabled && p.models.length);
  return (
    <SplitView
      className="chat-layout"
      railLabel="对话历史"
      rail={
        <>
          <div className="pane-heading">
            <h2>对话历史</h2>
            <button
              className="icon"
              aria-label="新对话"
              title="新对话"
              disabled={!!data.run}
              onClick={fresh}
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="rail-list">
            {data.historyIssue && (
              <p className="ai-feedback failed" role="alert">
                {data.historyIssue}
              </p>
            )}
            {data.chats.length ? (
              <div className="ai-history">
                {data.chats.map((s) => (
                  <div className={'ai-history-row' + (s.id === id ? ' selected' : '')} key={s.id}>
                    <button
                      className="rail-option"
                      title={s.title}
                      aria-pressed={s.id === id}
                      onClick={() => selectChat(s.id)}
                    >
                      <MessageSquare size={15} />
                      <span>
                        <strong>{s.title}</strong>
                        <small>
                          {s.model} · {new Date(s.updatedAt).toLocaleDateString('zh-CN')}
                        </small>
                      </span>
                    </button>
                    {deleting === s.id ? (
                      <div className="history-delete-actions">
                        <button
                          className="danger"
                          onClick={() =>
                            void act('delete', async () => {
                              await api.aiDeleteChat(s.id);
                              if (id === s.id) fresh();
                              setDeleting('');
                            })
                          }
                        >
                          确认删除
                        </button>
                        <button onClick={() => setDeleting('')}>取消</button>
                      </div>
                    ) : (
                      <button
                        className="icon"
                        aria-label={'删除对话 ' + s.title}
                        disabled={data.run?.chatId === s.id}
                        onClick={() => setDeleting(s.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="rail-empty">暂无历史对话</p>
            )}
          </div>
        </>
      }
    >
      <div className="ai-chat">
        <div className="ai-chat-toolbar">
          <div className="ai-chat-selects">
            <Select
              aria-label="对话模型"
              value={value}
              disabled={!!session || !options.length || !!run}
              onChange={(e) => {
                const [providerId, model] = JSON.parse(e.target.value) as [string, string];
                void act('model', () => api.aiSelectModel({ providerId, model }));
              }}
            >
              {!selection && <option value="">尚未选择模型</option>}
              {session && (
                <option value={value}>
                  {provider?.name ?? '原服务商'} · {session.model}
                </option>
              )}
              {!session &&
                options.map((p) => (
                  <optgroup key={p.id} label={p.name}>
                    {p.models.map((name) => (
                      <option key={name} value={JSON.stringify([p.id, name])}>
                        {p.name} · {name}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </Select>
            <Select
              aria-label="对话范围"
              disabled={!!session || !!run || chatMode === 'chat'}
              value={chatMode === 'chat' ? '' : chatScope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="">{chatMode === 'chat' ? '普通对话' : '启动器'}</option>
              {chatScope && !launcher.instances.some((i) => i.id === chatScope) && (
                <option value={chatScope}>实例已移除</option>
              )}
              {launcher.instances.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div
          className="ai-transcript"
          ref={viewport}
          onScroll={(e) => {
            const v = e.currentTarget;
            pinned.current = v.scrollHeight - v.scrollTop - v.clientHeight < 90;
          }}
        >
          {data.run && !run && (
            <button className="text-button" onClick={() => selectChat(data.run!.chatId)}>
              <Spinner />
              返回正在生成的对话
            </button>
          )}
          {!session && !run && (
            <div className="ai-welcome">
              <span className="ai-assistant-mark">
                <ItemArt name="robot" size={64} />
              </span>
              <h2>{ready ? '想调整什么？' : '连接你的模型'}</h2>
              {ready ? (
                <div className="ai-suggestions">
                  {assistantScenarios
                    .filter((s) =>
                      chatScope
                        ? s.name !== 'configure_downloads'
                        : s.name === 'configure_downloads',
                    )
                    .map((s) => (
                      <button
                        key={s.name}
                        onClick={() => {
                          setText(s.text);
                          inputRef.current?.focus();
                        }}
                      >
                        {s.title}
                      </button>
                    ))}
                </div>
              ) : (
                <>
                  <button onClick={onProviders}>
                    <Settings2 size={15} />
                    配置模型服务
                  </button>
                </>
              )}
            </div>
          )}
          {session && !ready && (
            <div className="ai-inline-note">
              原模型服务不可用。
              <button className="text-button" onClick={onProviders}>
                检查服务
              </button>
            </div>
          )}
          {readError && (
            <p role="alert" className="ai-feedback failed">
              {readError}
              <button onClick={() => setHistoryRefresh((n) => n + 1)}>重新读取</button>
            </p>
          )}
          <div className="ai-messages" role="log" aria-label="对话消息">
            {messages.map((m, index) =>
              m.change &&
              changes.some((p) => p.id === m.change?.id && p.status === 'pending') ? null : (
                <div key={index} className={'ai-message ' + m.role}>
                  <small>
                    {m.change
                      ? changeLabels[
                          changes.find((p) => p.id === m.change?.id)?.status ?? m.change.status
                        ]
                      : {
                          user: '你',
                          assistant: session?.model ?? '助手',
                          error: '回复提示',
                          activity: '启动器',
                        }[m.role]}
                  </small>
                  <div>{m.role === 'assistant' ? <Reply text={m.text} /> : m.text}</div>
                </div>
              ),
            )}
            {run && (
              <div className="ai-message assistant">
                <small>
                  <Spinner />
                  {run.activity}
                </small>
                <div>
                  <Reply text={run.text} />
                </div>
              </div>
            )}
          </div>
          {retry && !run && ready && !busy && (
            <button className="text-button" onClick={() => send(retry, true)}>
              <RotateCcw size={13} />
              重新生成
            </button>
          )}
          <Changes changes={changes} />
        </div>
        <Feedback feedback={feedback} />
        <div className="ai-composer input-well">
          <textarea
            ref={inputRef}
            aria-label="消息"
            placeholder={ready ? '输入消息…' : '请先配置模型服务'}
            disabled={!ready}
            rows={2}
            maxLength={8000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.nativeEvent.keyCode !== 229
              ) {
                e.preventDefault();
                send(text);
              }
            }}
          />
          <div className="ai-line">
            <Select
              aria-label="对话模式"
              value={chatMode}
              disabled={!!session || !!data.run}
              onChange={(e) => setMode(e.target.value as AiSend['mode'])}
            >
              <option value="assist">配置助手</option>
              <option value="chat">普通对话</option>
            </Select>
            {run ? (
              <button
                onClick={() => void api.aiCancel(id).catch((e) => setReadError(errorText(e)))}
              >
                <Square size={13} />
                停止
              </button>
            ) : (
              <button
                className="primary"
                disabled={!ready || !text.trim() || !!busy || !!data.run}
                onClick={() => send(text)}
              >
                <ArrowUp size={15} />
                发送
              </button>
            )}
          </div>
        </div>
      </div>
    </SplitView>
  );
}
