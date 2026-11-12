import path from 'node:path';
import os from 'node:os';
import { lstat, readdir, open, realpath } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import type { Store } from './store';
import { assertOwned } from './instances';
import { inside } from './files';
import { diagnose } from './diagnostics';
import { redact } from './log-redaction';
import { safeExport } from './safe-export';
import type { CrashFile, CrashReport } from '../../shared/types';
export class CrashReports {
  constructor(
    private store: Store,
    private secrets: () => Promise<string[]>,
  ) {}
  async list(id: string): Promise<CrashFile[]> {
    await assertOwned(this.store, id);
    const root = this.store.dir(id),
      result: CrashFile[] = [];
    for (const [folder, pattern, kind] of [
      ['crash-reports', /^crash-.+\.txt$/, 'crash'],
      ['', /^hs_err_pid\d+\.log$/, 'jvm'],
      ['logs', /^(latest|debug)\.log$/, 'log'],
    ] as const) {
      const dir = folder ? path.join(root, folder) : root;
      const s = await lstat(dir).catch(() => undefined);
      if (!s || s.isSymbolicLink() || !s.isDirectory()) continue;
      for (const name of (await readdir(dir)).filter((n) => pattern.test(n)).slice(0, 1000)) {
        const info = await lstat(inside(dir, name));
        if (info.isFile() && !info.isSymbolicLink())
          result.push({
            name: folder ? `${folder}/${name}` : name,
            kind,
            bytes: info.size,
            modifiedAt: info.mtimeMs,
          });
      }
    }
    return result.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 200);
  }
  async read(id: string, name: string): Promise<CrashReport> {
    const file = (await this.list(id)).find((f) => f.name === name);
    if (!file) throw new Error('报告不存在或不在允许读取的日志范围');
    // Resolve credentials before reading/exporting: an unavailable credential store must
    // fail closed instead of quietly producing an insufficiently redacted report.
    const secrets = await this.secrets();
    const f = await open(inside(this.store.dir(id), name), 'r');
    let text = '';
    const limit = 4 * 1024 ** 2;
    let truncated = false;
    try {
      const stat = await f.stat();
      truncated = stat.size > limit;
      const b = Buffer.alloc(Math.min(stat.size, limit));
      await f.read(b, 0, b.length, file.kind === 'log' ? Math.max(0, stat.size - b.length) : 0);
      text = redact(b.toString('utf8'), secrets);
    } finally {
      await f.close();
    }
    // Also remove command-line credentials, email addresses and local user paths.
    text = text
      .replace(
        /((?:password|api[_-]?key|client[_-]?token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,
        '$1[REDACTED]',
      )
      .replace(/\b[A-Z0-9._%+-]{1,128}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}\b/gi, '[EMAIL]');
    const paths = [
      [this.store.dir(id), '[INSTANCE]'],
      [this.store.root, '[DATA]'],
      [os.homedir(), '[HOME]'],
    ];
    // A data override may use a Windows 8.3 alias while Store holds the canonical path.
    const configured = process.env.KJMCL_DATA_DIR;
    if (configured && (await realpath(configured).catch(() => undefined)) === this.store.root) {
      const relative = path.relative(this.store.root, this.store.dir(id));
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative))
        paths.unshift([path.join(configured, relative), '[INSTANCE]']);
      paths.push([configured, '[DATA]']);
    }
    for (const [value, label] of paths) {
      for (const variant of [value, value.replaceAll('\\', '/'), value.replaceAll('\\', '\\\\')]) {
        const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(escaped, process.platform === 'win32' ? 'gi' : 'g'), label);
      }
    }
    text = text.replace(/\b[A-Z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, '[HOME]');
    return { file, text, truncated, diagnoses: diagnose(text.split(/\r?\n/), 'failed') };
  }
  async export(id: string, name: string, destination: string) {
    const report = await this.read(id, name),
      i = this.store.instance(id);
    await safeExport(destination, async (temporary) => {
      const zip = new ZipFile();
      zip.addBuffer(Buffer.from(report.text), 'report.txt');
      zip.addBuffer(
        Buffer.from(
          JSON.stringify(
            {
              schemaVersion: 1,
              minecraft: i.version,
              loader: i.loader,
              loaderVersion: i.loaderVersion,
              platform: process.platform,
              arch: process.arch,
              truncated: report.truncated,
              diagnoses: report.diagnoses,
            },
            null,
            2,
          ),
        ),
        'diagnosis.json',
      );
      zip.addBuffer(
        Buffer.from(
          'KJMCL 本地诊断包。仅含所选报告（最多 4 MiB）与基础版本信息；导出前仍请核对自定义日志内容。',
        ),
        'README.txt',
      );
      zip.end();
      await pipeline(zip.outputStream, createWriteStream(temporary, { flags: 'wx' }));
    });
  }
}
