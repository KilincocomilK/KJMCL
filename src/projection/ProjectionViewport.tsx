import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ProjectionDocument } from '../../shared/projection';
import { coordinates } from './model';
import type { ProjectionAssets } from '../../shared/projection-assets';
import { ProjectionAtlas } from './atlas';
import {
  BlockMeshLibrary,
  buildProjectionGeometry,
  pickedBlock,
  projectionMaterial,
  type MaterialKind,
} from './block-renderer';
export type ViewMode = 'orbit' | 'select' | 'box' | 'measure';
export interface ViewActions {
  fit: () => void;
  view: (direction: 'iso' | 'top' | 'front' | 'side') => void;
  capture: () => string;
}
interface Props {
  doc: ProjectionDocument;
  assets: ProjectionAssets | null;
  onStatus?: (status: string) => void;
  blocks: Uint32Array;
  selected: Set<number>;
  hidden: Set<number>;
  layerMin: number;
  layerMax: number;
  spacing: number;
  mode: ViewMode;
  grid: boolean;
  measure: number[];
  active: boolean;
  onPick: (index: number, add: boolean) => void;
  onBox: (indices: number[], add: boolean) => void;
  onHover: (index?: number) => void;
  onReady: (actions?: ViewActions) => void;
}
export function ProjectionViewport(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    current = useRef(props);
  const previousView = useRef<
    | {
        id: string;
        camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
        target: THREE.Vector3;
      }
    | undefined
  >(undefined);
  current.current = props;
  const [error, setError] = useState(''),
    [rectangle, setRectangle] = useState<{ x: number; y: number; width: number; height: number }>();
  const sceneRef = useRef<
    | {
        scene: THREE.Scene;
        renderer: THREE.WebGLRenderer;
        camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
        controls: OrbitControls;
        group: THREE.Group;
        meshes: THREE.Mesh[];
        decorate: () => void;
        ids: number[];
        draw: () => void;
        rebuild: () => void;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    if (!props.active) return;
    setError('');
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
    } catch {
      setError('无法创建 3D 视图');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x101416);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('aria-label', '投影 3D 视图');
    renderer.domElement.setAttribute('role', 'application');
    const scene = new THREE.Scene(),
      group = new THREE.Group();
    scene.add(group);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b6be, 2));
    const light = new THREE.DirectionalLight(0xffffff, 1.8);
    light.position.set(30, 70, 50);
    scene.add(light);
    const saved = previousView.current?.id === props.doc.id ? previousView.current : undefined;
    let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera =
      saved?.camera.clone() ?? new THREE.PerspectiveCamera(42, 1, 0.1, 20000);
    let controls = new OrbitControls<THREE.PerspectiveCamera | THREE.OrthographicCamera>(
      camera,
      renderer.domElement,
    );
    controls.enableDamping = false;
    controls.maxDistance = 12000;
    controls.minDistance = 0.3;
    controls.target.copy(saved?.target ?? new THREE.Vector3());
    const data = {
      scene,
      renderer,
      camera: camera as THREE.PerspectiveCamera | THREE.OrthographicCamera,
      controls,
      group,
      ids: [] as number[],
      meshes: [] as THREE.Mesh[],
      decorate: () => {},
      draw: () => renderer.render(scene, data.camera),
      rebuild: () => {},
    };
    sceneRef.current = data;
    const world = new THREE.Group();
    scene.add(world);
    let atlas: ProjectionAtlas | undefined, library: BlockMeshLibrary | undefined;
    let disposed = false,
      generation = 0,
      animationFrame = 0,
      animationTimer = 0,
      renderReady = false;
    const materials = new Map<MaterialKind, THREE.MeshLambertMaterial>();
    const disposeGroup = () => {
      for (const child of [...group.children]) {
        group.remove(child);
        const node = child as THREE.Mesh;
        node.geometry?.dispose();
        if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose());
        else node.material?.dispose();
      }
    };
    const clearWorld = () => {
      for (const mesh of data.meshes) {
        world.remove(mesh);
        mesh.geometry.dispose();
      }
      data.meshes = [];
      data.ids = [];
    };
    const center = () => {
      const p = current.current;
      return new THREE.Vector3(
        p.doc.dimensions[0] / 2,
        (p.doc.dimensions[1] * (1 + p.spacing)) / 2,
        p.doc.dimensions[2] / 2,
      );
    };
    const fit = (direction: 'iso' | 'top' | 'front' | 'side' = 'iso') => {
      const p = current.current,
        [w, h, d] = p.doc.dimensions,
        target = center(),
        radius = Math.max(w, h * (1 + p.spacing), d, 2);
      const rect = element.getBoundingClientRect(),
        aspect = rect.width / Math.max(1, rect.height);
      if (direction === 'iso') {
        camera = new THREE.PerspectiveCamera(42, aspect, 0.1, Math.max(20000, radius * 20));
        camera.position.copy(target).add(new THREE.Vector3(radius * 1.3, radius, radius * 1.3));
      } else {
        const extent = radius * 0.75;
        camera = new THREE.OrthographicCamera(
          -extent * aspect,
          extent * aspect,
          extent,
          -extent,
          0.1,
          Math.max(20000, radius * 20),
        );
        camera.position
          .copy(target)
          .add(
            direction === 'top'
              ? new THREE.Vector3(0, radius * 3, 0)
              : direction === 'front'
                ? new THREE.Vector3(0, 0, radius * 3)
                : new THREE.Vector3(radius * 3, 0, 0),
          );
        if (direction === 'top') camera.up.set(0, 0, -1);
      }
      data.camera = camera;
      // Recreate controls when the camera's up axis changes (notably top view).
      controls.dispose();
      controls = new OrbitControls<THREE.PerspectiveCamera | THREE.OrthographicCamera>(
        camera,
        renderer.domElement,
      );
      controls.maxDistance = 12000;
      controls.minDistance = 0.3;
      controls.enabled = current.current.mode !== 'box';
      controls.addEventListener('change', data.draw);
      data.controls = controls;
      controls.target.copy(target);
      camera.lookAt(target);
      controls.update();
      data.draw();
    };
    data.decorate = () => {
      disposeGroup();
      const p = current.current,
        [w, h, d] = p.doc.dimensions;
      const lines: number[] = [];
      const visible = new Set(data.ids);
      for (const id of p.selected) {
        if (!visible.has(id)) continue;
        const [x, y, z] = coordinates(id, p.doc.dimensions),
          sy = y * (1 + p.spacing);
        const corners = [
          [x, sy, z],
          [x + 1, sy, z],
          [x + 1, sy, z + 1],
          [x, sy, z + 1],
          [x, sy + 1, z],
          [x + 1, sy + 1, z],
          [x + 1, sy + 1, z + 1],
          [x, sy + 1, z + 1],
        ];
        for (const [a, b] of [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0],
          [4, 5],
          [5, 6],
          [6, 7],
          [7, 4],
          [0, 4],
          [1, 5],
          [2, 6],
          [3, 7],
        ])
          lines.push(...corners[a], ...corners[b]);
      }
      if (lines.length) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
        const outline = new THREE.LineSegments(
          geometry,
          new THREE.LineBasicMaterial({
            color: 0xff903f,
            depthTest: false,
            transparent: true,
            opacity: 0.9,
          }),
        );
        outline.renderOrder = 4;
        group.add(outline);
      }
      if (p.grid) {
        const grid = new THREE.GridHelper(
          Math.max(w, d, 16),
          Math.min(256, Math.max(w, d, 16)),
          0x667079,
          0x303b42,
        );
        grid.position.set(w / 2, -0.06, d / 2);
        group.add(grid);
        const box = new THREE.Box3(
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(w, h * (1 + p.spacing), d),
        );
        const outline = new THREE.Box3Helper(box, 0x535b64);
        group.add(outline);
      }
      if (p.measure.length) {
        const points = p.measure.map((id) => {
          const [x, y, z] = coordinates(id, p.doc.dimensions);
          return new THREE.Vector3(x + 0.5, y * (1 + p.spacing) + 0.5, z + 0.5);
        });
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: 0xffdd73, depthTest: false }),
        );
        line.renderOrder = 5;
        group.add(line);
        for (const pos of points) {
          const dot = new THREE.Mesh(
            new THREE.SphereGeometry(0.15, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xffdd73, depthTest: false }),
          );
          dot.position.copy(pos);
          dot.renderOrder = 6;
          group.add(dot);
        }
      }
      data.draw();
    };
    data.rebuild = () => {
      setError('');
      current.current.onStatus?.('');
      const ticket = ++generation;
      renderReady = false;
      element.dataset.renderStatus = 'loading';
      clearWorld();
      data.decorate();
      if (!library || !atlas) return;
      const activeLibrary = library;
      void buildProjectionGeometry(
        current.current,
        activeLibrary,
        () => disposed || ticket !== generation,
      )
        .then((result) => {
          if (disposed || ticket !== generation) {
            for (const batch of result.batches) batch.geometry.dispose();
            return;
          }
          for (const batch of result.batches) {
            let material = materials.get(batch.kind);
            if (!material) {
              material = projectionMaterial(batch.kind, atlas!.texture);
              materials.set(batch.kind, material);
            }
            const mesh = new THREE.Mesh(batch.geometry, material);
            mesh.position.copy(batch.center);
            mesh.userData.blockIds = batch.ids;
            data.meshes.push(mesh);
            world.add(mesh);
          }
          data.ids = result.ids;
          renderReady = true;
          element.dataset.renderStatus = 'ready';
          element.dataset.renderQuads = String(result.quads);
          element.dataset.renderTextures = String(
            Object.keys(current.current.assets?.textures ?? {}).length,
          );
          current.current.onStatus?.(
            [
              activeLibrary.missing.size ? `${activeLibrary.missing.size} 种方块缺少模型` : '',
              atlas!.missing.size ? `${atlas!.missing.size} 张贴图缺失` : '',
            ]
              .filter(Boolean)
              .join(' · '),
          );
          data.decorate();
        })
        .catch((error) => {
          if (!disposed && ticket === generation) {
            setError(error instanceof Error ? error.message : '模型加载失败');
            element.dataset.renderStatus = 'error';
          }
        });
    };
    const animate = () => {
      if (disposed) return;
      if (atlas?.animate(performance.now())) {
        element.dataset.renderAnimationFrame = String(++animationFrame);
        data.draw();
      }
      animationTimer = window.setTimeout(animate, 50);
    };
    if (props.assets) {
      setError('');
      element.dataset.renderStatus = 'loading';
      void ProjectionAtlas.create(props.assets)
        .then((value) => {
          if (disposed) {
            value.dispose();
            return;
          }
          atlas = value;
          library = new BlockMeshLibrary(props.assets!, atlas);
          data.rebuild();
          animate();
        })
        .catch((error) => {
          if (!disposed) {
            setError(error instanceof Error ? error.message : '贴图加载失败');
            element.dataset.renderStatus = 'error';
          }
        });
    }
    const resize = () => {
      const rect = element.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height));
      const aspect = rect.width / Math.max(1, rect.height);
      if (data.camera instanceof THREE.PerspectiveCamera) data.camera.aspect = aspect;
      else {
        const half = (data.camera.top - data.camera.bottom) / 2;
        data.camera.left = -half * aspect;
        data.camera.right = half * aspect;
      }
      data.camera.updateProjectionMatrix();
      data.draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    controls.addEventListener('change', data.draw);
    const ray = new THREE.Raycaster(),
      mouse = new THREE.Vector2();
    const pick = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(mouse, data.camera);
      const hit = ray.intersectObjects(data.meshes, false)[0];
      return hit ? pickedBlock(hit) : undefined;
    };
    let down: { x: number; y: number; add: boolean; box: boolean } | undefined;
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const rect = element.getBoundingClientRect();
      down = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        add: event.ctrlKey || event.shiftKey,
        box: current.current.mode === 'box',
      };
      if (down.box) {
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
        setRectangle({ x: down.x, y: down.y, width: 0, height: 0 });
      }
    };
    const pointerMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      if (down?.box) {
        const x = event.clientX - rect.left,
          y = event.clientY - rect.top;
        setRectangle({
          x: Math.min(x, down.x),
          y: Math.min(y, down.y),
          width: Math.abs(x - down.x),
          height: Math.abs(y - down.y),
        });
      } else if (!down) current.current.onHover(pick(event));
    };
    const pointerUp = (event: PointerEvent) => {
      if (!down) return;
      const start = down;
      down = undefined;
      const rect = element.getBoundingClientRect(),
        x = event.clientX - rect.left,
        y = event.clientY - rect.top,
        p = current.current;
      if (start.box) {
        const found: number[] = [],
          v = new THREE.Vector3();
        for (const id of data.ids) {
          const [bx, by, bz] = coordinates(id, p.doc.dimensions);
          v.set(bx + 0.5, by * (1 + p.spacing) + 0.5, bz + 0.5).project(data.camera);
          const sx = ((v.x + 1) * rect.width) / 2,
            sy = ((1 - v.y) * rect.height) / 2;
          if (
            v.z >= -1 &&
            v.z <= 1 &&
            sx >= Math.min(x, start.x) &&
            sx <= Math.max(x, start.x) &&
            sy >= Math.min(y, start.y) &&
            sy <= Math.max(y, start.y)
          )
            found.push(id);
        }
        p.onBox(found, start.add);
        setRectangle(undefined);
        controls.enabled = current.current.mode !== 'box';
      } else if (Math.hypot(x - start.x, y - start.y) < 5 && p.mode !== 'orbit') {
        const id = pick(event);
        if (id !== undefined) p.onPick(id, start.add);
      }
    };
    const cancel = () => {
      down = undefined;
      setRectangle(undefined);
      controls.enabled = current.current.mode !== 'box';
    };
    const elementCanvas = renderer.domElement;
    elementCanvas.addEventListener('pointerdown', pointerDown);
    elementCanvas.addEventListener('pointermove', pointerMove);
    elementCanvas.addEventListener('pointerup', pointerUp);
    elementCanvas.addEventListener('pointercancel', cancel);
    elementCanvas.addEventListener('pointerleave', () => current.current.onHover(undefined));
    data.rebuild();
    resize();
    if (saved) {
      controls.update();
      data.draw();
    } else fit();
    props.onReady({
      fit: () => fit(),
      view: fit,
      capture: () => {
        if (!renderReady) throw new Error('模型仍在加载');
        data.draw();
        return renderer.domElement.toDataURL('image/png');
      },
    });
    return () => {
      previousView.current = {
        id: props.doc.id,
        camera: data.camera.clone(),
        target: data.controls.target.clone(),
      };
      disposed = true;
      generation++;
      clearTimeout(animationTimer);
      clearWorld();
      for (const material of materials.values()) material.dispose();
      atlas?.dispose();
      props.onReady(undefined);
      sceneRef.current = undefined;
      observer.disconnect();
      controls.dispose();
      disposeGroup();
      renderer.dispose();
      renderer.forceContextLoss();
      elementCanvas.remove();
    };
  }, [props.active, props.doc.id, props.assets]);
  useEffect(() => {
    sceneRef.current?.rebuild();
  }, [props.doc.revision, props.hidden, props.layerMin, props.layerMax, props.spacing]);
  useEffect(() => {
    sceneRef.current?.decorate();
  }, [props.selected, props.grid, props.measure]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.controls.enabled = props.mode !== 'box';
  }, [props.mode]);
  return (
    <div className="projection-viewport" ref={host}>
      {error && <p className="projection-error">{error}</p>}
      {rectangle && (
        <div
          className="projection-selection-box"
          style={{
            left: rectangle.x,
            top: rectangle.y,
            width: rectangle.width,
            height: rectangle.height,
          }}
        />
      )}
    </div>
  );
}
