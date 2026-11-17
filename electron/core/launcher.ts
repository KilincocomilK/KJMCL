import { VERSION } from '../../shared/version';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { Store } from './store';
import { Minecraft, expandArguments } from './minecraft';
import { Java } from './java';
import { Performance, defaults } from './performance';
import { Diagnostics } from './diagnostics';
import { Auth } from './auth';
import { clientVersion } from './client-version';
import { GameLogDecoder } from './game-logs';
import type { LogLine, LaunchSession } from '../../shared/types';
import { redact } from './log-redaction';
import { gameLaunchArguments, launchAccount, prepareLaunchOptions } from './launch-options';
export { redact } from './log-redaction';
export class Launcher {
  performance: Performance;
  diagnostics: Diagnostics;
  processes = new Map<string, ChildProcess>();
  private lines = new Map<string, LogLine[]>();
  private writers = new Map<string, (level: 'info' | 'error', text: string) => void>();
  private stopped = new Set<string>();
  private spawned = new Set<string>();
  constructor(
    private store: Store,
    private mc: Minecraft,
    private java: Java,
    private auth: Auth,
    private changed: () => void,
    private onLog: (line: LogLine) => void,
    private onRunningChanged: (count: number) => void = () => {},
  ) {
    this.performance = new Performance(store, mc, java);
    this.diagnostics = new Diagnostics(store);
  }
  logs(id: string) {
    return this.lines.get(id) ?? [];
  }
  async launch(id: string, signal: AbortSignal = new AbortController().signal) {
    if (this.processes.has(id)) throw new Error('此实例已在运行');
    this.lines.set(id, []);
    const session = await this.diagnostics.start(id);
    try {
      await this.start(id, signal, session);
    } catch (e) {
      if (!this.processes.has(id)) {
        session.status = signal.aborted ? 'stopped' : 'failed';
        const line: LogLine = {
          instanceId: id,
          time: Date.now(),
          level: 'error',
          text: redact(e instanceof Error ? e.message : String(e)),
        };
        this.lines.set(id, [...this.logs(id), line]);
        this.onLog(line);
        await this.diagnostics.finish(session, this.logs(id));
        this.changed();
      }
      throw e;
    }
  }
  private async start(id: string, signal: AbortSignal, session: LaunchSession) {
    const i = this.store.instance(id);
    if (i.status !== 'ready') throw new Error('请先完成版本安装');
    const account = launchAccount(
      this.store.data.accounts,
      this.store.data.selectedAccountId,
      i.launchOptions,
    );
    const { version: v, client } = await this.mc.resolved(id);
    const launch = await prepareLaunchOptions(v, this.store.dir(id), i.launchOptions);
    if (i.localRuntime) {
      const version = await clientVersion(path.join(this.store.dir(id), 'client.jar'), i.version);
      if (version !== i.version) {
        i.version = version;
        this.store.save();
        this.changed();
      }
    }
    const check = await this.performance.check(id, true, signal);
    const errors = check.issues.filter((x) => x.level === 'error');
    if (errors.length) throw new Error(errors.map((x) => x.message).join('\n'));
    const runtime = check.runtime!;
    session.runtime = runtime;
    session.memoryMb = check.memoryMb;
    session.collector = (i.performance ?? defaults).collector;
    session.phase = '准备日志与账户';
    await this.diagnostics.save(id);
    const loggingFile = await this.mc.ensureLogging(id, v, signal);
    const root = this.store.dir(id),
      assets = path.join(this.store.runtime(id), 'assets');
    const token = await this.auth.token(account);
    const cp = [
      ...this.mc
        .libraryFiles(v, id)
        .filter((f) => !f.native)
        .map((f) => f.dest),
      client,
    ].join(path.delimiter);
    const vars: Record<string, string> = {
      ...launch.variables,
      natives_directory: await this.mc.prepareNatives(id, v),
      launcher_name: 'KJMCL',
      launcher_version: VERSION,
      classpath: cp,
      classpath_separator: path.delimiter,
      library_directory: path.join(this.store.runtime(id), 'libraries'),
      auth_player_name: account.name,
      version_name: v.id,
      game_directory: root,
      assets_root: assets,
      assets_index_name: v.assetIndex?.id ?? v.assets ?? '',
      auth_uuid: account.uuid,
      auth_access_token: token,
      auth_session: token,
      auth_xuid: '',
      clientid: this.store.data.settings.microsoftClientId,
      user_type:
        account.kind === 'microsoft' ? 'msa' : account.kind === 'yggdrasil' ? 'mojang' : 'legacy',
      version_type: v.type ?? 'release',
      user_properties: '{}',
      resolution_width: String(i.width),
      resolution_height: String(i.height),
      game_assets: path.join(assets, 'virtual', v.assets ?? 'legacy'),
    };
    const jvm = expandArguments(
      v.arguments?.jvm?.length
        ? v.arguments.jvm
        : ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
      vars,
      launch.features,
    );
    const game = gameLaunchArguments(v, vars, launch);
    const injection =
      account.kind === 'yggdrasil' && this.auth.thirdParty
        ? await this.auth.thirdParty.injector(account, signal)
        : [];
    const args = [
      ...check.managedArgs,
      '-Dfile.encoding=UTF-8',
      ...injection,
      ...i.jvmArgs,
      ...jvm,
    ];
    await mkdir(path.join(root, 'logs'), { recursive: true });
    if (i.performance?.gcLogging) {
      session.gcLog = `kjmcl-gc-${session.id}.log`;
      args.push(
        `-Xlog:gc*:file=logs/${session.gcLog}:time,uptime,level,tags:filecount=3,filesize=1M`,
      );
    }
    if (process.platform === 'darwin' && !args.includes('-XstartOnFirstThread'))
      args.push('-XstartOnFirstThread');
    if (v.logging?.client && loggingFile)
      args.push(v.logging.client.argument.replace('${path}', loggingFile));
    args.push(v.mainClass, ...game);
    const write = (level: 'info' | 'error', text: string) => {
      const line = { instanceId: id, time: Date.now(), level, text: redact(text, [token]) };
      const list = this.lines.get(id) ?? [];
      list.push(line);
      this.lines.set(id, list.slice(-2000));
      this.onLog(line);
      void appendFile(
        path.join(root, 'logs', 'kjmcl.log'),
        new Date(line.time).toISOString() + ' ' + line.text + '\n',
      ).catch(() => {});
    };
    this.writers.set(id, write);
    this.stopped.delete(id);
    write(
      'info',
      `Java ${runtime.version} · ${runtime.arch} · ${check.memoryMb} MiB · GC ${session.collector}`,
    );
    for (const issue of check.issues) write('info', issue.message);
    signal.throwIfAborted();
    const child = spawn(runtime.path, args, {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    this.processes.set(id, child);
    const started = Date.now();
    let spawnError: Error | undefined;
    child.once('error', (e) => {
      spawnError = e;
      write('error', e.message);
    });
    for (const [stream, level] of [
      [child.stdout, 'info'],
      [child.stderr, 'error'],
    ] as const) {
      const decoder = new GameLogDecoder(level, write);
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => decoder.push(chunk));
      stream?.on('end', () => decoder.end());
    }
    child.once('close', (code, signal) => {
      this.processes.delete(id);
      if (this.spawned.delete(id)) this.onRunningChanged(this.spawned.size);
      i.playTime += Date.now() - started;
      this.store.save();
      const requested = this.stopped.delete(id);
      session.status = requested ? 'stopped' : code === 0 ? 'exited' : 'failed';
      session.phase = requested ? '由玩家结束' : '游戏进程已退出';
      session.exitCode = code;
      session.signal = signal;
      write(
        code === 0 || requested ? 'info' : 'error',
        requested
          ? `游戏已由启动器结束 · ${signal ?? code ?? '未知'}`
          : `游戏已退出 · ${signal ?? code ?? spawnError?.message ?? '未知'}`,
      );
      this.writers.delete(id);
      this.changed();
      void this.diagnostics
        .finish(session, this.logs(id))
        .then(() => this.changed())
        .catch(() => write('error', '无法保存本次诊断记录'));
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => {
        this.spawned.add(id);
        this.onRunningChanged(this.spawned.size);
        resolve();
      });
      child.once('error', reject);
    });
    if (!this.processes.has(id)) return;
    i.lastPlayed = Date.now();
    session.status = 'running';
    session.phase = '游戏进程运行中';
    await this.diagnostics.save(id);
    this.store.save();
    this.changed();
  }
  stop(id: string) {
    const child = this.processes.get(id);
    if (!child) throw new Error('实例未运行');
    this.writers.get(id)?.('info', '收到结束游戏请求，正在终止进程');
    this.stopped.add(id);
    if (!child.kill()) {
      this.stopped.delete(id);
      throw new Error('无法终止游戏进程');
    }
  }
}
