export const javaGuide = [
  { major: 25, games: '26.x' },
  { major: 21, games: '1.20.5 – 1.21.x' },
  { major: 17, games: '1.18 – 1.20.4' },
  { major: 16, games: '1.17.x' },
  { major: 8, games: '1.16.5 及更早' },
] as const;

export function welcomeJavaChoices(available: readonly { major: number }[], version?: string) {
  const installed = new Set(available.map((j) => j.major));
  const required =
    version && /^\d+\.\d+(?:\.\d+)?$/.test(version) ? requiredJava(version) : undefined;
  return javaGuide
    .map((entry) => ({
      ...entry,
      installed: installed.has(entry.major),
      matchesGame: entry.major === required,
    }))
    .sort(
      (a, b) =>
        Number(b.installed) - Number(a.installed) ||
        Number(b.matchesGame) - Number(a.matchesGame) ||
        b.major - a.major,
    );
}

export function requiredJava(version: string, metadata?: number) {
  if (metadata) return metadata;
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version);
  if (!m) return 8; // Snapshots and loader-specific requirements come from version metadata.
  const [, major, minor, patch] = m.map(Number);
  if (major === 26) return 25;
  if (major === 1 && (minor > 20 || (minor === 20 && (patch || 0) >= 5))) return 21;
  if (major === 1 && minor >= 18) return 17;
  if (major === 1 && minor === 17) return 16;
  return 8;
}
