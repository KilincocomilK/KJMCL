import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Hand,
  ImagePlus,
  Pipette,
  RotateCcw,
  Save,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { RGBA, SkinPart } from '../../shared/skin';
import type { SkinAsset, SkinWorkspace } from '../../shared/skin-workspace';
import { decodePixels } from '../../shared/skin-pixels';
import { api } from '../api';
import { Select } from '../Select';
import type { Run } from '../ui';
import type { SkinEditor } from './engine';
import { colorHex, partLabels } from './editor-ui';
import { extractPalette } from './color-utils';
import {
  fitWorkspaceImage,
  referenceFit,
  referenceImagePoint,
  sampleReference,
  zoomReference,
  type ReferenceTransform,
} from './workspace-assets';
import './WorkspacePanels.css';

export interface WorkspacePanelsProps {
  workspace: SkinWorkspace;
  onWorkspace: (workspace: SkinWorkspace) => void;
  onColor: (color: RGBA) => void;
  editor: SkinEditor;
  onChange: () => void;
  run: Run;
}

function AssetPixels({ asset, className = '' }: { asset: SkinAsset; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    context?.putImageData(
      new ImageData(new Uint8ClampedArray(decodePixels(asset.pixels)), asset.width, asset.height),
      0,
      0,
    );
  }, [asset.pixels, asset.width, asset.height]);
  return (
    <canvas
      className={className}
      ref={canvas}
      width={asset.width}
      height={asset.height}
      aria-label={asset.name}
      role="img"
    />
  );
}

function ReferenceCanvas({
  asset,
  onColor,
}: {
  asset: SkinAsset;
  onColor: WorkspacePanelsProps['onColor'];
}) {
  const view = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 180, height: 180 });
  const [transform, setTransform] = useState<ReferenceTransform>({ zoom: 1, x: 0, y: 0 });
  const [mode, setMode] = useState<'pick' | 'pan'>('pick');
  const [sample, setSample] = useState<{ x: number; y: number; color: RGBA }>();
  const pixels = useMemo(() => decodePixels(asset.pixels), [asset.pixels]);
  const drag = useRef<
    | { id: number; mode: 'pick' | 'pan'; x: number; y: number; origin: ReferenceTransform }
    | undefined
  >(undefined);
  const latest = useRef({ size, transform });
  latest.current = { size, transform };
  useEffect(() => {
    if (!view.current) return;
    const element = view.current;
    const update = () =>
      setSize({
        width: Math.max(1, element.clientWidth),
        height: Math.max(1, element.clientHeight),
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const bounds = element.getBoundingClientRect(),
        { size, transform } = latest.current;
      setTransform(
        zoomReference(
          transform,
          transform.zoom * Math.exp(-event.deltaY * 0.002),
          { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
          size,
        ),
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
    };
  }, []);
  const pick = (clientX: number, clientY: number) => {
    const bounds = view.current!.getBoundingClientRect();
    const point = referenceImagePoint(
      { x: clientX - bounds.left, y: clientY - bounds.top },
      asset,
      size,
      transform,
    );
    if (!point) return;
    const color = sampleReference(pixels, asset, point);
    setSample({ ...point, color });
    onColor(color);
  };
  const zoom = (factor: number) =>
    setTransform((value) =>
      zoomReference(value, value.zoom * factor, { x: size.width / 2, y: size.height / 2 }, size),
    );
  const scale = referenceFit(asset, size) * transform.zoom;
  return (
    <div className="skin-reference-viewer">
      <div className="skin-workspace-actions">
        <button
          className={mode === 'pick' ? 'active' : ''}
          aria-label="从参考图吸色"
          aria-pressed={mode === 'pick'}
          onClick={() => setMode('pick')}
        >
          <Pipette size={14} />
          吸色
        </button>
        <button
          className={mode === 'pan' ? 'active' : ''}
          aria-label="平移参考图"
          aria-pressed={mode === 'pan'}
          onClick={() => setMode('pan')}
        >
          <Hand size={14} />
          平移
        </button>
        <button
          aria-label="参考图缩小"
          onClick={() => zoom(1 / 1.5)}
          disabled={transform.zoom <= 0.125}
        >
          <ZoomOut size={14} />
        </button>
        <button aria-label="参考图放大" onClick={() => zoom(1.5)} disabled={transform.zoom >= 16}>
          <ZoomIn size={14} />
        </button>
        <button
          aria-label="参考图适应窗口"
          title="适应窗口"
          onClick={() => setTransform({ zoom: 1, x: 0, y: 0 })}
        >
          <RotateCcw size={14} />
        </button>
      </div>
      <div
        ref={view}
        className={'skin-reference-canvas ' + mode}
        tabIndex={0}
        aria-label={'参考图 ' + asset.name}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(event) => {
          if (
            !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '=', '-', '0'].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === '+' || event.key === '=') zoom(1.5);
          else if (event.key === '-') zoom(1 / 1.5);
          else if (event.key === '0') setTransform({ zoom: 1, x: 0, y: 0 });
          else
            setTransform((value) => ({
              ...value,
              x: value.x + (event.key === 'ArrowLeft' ? -12 : event.key === 'ArrowRight' ? 12 : 0),
              y: value.y + (event.key === 'ArrowUp' ? -12 : event.key === 'ArrowDown' ? 12 : 0),
            }));
        }}
        onPointerDown={(event) => {
          if (event.button > 2 || drag.current) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          const action = mode === 'pan' || event.button !== 0 || event.altKey ? 'pan' : 'pick';
          drag.current = {
            id: event.pointerId,
            mode: action,
            x: event.clientX,
            y: event.clientY,
            origin: transform,
          };
          if (action === 'pick') pick(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          const gesture = drag.current;
          if (!gesture || gesture.id !== event.pointerId) return;
          if (gesture.mode === 'pick') pick(event.clientX, event.clientY);
          else
            setTransform({
              ...gesture.origin,
              x: gesture.origin.x + event.clientX - gesture.x,
              y: gesture.origin.y + event.clientY - gesture.y,
            });
        }}
        onPointerUp={(event) => {
          if (drag.current?.id === event.pointerId) {
            drag.current = undefined;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
        onLostPointerCapture={() => {
          drag.current = undefined;
        }}
      >
        <div
          className="skin-reference-image"
          style={{
            width: asset.width,
            height: asset.height,
            transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${scale})`,
          }}
        >
          <AssetPixels asset={asset} />
        </div>
      </div>
      <div className="skin-workspace-status">
        <span>
          {asset.width}×{asset.height} · {Math.round(scale * 100)}%
        </span>
        {sample && <span title={`${sample.x}, ${sample.y}`}>{colorHex(sample.color, true)}</span>}
      </div>
    </div>
  );
}

export function ReferencePanel(props: WorkspacePanelsProps) {
  const { workspace, onWorkspace, editor, run, onColor } = props;
  const [selectedId, setSelectedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const current = useRef(props);
  current.current = props;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selected =
    workspace.references.find((asset) => asset.id === selectedId) ?? workspace.references[0];
  const importReference = async () => {
    setBusy(true);
    const origin = editor;
    try {
      const image = await run(() => api.skinEditorImport('image'));
      if (!image || !mounted.current || current.current.editor !== origin) return;
      await run(async () => {
        const latest = current.current;
        if (!mounted.current || latest.editor !== origin) return;
        if (latest.workspace.references.length >= 4) throw new Error('最多保存 4 张参考图');
        const asset = { ...fitWorkspaceImage(image), id: crypto.randomUUID() };
        latest.onWorkspace({
          ...latest.workspace,
          references: [...latest.workspace.references, asset],
        });
        setSelectedId(asset.id);
      });
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className="skin-workspace-panel skin-reference-panel">
      <div className="skin-workspace-actions">
        <button
          onClick={() => void importReference()}
          disabled={busy || workspace.references.length >= 4}
        >
          <ImagePlus size={14} />
          导入参考图
        </button>
        <span className="skin-workspace-count">{workspace.references.length}/4</span>
      </div>
      {workspace.references.length > 0 && (
        <div className="skin-asset-strip">
          {workspace.references.map((asset) => (
            <button
              key={asset.id}
              className={selected?.id === asset.id ? 'active' : ''}
              aria-pressed={selected?.id === asset.id}
              aria-label={'查看参考图 ' + asset.name}
              title={asset.name}
              onClick={() => setSelectedId(asset.id)}
            >
              <AssetPixels asset={asset} />
            </button>
          ))}
        </div>
      )}
      {selected && (
        <>
          <div className="skin-workspace-selected">
            <span title={selected.name}>{selected.name}</span>
            <button
              aria-label={'删除参考图 ' + selected.name}
              onClick={() =>
                onWorkspace({
                  ...workspace,
                  references: workspace.references.filter((asset) => asset.id !== selected.id),
                })
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
          <ReferenceCanvas key={selected.id} asset={selected} onColor={onColor} />
          <button
            onClick={() =>
              void run(async () => {
                const latest = current.current;
                if (!mounted.current || latest.editor !== editor) return;
                const colors = extractPalette(decodePixels(selected.pixels), 16);
                if (!colors.length) throw new Error('参考图没有可提取的颜色');
                latest.editor.setPalette(colors);
                latest.onChange();
              })
            }
          >
            提取色板
          </button>
        </>
      )}
    </div>
  );
}

export function StampPanel(props: WorkspacePanelsProps) {
  const { workspace, editor, onWorkspace, onChange, run } = props;
  const [name, setName] = useState('自定义印章'),
    [selectedId, setSelectedId] = useState<string>(),
    [busy, setBusy] = useState(false);
  const current = useRef(props);
  current.current = props;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const stamp = useMemo(() => editor.getStampImage(), [editor, editor.revision]);
  const preview = stamp ? { ...stamp, id: 'active-stamp' } : undefined;
  const select = (asset: SkinAsset) => {
    void run(async () => {
      editor.setStampImage(fitWorkspaceImage(asset, 256));
      setName(asset.name);
      setSelectedId(asset.id);
      onChange();
    });
  };
  const importStamp = async () => {
    setBusy(true);
    const origin = editor;
    try {
      const image = await run(() => api.skinEditorImport('image'));
      if (!image || !mounted.current || current.current.editor !== origin) return;
      await run(async () => {
        if (!mounted.current || current.current.editor !== origin) return;
        const fitted = fitWorkspaceImage(image, 256);
        origin.setStampImage(fitted);
        setName(fitted.name);
        setSelectedId(undefined);
        current.current.onChange();
      });
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const save = () =>
    void run(async () => {
      const image = editor.getStampImage();
      if (!image) return;
      const active = workspace.brushes.find((asset) => asset.id === selectedId);
      if (!active && workspace.brushes.length >= 8) throw new Error('最多保存 8 个印章');
      const asset = {
        ...fitWorkspaceImage(image, 256),
        id: active?.id ?? crypto.randomUUID(),
        name: name.trim().slice(0, 80) || '自定义印章',
      };
      onWorkspace({
        ...workspace,
        brushes: active
          ? workspace.brushes.map((item) => (item.id === active.id ? asset : item))
          : [...workspace.brushes, asset],
      });
      setSelectedId(asset.id);
    });
  return (
    <div className="skin-workspace-panel skin-stamp-panel">
      <div className="skin-workspace-actions">
        <button disabled={busy} onClick={() => void importStamp()}>
          <ImagePlus size={14} />
          导入 PNG
        </button>
        <button
          onClick={() =>
            void run(async () => {
              editor.setStampFromSelection();
              setSelectedId(undefined);
              setName('选区印章');
              onChange();
            })
          }
        >
          从选区创建
        </button>
      </div>
      {preview && (
        <div className="skin-stamp-current">
          <AssetPixels asset={preview} />
          <span>
            {preview.width}×{preview.height}
          </span>
        </div>
      )}
      <div className="skin-workspace-name">
        <input
          aria-label="印章名称"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          aria-label="保存印章"
          disabled={
            !stamp ||
            (workspace.brushes.length >= 8 &&
              !workspace.brushes.some((asset) => asset.id === selectedId))
          }
          onClick={save}
        >
          <Save size={14} />
        </button>
      </div>
      <div className="skin-workspace-status">
        <span>已保存印章</span>
        <span>{workspace.brushes.length}/8</span>
      </div>
      <div className="skin-stamp-list">
        {workspace.brushes.map((asset) => (
          <div key={asset.id} className={selectedId === asset.id ? 'active' : ''}>
            <button
              className="skin-stamp-choice"
              onClick={() => select(asset)}
              aria-label={'选用印章 ' + asset.name}
              aria-pressed={selectedId === asset.id}
            >
              <AssetPixels asset={asset} />
              <span>{asset.name}</span>
              {selectedId === asset.id && <Check size={13} />}
            </button>
            <button
              aria-label={'删除印章 ' + asset.name}
              onClick={() => {
                onWorkspace({
                  ...workspace,
                  brushes: workspace.brushes.filter((item) => item.id !== asset.id),
                });
                if (selectedId === asset.id) setSelectedId(undefined);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PosePanel({ workspace, onWorkspace }: WorkspacePanelsProps) {
  const [part, setPart] = useState<SkinPart>('head'),
    [name, setName] = useState('我的姿势'),
    [selected, setSelected] = useState('');
  const angles = workspace.poseAngles[part] ?? { x: 0, y: 0, z: 0 };
  const update = (axis: 'x' | 'y' | 'z', value: number) => {
    if (Number.isFinite(value))
      onWorkspace({
        ...workspace,
        poseAngles: {
          ...workspace.poseAngles,
          [part]: { ...angles, [axis]: Math.max(-180, Math.min(180, value)) },
        },
      });
  };
  const savePose = () => {
    const label = name.trim().slice(0, 40);
    if (!label) return;
    const exists = workspace.poses.some((pose) => pose.name === label);
    if (!exists && workspace.poses.length >= 20) return;
    const value = { name: label, angles: structuredClone(workspace.poseAngles) };
    onWorkspace({
      ...workspace,
      poses: exists
        ? workspace.poses.map((pose) => (pose.name === label ? value : pose))
        : [...workspace.poses, value],
    });
    setSelected(label);
  };
  return (
    <div className="skin-workspace-panel skin-pose-panel">
      <Select
        aria-label="调整姿势部位"
        value={part}
        onChange={(event) => setPart(event.target.value as SkinPart)}
      >
        {Object.entries(partLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      {(['x', 'y', 'z'] as const).map((axis, index) => (
        <label className="skin-pose-axis" key={axis}>
          <span>{['俯仰 X', '转向 Y', '侧倾 Z'][index]}</span>
          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            aria-label={partLabels[part] + ' ' + axis.toUpperCase() + ' 角度'}
            value={angles[axis]}
            onChange={(event) => update(axis, +event.target.value)}
          />
          <input
            type="number"
            min="-180"
            max="180"
            step="1"
            aria-label={partLabels[part] + ' ' + axis.toUpperCase() + ' 角度数值'}
            value={angles[axis]}
            onChange={(event) => update(axis, event.target.value === '' ? 0 : +event.target.value)}
          />
        </label>
      ))}
      <div className="skin-workspace-actions">
        <button
          onClick={() => {
            const next = { ...workspace.poseAngles };
            delete next[part];
            onWorkspace({ ...workspace, poseAngles: next });
          }}
        >
          重置部位
        </button>
        <button onClick={() => onWorkspace({ ...workspace, poseAngles: {} })}>重置姿势</button>
      </div>
      <div className="skin-workspace-name">
        <input
          aria-label="姿势名称"
          maxLength={40}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          aria-label="保存姿势"
          disabled={
            !name.trim() ||
            (workspace.poses.length >= 20 &&
              !workspace.poses.some((pose) => pose.name === name.trim()))
          }
          onClick={savePose}
        >
          <Save size={14} />
        </button>
      </div>
      {workspace.poses.length > 0 && (
        <div className="skin-workspace-name">
          <Select
            aria-label="已保存姿势"
            value={selected}
            onChange={(event) => {
              const pose = workspace.poses.find((item) => item.name === event.target.value);
              if (!pose) return;
              setSelected(pose.name);
              setName(pose.name);
              onWorkspace({ ...workspace, poseAngles: structuredClone(pose.angles) });
            }}
          >
            <option value="">选择姿势</option>
            {workspace.poses.map((pose) => (
              <option value={pose.name} key={pose.name}>
                {pose.name}
              </option>
            ))}
          </Select>
          <button
            aria-label="删除已选姿势"
            disabled={!selected || !workspace.poses.some((pose) => pose.name === selected)}
            onClick={() => {
              onWorkspace({
                ...workspace,
                poses: workspace.poses.filter((pose) => pose.name !== selected),
              });
              setSelected('');
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
      <div className="skin-workspace-background">
        <label>
          背景
          <input
            type="color"
            aria-label="预览背景颜色"
            value={workspace.background}
            onChange={(event) => onWorkspace({ ...workspace, background: event.target.value })}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={workspace.checkerboard}
            onChange={(event) => onWorkspace({ ...workspace, checkerboard: event.target.checked })}
          />
          棋盘背景
        </label>
      </div>
    </div>
  );
}
