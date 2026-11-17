import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import type { RGBA } from '../../shared/skin';
import type { SkinWorkspace } from '../../shared/skin-workspace';
import { Field } from '../components';
import { Select } from '../Select';
import {
  extractPalette,
  hslToRgba,
  hsvToRgba,
  normalizePalette,
  parseHex,
  rgbToHsl,
  rgbToHsv,
  rgbaToHex,
  validatePaletteName,
} from './color-utils';
import './ColorPanel.css';

export interface NamedSkinPalette {
  name: string;
  colors: string[];
}
export interface ColorPanelProps {
  color: RGBA;
  onColor: (color: RGBA) => void;
  secondary: RGBA;
  onSecondary: (color: RGBA) => void;
  recent: string[];
  palette: string[];
  onPalette: (colors: string[]) => void;
  workspace: SkinWorkspace;
  onWorkspace: (workspace: SkinWorkspace) => void;
  pixels: Uint8ClampedArray;
  onImport?: () => Promise<NamedSkinPalette | null>;
  onExport?: (value: NamedSkinPalette) => Promise<unknown>;
}
function Channel({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(Math.round(value))),
    focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(Math.round(value)));
  }, [value]);
  return (
    <label className="skin-color-channel">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        min={0}
        max={max}
        step={1}
        value={text}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw.trim() && Number.isFinite(+raw) && +raw >= 0 && +raw <= max) onChange(+raw);
        }}
        onBlur={() => {
          focused.current = false;
          const next =
            text.trim() && Number.isFinite(+text) ? Math.max(0, Math.min(max, +text)) : value;
          setText(String(Math.round(next)));
          onChange(next);
        }}
      />
    </label>
  );
}
function Swatches({
  colors,
  onColor,
  onRemove,
  label,
}: {
  colors: string[];
  onColor: (c: RGBA) => void;
  onRemove?: (index: number) => void;
  label: string;
}) {
  return (
    <div className="skin-color-swatches" role="group" aria-label={label}>
      {colors.map((hex, index) => (
        <button
          type="button"
          className="skin-color-swatch"
          key={hex + index}
          aria-label={'使用颜色 ' + hex}
          title={hex + (onRemove ? ' · 右键移除' : '')}
          onClick={() => {
            const c = parseHex(hex);
            if (c) onColor(c);
          }}
          onContextMenu={(e) => {
            if (onRemove) {
              e.preventDefault();
              onRemove(index);
            }
          }}
          onKeyDown={(e) => {
            if (onRemove && (e.key === 'Delete' || e.key === 'Backspace')) {
              e.preventDefault();
              e.stopPropagation();
              onRemove(index);
            }
          }}
        >
          <span style={{ background: hex }} />
        </button>
      ))}
    </div>
  );
}
export function ColorPanel({
  color,
  onColor,
  secondary,
  onSecondary,
  recent,
  palette,
  onPalette,
  workspace,
  onWorkspace,
  pixels,
  onImport,
  onExport,
}: ColorPanelProps) {
  const [hex, setHex] = useState(rgbaToHex(color)),
    [mode, setMode] = useState<'rgb' | 'hsl'>('rgb'),
    [preset, setPreset] = useState(''),
    [name, setName] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [count, setCount] = useState(16),
    [hue, setHue] = useState(rgbToHsv(color).h);
  const latest = useRef(workspace);
  latest.current = workspace;
  const hexFocused = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const saturation = useRef({ hsv: rgbToHsv(color).s, hsl: rgbToHsl(color).s });
  const rawHsv = rgbToHsv(color),
    rawHsl = rgbToHsl(color);
  const hsv = { ...rawHsv, s: rawHsv.v ? rawHsv.s : saturation.current.hsv },
    hsl = { ...rawHsl, s: rawHsl.l > 0 && rawHsl.l < 100 ? rawHsl.s : saturation.current.hsl },
    activeHue = hsv.s && hsv.v ? hsv.h : hue;
  useEffect(() => {
    if (!hexFocused.current) setHex(rgbaToHex(color));
  }, [color[0], color[1], color[2], color[3]]);
  useEffect(() => {
    if (hsv.s && hsv.v) setHue(hsv.h);
  }, [hsv.h, hsv.s, hsv.v]);
  useEffect(() => {
    if (rawHsv.v) saturation.current.hsv = rawHsv.s;
    if (rawHsl.l > 0 && rawHsl.l < 100) saturation.current.hsl = rawHsl.s;
  }, [rawHsv.v, rawHsv.s, rawHsl.l, rawHsl.s]);
  useEffect(() => {
    if (preset && !workspace.palettes.some((p) => p.name === preset)) {
      setPreset('');
      setName('');
    }
  }, [preset, workspace.palettes]);
  const attempt = (work: () => void) => {
    try {
      work();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const choose = (next: RGBA) => {
    onColor(next);
    setHex(rgbaToHex(next));
  };
  const setHsv = (patch: Partial<typeof hsv>) => {
    if (patch.s !== undefined) saturation.current.hsv = patch.s;
    choose(hsvToRgba({ ...hsv, h: activeHue, ...patch }, color[3]));
  };
  const setHsl = (patch: Partial<typeof hsl>) => {
    if (patch.s !== undefined) saturation.current.hsl = patch.s;
    choose(hslToRgba({ ...hsl, h: rawHsl.s ? hsl.h : activeHue, ...patch }, color[3]));
  };
  const spectrum = (event: { clientX: number; clientY: number; currentTarget: HTMLDivElement }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHsv({
      s: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      v: Math.max(0, Math.min(100, 100 - ((event.clientY - rect.top) / rect.height) * 100)),
    });
  };
  const spectrumKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const amount = e.shiftKey ? 10 : 1;
    const patch =
      e.key === 'ArrowLeft'
        ? { s: Math.max(0, hsv.s - amount) }
        : e.key === 'ArrowRight'
          ? { s: Math.min(100, hsv.s + amount) }
          : e.key === 'ArrowUp'
            ? { v: Math.min(100, hsv.v + amount) }
            : e.key === 'ArrowDown'
              ? { v: Math.max(0, hsv.v - amount) }
              : e.key === 'Home'
                ? { s: 0 }
                : e.key === 'End'
                  ? { s: 100 }
                  : null;
    if (patch) {
      e.preventDefault();
      e.stopPropagation();
      setHsv(patch);
    }
  };
  const storePalette = () =>
    attempt(() => {
      const current = latest.current,
        palettes = current.palettes,
        index = palettes.findIndex((p) => p.name === preset),
        nextName = validatePaletteName(
          name,
          palettes.map((p) => p.name),
          index >= 0 ? palettes[index].name : undefined,
        ),
        colors = normalizePalette(palette);
      if (!colors.length) throw new Error('请先添加颜色');
      if (index < 0 && palettes.length >= 20) throw new Error('最多保存 20 个色板');
      const next = [...palettes];
      if (index >= 0) next[index] = { name: nextName, colors };
      else next.push({ name: nextName, colors });
      onWorkspace({ ...current, palettes: next });
      setPreset(nextName);
      setName(nextName);
    });
  const rename = () =>
    attempt(() => {
      if (!preset) return;
      const current = latest.current,
        nextName = validatePaletteName(
          name,
          current.palettes.map((p) => p.name),
          preset,
        );
      onWorkspace({
        ...current,
        palettes: current.palettes.map((p) => (p.name === preset ? { ...p, name: nextName } : p)),
      });
      setPreset(nextName);
      setName(nextName);
    });
  const importPalette = async () => {
    if (!onImport) return;
    setBusy(true);
    try {
      const imported = await onImport();
      if (!mounted.current) return;
      if (imported) {
        const current = latest.current;
        if (current.palettes.length >= 20) throw new Error('最多保存 20 个色板');
        const colors = normalizePalette(imported.colors);
        if (!colors.length) throw new Error('色板没有颜色');
        const base = imported.name.trim().slice(0, 40) || '导入色板';
        let unique = base,
          n = 2;
        while (current.palettes.some((p) => p.name.toLowerCase() === unique.toLowerCase())) {
          const suffix = ` ${n++}`;
          unique = base.slice(0, 40 - suffix.length) + suffix;
        }
        onWorkspace({ ...current, palettes: [...current.palettes, { name: unique, colors }] });
        onPalette(colors);
        setPreset(unique);
        setName(unique);
        setError('');
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section className="skin-color-panel" aria-label="颜色与色板">
      <div className="skin-color-pair">
        <label className="skin-color-native" title="前景色">
          <input
            type="color"
            aria-label="前景色"
            value={rgbaToHex(color, false)}
            onChange={(e) => choose([...parseHex(e.target.value)!.slice(0, 3), color[3]] as RGBA)}
          />
          <span style={{ background: rgbaToHex(color) }} />
        </label>
        <button
          type="button"
          className="icon"
          aria-label="交换前景与背景色"
          title="交换颜色 X"
          onClick={() => {
            onSecondary(color);
            choose(secondary);
          }}
        >
          <RefreshCw size={16} />
        </button>
        <label className="skin-color-native" title="背景色">
          <input
            type="color"
            aria-label="背景色"
            value={rgbaToHex(secondary, false)}
            onChange={(e) =>
              onSecondary([...parseHex(e.target.value)!.slice(0, 3), secondary[3]] as RGBA)
            }
          />
          <span style={{ background: rgbaToHex(secondary) }} />
        </label>
      </div>
      <div
        className="skin-color-spectrum"
        role="slider"
        tabIndex={0}
        aria-label="饱和度与明度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s)}
        aria-valuetext={`饱和度 ${Math.round(hsv.s)}%，明度 ${Math.round(hsv.v)}%`}
        title="方向键调整，Shift 加速"
        style={{
          background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,transparent),hsl(${activeHue} 100% 50%)`,
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          spectrum(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) spectrum(e);
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onKeyDown={spectrumKey}
      >
        <span style={{ left: hsv.s + '%', top: 100 - hsv.v + '%' }} />
      </div>
      <input
        className="skin-hue-slider"
        aria-label="色相"
        type="range"
        min={0}
        max={359}
        value={activeHue}
        onChange={(e) => {
          setHue(+e.target.value);
          setHsv({ h: +e.target.value });
        }}
      />
      <Field label="HEX">
        <input
          aria-label="HEX 颜色"
          value={hex}
          maxLength={9}
          spellCheck={false}
          onFocus={() => {
            hexFocused.current = true;
          }}
          onChange={(e) => {
            setHex(e.target.value);
            const next = parseHex(e.target.value);
            if (next) onColor(next);
          }}
          onBlur={() => {
            hexFocused.current = false;
            setHex(rgbaToHex(color));
          }}
        />
      </Field>
      <div className="skin-color-mode segmented">
        <button
          type="button"
          className={mode === 'rgb' ? 'active' : ''}
          onClick={() => setMode('rgb')}
        >
          RGB
        </button>
        <button
          type="button"
          className={mode === 'hsl' ? 'active' : ''}
          onClick={() => setMode('hsl')}
        >
          HSL
        </button>
      </div>
      <div className="skin-color-channels">
        {mode === 'rgb' ? (
          (['R', 'G', 'B'] as const).map((label, i) => (
            <Channel
              key={label}
              label={label}
              value={color[i]}
              max={255}
              onChange={(v) => {
                const next = [...color] as RGBA;
                next[i] = Math.round(v);
                choose(next);
              }}
            />
          ))
        ) : (
          <>
            <Channel
              label="H"
              value={rawHsl.s ? hsl.h : activeHue}
              max={360}
              onChange={(v) => {
                setHue(v % 360);
                setHsl({ h: v });
              }}
            />
            <Channel label="S" value={hsl.s} max={100} onChange={(v) => setHsl({ s: v })} />
            <Channel label="L" value={hsl.l} max={100} onChange={(v) => setHsl({ l: v })} />
          </>
        )}
      </div>
      <label className="skin-alpha-field">
        透明度 <output>{Math.round((color[3] / 255) * 100)}%</output>
        <input
          aria-label="颜色透明度"
          type="range"
          min={0}
          max={255}
          value={color[3]}
          onChange={(e) => choose([color[0], color[1], color[2], +e.target.value])}
        />
      </label>
      {!!recent.length && (
        <Swatches colors={recent.slice(0, 12)} onColor={choose} label="最近颜色" />
      )}
      <details open className="skin-palette-section">
        <summary>
          项目色板 <span>{palette.length}/64</span>
        </summary>
        <Swatches
          colors={palette}
          onColor={choose}
          onRemove={(index) => onPalette(palette.filter((_, i) => i !== index))}
          label="项目色板颜色"
        />
        <div className="skin-palette-actions">
          <button
            type="button"
            disabled={
              palette.length >= 64 &&
              !palette.some((c) => rgbaToHex(parseHex(c)!) === rgbaToHex(color))
            }
            onClick={() =>
              attempt(() => onPalette(normalizePalette([...palette, rgbaToHex(color)])))
            }
          >
            <Plus size={14} />
            添加
          </button>
          <Select
            aria-label="提取颜色数量"
            value={count}
            onChange={(e) => setCount(+e.target.value)}
          >
            {[8, 16, 24, 32, 64].map((n) => (
              <option key={n} value={n}>
                {n} 色
              </option>
            ))}
          </Select>
          <button type="button" onClick={() => onPalette(extractPalette(pixels, count))}>
            提取
          </button>
        </div>
      </details>
      <details className="skin-palette-section">
        <summary>我的色板</summary>
        <Select
          aria-label="已保存色板"
          value={preset}
          onChange={(e) => {
            const next = workspace.palettes.find((p) => p.name === e.target.value);
            setPreset(next?.name ?? '');
            setName(next?.name ?? '');
            if (next) onPalette([...next.colors]);
          }}
        >
          <option value="">新色板</option>
          {workspace.palettes.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </Select>
        <input
          aria-label="色板名称"
          placeholder="色板名称"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="skin-palette-actions">
          <button type="button" disabled={!palette.length || !name.trim()} onClick={storePalette}>
            <Save size={14} />
            保存
          </button>
          <button
            type="button"
            disabled={!preset || !name.trim() || name === preset}
            onClick={rename}
          >
            重命名
          </button>
          <button
            type="button"
            className="icon danger"
            aria-label="删除色板"
            disabled={!preset}
            onClick={() => {
              const current = latest.current;
              onWorkspace({
                ...current,
                palettes: current.palettes.filter((p) => p.name !== preset),
              });
              setPreset('');
              setName('');
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
        {(onImport || onExport) && (
          <div className="skin-palette-actions">
            {onImport && (
              <button type="button" disabled={busy} onClick={() => void importPalette()}>
                <ArrowDownToLine size={14} />
                导入
              </button>
            )}
            {onExport && (
              <button
                type="button"
                disabled={busy || !palette.length}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onExport({
                      name: name.trim() || '项目色板',
                      colors: normalizePalette(palette),
                    });
                    setError('');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <ArrowUpFromLine size={14} />
                导出
              </button>
            )}
          </div>
        )}
      </details>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
