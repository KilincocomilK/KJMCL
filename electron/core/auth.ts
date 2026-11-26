import { safeStorage } from 'electron';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Network } from './network';
import { Store } from './store';
import { Tasks } from './tasks';
import type { Account, DeviceCode } from '../../shared/types';
import type { Yggdrasil } from './yggdrasil';
const authority = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const scope = 'XboxLive.signin offline_access';
export class Auth {
  thirdParty?: Yggdrasil;
  private login?: AbortController;
  private loginTask?: string;
  private access = new Map<string, { token: string; expires: number }>();
  redactionValues() {
    return [...this.access.values()].map((v) => v.token);
  }
  constructor(
    private store: Store,
    private net: Network,
    private tasks: Tasks,
    private changed: () => void,
  ) {}
  private client() {
    const id = this.store.data.settings.microsoftClientId;
    if (!id) throw new Error('请先在账户管理中填写 Microsoft Client ID');
    return id;
  }
  private secure() {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error('系统安全存储不可用，请启用钥匙串后登录');
  }
  private file(id: string) {
    return path.join(this.store.root, 'credentials', id + '.bin');
  }
  private async save(id: string, refresh: string) {
    this.secure();
    await mkdir(path.dirname(this.file(id)), { recursive: true });
    await writeFile(this.file(id), safeStorage.encryptString(refresh), { mode: 0o600 });
  }
  async remove(id: string) {
    await rm(this.file(id), { force: true });
    this.access.delete(id);
  }
  cancel() {
    if (this.loginTask) this.tasks.cancel(this.loginTask);
    this.login?.abort();
    this.login = undefined;
  }
  async begin(): Promise<DeviceCode> {
    const client_id = this.client();
    const welcomeLogin = this.store.data.welcome.step === 'account';
    this.secure();
    if (this.tasks.busy('auth')) throw new Error('请先取消当前登录');
    const controller = new AbortController();
    this.login = controller;
    const data = await this.net.json<any>(authority + '/devicecode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id, scope }).toString(),
      signal: controller.signal,
    });
    const expiresAt = Date.now() + data.expires_in * 1000;
    this.loginTask = this.tasks.start('Microsoft 登录', 'auth', async (ctx) => {
      const signal = AbortSignal.any([ctx.signal, controller.signal]);
      let interval = (data.interval ?? 5) * 1000;
      try {
        while (Date.now() < expiresAt) {
          await delay(interval, undefined, { signal });
          const r = await this.net.response(authority + '/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
              device_code: data.device_code,
            }).toString(),
            signal,
          });
          const token = (await r.json()) as any;
          if (token.error === 'authorization_pending') continue;
          if (token.error === 'slow_down') {
            interval += 5000;
            continue;
          }
          if (!r.ok)
            throw new Error(
              token.error === 'authorization_declined'
                ? '已取消授权'
                : 'Microsoft 授权失败，请重试',
            );
          ctx.progress(70, '验证 Minecraft 账户');
          const profile = await this.exchange(token.access_token, signal);
          signal.throwIfAborted();
          const existing = this.store.data.accounts.find(
            (a) => a.uuid === profile.uuid && a.kind === 'microsoft',
          );
          const account: Account = {
            ...profile,
            id: existing?.id ?? randomUUID(),
            kind: 'microsoft',
          };
          await this.save(account.id, token.refresh_token);
          this.access.set(account.id, { token: profile.token, expires: profile.expires });
          const {
            token: _token,
            expires: _expires,
            ...publicAccount
          } = account as Account & { token: string; expires: number };
          this.store.data.accounts = this.store.data.accounts.filter((a) => a.id !== account.id);
          this.store.data.accounts.push(publicAccount);
          this.store.data.selectedAccountId = account.id;
          this.store.save(welcomeLogin ? 'account' : undefined);
          this.changed();
          return;
        }
        throw new Error('登录码已过期');
      } finally {
        if (this.login === controller) this.login = undefined;
      }
    });
    return { userCode: data.user_code, verificationUri: data.verification_uri, expiresAt };
  }
  private async exchange(msToken: string, signal: AbortSignal) {
    const post = (url: string, body: unknown) =>
      this.net.json<any>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    const xbl = await post('https://user.auth.xboxlive.com/user/authenticate', {
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: 'd=' + msToken,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    });
    let xsts;
    try {
      xsts = await post('https://xsts.auth.xboxlive.com/xsts/authorize', {
        Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT',
      });
    } catch {
      throw new Error('Xbox 授权失败，请检查 Xbox 档案、家庭权限及应用授权');
    }
    const mc = await post('https://api.minecraftservices.com/authentication/login_with_xbox', {
      identityToken: `XBL3.0 x=${xsts.DisplayClaims.xui[0].uhs};${xsts.Token}`,
    });
    let profile;
    try {
      profile = await this.net.json<any>('https://api.minecraftservices.com/minecraft/profile', {
        headers: { Authorization: 'Bearer ' + mc.access_token },
        signal,
      });
    } catch {
      throw new Error('未获取到 Java 版游戏档案，请确认账户拥有 Minecraft Java 版');
    }
    return {
      uuid: profile.id,
      name: profile.name,
      skin: profile.skins?.find((s: any) => s.state === 'ACTIVE')?.url,
      token: mc.access_token,
      expires: Date.now() + mc.expires_in * 1000 - 120000,
    };
  }
  async token(account: Account) {
    if (account.kind === 'offline') return '0';
    if (account.kind === 'yggdrasil') {
      if (!this.thirdParty) throw new Error('第三方认证未初始化');
      return this.thirdParty.token(account);
    }
    const cached = this.access.get(account.id);
    if (cached && cached.expires > Date.now()) return cached.token;
    this.secure();
    let refresh;
    try {
      refresh = safeStorage.decryptString(await readFile(this.file(account.id)));
    } catch {
      throw new Error('账户凭据不可用，请重新登录');
    }
    const client_id = this.client();
    const r = await this.net.json<any>(authority + '/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id,
        grant_type: 'refresh_token',
        refresh_token: refresh,
        scope,
      }).toString(),
    });
    const profile = await this.exchange(r.access_token, AbortSignal.timeout(120000));
    if (r.refresh_token) await this.save(account.id, r.refresh_token);
    this.access.set(account.id, { token: profile.token, expires: profile.expires });
    return profile.token;
  }
}
