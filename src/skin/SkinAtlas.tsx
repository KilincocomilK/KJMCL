import { useEffect, useRef } from 'react';
import type { SkinFace, SkinModel } from '../../shared/skin';
import { faceAt, skinFaces } from './uv';
import {
  atlasPixel,
  screenSamples,
  zoomAtlas,
  type AtlasTransform,
  type SkinPoint,
  type SkinPointerEvent,
} from './view-math';

export interface SkinAtlasProps {
  pixels: Uint8ClampedArray;
  resolution: number;
  model: SkinModel;
  revision?: number;
  onPixel?: (event: SkinPointerEvent) => void;
  onHover?: (point: SkinPoint | null) => void;
  grid?: boolean;
  labels?: boolean;
  selection?: Uint8Array | null;
  activeFace?: SkinFace | null;
  brushSize?: number;
  mode?: 'paint' | 'pan';
  altPaint?: boolean;
  viewRevision?: number;
}
const partNames = {
  head: '头',
  body: '身体',
  rightArm: '右臂',
  leftArm: '左臂',
  rightLeg: '右腿',
  leftLeg: '左腿',
};
const faceNames = { top: '顶', bottom: '底', front: '前', back: '后', left: '左', right: '右' };

export function SkinAtlas(props: SkinAtlasProps) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const update = useRef<(() => void) | undefined>(undefined),
    reset = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    update.current?.();
  });
  useEffect(() => {
    reset.current?.();
  }, [props.viewRevision]);
  useEffect(() => {
    const element = host.current,
      c = canvas.current;
    if (!element || !c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const image = document.createElement('canvas');
    image.width = props.resolution;
    image.height = props.resolution;
    const imageContext = image.getContext('2d')!;
    let width = 1,
      height = 1,
      initialized = false;
    let transform: AtlasTransform = { x: 0, y: 0, scale: 1 };
    let hover: SkinPoint | null = null;
    let drag:
      | {
          id: number;
          mode: 'paint' | 'pan';
          last: { x: number; y: number };
          point: SkinPoint | null;
        }
      | undefined;
    let lastPixel = '',
      frame = 0;
    const draw = () => {
      frame = 0;
      const p = latest.current,
        res = p.resolution,
        s = transform.scale;
      if (p.pixels.length !== res * res * 4) return;
      imageContext.putImageData(new ImageData(new Uint8ClampedArray(p.pixels), res, res), 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(s, s);
      ctx.imageSmoothingEnabled = false;
      const tile = Math.max(1, res / 32);
      ctx.fillStyle = '#33383c';
      ctx.fillRect(0, 0, res, res);
      ctx.fillStyle = '#262b30';
      for (let y = 0; y < res; y += tile)
        for (let x = 0; x < res; x += tile)
          if ((x / tile + y / tile) % 2) ctx.fillRect(x, y, tile, tile);
      ctx.drawImage(image, 0, 0);
      if (p.activeFace) {
        ctx.fillStyle = '#0008';
        ctx.beginPath();
        ctx.rect(0, 0, res, res);
        ctx.rect(p.activeFace.x, p.activeFace.y, p.activeFace.width, p.activeFace.height);
        ctx.fill('evenodd');
      }
      if (p.selection && p.selection.length === res * res) {
        ctx.fillStyle = '#f26b2150';
        ctx.strokeStyle = '#ffb274';
        ctx.lineWidth = 1 / s;
        for (let y = 0; y < res; y++)
          for (let x = 0; x < res; x++) {
            const index = y * res + x;
            if (!p.selection[index]) continue;
            ctx.fillRect(x, y, 1, 1);
            ctx.beginPath();
            if (y === 0 || !p.selection[index - res]) {
              ctx.moveTo(x, y);
              ctx.lineTo(x + 1, y);
            }
            if (y === res - 1 || !p.selection[index + res]) {
              ctx.moveTo(x, y + 1);
              ctx.lineTo(x + 1, y + 1);
            }
            if (x === 0 || !p.selection[index - 1]) {
              ctx.moveTo(x, y);
              ctx.lineTo(x, y + 1);
            }
            if (x === res - 1 || !p.selection[index + 1]) {
              ctx.moveTo(x + 1, y);
              ctx.lineTo(x + 1, y + 1);
            }
            ctx.stroke();
          }
      }
      if (p.grid !== false && s >= 4) {
        ctx.strokeStyle = '#0005';
        ctx.lineWidth = 1 / s;
        ctx.beginPath();
        // Only rasterize grid lines visible in the current viewport.
        for (
          let x = Math.max(0, Math.floor(-transform.x / s));
          x <= Math.min(res, Math.ceil((width - transform.x) / s));
          x++
        ) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, res);
        }
        for (
          let y = Math.max(0, Math.floor(-transform.y / s));
          y <= Math.min(res, Math.ceil((height - transform.y) / s));
          y++
        ) {
          ctx.moveTo(0, y);
          ctx.lineTo(res, y);
        }
        ctx.stroke();
      }
      if (p.labels) {
        for (const face of skinFaces(p.model, res)) {
          ctx.strokeStyle = face.surface === 'base' ? '#80b6cfbb' : '#d39859bb';
          ctx.lineWidth = 1 / s;
          ctx.strokeRect(face.x, face.y, face.width, face.height);
          if (face.width * s >= 32 && face.height * s >= 16) {
            ctx.save();
            ctx.translate(face.x + face.width / 2, face.y + face.height / 2);
            ctx.scale(1 / s, 1 / s);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '10px sans-serif';
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#000b';
            ctx.fillStyle = '#fff9';
            const label = partNames[face.part] + faceNames[face.face];
            ctx.strokeText(label, 0, 0);
            ctx.fillText(label, 0, 0);
            ctx.restore();
          }
        }
      }
      if (hover) {
        const size = Math.max(1, p.brushSize ?? 1),
          half = Math.floor((size - 1) / 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 / s;
        ctx.strokeRect(hover.x - half, hover.y - half, size, size);
        ctx.strokeStyle = '#f26b21';
        ctx.lineWidth = 1 / s;
        ctx.strokeRect(hover.x - half, hover.y - half, size, size);
      }
      ctx.restore();
    };
    const requestDraw = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    update.current = requestDraw;
    const fit = () => {
      const scale = Math.max(
        0.25,
        Math.min((width - 32) / props.resolution, (height - 32) / props.resolution),
      );
      transform = {
        x: (width - props.resolution * scale) / 2,
        y: (height - props.resolution * scale) / 2,
        scale,
      };
      requestDraw();
    };
    reset.current = fit;
    const observer = new ResizeObserver(() => {
      const oldWidth = width,
        oldHeight = height;
      width = Math.max(1, element.clientWidth);
      height = Math.max(1, element.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!initialized) {
        initialized = true;
        fit();
      } else {
        transform.x += (width - oldWidth) / 2;
        transform.y += (height - oldHeight) / 2;
        requestDraw();
      }
    });
    observer.observe(element);
    const locate = (e: PointerEvent | WheelEvent) => {
      const rect = c.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const pointAt = (position: { x: number; y: number }): SkinPoint | null => {
      const point = atlasPixel(position.x, position.y, transform, props.resolution);
      if (point) point.face = faceAt(point.x, point.y, latest.current.model, props.resolution);
      return point;
    };
    const emit = (point: SkinPoint, e: PointerEvent, phase: SkinPointerEvent['phase']) => {
      const key = `${point.x},${point.y}`;
      if (phase === 'move' && key === lastPixel) return;
      lastPixel = key;
      latest.current.onPixel?.({
        ...point,
        phase,
        pressure: e.pointerType === 'pen' ? e.pressure || 0.5 : 1,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey || e.metaKey,
        source: '2d',
      });
    };
    const down = (e: PointerEvent) => {
      if (drag) return;
      e.preventDefault();
      c.focus();
      c.setPointerCapture(e.pointerId);
      const position = locate(e),
        point = pointAt(position),
        mode =
          e.button !== 0 || (e.altKey && !latest.current.altPaint) || latest.current.mode === 'pan'
            ? 'pan'
            : 'paint';
      drag = { id: e.pointerId, last: position, point, mode };
      lastPixel = '';
      if (mode === 'paint' && point) emit(point, e, 'start');
      hover = point;
      requestDraw();
    };
    const move = (e: PointerEvent) => {
      const position = locate(e);
      if (drag && drag.id === e.pointerId) {
        if (drag.mode === 'pan') {
          transform.x += position.x - drag.last.x;
          transform.y += position.y - drag.last.y;
        } else
          for (const sample of screenSamples(drag.last, position)) {
            const point = pointAt(sample);
            if (point) {
              emit(point, e, drag.point ? 'move' : 'start');
              drag.point = point;
            }
          }
        drag.last = position;
      }
      hover = pointAt(position);
      latest.current.onHover?.(hover);
      requestDraw();
    };
    const end = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (drag.mode === 'paint' && drag.point) emit(drag.point, e, 'end');
      drag = undefined;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      requestDraw();
    };
    const leave = () => {
      if (!drag) {
        hover = null;
        latest.current.onHover?.(null);
        requestDraw();
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const position = locate(e);
      transform = zoomAtlas(transform, position.x, position.y, Math.exp(-e.deltaY * 0.002));
      hover = pointAt(position);
      requestDraw();
    };
    const menu = (e: Event) => e.preventDefault();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Home') {
        e.preventDefault();
        fit();
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        transform = zoomAtlas(transform, width / 2, height / 2, 1.25);
        requestDraw();
      }
      if (e.key === '-') {
        e.preventDefault();
        transform = zoomAtlas(transform, width / 2, height / 2, 0.8);
        requestDraw();
      }
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('lostpointercapture', end);
    c.addEventListener('pointerleave', leave);
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('contextmenu', menu);
    c.addEventListener('keydown', key);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      update.current = undefined;
      reset.current = undefined;
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', end);
      c.removeEventListener('pointercancel', end);
      c.removeEventListener('lostpointercapture', end);
      c.removeEventListener('pointerleave', leave);
      c.removeEventListener('wheel', wheel);
      c.removeEventListener('contextmenu', menu);
      c.removeEventListener('keydown', key);
    };
  }, [props.resolution]);
  return (
    <div
      ref={host}
      className="skin-atlas"
      style={{
        minWidth: 0,
        minHeight: 320,
        height: '100%',
        overflow: 'hidden',
        background: '#101416',
        position: 'relative',
      }}
    >
      <canvas
        ref={canvas}
        aria-label="皮肤展开图编辑画布"
        tabIndex={0}
        title="左键绘制 · 右键平移 · 滚轮缩放 · Home 适应画布"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          touchAction: 'none',
          outline: 'none',
        }}
      />
    </div>
  );
}
