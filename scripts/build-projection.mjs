import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const manifest = path.resolve('electron/native/projection/Cargo.toml');
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
const executable = 'kjmcl-projection' + (process.platform === 'win32' ? '.exe' : '');
const source = path.join(meta.target_directory, 'release', executable),
  directory = 'dist-native/projection';
await mkdir(directory, { recursive: true });
await copyFile(source, path.join(directory, executable));
await writeFile(
  path.join(directory, 'manifest.json'),
  JSON.stringify({
    schemaVersion: 1,
    platform: process.platform,
    arch: process.arch,
    executable,
    sha256: createHash('sha256')
      .update(await readFile(source))
      .digest('hex'),
  }),
);
