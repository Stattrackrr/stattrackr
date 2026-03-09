/**
 * Map AFLTables opponent names / full team names to Footywire team names (nicknames).
 * AFLTables uses full names (Essendon, Geelong). Footywire uses nicknames (Bombers, Cats).
 */
export const AFL_TEAM_TO_FOOTYWIRE: Record<string, string> = {
  Adelaide: 'Crows',
  'Adelaide Crows': 'Crows',
  Crows: 'Crows',

  Brisbane: 'Lions',
  'Brisbane Lions': 'Lions',
  Lions: 'Lions',

  Carlton: 'Blues',
  Blues: 'Blues',

  Collingwood: 'Magpies',
  Magpies: 'Magpies',

  Essendon: 'Bombers',
  Bombers: 'Bombers',

  Fremantle: 'Dockers',
  Dockers: 'Dockers',

  Geelong: 'Cats',
  Cats: 'Cats',

  'Gold Coast': 'Suns',
  'Gold Coast Suns': 'Suns',
  Suns: 'Suns',

  GWS: 'Giants',
  'Greater Western Sydney': 'Giants',
  Giants: 'Giants',

  Hawthorn: 'Hawks',
  Hawks: 'Hawks',

  Melbourne: 'Demons',
  Demons: 'Demons',

  'North Melbourne': 'Kangaroos',
  North: 'Kangaroos',
  Kangaroos: 'Kangaroos',

  'Port Adelaide': 'Power',
  Port: 'Power',
  Power: 'Power',

  Richmond: 'Tigers',
  Tigers: 'Tigers',

  'St Kilda': 'Saints',
  Saints: 'Saints',

  Sydney: 'Swans',
  'Sydney Swans': 'Swans',
  Swans: 'Swans',

  'West Coast': 'Eagles',
  'West Coast Eagles': 'Eagles',
  Eagles: 'Eagles',

  'Western Bulldogs': 'Bulldogs',
  Footscray: 'Bulldogs',
  Bulldogs: 'Bulldogs',
};

/** Convert opponent string from game logs to Footywire team name. */
export function opponentToFootywireTeam(opponent: string): string | null {
  if (!opponent || typeof opponent !== 'string') return null;
  const s = opponent.replace(/^vs\s*/i, '').trim();
  const lower = s.toLowerCase();
  // Exact match first
  const exact = Object.keys(AFL_TEAM_TO_FOOTYWIRE).find((k) => k.toLowerCase() === lower);
  if (exact) return AFL_TEAM_TO_FOOTYWIRE[exact];
  // Then try contains (e.g. "North Melbourne Kangaroos" -> Kangaroos). Prefer longer keys
  // so "Port Adelaide Power" matches "Port Adelaide" -> Power, not "Adelaide" -> Crows.
  const keysByLength = Object.keys(AFL_TEAM_TO_FOOTYWIRE).sort((a, b) => b.length - a.length);
  const partial = keysByLength.find((k) => lower.includes(k.toLowerCase()));
  return partial ? AFL_TEAM_TO_FOOTYWIRE[partial] : null;
}

/** Roster abbrev (BL, GE) or partial name -> injury list team name (Brisbane Lions, Geelong Cats). */
export const ROSTER_TEAM_TO_INJURY_TEAM: Record<string, string> = {
  AD: 'Adelaide Crows', BL: 'Brisbane Lions', CA: 'Carlton Blues', CW: 'Collingwood Magpies',
  ES: 'Essendon Bombers', FR: 'Fremantle Dockers', GE: 'Geelong Cats', GC: 'Gold Coast Suns',
  GW: 'GWS Giants', HW: 'Hawthorn Hawks', ME: 'Melbourne Demons', NM: 'North Melbourne Kangaroos',
  PA: 'Port Adelaide Power', RI: 'Richmond Tigers', SK: 'St Kilda Saints', SY: 'Sydney Swans',
  WB: 'Western Bulldogs', WC: 'West Coast Eagles',
};

/**
 * Official team name -> name to use in FootyWire player page URL (pg-{slug}--{player}).
 * FootyWire slug = this string lowercased, spaces to hyphens, non-alnum stripped.
 * Only overrides where FootyWire uses a different slug than hyphenated full name.
 */
const OFFICIAL_TO_FOOTYWIRE_PG_NAME: Partial<Record<string, string>> = {
  'North Melbourne Kangaroos': 'Kangaroos',           // pg-kangaroos-- not north-melbourne-kangaroos
  'GWS Giants': 'Greater Western Sydney Giants',      // pg-greater-western-sydney-giants-- not gws-giants
};

/** Get the team name string to use for FootyWire player game log URL (so slug matches FootyWire). */
export function getFootyWireTeamNameForPlayerUrl(officialTeamName: string): string {
  if (!officialTeamName || typeof officialTeamName !== 'string') return officialTeamName;
  const override = OFFICIAL_TO_FOOTYWIRE_PG_NAME[officialTeamName.trim()];
  return override ?? officialTeamName.trim();
}

/** Official team name -> AFL Tables URL slug for team stats (e.g. .../teams/hawthorn/2025_gbg.html). */
export const OFFICIAL_TO_AFLTABLES_TEAM_SLUG: Record<string, string> = {
  'Adelaide Crows': 'adelaide',
  'Brisbane Lions': 'brisbane',
  'Carlton Blues': 'carlton',
  'Collingwood Magpies': 'collingwood',
  'Essendon Bombers': 'essendon',
  'Fremantle Dockers': 'fremantle',
  'Geelong Cats': 'geelong',
  'Gold Coast Suns': 'goldcoast',
  'GWS Giants': 'gws',
  'Hawthorn Hawks': 'hawthorn',
  'Melbourne Demons': 'melbourne',
  'North Melbourne Kangaroos': 'kangaroos',
  'Port Adelaide Power': 'portadelaide',
  'Richmond Tigers': 'richmond',
  'St Kilda Saints': 'stkilda',
  'Sydney Swans': 'sydney',
  'West Coast Eagles': 'westcoast',
  'Western Bulldogs': 'bulldogs',
};

export function getAflTablesTeamSlug(officialTeamName: string): string | null {
  if (!officialTeamName || typeof officialTeamName !== 'string') return null;
  const t = officialTeamName.trim();
  if (OFFICIAL_TO_AFLTABLES_TEAM_SLUG[t]) return OFFICIAL_TO_AFLTABLES_TEAM_SLUG[t];
  const lower = t.toLowerCase();
  const entry = Object.entries(OFFICIAL_TO_AFLTABLES_TEAM_SLUG).find(([k]) => k.toLowerCase() === lower);
  return entry ? entry[1] : null;
}

export function rosterTeamToInjuryTeam(team: string): string | null {
  if (!team || typeof team !== 'string') return null;
  const t = team.trim();
  const u = t.toUpperCase();
  if (ROSTER_TEAM_TO_INJURY_TEAM[u]) return ROSTER_TEAM_TO_INJURY_TEAM[u];
  const names = new Set(Object.values(ROSTER_TEAM_TO_INJURY_TEAM));
  if (names.has(t)) return t;
  const lower = t.toLowerCase();
  for (const injuryName of names) {
    if (injuryName.toLowerCase().includes(lower)) return injuryName;
  }
  return null;
}

/** League stats team name (e.g. from data/afl-league-player-stats-*.json) -> official full name for APIs. */
export const LEAGUE_TEAM_TO_OFFICIAL: Record<string, string> = {
  Adelaide: 'Adelaide Crows',
  Brisbane: 'Brisbane Lions',
  Carlton: 'Carlton Blues',
  Collingwood: 'Collingwood Magpies',
  Essendon: 'Essendon Bombers',
  Fremantle: 'Fremantle Dockers',
  Geelong: 'Geelong Cats',
  'Gold Coast': 'Gold Coast Suns',
  GWS: 'GWS Giants',
  Hawthorn: 'Hawthorn Hawks',
  Melbourne: 'Melbourne Demons',
  'North Melbourne': 'North Melbourne Kangaroos',
  'Port Adelaide': 'Port Adelaide Power',
  Richmond: 'Richmond Tigers',
  'St Kilda': 'St Kilda Saints',
  Sydney: 'Sydney Swans',
  'Western Bulldogs': 'Western Bulldogs',
  'West Coast': 'West Coast Eagles',
};

/** Convert league stats team name to official full name (for game logs API etc). */
export function leagueTeamToOfficial(leagueTeam: string): string | null {
  if (!leagueTeam || typeof leagueTeam !== 'string') return null;
  const t = leagueTeam.trim();
  if (LEAGUE_TEAM_TO_OFFICIAL[t]) return LEAGUE_TEAM_TO_OFFICIAL[t];
  const lower = t.toLowerCase();
  const entry = Object.entries(LEAGUE_TEAM_TO_OFFICIAL).find(([k]) => k.toLowerCase() === lower);
  return entry ? entry[1] : null;
}

/** Odds API / display names that differ from league canonical -> same form used in stats cache keys. */
export const TEAM_CANONICAL_FOR_STATS: Record<string, string> = {
  'Greater Western Sydney Giants': 'GWS Giants',
};

/** Canonical team string for stats cache key so warm (league names) and list (Odds API names) match. */
export function canonicalTeamForStatsKey(team: string): string {
  if (!team || typeof team !== 'string') return team.trim();
  const t = team.trim();
  const fromMap = TEAM_CANONICAL_FOR_STATS[t];
  if (fromMap) return fromMap;
  const fromRoster = rosterTeamToInjuryTeam(t);
  if (fromRoster) return fromRoster;
  return t;
}

/** Return true if game team string (from Odds API) matches the league team name. */
export function gameTeamMatchesLeagueTeam(gameTeam: string, leagueTeam: string): boolean {
  if (!gameTeam || !leagueTeam) return false;
  const g = gameTeam.trim();
  const official = leagueTeamToOfficial(leagueTeam);
  if (official && g === official) return true;
  if (g === leagueTeam.trim()) return true;
  if (g.toLowerCase().startsWith(leagueTeam.trim().toLowerCase())) return true;
  return false;
}

/** Official AFL API team names (same as ROSTER_TEAM_TO_INJURY_TEAM values). */
const OFFICIAL_TEAM_NAMES = new Set(Object.values(ROSTER_TEAM_TO_INJURY_TEAM));

/** FootyWire nickname (e.g. "Blues", "Eagles") -> official full name (e.g. "Carlton Blues"). */
const FOOTYWIRE_TO_OFFICIAL: Record<string, string> = {};
for (const full of Object.values(ROSTER_TEAM_TO_INJURY_TEAM)) {
  const nick = opponentToFootywireTeam(full);
  if (nick) FOOTYWIRE_TO_OFFICIAL[nick] = full;
}

/** Convert FootyWire team nickname to official full name. */
export function footywireNicknameToOfficial(nickname: string): string | null {
  if (!nickname || typeof nickname !== 'string') return null;
  const key = nickname.trim();
  if (FOOTYWIRE_TO_OFFICIAL[key]) return FOOTYWIRE_TO_OFFICIAL[key];
  const lower = key.toLowerCase();
  const entry = Object.entries(FOOTYWIRE_TO_OFFICIAL).find(([k]) => k.toLowerCase() === lower);
  return entry ? entry[1] : opponentToOfficialTeamName(key) ?? null;
}

/**
 * Odds API / external names that need mapping to our display form (exact match before fuzzy logic).
 */
const ODDS_API_TEAM_TO_DISPLAY: Record<string, string> = {
  'Greater Western Sydney Giants': 'GWS Giants',
};

/**
 * Normalize any team string (from Odds API, nickname, or full name) to official display name.
 * Use when storing or displaying so we never show "Essendon Bombers vs Bombers" (nickname-only).
 */
export function toOfficialAflTeamDisplayName(team: string): string {
  if (!team || typeof team !== 'string') return (team ?? '').trim();
  const t = team.trim();
  const fromOdds = ODDS_API_TEAM_TO_DISPLAY[t];
  if (fromOdds) return fromOdds;
  const fromNick = footywireNicknameToOfficial(t);
  if (fromNick) return fromNick;
  const fromOpp = opponentToOfficialTeamName(t);
  if (fromOpp) return fromOpp;
  return t;
}

/**
 * Map game log opponent string (e.g. "Geelong", "vs North Melbourne") to the full
 * team name used by the AFL official API (e.g. "Geelong Cats", "North Melbourne Kangaroos").
 * Used for lineup card when using AFL API only.
 */
export function opponentToOfficialTeamName(opponent: string): string | null {
  if (!opponent || typeof opponent !== 'string') return null;
  const s = opponent.replace(/^vs\.?\s*/i, '').trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  for (const name of OFFICIAL_TEAM_NAMES) {
    if (name.toLowerCase() === lower) return name;
    if (name.toLowerCase().includes(lower)) return name;
  }
  // Match only if the official name's first word appears as a whole word (avoid "western" matching "St").
  const partial = [...OFFICIAL_TEAM_NAMES].find((n) => {
    const firstWord = n.toLowerCase().split(' ')[0] ?? '';
    if (!firstWord || firstWord.length < 2) return false;
    const wordBoundary = new RegExp(`\\b${firstWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return wordBoundary.test(lower);
  });
  return partial ?? null;
}
