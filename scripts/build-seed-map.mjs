import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const manifest = path.resolve('electron/native/seed-map/Cargo.toml');
const revision = 'b99f6e472018cab903a096697117aab9d9170a19';
const windows = process.platform === 'win32';
const target = windows ? 'x86_64-pc-windows-gnu' : undefined;
const options = { windowsHide: true, encoding: 'utf8' };
if (windows) {
  if (process.arch !== 'x64') throw new Error('Windows 种子核心当前需要 x64 构建机。');
  try {
    execFileSync('gcc', ['--version'], options);
    execFileSync('objdump', ['--version'], options);
  } catch {
    throw new Error('种子核心需要 MSYS2 UCRT64 GCC 与 binutils；请将其 bin 目录加入 PATH。');
  }
  const installed = execFileSync('rustup', ['target', 'list', '--installed'], options);
  if (!installed.split(/\s+/).includes(target)) throw new Error(`请先执行 rustup target add ${target}，再构建种子核心。`);
}
const targetArgs = target ? ['--target', target] : [];
execFileSync('cargo', ['build', '--release', '--locked', '--manifest-path', manifest, ...targetArgs], { stdio: 'inherit', windowsHide: true });
const meta = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', manifest], options));
const executable = 'kjmcl-seed-map' + (windows ? '.exe' : '');
const directory = 'dist-native/seed-map';
const source = path.join(meta.target_directory, ...(target ? [target] : []), 'release', executable);
let imports;
if (windows) {
  // A developer's GCC PATH must not mask an external runtime dependency.
  imports = [...execFileSync('objdump', ['-p', source], options).matchAll(/DLL Name:\s*(\S+)/g)].map(m => m[1]);
  if (!imports.length || imports.some(name => !/^(?:api-ms-win-.+|kernel32|ntdll|userenv|ws2_32|bcryptprimitives|advapi32|bcrypt|msvcrt|ucrtbase)\.dll$/i.test(name))) throw new Error(`种子核心含非系统 DLL 依赖：${imports.join(', ')}`);
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const cleanEnv = {...process.env, PATH: `${systemRoot}\\System32;${systemRoot}`};
  const smoke = JSON.parse(execFileSync(source, [], {...options, env: cleanEnv, input: '{"protocol":1,"command":"info"}'}));
  if (!smoke.ok || smoke.result?.data?.revision !== revision) throw new Error('种子核心独立运行检查失败。');
}
await mkdir(directory, { recursive: true });
await copyFile(source, path.join(directory, executable));
await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({schemaVersion: 1, platform: process.platform, arch: process.arch, executable, sha256: createHash('sha256').update(await readFile(source)).digest('hex'), upstreamRevision: revision, ...(imports ? {systemDlls:imports} : {})}));
