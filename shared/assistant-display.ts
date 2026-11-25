import type { AiChange, SettingValue } from './assistant';
export const changeLabels: Record<AiChange['status'], string> = {
  pending: '待确认',
  applied: '已应用',
  rejected: '已拒绝',
  expired: '已过期',
  undone: '已撤销',
  stale: '设置已变化',
};
const values: Record<string, string> = {
  true: '开启',
  false: '关闭',
  official: '官方',
  bmclapi: 'BMCLAPI',
  manual: '手动',
  auto: '自动',
  g1: 'G1',
  zgc: 'ZGC',
};
export const settingText = (value: SettingValue) => values[String(value)] ?? String(value);
