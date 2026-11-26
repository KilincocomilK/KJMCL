import { useEffect, useState, type CSSProperties } from 'react';
import { Check, Download, FolderOpen, LoaderCircle, RefreshCw, RotateCcw } from 'lucide-react';
import type { Snapshot, Settings, JavaRuntime, Appearance } from '../../shared/types';
import { api } from '../api';
import { Select } from '../Select';
import { Field } from '../components';
import { SettingGroup } from '../components/SettingGroup';
import { LauncherInfo } from '../components/LauncherInfo';
import { type Run } from '../ui';
import { DirectoryField } from '../dialogs/AdvancedDialogs';
import { Integrations } from './Integrations';
import { StorageSettings } from './Storage';
function AppearanceSettings({ state, run }: { state: Snapshot; run: Run }) {
  const appearance = state.appearance ?? { dim: 32, blur: 0 };
  const [controls, setControls] = useState<Pick<Appearance, 'dim' | 'blur'>>(appearance);
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(
    () => setControls({ dim: appearance.dim, blur: appearance.blur }),
    [appearance.dim, appearance.blur],
  );
  useEffect(() => {
    let cancelled = false;
    if (!appearance.backgroundId) {
      setImage(null);
      return;
    }
    void run(() => api.backgroundImage()).then((result) => {
      if (!cancelled) setImage(result ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [appearance.backgroundId, run]);
  const commit = () => {
    if (controls.dim !== appearance.dim || controls.blur !== appearance.blur)
      void run(() => api.updateAppearance(controls));
  };
  const choose = async (reset = false) => {
    setBusy(true);
    await run(() => (reset ? api.resetBackground() : api.pickBackground()));
    setBusy(false);
  };
  return (
    <SettingGroup title="外观" art="sun" className="appearance-settings">
      <div className="appearance-controls">
        <div
          className="appearance-preview"
          aria-label="背景预览"
          style={
            {
              '--background-dim': controls.dim / 100,
              '--background-blur': `${controls.blur}px`,
            } as CSSProperties
          }
        >
          {image && (
            <img
              src={image}
              alt=""
              style={{ filter: `blur(${controls.blur}px)`, opacity: 1 - controls.dim / 100 }}
            />
          )}
          <span className="appearance-preview-sidebar" />
          <span className="appearance-preview-button" />
        </div>
        <div className="appearance-options">
          <div className="appearance-actions">
            <button type="button" disabled={busy} onClick={() => void choose()}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <FolderOpen size={16} />}
              {appearance.backgroundId ? '更换图片' : '选择图片'}
            </button>
            {appearance.backgroundId && (
              <button type="button" disabled={busy} onClick={() => void choose(true)}>
                <RotateCcw size={15} />
                恢复默认
              </button>
            )}
          </div>
          <Field label="背景暗度">
            <div className="range-value">
              <input
                aria-label="背景暗度"
                type="range"
                min={0}
                max={80}
                value={controls.dim}
                onChange={(e) => setControls({ ...controls, dim: Number(e.target.value) })}
                onPointerUp={commit}
                onKeyUp={commit}
                onBlur={commit}
              />
              <output>{controls.dim}%</output>
            </div>
          </Field>
          <Field label="背景模糊">
            <div className="range-value">
              <input
                aria-label="背景模糊"
                type="range"
                min={0}
                max={24}
                value={controls.blur}
                onChange={(e) => setControls({ ...controls, blur: Number(e.target.value) })}
                onPointerUp={commit}
                onKeyUp={commit}
                onBlur={commit}
              />
              <output>{controls.blur} px</output>
            </div>
          </Field>
        </div>
      </div>
    </SettingGroup>
  );
}
export function SettingsPage({
  state,
  run,
  onImport,
  onLibrary,
}: {
  state: Snapshot;
  run: Run;
  onImport: () => void;
  onLibrary: () => void;
}) {
  const [draft, setDraft] = useState<Partial<Settings>>({}),
    [java, setJava] = useState<JavaRuntime[]>([]),
    [scanning, setScanning] = useState(false);
  const scan = async () => {
    setScanning(true);
    const r = await run(() => api.java());
    if (r) setJava(r);
    setScanning(false);
  };
  const s = { ...state.settings, ...draft };
  const patch = (v: Partial<Settings>) => setDraft((current) => ({ ...current, ...v }));
  return (
    <form
      className="settings-form single-page launcher-settings"
      onInvalidCapture={(e) => {
        const group = (e.target as HTMLElement).closest('details');
        if (group) group.open = true;
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await api.settings({ ...(await api.snapshot()).settings, ...draft });
          setDraft((current) =>
            Object.fromEntries(
              Object.entries(current).filter(
                ([key, value]) => value !== draft[key as keyof Settings],
              ),
            ),
          );
        }, '设置已保存');
      }}
    >
      <LauncherInfo state={state} run={run} />
      <AppearanceSettings state={state} run={run} />
      <SettingGroup title="游戏目录与迁移" art="versions">
        <div className="row">
          <button type="button" onClick={onImport}>
            导入其他启动器
          </button>
          <button type="button" onClick={onLibrary}>
            管理游戏文件夹
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => void run(() => api.setWelcome({ step: 'start' }))}
          >
            重看欢迎引导
          </button>
        </div>
      </SettingGroup>
      <SettingGroup title="游戏运行" art="block">
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
            <Select
              value={String(s.closeOnLaunch)}
              onChange={(e) => patch({ closeOnLaunch: e.target.value === 'true' })}
            >
              <option value="false">保持启动器可见</option>
              <option value="true">最小化启动器</option>
            </Select>
          </Field>
        </div>
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
            <button type="button" key={v} onClick={() => void run(() => api.installJava(v))}>
              <Download size={14} />
              {v}
            </button>
          ))}
        </div>
      </SettingGroup>
      <SettingGroup title="下载与网络" art="hopper">
        <div className="form-grid">
          <Field label="下载源">
            <Select
              value={s.source}
              onChange={(e) => patch({ source: e.target.value as Settings['source'] })}
            >
              <option value="official">官方源</option>
              <option value="bmclapi">BMCLAPI 镜像</option>
            </Select>
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
        </div>
        <Field label="HTTP 代理">
          <input
            placeholder="http://127.0.0.1:7890"
            value={s.proxy}
            onChange={(e) => patch({ proxy: e.target.value })}
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
      </SettingGroup>
      <SettingGroup
        title="数据与存储"
        art="chest"
        open={Boolean(state.storage?.pendingRestart || state.storage?.retired)}
      >
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
      </SettingGroup>
      <Integrations state={state} run={run} />
      {JSON.stringify(s) !== JSON.stringify(state.settings) && (
        <div className="settings-save">
          <button className="primary">
            <Check size={16} />
            保存设置
          </button>
        </div>
      )}
    </form>
  );
}
