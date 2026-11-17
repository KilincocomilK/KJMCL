import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const manifest = path.resolve('electron/native/save-manager/Cargo.toml');
execFileSync('cargo', ['build', '--release', '--locked', '--manifest-path', manifest], {
  stdio: 'inherit',
  windowsHide: true,
});
const meta = JSON.parse(
  execFileSync(
    'cargo',
    ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', manifest],
    { encoding: 'utf8', windowsHide: true },
  ),
);
const name = 'kjmcl-save-manager' + (process.platform === 'win32' ? '.exe' : '');
await mkdir('dist-native', { recursive: true });
const file = path.join(meta.target_directory, 'release', name);
await copyFile(file, path.join('dist-native', name));
await writeFile(
  'dist-native/manifest.json',
  JSON.stringify({
    schemaVersion: 1,
    platform: process.platform,
    arch: process.arch,
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    executable: name,
  }),
);
await import('./build-seed-map.mjs');
await import('./build-projection.mjs');
