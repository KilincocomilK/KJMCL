import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { skinFaces } from '../src/skin/uv';
import { createSkinFaceGeometry } from '../src/skin/SkinViewport';
import {
  atlasPixel,
  faceQuad,
  quadPoint,
  screenSamples,
  texturePixel,
  zoomAtlas,
  poseRotation,
  animationTimes,
  opaqueSkinPixels,
} from '../src/skin/view-math';
import type { SkinFaceName, SkinModel } from '../shared/skin';

describe('skin UV picking and real mesh geometry', () => {
  const normals: Record<SkinFaceName, [number, number, number]> = {
    front: [0, 0, 1],
    back: [0, 0, -1],
    right: [-1, 0, 0],
    left: [1, 0, 0],
    top: [0, 1, 0],
    bottom: [0, -1, 0],
  };
  it.each(['classic', 'slim'] as SkinModel[])(
    'maps every %s cuboid face through Three ray intersections',
    (model) => {
      const material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
      for (const resolution of [64, 128, 256]) {
        for (const face of skinFaces(model, resolution)) {
          const dims: [number, number, number] =
            face.part === 'head'
              ? [8, 8, 8]
              : face.part === 'body'
                ? [8, 12, 4]
                : [face.part.endsWith('Arm') && model === 'slim' ? 3 : 4, 12, 4];
          const quad = faceQuad(face.face, ...dims);
          const geometry = createSkinFaceGeometry(quad, face, resolution);
          const mesh = new THREE.Mesh(geometry, material);
          mesh.updateMatrixWorld();
          const normal = new THREE.Vector3(...normals[face.face]);
          const gNormal = new THREE.Vector3().fromBufferAttribute(
            geometry.getAttribute('normal'),
            0,
          );
          expect(gNormal.dot(normal)).toBeCloseTo(1);
          // Interior sample in the first texel, avoiding edge rounding and either triangle's diagonal.
          const u = 0.35 / face.width,
            v = 0.65 / face.height;
          const point = new THREE.Vector3(...quadPoint(quad, u, v));
          const raycaster = new THREE.Raycaster(
            point.clone().addScaledVector(normal, 20),
            normal.clone().negate(),
          );
          const hit = raycaster.intersectObject(mesh)[0];
          expect(hit?.uv, `${model} ${face.part} ${face.surface} ${face.face}`).toBeDefined();
          expect(texturePixel(hit.uv!.x, hit.uv!.y, resolution, face)).toMatchObject({
            x: face.x,
            y: face.y,
          });
          const point2 = new THREE.Vector3(...quadPoint(quad, 1 - u, 1 - v));
          raycaster.set(point2.clone().addScaledVector(normal, 20), normal.clone().negate());
          const last = raycaster.intersectObject(mesh)[0];
          expect(texturePixel(last.uv!.x, last.uv!.y, resolution, face)).toMatchObject({
            x: face.x + face.width - 1,
            y: face.y + face.height - 1,
          });
          geometry.dispose();
        }
      }
      material.dispose();
    },
  );
  it('clamps exact UV seams to their hit face, never a neighboring body part', () => {
    const face = skinFaces('slim').find(
      (f) => f.part === 'rightArm' && f.face === 'front' && f.surface === 'base',
    )!;
    expect(
      texturePixel((face.x + face.width) / 64, 1 - (face.y + face.height) / 64, 64, face),
    ).toMatchObject({ x: face.x + face.width - 1, y: face.y + face.height - 1 });
    expect(texturePixel(-0.01, 1.01, 64, face)).toMatchObject({ x: face.x, y: face.y });
  });
});
describe('pixel-accurate atlas interaction', () => {
  it('keeps the cursor anchor fixed during wheel zoom and bounds zoom', () => {
    const initial = { x: 30, y: -20, scale: 4 };
    const before = atlasPixel(101, 111, initial, 64);
    const zoomed = zoomAtlas(initial, 101, 111, 2);
    expect(atlasPixel(101, 111, zoomed, 64)).toEqual(before);
    expect(zoomAtlas(initial, 0, 0, 100000).scale).toBe(96);
    expect(zoomAtlas(initial, 0, 0, 0.00001).scale).toBe(0.25);
    expect(atlasPixel(29, 0, initial, 64)).toBeNull();
    expect(atlasPixel(286, 0, initial, 64)).toBeNull();
  });
  it('interpolates fast pointer moves by screen pixel without dropping the last position', () => {
    const samples = screenSamples({ x: 0, y: 2 }, { x: 450, y: 72 });
    expect(samples).toHaveLength(450);
    expect(samples.at(-1)).toEqual({ x: 450, y: 72 });
    for (let i = 1; i < samples.length; i++)
      expect(Math.abs(samples[i].x - samples[i - 1].x)).toBeLessThanOrEqual(1.00001);
    expect(screenSamples({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([{ x: 1, y: 1 }]);
  });
});

describe('custom poses and deterministic animation', () => {
  it('renders the game base opaque without changing the source or outer-layer alpha', () => {
    const original = new Uint8ClampedArray([18, 29, 40, 0, 80, 90, 100, 80]);
    expect([...opaqueSkinPixels(original)]).toEqual([18, 29, 40, 255, 80, 90, 100, 255]);
    expect([...original]).toEqual([18, 29, 40, 0, 80, 90, 100, 80]);
  });
  it('adds limb angles after the preset, preserving opposite walking arms', () => {
    expect(poseRotation('head', 'stand', 0, false, { head: { x: 45, y: 90, z: -30 } })).toEqual([
      Math.PI / 4,
      Math.PI / 2,
      -Math.PI / 6,
    ]);
    expect(poseRotation('rightLeg', 'sit', 0, false, { rightLeg: { x: 90, y: 0, z: 0 } })).toEqual([
      0, 0, 0,
    ]);
    const right = poseRotation('rightArm', 'walk', 230, true),
      left = poseRotation('leftArm', 'walk', 230, true);
    expect(right[0]).toBeCloseTo(-left[0]);
    expect(poseRotation('rightArm', 'walk', 0, false)).toEqual(
      poseRotation('rightArm', 'walk', 90000, false),
    );
  });
  it('raycasts transformed limbs to their original texture pixel', () => {
    const face = skinFaces('slim', 128).find(
      (f) => f.part === 'rightArm' && f.surface === 'base' && f.face === 'front',
    )!;
    const quad = faceQuad('front', 3, 12, 4),
      geometry = createSkinFaceGeometry(quad, face, 128);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    const group = new THREE.Group();
    group.position.set(-5.5, 24, 0);
    group.rotation.set(
      ...poseRotation('rightArm', 'armsUp', 0, false, { rightArm: { x: 55, y: 35, z: 12 } }),
    );
    group.add(mesh);
    group.updateMatrixWorld(true);
    const local = new THREE.Vector3(...quadPoint(quad, 0.25 / face.width, 0.5 / face.height));
    const point = mesh.localToWorld(local),
      normal = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
    const raycaster = new THREE.Raycaster(
      point.clone().addScaledVector(normal, 10),
      normal.negate(),
    );
    const result = raycaster.intersectObject(mesh)[0];
    expect(texturePixel(result.uv!.x, result.uv!.y, 128, face)).toMatchObject({
      x: face.x,
      y: face.y,
    });
    geometry.dispose();
    mesh.material.dispose();
  });
  it('generates deterministic time samples and rejects oversized exports', () => {
    expect(animationTimes({ frames: 4, seconds: 2, size: 128 })).toEqual([0, 500, 1000, 1500]);
    expect(() => animationTimes({ frames: 120, seconds: 2, size: 1024 })).toThrow('超限');
    expect(() => animationTimes({ frames: 1, seconds: 2, size: 128 })).toThrow('超限');
    expect(() => animationTimes({ frames: 4, seconds: NaN, size: 128 })).toThrow('超限');
  });
});
