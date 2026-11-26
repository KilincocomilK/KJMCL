import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
import './build-electron.mjs';
const server = await createServer();
await server.listen();
const atlas = spawn(process.execPath, ['scripts/icon-atlas.mjs', '--watch'], {
  stdio: 'inherit',
  windowsHide: true,
});
const env = { ...process.env, KJMCL_DEV_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
child.on('exit', async (code) => {
  atlas.kill();
  await server.close();
  process.exit(code ?? 0);
});
process.on('SIGINT', () => child.kill());
