import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { memoryBudget, planRuntime, requiredJava, Performance } from '../electron/core/performance';
import { javaArch, compareJava, Java } from '../electron/core/java';
import { diagnose, gcSummary, Diagnostics } from '../electron/core/diagnostics';
import { VideoSettings, optionValues } from '../electron/core/video-settings';
import { Store } from '../electron/core/store';
import { Minecraft } from '../electron/core/minecraft';
import { Network } from '../electron/core/network';
import { atomicJson } from '../electron/core/files';
import { redact } from '../electron/core/launcher';
import { Tasks } from '../electron/core/tasks';
import type { Instance, JavaRuntime } from '../shared/types';
const runtime: JavaRuntime = {
  path: '/java',
  major: 21,
  version: '21.0.7',
  arch: 'amd64',
  vm: 'OpenJDK 64-Bit Server VM',
};
const instance: Instance = {
  id: 'test',
  name: 'test',
  version: '1.21.11',
  loader: 'fabric',
  status: 'ready',
  createdAt: 0,
  playTime: 0,
  memoryMb: 4096,
  javaPath: '',
  jvmArgs: [],
  width: 1280,
  height: 720,
};
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-performance-'));
  roots.push(root);
  const store = new Store(root);
  store.data.instances.push({ ...instance });
  store.save();
  await mkdir(store.dir('test'), { recursive: true });
  return store;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
describe('runtime policy', () => {
  it('allows split module-access arguments without allowing a replacement main class', () => {
    const i = { ...instance, jvmArgs: ['--add-opens', 'java.base/java.lang=ALL-UNNAMED'] };
    expect(planRuntime(i, 21, runtime, 16384, 12000, 'x64').issues).toEqual([]);
    expect(
      planRuntime({ ...i, jvmArgs: ['evil.Main'] }, 21, runtime, 16384, 12000, 'x64').issues.map(
        (x) => x.code,
      ),
    ).toContain('launch-override');
  });
  it('excludes launch and writes while an awaited per-instance operation is active', async () => {
    const tasks = new Tasks(() => {});
    let release!: () => void;
    const running = tasks.exclusive(
      'test',
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    expect(tasks.busy('test')).toBe(true);
    expect(() => tasks.start('launch', 'test', async () => {})).toThrow('任务正在运行');
    release();
    await running;
    expect(tasks.busy('test')).toBe(false);
    await expect(
      tasks.exclusive('test', async () => {
        throw new Error('failure');
      }),
    ).rejects.toThrow('failure');
    expect(tasks.busy('test')).toBe(false);
  });
  it('reserves physical memory, rounds down and respects the user cap', () => {
    const i: Instance = {
      ...instance,
      performance: { memory: 'auto', collector: 'auto', gcLogging: false },
    };
    expect(memoryBudget(i, 8192, 5000)).toBe(2816);
    expect(memoryBudget(i, 65536, 50000)).toBe(4096);
    expect(memoryBudget(i, 4096, 500)).toBe(512);
    expect(memoryBudget(instance, 4096, 500)).toBe(4096);
    expect(planRuntime(i, 21, runtime, 4096, 500, 'x64').issues.map((x) => x.code)).toContain(
      'memory-pressure',
    );
  });
  it('honours metadata before release fallback, including Java 16 and 25', () => {
    expect(requiredJava('1.17.1')).toBe(16);
    expect(requiredJava('1.20.4')).toBe(17);
    expect(requiredJava('1.20.5')).toBe(21);
    expect(requiredJava('26.1')).toBe(25);
    expect(requiredJava('1.12.2', 21)).toBe(21);
  });
  it('normalizes aliases and compares patch versions numerically', () => {
    expect(javaArch('aarch64')).toBe('arm64');
    expect(javaArch('x86_64')).toBe('x64');
    expect(
      [
        { ...runtime, version: '21.0.9' },
        { ...runtime, version: '21.0.10' },
      ].sort(compareJava)[0].version,
    ).toBe('21.0.10');
    expect(
      planRuntime(instance, 21, { ...runtime, arch: 'aarch64' }, 16384, 12000, 'x64').issues[0]
        .code,
    ).toBe('java-arch');
  });
  it.each([17, 21, 22, 23, 24, 25])('generates supported ZGC flags for Java %s', (major) => {
    const r = planRuntime(
      { ...instance, performance: { memory: 'manual', collector: 'zgc', gcLogging: false } },
      major,
      { ...runtime, major },
      16384,
      12000,
      'x64',
    );
    expect(r.managedArgs).toContain('-XX:+UseZGC');
    expect(r.managedArgs.includes('-XX:+ZGenerational')).toBe(major === 21 || major === 22);
  });
  it('rejects conflicting heap, collector, initial heap and argument-file overrides', () => {
    const r = planRuntime(
      {
        ...instance,
        jvmArgs: ['-Xmx8G', '-Xms8G', '-XX:+UseZGC', '@args'],
        performance: { memory: 'manual', collector: 'g1', gcLogging: false },
      },
      21,
      runtime,
      16384,
      12000,
      'x64',
    );
    expect(r.issues.map((x) => x.code)).toEqual(
      expect.arrayContaining(['heap-conflict', 'xms-invalid', 'gc-conflict', 'launch-override']),
    );
  });
  it('defaults to JVM collector choice without adding speculative flags', () => {
    expect(planRuntime(instance, 21, runtime, 16384, 12000, 'x64').managedArgs).toEqual([
      '-Xmx4096M',
    ]);
  });
  it('detects missing launch files without network access or authentication', async () => {
    const store = await fixture(),
      net = new Network(() => store.data.settings),
      mc = new Minecraft(store, net);
    await atomicJson(mc.profile('test'), {
      id: 'fixture',
      libraries: [],
      mainClass: 'Main',
      javaVersion: { majorVersion: 21 },
    });
    const java = { discover: async () => [{ ...runtime, arch: process.arch }] } as unknown as Java;
    const check = await new Performance(store, mc, java).check('test', false);
    expect(check.issues.map((x) => x.code)).toContain('files-missing');
    expect(check.tested).toBe(false);
  });
});
describe('reversible game options', () => {
  it('preserves unrelated options and CRLF; restores only fields changed by the preset', async () => {
    const store = await fixture(),
      file = path.join(store.dir('test'), 'options.txt'),
      service = new VideoSettings(store);
    const before =
      'renderDistance:24\r\nsimulationDistance:12\r\nentityDistanceScaling:1.0\r\nmaxFps:260\r\nkey_jump:key.keyboard.space\r\n';
    await writeFile(file, before);
    await service.apply('test', 'low');
    let text = await readFile(file, 'utf8');
    expect(text).toContain('renderDistance:8\r\n');
    await expect(service.apply('test', 'balanced')).rejects.toThrow('还原');
    text = text.replace('key.keyboard.space', 'key.keyboard.j');
    await writeFile(file, text);
    await service.restore('test');
    expect(await readFile(file, 'utf8')).toBe(
      before.replace('key.keyboard.space', 'key.keyboard.j'),
    );
    expect((await service.state('test')).canRestore).toBe(false);
  });
  it('does not overwrite later edits to preset fields', async () => {
    const store = await fixture(),
      file = path.join(store.dir('test'), 'options.txt'),
      service = new VideoSettings(store);
    await writeFile(file, 'renderDistance:20\n');
    await service.apply('test', 'low');
    await writeFile(file, 'renderDistance:10\n');
    await expect(service.restore('test')).rejects.toThrow('游戏中修改');
    expect(await readFile(file, 'utf8')).toBe('renderDistance:10\n');
  });
  it('refuses missing, duplicate and unsupported option files', async () => {
    const store = await fixture(),
      service = new VideoSettings(store);
    await expect(service.apply('test', 'low')).rejects.toThrow('先启动游戏');
    expect(() => optionValues('renderDistance:2\nrenderDistance:3')).toThrow('重复');
    await writeFile(path.join(store.dir('test'), 'options.txt'), 'sound:1\n');
    await expect(service.apply('test', 'low')).rejects.toThrow('无需修改');
  });
});
describe('durable diagnosis', () => {
  it('distinguishes stop requests, weak logging warnings and evidence of a failure', () => {
    expect(diagnose(['SIGTERM'], 'stopped')).toEqual([]);
    expect(
      diagnose(['Reconfiguration failed: No configuration found', 'SIGTERM'], 'failed')[0].title,
    ).toBe('未识别的异常退出');
    expect(diagnose(['java.lang.OutOfMemoryError: Java heap space'], 'failed')[0].title).toBe(
      'Java 堆内存不足',
    );
    expect(diagnose(['MixinApplyError: abc'], 'failed')[0].evidence).toContain('abc');
  });
  it('counts completed pauses only, excluding concurrent GC and start records', () => {
    const r = gcSummary(
      '[gc,start] GC(0) Pause Young\n[gc] GC(0) Pause Young 10M->2M(32M) 1.200ms\n[gc] GC(1) Concurrent Mark 95.2ms\n[gc,phases] GC(1) Pause Mark End 0.020ms',
    );
    expect(r.pauses).toBe(2);
    expect(r.totalPauseMs).toBeCloseTo(1.22);
    expect(r.maxPauseMs).toBe(1.2);
  });
  it('retains bounded redacted records and labels unfinished sessions as unknown on restart', async () => {
    const store = await fixture(),
      d = new Diagnostics(store),
      s = await d.start('test');
    s.status = 'failed';
    await d.finish(s, [
      {
        time: 0,
        instanceId: 'test',
        level: 'error',
        text: redact('accessToken=secret_fixture UnsupportedClassVersionError'),
      },
    ]);
    expect(await readFile(path.join(store.root, 'diagnostics/test.json'), 'utf8')).not.toContain(
      'secret_fixture',
    );
    for (let n = 0; n < 13; n++) await d.start('test');
    const records = await new Diagnostics(store).list('test');
    expect(records).toHaveLength(12);
    expect(records[0].status).toBe('interrupted');
  });
  it('migrates v2 preserving manual memory and an untouched recovery copy', async () => {
    const store = await fixture(),
      file = path.join(store.root, 'state.json');
    const old = JSON.parse(await readFile(file, 'utf8'));
    old.schemaVersion = 2;
    old.instances[0].memoryMb = 7168;
    await atomicJson(file, old);
    const migrated = new Store(store.root);
    expect(migrated.data.schemaVersion).toBe(6);
    expect(migrated.instance('test').memoryMb).toBe(7168);
    expect(migrated.instance('test').performance?.memory).toBe('manual');
    expect(JSON.parse(await readFile(file + '.v2.bak', 'utf8'))).toEqual(old);
  });
});
