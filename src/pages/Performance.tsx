import { useEffect, useState } from 'react';
import { Activity, Download, Play, RotateCcw, Save, SlidersHorizontal } from 'lucide-react';
import type {
  Instance,
  LaunchCheck,
  LaunchSession,
  PerformanceSettings,
  Snapshot,
  VideoPresetState,
} from '../../shared/types';
import { api } from '../api';
import { Empty, Field, InstanceSelect } from '../components';
import type { Run } from '../ui';
const initial: PerformanceSettings = { memory: 'manual', collector: 'auto', gcLogging: false };
const status = {
  preparing: '准备中',
  running: '运行中',
  exited: '正常退出',
  failed: '异常退出',
  stopped: '已结束',
  interrupted: '结果未知',
};
export function PerformancePage({
  state,
  run,
  showInstanceSelect = true,
}: {
  state: Snapshot;
  run: Run;
  showInstanceSelect?: boolean;
}) {
  const instance = state.instances.find((i) => i.id === state.selectedInstanceId);
  return (
    <>
      {showInstanceSelect && (
        <div className="toolbar">
          <InstanceSelect state={state} run={run} />
        </div>
      )}
      {instance ? (
        <PerformanceContent key={instance.id} instance={instance} state={state} run={run} />
      ) : (
        <Empty title="选择一个游戏实例" />
      )}
    </>
  );
}
function PerformanceContent({
  instance: i,
  state,
  run,
}: {
  instance: Instance;
  state: Snapshot;
  run: Run;
}) {
  const [settings, setSettings] = useState(i.performance ?? initial),
    [memory, setMemory] = useState(i.memoryMb),
    [javaPath, setJavaPath] = useState(i.javaPath);
  const [check, setCheck] = useState<LaunchCheck>(),
    [busy, setBusy] = useState(false),
    [sessions, setSessions] = useState<LaunchSession[]>([]),
    [video, setVideo] = useState<VideoPresetState>();
  const locked =
    busy || state.running.includes(i.id) || state.tasks.some((t) => t.status === 'running');
  const dirty =
    JSON.stringify(settings) !== JSON.stringify(i.performance ?? initial) ||
    memory !== i.memoryMb ||
    javaPath !== i.javaPath;
  useEffect(() => {
    let active = true;
    Promise.all([api.sessions(i.id), api.videoSettings(i.id)])
      .then(([s, v]) => {
        if (active) {
          setSessions(s);
          setVideo(v);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [i.id, state]);
  const patch = (p: Partial<PerformanceSettings>) => {
    setSettings((v) => ({ ...v, ...p }));
    setCheck(undefined);
  };
  const save = async () => {
    await api.updateInstance({ ...i, memoryMb: memory, javaPath, performance: settings });
  };
  const videoWork = async (work: () => Promise<void>, message: string) => {
    setBusy(true);
    try {
      await run(work, message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="performance-page settings-form">
      <form
        className="panel setting-section"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void run(save, '运行设置已保存').finally(() => setBusy(false));
        }}
      >
        <div className="section-title">
          <SlidersHorizontal size={19} />
          <h2>运行配置</h2>
        </div>
        <fieldset disabled={locked}>
          <div className="form-grid">
            <Field label="内存分配">
              <select
                aria-label="内存分配"
                value={settings.memory}
                onChange={(e) => patch({ memory: e.target.value as PerformanceSettings['memory'] })}
              >
                <option value="manual">手动</option>
                <option value="auto">自动 · 保留系统空间</option>
              </select>
            </Field>
            <Field label={settings.memory === 'auto' ? '自动分配上限（MiB）' : '最大堆内存（MiB）'}>
              <input
                aria-label="堆内存上限"
                type="number"
                min={512}
                max={65536}
                step={256}
                value={memory}
                onChange={(e) => {
                  setMemory(Number(e.target.value));
                  setCheck(undefined);
                }}
              />
            </Field>
            <Field label="垃圾收集器">
              <select
                aria-label="垃圾收集器"
                value={settings.collector}
                onChange={(e) =>
                  patch({ collector: e.target.value as PerformanceSettings['collector'] })
                }
              >
                <option value="auto">自动 · JVM 默认</option>
                <option value="g1">G1</option>
                <option value="zgc">ZGC · 低停顿</option>
              </select>
            </Field>
            <Field label="Java 路径">
              <input
                value={javaPath}
                placeholder="自动匹配 / 跟随全局"
                onChange={(e) => {
                  setJavaPath(e.target.value);
                  setCheck(undefined);
                }}
              />
            </Field>
          </div>
          <div className="row split">
            <label className="check">
              <input
                type="checkbox"
                checked={settings.gcLogging}
                onChange={(e) => patch({ gcLogging: e.target.checked })}
              />
              记录 GC 停顿
            </label>
            <button className="primary" disabled={!dirty}>
              <Save size={15} />
              保存
            </button>
          </div>
          <p className="performance-note">内存越大不一定越快。GC 记录用于比较停顿，不代表帧率。</p>
        </fieldset>
      </form>
      <section className="panel setting-section">
        <div className="section-title split">
          <div className="row">
            <Activity size={19} />
            <h2>启动检查</h2>
          </div>
          <button
            disabled={locked || dirty || i.status !== 'ready'}
            onClick={async () => {
              setBusy(true);
              const r = await run(() => api.checkLaunch(i.id));
              if (r) setCheck(r);
              setBusy(false);
            }}
          >
            <Play size={15} />
            {busy ? '检查中' : '检查并试运行 JVM'}
          </button>
        </div>
        {dirty && <p className="performance-note">保存配置后检查</p>}
        {check && (
          <div aria-live="polite">
            <div className="performance-metrics">
              <div>
                <small>Java</small>
                <strong>{check.runtime?.version ?? `需要 ${check.requiredJava}`}</strong>
              </div>
              <div>
                <small>有效堆上限</small>
                <strong>{check.memoryMb} MiB</strong>
              </div>
              <div>
                <small>当前可用 / 总内存</small>
                <strong>
                  {(check.availableMb / 1024).toFixed(1)} / {(check.totalMb / 1024).toFixed(1)} GiB
                </strong>
              </div>
              <div>
                <small>启动文件</small>
                <strong>{check.checkedFiles}</strong>
              </div>
            </div>
            {check.runtime && (
              <p className="path-value">
                {check.runtime.vendor} · {check.runtime.arch} · {check.runtime.path}
              </p>
            )}
            <code className="performance-args">{check.managedArgs.join(' ')}</code>
            {check.issues.map((x) => (
              <p
                key={x.code}
                className={x.level === 'error' ? 'inline-error' : 'performance-warning'}
              >
                {x.message}
              </p>
            ))}
            <p className="performance-note">
              {check.tested ? 'JVM 试运行通过' : 'JVM 试运行未通过或未执行'} ·
              不加载游戏、模组及自定义代理
            </p>
          </div>
        )}
      </section>
      <section className="panel setting-section">
        <div className="section-title">
          <SlidersHorizontal size={19} />
          <h2>游戏视频预设</h2>
        </div>
        <p className="performance-note">调整画距和帧率上限；保留其他游戏设置。</p>
        <div className="video-presets">
          <button
            disabled={locked || video?.canRestore}
            onClick={() =>
              void videoWork(
                () => api.applyVideoPreset({ id: i.id, preset: 'balanced' }),
                '已应用，下一次启动生效',
              )
            }
          >
            <strong>均衡</strong>
            <small>画距 12 · 模拟 8 · 120 FPS 上限</small>
          </button>
          <button
            disabled={locked || video?.canRestore}
            onClick={() =>
              void videoWork(
                () => api.applyVideoPreset({ id: i.id, preset: 'low' }),
                '已应用，下一次启动生效',
              )
            }
          >
            <strong>低负载</strong>
            <small>画距 8 · 模拟 5 · 60 FPS 上限</small>
          </button>
        </div>
        <div className="row split">
          <small>
            当前画距 {video?.values.renderDistance ?? '—'} · 模拟{' '}
            {video?.values.simulationDistance ?? '—'} · 帧率上限 {video?.values.maxFps ?? '—'}
          </small>
          <button
            disabled={locked || !video?.canRestore}
            onClick={() => void videoWork(() => api.restoreVideoPreset(i.id), '已还原预设字段')}
          >
            <RotateCcw size={15} />
            还原
          </button>
        </div>
      </section>
      <section className="panel setting-section">
        <div className="section-title">
          <Activity size={19} />
          <h2>启动记录</h2>
        </div>
        {!sessions.length && <p className="performance-note">暂无记录</p>}
        {sessions.map((s) => (
          <details key={s.id} className="session-record">
            <summary>
              <span>{new Date(s.startedAt).toLocaleString('zh-CN')}</span>
              <span className={s.status === 'failed' ? 'inline-error' : ''}>
                {status[s.status]}
              </span>
            </summary>
            <p>
              {s.phase} · {s.runtime ? `Java ${s.runtime.version} · ${s.memoryMb} MiB` : '准备阶段'}
              {s.endedAt ? ` · ${((s.endedAt - s.startedAt) / 1000).toFixed(1)} 秒` : ''}
            </p>
            {s.gc && (
              <p>
                保留日志中的停顿 {s.gc.pauses} 次 · 最大 {s.gc.maxPauseMs.toFixed(2)} ms · 累计{' '}
                {s.gc.totalPauseMs.toFixed(2)} ms
              </p>
            )}
            {s.diagnoses.map((d, n) => (
              <div className="diagnosis" key={n}>
                <strong>{d.title}</strong>
                <p>{d.suggestion}</p>
                <pre>{d.evidence}</pre>
              </div>
            ))}
            <button
              onClick={() => void run(() => api.exportDiagnosis({ id: i.id, sessionId: s.id }))}
            >
              <Download size={15} />
              导出诊断
            </button>
          </details>
        ))}
      </section>
    </div>
  );
}
