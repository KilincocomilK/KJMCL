import path from 'node:path';
import { readFile, readdir, lstat, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { FormData } from 'undici';
import { Store } from './store';
import { Network } from './network';
import { exists, hashFile, json } from './files';
import type { Secrets } from './vault';
import type { CurseForge } from './curseforge';
import type { PackOptions, PackReview } from '../../shared/types';
export class Publishing {
  private reviews = new Map<
    string,
    {
      review: PackReview;
      options: PackOptions;
      gameVersion: string;
      loader: string;
      expires: number;
    }
  >();
  constructor(
    private store: Store,
    private net: Network,
    private vault: Secrets,
    private cf: CurseForge,
  ) {}
  async prepare(options: PackOptions, file: string): Promise<PackReview> {
    const i = this.store.instance(options.id),
      root = this.store.dir(i.id),
      zip = new AdmZip();
    const modNames = (await readdir(path.join(root, 'mods')).catch(() => [])).filter((n) =>
      n.endsWith('.jar'),
    );
    const manifestFiles: any[] = [];
    const audit: string[] = [];
    if (options.format === 'mrpack') {
      const lock = (await exists(path.join(root, 'mods-lock.json')))
        ? await json<any[]>(path.join(root, 'mods-lock.json'))
        : [];
      for (const name of modNames) {
        const entry = lock.find((l) => l.file === name);
        if (!entry) throw new Error('公开整合包仅支持可追溯的 Modrinth 模组：' + name);
        const bytes = path.join(root, 'mods', name);
        if ((await hashFile(bytes, 'sha512')) !== entry.sha512)
          throw new Error('模组已被修改：' + name);
        const version = await this.net.json<any>(
          'https://api.modrinth.com/v2/version/' + encodeURIComponent(entry.versionId),
        );
        const remote = version.files.find((f: any) => f.hashes.sha512 === entry.sha512);
        if (!remote) throw new Error('无法核对模组下载来源：' + name);
        manifestFiles.push({
          path: 'mods/' + name,
          hashes: { sha1: await hashFile(bytes), sha512: entry.sha512 },
          env: { client: 'required', server: 'optional' },
          downloads: [remote.url],
          fileSize: (await stat(bytes)).size,
        });
        audit.push('mods/' + name);
      }
      const dependencies: Record<string, string> = { minecraft: i.version };
      if (i.loader !== 'vanilla') {
        if (!i.loaderVersion) throw new Error('加载器版本缺失，请先完成安装');
        dependencies[
          i.loader === 'fabric' ? 'fabric-loader' : i.loader === 'quilt' ? 'quilt-loader' : i.loader
        ] = i.loaderVersion.replace(i.version + '-', '');
      }
      zip.addFile(
        'modrinth.index.json',
        Buffer.from(
          JSON.stringify(
            {
              formatVersion: 1,
              game: 'minecraft',
              versionId: options.version,
              name: options.name,
              summary: options.summary,
              files: manifestFiles,
              dependencies,
            },
            null,
            2,
          ),
        ),
      );
    } else {
      const lock = await this.cf.lock(i.id);
      for (const name of modNames) {
        const entry = lock.find((l) => l.file === name);
        if (!entry) throw new Error('CurseForge 格式仅支持已记录的 CurseForge 模组：' + name);
        if ((await hashFile(path.join(root, 'mods', name))) !== entry.sha1)
          throw new Error('模组已被修改：' + name);
        manifestFiles.push({ projectID: entry.projectId, fileID: entry.fileId, required: true });
        audit.push('mods/' + name);
      }
      const modLoaders =
        i.loader === 'vanilla'
          ? []
          : [
              {
                id: i.loader + '-' + (i.loaderVersion ?? '').replace(i.version + '-', ''),
                primary: true,
              },
            ];
      if (i.loader !== 'vanilla' && !i.loaderVersion) throw new Error('加载器版本缺失');
      zip.addFile(
        'manifest.json',
        Buffer.from(
          JSON.stringify(
            {
              minecraft: { version: i.version, modLoaders },
              manifestType: 'minecraftModpack',
              manifestVersion: 1,
              name: options.name,
              version: options.version,
              author: options.author,
              files: manifestFiles,
              overrides: 'overrides',
            },
            null,
            2,
          ),
        ),
      );
    }
    // Only explicit pack configuration is bundled. Accounts, worlds and local/server settings stay local.
    let total = 0;
    const add = async (dir: string, relative: string) => {
      for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (d.isSymbolicLink()) throw new Error('发布内容包含符号链接');
        const p = path.join(dir, d.name),
          r = relative + '/' + d.name;
        if (d.isDirectory()) await add(p, r);
        else {
          total += (await stat(p)).size;
          if (total > 256 * 1024 ** 2) throw new Error('配置目录超过 256 MiB');
          if (/(?:token|secret|credential|account|session|\.env)/i.test(d.name))
            throw new Error('配置含有疑似凭据文件，请先移除：' + r);
          zip.addLocalFile(p, 'overrides/' + relative);
          audit.push('overrides/' + r);
        }
      }
    };
    await add(path.join(root, 'config'), 'config');
    await zip.writeZipPromise(file);
    const review: PackReview = {
      ticket: randomUUID(),
      path: file,
      sha256: await hashFile(file, 'sha256'),
      files: audit.length,
      size: (await stat(file)).size,
      name: options.name,
      version: options.version,
    };
    await writeFile(file + '.manifest.txt', audit.join('\n'));
    this.reviews.set(review.ticket, {
      review,
      options: { ...options },
      gameVersion: i.version,
      loader: i.loader,
      expires: Date.now() + 30 * 60 * 1000,
    });
    return review;
  }
  async publish(
    ticket: string,
    projectId: string,
    changelog: string,
    channel: 'release' | 'beta' | 'alpha',
  ) {
    const entry = this.reviews.get(ticket);
    if (!entry || entry.expires < Date.now()) throw new Error('发布预览已过期，请重新生成');
    if (entry.options.format !== 'mrpack')
      throw new Error('CurseForge 发布包请在 CurseForge 作者后台上传');
    // Claim synchronously so two concurrent IPC calls cannot publish the same review twice.
    this.reviews.delete(ticket);
    const token = await this.vault.get('modrinth');
    if (!token) throw new Error('请先配置 Modrinth 发布令牌');
    if ((await hashFile(entry.review.path, 'sha256')) !== entry.review.sha256)
      throw new Error('发布包已发生变化，请重新生成预览');
    const project = await this.net.json<any>(
      'https://api.modrinth.com/v2/project/' + encodeURIComponent(projectId),
      { headers: { Authorization: token }, redirect: 'error' },
    );
    if (project.project_type !== 'modpack') throw new Error('目标项目必须为整合包类型');
    const form = new FormData();
    form.set(
      'data',
      JSON.stringify({
        project_id: project.id,
        name: entry.options.name + ' ' + entry.options.version,
        version_number: entry.options.version,
        changelog,
        dependencies: [],
        game_versions: [entry.gameVersion],
        version_type: channel,
        loaders: [entry.loader === 'vanilla' ? 'minecraft' : entry.loader],
        featured: false,
        file_parts: ['file'],
        primary_file: 'file',
      }),
    );
    form.set(
      'file',
      new Blob([new Uint8Array(await readFile(entry.review.path))]),
      path.basename(entry.review.path),
    );
    // Consume before sending: an ambiguous network failure must not silently retry a public write.
    const r = await this.net.response('https://api.modrinth.com/v2/version', {
      method: 'POST',
      headers: { Authorization: token },
      body: form,
      redirect: 'error',
    });
    if (!r.ok) throw new Error(`发布请求失败 (${r.status})，请先检查项目版本列表再重试`);
    const result = (await r.json()) as any;
    return `https://modrinth.com/modpack/${project.slug}/version/${result.id}`;
  }
}
