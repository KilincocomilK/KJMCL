import { randomUUID } from 'node:crypto';
import { fetch } from 'undici';
import type { Network } from '../network';
import type { Secrets } from '../vault';
import { AssistantStorage, type StoredProvider } from './storage';
import {
  modelId,
  modelList,
  type AiProviderInput,
  type ModelSelection,
} from '../../../shared/assistant';

export class Providers {
  private editing = false;
  private shutdown = new AbortController();
  stopRequests() {
    this.shutdown.abort();
    this.shutdown = new AbortController();
  }
  constructor(
    private storage: AssistantStorage,
    private vault: Secrets,
    private net: Network,
  ) {}
  list() {
    return this.storage.config.providers.map(({ credential, manualModels, ...provider }) => ({
      ...provider,
      hasKey: !!credential,
    }));
  }
  get(id: string) {
    const provider = this.storage.config.providers.find((item) => item.id === id);
    if (!provider) throw new Error('服务商不存在');
    return provider;
  }
  private replace(providers: StoredProvider[]) {
    const config = this.storage.config;
    const current = config.selection;
    const first = providers.find((p) => p.enabled && p.models.length);
    const selection =
      current &&
      providers.some(
        (p) => p.id === current.providerId && p.enabled && p.models.includes(current.model),
      )
        ? current
        : first && { providerId: first.id, model: first.models[0] };
    this.storage.configure({ ...config, providers, selection });
  }
  select(value: ModelSelection) {
    const p = this.get(value.providerId);
    if (!p.enabled || !p.models.includes(value.model)) throw new Error('模型未启用或已移除');
    this.storage.configure({ ...this.storage.config, selection: value });
  }
  private async edit<T>(work: () => Promise<T>) {
    if (this.editing) throw new Error('服务商设置正在保存');
    this.editing = true;
    try {
      return await work();
    } finally {
      this.editing = false;
    }
  }
  save(input: AiProviderInput) {
    return this.edit(async () => {
      const { key, ...fields } = input;
      const old = this.storage.config.providers.find((p) => p.id === fields.id);
      const baseUrl = new URL(fields.baseUrl).href.replace(/\/+$/, '');
      const keepKey = key === undefined && old?.baseUrl === baseUrl;
      const credential = keepKey ? old?.credential : key ? randomUUID() : undefined;
      if (credential && key) await this.vault.set('ai-' + credential, key);
      try {
        const manualModels = fields.models.filter(
          (model) => !old?.models.includes(model) || old.manualModels.includes(model),
        );
        const next = {
          ...fields,
          manualModels,
          models: old && old.baseUrl !== baseUrl ? manualModels : fields.models,
          baseUrl,
          credential,
        };
        const providers = this.storage.config.providers;
        this.replace(
          old ? providers.map((p) => (p.id === next.id ? next : p)) : [...providers, next],
        );
      } catch (error) {
        if (credential && key) await this.vault.set('ai-' + credential, '');
        throw error;
      }
      if (old?.credential && old.credential !== credential)
        await this.vault.set('ai-' + old.credential, '');
    });
  }
  remove(id: string) {
    return this.edit(async () => {
      const p = this.get(id);
      this.replace(this.storage.config.providers.filter((item) => item.id !== id));
      if (p.credential) await this.vault.set('ai-' + p.credential, '');
    });
  }
  async request(
    p: StoredProvider,
    route: 'models' | 'chat/completions',
    body?: object,
    signal?: AbortSignal,
  ) {
    if (!p.enabled) throw new Error('请先启用服务商');
    const key = p.credential && (await this.vault.get('ai-' + p.credential));
    if (p.credential && !key) throw new Error('凭据缺失，请重新填写 API 密钥');
    const url = p.baseUrl + '/' + route;
    const options = {
      method: body ? 'POST' : 'GET',
      redirect: 'error' as const,
      headers: {
        ...(key ? { Authorization: 'Bearer ' + key } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([
        this.shutdown.signal,
        AbortSignal.timeout(body ? 120000 : 15000),
        ...(signal ? [signal] : []),
      ]),
    };
    const host = new URL(url).hostname;
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      // Local inference stays on loopback even when downloads use a proxy.
      response = ['127.0.0.1', 'localhost', '[::1]'].includes(host)
        ? await fetch(url, options)
        : await this.net.response(url, options, false, body ? 120000 : 15000);
    } catch {
      signal?.throwIfAborted();
      throw new Error(
        options.signal.aborted ? '模型服务响应超时' : '无法连接模型服务，请检查 API 地址和网络',
      );
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      const hints: Record<number, string> = {
        400: '请求格式或模型能力不匹配，可切换为普通对话',
        401: '请检查 API 密钥',
        402: '请检查服务商余额',
        403: '请检查密钥和模型权限',
        404: '请检查 API 地址和模型名称',
        429: '请求过于频繁或配额已用尽',
      };
      throw new Error(
        '模型服务 HTTP ' + response.status + ' · ' + (hints[response.status] ?? '服务暂不可用'),
      );
    }
    return response;
  }
  async models(id: string, sync: boolean) {
    const p = this.get(id);
    const response = await this.request(p, 'models');
    const body = await readJsonResponse(response);
    if (!Array.isArray(body?.data)) throw new Error('服务商未返回兼容的模型列表，可手动添加模型');
    const models = modelList.safeParse([
      ...new Set(
        body.data
          .map((m: { id?: unknown } | null) => m?.id)
          .filter((v: unknown) => modelId.safeParse(v).success),
      ),
    ]);
    if (!models.success || (body.data.length && !models.data.length))
      throw new Error('模型列表格式无效');
    if (sync) {
      const current = this.get(id);
      if (current.baseUrl !== p.baseUrl || current.credential !== p.credential || !current.enabled)
        throw new Error('服务商已更改，请重新同步');
      const next = modelList.parse([...new Set([...current.manualModels, ...models.data])]);
      this.replace(
        this.storage.config.providers.map((item) =>
          item.id === id ? { ...item, models: next } : item,
        ),
      );
    }
    return models.data.length;
  }
}

export type ModelResponse = Awaited<ReturnType<Providers['request']>>;
export async function* textChunks(response: ModelResponse) {
  const reader = response.body!.getReader(),
    decoder = new TextDecoder();
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw new Error('模型服务响应超过容量上限');
      yield decoder.decode(part.value, { stream: true });
    }
    yield decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function readJsonResponse(response: ModelResponse) {
  let body = '';
  for await (const chunk of textChunks(response)) body += chunk;
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('模型服务返回了无效的 JSON');
  }
}
