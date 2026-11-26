import { useEffect, useState } from 'react';
import { welcomeJavaChoices } from '../../shared/java';
import type { Api, Snapshot } from '../../shared/types';
import { api } from '../api';
import { Field } from '../components';
import { Select } from '../Select';
import type { Run } from '../ui';
import './welcome-java.css';

export function WelcomeJava({ state, run }: { state: Snapshot; run: Run }) {
  const [selectedMajor, setSelectedMajor] = useState<number>();
  const [info, setInfo] = useState<Awaited<ReturnType<Api['welcomeJavaInfo']>>>();
  const [scanning, setScanning] = useState(true);
  const [starting, setStarting] = useState(false);
  const [revision, refresh] = useState(0);
  const job = state.tasks.find((t) => t.scope === 'java');
  const completed = job?.status === 'completed' ? job.id : undefined;
  const busy = starting || job?.status === 'running';
  useEffect(() => {
    let active = true;
    setScanning(true);
    void run(() => api.welcomeJavaInfo()).then((result) => {
      if (active) {
        setInfo(result);
        setScanning(false);
      }
    });
    return () => {
      active = false;
    };
  }, [run, revision, completed]);
  const instance =
    state.instances.find((i) => i.id === state.selectedInstanceId) ?? state.instances[0];
  const choices = welcomeJavaChoices(info?.available ?? [], instance?.version);
  const gameChoice = choices.find((v) => v.matchesGame);
  const major = selectedMajor ?? (info ? choices[0].major : undefined);
  const match = info?.available.find((j) => j.major === major);
  const selectedJob = job?.title === `配置 Java ${major}` ? job : undefined;
  const configured = selectedJob?.status === 'completed' && !!match && !state.settings.javaPath;
  const configure = async () => {
    if (major === undefined) return;
    setSelectedMajor(major);
    setStarting(true);
    await run(() => api.configureWelcomeJava({ major, allowInstall: !match }));
    setStarting(false);
  };
  return (
    <section className="welcome-java">
      <Field label="准备游玩的 Minecraft 版本">
        <Select
          value={major === undefined ? '' : String(major)}
          disabled={busy || !info}
          onChange={(e) => setSelectedMajor(Number(e.target.value))}
        >
          {!info && <option value="">{scanning ? '正在检测本机 Java…' : '请重新检测'}</option>}
          {choices.map((v) => (
            <option key={v.major} value={v.major}>
              {v.games} · Java {v.major}
              {v.installed ? ' · 已安装' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <div className="welcome-java-readout" aria-live="polite">
        <strong>
          {scanning
            ? '正在检测本机 Java…'
            : match
              ? `已检测到 Java ${match.version}`
              : info
                ? `本机缺少 Java ${major}`
                : '检测未完成'}
        </strong>
        {info && (
          <small>
            按游戏版本自动匹配 Java · 新实例{configured ? '默认' : '建议'}内存{' '}
            {configured ? state.settings.memoryMb : info.memoryMb} MiB
          </small>
        )}
        {info && gameChoice && gameChoice.major !== major && (
          <small>
            Minecraft {instance?.version} 建议使用 Java {gameChoice.major}
          </small>
        )}
      </div>
      {job?.status === 'running' ? (
        <div className="welcome-java-job">
          <div role="status">
            {job.title} · {job.detail} · {Math.floor(job.progress)}%
          </div>
          <progress aria-label="Java 任务进度" value={job.progress} max={100} />
          <button type="button" onClick={() => void run(() => api.cancelTask(job.id))}>
            取消任务
          </button>
        </div>
      ) : (
        <div className="row">
          <button type="button" disabled={busy || scanning} onClick={() => refresh((v) => v + 1)}>
            重新检测
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || scanning || !info || configured}
            onClick={() => void configure()}
          >
            {configured
              ? '已配置'
              : match
                ? '应用推荐配置'
                : major
                  ? `安装 Java ${major} 并配置`
                  : '安装并配置'}
          </button>
        </div>
      )}
      {selectedJob?.status === 'failed' && <small role="alert">{selectedJob.detail}</small>}
      {selectedJob?.status === 'cancelled' && <small role="status">已取消，可以重新配置。</small>}
    </section>
  );
}
