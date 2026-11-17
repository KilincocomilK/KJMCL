import type { SkinFace, SkinFaceName, SkinPart } from '../../shared/skin';

export interface SkinPoint {
  x: number;
  y: number;
  face?: SkinFace;
}
/** Minecraft's base surface is opaque even where an imported PNG stores alpha. */
export function opaqueSkinPixels(pixels: Uint8ClampedArray) {
  const result = pixels.slice();
  for (let offset = 3; offset < result.length; offset += 4) result[offset] = 255;
  return result;
}
export interface SkinPointerEvent extends SkinPoint {
  phase: 'start' | 'move' | 'end';
  pressure: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  source: '2d' | '3d';
  /** Continue the same undo stroke without interpolating across unrelated UV islands. */
  discontinuous?: boolean;
}
export type SkinView = 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export type SkinPose = 'stand' | 'walk' | 'run' | 'sit' | 'armsUp';
export type SkinPoseAngles = Partial<Record<SkinPart, { x: number; y: number; z: number }>>;
export interface SkinAnimationOptions {
  frames: number;
  seconds: number;
  size: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}
export function animationTimes(options: Pick<SkinAnimationOptions, 'frames' | 'seconds' | 'size'>) {
  if (
    !Number.isInteger(options.frames) ||
    options.frames < 2 ||
    options.frames > 120 ||
    !Number.isInteger(options.size) ||
    options.size < 64 ||
    options.size > 1024 ||
    !Number.isFinite(options.seconds) ||
    options.seconds < 0.2 ||
    options.seconds > 30 ||
    options.frames * options.size ** 2 * 4 > 128 * 1024 ** 2
  )
    throw new Error('动画参数超限，请减少帧数或尺寸');
  return Array.from(
    { length: options.frames },
    (_, index) => (options.seconds * 1000 * index) / options.frames,
  );
}
export function poseRotation(
  part: SkinPart,
  pose: SkinPose,
  time: number,
  animated: boolean,
  angles?: SkinPoseAngles,
): Vec3 {
  const rotation: Vec3 = [0, 0, 0];
  const swing =
    Math.sin((animated ? time / 1000 : 0.65) * (pose === 'run' ? 8 : 4)) *
    (pose === 'run' ? 0.9 : 0.5);
  if (pose === 'walk' || pose === 'run') {
    if (part === 'rightArm' || part === 'leftLeg') rotation[0] = swing;
    if (part === 'leftArm' || part === 'rightLeg') rotation[0] = -swing;
  } else if (pose === 'sit') {
    if (part.endsWith('Leg')) rotation[0] = -Math.PI / 2;
    if (part.endsWith('Arm')) rotation[0] = -0.2;
  } else if (pose === 'armsUp') {
    if (part === 'rightArm') rotation[2] = -2.8;
    if (part === 'leftArm') rotation[2] = 2.8;
  }
  for (const [index, axis] of (['x', 'y', 'z'] as const).entries()) {
    const value = angles?.[part]?.[axis] ?? 0;
    if (Number.isFinite(value))
      rotation[index] += (Math.max(-360, Math.min(360, value)) * Math.PI) / 180;
  }
  return rotation;
}
export const viewAngles: Record<SkinView, [number, number]> = {
  free: [-0.45, 0.18],
  front: [0, 0],
  back: [Math.PI, 0],
  left: [Math.PI / 2, 0],
  right: [-Math.PI / 2, 0],
  top: [0, Math.PI / 2 - 0.001],
  bottom: [0, -Math.PI / 2 + 0.001],
};
export type Vec3 = [number, number, number];
/** Top-left, top-right, bottom-right, bottom-left, viewed from outside the skin. */
export function faceQuad(face: SkinFaceName, width: number, height: number, depth: number): Vec3[] {
  const x = width / 2,
    y = height / 2,
    z = depth / 2;
  switch (face) {
    case 'front':
      return [
        [-x, y, z],
        [x, y, z],
        [x, -y, z],
        [-x, -y, z],
      ];
    case 'back':
      return [
        [x, y, -z],
        [-x, y, -z],
        [-x, -y, -z],
        [x, -y, -z],
      ];
    case 'right':
      return [
        [-x, y, -z],
        [-x, y, z],
        [-x, -y, z],
        [-x, -y, -z],
      ];
    case 'left':
      return [
        [x, y, z],
        [x, y, -z],
        [x, -y, -z],
        [x, -y, z],
      ];
    case 'top':
      return [
        [-x, y, -z],
        [x, y, -z],
        [x, y, z],
        [-x, y, z],
      ];
    case 'bottom':
      return [
        [-x, -y, z],
        [x, -y, z],
        [x, -y, -z],
        [-x, -y, -z],
      ];
  }
}
export function quadPoint(quad: Vec3[], u: number, v: number): Vec3 {
  return [0, 1, 2].map(
    (axis) =>
      quad[0][axis] + (quad[1][axis] - quad[0][axis]) * u + (quad[3][axis] - quad[0][axis]) * v,
  ) as Vec3;
}
export function texturePixel(u: number, v: number, resolution: number, face?: SkinFace): SkinPoint {
  const minX = face?.x ?? 0,
    minY = face?.y ?? 0;
  const maxX = face ? face.x + face.width - 1 : resolution - 1;
  const maxY = face ? face.y + face.height - 1 : resolution - 1;
  return {
    x: Math.max(minX, Math.min(maxX, Math.floor(u * resolution))),
    y: Math.max(minY, Math.min(maxY, Math.floor((1 - v) * resolution))),
    face,
  };
}
export interface AtlasTransform {
  x: number;
  y: number;
  scale: number;
}
export function atlasPixel(
  x: number,
  y: number,
  transform: AtlasTransform,
  resolution: number,
): SkinPoint | null {
  const px = Math.floor((x - transform.x) / transform.scale),
    py = Math.floor((y - transform.y) / transform.scale);
  return px >= 0 && py >= 0 && px < resolution && py < resolution ? { x: px, y: py } : null;
}
export function zoomAtlas(
  transform: AtlasTransform,
  x: number,
  y: number,
  factor: number,
): AtlasTransform {
  const scale = Math.min(96, Math.max(0.25, transform.scale * factor));
  return {
    x: x - ((x - transform.x) * scale) / transform.scale,
    y: y - ((y - transform.y) * scale) / transform.scale,
    scale,
  };
}
/** Sample each screen pixel to keep rapid 3D strokes continuous across cuboid seams. */
export function screenSamples(from: { x: number; y: number }, to: { x: number; y: number }) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))));
  return Array.from({ length: Math.min(steps, 8192) }, (_, i) => ({
    x: from.x + ((to.x - from.x) * (i + 1)) / Math.min(steps, 8192),
    y: from.y + ((to.y - from.y) * (i + 1)) / Math.min(steps, 8192),
  }));
}
