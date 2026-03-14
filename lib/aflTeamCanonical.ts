/**
 * Single source of truth for AFL team canonical keys and alt names.
 * Matching is by explicit alt name only so we never wrong-match (e.g. Adelaide vs Port Adelaide, Melbourne vs North Melbourne).
 */

/** Canonical keys used by API (league stats, match filtering). Title Case. */
export const AFL_CANONICAL_KEYS = [
  'Adelaide',
  'Brisbane',
  'Carlton',
  'Collingwood',
  'Essendon',
  'Fremantle',
  'Geelong',
  'Gold Coast',
  'GWS',
  'Hawthorn',
  'Melbourne',
  'North Melbourne',
  'Port Adelaide',
  'Richmond',
  'St Kilda',
  'Sydney',
  'West Coast',
  'Western Bulldogs',
] as const;

export type AflCanonicalKey = (typeof AFL_CANONICAL_KEYS)[number];

/** All alt names (normalized lowercase) that map to each canonical key. No substring matching – only exact alt match. */
const ALT_NAMES_TO_CANONICAL: Record<string, AflCanonicalKey> = {
  // Adelaide – must not match Port Adelaide
  adelaide: 'Adelaide',
  'adelaide crows': 'Adelaide',
  crows: 'Adelaide',

  // Brisbane
  brisbane: 'Brisbane',
  'brisbane lions': 'Brisbane',
  lions: 'Brisbane',

  // Carlton
  carlton: 'Carlton',
  'carlton blues': 'Carlton',
  blues: 'Carlton',

  // Collingwood
  collingwood: 'Collingwood',
  'collingwood magpies': 'Collingwood',
  magpies: 'Collingwood',

  // Essendon
  essendon: 'Essendon',
  'essendon bombers': 'Essendon',
  bombers: 'Essendon',

  // Fremantle
  fremantle: 'Fremantle',
  'fremantle dockers': 'Fremantle',
  dockers: 'Fremantle',

  // Geelong
  geelong: 'Geelong',
  'geelong cats': 'Geelong',
  cats: 'Geelong',

  // Gold Coast
  'gold coast': 'Gold Coast',
  'gold coast suns': 'Gold Coast',
  suns: 'Gold Coast',

  // GWS – must not match Sydney
  gws: 'GWS',
  'greater western sydney': 'GWS',
  'gws giants': 'GWS',
  giants: 'GWS',

  // Hawthorn
  hawthorn: 'Hawthorn',
  'hawthorn hawks': 'Hawthorn',
  hawks: 'Hawthorn',

  // Melbourne – must not match North Melbourne
  melbourne: 'Melbourne',
  'melbourne demons': 'Melbourne',
  demons: 'Melbourne',

  // North Melbourne – must not match Melbourne
  'north melbourne': 'North Melbourne',
  'north melbourne kangaroos': 'North Melbourne',
  north: 'North Melbourne',
  kangaroos: 'North Melbourne',

  // Port Adelaide – must not match Adelaide
  'port adelaide': 'Port Adelaide',
  'port adelaide power': 'Port Adelaide',
  port: 'Port Adelaide',
  power: 'Port Adelaide',

  // Richmond
  richmond: 'Richmond',
  'richmond tigers': 'Richmond',
  tigers: 'Richmond',

  // St Kilda
  'st kilda': 'St Kilda',
  'st kilda saints': 'St Kilda',
  saints: 'St Kilda',

  // Sydney – must not match GWS
  sydney: 'Sydney',
  'sydney swans': 'Sydney',
  swans: 'Sydney',

  // West Coast
  'west coast': 'West Coast',
  'west coast eagles': 'West Coast',
  eagles: 'West Coast',

  // Western Bulldogs
  'western bulldogs': 'Western Bulldogs',
  bulldogs: 'Western Bulldogs',
  footscray: 'Western Bulldogs',
};

function normalizeForMatch(team: string | null | undefined): string {
  if (!team || typeof team !== 'string') return '';
  return team.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9\s]/g, '');
}

/**
 * Return the canonical AFL team key for a given team name, or null if unknown.
 * Uses explicit alt names only – no substring matching – so Adelaide never becomes Port Adelaide, etc.
 */
export function getAflCanonicalTeamKey(team: string | null | undefined): AflCanonicalKey | null {
  const t = normalizeForMatch(team);
  if (!t) return null;
  return ALT_NAMES_TO_CANONICAL[t] ?? null;
}

/** Same as getAflCanonicalTeamKey but returns lowercase key for use in color lookup etc. */
export function getAflCanonicalTeamKeyLower(team: string | null | undefined): string | null {
  const k = getAflCanonicalTeamKey(team);
  return k ? k.toLowerCase() : null;
}
