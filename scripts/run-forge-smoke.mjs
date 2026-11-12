import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
await build({
  entryPoints: ['scripts/forge-smoke.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: '.local/forge-smoke.cjs',
  external: ['electron'],
  target: 'node22',
});
execFileSync(process.execPath, ['.local/forge-smoke.cjs'], { stdio: 'inherit' });
