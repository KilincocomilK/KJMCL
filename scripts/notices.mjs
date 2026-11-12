import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const seen = new Set();
const sections = [
  `KJMCL ${pkg.version} — Third-party notices\n\nCopyright (c) 2026 KilincocomilK. KJMCL is licensed under the MIT License; see LICENSE. The following licenses apply only to their respective dependencies.\n`,
];
sections.push(
  '\nTerracotta / 陶瓦联机 © Burning_TNT and contributors\nOptional, unmodified external component downloaded on demand; not linked into KJMCL.\nSource and license: https://github.com/burningtnt/Terracotta/tree/v0.4.2\nHTTP integration: https://burningtnt.github.io/Terracotta/http-api/\nLicense: GNU Affero General Public License v3.0 or later, with upstream exceptions for unmodified binary distribution or IPC integration with prominent attribution.\nBuilt on EasyTier; bundled dependencies retain their upstream licenses.\n',
);
async function visit(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const dir = 'node_modules/' + name;
  const p = JSON.parse(await readFile(dir + '/package.json', 'utf8'));
  sections.push(`\n${'='.repeat(72)}\n${p.name} ${p.version} (${p.license ?? 'see license'})\n`);
  const files = (await readdir(dir)).filter((f) => /^(licen[sc]e|copying|notice)(\.|$)/i.test(f));
  for (const file of files) sections.push(await readFile(dir + '/' + file, 'utf8'));
  for (const dep of Object.keys(p.dependencies ?? {})) await visit(dep);
}
for (const name of Object.keys(pkg.dependencies)) await visit(name);
await visit('electron');
const rust = JSON.parse(
  execFileSync(
    'cargo',
    [
      'metadata',
      '--locked',
      '--format-version',
      '1',
      '--manifest-path',
      'electron/native/save-manager/Cargo.toml',
    ],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  ),
);
for (const p of rust.packages.filter((p) => p.name !== 'kjmcl-save-manager')) {
  sections.push(
    `\n${'='.repeat(72)}\nRust: ${p.name} ${p.version} (${p.license ?? 'see license'})\n${p.repository ?? ''}\n`,
  );
  const dir = path.dirname(p.manifest_path);
  for (const name of await readdir(dir))
    if (/^(licen[sc]e|copying|notice)([._-]|$)/i.test(name)) {
      try {
        sections.push(await readFile(path.join(dir, name), 'utf8'));
      } catch {
        /* license subdirectories are covered by package metadata */
      }
    }
}
await writeFile('THIRD_PARTY_NOTICES.txt', sections.join('\n').replace(/[\t ]+$/gm, ''));
