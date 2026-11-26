import { z } from 'zod';
import type { Network } from './network';
import type { Work } from './tasks';

const services = {
  xbox: ['Xbox 登录', 'https://user.auth.xboxlive.com/user/authenticate'],
  xsts: ['Xbox 授权', 'https://xsts.auth.xboxlive.com/xsts/authorize'],
  minecraft: ['Minecraft 登录', 'https://api.minecraftservices.com/authentication/login_with_xbox'],
  profile: ['读取 Java 版角色', 'https://api.minecraftservices.com/minecraft/profile'],
} as const;
type Stage = keyof typeof services;

// Only recognized service errors are shown. Error bodies can contain identifying data.
const errorFields = z
  .object({
    error: z.unknown(),
    errorMessage: z.unknown(),
    developerMessage: z.unknown(),
    message: z.unknown(),
    details: z.unknown(),
    XErr: z.unknown(),
  })
  .partial();
function serviceError(stage: Stage, status: number, body: unknown) {
  const fields = errorFields.safeParse(body).data;
  const reason = z.object({ reason: z.string() }).safeParse(fields?.details).data?.reason;
  const description = [
    fields?.error,
    fields?.errorMessage,
    fields?.developerMessage,
    fields?.message,
    reason,
  ]
    .filter((field): field is string => typeof field === 'string')
    .join(' ');
  if (stage === 'minecraft' && status === 403) {
    if (/invalid[ _-]app[ _-]registration|aka\.ms\/AppRegInfo/i.test(description))
      return 'Microsoft 已授权，Minecraft 拒绝了此应用（403）。请核对 Client ID，并确认该应用已获准接入 Java 版游戏服务。';
    if (reason === 'ACCOUNT_SUSPENDED')
      return 'Minecraft 报告此账户已被暂停（403），请联系 Minecraft 支持。';
    return 'Microsoft 已授权，Minecraft 游戏服务拒绝了登录（403）。请核对应用的接入权限和账户状态。';
  }
  if (stage === 'profile' && status === 404)
    return '未找到 Java 版角色（404）。请在 Minecraft 官网确认此账户的游戏资格并创建角色。';
  if (stage === 'xsts' && status === 401) {
    if (String(fields?.XErr) === '2148916233')
      return '此 Microsoft 账户尚无 Xbox 档案，请先在 Xbox 官网创建档案再登录。';
    if (String(fields?.XErr) === '2148916238')
      return 'Xbox 要求家庭授权，请由家庭组织者检查此账户的权限。';
  }
  const name = services[stage][0];
  if (status === 429 || status >= 500) return `${name}服务暂时不可用（${status}），请稍后重试。`;
  return `${name}请求被拒绝（${status}）。`;
}

const token = z.string().min(1);
const xboxTicket = z.object({ Token: token });
const xstsTicket = xboxTicket.extend({
  DisplayClaims: z.object({ xui: z.array(z.object({ uhs: token })).nonempty() }),
});
const minecraftTicket = z.object({ access_token: token, expires_in: z.number().positive() });
const gameProfile = z.object({
  id: z.string().regex(/^[a-f\d]{32}$/i),
  name: z.string().min(1),
  skins: z.array(z.object({ state: z.string(), url: z.string() })).optional(),
});

export async function exchangeMicrosoftSession(
  net: Network,
  msToken: string,
  signal: AbortSignal,
  progress?: Work['progress'],
) {
  async function request<T>(stage: Stage, schema: z.ZodType<T>, body?: object, bearer?: string) {
    const [name, url] = services[stage];
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (stage === 'xbox' || stage === 'xsts') headers['x-xbl-contract-version'] = '1';
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    const response = await net
      .response(url, {
        method: body ? 'POST' : 'GET',
        headers,
        body: JSON.stringify(body),
        signal,
        redirect: 'error',
      })
      .catch(() => {
        signal.throwIfAborted();
        throw new Error(`无法完成${name}请求，请检查网络或代理后重试。`);
      });
    const data = await response.json().catch((error) => {
      signal.throwIfAborted();
      if (response.ok && !(error instanceof SyntaxError))
        throw new Error(`无法完成${name}请求，请检查网络或代理后重试。`);
    });
    if (!response.ok) throw new Error(serviceError(stage, response.status, data));
    const result = schema.safeParse(data);
    if (!result.success) throw new Error(`${name}服务返回的数据不完整，请重试。`);
    return result.data;
  }

  progress?.(70, 'Microsoft 已授权，正在验证 Xbox 账户');
  const xbl = await request('xbox', xboxTicket, {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: 'd=' + msToken,
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  const xsts = await request('xsts', xstsTicket, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  });
  progress?.(85, '正在登录 Minecraft 游戏服务');
  const mc = await request('minecraft', minecraftTicket, {
    identityToken: `XBL3.0 x=${xsts.DisplayClaims.xui[0].uhs};${xsts.Token}`,
  });
  progress?.(95, '正在读取 Java 版角色');
  const profile = await request('profile', gameProfile, undefined, mc.access_token);
  return {
    uuid: profile.id,
    name: profile.name,
    skin: profile.skins?.find((s) => s.state === 'ACTIVE')?.url,
    token: mc.access_token,
    expires: Date.now() + mc.expires_in * 1000 - 120000,
  };
}
