/**
 * Canonical Soccerway stat-key mapping. **Client-safe** — kept separate from
 * `lib/soccerPlayerStatsScrape.ts` (which pulls in puppeteer) so React client
 * components can import these helpers without dragging Node-only modules into the
 * browser bundle.
 *
 * Soccerway uses several different column headers for the same stat across categories,
 * competitions, and seasons (e.g. "xG" vs "Expected Goals (xG)", "Shots" vs "Total
 * Shots"). Canonicalize once on parse so the cache only ever stores one key per stat,
 * and use the read-time fallback so already-cached payloads still hydrate the UI.
 */

const SOCCER_STAT_KEY_ALIASES: Record<string, string> = {
  xg: 'expected_goals_xg',
  x_g: 'expected_goals_xg',
  expected_goals: 'expected_goals_xg',
  expectedgoals: 'expected_goals_xg',
  expected_goals_xg_: 'expected_goals_xg',
  xa: 'expected_assists_xa',
  x_a: 'expected_assists_xa',
  expected_assists: 'expected_assists_xa',
  shots: 'total_shots',
  sh: 'total_shots',
  total_shots_attempted: 'total_shots',
  total_shots_attempts: 'total_shots',
  shots_attempts: 'total_shots',
  sot: 'shots_on_target',
  shots_on_goal: 'shots_on_target',
  on_target: 'shots_on_target',
  shots_off_target: 'shots_off_target',
  shots_off_goal: 'shots_off_target',
  off_target: 'shots_off_target',
  shots_blocked: 'shots_blocked',
  passes: 'accurate_passes',
  acc_passes: 'accurate_passes',
  acc_pass: 'accurate_passes',
  passes_accurate: 'accurate_passes',
  pass: 'accurate_passes',
  acc_long_balls: 'accurate_long_balls',
  long_balls: 'accurate_long_balls',
  long_balls_accurate: 'accurate_long_balls',
  acc_crosses: 'accurate_crosses',
  crosses: 'accurate_crosses',
  crosses_accurate: 'accurate_crosses',
  duels: 'duels_won',
  duels_won_total: 'duels_won',
  duels_lost: 'duels_lost',
  aerial_duels_won: 'aerials_won',
  aerial_duels: 'aerials_won',
  aerials: 'aerials_won',
  takes_on: 'successful_dribbles',
  successful_take_ons: 'successful_dribbles',
  take_ons_succeeded: 'successful_dribbles',
  dribbles: 'successful_dribbles',
  dribbles_completed: 'successful_dribbles',
  tackles: 'tackles_won',
  tackles_made: 'tackles_won',
  interceptions_won: 'interceptions',
  interception: 'interceptions',
  clearances_made: 'clearances',
  blocked_shots: 'blocks',
  shots_blocked_defending: 'blocks',
  goals_scored: 'goals',
  g: 'goals',
  a: 'assists',
  ass: 'assists',
  mins: 'minutes_played',
  min: 'minutes_played',
  minutes: 'minutes_played',
  mp: 'minutes_played',
  minutes_played_: 'minutes_played',
  tib: 'touches_in_opposition_box',
  touches_opp_box: 'touches_in_opposition_box',
  touches_in_opp_box: 'touches_in_opposition_box',
  opp_box_touches: 'touches_in_opposition_box',
  touches_in_opposition_area: 'touches_in_opposition_box',
  touches_attacking_third: 'touches_in_attacking_third',
  attacking_third_touches: 'touches_in_attacking_third',
  rating_average: 'rating',
  whoscored_rating: 'rating',
  match_rating: 'rating',
  saves: 'goalkeeper_saves',
  saves_made: 'goalkeeper_saves',
  saves_total: 'goalkeeper_saves',
  goals_conceded: 'goals_conceded',
  goals_against: 'goals_conceded',
  ga: 'goals_conceded',
  fouls: 'fouls_committed',
  fouled: 'fouls_suffered',
  fouls_drawn: 'fouls_suffered',
  was_fouled: 'fouls_suffered',
  yel: 'yellow_cards',
  yellow: 'yellow_cards',
  red: 'red_cards',
  offsides: 'offsides',
  offside: 'offsides',
  big_chances_missed: 'big_chances_missed',
  big_chances_created: 'big_chances_created',
  key_passes: 'key_passes',
  through_balls: 'accurate_through_balls',
  accurate_through_balls: 'accurate_through_balls',
};

export function canonicalSoccerStatKey(rawKey: string): string {
  const slug = String(rawKey || '').trim().toLowerCase();
  if (!slug) return slug;
  return SOCCER_STAT_KEY_ALIASES[slug] ?? slug;
}

/** Read a stat from cached data using the canonical key + every known alias. Returns the first non-null match. */
export function readCanonicalSoccerStatValue(
  stats: Record<string, string | null> | null | undefined,
  canonicalKey: string
): string | null {
  if (!stats) return null;
  const target = canonicalSoccerStatKey(canonicalKey);
  const direct = stats[target];
  if (direct != null && String(direct).trim().length > 0) return direct;
  for (const [alias, mapped] of Object.entries(SOCCER_STAT_KEY_ALIASES)) {
    if (mapped !== target) continue;
    const value = stats[alias];
    if (value != null && String(value).trim().length > 0) return value;
  }
  return null;
}

/** Soccerway uses "-" for zero in player match tables; treat as 0 for charts. */
export function parseSoccerPlayerStatNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed === '-' || trimmed === '—' || trimmed.toLowerCase() === 'n/a') return 0;
  const match = trimmed.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number.parseFloat(match[0]);
  return Number.isFinite(n) ? n : null;
}

const PLAYER_STAT_CATEGORY_ORDER = ['top', 'shots', 'attack', 'passes', 'defense', 'goalkeeping', 'general'] as const;

/** First numeric value for a canonical stat across Soccerway player tabs (missing key → null, "-" → 0). */
export function readPlayerMatchStatNumber(
  categories: Partial<Record<string, { stats?: Record<string, string | null> }>> | undefined,
  canonicalKey: string
): number | null {
  if (!categories) return null;
  for (const category of PLAYER_STAT_CATEGORY_ORDER) {
    const raw = readCanonicalSoccerStatValue(categories[category]?.stats, canonicalKey);
    const n = parseSoccerPlayerStatNumber(raw);
    if (n != null) return n;
  }
  return null;
}
