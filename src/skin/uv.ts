import type { SkinFace, SkinModel, SkinPart, SkinSurface } from '../../shared/skin';
function cube(
  part: SkinPart,
  surface: SkinSurface,
  x: number,
  y: number,
  width: number,
  height: number,
  depth: number,
): SkinFace[] {
  return [
    { face: 'top', x: x + depth, y, width, height: depth },
    { face: 'bottom', x: x + depth + width, y, width, height: depth },
    { face: 'right', x, y: y + depth, width: depth, height },
    { face: 'front', x: x + depth, y: y + depth, width, height },
    { face: 'left', x: x + depth + width, y: y + depth, width: depth, height },
    { face: 'back', x: x + 2 * depth + width, y: y + depth, width, height },
  ].map((f) => ({ ...f, part, surface }) as SkinFace);
}
export function skinFaces(model: SkinModel, resolution = 64): SkinFace[] {
  const arm = model === 'slim' ? 3 : 4;
  return [
    ...cube('head', 'base', 0, 0, 8, 8, 8),
    ...cube('head', 'outer', 32, 0, 8, 8, 8),
    ...cube('body', 'base', 16, 16, 8, 12, 4),
    ...cube('body', 'outer', 16, 32, 8, 12, 4),
    ...cube('rightArm', 'base', 40, 16, arm, 12, 4),
    ...cube('rightArm', 'outer', 40, 32, arm, 12, 4),
    ...cube('leftArm', 'base', 32, 48, arm, 12, 4),
    ...cube('leftArm', 'outer', 48, 48, arm, 12, 4),
    ...cube('rightLeg', 'base', 0, 16, 4, 12, 4),
    ...cube('rightLeg', 'outer', 0, 32, 4, 12, 4),
    ...cube('leftLeg', 'base', 16, 48, 4, 12, 4),
    ...cube('leftLeg', 'outer', 0, 48, 4, 12, 4),
  ].map((f) => ({
    ...f,
    x: (f.x * resolution) / 64,
    y: (f.y * resolution) / 64,
    width: (f.width * resolution) / 64,
    height: (f.height * resolution) / 64,
  }));
}
export function faceAt(x: number, y: number, model: SkinModel, resolution = 64) {
  return skinFaces(model, resolution).find(
    (f) => x >= f.x && y >= f.y && x < f.x + f.width && y < f.y + f.height,
  );
}
export function mirroredPixel(x: number, y: number, model: SkinModel, resolution = 64) {
  const face = faceAt(x, y, model, resolution);
  if (!face) return { x: resolution - 1 - x, y };
  const parts: Partial<Record<SkinPart, SkinPart>> = {
    rightArm: 'leftArm',
    leftArm: 'rightArm',
    rightLeg: 'leftLeg',
    leftLeg: 'rightLeg',
  };
  const target = skinFaces(model, resolution).find(
    (f) =>
      f.part === (parts[face.part] ?? face.part) &&
      f.surface === face.surface &&
      f.face === (face.face === 'left' ? 'right' : face.face === 'right' ? 'left' : face.face),
  )!;
  return { x: target.x + target.width - 1 - (x - face.x), y: target.y + y - face.y };
}

/** Pixel adjacency across an unfolded cuboid, including edges between separate UV islands. */
export function surfaceTopology(
  model: SkinModel,
  resolution: number,
  part: SkinPart,
  surface: SkinSurface,
) {
  const faces = skinFaces(model, resolution).filter(
    (f) => f.part === part && f.surface === surface,
  );
  const front = faces.find((f) => f.face === 'front')!,
    top = faces.find((f) => f.face === 'top')!;
  const w = front.width,
    h = front.height,
    d = top.height;
  const point = (face: SkinFace['face'], u: number, v: number) => {
    switch (face) {
      case 'front':
        return [u, v, d];
      case 'back':
        return [w - u, v, 0];
      case 'right':
        return [0, v, u];
      case 'left':
        return [w, v, d - u];
      case 'top':
        return [u, 0, v];
      case 'bottom':
        return [u, h, d - v];
    }
  };
  const edges = new Map<string, number>(),
    neighbors = new Map<number, number[]>();
  for (const f of faces)
    for (let y = 0; y < f.height; y++)
      for (let x = 0; x < f.width; x++) {
        const pixel = (f.y + y) * resolution + f.x + x;
        neighbors.set(pixel, []);
        const corners = [
          point(f.face, x, y),
          point(f.face, x + 1, y),
          point(f.face, x + 1, y + 1),
          point(f.face, x, y + 1),
        ];
        for (let edge = 0; edge < 4; edge++) {
          const key = [corners[edge].join(','), corners[(edge + 1) % 4].join(',')].sort().join('|');
          const other = edges.get(key);
          if (other === undefined) edges.set(key, pixel);
          else {
            neighbors.get(pixel)!.push(other);
            neighbors.get(other)!.push(pixel);
          }
        }
      }
  return neighbors;
}
