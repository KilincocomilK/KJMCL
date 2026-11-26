// Public application identifier for KJMCL. Credentials are stored per player.
export const kjmclClientId = '51e6c11c-55ae-41e5-acda-e14a18324cbf';

export function microsoftClientId(override: string) {
  return override.trim() || kjmclClientId;
}
