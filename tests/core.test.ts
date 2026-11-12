import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inside, offlineUuid, atomicJson, hashFile, extractZip } from '../electron/core/files';
import {
  allowed,
  mavenPath,
  mergeVersions,
  expandArguments,
  type Version,
  Minecraft,
} from '../electron/core/minecraft';
import { Store } from '../electron/core/store';
import { Tasks } from '../electron/core/tasks';
import { Network, pool } from '../electron/core/network';
import { GameLogDecoder } from '../electron/core/game-logs';
import { redact } from '../electron/core/launcher';
import { settingsSchema, schemas } from '../shared/schema';
import AdmZip from 'adm-zip';
const dirs: string[] = [];
async function temp() {
  const p = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-test-'));
  dirs.push(p);
  return p;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
describe('untrusted files', () => {
  it.each(['../outside', 'a/../../b', '/etc/passwd', 'C:/escape', 'a\\..\\escape', 'foo\0bar'])(
    'rejects %s',
    (entry) => expect(() => inside('/root/data', entry)).toThrow(),
  );
  it('accepts nested resource paths', () =>
    expect(inside('/root', 'assets/a.json')).toBe(path.resolve('/root/assets/a.json')));
  it('extracts valid zip content', async () => {
    const dir = await temp(),
      zip = new AdmZip();
    zip.addFile('mods/example.jar', Buffer.from('test'));
    zip.writeZip(path.join(dir, 'pack.zip'));
    await extractZip(path.join(dir, 'pack.zip'), path.join(dir, 'out'));
    expect(await readFile(path.join(dir, 'out/mods/example.jar'), 'utf8')).toBe('test');
  });
  it('creates the Java offline UUID', () => {
    expect(offlineUuid('Notch')).toBe('b50ad385829d3141a2167e7d7539ba7f');
    expect(offlineUuid('Notch')).not.toBe(offlineUuid('notch'));
  });
  it('writes state atomically and verifies hash', async () => {
    const p = path.join(await temp(), 'state.json');
    await atomicJson(p, { a: 1 });
    expect(JSON.parse(await readFile(p, 'utf8'))).toEqual({ a: 1 });
    expect(await hashFile(p)).toHaveLength(40);
  });
});
describe('Minecraft launch metadata', () => {
  it('implements ordered OS rules and missing features', () => {
    expect(allowed(undefined)).toBe(true);
    expect(allowed([])).toBe(false);
    const r = [{ action: 'allow' as const }, { action: 'disallow' as const, os: { name: 'osx' } }];
    expect(allowed(r, 'osx')).toBe(false);
    expect(allowed(r, 'windows')).toBe(true);
    expect(allowed([{ action: 'allow', features: { is_demo_user: true } }])).toBe(false);
    expect(allowed([{ action: 'allow', features: { has_custom_resolution: true } }])).toBe(true);
  });
  it('selects native architecture', () => {
    expect(allowed([{ action: 'allow', os: { arch: 'x86' } }], 'windows', 'x64')).toBe(false);
    expect(allowed([{ action: 'allow', os: { arch: 'x86' } }], 'windows', 'ia32')).toBe(true);
    expect(allowed([{ action: 'allow', os: { arch: 'x86_64' } }], 'linux', 'x64')).toBe(true);
    expect(allowed([{ action: 'allow', os: { arch: 'x86_64' } }], 'linux', 'arm64')).toBe(false);
  });
  it('resolves Maven classifiers', () =>
    expect(mavenPath('org.lwjgl:lwjgl:3.3.3:natives-windows')).toBe(
      'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar',
    ));
  it('merges loader inheritance without duplicate libraries', () => {
    const base: Version = {
      id: '1.21',
      type: 'release',
      mainClass: 'Main',
      libraries: [{ name: 'a:b:1' }],
      arguments: { game: ['--username', '${auth_player_name}'], jvm: ['-cp', '${classpath}'] },
      downloads: { client: { url: 'https://example.com/client.jar' } },
    };
    const child: Version = {
      id: 'fabric',
      type: 'release',
      mainClass: 'Fabric',
      libraries: [{ name: 'a:b:2' }],
      arguments: { jvm: ['-Dloader=fabric'] },
    };
    const v = mergeVersions(base, child);
    expect(v.libraries).toEqual([{ name: 'a:b:2' }]);
    expect(v.downloads).toBe(base.downloads);
    expect(v.arguments?.jvm).toEqual(['-cp', '${classpath}', '-Dloader=fabric']);
    expect(v.mainClass).toBe('Fabric');
  });
  it('preserves argument boundaries and rejects missing placeholders', () => {
    expect(
      expandArguments(
        [
          '--gameDir',
          '${game_directory}',
          { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' },
        ],
        { game_directory: 'C:/a b' },
      ),
    ).toEqual(['--gameDir', 'C:/a b']);
    expect(() => expandArguments(['${unknown}'], {})).toThrow('缺少启动参数');
  });
});
describe('persistence, IPC and task cancellation', () => {
  it('persists settings and recovers interrupted installations', async () => {
    const root = await temp(),
      store = new Store(root);
    store.data.settings.memoryMb = 6144;
    store.data.instances.push({
      id: 'test',
      name: 'Test',
      version: '1.21',
      loader: 'vanilla',
      status: 'installing',
      createdAt: 0,
      playTime: 0,
      memoryMb: 4096,
      javaPath: '',
      jvmArgs: [],
      width: 1280,
      height: 720,
    });
    store.save();
    const next = new Store(root);
    expect(next.data.settings.memoryMb).toBe(6144);
    expect(next.instance('test').status).toBe('error');
  });
  it('validates settings, usernames and filesystem identifiers', () => {
    expect(schemas.addOffline.safeParse('not valid').success).toBe(false);
    expect(schemas.install.safeParse('../data').success).toBe(false);
    expect(schemas.install.safeParse('..').success).toBe(false);
    expect(schemas.toggleMod.safeParse({ id: 'valid', name: '../bad.jar' }).success).toBe(false);
    expect(settingsSchema.safeParse({}).success).toBe(false);
  });
  it('locks instances until cancellation has settled', async () => {
    const tasks = new Tasks(() => {});
    const id = tasks.start('task', 'instance', async (ctx) => {
      await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve()));
      ctx.signal.throwIfAborted();
    });
    expect(() => tasks.start('other', 'instance', async () => {})).toThrow();
    tasks.cancel(id);
    await vi.waitFor(() => expect(tasks.items[0].status).toBe('cancelled'));
    expect(tasks.busy('instance')).toBe(false);
  });
  it('reports task errors without leaving a lock', async () => {
    const tasks = new Tasks(() => {});
    tasks.start('failure', 'test', async () => {
      throw new Error('fixture failure');
    });
    await vi.waitFor(() => expect(tasks.items[0].status).toBe('failed'));
    expect(tasks.busy('test')).toBe(false);
  });
  it('respects pool concurrency and stops after errors', async () => {
    let active = 0,
      max = 0;
    await pool(
      [1, 2, 3, 4],
      2,
      async () => {
        active++;
        max = Math.max(max, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      },
      new AbortController().signal,
    );
    expect(max).toBe(2);
    await expect(
      pool(
        [1, 2],
        1,
        async () => {
          throw new Error('stop');
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('stop');
  });
  it('redacts access and refresh tokens', () => {
    expect(redact('Bearer secret --accessToken secret2 token=abc', ['abc'])).toBe(
      'Bearer [REDACTED] --accessToken [REDACTED] token=[REDACTED]',
    );
    expect(redact('{"refresh_token":"abcd"}')).not.toContain('abcd');
  });
  it('mirrors only Minecraft content endpoints', async () => {
    const s = new Store(await temp());
    s.data.settings.source = 'bmclapi';
    const net = new Network(() => s.data.settings);
    expect(net.url('https://resources.download.minecraft.net/ab/abcdef')).toBe(
      'https://bmclapi2.bangbang93.com/assets/ab/abcdef',
    );
    expect(net.url('https://login.microsoftonline.com/consumers')).toBe(
      'https://login.microsoftonline.com/consumers',
    );
    expect(() => net.url('http://unsafe.test')).toThrow();
  });
});

describe('game log decoding', () => {
  it('decodes chunked Mojang XML messages and exceptions with the original severity', () => {
    const emit = vi.fn(),
      decoder = new GameLogDecoder('info', emit);
    const text =
      '<log4j:Event logger="test" timestamp="1" level="ERROR" thread="Render thread">\n<log4j:Message><![CDATA[Load failed: <test> & data]]></log4j:Message>\n<log4j:Throwable><![CDATA[java.lang.Exception\n at Main.main(Main.java:1)]]></log4j:Throwable>\n</log4j:Event>\n';
    for (let n = 0; n < text.length; n += 7) decoder.push(text.slice(n, n + 7));
    decoder.end();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      'error',
      '[Render thread/ERROR] Load failed: <test> & data\njava.lang.Exception\n at Main.main(Main.java:1)',
    );
  });
  it('preserves plain agent output around XML events and flushes a final partial line', () => {
    const emit = vi.fn(),
      decoder = new GameLogDecoder('info', emit);
    decoder.push(
      '[authlib-injector] ready\r\n<log4j:Event level="INFO" thread="main"><log4j:Message>A &amp; B</log4j:Message></log4j:Event>\nplain tail',
    );
    decoder.end();
    expect(emit.mock.calls).toEqual([
      ['info', '[authlib-injector] ready'],
      ['info', '[main/INFO] A & B'],
      ['info', 'plain tail'],
    ]);
  });
  it('bounds incomplete XML and retains diagnostic output', () => {
    const emit = vi.fn(),
      decoder = new GameLogDecoder('error', emit);
    decoder.push('<log4j:Event>' + 'x'.repeat(300000));
    decoder.end();
    expect(emit.mock.calls.reduce((n, c) => n + c[1].length, 0)).toBe(300013);
  });
});
