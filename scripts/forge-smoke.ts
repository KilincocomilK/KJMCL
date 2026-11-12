import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Store } from '../electron/core/store';
import { Network } from '../electron/core/network';
import { Forge } from '../electron/core/forge';
import { Java } from '../electron/core/java';
import { hashFile } from '../electron/core/files';
import type { Version } from '../electron/core/minecraft';
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-installer-'));
  try {
    const store = new Store(root),
      net = new Network(() => store.data.settings);
    const runtime = (await new Java(store, net).discover()).find((j) => j.major >= 17);
    if (!runtime) throw new Error('JDK 17+ required');
    const ext = process.platform === 'win32' ? '.exe' : '',
      bin = path.dirname(runtime.path),
      source = path.join(root, 'src');
    await mkdir(source);
    const generated = {
      id: 'fixture-loader',
      inheritsFrom: '1.21.1',
      type: 'release',
      mainClass: 'FixtureMain',
      libraries: [
        {
          name: 'fixture:generated:1',
          downloads: { artifact: { path: 'fixture/generated/1/generated-1.jar', url: '' } },
        },
      ],
      arguments: { game: ['--loader', 'fixture'] },
    };
    const java = `import java.nio.file.*; public class FixtureInstaller { public static void main(String[] args) throws Exception { if(args.length!=2 || !args[0].equals("--installClient")) throw new Exception("invalid CLI"); Path root=Path.of(args[1]); if(!Files.exists(root.resolve("versions/1.21.1/1.21.1.jar")))throw new Exception("missing vanilla seed"); Files.createDirectories(root.resolve("versions/fixture-loader")); Files.writeString(root.resolve("versions/fixture-loader/fixture-loader.json"), ${JSON.stringify(JSON.stringify(generated))}); Files.createDirectories(root.resolve("libraries/fixture/generated/1")); Files.writeString(root.resolve("libraries/fixture/generated/1/generated-1.jar"),"generated"); System.out.println("INSTALLER_FIXTURE_OK"); } }`;
    await writeFile(path.join(source, 'FixtureInstaller.java'), java);
    execFileSync(path.join(bin, 'javac' + ext), [path.join(source, 'FixtureInstaller.java')]);
    const archive = path.join(root, 'fixture.jar');
    execFileSync(path.join(bin, 'jar' + ext), [
      'cfe',
      archive,
      'FixtureInstaller',
      '-C',
      source,
      'FixtureInstaller.class',
    ]);
    const digest = await hashFile(archive);
    net.response = async () => new Response(digest) as any;
    net.download = async (_url, dest, ctx) => {
      assert.equal(ctx.hash, digest);
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(archive, dest);
    };
    for (const loader of ['forge', 'neoforge'] as const) {
      const id = loader;
      store.data.instances.push({
        id,
        name: id,
        version: '1.21.1',
        loader,
        loaderVersion: loader === 'forge' ? '52.0.1' : '21.1.1',
        status: 'empty',
        createdAt: 0,
        playTime: 0,
        memoryMb: 1024,
        javaPath: runtime.path,
        jvmArgs: [],
        width: 1280,
        height: 720,
        localRuntime: true,
      });
      const dir = store.dir(id);
      await mkdir(path.join(dir, 'logs'), { recursive: true });
      await writeFile(path.join(dir, 'client.jar'), 'seed');
      const parent: Version = {
        id: '1.21.1',
        type: 'release',
        mainClass: 'Main',
        libraries: [],
        javaVersion: { majorVersion: runtime.major },
        arguments: { game: ['--username', 'Player'] },
      };
      const version = await new Forge(store, net).install(id, parent, {
        signal: new AbortController().signal,
        progress: () => {},
      });
      assert.equal(version.mainClass, 'FixtureMain');
      assert.equal(
        await readFile(
          path.join(store.runtime(id), 'libraries/fixture/generated/1/generated-1.jar'),
          'utf8',
        ),
        'generated',
      );
      assert.deepEqual(version.arguments?.game, ['--username', 'Player', '--loader', 'fixture']);
    }
    console.log(
      'PASS Forge / NeoForge adapter: real headless JVM fixture, vanilla seed, generated metadata and libraries; no network downloads',
    );
  } finally {
    if (path.basename(root).startsWith('kjmcl-installer-'))
      await rm(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
