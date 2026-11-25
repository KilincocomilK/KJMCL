import { VERSION } from '../../shared/version';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { Store } from './store';
import { Minecraft, expandArguments } from './minecraft';
import { Java } from './java';
import { Performance, defaults, memoryArgumentIssues } from './performance';
import { Diagnostics } from './diagnostics';
import { Auth } from './auth';
import { clientVersion } from './client-version';
import { GameOutput } from './game-logs';
import type { LogLine, LaunchSession } from '../../shared/types';
import { RecentGameLogs } from '../../shared/recent-logs';
import { redact } from './log-redaction';
import { gameLaunchArguments, launchAccount, prepareGameLaunch } from './launch-options';
export { redact } from './log-redaction';
export class Launcher {
  performance: Performance;
  diagnostics: Diagnostics;
  processes = new Map<string, ChildProcess>();
  private lines = new Map<string, RecentGameLogs>();
  private outputs = new Map<string, GameOutput>();
  private stopped = new Set<string>();
  private spawned = new Set<string>();
  constructor(
    private store: Store,
    private mc: Minecraft,
    private java: Java,
    private auth: Auth,
    private changed: () => void,
    private onLogs: (lines: LogLine[]) => void,
    private onRunningChanged: (count: number) => void = () => {},
  ) {
    this.performance = new Performance(store, mc, java);
    this.diagnostics = new Diagnostics(store);
  }
  logs(id: string) {
    return this.lines.get(id)?.snapshot() ?? [];
  }
  async flushLogs(id?: string) {
    if (id) await this.outputs.get(id)?.flush();
    else await Promise.all([...this.outputs.values()].map((output) => output.flush()));
  }
  async launch(id: string, signal: AbortSignal = new AbortController().signal) {
    if (this.processes.has(id)) throw new Error('此实例已在运行');
    const history = new RecentGameLogs();
    this.lines.set(id, history);
    const record = (batch: LogLine[]) => {
      for (const line of batch) history.append(line);
      this.onLogs(batch);
    };
    const session = await this.diagnostics.start(id);
    try {
      await this.start(id, signal, session, record);
    } catch (e) {
      if (!this.processes.has(id)) {
        session.status = signal.aborted ? 'stopped' : 'failed';
        const line: LogLine = {
          instanceId: id,
          time: Date.now(),
          level: 'error',
          text: redact(e instanceof Error ? e.message : String(e)),
        };
        record([line]);
        await this.diagnostics.finish(session, this.logs(id));
        this.changed();
      }
      throw e;
    }
  }
  private async start(
    id: string,
    signal: AbortSignal,
    session: LaunchSession,
    record: (lines: LogLine[]) => void,
  ) {
    const i = this.store.instance(id);
    if (i.status !== 'ready') throw new Error('请先完成版本安装');
    const account = launchAccount(
      this.store.data.accounts,
      this.store.data.selectedAccountId,
      i.launchOptions,
    );
    const prepared = await prepareGameLaunch(this.mc, id);
    const { version: v, options: launch } = prepared;
    if (i.localRuntime) {
      const version = await clientVersion(prepared.client, i.version);
      if (version !== i.version) {
        i.version = version;
        this.store.save();
        this.changed();
      }
    }
    const check = await this.performance.check(id, true, signal, prepared);
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
    const vars: Record<string, string> = {
      ...launch.variables,
      natives_directory: await this.mc.prepareNatives(id, v),
      launcher_name: 'KJMCL',
      launcher_version: VERSION,
      classpath: prepared.classpath.join(path.delimiter),
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
    const jvm = expandArguments(prepared.jvm, vars);
    const conflict = memoryArgumentIssues(i, check.memoryMb, jvm).find(
      (issue) => issue.level === 'error',
    );
    if (conflict) throw new Error(conflict.message);
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
    signal.throwIfAborted();
    const child = spawn(runtime.path, args, {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    this.processes.set(id, child);
    const started = Date.now();
    const output = new GameOutput(
      child,
      createWriteStream(path.join(root, 'logs', 'kjmcl.log'), {
        flags: 'a',
        highWaterMark: 256 * 1024,
      }),
      id,
      token,
      record,
    );
    this.outputs.set(id, output);
    this.stopped.delete(id);
    output.write(
      'info',
      `Java ${runtime.version} · ${runtime.arch} · ${check.memoryMb} MiB · GC ${session.collector}`,
    );
    for (const issue of check.issues) output.write('info', issue.message);
    let spawnError: Error | undefined;
    child.once('error', (e) => {
      spawnError = e;
      output.write('error', e.message);
    });
    child.once('close', async (code, signal) => {
      i.playTime += Date.now() - started;
      try {
        this.store.save();
      } catch {
        output.write('error', '无法保存游戏时长');
      }
      const requested = this.stopped.delete(id);
      session.status = requested ? 'stopped' : code === 0 ? 'exited' : 'failed';
      session.phase = requested ? '由玩家结束' : '游戏进程已退出';
      session.exitCode = code;
      session.signal = signal;
      output.write(
        code === 0 || requested ? 'info' : 'error',
        requested
          ? `游戏已由启动器结束 · ${signal ?? code ?? '未知'}`
          : `游戏已退出 · ${signal ?? code ?? spawnError?.message ?? '未知'}`,
      );
      await output.close();
      this.outputs.delete(id);
      this.processes.delete(id);
      if (this.spawned.delete(id)) this.onRunningChanged(this.spawned.size);
      this.changed();
      void this.diagnostics
        .finish(session, this.logs(id))
        .then(() => this.changed())
        .catch(() => output.write('error', '无法保存本次诊断记录'));
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
    this.outputs.get(id)?.write('info', '收到结束游戏请求，正在终止进程');
    this.stopped.add(id);
    if (!child.kill()) {
      this.stopped.delete(id);
      throw new Error('无法终止游戏进程');
    }
  }
}
