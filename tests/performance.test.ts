import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  memoryArgumentIssues,
  memoryBudget,
  planRuntime,
  requiredJava,
  Performance,
} from '../electron/core/performance';
import { javaArch, compareJava, Java } from '../electron/core/java';
import { diagnose, gcSummary, Diagnostics } from '../electron/core/diagnostics';
import { VideoSettings, optionValues } from '../electron/core/video-settings';
import { Store, STATE_VERSION } from '../electron/core/store';
import { configureWelcomeJava, welcomeJavaInfo } from '../electron/core/welcome-java';
import { welcomeJavaChoices } from '../shared/java';
import { Minecraft, expandArguments } from '../electron/core/minecraft';
import { prepareGameLaunch } from '../electron/core/launch-options';
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
  it('lists installed Java first and prefers a locally available game match', () => {
    const local = [{ major: 21 }, { major: 17 }, { major: 21 }, { major: 22 }];
    expect(welcomeJavaChoices(local).map((v) => v.major)).toEqual([21, 17, 25, 16, 8]);
    expect(welcomeJavaChoices(local, '1.20.4')[0]).toMatchObject({
      major: 17,
      installed: true,
      matchesGame: true,
    });
    const missing = welcomeJavaChoices(local, '26.1');
    expect(missing[0].major).toBe(21);
    expect(missing.find((v) => v.matchesGame)).toMatchObject({ major: 25, installed: false });
    expect(welcomeJavaChoices([], '1.17.1')[0].major).toBe(16);
    expect(welcomeJavaChoices([{ major: 24 }], 'custom-version')[0].major).toBe(25);
  });
  it('configures an existing matching Java, preserving the memory of existing instances', async () => {
    const store = await fixture();
    store.data.settings.javaPath = '/old-path';
    const java = new Java(store, new Network(() => store.data.settings));
    vi.spyOn(java, 'discover').mockResolvedValue([
      { ...runtime, major: 17, arch: 'unrelated' },
      { ...runtime, arch: process.arch },
    ]);
    const install = vi.spyOn(java, 'install').mockRejectedValue(new Error('unexpected download'));
    expect((await welcomeJavaInfo(java)).available.map((j) => j.major)).toEqual([21]);
    const ctx = { signal: new AbortController().signal, progress: () => {} };
    await expect(
      configureWelcomeJava(java, store, { major: 17, allowInstall: false }, ctx),
    ).rejects.toThrow('重新检测');
    expect(store.data.welcomeConfigured).toEqual([]);
    await configureWelcomeJava(java, store, { major: 21, allowInstall: false }, ctx);
    expect(install).not.toHaveBeenCalled();
    const reloaded = new Store(store.root);
    expect(reloaded.data.settings.javaPath).toBe('');
    expect(reloaded.data.welcomeConfigured).toEqual(['java']);
    expect(reloaded.data.settings.memoryMb).toBeGreaterThanOrEqual(512);
    expect(reloaded.data.settings.memoryMb).toBeLessThanOrEqual(4096);
    expect(reloaded.instance('test').memoryMb).toBe(instance.memoryMb);
  });
  it('preserves settings if Java installation fails, is cancelled, or races a manual edit', async () => {
    const store = await fixture();
    store.data.settings.javaPath = '/initial';
    const java = new Java(store, new Network(() => store.data.settings));
    vi.spyOn(java, 'discover').mockResolvedValue([]);
    const install = vi.spyOn(java, 'install').mockRejectedValueOnce(new Error('network failed'));
    const control = new AbortController();
    const ctx = { signal: control.signal, progress: () => {} };
    const configure = () =>
      configureWelcomeJava(java, store, { major: 25, allowInstall: true }, ctx);
    await expect(configure()).rejects.toThrow('network failed');
    expect(store.data.settings.javaPath).toBe('/initial');
    install.mockImplementationOnce(async () => {
      store.data.settings.javaPath = '/manual';
    });
    await expect(configure()).rejects.toThrow('保留');
    expect(store.data.settings.javaPath).toBe('/manual');
    install.mockImplementationOnce(async () => {
      control.abort(new Error('cancelled'));
    });
    await expect(configure()).rejects.toThrow('cancelled');
    expect(store.data.settings.javaPath).toBe('/manual');
    expect(store.data.welcomeConfigured).toEqual([]);
  });
  it('commits the Java flag and settings together and respects finishing during installation', async () => {
    const store = await fixture();
    store.data.settings.javaPath = '/original';
    const java = new Java(store, new Network(() => store.data.settings));
    vi.spyOn(java, 'discover').mockResolvedValue([{ ...runtime, arch: process.arch }]);
    const ctx = { signal: new AbortController().signal, progress: () => {} };
    const save = vi.spyOn(store, 'save').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    await expect(
      configureWelcomeJava(java, store, { major: 21, allowInstall: false }, ctx),
    ).rejects.toThrow('disk full');
    expect(store.data.settings.javaPath).toBe('/original');
    expect(store.data.welcomeConfigured).toEqual([]);
    save.mockRestore();
    const install = vi.spyOn(java, 'install').mockImplementation(async () => {
      store.setWelcome({ step: 'account', player: 'new' });
    });
    await configureWelcomeJava(java, store, { major: 25, allowInstall: true }, ctx);
    expect(new Store(store.root).data.welcomeConfigured).toEqual(['java']);
    install.mockImplementation(async () => {
      store.setWelcome({ step: 'done' });
    });
    await configureWelcomeJava(java, store, { major: 25, allowInstall: true }, ctx);
    expect(new Store(store.root).data.welcomeConfigured).toEqual([]);
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
  it('respects JVM collector choices across sources and rejects an explicitly disabled managed GC', () => {
    const codes = (jvmArgs: string[], metadata: string[], collector: 'auto' | 'g1' = 'auto') =>
      planRuntime(
        { ...instance, jvmArgs, performance: { memory: 'manual', collector, gcLogging: false } },
        21,
        { ...runtime, vendor: 'Azul Systems, Inc.' },
        16384,
        12000,
        'x64',
        metadata,
      )
        .issues.filter((issue) => issue.level === 'error')
        .map((issue) => issue.code);
    expect(codes(['-XX:+UseZGC'], ['-XX:+UseG1GC'])).toContain('gc-conflict');
    expect(codes([], ['-XX:+UseSerialGC', '-XX:+UseG1GC'])).toContain('gc-conflict');
    expect(codes(['-XX:+UseZGC'], ['-XX:-UseZGC', '-XX:+UseG1GC'])).toEqual([]);
    expect(codes(['-XX:+UseG1GC'], ['-XX:+UseG1GC'], 'g1')).toEqual([]);
    expect(codes([], ['-XX:-UseG1GC'], 'g1')).toContain('gc-conflict');
    expect(codes(['-XX:+UseAdaptiveSizePolicyWithSystemGC'], [], 'g1')).toEqual([]);
    expect(codes(['-Xms256M'], ['-XX:InitialHeapSize=1G'])).toContain('xms-duplicate');
    expect(codes([], ['-XX:InitialHeapSize=8G'])).toContain('xms-invalid');
  });
  it('uses the same profile, classpath and active feature rules for preflight and launch', async () => {
    const store = await fixture();
    const mc = new Minecraft(store, new Network(() => store.data.settings));
    const java = { discover: async () => [{ ...runtime, arch: process.arch }] } as unknown as Java;
    const performance = new Performance(store, mc, java);
    const i = store.instance('test');
    i.jvmArgs = ['-XX:+UseZGC'];
    const serverRule = [{ action: 'allow', features: { is_quick_play_multiplayer: true } }];
    await atomicJson(mc.profile(i.id), {
      id: 'fixture',
      mainClass: 'Main',
      libraries: [],
      javaVersion: { majorVersion: 21 },
      arguments: {
        game: [{ rules: serverRule, value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'] }],
        jvm: [
          '-cp',
          '${classpath}',
          { rules: serverRule, value: ['-XX:+UseG1GC', '-Xms8G'] },
          {
            rules: [{ action: 'allow', features: { has_custom_resolution: true } }],
            value: '-Xmx2G',
          },
        ],
      },
    });
    await writeFile(path.join(store.dir(i.id), 'client.jar'), 'fixture');
    i.launchOptions = { fullscreen: true, target: { kind: 'menu' } };
    const resolved = vi.spyOn(mc, 'resolved');
    const plan = await prepareGameLaunch(mc, i.id);
    const check = await performance.check(i.id, false, undefined, plan);
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(check.checkedFiles).toBe(plan.classpath.length);
    expect(plan.jvm).toEqual(['-cp', '${classpath}']);
    expect(check.managedArgs).toEqual(['-Xmx4096M']);
    expect(check.issues.filter((issue) => issue.level === 'error')).toEqual([]);

    i.launchOptions = { fullscreen: false, target: { kind: 'server', address: 'localhost' } };
    const issues = (await performance.check(i.id, false)).issues.map((issue) => issue.code);
    expect(issues).toEqual(
      expect.arrayContaining(['gc-conflict', 'xms-invalid', 'metadata-conflict']),
    );
  });
  it('checks a metadata heap template once the launch variable has a value', () => {
    const template = ['-XX:InitialHeapSize=${resolution_width}M'];
    expect(planRuntime(instance, 21, runtime, 16384, 12000, 'x64', template).issues).toEqual([]);
    expect(
      memoryArgumentIssues(instance, 512, expandArguments(template, { resolution_width: '256' })),
    ).toEqual([]);
    expect(
      memoryArgumentIssues(instance, 512, expandArguments(template, { resolution_width: '1024' })),
    ).toMatchObject([{ code: 'xms-invalid', level: 'error' }]);
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
    expect(migrated.data.schemaVersion).toBe(STATE_VERSION);
    expect(migrated.instance('test').memoryMb).toBe(7168);
    expect(migrated.instance('test').performance?.memory).toBe('manual');
    expect(JSON.parse(await readFile(file + '.v2.bak', 'utf8'))).toEqual(old);
  });
});
