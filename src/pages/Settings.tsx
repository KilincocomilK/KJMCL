import { useState } from 'react';
import {
  Check,
  Download,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import type { Snapshot, Settings, JavaRuntime } from '../../shared/types';
import { api } from '../api';
import { Brand, Field } from '../components';
import { type Run, size } from '../ui';
import { DirectoryField } from '../dialogs/AdvancedDialogs';
import { Integrations } from './Integrations';
import { StorageSettings } from './Storage';
export function SettingsPage({ state, run }: { state: Snapshot; run: Run }) {
  const [s, set] = useState<Settings>({ ...state.settings }),
    [java, setJava] = useState<JavaRuntime[]>([]),
    [scanning, setScanning] = useState(false);
  const scan = async () => {
    setScanning(true);
    const r = await run(() => api.java());
    if (r) setJava(r);
    setScanning(false);
  };
  const patch = (v: Partial<Settings>) => set({ ...s, ...v });
  return (
    <form
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api.settings(s), '设置已保存');
      }}
    >
      <section className="panel setting-section">
        <div className="section-title">
          <SlidersHorizontal size={19} />
          <h2>游戏运行</h2>
        </div>
        <div className="form-grid">
          <Field label="默认内存">
            <div className="range-value">
              <input
                aria-label="默认内存"
                type="range"
                min={512}
                max={32768}
                step={256}
                value={s.memoryMb}
                onChange={(e) => patch({ memoryMb: Number(e.target.value) })}
              />
              <strong>{(s.memoryMb / 1024).toFixed(1)} GB</strong>
            </div>
          </Field>
          <Field label="启动后">
            <select
              value={String(s.closeOnLaunch)}
              onChange={(e) => patch({ closeOnLaunch: e.target.value === 'true' })}
            >
              <option value="false">保持启动器可见</option>
              <option value="true">最小化启动器</option>
            </select>
          </Field>
        </div>
        <p className="muted">游戏运行时自动进入轻量模式，全部游戏退出后恢复。切换时仅弹窗通知。</p>
        <Field label="Java 可执行文件" hint="留空时自动匹配游戏要求的 Java 版本">
          <div className="row">
            <input
              className="grow"
              placeholder="自动检测"
              value={s.javaPath}
              onChange={(e) => patch({ javaPath: e.target.value })}
            />
            <button
              type="button"
              onClick={async () => {
                const p = await run(() => api.pickJava());
                if (p) patch({ javaPath: p });
              }}
            >
              <FolderOpen size={16} />
              选择
            </button>
            <button type="button" disabled={scanning} onClick={() => void scan()}>
              {scanning ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}检测
            </button>
          </div>
        </Field>
        {java.length > 0 && (
          <div className="java-list">
            {java.map((j) => (
              <button type="button" key={j.path} onClick={() => patch({ javaPath: j.path })}>
                <span>
                  Java {j.version} <small>{j.arch}</small>
                </span>
                <small>{j.path}</small>
                <Check size={15} opacity={s.javaPath === j.path ? 1 : 0} />
              </button>
            ))}
          </div>
        )}
        <div className="row java-install">
          <small>安装 Java</small>
          {[8, 16, 17, 21, 25].map((v) => (
            <button
              type="button"
              key={v}
              onClick={() => void run(() => api.installJava(v), '已加入下载任务')}
            >
              <Download size={14} />
              {v}
            </button>
          ))}
        </div>
      </section>
      <div className="settings-grid">
        <section className="panel setting-section">
          <div className="section-title">
            <Download size={19} />
            <h2>下载与网络</h2>
          </div>
          <Field label="下载源">
            <select
              value={s.source}
              onChange={(e) => patch({ source: e.target.value as Settings['source'] })}
            >
              <option value="official">官方源</option>
              <option value="bmclapi">BMCLAPI 镜像</option>
            </select>
          </Field>
          <Field label="HTTP 代理">
            <input
              placeholder="http://127.0.0.1:7890"
              value={s.proxy}
              onChange={(e) => patch({ proxy: e.target.value })}
            />
          </Field>
          <Field label="并发下载数">
            <input
              type="number"
              min={1}
              max={16}
              value={s.concurrency}
              onChange={(e) => patch({ concurrency: Number(e.target.value) })}
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={s.showSnapshots}
              onChange={(e) => patch({ showSnapshots: e.target.checked })}
            />
            默认显示快照版本
          </label>
        </section>
        <section className="panel setting-section">
          <div className="section-title">
            <ShieldCheck size={19} />
            <h2>账户与存储</h2>
          </div>
          <Field label="Microsoft Client ID">
            <input
              placeholder="应用注册的客户端 ID"
              value={s.microsoftClientId}
              onChange={(e) => patch({ microsoftClientId: e.target.value })}
            />
          </Field>
          <StorageSettings state={state} run={run} />
          <DirectoryField
            label="默认实例根目录"
            value={s.instancesDir ?? ''}
            onChange={(v) => patch({ instancesDir: v })}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={s.backupBeforeLaunch ?? false}
              onChange={(e) => patch({ backupBeforeLaunch: e.target.checked })}
            />
            启动前自动备份存档
          </label>
          <div className="about">
            <Brand small />
            <span>
              KJMCL <strong>{state.appVersion}</strong>
              <small>Minecraft Java Edition Launcher</small>
            </span>
          </div>
        </section>
      </div>
      <div className="settings-save">
        <button className="primary">
          <Check size={16} />
          保存设置
        </button>
      </div>
      <Integrations state={state} run={run} />
    </form>
  );
}
