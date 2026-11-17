import { useEffect, useRef, useState } from 'react';
import {
  clampCoordinate,
  LruCache,
  pan,
  rulerLength,
  screenToWorld,
  tileKey,
  viewBounds,
  visibleTiles,
  worldToScreen,
  zoomAt,
  type MapSize,
  type MapView,
  type TilePosition,
  type WorldPoint,
} from './map-math';

export interface CanvasTile extends TilePosition {
  rgba: string;
  biomes?: Uint16Array;
}
export interface MapPin extends WorldPoint {
  id: string;
  name: string;
  color: string;
  type: string;
  kind?: 'structure' | 'marker' | 'spawn' | 'slime';
  detail?: string;
}
export interface CanvasHover extends WorldPoint {
  biome?: number;
  step?: number;
}
interface CachedTile extends Omit<CanvasTile, 'rgba'> {
  image: HTMLCanvasElement;
}
interface Props {
  identity: string;
  view: MapView;
  onView: (view: MapView) => void;
  fetchTile: (position: TilePosition, requestId: string) => Promise<CanvasTile>;
  cancel: (requestId: string) => void;
  pins: MapPin[];
  selected?: string;
  grid: boolean;
  labels: boolean;
  highlightBiome?: number;
  onPick: (point: WorldPoint, pin?: MapPin) => void;
  onHover: (point: CanvasHover | null) => void;
  onBounds?: (bounds: ReturnType<typeof viewBounds>) => void;
  onStatus: (status: { pending: number; loaded: number; error?: string }) => void;
  onCaptureReady?: (capture: (() => string) | undefined) => void;
}
const rgbaBytes = (base64: string, length: number) => {
  const raw = atob(base64);
  if (raw.length !== length) throw new Error('地图像素尺寸不匹配');
  return Uint8ClampedArray.from(raw, (c) => c.charCodeAt(0));
};
export function MapCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    current = useRef(props);
  current.current = props;
  const [size, setSize] = useState<MapSize>({ width: 1, height: 1 });
  const cache = useRef(new LruCache<string, CachedTile>(96)),
    generation = useRef(0),
    raf = useRef<number | undefined>(undefined),
    pointer = useRef<
      | { id: number; x: number; y: number; startX: number; startY: number; moved: boolean }
      | undefined
    >(undefined);
  const paint = () => {
    const node = canvas.current;
    if (!node) return;
    const context = node.getContext('2d');
    if (!context) return;
    const p = current.current,
      ratio = Math.min(window.devicePixelRatio || 1, 2),
      bounds = host.current!.getBoundingClientRect(),
      s = { width: bounds.width, height: bounds.height };
    if (
      node.width !== Math.round(s.width * ratio) ||
      node.height !== Math.round(s.height * ratio)
    ) {
      node.width = Math.round(s.width * ratio);
      node.height = Math.round(s.height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, s.width, s.height);
    context.fillStyle = '#121719';
    context.fillRect(0, 0, s.width, s.height);
    context.imageSmoothingEnabled = false;
    const world = viewBounds(p.view, s);
    for (const tile of cache.current.values().sort((a, b) => b.step - a.step)) {
      const span = tile.step * tile.size;
      if (
        tile.x > world.maxX ||
        tile.z > world.maxZ ||
        tile.x + span < world.minX ||
        tile.z + span < world.minZ
      )
        continue;
      const screen = worldToScreen(tile, p.view, s);
      context.drawImage(
        tile.image,
        screen.x,
        screen.y,
        span * p.view.zoom + 0.25,
        span * p.view.zoom + 0.25,
      );
      if (p.highlightBiome !== undefined && tile.biomes) {
        context.fillStyle = '#fff7';
        for (let i = 0; i < tile.biomes.length; i++)
          if (tile.biomes[i] === p.highlightBiome)
            context.fillRect(
              screen.x + (i % tile.size) * tile.step * p.view.zoom,
              screen.y + Math.floor(i / tile.size) * tile.step * p.view.zoom,
              tile.step * p.view.zoom + 0.25,
              tile.step * p.view.zoom + 0.25,
            );
      }
    }
    if (p.grid && p.view.zoom >= 0.3) {
      const spacing = p.view.zoom >= 2 ? 16 : 512;
      context.strokeStyle = '#0006';
      context.lineWidth = 1;
      context.beginPath();
      for (let x = Math.floor(world.minX / spacing) * spacing; x <= world.maxX; x += spacing) {
        const px = worldToScreen({ x, z: 0 }, p.view, s).x;
        context.moveTo(px, 0);
        context.lineTo(px, s.height);
      }
      for (let z = Math.floor(world.minZ / spacing) * spacing; z <= world.maxZ; z += spacing) {
        const py = worldToScreen({ x: 0, z }, p.view, s).y;
        context.moveTo(0, py);
        context.lineTo(s.width, py);
      }
      context.stroke();
    }
    const occupied = new Set<string>();
    for (const pin of [...p.pins].sort(
      (a, b) => Number(a.id === p.selected) - Number(b.id === p.selected),
    )) {
      const position = worldToScreen(pin, p.view, s);
      if (
        position.x < -30 ||
        position.y < -30 ||
        position.x > s.width + 30 ||
        position.y > s.height + 30
      )
        continue;
      if (pin.kind === 'slime') {
        context.fillStyle = '#65f35a55';
        context.fillRect(position.x, position.y, 16 * p.view.zoom, 16 * p.view.zoom);
        continue;
      }
      const selected = pin.id === p.selected;
      context.beginPath();
      context.fillStyle = pin.color;
      context.strokeStyle = selected ? '#fff' : '#101215';
      context.lineWidth = selected ? 3 : 2;
      if (pin.kind === 'marker') context.rect(position.x - 5, position.y - 5, 10, 10);
      else context.arc(position.x, position.y, selected ? 7 : 5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      const cell = `${Math.floor(position.x / 90)}:${Math.floor(position.y / 24)}`;
      if (p.labels && (!occupied.has(cell) || selected)) {
        occupied.add(cell);
        context.font = '11px "Microsoft YaHei",sans-serif';
        context.lineWidth = 3;
        context.strokeStyle = '#080a0b';
        context.strokeText(pin.name, position.x + 9, position.y + 4);
        context.fillStyle = '#fff';
        context.fillText(pin.name, position.x + 9, position.y + 4);
      }
    }
    const ruler = rulerLength(p.view.zoom, Math.min(90, s.width / 4));
    context.fillStyle = '#101419d9';
    context.fillRect(12, s.height - 47, ruler.pixels + 22, 35);
    context.strokeStyle = '#ddd';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(23, s.height - 19);
    context.lineTo(23 + ruler.pixels, s.height - 19);
    context.stroke();
    context.font = '10px monospace';
    context.fillStyle = '#fff';
    context.fillText(`${ruler.blocks.toLocaleString()} 格`, 23, s.height - 27);
    context.font = '12px sans-serif';
    context.fillStyle = '#ffffffcc';
    context.fillText('北 ↑', s.width - 42, 24);
  };
  const draw = () => {
    if (raf.current === undefined)
      raf.current = requestAnimationFrame(() => {
        raf.current = undefined;
        paint();
      });
  };
  useEffect(() => {
    const element = host.current!;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
      draw();
    });
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      current.current.onView(
        zoomAt(
          current.current.view,
          { width: rect.width, height: rect.height },
          event.clientX - rect.left,
          event.clientY - rect.top,
          Math.exp(-event.deltaY * 0.002),
        ),
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    const capture = () => {
      paint();
      return canvas.current!.toDataURL('image/png');
    };
    current.current.onCaptureReady?.(capture);
    const blur = () => {
      pointer.current = undefined;
    };
    window.addEventListener('blur', blur);
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', blur);
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
      raf.current = undefined;
      current.current.onCaptureReady?.(undefined);
    };
  }, []);
  useEffect(() => {
    cache.current.clear();
    draw();
  }, [props.identity]);
  useEffect(() => {
    draw();
  }, [
    props.view,
    props.pins,
    props.grid,
    props.labels,
    props.selected,
    props.highlightBiome,
    size,
  ]);
  useEffect(() => {
    if (size.width < 2 || size.height < 2) return;
    const seq = ++generation.current,
      active = new Set<string>(),
      desired = visibleTiles(props.view, size);
    cache.current.resize(Math.max(96, desired.length + 32));
    for (const tile of desired) cache.current.get(tileKey(tile));
    const queue = desired.filter((tile) => !cache.current.has(tileKey(tile)));
    let pending = queue.length,
      failed = false;
    props.onBounds?.(viewBounds(props.view, size));
    props.onStatus({ pending, loaded: desired.length - pending });
    const worker = async () => {
      while (queue.length && generation.current === seq) {
        const tile = queue.shift()!,
          id = crypto.randomUUID();
        active.add(id);
        try {
          const result = await current.current.fetchTile(tile, id);
          if (generation.current !== seq) return;
          const image = document.createElement('canvas');
          image.width = image.height = result.size;
          image
            .getContext('2d')!
            .putImageData(
              new ImageData(
                new Uint8ClampedArray(rgbaBytes(result.rgba, result.size * result.size * 4)),
                result.size,
                result.size,
              ),
              0,
              0,
            );
          cache.current.set(tileKey(tile), { ...tile, biomes: result.biomes, image });
          draw();
        } catch (error) {
          if (generation.current !== seq) return;
          failed = true;
          current.current.onStatus({
            pending: 0,
            loaded: desired.length - pending,
            error: error instanceof Error ? error.message : String(error),
          });
          queue.length = 0;
        } finally {
          active.delete(id);
          pending--;
          if (!failed && generation.current === seq)
            current.current.onStatus({ pending, loaded: desired.length - pending });
        }
      }
    };
    const timer = setTimeout(() => {
      void worker();
      void worker();
    }, 80);
    return () => {
      clearTimeout(timer);
      generation.current++;
      for (const id of active) current.current.cancel(id);
    };
  }, [props.identity, props.view.x, props.view.z, props.view.zoom, size.width, size.height]);
  const position = (event: { clientX: number; clientY: number }) => {
    const rect = host.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const hover = (event: { clientX: number; clientY: number }) => {
    const pos = position(event),
      point = screenToWorld(pos.x, pos.y, props.view, size);
    let biome: number | undefined, step: number | undefined;
    for (const tile of cache.current.values().sort((a, b) => a.step - b.step)) {
      const x = Math.floor((point.x - tile.x) / tile.step),
        z = Math.floor((point.z - tile.z) / tile.step);
      if (x >= 0 && z >= 0 && x < tile.size && z < tile.size && tile.biomes) {
        biome = tile.biomes[z * tile.size + x];
        step = tile.step;
        break;
      }
    }
    props.onHover({
      x: Math.floor(clampCoordinate(point.x)),
      z: Math.floor(clampCoordinate(point.z)),
      biome,
      step,
    });
  };
  return (
    <div className="seed-map-canvas" ref={host}>
      <canvas
        ref={canvas}
        aria-label="种子地图画布"
        tabIndex={0}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.button > 1) return;
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          pointer.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const drag = pointer.current;
          if (drag?.id === event.pointerId) {
            if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4)
              drag.moved = true;
            if (drag.moved)
              props.onView(
                pan(current.current.view, event.clientX - drag.x, event.clientY - drag.y),
              );
            drag.x = event.clientX;
            drag.y = event.clientY;
          }
          hover(event);
        }}
        onPointerUp={(event) => {
          const drag = pointer.current;
          pointer.current = undefined;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          if (!drag || drag.moved) return;
          const pos = position(event),
            point = screenToWorld(pos.x, pos.y, props.view, size);
          const pin = props.pins
            .filter((item) => item.kind !== 'slime')
            .map((item) => ({
              item,
              distance: Math.hypot(
                worldToScreen(item, props.view, size).x - pos.x,
                worldToScreen(item, props.view, size).y - pos.y,
              ),
            }))
            .filter((item) => item.distance < 12)
            .sort((a, b) => a.distance - b.distance)[0]?.item;
          props.onPick(
            { x: Math.floor(clampCoordinate(point.x)), z: Math.floor(clampCoordinate(point.z)) },
            pin,
          );
        }}
        onPointerCancel={() => {
          pointer.current = undefined;
        }}
        onLostPointerCapture={() => {
          pointer.current = undefined;
        }}
        onPointerLeave={() => {
          if (!pointer.current) props.onHover(null);
        }}
        onDoubleClick={(event) => {
          const pos = position(event);
          props.onView(zoomAt(props.view, size, pos.x, pos.y, 2));
        }}
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          const directions: Record<string, [number, number]> = {
            ArrowLeft: [80, 0],
            ArrowRight: [-80, 0],
            ArrowUp: [0, 80],
            ArrowDown: [0, -80],
          };
          if (directions[event.key]) {
            event.preventDefault();
            event.stopPropagation();
            props.onView(pan(props.view, ...directions[event.key]));
          }
          if (['+', '=', '-'].includes(event.key)) {
            event.preventDefault();
            props.onView(
              zoomAt(
                props.view,
                size,
                size.width / 2,
                size.height / 2,
                event.key === '-' ? 0.5 : 2,
              ),
            );
          }
        }}
      />
    </div>
  );
}
