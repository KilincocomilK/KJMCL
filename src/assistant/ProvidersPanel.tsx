import { matchesSearch } from '../../shared/search';
import { useState } from 'react';
import {
  Aperture,
  Boxes,
  Check,
  CircleCheck,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Minus,
  Monitor,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Search,
  Server,
  Trash2,
  Waves,
} from 'lucide-react';
import type { AiProvider, AiProviderInput, AiState } from '../../shared/assistant';
import { api } from '../api';
import { Field, Modal, Switch } from '../components';
import { Feedback, Spinner, useAction } from './controls';

const inputs = ({ id, name, baseUrl, enabled, models }: AiProvider): AiProviderInput => ({
  id,
  name,
  baseUrl,
  enabled,
  models,
});
function ProviderMark({ url }: { url: string }) {
  const endpoint = new URL(url);
  const Icon =
    { 'api.deepseek.com': Waves, 'api.openai.com': Aperture, 'openrouter.ai': Route }[
      endpoint.hostname
    ] ?? (endpoint.port === '1234' ? Monitor : endpoint.protocol === 'http:' ? Cpu : Boxes);
  return (
    <span className="ai-provider-mark">
      <Icon size={17} />
    </span>
  );
}
export function ProvidersPanel({ data }: { data: AiState }) {
  const [selected, setSelected] = useState(data.selection?.providerId ?? data.providers[0]?.id);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const active = data.providers.find((p) => p.id === selected) ?? data.providers[0];
  const rows = data.providers.filter((p) => matchesSearch(query, p.name));
  return (
    <div className="ai-provider-layout">
      <aside className="ai-provider-rail" aria-label="服务商列表">
        <div className="ai-search input-well">
          <Search size={15} />
          <input
            aria-label="搜索服务商"
            placeholder="搜索服务商"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="ai-provider-list">
          {rows.map((p) => (
            <button
              key={p.id}
              className={active?.id === p.id ? 'selected' : ''}
              aria-pressed={active?.id === p.id}
              onClick={() => setSelected(p.id)}
            >
              <ProviderMark url={p.baseUrl} />
              <span>{p.name}</span>
              {!p.enabled && <small>已停用</small>}
            </button>
          ))}
          {!rows.length && <p className="ai-muted">没有匹配的服务商</p>}
        </div>
        <button onClick={() => setAdding(true)}>
          <Plus size={15} />
          添加服务商
        </button>
      </aside>
      {active ? (
        <ProviderEditor key={active.id} provider={active} selection={data.selection} />
      ) : (
        <div className="ai-empty">
          <Server />
          <h2>还没有服务商</h2>
          <button onClick={() => setAdding(true)}>添加服务商</button>
        </div>
      )}
      {adding && (
        <NewProvider
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setQuery('');
            setSelected(id);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}
export function NewProvider({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(''),
    [url, setUrl] = useState(''),
    [model, setModel] = useState(''),
    [key, setKey] = useState('');
  const { act, busy, feedback } = useAction();
  return (
    <Modal title="添加服务商" onClose={onClose}>
      <form
        className="form-body ai-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act('save', async () => {
            const id = crypto.randomUUID();
            await api.aiSaveProvider({
              id,
              name: name.trim(),
              baseUrl: url.trim(),
              key: key.trim() || undefined,
              enabled: true,
              models: model.trim() ? [model.trim()] : [],
            });
            onSaved(id);
          });
        }}
      >
        <Field label="名称">
          <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="API 地址" hint="使用兼容 Chat Completions 的基础地址。">
          <input
            type="url"
            required
            placeholder="https://…/v1"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Field label="API 密钥（可选）">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            maxLength={4096}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
        <Field label="模型 ID（可选）">
          <input maxLength={192} value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Feedback feedback={feedback} />
        <div className="ai-actions">
          <button className="primary" disabled={!!busy}>
            添加
          </button>
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ProviderEditor({
  provider: p,
  selection,
}: {
  provider: AiProvider;
  selection: AiState['selection'];
}) {
  const [draft, setDraft] = useState<Partial<AiProviderInput>>({});
  const [reveal, setReveal] = useState(false),
    [remove, setRemove] = useState(false);
  const [adding, setAdding] = useState(false),
    [model, setModel] = useState(''),
    [query, setQuery] = useState('');
  const [limit, setLimit] = useState(50);
  const { act, busy, feedback } = useAction();
  const form = { ...inputs(p), ...draft };
  const dirty = Object.keys(draft).length > 0;
  const models = p.models.filter((name) => matchesSearch(query, name));
  const save = () =>
    act('save', async () => {
      await api.aiSaveProvider(form);
      setDraft({});
      setReveal(false);
      return '服务商已保存';
    });
  const manage = !p.enabled || dirty || !!busy;
  return (
    <section className="ai-provider-editor" aria-label="服务商设置">
      <div className="ai-line ai-provider-heading">
        <h2>
          <ProviderMark url={p.baseUrl} />
          {draft.name === undefined ? (
            <>
              {p.name}
              <button
                className="icon"
                title="重命名"
                aria-label="重命名服务商"
                onClick={() => setDraft({ ...draft, name: p.name })}
              >
                <Pencil size={13} />
              </button>
            </>
          ) : (
            <input
              autoFocus
              aria-label="服务商名称"
              maxLength={60}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          )}
        </h2>
        <div className="ai-actions">
          <Switch
            showLabel
            label="启用"
            checked={form.enabled}
            disabled={!!busy}
            onChange={() => {
              if (dirty) setDraft({ ...draft, enabled: !form.enabled });
              else
                void act('enable', () => api.aiSaveProvider({ ...inputs(p), enabled: !p.enabled }));
            }}
          />
          <button
            className="icon"
            aria-label="删除服务商"
            title="删除服务商"
            onClick={() => setRemove(true)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <form
        className="ai-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div>
          <label htmlFor="ai-key" className="ai-label">
            API 密钥
          </label>
          <div className="ai-input-row">
            <div className="ai-key-input input-well">
              <KeyRound size={14} />
              <input
                id="ai-key"
                type={reveal ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  draft.key === ''
                    ? '保存后移除密钥'
                    : p.hasKey
                      ? '••••••••  已保存'
                      : '输入密钥，本地服务可留空'
                }
                value={draft.key ?? ''}
                onChange={(e) => setDraft({ ...draft, key: e.target.value })}
              />
              {draft.key ? (
                <button
                  type="button"
                  className="icon"
                  aria-label={reveal ? '隐藏输入' : '显示输入'}
                  onClick={() => setReveal(!reveal)}
                >
                  {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              ) : (
                p.hasKey &&
                draft.key !== '' && (
                  <button
                    type="button"
                    className="icon"
                    aria-label="清除密钥"
                    title="清除密钥"
                    onClick={() => setDraft({ ...draft, key: '' })}
                  >
                    <Minus size={14} />
                  </button>
                )
              )}
            </div>
            <button
              type="button"
              disabled={manage}
              onClick={() =>
                void act(
                  'test',
                  async () => '连接成功 · ' + (await api.aiTestProvider(p.id)) + ' 个模型',
                )
              }
            >
              {busy === 'test' ? <Spinner /> : <CircleCheck size={14} />}检测
            </button>
          </div>
        </div>
        <Field
          label="API 地址"
          hint={
            p.hasKey && draft.baseUrl && draft.baseUrl.replace(/\/+$/, '') !== p.baseUrl
              ? '更换地址后需要重新填写密钥。'
              : undefined
          }
        >
          <input
            type="url"
            required
            spellCheck={false}
            value={form.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
          />
        </Field>
        {dirty && (
          <div className="ai-actions">
            <button className="primary" disabled={!!busy}>
              保存设置
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft({});
                setReveal(false);
              }}
            >
              放弃更改
            </button>
          </div>
        )}
      </form>
      <div className="ai-model-section">
        <div className="ai-line">
          <h3>
            模型 <small>{p.models.length}</small>
          </h3>
          <div className="ai-actions">
            <button
              disabled={manage}
              onClick={() =>
                void act(
                  'sync',
                  async () => '已同步 · 服务端返回 ' + (await api.aiSyncModels(p.id)) + ' 个模型',
                )
              }
            >
              {busy === 'sync' ? <Spinner /> : <RefreshCw size={14} />}同步模型
            </button>
            <button
              disabled={manage}
              aria-label="手动添加模型"
              title="手动添加模型"
              onClick={() => setAdding(!adding)}
            >
              <Plus size={15} />
            </button>
          </div>
        </div>
        {adding && (
          <form
            className="ai-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              void act('add', async () => {
                if (p.models.includes(model.trim())) throw new Error('模型已在列表中');
                await api.aiSaveProvider({ ...inputs(p), models: [...p.models, model.trim()] });
                setModel('');
                setAdding(false);
              });
            }}
          >
            <input
              autoFocus
              aria-label="模型 ID"
              placeholder="模型 ID"
              required
              maxLength={192}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <button disabled={manage}>添加</button>
          </form>
        )}
        {p.models.length > 8 && (
          <div className="ai-search input-well">
            <Search size={14} />
            <input
              aria-label="搜索模型"
              placeholder="搜索模型"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(50);
              }}
            />
          </div>
        )}
        <div className="ai-model-list">
          {models.slice(0, limit).map((name) => {
            const current = selection?.providerId === p.id && selection.model === name;
            return (
              <div className="ai-model" key={name}>
                <button
                  disabled={manage}
                  aria-pressed={current}
                  title={'使用 ' + name}
                  onClick={() =>
                    void act('select', () => api.aiSelectModel({ providerId: p.id, model: name }))
                  }
                >
                  <Boxes size={14} />
                  <span>{name}</span>
                  {current && <Check size={15} />}
                </button>
                <button
                  className="icon"
                  disabled={!!busy || dirty}
                  aria-label={'移除模型 ' + name}
                  onClick={() =>
                    void act('remove-model', () =>
                      api.aiSaveProvider({
                        ...inputs(p),
                        models: p.models.filter((v) => v !== name),
                      }),
                    )
                  }
                >
                  <Minus size={14} />
                </button>
              </div>
            );
          })}
          {!models.length && (
            <p className="ai-model-empty">
              {query ? '没有匹配的模型' : '同步模型列表，或手动添加模型 ID。'}
            </p>
          )}
          {models.length > limit && (
            <button className="text-button" onClick={() => setLimit(limit + 50)}>
              显示更多
            </button>
          )}
        </div>
      </div>
      <Feedback feedback={feedback} />
      {remove && (
        <Modal title="删除服务商" onClose={() => setRemove(false)}>
          <div className="form-body">
            <p>删除「{p.name}」及其密钥？已有对话仍可查看。</p>
          </div>
          <div className="modal-footer">
            <button
              className="danger"
              disabled={!!busy}
              onClick={() => void act('remove-provider', () => api.aiRemoveProvider(p.id))}
            >
              删除
            </button>
            <button onClick={() => setRemove(false)}>取消</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
