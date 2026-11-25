import { seedBiomeLabels, seedStructureLabels } from './seed-labels';

// The first spelling is the query understood by the online catalogs. All spellings work locally.
const names = [
  ['sodium', '钠', '鈉'],
  ['sodium extra', '钠扩展', '钠扩充', '鈉擴充'],
  ['reeses sodium options', '钠选项', '钠视频设置'],
  ['lithium', '锂', '鋰'],
  ['phosphor', '磷'],
  ['indium', '铟', '銦'],
  ['iris', '虹彩', '鸢尾', '鳶尾', '彩虹光影'],
  ['optifine', '高清修复', '高清修復'],
  ['fabric api', 'fabric接口', '织物接口'],
  ['mod menu', '模组菜单', '模組選單'],
  ['cloth config', '布料配置'],
  ['architectury', '架构', '架構'],
  ['ferritecore', '铁氧体磁芯', '铁氧体核心'],
  ['immediatelyfast', '极速渲染'],
  ['entity culling', '实体渲染机制优化', '实体剔除'],
  ['modernfix', '现代化修复'],
  ['dynamic fps', '动态帧率'],
  ['starlight', '星光'],
  ['embeddium', '镁', '鎂'],
  ['rubidium', '铷', '銣'],
  ['litematica', '投影模组', '投影'],
  ['malilib', 'masa前置'],
  ['minihud', '迷你hud'],
  ['tweakeroo', '灵活放置'],
  ['carpet', '地毯'],
  ['carpetgui', '地毯gui'],
  ['worldedit', '创世神', '創世神'],
  ['axiom', '公理'],
  ['create', '机械动力', '機械動力'],
  ['farmers delight', '农夫乐事', '农夫乐事模组'],
  ['applied energistics 2', '应用能源2', '应用能源', 'ae2'],
  ['mekanism', '通用机械'],
  ['botania', '植物魔法'],
  ['twilight forest', '暮色森林'],
  ['tinkers construct', '匠魂'],
  ['immersive engineering', '沉浸工程'],
  ['industrial craft', '工业时代'],
  ['biomes o plenty', '超多生物群系'],
  ['just enough items', 'jei', '物品管理器'],
  ['roughly enough items', 'rei', '粗略物品管理器'],
  ['journeymap', '旅行地图', '旅行地圖'],
  ['xaeros minimap', 'xaero的小地图', 'xaero小地图'],
  ['xaeros world map', 'xaero的世界地图'],
  ['waystones', '传送石碑', '传送石'],
  ['jade', '玉'],
  ['appleskin', '苹果皮', '蘋果皮'],
  ['replaymod', 'replay mod', '录像回放', '回放模组'],
  ['distant horizons', '遥远的地平线', '遥远地平线'],
  ['betterf3', '更好的f3', '更好的F3界面'],
  ['3d skin layers', 'skinlayers3d', '3d皮肤层'],
  ['smoothgui', '平滑界面'],
  ['mouse tweaks', '鼠标手势'],
  ['inventory profiles next', '一键背包整理'],
  ['fallingtree', '一键砍树'],
  ['natures compass', '自然罗盘'],
  ['simple voice chat', '简单语音聊天'],
  ['complementary', '互补光影', '互补'],
  ['reimagined', '重制版'],
  ['unbound', '解绑版'],
  ['bsl', 'bsl光影'],
  ['seus', 'seus光影'],
  ['sildurs', '希尔杜光影'],
  ['faithful', '忠实材质', '忠实'],
  ['fresh animations', '新生动画', '生动动画'],
  ['bare bones', '简约材质'],
  ['vanilla tweaks', '原版微调'],
  ['better leaves', '更好的树叶'],
  ['skyfactory', '天空工厂', '空岛工厂'],
  ['all the mods', 'atm', '全模组'],
  ['better mc', '更好的mc'],
  ['stoneblock', '石头世界'],
  ['vault hunters', '宝藏猎人'],
  ['minecraft', '我的世界'],
  ['vanilla', '原版'],
  ['snapshot', '快照'],
  ['release', '正式版'],
  ['mod', '模组', '模組'],
  ['extra', '扩展', '擴展'],
  ['items', '物品'],
  ['survival', '生存'],
  ['creative', '创造'],
  ['hardcore', '极限'],
  ['adventure', '冒险'],
  ['overworld', '主世界'],
  ['nether', '下界'],
  ['shader', '光影'],
  ['resourcepack', '资源包', '材质包'],
  ['stone', '石头'],
  ['cobblestone', '圆石'],
  ['oak planks', '橡木木板'],
  ['oak log', '橡木原木'],
  ['grass block', '草方块'],
  ['dirt', '泥土'],
  ['glass', '玻璃'],
  ['water', '水'],
  ['lava', '熔岩', '岩浆'],
  ['redstone', '红石'],
  ['diamond', '钻石'],
  ['iron', '铁'],
  ['gold', '金'],
  ['copper', '铜'],
  ['error', '错误'],
  ['warning', 'warn', '警告'],
  ['exception', '异常'],
  ['crash', '崩溃'],
  ['deepseek', '深度求索'],
  ['qwen', '通义千问', '千问'],
  ['doubao', '豆包'],
  ['gemini', '双子座'],
  ...Object.entries({ ...seedBiomeLabels, ...seedStructureLabels }).map(([id, label]) => [
    id.replaceAll('_', ' '),
    label,
  ]),
];

const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[’']/g, '');
const compact = (value: string) => value.replace(/[\s_-]+/g, '');
const bySpelling = new Map<string, string[]>();
for (const group of names) {
  for (const spelling of group) {
    const key = compact(normalize(spelling));
    const existing = bySpelling.get(key) ?? [];
    bySpelling.set(key, [...new Set([...existing, ...group.map(normalize)])]);
  }
}
const escaped = (word: string) => word.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
const patterns = [...new Set(names.flat().map(normalize))]
  .sort((a, b) => compact(b).length - compact(a).length)
  .map((word) => {
    const pattern = word
      .replace(/(?<=\p{Script=Han})(?=[a-z0-9])|(?<=[a-z0-9])(?=\p{Script=Han})/gu, ' ')
      .split(/[\s_-]+/)
      .map(escaped)
      .join('[\\s_-]*');
    return (
      (/^[a-z0-9]/.test(word) ? '(?<![a-z0-9])' : '') +
      pattern +
      (/[a-z0-9]$/.test(word) ? '(?![a-z0-9])' : '')
    );
  });
const words = new RegExp(patterns.join('|'), 'gu');
type Term = { text: string; aliases: string[] };
const compiled = new Map<string, Term[]>();
function terms(query: string) {
  const input = normalize(query).trim();
  const cached = compiled.get(input);
  if (cached) return cached;
  const result: Term[] = [];
  const literal = (part: string) => {
    for (const text of part.match(
      /\p{Script=Han}+|[\p{Script=Latin}\p{N}]+(?:\.[\p{Script=Latin}\p{N}]+)*|\p{L}+/gu,
    ) ?? [])
      result.push({ text, aliases: [text] });
  };
  let end = 0;
  for (const match of input.matchAll(words)) {
    literal(input.slice(end, match.index));
    result.push({ text: match[0], aliases: bySpelling.get(compact(match[0]))! });
    end = match.index + match[0].length;
  }
  literal(input.slice(end));
  if (compiled.size >= 64) compiled.delete(compiled.keys().next().value!);
  compiled.set(input, result);
  return result;
}

export function matchesSearch(query: string, ...fields: (string | number | undefined)[]) {
  if (!query.trim()) return true;
  const text = normalize(fields.filter((f) => f !== undefined).join(' '));
  if (text.includes(normalize(query).trim())) return true;
  const tokens = terms(query);
  const search = compact(text);
  return (
    tokens.length > 0 &&
    tokens.every((token) => token.aliases.some((a) => search.includes(compact(a))))
  );
}

export function catalogQuery(query: string, filters: string[] = []) {
  const input = query.normalize('NFKC').trim();
  if (!/\p{Script=Han}/u.test(input)) return input;
  const parts = terms(input);
  if (!parts.some((term) => term.aliases.length > 1)) return input;
  const translated = [...new Set(parts.map((term) => term.aliases[0]))];
  const filtered = translated.filter((term) => !filters.includes(term));
  return (filtered.length ? filtered : translated).join(' ');
}
