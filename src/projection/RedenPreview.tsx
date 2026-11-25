import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectionDocument } from '../../shared/projection';
import type { ProjectionAssets } from '../../shared/projection-assets';
import type { RedenPreviewData } from '../../shared/reden';
import { api } from '../api';
import { ProjectionViewport } from './ProjectionViewport';
import { blockColor, decodeBlocks, isAir } from './model';
import './projection.css';

const none = new Set<number>(),
  noop = () => {};
function TopView({ width, depth, cells }: { width: number; depth: number; cells: Uint32Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(width, depth);
    for (let i = 0; i < cells.length; i++) {
      const n = cells[i];
      if (!n) continue;
      image.data[i * 4] = (n >>> 16) & 255;
      image.data[i * 4 + 1] = (n >>> 8) & 255;
      image.data[i * 4 + 2] = n & 255;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, [width, depth, cells]);
  return (
    <div className="reden-plan">
      <canvas ref={ref} width={width} height={depth} aria-label="投影俯视图" />
    </div>
  );
}
function Model({ doc }: { doc: ProjectionDocument }) {
  const blocks = useMemo(() => decodeBlocks(doc), [doc]),
    [w, h, d] = doc.dimensions;
  const cells = useMemo(() => {
    const top = new Uint32Array(w * d),
      colors = doc.palette.map((b) => (isAir(b) ? 0 : blockColor(b.name)));
    for (let i = 0; i < blocks.length; i++)
      if (colors[blocks[i]]) top[i % top.length] = colors[blocks[i]];
    return top;
  }, [blocks, w, d, doc.palette]);
  const [mode, setMode] = useState<'top' | 'model'>('top'),
    [assets, setAssets] = useState<ProjectionAssets>(),
    [error, setError] = useState('');
  useEffect(() => {
    if (mode !== 'model' || assets) return;
    let active = true;
    setError('');
    void api
      .projectionAssets({ blocks: [...new Set(doc.palette.map((b) => b.name))] })
      .then((a) => {
        if (active) setAssets(a);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [doc, mode, assets]);
  return (
    <>
      <div className="toolbar">
        <button aria-pressed={mode === 'top'} onClick={() => setMode('top')}>
          俯视
        </button>
        <button aria-pressed={mode === 'model'} onClick={() => setMode('model')}>
          立体
        </button>
        <small>
          {w} × {h} × {d} · {doc.nonAir.toLocaleString()} 个方块
        </small>
      </div>
      {mode === 'model' && assets ? (
        <div className="reden-viewport">
          <ProjectionViewport
            doc={doc}
            blocks={blocks}
            assets={assets}
            selected={none}
            hidden={none}
            layerMin={0}
            layerMax={h - 1}
            spacing={0}
            mode="orbit"
            grid={false}
            measure={[]}
            active
            onPick={noop}
            onBox={noop}
            onHover={noop}
            onReady={noop}
          />
        </div>
      ) : (
        <TopView width={w} depth={d} cells={cells} />
      )}
      {mode === 'model' && !assets && <p role="status">{error || '正在读取方块模型…'}</p>}
    </>
  );
}
export default function RedenPreview({ preview }: { preview: RedenPreviewData }) {
  if (preview.kind === 'model') return <Model doc={preview.doc} />;
  return (
    <>
      {preview.data.layers?.map((r, i) => (
        <div key={i}>
          <strong>{r.name}</strong>
          <TopView
            width={r.width}
            depth={r.depth}
            cells={Uint32Array.from(r.cells, (n) => (n ? blockColor(n) : 0))}
          />
        </div>
      ))}
      {preview.data.details.map((d) => (
        <p key={d.label}>
          {d.label}　{d.value}
        </p>
      ))}
      {preview.data.warning && <p>{preview.data.warning}</p>}
    </>
  );
}
