/**
 * FootyWire player URLs use `pg-{team}--{slug}`. Some slugs collide with retired namesakes
 * (same default slug, wrong person). Keep overrides in one place for API + client cache busting.
 */
const AFL_FOOTYWIRE_SLUG_OVERRIDES: Record<string, string[]> = {
  'tom lynch': ['thomas-lynch'],
  'bobby hill': ['ian-hill'],
  'wil dawson': ['will-dawson'],
  'michael frederick': ['michael-fredrick'],
  // Bare "matthew-kennedy" resolves to a retired Brisbane Lion (~2001); current AFL player is -1.
  'matthew kennedy': ['matthew-kennedy-1'],
};

function overrideKey(name: string): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function getAflFootywireSlugOverridesForName(playerName: string): string[] {
  return AFL_FOOTYWIRE_SLUG_OVERRIDES[overrideKey(playerName)] ?? [];
}

export function playerHasFootywireSlugOverride(playerName: string): boolean {
  return getAflFootywireSlugOverridesForName(playerName).length > 0;
}
