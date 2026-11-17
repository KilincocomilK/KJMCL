import type { Instance, ModAuditEntry, ModFile } from '../../shared/types';
import { redact } from './log-redaction';

// Only the fields needed to compare mod collections leave the launcher.
export function modListText(
  instance: Instance,
  files: ModFile[],
  metadata: ModAuditEntry[],
  secrets: string[],
) {
  const cell = (value: string | undefined) =>
    redact(String(value ?? ''), secrets)
      .replace(
        /((?:password|api[_-]?key|client[_-]?token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,
        '$1[REDACTED]',
      )
      .replace(/\b[A-Z0-9._%+-]{1,128}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}\b/gi, '[EMAIL]')
      .replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ')
      .slice(0, 1000) || '—';
  const rows = [...files]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => {
      const entry = metadata.find((e) => e.name === f.name);
      return [
        cell(f.name),
        f.enabled ? '启用' : '停用',
        cell(entry?.version),
        f.source === 'modrinth' ? 'Modrinth' : f.source === 'curseforge' ? 'CurseForge' : '本地',
        cell(f.projectId),
        cell(f.versionId),
      ].join('\t');
    });
  return [
    'KJMCL 模组清单',
    `Minecraft\t${cell(instance.version)}`,
    `加载器\t${cell(instance.loader)}\t${cell(instance.loaderVersion)}`,
    `数量\t${files.length}`,
    '',
    '文件\t状态\t模组版本\t来源\t项目 ID\t文件版本 ID',
    ...rows,
    '',
  ].join('\n');
}
