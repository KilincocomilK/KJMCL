import { build } from 'esbuild';
import './build-native.mjs';
await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/dialog-preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  external: ['electron'],
  target: 'node22',
  sourcemap: true,
});
