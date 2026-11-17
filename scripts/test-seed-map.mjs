import { execFileSync } from 'node:child_process';
const target = process.platform === 'win32' ? ['--target', 'x86_64-pc-windows-gnu'] : [];
execFileSync('cargo', ['test', '--locked', '--manifest-path', 'electron/native/seed-map/Cargo.toml', ...target], {stdio:'inherit',windowsHide:true});
