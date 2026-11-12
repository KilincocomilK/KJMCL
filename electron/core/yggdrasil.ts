import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store';
import { Network } from './network';
import type { Secrets } from './vault';
import type { Account } from '../../shared/types';
interface Profile {
  id: string;
  name: string;
}
interface Session {
  accessToken: string;
  clientToken: string;
  profiles: Profile[];
  selectedProfile?: string;
}
export function authRoot(value: string) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash)
    throw new Error('认证地址必须是无凭据的 HTTPS API 根地址');
  return u.href.replace(/\/$/, '');
}
export class Yggdrasil {
  private pending = new Map<string, Promise<unknown>>();
  constructor(
    private store: Store,
    private net: Network,
    private vault: Secrets,
  ) {}
  private async request(server: string, method: string, data: unknown) {
    return this.net.json<any>(authRoot(server) + '/authserver/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      redirect: 'error',
    });
  }
  async login(server: string, username: string, password: string) {
    server = authRoot(server);
    const r = await this.request(server, 'authenticate', {
      agent: { name: 'Minecraft', version: 1 },
      username,
      password,
      clientToken: randomUUID(),
      requestUser: true,
    });
    const profiles: Profile[] =
      r.availableProfiles ?? (r.selectedProfile ? [r.selectedProfile] : []);
    if (
      !r.accessToken ||
      !r.clientToken ||
      !profiles.length ||
      profiles.some((p) => !/^[a-f0-9]{32}$/i.test(p.id))
    )
      throw new Error('认证服务未返回有效游戏角色');
    const profile = r.selectedProfile ?? profiles[0];
    const existing = this.store.data.accounts.find(
      (a) => a.kind === 'yggdrasil' && a.authServer === server && a.uuid === profile.id,
    );
    const account: Account = {
      id: existing?.id ?? randomUUID(),
      name: profile.name,
      uuid: profile.id,
      kind: 'yggdrasil',
      authServer: server,
    };
    await this.vault.set(
      'ygg-' + account.id,
      JSON.stringify({
        accessToken: r.accessToken,
        clientToken: r.clientToken,
        profiles,
        selectedProfile: r.selectedProfile?.id,
      }),
    );
    this.store.data.accounts = this.store.data.accounts.filter((a) => a.id !== account.id);
    this.store.data.accounts.push(account);
    this.store.data.selectedAccountId = account.id;
    this.store.save();
    return [...profiles]
      .sort((a, b) => Number(b.id === profile.id) - Number(a.id === profile.id))
      .map((p) => ({ ...account, name: p.name, uuid: p.id }));
  }
  async select(id: string, uuid: string) {
    const account = this.store.data.accounts.find((a) => a.id === id && a.kind === 'yggdrasil');
    if (!account) throw new Error('第三方账户不存在');
    await this.token(account, uuid);
    this.store.save();
  }
  async token(account: Account, uuid = account.uuid) {
    // Refresh rotates tokens on many services. Serialize requests, and validate a
    // bound token first so viewing a skin cannot invalidate a running game.
    const prior = this.pending.get(account.id) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(() => this.boundToken(account, uuid));
    this.pending.set(account.id, next);
    try {
      return await next;
    } finally {
      if (this.pending.get(account.id) === next) this.pending.delete(account.id);
    }
  }
  private async boundToken(account: Account, uuid: string): Promise<string> {
    const saved = await this.vault.get('ygg-' + account.id);
    if (!saved || !account.authServer) throw new Error('第三方凭据失效，请重新登录');
    const session = JSON.parse(saved) as Session;
    const profile = session.profiles.find((p) => p.id === uuid);
    if (!profile) throw new Error('此账户没有该角色');
    if (session.selectedProfile === uuid) {
      const valid = await this.net.response(authRoot(account.authServer) + '/authserver/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'error',
        body: JSON.stringify({
          accessToken: session.accessToken,
          clientToken: session.clientToken,
        }),
      });
      await valid.body?.cancel();
      if (valid.status === 204) return session.accessToken;
      if (![401, 403].includes(valid.status)) throw new Error('第三方认证服务暂时不可用');
    }
    const r = await this.request(account.authServer, 'refresh', {
      accessToken: session.accessToken,
      clientToken: session.clientToken,
      selectedProfile: profile,
      requestUser: true,
    });
    if (!r.accessToken || r.selectedProfile?.id !== uuid) throw new Error('第三方认证刷新失败');
    await this.vault.set(
      'ygg-' + account.id,
      JSON.stringify({
        ...session,
        accessToken: r.accessToken,
        clientToken: r.clientToken ?? session.clientToken,
        selectedProfile: uuid,
      }),
    );
    account.uuid = uuid;
    account.name = r.selectedProfile.name;
    this.store.save();
    return r.accessToken;
  }
  async injector(account: Account, signal: AbortSignal) {
    if (!account.authServer) throw new Error('认证服务缺失');
    const meta = await this.net.json<{
      build_number: number;
      download_url: string;
      checksums: { sha256: string };
    }>('https://authlib-injector.yushi.moe/artifact/latest.json', { signal });
    if (!/^[a-f0-9]{64}$/i.test(meta.checksums?.sha256) || !Number.isSafeInteger(meta.build_number))
      throw new Error('认证组件校验信息无效');
    const dest = path.join(this.store.root, 'authlib', `authlib-injector-${meta.build_number}.jar`);
    await this.net.download(meta.download_url, dest, {
      signal,
      hash: meta.checksums.sha256.toLowerCase(),
      algorithm: 'sha256',
    });
    return [`-javaagent:${dest}=${authRoot(account.authServer)}`, '-Dauthlibinjector.side=client'];
  }
  async profile(account: Account) {
    if (!account.authServer) throw new Error('认证服务缺失');
    const result = await this.net.json<any>(
      authRoot(account.authServer) + `/sessionserver/session/minecraft/profile/${account.uuid}`,
    );
    const value = result.properties?.find((p: any) => p.name === 'textures')?.value;
    if (value) {
      const textures = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
      return textures.textures?.SKIN?.url as string | undefined;
    }
    return undefined;
  }
}
