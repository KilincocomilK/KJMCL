const names: Record<string, string> = { overworld: '主世界', the_nether: '下界', the_end: '末地' };

export function worldDimensionName(id: string) {
  return names[id] ?? id;
}
