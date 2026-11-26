import { useEffect, useId, useState } from 'react';
import type { AiProvider, AiState } from '../../shared/assistant';
import { api } from '../api';
import { Field } from '../components';
import { Select } from '../Select';
import { NewProvider } from '../assistant/ProvidersPanel';
import { errorText, Feedback, useAction } from '../assistant/controls';
import '../assistant/assistant.css';

export function WelcomeAssistant({ onConfigured }: { onConfigured?: () => void }) {
  const [data, setData] = useState<AiState>();
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    let active = true;
    setLoadError('');
    void api.aiState().then(
      (next) => {
        if (active) setData(next);
      },
      (error) => {
        if (active) setLoadError(errorText(error));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  if (loadError)
    return (
      <div role="alert">
        {loadError} <button onClick={() => setAttempt(attempt + 1)}>重试</button>
      </div>
    );
  if (!data) return <p role="status">正在读取模型服务…</p>;
  const provider =
    data.providers.find((item) => item.id === (selected || data.selection?.providerId)) ??
    data.providers[0];
  return (
    <>
      <p>接入模型后，可向助手询问启动设置或排查游戏崩溃。</p>
      <div className="form-body panel">
        <Field label="模型服务" hint={provider?.baseUrl}>
          <Select
            aria-label="模型服务"
            value={provider?.id ?? 'new'}
            onChange={(event) => {
              const id = event.target.value;
              if (id === 'new') setAdding(true);
              else setSelected(id);
            }}
          >
            {data.providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
            <option value="new">添加服务商…</option>
          </Select>
        </Field>
        {provider ? (
          <WelcomeModel
            key={provider.id}
            provider={provider}
            onConfigured={onConfigured}
            selectedModel={data.selection?.providerId === provider.id ? data.selection.model : ''}
            reload={async () => {
              const next = await api.aiState();
              setData(next);
              return next;
            }}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)}>
            添加服务商
          </button>
        )}
      </div>
      {adding && (
        <NewProvider
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setSelected(id);
            setAttempt(attempt + 1);
            setAdding(false);
            onConfigured?.();
          }}
        />
      )}
    </>
  );
}

function WelcomeModel({
  provider,
  selectedModel,
  reload,
  onConfigured,
}: {
  provider: AiProvider;
  selectedModel: string;
  reload: () => Promise<AiState>;
  onConfigured?: () => void;
}) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState(selectedModel || provider.models[0] || '');
  const { act, busy, feedback } = useAction();
  const list = useId();
  const hasNewKey = !!key.trim();
  const saveProvider = async (models: string[]) => {
    const { id, name, baseUrl } = provider;
    await api.aiSaveProvider({
      id,
      name,
      baseUrl,
      enabled: true,
      models,
      key: key.trim() || undefined,
    });
    setKey('');
    if (hasNewKey || !provider.enabled || models.length !== provider.models.length)
      onConfigured?.();
  };
  return (
    <form
      className="ai-form"
      onSubmit={(e) => {
        e.preventDefault();
        void act('save', async () => {
          const id = model.trim();
          await saveProvider([...new Set([...provider.models, id])]);
          await api.aiSelectModel({ providerId: provider.id, model: id });
          if (id !== selectedModel) onConfigured?.();
          await reload();
          return '已选用 ' + id;
        });
      }}
    >
      <Field label="API 密钥" hint={hasNewKey ? '密钥待保存' : undefined}>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          maxLength={4096}
          disabled={!!busy}
          placeholder={provider.hasKey ? '已加密保存' : '本地服务可留空'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </Field>
      <Field label="模型 ID">
        <input
          required
          maxLength={192}
          list={list}
          disabled={!!busy}
          value={model}
          placeholder="填写模型 ID 或读取列表"
          onChange={(e) => setModel(e.target.value)}
        />
        <datalist id={list}>
          {provider.models.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      </Field>
      <div className="row">
        <button className="primary" disabled={!!busy || !model.trim()}>
          保存并使用
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() =>
            void act('sync', async () => {
              if (hasNewKey || !provider.enabled) await saveProvider(provider.models);
              let next;
              let count;
              try {
                count = await api.aiSyncModels(provider.id);
              } finally {
                next = await reload();
              }
              const updated = next.providers.find((item) => item.id === provider.id)?.models;
              if (
                updated &&
                (updated.length !== provider.models.length ||
                  updated.some((id, index) => id !== provider.models[index]))
              )
                onConfigured?.();
              if (updated?.[0] && !model) setModel(updated[0]);
              return count ? '已读取 ' + count + ' 个模型' : '服务未返回模型，可手动填写模型 ID';
            })
          }
        >
          {busy === 'sync' ? '读取中…' : hasNewKey ? '保存密钥并读取模型' : '读取模型'}
        </button>
      </div>
      <Feedback feedback={feedback} />
    </form>
  );
}
