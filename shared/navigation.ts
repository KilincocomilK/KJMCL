export const DEFAULT_SIDEBAR_ORDER = [
  'instances',
  'resources',
  'toolbox',
  'assistant',
  'saves',
  'multiplayer',
  'diagnostics',
  'downloads',
] as const;

export type SidebarEntry = (typeof DEFAULT_SIDEBAR_ORDER)[number];
