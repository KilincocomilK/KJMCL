import { expect, it } from 'vitest';
import { catalogQuery, matchesSearch } from '../shared/search';

it('matches bilingual names, mixed scripts and versions across fields', () => {
  expect(matchesSearch('钠', 'sodium-fabric-0.6.13.jar')).toBe(true);
  expect(matchesSearch('ＳＯＤＩＵＭ 钠0.6.13', '钠', '0.6.13')).toBe(true);
  expect(matchesSearch('地毯GUI', 'CarpetGUI')).toBe(true);
  expect(matchesSearch('世界 fixture', 'Fixture', '测试世界')).toBe(true);
  expect(matchesSearch('村庄 village', '村庄')).toBe(true);
  expect(matchesSearch('unknown中文', '中文', 'unknown')).toBe(true);
  expect(matchesSearch('钠1.21', 'sodium', '1.20.1')).toBe(false);
  expect(matchesSearch('???', 'nothing here')).toBe(false);
});
it('uses catalog names, keeps unknown text and avoids sending duplicate names or active filters', () => {
  expect(catalogQuery('鈉Sodium Fabric 1.21.1', ['fabric', '1.21.1'])).toBe('sodium');
  expect(catalogQuery('机械动力扩展')).toBe('create extra');
  expect(catalogQuery('钠扩展')).toBe('sodium extra');
  expect(catalogQuery('3D 皮肤层')).toBe('3d skin layers');
  expect(catalogQuery('未收录的名称 ABC')).toBe('未收录的名称 ABC');
  expect(catalogQuery('new-project A+B')).toBe('new-project A+B');
});
