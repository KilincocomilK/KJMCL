import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { levelFixture, regionFixture } from './save-fixtures.mjs';
const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-save-bench-'));
try {
  await mkdir(path.join(root, 'region'));
  await mkdir(path.join(root, 'cache'));
  await writeFile(path.join(root, 'level.dat'), levelFixture());
  const region = regionFixture(1024);
  const count = 128;
  for (let n = 0; n < count; n++)
    await writeFile(path.join(root, 'region', `r.${n % 16}.${Math.floor(n / 16)}.mca`), region);
  const exe = path.resolve(
    'dist-native/kjmcl-save-manager' + (process.platform === 'win32' ? '.exe' : ''),
  );
  const run = (command, args = {}) => {
    const t = performance.now();
    const output = JSON.parse(
      execFileSync(exe, [], {
        input: JSON.stringify({ protocol: 1, root, command, ...args }),
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      }),
    );
    if (!output.ok) throw new Error(output.error);
    return {
      wallMs: performance.now() - t,
      nativeMs: output.result.elapsedMs,
      cached: output.result.data.cached,
    };
  };
  const scans = Array.from({ length: 5 }, () => run('scan'));
  const view = { dimension: 'overworld', rx: 0, rz: 0, cache: path.join(root, 'cache') };
  const cold = run('region', view),
    warm = run('region', view);
  const report = {
    date: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length,
    regions: count,
    chunks: count * 1024,
    regionFileBytes: region.length * count,
    scans,
    firstTerrain: cold,
    cachedTerrain: warm,
    scope:
      'Synthetic zlib single-palette sections; filesystem cache not flushed; times include separately measured native work and process wall time. Not real-world or comparative acceptance.',
  };
  await mkdir('.local', { recursive: true });
  await writeFile('.local/save-benchmark-v050.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (path.basename(root).startsWith('kjmcl-save-bench-'))
    await rm(root, { recursive: true, force: true });
}
