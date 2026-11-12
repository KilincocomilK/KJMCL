import path from 'node:path';
import { mkdir, copyFile, readdir, rm, appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Store } from './store';
import { Network } from './network';
import { Java, inspectJava } from './java';
import { atomicJson, json, inside } from './files';
import { copyTree } from './instances';
import { mergeVersions, type Version } from './minecraft';
import type { Work } from './tasks';
export function forgeCoordinate(loader: 'forge' | 'neoforge', minecraft: string, version: string) {
  if (!/^[\w.+-]+$/.test(version)) throw new Error('无效加载器版本');
  if (loader === 'forge')
    return {
      base: 'https://maven.minecraftforge.net/net/minecraftforge/forge/',
      version: version.startsWith(minecraft + '-') ? version : minecraft + '-' + version,
      artifact: 'forge',
    };
  return minecraft === '1.20.1'
    ? {
        base: 'https://maven.neoforged.net/releases/net/neoforged/forge/',
        version: version.startsWith(minecraft + '-') ? version : minecraft + '-' + version,
        artifact: 'forge',
      }
    : {
        base: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/',
        version,
        artifact: 'neoforge',
      };
}
export class Forge {
  constructor(
    private store: Store,
    private net: Network,
  ) {}
  async versions(minecraft: string, loader: 'forge' | 'neoforge', signal?: AbortSignal) {
    const c = forgeCoordinate(loader, minecraft, 'placeholder');
    const r = await this.net.response(c.base + 'maven-metadata.xml', { signal });
    if (!r.ok) throw new Error('获取加载器版本失败');
    const xml = await r.text();
    const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
    const parts = minecraft.split('.');
    const prefix =
      loader === 'forge' || minecraft === '1.20.1'
        ? minecraft + '-'
        : minecraft.startsWith('1.')
          ? `${parts[1]}.${parts[2] ?? '0'}.`
          : minecraft + '.';
    return versions.filter((v) => v.startsWith(prefix)).reverse();
  }
  async install(id: string, parent: Version, ctx: Work) {
    const i = this.store.instance(id);
    if (i.loader !== 'forge' && i.loader !== 'neoforge') throw new Error('无效加载器');
    const version = i.loaderVersion ?? (await this.versions(i.version, i.loader, ctx.signal))[0];
    if (!version) throw new Error('没有兼容加载器版本');
    i.loaderVersion = version;
    const c = forgeCoordinate(i.loader, i.version, version),
      url = `${c.base}${c.version}/${c.artifact}-${c.version}-installer.jar`;
    const digestResponse = await this.net.response(url + '.sha1', { signal: ctx.signal });
    if (!digestResponse.ok) throw new Error('无法取得安装器校验和');
    const digest = (await digestResponse.text()).trim().split(/\s/)[0];
    if (!/^[a-f0-9]{40}$/i.test(digest)) throw new Error('安装器校验和格式无效');
    const installer = path.join(
      this.store.root,
      'cache',
      'installers',
      `${i.loader}-${c.version}.jar`,
    );
    await this.net.download(url, installer, { signal: ctx.signal, hash: digest.toLowerCase() });
    const required = parent.javaVersion?.majorVersion ?? 8;
    const java = new Java(this.store, this.net),
      configured = i.javaPath || this.store.data.settings.javaPath;
    const runtime = configured
      ? await inspectJava(configured)
      : (await java.discover()).find((j) => j.major >= Math.max(required, 8));
    if (!runtime) throw new Error(`请先安装 Java ${required} 或更新版本以运行加载器安装器`);
    const stage = path.join(this.store.root, 'cache', 'forge', randomUUID());
    await mkdir(path.join(stage, 'versions', i.version), { recursive: true });
    try {
      await atomicJson(path.join(stage, 'launcher_profiles.json'), { profiles: {} });
      await atomicJson(path.join(stage, 'versions', i.version, i.version + '.json'), parent);
      await copyFile(
        path.join(this.store.dir(id), 'client.jar'),
        path.join(stage, 'versions', i.version, i.version + '.jar'),
      );
      const jvm: string[] = [];
      if (this.store.data.settings.proxy) {
        const p = new URL(this.store.data.settings.proxy);
        if (p.username || p.password) throw new Error('加载器安装器暂不支持带身份验证的代理');
        jvm.push(
          `-Dhttp.proxyHost=${p.hostname}`,
          `-Dhttp.proxyPort=${p.port || '80'}`,
          `-Dhttps.proxyHost=${p.hostname}`,
          `-Dhttps.proxyPort=${p.port || '80'}`,
        );
      }
      ctx.progress(96, `运行 ${i.loader} 安装器`);
      await new Promise<void>((resolve, reject) => {
        const child = spawn(runtime.path, [...jvm, '-jar', installer, '--installClient', stage], {
          cwd: stage,
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const abort = () => child.kill();
        ctx.signal.addEventListener('abort', abort, { once: true });
        if (ctx.signal.aborted) abort();
        const timeout = setTimeout(() => child.kill(), 30 * 60 * 1000);
        const log = (b: Buffer) => {
          void appendFile(path.join(this.store.dir(id), 'logs', 'loader-install.log'), b).catch(
            () => {},
          );
        };
        child.stdout.on('data', log);
        child.stderr.on('data', log);
        child.once('error', reject);
        child.once('close', (code) => {
          clearTimeout(timeout);
          ctx.signal.removeEventListener('abort', abort);
          if (ctx.signal.aborted) reject(new Error('安装已取消'));
          else if (code !== 0)
            reject(new Error(`加载器安装失败 (${code})，请查看 loader-install.log`));
          else resolve();
        });
      });
      let generated: Version | undefined;
      for (const d of await readdir(path.join(stage, 'versions'), { withFileTypes: true })) {
        if (d.name === i.version || !d.isDirectory()) continue;
        const v = await json<Version>(inside(stage, `versions/${d.name}/${d.name}.json`));
        if (v.inheritsFrom === i.version) generated = v;
      }
      if (!generated) throw new Error('安装器未生成客户端版本');
      await copyTree(
        path.join(stage, 'libraries'),
        path.join(this.store.runtime(id), 'libraries'),
        ctx,
      );
      return mergeVersions(parent, generated);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
}
