import type { RGBA, SkinBlend, SkinPart, SkinTool } from '../../shared/skin';
export const partLabels: Record<SkinPart, string> = {
  head: '头部',
  body: '身体',
  rightArm: '右臂',
  leftArm: '左臂',
  rightLeg: '右腿',
  leftLeg: '左腿',
};
export const tools: {
  id: SkinTool | 'select' | 'wand' | 'lasso' | 'move';
  label: string;
  key: string;
}[] = [
  { id: 'pencil', label: '画笔', key: 'B' },
  { id: 'eraser', label: '橡皮', key: 'E' },
  { id: 'eyedropper', label: '吸管', key: 'I' },
  { id: 'fill', label: '填充', key: 'G' },
  { id: 'replace', label: '替色', key: 'R' },
  { id: 'line', label: '直线', key: 'L' },
  { id: 'rectangle', label: '矩形', key: 'U' },
  { id: 'ellipse', label: '椭圆', key: 'O' },
  { id: 'gradient', label: '渐变', key: 'D' },
  { id: 'noise', label: '噪点', key: 'N' },
  { id: 'lighten', label: '减淡', key: 'J' },
  { id: 'darken', label: '加深', key: 'K' },
  { id: 'clone', label: '克隆', key: 'S' },
  { id: 'select', label: '选框', key: 'M' },
  { id: 'wand', label: '魔棒', key: 'W' },
  { id: 'lasso', label: '套索', key: 'Q' },
  { id: 'move', label: '移动', key: 'V' },
  { id: 'sculpt', label: '雕刻', key: 'P' },
  { id: 'stamp', label: '印章', key: 'T' },
];
export const blendLabels: Record<SkinBlend, string> = {
  normal: '正常',
  multiply: '正片叠底',
  screen: '滤色',
  overlay: '叠加',
  add: '线性减淡',
  darken: '变暗',
  lighten: '变亮',
  colorDodge: '颜色减淡',
  colorBurn: '颜色加深',
  hardLight: '强光',
  softLight: '柔光',
  difference: '差值',
  exclusion: '排除',
  hue: '色相',
  saturation: '饱和度',
  color: '颜色',
  luminosity: '明度',
};
export const colorHex = (color: RGBA, alpha = false) =>
  '#' +
  color
    .slice(0, alpha ? 4 : 3)
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('');
export function parseColor(value: string): RGBA | null {
  const hex = value.replace(/^#/, '');
  if (!/^(?:[a-f\d]{6}|[a-f\d]{8})$/i.test(hex)) return null;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
    hex.length === 8 ? parseInt(hex.slice(6), 16) : 255,
  ];
}
