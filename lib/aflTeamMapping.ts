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
  const partial = [...OFFICIAL_TEAM_NAMES].find((n) => lower.includes(n.toLowerCase().split(' ')[0]));
  return partial ?? null;
}
