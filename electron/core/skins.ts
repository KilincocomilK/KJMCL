import { readFile, stat } from 'node:fs/promises';
import { FormData } from 'undici';
import { Store } from './store';
import { Network } from './network';
import type { Auth } from './auth';
import type { Yggdrasil } from './yggdrasil';
export function validateSkin(data: Buffer) {
  if (
    data.length > 1024 * 1024 ||
    data.length < 33 ||
    !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    data.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error('请选择有效的 PNG 皮肤（不超过 1 MiB）');
  const width = data.readUInt32BE(16),
    height = data.readUInt32BE(20);
  if (width !== 64 || ![32, 64].includes(height)) throw new Error('皮肤尺寸必须为 64×64 或 64×32');
  return { width, height };
}
export class Skins {
  constructor(
    private store: Store,
    private net: Network,
    private auth: Auth,
    private ygg: Yggdrasil,
  ) {}
  private account(id: string) {
    const a = this.store.data.accounts.find((a) => a.id === id);
    if (!a) throw new Error('账户不存在');
    return a;
  }
  async preview(id: string) {
    const a = this.account(id);
    if (a.kind === 'yggdrasil') a.skin = await this.ygg.profile(a);
    if (a.kind === 'microsoft') {
      const token = await this.auth.token(a);
      const profile = await this.net.json<any>(
        'https://api.minecraftservices.com/minecraft/profile',
        {
          headers: { Authorization: 'Bearer ' + token },
          redirect: 'error',
        },
      );
      a.skin = profile.skins?.find((s: any) => s.state === 'ACTIVE')?.url;
    }
    if (!a.skin) return null;
    if (a.skin.startsWith('data:image/png;base64,') && a.kind === 'offline') return a.skin;
    let url = a.skin;
    if (url.startsWith('http://textures.minecraft.net/')) url = url.replace('http:', 'https:');
    const response = await this.net.response(url);
    if (!response.ok) throw new Error('皮肤下载失败');
    const chunks: Uint8Array[] = [];
    let count = 0;
    for await (const chunk of response.body!) {
      count += chunk.length;
      if (count > 1024 * 1024) throw new Error('皮肤文件过大');
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    validateSkin(data);
    return 'data:image/png;base64,' + data.toString('base64');
  }
  async upload(id: string, file: string, variant: 'classic' | 'slim') {
    if ((await stat(file)).size > 1024 * 1024) throw new Error('皮肤文件不能超过 1 MiB');
    const a = this.account(id),
      data = await readFile(file);
    validateSkin(data);
    if (a.kind === 'offline') {
      a.skin = 'data:image/png;base64,' + data.toString('base64');
      this.store.save();
      return;
    }
    if (a.kind === 'yggdrasil') {
      const profile = await this.net.json<any>(
        a.authServer + '/sessionserver/session/minecraft/profile/' + a.uuid,
      );
      if (
        !profile.properties
          ?.find((p: any) => p.name === 'uploadableTextures')
          ?.value.split(',')
          .includes('skin')
      )
        throw new Error('此角色不允许上传皮肤');
      const token = await this.ygg.token(a),
        form = new FormData();
      form.set('model', variant === 'slim' ? 'slim' : '');
      form.set('file', new Blob([new Uint8Array(data)], { type: 'image/png' }), 'skin.png');
      const r = await this.net.response(a.authServer + '/api/user/profile/' + a.uuid + '/skin', {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + token },
        body: form,
        redirect: 'error',
      });
      if (!r.ok) throw new Error(`第三方皮肤上传失败 (${r.status})`);
      await r.body?.cancel();
      a.skin = await this.ygg.profile(a);
      this.store.save();
      return;
    }
    const token = await this.auth.token(a),
      form = new FormData();
    form.set('variant', variant);
    form.set('file', new Blob([new Uint8Array(data)], { type: 'image/png' }), 'skin.png');
    const response = await this.net.response(
      'https://api.minecraftservices.com/minecraft/profile/skins',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: form,
        redirect: 'error',
      },
    );
    if (!response.ok) throw new Error(`皮肤上传失败 (${response.status})`);
    const profile = (await response.json()) as any;
    a.skin = profile.skins?.find((s: any) => s.state === 'ACTIVE')?.url;
    this.store.save();
  }
  async reset(id: string) {
    const a = this.account(id);
    if (a.kind === 'yggdrasil') {
      const token = await this.ygg.token(a);
      const r = await this.net.response(a.authServer + '/api/user/profile/' + a.uuid + '/skin', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
        redirect: 'error',
      });
      if (!r.ok) throw new Error('第三方皮肤重置失败');
      await r.body?.cancel();
    }
    if (a.kind === 'microsoft') {
      const token = await this.auth.token(a);
      const r = await this.net.response(
        'https://api.minecraftservices.com/minecraft/profile/skins/active',
        { method: 'DELETE', headers: { Authorization: 'Bearer ' + token }, redirect: 'error' },
      );
      if (!r.ok) throw new Error(`重置皮肤失败 (${r.status})`);
      await r.body?.cancel();
    }
    delete a.skin;
    this.store.save();
  }
}
