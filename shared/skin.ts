export type SkinResolution = 64 | 128 | 256;
export type SkinModel = 'classic' | 'slim';
export type SkinBlend =
  | 'normal'
  | 'add'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'colorDodge'
  | 'colorBurn'
  | 'hardLight'
  | 'softLight'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';
export type SkinPart = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';
export type SkinSurface = 'base' | 'outer';
export type SkinFaceName = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back';
export interface SkinFace {
  part: SkinPart;
  surface: SkinSurface;
  face: SkinFaceName;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface SkinLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: SkinBlend;
  pixels: string;
  alphaLock?: boolean;
}
export interface SkinProject {
  workspace?: import('./skin-workspace').SkinWorkspace;
  schemaVersion: 1;
  name: string;
  resolution: SkinResolution;
  model: SkinModel;
  layers: SkinLayer[];
  activeLayerId: string;
  palette: string[];
}
export interface SkinImportImage {
  name: string;
  width: number;
  height: number;
  pixels: string;
}
export type SkinTool =
  | 'pencil'
  | 'eraser'
  | 'eyedropper'
  | 'fill'
  | 'replace'
  | 'line'
  | 'rectangle'
  | 'ellipse'
  | 'gradient'
  | 'noise'
  | 'lighten'
  | 'darken'
  | 'clone'
  | 'sculpt'
  | 'stamp';
export type RGBA = [number, number, number, number];
export interface SkinPoint {
  x: number;
  y: number;
}
export interface SkinBrush {
  tool: SkinTool;
  color: RGBA;
  secondary: RGBA;
  size: number;
  opacity: number;
  hardness: number;
  shape: 'square' | 'circle';
  mirror: 'none' | 'texture' | 'body' | 'faceX' | 'faceY' | 'faceXY';
  tolerance: number;
  filled: boolean;
  contiguous: boolean;
  sampleMerged: boolean;
  clipFace: boolean;
  dither: boolean;
  fillScope: 'face' | 'part' | 'texture';
  sculptMode: 'raise' | 'lower';
  stampScale: number;
  stampRotation: 0 | 90 | 180 | 270;
  stampFlipX: boolean;
  stampFlipY: boolean;
  gradientSteps: number;
  preserveAlpha: boolean;
  noiseStrength: number;
  noiseSeed: number;
  noisePalette: boolean;
}
