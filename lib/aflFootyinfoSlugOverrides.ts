/**
 * FootyInfo player slug overrides when default slug resolves to the wrong person.
 */
const AFL_FOOTYINFO_SLUG_OVERRIDES: Record<string, string[]> = {
  'tom lynch': ['tom-lynch-richmond', 'thomas-lynch'],
  'bobby hill': ['bobby-hill', 'ian-hill'],
  'matthew kennedy': ['matthew-kennedy'],
  'bailey j williams': ['bailey-williams', 'bailey-j-williams'],
  'bailey j. williams': ['bailey-williams', 'bailey-j-williams'],
};

function overrideKey(name: string): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function getAflFootyinfoSlugOverridesForName(playerName: string): string[] {
  return AFL_FOOTYINFO_SLUG_OVERRIDES[overrideKey(playerName)] ?? [];
}

export function playerHasFootyinfoSlugOverride(playerName: string): boolean {
  return getAflFootyinfoSlugOverridesForName(playerName).length > 0;
}
