import type { ProjectionBlock, ProjectionDocument } from '../../shared/projection';
export type Point = [number, number, number];
export const isAir = (block?: ProjectionBlock) =>
  !block || ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(block.name);
export function decodeBlocks(doc: ProjectionDocument) {
  const raw = atob(doc.blocks),
    volume = doc.dimensions.reduce((a, b) => a * b, 1);
  if (raw.length !== volume * 4) throw new Error('投影方块数据不完整');
  const out = new Uint32Array(volume);
  for (let i = 0; i < volume; i++)
    out[i] =
      (raw.charCodeAt(i * 4) |
        (raw.charCodeAt(i * 4 + 1) << 8) |
        (raw.charCodeAt(i * 4 + 2) << 16) |
        (raw.charCodeAt(i * 4 + 3) << 24)) >>>
      0;
  return out;
}
export function coordinates(index: number, size: Point): Point {
  return [
    index % size[0],
    Math.floor(index / (size[0] * size[2])),
    Math.floor(index / size[0]) % size[2],
  ];
}
export function blockIndex([x, y, z]: Point, [width, , depth]: Point) {
  return (y * depth + z) * width + x;
}
export function distance(a: Point, b: Point) {
  return Math.hypot(...a.map((v, i) => v - b[i]));
}
export function blockState(block: ProjectionBlock) {
  const properties = Object.entries(block.properties ?? {});
  return (
    block.name +
    (properties.length ? '[' + properties.map(([k, v]) => k + '=' + v).join(',') + ']' : '')
  );
}
export function parseBlock(text: string): ProjectionBlock {
  const match = /^([a-z0-9_.-]+:[a-z0-9_./-]+)(?:\[([^\]]+)\])?$/.exec(text.trim());
  if (!match) throw new Error('方块格式：minecraft:stone 或 minecraft:oak_log[axis=y]');
  const properties: Record<string, string> = {};
  for (const item of match[2]?.split(',') ?? []) {
    const pair = /^([a-z0-9_]+)=([a-z0-9_]+)$/.exec(item.trim());
    if (!pair || pair[1] in properties) throw new Error('方块属性格式有误');
    properties[pair[1]] = pair[2];
  }
  return { name: match[1], ...(match[2] ? { properties } : {}) };
}
const labels: Record<string, string> = {
  air: '空气',
  stone: '石头',
  cobblestone: '圆石',
  dirt: '泥土',
  grass_block: '草方块',
  glass: '玻璃',
  water: '水',
  lava: '熔岩',
  sand: '沙子',
  oak_log: '橡木原木',
  oak_planks: '橡木木板',
  oak_leaves: '橡树树叶',
  white_wool: '白色羊毛',
  redstone_block: '红石块',
  redstone_wire: '红石粉',
  iron_block: '铁块',
  gold_block: '金块',
  diamond_block: '钻石块',
  observer: '侦测器',
  piston: '活塞',
  sticky_piston: '黏性活塞',
  hopper: '漏斗',
  chest: '箱子',
  barrel: '木桶',
  furnace: '熔炉',
  stone_bricks: '石砖',
  smooth_stone: '平滑石',
  torch: '火把',
  rail: '铁轨',
  slime_block: '黏液块',
  honey_block: '蜂蜜块',
};
export const blockName = (block?: ProjectionBlock) =>
  block
    ? (labels[block.name.replace('minecraft:', '')] ?? block.name.replace('minecraft:', ''))
    : '未选择';
export function blockColor(name: string) {
  const colors: Record<string, number> = {
    white: 0xe8e7e3,
    orange: 0xda7b25,
    magenta: 0xb549bb,
    light_blue: 0x6aafd0,
    yellow: 0xe2c249,
    lime: 0x8bbd36,
    pink: 0xd990ab,
    gray: 0x555b5d,
    light_gray: 0xa4a5a0,
    cyan: 0x287f93,
    purple: 0x7643a5,
    blue: 0x3f52ac,
    brown: 0x765239,
    green: 0x597935,
    red: 0xb83e35,
    black: 0x292b31,
  };
  for (const [part, color] of Object.entries(colors).sort((a, b) => b[0].length - a[0].length))
    if (name.startsWith('minecraft:' + part + '_')) return color;
  if (/glass|ice|diamond/.test(name)) return 0x8acacf;
  if (/water/.test(name)) return 0x3c6dcc;
  if (/lava|fire/.test(name)) return 0xe87c26;
  if (/grass|leaves|slime|moss/.test(name)) return 0x75a84f;
  if (/dirt|mud|soul/.test(name)) return 0x81604b;
  if (/sand|birch/.test(name)) return 0xd8c58f;
  if (/gold|honey/.test(name)) return 0xdbaf4b;
  if (/wood|planks|log|chest|barrel/.test(name)) return 0xac8350;
  if (/iron|quartz/.test(name)) return 0xc7cac9;
  if (/stone|ore|deepslate|furnace|observer|piston|hopper/.test(name)) return 0x8d9292;
  let hash = 0;
  for (const c of name) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
  return (
    ((100 + ((hash >>> 16) % 100)) << 16) |
    ((100 + ((hash >>> 8) % 100)) << 8) |
    (100 + ((hash >>> 0) % 100))
  );
}
