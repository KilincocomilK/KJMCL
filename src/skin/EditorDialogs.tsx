import { matchesSearch } from '../../shared/search';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RGBA, SkinResolution } from '../../shared/skin';
import { resizePixels } from '../../shared/skin-pixels';
import type { SkinWorkspace } from '../../shared/skin-workspace';
import { Field, Modal } from '../components';
import { Select } from '../Select';
import { api } from '../api';
import type { SkinAdjustment } from './engine';
import type { SkinAnimationOptions } from './view-math';
import { colorHex, parseColor, tools } from './editor-ui';

export function PixelPreview({
  pixels,
  resolution,
}: {
  pixels: Uint8ClampedArray;
  resolution: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = canvas.height = resolution;
    canvas
      .getContext('2d')
      ?.putImageData(new ImageData(new Uint8ClampedArray(pixels), resolution, resolution), 0, 0);
  }, [pixels, resolution]);
  return <canvas className="skin-adjust-preview" ref={ref} aria-label="调整预览" />;
}

export function ResizeDialog({
  pixels,
  resolution,
  target,
  onApply,
  onClose,
}: {
  pixels: Uint8ClampedArray;
  resolution: SkinResolution;
  target: SkinResolution;
  onApply: () => void;
  onClose: () => void;
}) {
  const next = useMemo(
    () => resizePixels(pixels, resolution, target),
    [pixels, resolution, target],
  );
  return (
    <Modal title="调整分辨率" onClose={onClose}>
      <div className="form-body">
        <div className="skin-resize-preview">
          <div>
            <PixelPreview pixels={pixels} resolution={resolution} />
            <span>
              {resolution}×{resolution}
            </span>
          </div>
          <div>
            <PixelPreview pixels={next} resolution={target} />
            <span>
              {target}×{target}
            </span>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={onApply}>
          应用
        </button>
      </div>
    </Modal>
  );
}

export function AdjustmentDialog({
  value,
  onChange,
  pixels,
  resolution,
  color,
  onApply,
  onClose,
}: {
  value: SkinAdjustment;
  onChange: (value: SkinAdjustment) => void;
  pixels: Uint8ClampedArray;
  resolution: number;
  color: RGBA;
  onApply: () => void;
  onClose: () => void;
}) {
  const levels = value.levels ?? { black: 0, white: 255, gamma: 1 };
  return (
    <Modal title="颜色调整 · 当前图层" onClose={onClose}>
      <div className="form-body skin-adjust-body">
        <PixelPreview pixels={pixels} resolution={resolution} />
        <div>
          {(['hue', 'saturation', 'brightness', 'contrast'] as const).map((key, n) => (
            <Field key={key} label={['色相', '饱和度', '亮度', '对比度'][n]}>
              <input
                aria-label={['色相', '饱和度', '亮度', '对比度'][n]}
                type="range"
                min={key === 'hue' ? -180 : -1}
                max={key === 'hue' ? 180 : 1}
                step={key === 'hue' ? 1 : 0.01}
                value={value[key] ?? 0}
                onChange={(e) => onChange({ ...value, [key]: +e.target.value })}
              />
              <output>{value[key] ?? 0}</output>
            </Field>
          ))}
        </div>
        <div className="row">
          {(['grayscale', 'invert'] as const).map((key, i) => (
            <label className="check" key={key}>
              <input
                type="checkbox"
                checked={!!value[key]}
                onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
              />
              {['灰度', '反相'][i]}
            </label>
          ))}
        </div>
        <details>
          <summary>色阶</summary>
          <div className="skin-number-row">
            {(['black', 'white', 'gamma'] as const).map((key, i) => (
              <Field key={key} label={['黑场', '白场', '伽马'][i]}>
                <input
                  aria-label={['黑场', '白场', '伽马'][i]}
                  type="number"
                  min={key === 'gamma' ? 0.1 : key === 'white' ? levels.black + 1 : 0}
                  max={key === 'gamma' ? 10 : key === 'black' ? levels.white - 1 : 255}
                  step={key === 'gamma' ? 0.1 : 1}
                  value={levels[key]}
                  onChange={(e) => {
                    const num = +e.target.value;
                    const low = key === 'gamma' ? 0.1 : key === 'white' ? levels.black + 1 : 0;
                    const high = key === 'gamma' ? 10 : key === 'black' ? levels.white - 1 : 255;
                    onChange({
                      ...value,
                      levels: { ...levels, [key]: Math.max(low, Math.min(high, num)) },
                    });
                  }}
                />
              </Field>
            ))}
          </div>
        </details>
        <details>
          <summary>描边</summary>
          <label className="check">
            <input
              type="checkbox"
              checked={!!value.outline}
              onChange={(e) =>
                onChange({
                  ...value,
                  outline: e.target.checked ? { color, width: 1, inside: false } : undefined,
                })
              }
            />
            启用描边
          </label>
          {value.outline && (
            <div className="row">
              <input
                aria-label="描边颜色"
                type="color"
                value={colorHex(value.outline.color)}
                onChange={(e) =>
                  onChange({
                    ...value,
                    outline: { ...value.outline!, color: parseColor(e.target.value)! },
                  })
                }
              />
              <input
                aria-label="描边宽度"
                type="number"
                min="1"
                max="16"
                value={value.outline.width}
                onChange={(e) =>
                  onChange({
                    ...value,
                    outline: {
                      ...value.outline!,
                      width: Math.max(1, Math.min(16, +e.target.value)),
                    },
                  })
                }
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!value.outline.inside}
                  onChange={(e) =>
                    onChange({ ...value, outline: { ...value.outline!, inside: e.target.checked } })
                  }
                />
                内侧
              </label>
            </div>
          )}
        </details>
      </div>
      <div className="modal-footer">
        <button onClick={() => onChange({})}>重置</button>
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={onApply}>
          应用
        </button>
      </div>
    </Modal>
  );
}

export function ShortcutDialog({
  workspace,
  onWorkspace,
  onClose,
}: {
  workspace: SkinWorkspace;
  onWorkspace: (value: SkinWorkspace) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(''),
    [error, setError] = useState('');
  const entries = useMemo(
    () =>
      tools.filter((t) => matchesSearch(query, t.label, t.id, workspace.shortcuts[t.id] ?? t.key)),
    [query, workspace.shortcuts],
  );
  return (
    <Modal title="快捷键" onClose={onClose}>
      <div className="form-body skin-shortcuts">
        <input
          aria-label="搜索快捷键"
          placeholder="搜索工具"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p>Alt 点击吸色 · 右键旋转 · Shift + 右键平移 · 滚轮缩放</p>
        <p>Ctrl+Z 撤销 · Ctrl+Y 重做 · Ctrl+S 保存 · Ctrl+Shift+S 另存</p>
        <p>Ctrl+A 全选 · Ctrl+D 取消 · Ctrl+C / X / V 复制 / 剪切 / 粘贴</p>
        <p>[ / ] 画笔大小 · X 交换颜色 · Delete 清空 · 方向键移动</p>
        <p>Shift 增选 · Ctrl 减选 · Ctrl 点击设置克隆源</p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="skin-shortcut-grid">
          {entries.map((t) => (
            <label key={t.id}>
              {t.label}
              <input
                aria-label={t.label + '快捷键'}
                maxLength={1}
                value={(workspace.shortcuts[t.id] ?? t.key).toUpperCase()}
                onChange={(e) => {
                  const key = e.target.value.toLowerCase();
                  if (!/^[a-wyz0-9]$/.test(key)) {
                    setError('使用字母或数字，X 留给交换颜色');
                    return;
                  }
                  const other = tools.find(
                    (item) =>
                      item.id !== t.id &&
                      (workspace.shortcuts[item.id] ?? item.key).toLowerCase() === key,
                  );
                  if (other) {
                    setError('已用于' + other.label);
                    return;
                  }
                  setError('');
                  onWorkspace({ ...workspace, shortcuts: { ...workspace.shortcuts, [t.id]: key } });
                }}
              />
            </label>
          ))}
        </div>
      </div>
      <div className="modal-footer">
        <button
          onClick={() => {
            setError('');
            onWorkspace({ ...workspace, shortcuts: {} });
          }}
        >
          恢复默认
        </button>
        <button onClick={onClose}>完成</button>
      </div>
    </Modal>
  );
}

export function AnimationDialog({
  capture,
  onClose,
  onTask,
}: {
  capture: ((options: SkinAnimationOptions) => Promise<string[]>) | undefined;
  onClose: () => void;
  onTask: (id: string) => void;
}) {
  const [seconds, setSeconds] = useState(3),
    [frames, setFrames] = useState(36),
    [size, setSize] = useState(256);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState('');
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  const close = () => {
    controller.current?.abort();
    onClose();
  };
  const generate = async () => {
    if (!capture) return;
    const work = new AbortController();
    controller.current = work;
    setBusy(true);
    setError('');
    setProgress(0);
    try {
      const images = await capture({
        seconds,
        frames,
        size,
        signal: work.signal,
        onProgress: (done, total) => setProgress(Math.round((done / total) * 100)),
      });
      work.signal.throwIfAborted();
      const id = await api.skinEditorExportAnimation({ frames: images, seconds });
      if (id) {
        onTask(id);
        onClose();
      }
    } catch (e) {
      if (!work.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      controller.current = undefined;
      setBusy(false);
    }
  };
  return (
    <Modal title="导出预览动画" onClose={close}>
      <div className="form-body">
        <Field label="时长（秒）">
          <input
            disabled={busy}
            aria-label="动画时长"
            type="number"
            min=".2"
            max="30"
            step=".1"
            value={seconds}
            onChange={(e) => setSeconds(Math.max(0.2, Math.min(30, +e.target.value)))}
          />
        </Field>
        <Field label="帧数">
          <input
            disabled={busy}
            aria-label="动画帧数"
            type="number"
            min="2"
            max="120"
            value={frames}
            onChange={(e) => setFrames(Math.max(2, Math.min(120, Math.round(+e.target.value))))}
          />
        </Field>
        <Field label="尺寸">
          <Select disabled={busy} value={size} onChange={(e) => setSize(+e.target.value)}>
            {[128, 256, 512].map((n) => (
              <option key={n} value={n}>
                {n}×{n}
              </option>
            ))}
          </Select>
        </Field>
        {busy && <progress aria-label="渲染动画" value={progress} max={100} />}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <button onClick={close}>{busy ? '取消导出' : '取消'}</button>
        <button
          className="primary"
          disabled={busy || !capture || frames * size * size * 4 > 128 * 1024 ** 2}
          onClick={() => void generate()}
        >
          {busy ? `渲染 ${progress}%` : '导出 GIF'}
        </button>
      </div>
    </Modal>
  );
}
