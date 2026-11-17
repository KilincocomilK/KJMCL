import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { SkinFace, SkinModel, SkinPart, SkinSurface } from '../../shared/skin';
import { skinFaces } from './uv';
import {
  faceQuad,
  quadPoint,
  screenSamples,
  texturePixel,
  viewAngles,
  poseRotation,
  animationTimes,
  opaqueSkinPixels,
  type SkinPoseAngles,
  type SkinAnimationOptions,
  type SkinPoint,
  type SkinPointerEvent,
  type SkinPose,
  type SkinView,
  type Vec3,
} from './view-math';

export interface SkinViewportProps {
  pixels: Uint8ClampedArray;
  resolution: number;
  model: SkinModel;
  revision?: number;
  onPixel?: (event: SkinPointerEvent) => void;
  onHover?: (point: SkinPoint | null) => void;
  activeSurface?: SkinSurface;
  visibleParts?: Partial<Record<SkinPart, boolean>>;
  showBase?: boolean;
  showOuter?: boolean;
  view?: SkinView;
  viewRevision?: number;
  pose?: SkinPose;
  poseAngles?: SkinPoseAngles;
  background?: string;
  checkerboard?: boolean;
  animate?: boolean;
  autoRotate?: boolean;
  grid?: boolean;
  gamePreview?: boolean;
  flatLight?: boolean;
  mode?: 'paint' | 'orbit';
  altPaint?: boolean;
  brushSize?: number;
  onCaptureReady?: (capture: ((transparent?: boolean) => string) | undefined) => void;
  onAnimationReady?: (
    capture: ((options: SkinAnimationOptions) => Promise<string[]>) | undefined,
  ) => void;
}
type FaceMesh = THREE.Mesh<
  THREE.BufferGeometry,
  THREE.MeshBasicMaterial | THREE.MeshLambertMaterial
>;
type PartNode = { group: THREE.Group; faces: FaceMesh[]; grids: THREE.LineSegments[] };

const parts: SkinPart[] = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];
function partDimensions(part: SkinPart, model: SkinModel): Vec3 {
  return part === 'head'
    ? [8, 8, 8]
    : part === 'body'
      ? [8, 12, 4]
      : [part.endsWith('Arm') && model === 'slim' ? 3 : 4, 12, 4];
}
function partPivot(part: SkinPart, model: SkinModel): Vec3 {
  switch (part) {
    case 'head':
      return [0, 24, 0];
    case 'body':
      return [0, 24, 0];
    case 'rightArm':
      return [model === 'slim' ? -5.5 : -6, 24, 0];
    case 'leftArm':
      return [model === 'slim' ? 5.5 : 6, 24, 0];
    case 'rightLeg':
      return [-2, 12, 0];
    case 'leftLeg':
      return [2, 12, 0];
  }
}
export function createSkinFaceGeometry(quad: Vec3[], face: SkinFace, resolution: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(quad.flat(), 3));
  g.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      [
        face.x / resolution,
        1 - face.y / resolution,
        (face.x + face.width) / resolution,
        1 - face.y / resolution,
        (face.x + face.width) / resolution,
        1 - (face.y + face.height) / resolution,
        face.x / resolution,
        1 - (face.y + face.height) / resolution,
      ],
      2,
    ),
  );
  g.setIndex([0, 3, 1, 3, 2, 1]);
  g.computeVertexNormals();
  return g;
}
function gridGeometry(quad: Vec3[], face: SkinFace) {
  const values: number[] = [];
  for (let x = 0; x <= face.width; x++)
    values.push(...quadPoint(quad, x / face.width, 0), ...quadPoint(quad, x / face.width, 1));
  for (let y = 0; y <= face.height; y++)
    values.push(...quadPoint(quad, 0, y / face.height), ...quadPoint(quad, 1, y / face.height));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
  return g;
}

export function SkinViewport(props: SkinViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const dirty = useRef(true);
  const textureUpdate = useRef<(() => void) | undefined>(undefined);
  const viewUpdate = useRef<(() => void) | undefined>(undefined);
  const [error, setError] = useState('');
  const [contextRevision, setContextRevision] = useState(0);
  useEffect(() => {
    dirty.current = true;
    textureUpdate.current?.();
  }, [props.pixels, props.resolution, props.revision]);
  useEffect(() => {
    dirty.current = true;
  });
  useEffect(() => {
    viewUpdate.current?.();
  }, [props.view, props.viewRevision]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      setError('3D 视图不可用，请使用展开图');
      return;
    }
    setError('');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = renderer.domElement;
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '三维皮肤编辑画布');
    canvas.title = '左键绘制 · 右键旋转 · Shift+右键平移 · 滚轮缩放';
    element.append(canvas);
    const scene = new THREE.Scene();
    let disposed = false,
      capturing = false;
    const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 400);
    const target = new THREE.Vector3(0, 16, 0);
    let yaw = -0.45,
      pitch = 0.18,
      zoom = 1,
      width = 1,
      height = 1;
    const updateCamera = () => {
      const aspect = width / height,
        half = 20 / zoom;
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.top = half;
      camera.bottom = -half;
      camera.position.set(
        target.x + 80 * Math.sin(yaw) * Math.cos(pitch),
        target.y + 80 * Math.sin(pitch),
        target.z + 80 * Math.cos(yaw) * Math.cos(pitch),
      );
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      dirty.current = true;
    };
    const resetView = () => {
      [yaw, pitch] = viewAngles[latest.current.view ?? 'free'];
      target.set(0, 16, 0);
      zoom = 1;
      updateCamera();
    };
    viewUpdate.current = resetView;
    const source = document.createElement('canvas');
    source.width = props.resolution;
    source.height = props.resolution;
    const context = source.getContext('2d')!;
    const texture = new THREE.CanvasTexture(source);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    const baseSource = document.createElement('canvas');
    baseSource.width = baseSource.height = props.resolution;
    const baseContext = baseSource.getContext('2d')!;
    const baseTexture = new THREE.CanvasTexture(baseSource);
    baseTexture.colorSpace = THREE.SRGBColorSpace;
    baseTexture.magFilter = THREE.NearestFilter;
    baseTexture.minFilter = THREE.NearestFilter;
    baseTexture.generateMipmaps = false;
    const refreshTexture = () => {
      const p = latest.current;
      if (p.pixels.length !== props.resolution * props.resolution * 4) return;
      context.putImageData(
        new ImageData(new Uint8ClampedArray(p.pixels), props.resolution, props.resolution),
        0,
        0,
      );
      baseContext.putImageData(
        new ImageData(opaqueSkinPixels(p.pixels), props.resolution, props.resolution),
        0,
        0,
      );
      texture.needsUpdate = true;
      baseTexture.needsUpdate = true;
      dirty.current = true;
    };
    textureUpdate.current = refreshTexture;
    refreshTexture();
    const baseFlat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
    const baseShade = new THREE.MeshLambertMaterial({ map: texture, side: THREE.FrontSide });
    const outerFlat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.01,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const outerShade = new THREE.MeshLambertMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.01,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x5c6268,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    scene.add(new THREE.AmbientLight(0xffffff, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(-30, 60, 60);
    scene.add(light);
    const nodes = new Map<SkinPart, PartNode>();
    const allFaces: FaceMesh[] = [];
    const faceDefinitions = skinFaces(props.model, props.resolution);
    for (const part of parts) {
      const group = new THREE.Group();
      group.position.set(...partPivot(part, props.model));
      scene.add(group);
      const node: PartNode = { group, faces: [], grids: [] };
      nodes.set(part, node);
      const dimensions = partDimensions(part, props.model);
      const centerY = part === 'head' ? 4 : -6;
      for (const face of faceDefinitions.filter((f) => f.part === part)) {
        const inflate = face.surface === 'outer' ? (part === 'head' ? 0.5 : 0.25) : 0;
        const quad = faceQuad(
          face.face,
          dimensions[0] + inflate * 2,
          dimensions[1] + inflate * 2,
          dimensions[2] + inflate * 2,
        ).map(([x, y, z]) => [x, y + centerY, z] as Vec3);
        const mesh = new THREE.Mesh(
          createSkinFaceGeometry(quad, face, props.resolution),
          face.surface === 'base' ? baseFlat : outerFlat,
        );
        mesh.userData = { face, quad };
        mesh.renderOrder = face.surface === 'outer' ? 2 : 0;
        group.add(mesh);
        node.faces.push(mesh);
        allFaces.push(mesh);
        const line = new THREE.LineSegments(gridGeometry(quad, face), lineMaterial);
        line.userData = { surface: face.surface };
        line.renderOrder = 3;
        // Polygon offset keeps a small grid visible without inflating the model geometry.
        mesh.material.polygonOffset = true;
        mesh.material.polygonOffsetFactor = 1;
        mesh.material.polygonOffsetUnits = 1;
        group.add(line);
        node.grids.push(line);
      }
    }
    const cursorGeometry = new THREE.BufferGeometry();
    const cursorMaterial = new THREE.LineBasicMaterial({ color: 0xf26b21, depthTest: false });
    const cursor = new THREE.LineLoop(cursorGeometry, cursorMaterial);
    cursor.renderOrder = 10;
    cursor.visible = false;
    const raycaster = new THREE.Raycaster();
    const vector = new THREE.Vector2();
    const hit = (x: number, y: number) => {
      vector.set((x / width) * 2 - 1, 1 - (y / height) * 2);
      scene.updateMatrixWorld();
      raycaster.setFromCamera(vector, camera);
      const p = latest.current;
      const meshes = allFaces.filter(
        (mesh) =>
          mesh.visible &&
          mesh.parent?.visible &&
          (mesh.userData.face as SkinFace).surface === (p.activeSurface ?? 'base'),
      );
      const intersection = raycaster.intersectObjects(meshes, false)[0];
      if (!intersection?.uv) return null;
      const mesh = intersection.object as FaceMesh;
      const face = mesh.userData.face as SkinFace;
      return {
        ...texturePixel(intersection.uv.x, intersection.uv.y, props.resolution, face),
        mesh,
      };
    };
    let hover: ReturnType<typeof hit> = null;
    const moveCursor = (point: ReturnType<typeof hit>) => {
      hover = point;
      cursor.visible = !!point;
      if (!point) return;
      const face = point.face!,
        quad = point.mesh.userData.quad as Vec3[];
      const size = Math.max(1, latest.current.brushSize ?? 1),
        offset = Math.floor((size - 1) / 2);
      const u0 = Math.max(0, (point.x - face.x - offset) / face.width),
        v0 = Math.max(0, (point.y - face.y - offset) / face.height);
      const u1 = Math.min(1, (point.x - face.x - offset + size) / face.width),
        v1 = Math.min(1, (point.y - face.y - offset + size) / face.height);
      cursorGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [
            quadPoint(quad, u0, v0),
            quadPoint(quad, u1, v0),
            quadPoint(quad, u1, v1),
            quadPoint(quad, u0, v1),
          ].flat(),
          3,
        ),
      );
      point.mesh.parent!.add(cursor);
    };
    const locate = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    let drag:
      | {
          id: number;
          mode: 'paint' | 'orbit' | 'pan';
          last: { x: number; y: number };
          point: SkinPoint | null;
          gap: boolean;
          startedAt: number;
        }
      | undefined;
    let lastPixel = '';
    const emit = (
      point: SkinPoint,
      e: PointerEvent,
      phase: SkinPointerEvent['phase'],
      discontinuous = false,
    ) => {
      const key = `${point.x},${point.y}`;
      if (phase === 'move' && key === lastPixel) return;
      lastPixel = key;
      latest.current.onPixel?.({
        x: point.x,
        y: point.y,
        face: point.face,
        phase,
        pressure: e.pointerType === 'pen' ? e.pressure || 0.5 : 1,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey || e.metaKey,
        source: '3d',
        discontinuous,
      });
    };
    const pointerDown = (e: PointerEvent) => {
      if (drag || capturing) return;
      e.preventDefault();
      canvas.focus();
      canvas.setPointerCapture(e.pointerId);
      const position = locate(e),
        point = hit(position.x, position.y);
      const mode =
        e.button === 1 || (e.button === 2 && e.shiftKey)
          ? 'pan'
          : e.button === 2 ||
              (e.altKey && !latest.current.altPaint) ||
              latest.current.mode === 'orbit'
            ? 'orbit'
            : 'paint';
      drag = {
        id: e.pointerId,
        mode,
        last: position,
        point,
        gap: false,
        startedAt: performance.now(),
      };
      lastPixel = '';
      if (mode === 'paint' && point) emit(point, e, 'start');
      moveCursor(point);
      dirty.current = true;
    };
    const pointerMove = (e: PointerEvent) => {
      if (capturing) return;
      const position = locate(e);
      if (drag && drag.id === e.pointerId) {
        const dx = position.x - drag.last.x,
          dy = position.y - drag.last.y;
        if (drag.mode === 'orbit') {
          yaw -= dx * 0.009;
          pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, pitch + dy * 0.009));
          updateCamera();
        } else if (drag.mode === 'pan') {
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
            up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
          target
            .addScaledVector(right, (-dx * 40) / height / zoom)
            .addScaledVector(up, (dy * 40) / height / zoom);
          updateCamera();
        } else {
          for (const sample of screenSamples(drag.last, position)) {
            const point = hit(sample.x, sample.y);
            if (point) {
              const before = drag.point?.face,
                after = point.face;
              const changed =
                !!before &&
                (before.part !== after?.part ||
                  before.face !== after?.face ||
                  before.surface !== after?.surface);
              emit(point, e, drag.point ? 'move' : 'start', drag.gap || changed);
              drag.point = point;
              drag.gap = false;
            } else drag.gap = true;
          }
        }
        drag.last = position;
      }
      const point = hit(position.x, position.y);
      moveCursor(point);
      latest.current.onHover?.(point ? { x: point.x, y: point.y, face: point.face } : null);
      dirty.current = true;
    };
    const pointerEnd = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (drag.mode === 'paint' && drag.point) emit(drag.point, e, 'end');
      drag = undefined;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      dirty.current = true;
    };
    const pointerLeave = () => {
      if (!drag) {
        moveCursor(null);
        latest.current.onHover?.(null);
        dirty.current = true;
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (capturing) return;
      zoom = Math.max(0.35, Math.min(14, zoom * Math.exp(-e.deltaY * 0.001)));
      updateCamera();
    };
    const contextMenu = (e: Event) => e.preventDefault();
    const key = (e: KeyboardEvent) => {
      if (capturing) return;
      if (e.key === 'Home') {
        e.preventDefault();
        resetView();
      }
      if (
        latest.current.mode === 'orbit' &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
      ) {
        e.stopPropagation();
        e.preventDefault();
        yaw += e.key === 'ArrowLeft' ? 0.15 : e.key === 'ArrowRight' ? -0.15 : 0;
        pitch = Math.max(
          -1.56,
          Math.min(1.56, pitch + (e.key === 'ArrowUp' ? 0.1 : e.key === 'ArrowDown' ? -0.1 : 0)),
        );
        updateCamera();
      }
    };
    const lost = (e: Event) => {
      e.preventDefault();
      setError('3D 视图已暂停，正在等待恢复');
    };
    const restored = () => setContextRevision((n) => n + 1);
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerEnd);
    canvas.addEventListener('pointercancel', pointerEnd);
    canvas.addEventListener('lostpointercapture', pointerEnd);
    canvas.addEventListener('pointerleave', pointerLeave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('contextmenu', contextMenu);
    canvas.addEventListener('keydown', key);
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    const resize = new ResizeObserver(() => {
      if (capturing) return;
      width = Math.max(1, element.clientWidth);
      height = Math.max(1, element.clientHeight);
      renderer.setSize(width, height, false);
      updateCamera();
    });
    resize.observe(element);
    resetView();
    let frame = 0,
      lastTime = 0;
    const drawScene = (time: number, exported = false, animate = !!latest.current.animate) => {
      const p = latest.current;
      baseFlat.transparent = baseShade.transparent = p.gamePreview === false;
      baseFlat.map = baseShade.map = p.gamePreview === false ? texture : baseTexture;
      baseFlat.alphaTest = baseShade.alphaTest = p.gamePreview === false ? 0.01 : 0;
      for (const [part, node] of nodes) {
        node.group.visible = p.visibleParts?.[part] !== false;
        node.group.rotation.set(
          ...poseRotation(
            part,
            p.pose ?? 'stand',
            drag?.mode === 'paint' ? drag.startedAt : time,
            animate,
            p.poseAngles,
          ),
        );
        for (const face of node.faces) {
          const outer = (face.userData.face as SkinFace).surface === 'outer';
          face.visible = outer ? p.showOuter !== false : p.showBase !== false;
          face.material = outer
            ? p.flatLight === false
              ? outerShade
              : outerFlat
            : p.flatLight === false
              ? baseShade
              : baseFlat;
        }
        for (const grid of node.grids)
          grid.visible =
            !exported &&
            !!p.grid &&
            (grid.userData.surface === 'outer' ? p.showOuter !== false : p.showBase !== false);
      }
      if (exported) cursor.visible = false;
      else if (hover) moveCursor(hover);
      renderer.render(scene, camera);
      dirty.current = false;
    };
    const render = (time: number) => {
      const p = latest.current,
        delta = Math.min(0.05, (time - lastTime) / 1000);
      lastTime = time;
      if (!capturing) {
        if (p.autoRotate && !drag) {
          yaw += delta * 0.4;
          updateCamera();
        }
        if (dirty.current || (p.animate && !drag && (p.pose === 'walk' || p.pose === 'run')))
          drawScene(time);
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    const captureCanvas = (transparent = true) => {
      const output = document.createElement('canvas');
      output.width = canvas.width;
      output.height = canvas.height;
      const ctx = output.getContext('2d')!;
      if (!transparent) {
        ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(latest.current.background ?? '')
          ? latest.current.background!
          : '#151719';
        ctx.fillRect(0, 0, output.width, output.height);
      }
      ctx.drawImage(canvas, 0, 0);
      return output.toDataURL('image/png');
    };
    latest.current.onCaptureReady?.((transparent = true) => {
      if (disposed || capturing) throw new Error('请等待三维视图就绪');
      drawScene(performance.now(), true);
      const result = captureCanvas(transparent);
      dirty.current = true;
      return result;
    });
    latest.current.onAnimationReady?.(async (options) => {
      const times = animationTimes(options);
      if (disposed || capturing || drag) throw new Error('请结束笔触后再导出动画');
      options.signal?.throwIfAborted();
      capturing = true;
      const original = { width, height, yaw, pixelRatio: renderer.getPixelRatio() };
      const results: string[] = [];
      try {
        width = height = options.size;
        renderer.setPixelRatio(1);
        renderer.setSize(width, height, false);
        for (const [index, time] of times.entries()) {
          options.signal?.throwIfAborted();
          if (disposed) throw new Error('三维视图已关闭');
          yaw =
            original.yaw + (latest.current.autoRotate ? (Math.PI * 2 * index) / times.length : 0);
          updateCamera();
          drawScene(time, true, true);
          results.push(captureCanvas(false));
          options.onProgress?.(index + 1, times.length);
          // Yield to cancellation and paint events; no real-time animation delay.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        return results;
      } finally {
        capturing = false;
        if (!disposed) {
          width = Math.max(1, element.clientWidth);
          height = Math.max(1, element.clientHeight);
          yaw = original.yaw;
          renderer.setPixelRatio(original.pixelRatio);
          renderer.setSize(width, height, false);
          updateCamera();
          dirty.current = true;
        }
      }
    });
    return () => {
      disposed = true;
      latest.current.onCaptureReady?.(undefined);
      latest.current.onAnimationReady?.(undefined);
      cancelAnimationFrame(frame);
      resize.disconnect();
      textureUpdate.current = undefined;
      viewUpdate.current = undefined;
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      for (const node of nodes.values()) {
        for (const face of node.faces) face.geometry.dispose();
        for (const grid of node.grids) grid.geometry.dispose();
      }
      for (const material of [
        baseFlat,
        baseShade,
        outerFlat,
        outerShade,
        lineMaterial,
        cursorMaterial,
      ])
        material.dispose();
      cursorGeometry.dispose();
      texture.dispose();
      baseTexture.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [props.model, props.resolution, contextRevision]);
  return (
    <div
      ref={host}
      className="skin-viewport"
      style={{
        position: 'relative',
        minWidth: 0,
        minHeight: 320,
        height: '100%',
        overflow: 'hidden',
        backgroundColor: /^#[0-9a-f]{6}$/i.test(props.background ?? '')
          ? props.background
          : '#151719',
        backgroundImage:
          props.checkerboard === false
            ? undefined
            : 'conic-gradient(#ffffff05 25%,transparent 0 50%,#ffffff05 0 75%,transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      {error && (
        <div
          role="status"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            padding: 20,
            pointerEvents: 'none',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
