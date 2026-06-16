/**
 * Curated cross-source name aliases for the World Cup dashboard's stat merge.
 *
 * The dashboard combines a selected 2026 World Cup player's stats with their
 * Euros / Nations League / Copa América / AFCON rows *by normalized name*. When
 * a player is stored under a slightly different name across sources (e.g. BDL
 * "Erling Haaland" vs API-Football "Erling Braut Haaland"), the exact-name match
 * misses real stats. This map links those known same-person spellings so no
 * player with data gets left out because of a name difference.
 *
 * KEY   = the World Cup (BDL) player's normalized name
 * VALUE = additional international normalized names that are the SAME person
 *
 * Only include pairs you are confident are the same human. Do NOT add name
 * twins who are different people (e.g. "Joan García" ≠ "Fran García",
 * "Mohamed Alaa" ≠ "Mohamed Salah", "Tim Weah" ≠ "Tim Ream"). Those must stay
 * unmatched so the wrong stats never merge.
 *
 * Names here must already be normalized with `normalizeWorldCupPlayerName`
 * (lowercase, accents/ø/å/ß folded, punctuation → spaces).
 */
export const WORLD_CUP_NAME_ALIASES: Record<string, string[]> = {
  'erling haaland': ['erling braut haaland'],
  'pablo gavi': ['gavi'],
  'ben gannon doak': ['ben doak'],
  'idrissa gana gueye': ['idrissa gueye'],
  'sondre langas': ['sondre klingen langas'],
  'lionel mpasi nzau': ['lionel mpasi'],
  'meschak elia': ['meschack elia'],
  'yeremy pino': ['yeremi pino'],
  'samu costa': ['samuel costa'],

  // Asian name-order aliases: BDL uses Family-Given ("Son Heung-min"), while
  // API Football full-name enrichment produces Given-Family ("Heung-Min Son").
  'son heung min': ['heung min son'],
  'hwang hee chan': ['hee chan hwang'],
  'kim min jae': ['min jae kim'],
  'lee kang in': ['kang in lee'],
  'hwang in beom': ['in beom hwang'],
  'cho gue sung': ['gue sung cho'],
  'oh hyeon gyu': ['hyeon gyu oh'],
  'song bum keun': ['beom keun song'],

  // Nickname → full name
  'tim weah': ['timothy weah'],
  'tino livramento': ['valentino livramento'],
  'tony ralston': ['anthony ralston'],

  // Middle name or prefix differences
  'ar jany martha': ['arjany martha'],
  'amine sbai': ['mohamed amine sbai'],
  'dayne st clair': ['dayne tristan st clair'],
  'derrick etienne': ['derrick etienne junior'],
  'frans putros': ['frans dhia putros'],
  'hossein hosseini': ['seyed hossein hosseini'],
  'meshaal barsham': ['meshaal aissa barsham'],
  'trevor iriving doornbusch': ['trevor doornbusch'],
  'noor al deen al rawabdeh': ['noor al rawabdeh'],

  // Transliteration variants (same name, different romanization)
  'jovo lukic': ['jovan lukic'],
  'mahdi torabi': ['mehdi torabi'],
  'mohammad abu zrayq': ['mohammed abu zrayq'],
  'odiljon khamrobekov': ['odildzhon khamrobekov'],
  'umarbek eshmuradov': ['umar eshmuradov'],
  'yazeed abu laila': ['yazeed abulaila'],
};

/** All international alias names a World Cup normalized name should also match. */
export function getWorldCupNameAliases(worldCupNormalizedName: string): string[] {
  return WORLD_CUP_NAME_ALIASES[worldCupNormalizedName] ?? [];
}

/**
 * Reverse index: international normalized name → World Cup normalized name.
 * Used when attaching international rows to World Cup index entries.
 */
export const INTERNATIONAL_TO_WORLD_CUP_ALIAS: Record<string, string> = Object.entries(
  WORLD_CUP_NAME_ALIASES
).reduce<Record<string, string>>((acc, [wcName, intlNames]) => {
  for (const intlName of intlNames) acc[intlName] = wcName;
  return acc;
}, {});

/** Resolve an international normalized name to its World Cup name if aliased. */
export function resolveWorldCupAliasName(internationalNormalizedName: string): string {
  return INTERNATIONAL_TO_WORLD_CUP_ALIAS[internationalNormalizedName] ?? internationalNormalizedName;
}

/**
 * Per-World-Cup-player overrides for name COLLISIONS — where one normalized
 * name maps to multiple DIFFERENT real people (e.g. two "Emiliano Martínez").
 * The by-name merge can't tell them apart, so we pin the correct international
 * identities per BDL player id (and exclude the wrong ones).
 *
 * KEY = World Cup (BDL) player id.
 */
export type IntlIdRef = { source: string; id: string };

export const WORLD_CUP_PLAYER_OVERRIDES: Record<
  string,
  { excludeIntlIds?: IntlIdRef[]; includeIntlIds?: IntlIdRef[] }
> = {
  // "Emiliano Martínez" — Argentina GK (Aston Villa) vs a Uruguay player.
  '8891': { excludeIntlIds: [{ source: 'api-football', id: '153083' }] }, // ARG → drop Uruguay's rows
  '30633': { excludeIntlIds: [{ source: 'api-football', id: '19599' }] }, // URY → drop Argentina's rows
  // "Cristian Martínez" — Panama vs Andorra.
  '30267': { excludeIntlIds: [{ source: 'api-football', id: '56053' }] }, // PAN → drop Andorra's rows
};

export function getWorldCupPlayerOverride(
  bdlPlayerId: string | null | undefined
): { excludeIntlIds?: IntlIdRef[]; includeIntlIds?: IntlIdRef[] } | null {
  if (!bdlPlayerId) return null;
  return WORLD_CUP_PLAYER_OVERRIDES[String(bdlPlayerId)] ?? null;
}

/** BDL player ids that have a curated collision override (used by the audit). */
export const OVERRIDDEN_WORLD_CUP_PLAYER_IDS = new Set(Object.keys(WORLD_CUP_PLAYER_OVERRIDES));

function capitalizeWorldCupNamePart(part: string): string {
  if (!part) return part;
  return part
    .split(/([-'])/)
    .map((segment) => {
      if (segment === '-' || segment === "'") return segment;
      if (!segment) return segment;
      const lower = segment.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

/** Title-case each name part for dashboard display (e.g. "cody gakpo" → "Cody Gakpo"). */
export function formatWorldCupPlayerDisplayName(name: string): string {
  const sanitized = String(name || '')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .trim();
  if (!sanitized) return sanitized;
  return sanitized
    .split(/\s+/)
    .filter(Boolean)
    .map(capitalizeWorldCupNamePart)
    .join(' ');
}
