import { safeStorage } from 'electron';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Network } from './network';
import { Store } from './store';
import { Tasks } from './tasks';
import { exchangeMicrosoftSession } from './microsoft-session';
import { microsoftClientId } from './microsoft-client';
import type { Account, DeviceCode } from '../../shared/types';
import type { Yggdrasil } from './yggdrasil';
const authority = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const scope = 'XboxLive.signin offline_access';
export class Auth {
  thirdParty?: Yggdrasil;
  private login?: AbortController;
  private loginTask?: string;
  pendingCode?: DeviceCode;
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
    this.pendingCode = undefined;
    this.changed();
  }
  async begin(accountId?: string): Promise<DeviceCode> {
    const account = this.store.data.accounts.find((a) => a.id === accountId);
    if (accountId && account?.kind !== 'microsoft') throw new Error('请选择已有的 Microsoft 账户');
    const client_id = microsoftClientId(
      account?.microsoftClientId || this.store.data.settings.microsoftClientId,
    );
    const welcomeLogin = this.store.data.welcome.step === 'account';
    this.secure();
    if (this.login || this.tasks.busy('auth')) throw new Error('请先取消当前登录');
    const controller = new AbortController();
    this.login = controller;
    try {
      return await this.requestCode(client_id, welcomeLogin, controller, account);
    } catch (error) {
      if (this.login === controller) {
        this.login = undefined;
        this.pendingCode = undefined;
      }
      throw error;
    }
  }
  private async requestCode(
    client_id: string,
    welcomeLogin: boolean,
    controller: AbortController,
    reauthorizing?: Account,
  ) {
    const data = await this.net.json<any>(authority + '/devicecode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id, scope }).toString(),
      signal: controller.signal,
    });
    const expiresAt = Date.now() + data.expires_in * 1000;
    controller.signal.throwIfAborted();
    const code = { userCode: data.user_code, verificationUri: data.verification_uri, expiresAt };
    this.pendingCode = code;
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
              token.error === 'expired_token'
                ? '登录码已过期，请重新登录'
                : token.error === 'authorization_declined'
                  ? '已取消授权'
                  : 'Microsoft 授权失败，请重试',
            );
          if (
            typeof token.access_token !== 'string' ||
            !token.access_token ||
            typeof token.refresh_token !== 'string' ||
            !token.refresh_token
          )
            throw new Error('Microsoft 未返回完整的登录凭据，请重新授权。');
          this.pendingCode = undefined;
          const profile = await exchangeMicrosoftSession(
            this.net,
            token.access_token,
            signal,
            ctx.progress,
          );
          signal.throwIfAborted();
          if (reauthorizing && reauthorizing.uuid !== profile.uuid)
            throw new Error('登录的 Minecraft 角色与待授权账户不同，请使用原账户重新授权。');
          const existing = this.store.data.accounts.find(
            (a) => a.uuid === profile.uuid && a.kind === 'microsoft',
          );
          const account: Account = {
            ...profile,
            id: existing?.id ?? randomUUID(),
            kind: 'microsoft',
            microsoftClientId: client_id,
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
        if (this.login === controller) {
          this.login = undefined;
          this.pendingCode = undefined;
        }
      }
    });
    return code;
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
    const client_id =
      account.microsoftClientId ?? microsoftClientId(this.store.data.settings.microsoftClientId);
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
    const profile = await exchangeMicrosoftSession(
      this.net,
      r.access_token,
      AbortSignal.timeout(120000),
    );
    if (r.refresh_token) await this.save(account.id, r.refresh_token);
    this.access.set(account.id, { token: profile.token, expires: profile.expires });
    return profile.token;
  }
}
