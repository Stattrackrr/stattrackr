/**
 * Helper that reads from the `international_*` Supabase tables (StatsBomb
 * Euros + API-Football Nations League) and shapes the response so the
 * existing World Cup dashboard UI can consume it without modification.
 *
 * The shape mirrors the BDL FIFA World Cup API response that
 * `/api/world-cup/dashboard` currently returns.
 */

import { supabaseAdmin } from './supabaseAdmin';
import { normalizeWorldCupPlayerName } from './worldCupPlayerIndex';
import { getWorldCupNameAliases, getWorldCupPlayerOverride } from './worldCupPlayerAliases';
import { resolveWorldCupFlagCode } from './worldCupFlags';
import { getWorldCupCache, setWorldCupCache, clearWcBdlSupplementPayloadMem } from './worldCupCache';

function rankOpponentAllowedValues(entries: { slug: string; value: number }[]): Record<string, number> {
  if (!entries.length) return {};
  const sorted = [...entries].sort((a, b) => a.value - b.value || a.slug.localeCompare(b.slug));
  const ranks: Record<string, number> = {};
  let i = 0;
  while (i < sorted.length) {
    let end = i;
    while (end + 1 < sorted.length && sorted[end + 1]!.value === sorted[i]!.value) end++;
    // Standard competition ranking: all tied entries share the best (lowest) rank in the group
    const rank = i + 1;
    for (let c = i; c <= end; c++) ranks[sorted[c]!.slug] = rank;
    i = end + 1;
  }
  return ranks;
}

export type InternationalCompetition = 'euros' | 'nations-league';

const COMPETITION_TO_SOURCE: Record<InternationalCompetition, string> = {
  euros: 'statsbomb',
  'nations-league': 'api-football',
};

type IntlMatchRow = {
  source: string;
  source_match_id: string;
  tournament_slug: string;
  season_year: number;
  match_date: string | null;
  kickoff_unix: number | null;
  stage: string | null;
  home_team_source_id: string;
  away_team_source_id: string;
  home_team_name: string;
  away_team_name: string;
  home_score: number | null;
  away_score: number | null;
  home_score_penalty: number | null;
  away_score_penalty: number | null;
  has_penalty_shootout: boolean | null;
  status: string | null;
};

const INTL_MATCH_SELECT =
  'source, source_match_id, tournament_slug, season_year, match_date, kickoff_unix, stage, home_team_source_id, away_team_source_id, home_team_name, away_team_name, home_score, away_score, home_score_penalty, away_score_penalty, has_penalty_shootout, status';

function mapIntlMatchPenaltyFields(m: {
  home_score_penalty?: number | null;
  away_score_penalty?: number | null;
  has_penalty_shootout?: boolean | null;
}) {
  return {
    homeScorePenalties: m.home_score_penalty ?? null,
    awayScorePenalties: m.away_score_penalty ?? null,
    hasPenaltyShootout: m.has_penalty_shootout === true,
  };
}

type IntlTeamRow = {
  source: string;
  source_team_id: string;
  team_name: string;
  country_code: string | null;
};

type IntlPlayerRow = {
  source: string;
  source_player_id: string;
  full_name: string;
  primary_position: string | null;
  country_code: string | null;
};

type IntlStatRow = {
  source: string;
  source_match_id: string;
  source_player_id: string;
  source_team_id: string;
  is_home: boolean;
  position: string | null;
  minutes_played: number | null;
  goals: number | null;
  assists: number | null;
  shots_total: number | null;
  shots_on_target: number | null;
  passes_total: number | null;
  passes_accurate: number | null;
  expected_goals: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  tackles: number | null;
  interceptions: number | null;
  fouls: number | null;
  was_fouled: number | null;
  saves: number | null;
  big_chances_created: number | null;
  raw_aggregates: Record<string, unknown> | null;
};

// ---------------------------------------------------------------------------
// Player position labeling
//
// Foundation for "Defense vs Position": every international player must resolve
// to exactly one of GK / DEF / MID / FWD. Sources disagree on format — API
// Football uses single letters (G/D/M/F), StatsBomb uses long descriptors, and
// some feeds use abbreviations — so we normalize all of them, then pick one
// canonical bucket per player by majority vote across their matches (with a
// stat-based fallback so even players with no usable position string are
// labeled).
// ---------------------------------------------------------------------------

export type IntlPositionBucket = 'GK' | 'DEF' | 'MID' | 'FWD';

const INTL_POSITION_ORDER: readonly IntlPositionBucket[] = ['GK', 'DEF', 'MID', 'FWD'];

function intlNum(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Stable lookup key for a player across the international tables. */
export function intlPlayerKey(source: string | null | undefined, sourcePlayerId: string | number): string {
  return `${source ?? ''}:${sourcePlayerId}`;
}

/**
 * Classify a single raw position string into GK/DEF/MID/FWD, or null when the
 * string is empty/unrecognized (callers fall back to heuristics).
 *
 * Order matters: GK first, then DEF (so "wing back"/"wb" lands in DEF rather
 * than FWD via "wing"), then MID (so "attacking"/"defensive midfielder" stay
 * MID), then FWD.
 */
export function classifyIntlPositionString(
  value: string | null | undefined
): IntlPositionBucket | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  // API-Football single-letter codes.
  if (raw === 'g') return 'GK';
  if (raw === 'd') return 'DEF';
  if (raw === 'm') return 'MID';
  if (raw === 'f' || raw === 'w') return 'FWD';
  if (/goalkeep|goalie|keeper|portero/.test(raw) || raw === 'gk') return 'GK';
  if (
    /back|defender|defence|defense|sweeper|fullback|full-back|\bcb\b|\blb\b|\brb\b|\bwb\b|\blwb\b|\brwb\b|\brcb\b|\blcb\b/.test(
      raw
    )
  )
    return 'DEF';
  // FIFA/BDL roster codes RM/LM/RW/LW are wide attackers (wingers), not central mids.
  // Must run before the generic midfield matcher so Yamal-style RM wingers land in FWD.
  if (
    /^(rw|lw|rm|lm|fw|lf|rf|wg|win)$/.test(raw) ||
    /\b(right|left)\s+wing(?:er)?\b/.test(raw) ||
    /\bwinger\b/.test(raw)
  )
    return 'FWD';
  if (
    /midfield|\bmid\b|\bcm\b|\bdm\b|\bam\b|\bcdm\b|\bcam\b|\bdmf\b|\bamf\b|\bmc\b|\brcm\b|\blcm\b|\bmf\b/.test(
      raw
    )
  )
    return 'MID';
  if (
    /forward|striker|wing|attacker|attack|\bcf\b|\bst\b|\bss\b|\blw\b|\brw\b|\bfw\b|centre forward|center forward/.test(
      raw
    )
  )
    return 'FWD';
  return null;
}

type IntlPositionHeuristicStats = {
  saves?: number | null;
  goals?: number | null;
  shots_total?: number | null;
  shots_on_target?: number | null;
  tackles?: number | null;
  interceptions?: number | null;
};

/**
 * Resolve ONE canonical position for a player from every position string seen
 * across their matches (majority vote), falling back to stat-based heuristics
 * when no string is recognized. Always returns a bucket so every player is
 * labeled.
 */
export function resolvePlayerPositionBucket(
  positionStrings: Array<string | null | undefined>,
  stats: IntlPositionHeuristicStats = {}
): IntlPositionBucket {
  const counts: Record<IntlPositionBucket, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  let recognized = false;
  for (const s of positionStrings) {
    const bucket = classifyIntlPositionString(s);
    if (bucket) {
      counts[bucket] += 1;
      recognized = true;
    }
  }
  if (recognized) {
    return INTL_POSITION_ORDER.reduce(
      (best, key) => (counts[key] > counts[best] ? key : best),
      INTL_POSITION_ORDER[0]
    );
  }
  // No usable position string anywhere — infer from accumulated production.
  if (intlNum(stats.saves) > 0) return 'GK';
  const attack = intlNum(stats.goals) * 2 + intlNum(stats.shots_total) + intlNum(stats.shots_on_target);
  const defend = intlNum(stats.tackles) + intlNum(stats.interceptions);
  if (attack > defend && attack > 0) return 'FWD';
  if (defend > attack && defend > 0) return 'DEF';
  return 'MID';
}

type IntlPositionInputRow = {
  source?: string | null;
  source_player_id: string | number;
  position?: string | null;
  saves?: number | null;
  goals?: number | null;
  shots_total?: number | null;
  shots_on_target?: number | null;
  tackles?: number | null;
  interceptions?: number | null;
};

/**
 * Build a canonical position map keyed by `intlPlayerKey`, aggregating every
 * one of a player's match rows so the label reflects their whole sample, not a
 * single noisy game. Guarantees a bucket for every player present in `rows`.
 */
export function buildIntlPlayerPositionMap(
  rows: Array<IntlPositionInputRow>
): Map<string, IntlPositionBucket> {
  const positionsByPlayer = new Map<string, Array<string | null | undefined>>();
  type IntlPositionStatAccumulator = {
    saves: number;
    goals: number;
    shots_total: number;
    shots_on_target: number;
    tackles: number;
    interceptions: number;
  };
  const statsByPlayer = new Map<string, IntlPositionStatAccumulator>();
  for (const row of rows) {
    const key = intlPlayerKey(row.source, row.source_player_id);
    const list = positionsByPlayer.get(key) ?? [];
    list.push(row.position ?? null);
    positionsByPlayer.set(key, list);
    const agg =
      statsByPlayer.get(key) ??
      { saves: 0, goals: 0, shots_total: 0, shots_on_target: 0, tackles: 0, interceptions: 0 };
    agg.saves += intlNum(row.saves);
    agg.goals += intlNum(row.goals);
    agg.shots_total += intlNum(row.shots_total);
    agg.shots_on_target += intlNum(row.shots_on_target);
    agg.tackles += intlNum(row.tackles);
    agg.interceptions += intlNum(row.interceptions);
    statsByPlayer.set(key, agg);
  }
  const out = new Map<string, IntlPositionBucket>();
  for (const [key, list] of positionsByPlayer) {
    out.set(key, resolvePlayerPositionBucket(list, statsByPlayer.get(key)));
  }
  return out;
}

/**
 * Bucket one player-game row for DvP using the position played THAT match.
 * BDL rows must use `/match_lineups` only (same source as the pitch view).
 */
export function dvpBucketForStatRow(row: IntlPositionInputRow): IntlPositionBucket | null {
  const fromString = classifyIntlPositionString(row.position);
  if (row.source === 'bdl') return fromString;
  if (fromString) return fromString;
  return resolvePlayerPositionBucket([], {
    saves: row.saves,
    goals: row.goals,
    shots_total: row.shots_total,
    shots_on_target: row.shots_on_target,
    tackles: row.tackles,
    interceptions: row.interceptions,
  });
}

/**
 * Load a canonical position for EVERY international player across ALL sources
 * and competitions, reading the full `international_player_match_stats` table in
 * pages (Supabase caps each select at 1000 rows). Returns a map keyed by
 * `intlPlayerKey`.
 */
export async function loadInternationalPlayerPositions(): Promise<Map<string, IntlPositionBucket>> {
  const sb = supabaseAdmin;
  const PAGE = 1000;
  const rows: IntlPositionInputRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('international_player_match_stats')
      .select(
        'source, source_player_id, position, saves, goals, shots_total, shots_on_target, tackles, interceptions'
      )
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to load player positions: ${error.message}`);
    const page = (data ?? []) as IntlPositionInputRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return buildIntlPlayerPositionMap(rows);
}

/** Build the normalized BDL-shaped data for an international competition. */
export async function loadInternationalDashboardData(opts: {
  competition: InternationalCompetition;
  teamId?: string | null;
  playerId?: string | null;
}) {
  const source = COMPETITION_TO_SOURCE[opts.competition];
  const sb = supabaseAdmin;

  // 1. Teams
  const { data: teamRows = [] } = await sb
    .from('international_teams')
    .select('source, source_team_id, team_name, country_code')
    .eq('source', source);

  const teams = (teamRows as IntlTeamRow[]).map((t) => ({
    id: t.source_team_id, // string id, UI tolerates string
    name: t.team_name,
    abbreviation: deriveAbbreviation(t.team_name, t.country_code),
    country_code: t.country_code,
    confederation: opts.competition === 'euros' ? 'UEFA' : 'UEFA',
  }));

  // 2. Matches (filter by tournament_slug to be safe in case a single
  //    source ever holds multiple tournaments).
  const tournamentSlug = opts.competition;
  const { data: matchRows = [] } = await sb
    .from('international_matches')
    .select(
      INTL_MATCH_SELECT
    )
    .eq('source', source)
    .eq('tournament_slug', tournamentSlug)
    .order('kickoff_unix', { ascending: true });

  const teamByIdLocal = new Map<string, IntlTeamRow>();
  for (const t of teamRows as IntlTeamRow[]) teamByIdLocal.set(t.source_team_id, t);

  const matches = (matchRows as IntlMatchRow[]).map((m) => {
    const home = synthTeam(m.home_team_source_id, m.home_team_name, teamByIdLocal);
    const away = synthTeam(m.away_team_source_id, m.away_team_name, teamByIdLocal);
    return {
      id: m.source_match_id,
      datetime: m.match_date
        ? new Date(`${m.match_date}T${secondsToTimeOfDay(m.kickoff_unix)}`).toISOString()
        : null,
      status: (m.status || '').toLowerCase() === 'completed' ? 'completed' : m.status || 'completed',
      season: { id: m.season_year, year: m.season_year },
      stage: { name: m.stage ?? null },
      home_team: home,
      away_team: away,
      // Camel-case mirrors that the dashboard UI reads directly.
      homeTeam: home,
      awayTeam: away,
      homeLabel: home.name,
      awayLabel: away.name,
      homeScore: m.home_score,
      awayScore: m.away_score,
      home_score: m.home_score,
      away_score: m.away_score,
      ...mapIntlMatchPenaltyFields(m),
      source: m.source,
    };
  });

  // 3. Pick a selected team (by id if provided, otherwise nothing).
  let selectedTeam: ReturnType<typeof synthTeam> | null = null;
  if (opts.teamId) {
    const row = teamByIdLocal.get(String(opts.teamId));
    if (row) {
      selectedTeam = {
        id: row.source_team_id,
        name: row.team_name,
        abbreviation: deriveAbbreviation(row.team_name, row.country_code),
        country_code: row.country_code,
      };
    }
  }

  // 4. Selected team matches, feature match (next scheduled, otherwise most recent).
  const selectedTeamMatches = selectedTeam
    ? matches.filter(
        (m) => m.home_team.id === selectedTeam!.id || m.away_team.id === selectedTeam!.id
      )
    : matches;

  const nowSec = Math.floor(Date.now() / 1000);
  const upcomingMatch = selectedTeamMatches.find((m) => {
    const ts = (matchRows as IntlMatchRow[]).find((r) => r.source_match_id === m.id)?.kickoff_unix ?? 0;
    return ts > nowSec && m.status !== 'completed';
  });
  const recentMatch = [...selectedTeamMatches].reverse().find((m) => m.status === 'completed');
  const featureMatch = upcomingMatch ?? recentMatch ?? null;

  // 5. Player match stats - depends on what the page needs.
  //    Strategy: load stats for the relevant scope only.
  //      - if playerId: load that player across all their matches
  //      - else if selectedTeam: load all stats for selectedTeam's matches
  //      - else: load nothing (page renders blank chart, but team list is populated)

  let playerMatchStats: Array<Record<string, unknown>> = [];
  let playerMatches: Array<Record<string, unknown>> = [];

  if (opts.playerId) {
    const { data } = await sb
      .from('international_player_match_stats')
      .select('*')
      .eq('source', source)
      .eq('source_player_id', String(opts.playerId));
    playerMatchStats = (data as IntlStatRow[] | null ?? []).map(normalizeStatRow);
    // Backfill any matches not already in `matches` so the UI can render them.
    const knownIds = new Set(matches.map((m) => String(m.id)));
    const missing = Array.from(
      new Set(playerMatchStats.map((r) => String(r.match_id)).filter((id) => !knownIds.has(id)))
    );
    if (missing.length) {
      const { data: extra } = await sb
        .from('international_matches')
        .select(
          INTL_MATCH_SELECT
        )
        .eq('source', source)
        .in('source_match_id', missing);
      playerMatches = (extra as IntlMatchRow[] | null ?? []).map((m) => {
        const home = synthTeam(m.home_team_source_id, m.home_team_name, teamByIdLocal);
        const away = synthTeam(m.away_team_source_id, m.away_team_name, teamByIdLocal);
        return {
          id: m.source_match_id,
          datetime: m.match_date
            ? new Date(`${m.match_date}T${secondsToTimeOfDay(m.kickoff_unix)}`).toISOString()
            : null,
          status: 'completed',
          home_team: home,
          away_team: away,
          homeTeam: home,
          awayTeam: away,
          homeLabel: home.name,
          awayLabel: away.name,
          homeScore: m.home_score,
          awayScore: m.away_score,
          home_score: m.home_score,
          away_score: m.away_score,
          ...mapIntlMatchPenaltyFields(m),
          source: m.source,
        };
      });
    }
  } else if (selectedTeam) {
    const matchIds = selectedTeamMatches.map((m) => String(m.id));
    if (matchIds.length) {
      const { data } = await sb
        .from('international_player_match_stats')
        .select('*')
        .eq('source', source)
        .in('source_match_id', matchIds);
      playerMatchStats = (data as IntlStatRow[] | null ?? []).map(normalizeStatRow);
    }
  }

  // 6. Rosters: derive from international_players + recent appearances.
  let rosters: Array<Record<string, unknown>> = [];
  if (selectedTeam) {
    const matchIds = selectedTeamMatches.map((m) => String(m.id));
    if (matchIds.length) {
      const { data: teamStats } = await sb
        .from('international_player_match_stats')
        .select('source_player_id, position, is_home, source_team_id')
        .eq('source', source)
        .eq('source_team_id', String(selectedTeam.id))
        .in('source_match_id', matchIds);
      const playerIds = Array.from(
        new Set((teamStats as Array<{ source_player_id: string }> | null ?? []).map((r) => r.source_player_id))
      );
      if (playerIds.length) {
        const { data: playerRows } = await sb
          .from('international_players')
          .select('source, source_player_id, full_name, primary_position, country_code')
          .eq('source', source)
          .in('source_player_id', playerIds);
        const profile = new Map<string, IntlPlayerRow>();
        for (const p of (playerRows as IntlPlayerRow[]) ?? []) profile.set(p.source_player_id, p);
        rosters = playerIds.map((pid) => {
          const p = profile.get(pid);
          const pos = p?.primary_position ?? null;
          return {
            player_id: pid,
            player: { id: pid, name: p?.full_name ?? `player-${pid}` },
            position: pos,
            team_id: String(selectedTeam!.id),
            team: { id: String(selectedTeam!.id), name: selectedTeam!.name },
            jersey_number: null,
          };
        });
      }
    }
  }

  return {
    season: opts.competition === 'euros' ? 2024 : 2024,
    teams,
    standings: [] as Array<Record<string, unknown>>,
    matches,
    playerMatches,
    selectedTeam,
    featureMatch,
    selectedTeamMatches,
    rosters,
    teamMatchStats: [] as Array<Record<string, unknown>>,
    playerMatchStats,
    lineups: [] as Array<Record<string, unknown>>,
    events: [] as Array<Record<string, unknown>>,
    shots: [] as Array<Record<string, unknown>>,
    playerShots: [] as Array<Record<string, unknown>>,
    momentum: [] as Array<Record<string, unknown>>,
    bestPlayers: [] as Array<Record<string, unknown>>,
    avgPositions: [] as Array<Record<string, unknown>>,
    teamForm: [] as Array<Record<string, unknown>>,
    odds: [] as Array<Record<string, unknown>>,
    futures: [] as Array<Record<string, unknown>>,
  };
}

/** Normalize an `international_player_match_stats` row to the BDL key set. */
function normalizeStatRow(row: IntlStatRow): Record<string, unknown> {
  const raw = (row.raw_aggregates ?? {}) as Record<string, number | string | boolean | null>;
  const num = (v: unknown): number | null => {
    const parsed = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  // Cap minutes at 120 (full extra time). StatsBomb's lineup timestamps
  // occasionally parse as huge values (e.g. 3904) due to format quirks; cap
  // here so the UI never shows impossible totals.
  const rawMinutes = num(row.minutes_played);
  const cappedMinutes = rawMinutes == null ? null : Math.min(rawMinutes, 120);
  return {
    match_id: row.source_match_id,
    source: row.source,
    player_id: row.source_player_id,
    player: { id: row.source_player_id },
    team_id: row.source_team_id,
    is_home: row.is_home,
    position: row.position,
    minutes_played: cappedMinutes,
    goals: num(row.goals) ?? 0,
    assists: num(row.assists) ?? 0,
    shots_total: num(row.shots_total) ?? 0,
    shots_on_target: num(row.shots_on_target) ?? 0,
    derived_shots_total: num(row.shots_total) ?? 0,
    passes_total: num(row.passes_total) ?? 0,
    passes_accurate: num(row.passes_accurate) ?? 0,
    expected_goals: num(row.expected_goals),
    yellow_cards: num(row.yellow_cards) ?? 0,
    red_cards: num(row.red_cards) ?? 0,
    tackles: num(row.tackles) ?? 0,
    interceptions: num(row.interceptions) ?? 0,
    fouls: num(row.fouls) ?? 0,
    fouls_committed: num(row.fouls) ?? 0,
    was_fouled: num(row.was_fouled) ?? 0,
    saves: num(row.saves) ?? 0,
    big_chances_created: num(row.big_chances_created) ?? 0,
    key_passes: num(raw.key_passes),
    duels_total: num(raw.duels_total),
    duels_won: num(raw.duels_won),
    dribbles_attempted: num(raw.dribbles_attempted),
    dribbles_completed: num(raw.dribbles_completed),
    clearances: num(raw.clearances) ?? 0,
    offsides: num(raw.offsides),
  };
}

function synthTeam(
  id: string,
  name: string,
  teamLookup: Map<string, IntlTeamRow>
): {
  id: string;
  name: string;
  abbreviation: string;
  country_code: string | null;
} {
  const row = teamLookup.get(id);
  return {
    id,
    name,
    abbreviation: deriveAbbreviation(name, row?.country_code ?? null),
    country_code: row?.country_code ?? null,
  };
}

function deriveAbbreviation(name: string, countryCode: string | null): string {
  if (countryCode && countryCode.length >= 2) return countryCode.toUpperCase();
  const trimmed = (name || '').trim();
  if (!trimmed) return 'TBD';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 3).toUpperCase();
  return parts
    .slice(0, 3)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase();
}

function secondsToTimeOfDay(unixSec: number | null | undefined): string {
  if (!unixSec || !Number.isFinite(unixSec)) return '00:00:00Z';
  const d = new Date(unixSec * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}:00Z`;
}

/**
 * Quick player search across StatsBomb + API-Football. Used by the
 * international-aware player search endpoint.
 */
export async function searchInternationalPlayers(opts: {
  competition: InternationalCompetition | 'all';
  query: string;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    name: string;
    short_name: string;
    position: string | null;
    country_name: string;
    country_code: string | null;
    jersey_number: number | null;
    source: string;
    competition: 'euros' | 'nations-league';
  }>
> {
  const sb = supabaseAdmin;
  const norm = normalizeWorldCupPlayerName(opts.query);
  if (!norm) return [];

  const sources =
    opts.competition === 'all'
      ? ['statsbomb', 'api-football', 'sofascore']
      : [COMPETITION_TO_SOURCE[opts.competition]];

  const limit = Math.min(opts.limit ?? 25, 50);

  const { data } = await sb
    .from('international_players')
    .select('source, source_player_id, full_name, normalized_name, primary_position, country_code')
    .in('source', sources)
    .ilike('normalized_name', `%${norm}%`)
    .limit(limit);

  return (data ?? []).map((row) => {
    const r = row as {
      source: string;
      source_player_id: string;
      full_name: string;
      primary_position: string | null;
      country_code: string | null;
    };
    return {
      id: r.source_player_id,
      name: r.full_name,
      short_name: shortNameFromFull(r.full_name),
      position: r.primary_position,
      country_name: r.country_code || '',
      country_code: r.country_code,
      jersey_number: null,
      source: r.source,
      competition: r.source === 'statsbomb' ? 'euros' : 'nations-league',
    };
  });
}

function shortNameFromFull(full: string): string {
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 3).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/**
 * Find all international stat rows + matches across BOTH StatsBomb and
 * API-Football for any player matching the given full name. Used by the
 * dashboard so the main chart shows every game we have for that player.
 */
export async function loadInternationalStatsByPlayerName(
  playerName: string,
  opts: { bdlPlayerId?: string | null } = {}
): Promise<{
  playerMatchStats: Array<Record<string, unknown>>;
  matches: Array<Record<string, unknown>>;
}> {
  const sb = supabaseAdmin;
  const norm = normalizeWorldCupPlayerName(playerName);
  if (!norm) return { playerMatchStats: [], matches: [] };

  // Match the exact normalized name plus any curated same-person aliases
  // (e.g. "erling haaland" also pulls "erling braut haaland").
  const matchNames = [norm, ...getWorldCupNameAliases(norm)];

  const { data: matchedPlayers } = await sb
    .from('international_players')
    .select('source, source_player_id, full_name')
    .in('normalized_name', matchNames)
    .in('source', ['statsbomb', 'api-football', 'sofascore']);

  if (process.env.WC_CACHE_DEBUG === '1') {
    console.log('[loadIntlStatsByName] player:', playerName, '| searched:', matchNames, '| found:', (matchedPlayers ?? []).map(p => `${p.source}:${p.full_name}`));
  }

  let players = (matchedPlayers ?? []) as Array<{
    source: string;
    source_player_id: string;
    full_name: string;
  }>;

  // Collision overrides: when this name maps to multiple different people,
  // drop the international identities that belong to someone else and pull in
  // any explicitly pinned ones for the selected World Cup player.
  const override = getWorldCupPlayerOverride(opts.bdlPlayerId);
  if (override?.excludeIntlIds?.length) {
    const excluded = new Set(override.excludeIntlIds.map((r) => `${r.source}:${r.id}`));
    players = players.filter((p) => !excluded.has(`${p.source}:${p.source_player_id}`));
  }
  if (override?.includeIntlIds?.length) {
    const present = new Set(players.map((p) => `${p.source}:${p.source_player_id}`));
    for (const ref of override.includeIntlIds) {
      const key = `${ref.source}:${ref.id}`;
      if (!present.has(key)) {
        players.push({ source: ref.source, source_player_id: ref.id, full_name: playerName });
        present.add(key);
      }
    }
  }

  if (!players.length) return { playerMatchStats: [], matches: [] };

  // Group by source for batched queries.
  const idsBySource = new Map<string, string[]>();
  for (const p of players) {
    const ids = idsBySource.get(p.source) ?? [];
    ids.push(p.source_player_id);
    idsBySource.set(p.source, ids);
  }

  const allStats: Array<Record<string, unknown>> = [];
  const matchIdsBySource = new Map<string, Set<string>>();

  const statsBySource = await Promise.all(
    Array.from(idsBySource.entries()).map(async ([source, ids]) => {
      const { data } = await sb
        .from('international_player_match_stats')
        .select('*')
        .eq('source', source)
        .in('source_player_id', ids);
      return { source, rows: (data as IntlStatRow[] | null) ?? [] };
    })
  );
  for (const { source, rows } of statsBySource) {
    allStats.push(...rows.map(normalizeStatRow));
    const set = matchIdsBySource.get(source) ?? new Set<string>();
    for (const r of rows) set.add(r.source_match_id);
    matchIdsBySource.set(source, set);
  }

  // Fetch the corresponding match rows for context (datetime, teams, score).
  // Also fetch team metadata so we can resolve country codes for the chart's
  // x-axis flags.
  const allMatches: Array<Record<string, unknown>> = [];
  const matchBundles = await Promise.all(
    Array.from(matchIdsBySource.entries()).map(async ([source, ids]) => {
      if (!ids.size) {
        return {
          source,
          rows: [] as Array<{
            source_match_id: string;
            match_date: string | null;
            kickoff_unix: number | null;
            stage: string | null;
            season_year: number;
            home_team_source_id: string;
            away_team_source_id: string;
            home_team_name: string;
            away_team_name: string;
            home_score: number | null;
            away_score: number | null;
            home_score_penalty?: number | null;
            away_score_penalty?: number | null;
            has_penalty_shootout?: boolean | null;
            status: string | null;
            tournament_slug: string;
          }>,
          teamData: [] as Array<{
            source_team_id: string;
            country_code: string | null;
            team_name: string;
          }>,
        };
      }
      const { data } = await sb
        .from('international_matches')
        .select(`${INTL_MATCH_SELECT}, tournament_slug`)
        .eq('source', source)
        .in('source_match_id', Array.from(ids));
      const rows = (data ?? []) as Array<{
        home_team_source_id: string;
        away_team_source_id: string;
        source_match_id: string;
        match_date: string | null;
        kickoff_unix: number | null;
        stage: string | null;
        season_year: number;
        home_team_name: string;
        away_team_name: string;
        home_score: number | null;
        away_score: number | null;
        home_score_penalty?: number | null;
        away_score_penalty?: number | null;
        has_penalty_shootout?: boolean | null;
        status: string | null;
        tournament_slug: string;
      }>;
      const teamIds = new Set<string>();
      for (const r of rows) {
        teamIds.add(r.home_team_source_id);
        teamIds.add(r.away_team_source_id);
      }
      const { data: teamData } = teamIds.size
        ? await sb
            .from('international_teams')
            .select('source_team_id, country_code, team_name')
            .eq('source', source)
            .in('source_team_id', Array.from(teamIds))
        : { data: [] };
      return { source, rows, teamData: (teamData ?? []) as Array<{
        source_team_id: string;
        country_code: string | null;
        team_name: string;
      }> };
    })
  );

  for (const { source, rows, teamData } of matchBundles) {
    const teamMeta = new Map<string, { country_code: string | null; name: string }>();
    for (const t of teamData) {
      teamMeta.set(t.source_team_id, {
        country_code: t.country_code,
        name: t.team_name,
      });
    }
    for (const row of rows) {
      const homeMeta = teamMeta.get(row.home_team_source_id);
      const awayMeta = teamMeta.get(row.away_team_source_id);
      const home = {
        id: row.home_team_source_id,
        name: row.home_team_name,
        country_code: homeMeta?.country_code ?? null,
      };
      const away = {
        id: row.away_team_source_id,
        name: row.away_team_name,
        country_code: awayMeta?.country_code ?? null,
      };
      allMatches.push({
        id: row.source_match_id,
        datetime: row.match_date
          ? new Date(`${row.match_date}T${secondsToTimeOfDay(row.kickoff_unix)}`).toISOString()
          : null,
        status: row.status || 'completed',
        season: { year: row.season_year },
        stage: { name: row.stage ?? null },
        home_team: home,
        away_team: away,
        homeTeam: home,
        awayTeam: away,
        homeLabel: home.name,
        awayLabel: away.name,
        homeScore: row.home_score,
        awayScore: row.away_score,
        home_score: row.home_score,
        away_score: row.away_score,
        ...mapIntlMatchPenaltyFields(row),
        tournament_slug: row.tournament_slug,
        source,
      });
    }
  }

  const matchById = new Map(
    allMatches.map((match) => [String((match as { id?: unknown }).id ?? ''), match])
  );
  const enrichedStats = allStats.map((row) => {
    const match = matchById.get(String(row.match_id ?? ''));
    if (!match || typeof match !== 'object') return row;
    const matchRecord = match as Record<string, unknown>;
    return {
      ...row,
      tournament_slug:
        (row as Record<string, unknown>).tournament_slug ?? matchRecord.tournament_slug ?? null,
      source: (row as Record<string, unknown>).source ?? matchRecord.source ?? null,
    };
  });

  return { playerMatchStats: enrichedStats, matches: allMatches };
}

/**
 * DVP for international competitions. Buckets every player with at least
 * one stat into DEF/MID/ATT and computes per-opponent averages.
 */
export async function loadInternationalDvp(opts: {
  competition: InternationalCompetition;
  seasonYear: number;
  position: 'DEF' | 'MID' | 'ATT';
  requestedStats: string[];
}): Promise<{
  opponents: string[];
  samples: Record<string, number>;
  teamGames: Record<string, number>;
  metrics: Record<string, Record<string, number>>;
}> {
  const source = COMPETITION_TO_SOURCE[opts.competition];
  const sb = supabaseAdmin;

  const { data: matches } = await sb
    .from('international_matches')
    .select(
      'source_match_id, home_team_source_id, away_team_source_id, home_team_name, away_team_name, season_year, status'
    )
    .eq('source', source)
    .eq('tournament_slug', opts.competition)
    .eq('season_year', opts.seasonYear);

  const completed = (matches ?? []).filter(
    (m) => (m as { status: string | null }).status === 'completed' || true
  ) as Array<{
    source_match_id: string;
    home_team_source_id: string;
    away_team_source_id: string;
    home_team_name: string;
    away_team_name: string;
  }>;

  if (!completed.length) {
    return { opponents: [], samples: {}, teamGames: {}, metrics: {} };
  }

  const matchIds = completed.map((m) => m.source_match_id);
  const matchById = new Map<string, (typeof completed)[number]>();
  for (const m of completed) matchById.set(m.source_match_id, m);

  // Track team games-played counts for each team
  const teamGamesByName = new Map<string, number>();
  for (const m of completed) {
    teamGamesByName.set(m.home_team_name, (teamGamesByName.get(m.home_team_name) ?? 0) + 1);
    teamGamesByName.set(m.away_team_name, (teamGamesByName.get(m.away_team_name) ?? 0) + 1);
  }

  const { data: stats } = await sb
    .from('international_player_match_stats')
    .select('*')
    .eq('source', source)
    .in('source_match_id', matchIds);

  // Bucket every player into DEF/MID/ATT using position string heuristics.
  type StatRow = IntlStatRow & { source_match_id: string; source_team_id: string };
  const byBucketByOpponent = new Map<string, { sums: Record<string, number>; count: number }>();
  // key = opponentTeamName

  for (const raw of (stats ?? []) as StatRow[]) {
    const bucket = bucketPosition(raw.position, raw);
    if (bucket !== opts.position) continue;
    const m = matchById.get(raw.source_match_id);
    if (!m) continue;
    const opponentName =
      raw.source_team_id === m.home_team_source_id ? m.away_team_name : m.home_team_name;
    if (!opponentName) continue;

    let entry = byBucketByOpponent.get(opponentName);
    if (!entry) {
      entry = { sums: {}, count: 0 };
      byBucketByOpponent.set(opponentName, entry);
    }
    entry.count += 1;
    for (const stat of opts.requestedStats) {
      const v = (raw as unknown as Record<string, number | null>)[stat];
      if (typeof v === 'number' && Number.isFinite(v)) {
        entry.sums[stat] = (entry.sums[stat] ?? 0) + v;
      }
    }
  }

  const opponents = Array.from(byBucketByOpponent.keys()).sort();
  const samples: Record<string, number> = {};
  const teamGames: Record<string, number> = {};
  const metrics: Record<string, Record<string, number>> = {};
  for (const stat of opts.requestedStats) metrics[stat] = {};

  for (const opp of opponents) {
    const entry = byBucketByOpponent.get(opp)!;
    samples[opp] = entry.count;
    teamGames[opp] = teamGamesByName.get(opp) ?? 0;
    for (const stat of opts.requestedStats) {
      const sum = entry.sums[stat] ?? 0;
      const games = teamGames[opp] || 1;
      metrics[stat]![opp] = Number((sum / games).toFixed(3));
    }
  }

  return { opponents, samples, teamGames, metrics };
}

export type WorldCupDvpAggregateResult = {
  opponents: string[];
  samples: Record<string, number>;
  teamGames: Record<string, number>;
  totalGames: Record<string, number>;
  names: Record<string, string>;
  metrics: Record<string, Record<string, number>>;
};

// Canonical stat sets + windows for the aggregate DVP. These MUST match the keys
// the World Cup dashboard requests (see WORLD_CUP_DVP_METRICS / _GK_METRICS in
// app/world-cup/page.tsx) so the precompute script warms the exact cache entries
// the UI reads.
export const WC_DVP_WINDOWS = [5, 10, 0] as const;
export const WC_DVP_OUTFIELD_STATS = [
  'goals',
  'assists',
  'shots_total',
  'shots_on_target',
  'passes_accurate',
  'yellow_cards',
  'red_cards',
] as const;
export const WC_DVP_GK_STATS = ['saves', 'goals_conceded', 'passes_accurate', 'yellow_cards'] as const;
export const WC_DVP_POSITIONS: IntlPositionBucket[] = ['GK', 'DEF', 'MID', 'FWD'];
const WC_DVP_CACHE_PREFIX = 'wc:dvp-aggregate:v6';

/** Canonical stat keys the UI requests for a given position bucket. */
export function getWorldCupDvpStats(position: IntlPositionBucket): string[] {
  return position === 'GK' ? [...WC_DVP_GK_STATS] : [...WC_DVP_OUTFIELD_STATS];
}

/** Stable Supabase cache key for one position+window+stats combination. */
export function buildWorldCupDvpCacheKey(
  position: string,
  window: number,
  stats: string[]
): string {
  return `${WC_DVP_CACHE_PREFIX}:${position}:w${window}:${stats.join(',')}`;
}

type DvpMatchRow = {
  source: string;
  source_match_id: string;
  home_team_source_id: string;
  away_team_source_id: string;
  home_team_name: string;
  away_team_name: string;
  home_score: number | null;
  away_score: number | null;
  match_date: string | null;
  kickoff_unix: number | null;
  tournament_slug?: string | null;
  status?: string | null;
  season_year?: number | null;
  stage?: string | null;
};

const COMPLETED_MATCH_STATUSES = new Set(['completed', 'finished', 'ft']);

/** True when the match is a completed FIFA World Cup finals game (not WCQ, Euros, etc.). */
export function isCompletedWorldCupFinalsMatch(m: DvpMatchRow): boolean {
  const slug = String(m.tournament_slug ?? '').toLowerCase();
  const isWorldCup =
    slug === 'worldcup' || slug === 'world-cup' || m.source === BDL_DVP_SOURCE;
  if (!isWorldCup) return false;
  if (m.source === BDL_DVP_SOURCE) return true;
  const status = String(m.status ?? 'completed').toLowerCase();
  return COMPLETED_MATCH_STATUSES.has(status);
}
type DvpStatRow = IntlStatRow & { id?: number };

/**
 * The shared, window/position-independent inputs for the aggregate DVP: every
 * national-team match, every player-match stat row, and the canonical position
 * label for each player. Loaded ONCE (heavy DB scan) and reused to aggregate any
 * number of position/window combinations in memory.
 */
export type WorldCupDvpSource = {
  matchInfo: Map<string, DvpMatchRow>;
  /** slug -> that nation's matches, sorted newest-first (for windowing). */
  teamMatchesBySlug: Map<string, Array<{ key: string; ts: number }>>;
  slugNames: Map<string, string>;
  statRows: DvpStatRow[];
  positionMap: Map<string, IntlPositionBucket>;
};

const dvpMatchKey = (source: string, id: string) => `${source}:${id}`;
// Unify a nation across sources by FIFA slug (same join the Opponent Breakdown
// uses), falling back to the normalized name when no slug resolves.
const dvpTeamSlug = (name: string): string =>
  resolveWorldCupFlagCode(name) || name.trim().toLowerCase();

const BDL_DVP_SOURCE = 'bdl';
const BDL_FIFA_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';
const BDL_DVP_SEASONS = [2018, 2022, 2026] as const;

function dvpStatNum(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function getBdlDvpApiKey(): string {
  return (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
}

function bdlDvpAuthCandidates(apiKey: string): string[] {
  if (!apiKey) return [];
  if (apiKey.startsWith('Bearer ')) {
    const plain = apiKey.replace(/^Bearer\s+/i, '').trim();
    return [plain, apiKey].filter(Boolean);
  }
  return [apiKey, `Bearer ${apiKey}`];
}

const bdlDvpSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function bdlDvpFetchAll<T>(
  path: string,
  baseParams: URLSearchParams,
  apiKey: string,
  maxPages = 8
): Promise<T[]> {
  const rows: T[] = [];
  const auths = bdlDvpAuthCandidates(apiKey);
  let cursor: string | number | null = null;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams(baseParams);
    if (!params.has('per_page')) params.set('per_page', '100');
    if (cursor != null) params.set('cursor', String(cursor));
    const url = `${BDL_FIFA_BASE}${path}?${params.toString()}`;

    let payload: { data?: T[]; meta?: { next_cursor?: number | string | null } } | null = null;
    for (const auth of auths.length ? auths : ['']) {
      let ok = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        try {
          const res = await fetch(url, {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'StatTrackr/1.0',
              ...(auth ? { Authorization: auth } : {}),
            },
            cache: 'no-store',
            signal: ctrl.signal,
          });
          if (res.ok) {
            payload = await res.json();
            ok = true;
            break;
          }
          if ((res.status === 429 || res.status >= 500) && attempt < 2) {
            await bdlDvpSleep(500 + attempt * 600);
            continue;
          }
          break;
        } catch {
          if (attempt < 2) {
            await bdlDvpSleep(400 + attempt * 600);
            continue;
          }
          break;
        } finally {
          clearTimeout(timer);
        }
      }
      if (ok) break;
    }

    if (!payload) break;
    rows.push(...(Array.isArray(payload.data) ? payload.data : []));
    cursor = payload.meta?.next_cursor ?? null;
    if (!cursor) break;
  }

  return rows;
}

type BdlDvpMatch = {
  id: number;
  datetime?: string | null;
  status?: string | null;
  stage?: { id?: number; name?: string; order?: number } | null;
  home_team?: { id: number; name: string } | null;
  away_team?: { id: number; name: string } | null;
  home_score?: number | null;
  away_score?: number | null;
};

/** True for completed BDL FIFA World Cup finals matches (group / knockouts), not friendlies or qualifiers. */
export function isBdlWorldCupTournamentStage(stageName: string | null | undefined): boolean {
  if (!stageName) return false;
  const s = stageName.toLowerCase().trim();
  if (!s) return false;
  if (s.includes('friendly')) return false;
  if (s.includes('qualif')) return false;
  if (s.includes('playoff') || s.includes('play-off')) return false;
  if (s.includes('group') || s.includes('league')) return true;
  if (s.includes('round of 16') || s.includes('last 16') || s.includes('1/8') || s.includes('eighth')) return true;
  if (s.includes('quarter') || /\bqf\b/.test(s)) return true;
  if (s.includes('semi')) return true;
  if ((s.includes('third') || s.includes('3rd')) && s.includes('place')) return true;
  if (s.includes('final')) return true;
  return false;
}

function bdlMatchToDvpRow(match: BdlDvpMatch): DvpMatchRow | null {
  const homeId = match.home_team?.id;
  const awayId = match.away_team?.id;
  const homeName = match.home_team?.name?.trim();
  const awayName = match.away_team?.name?.trim();
  if (!Number.isFinite(homeId) || !Number.isFinite(awayId) || !homeName || !awayName) return null;
  const kickoffMs = match.datetime ? Date.parse(match.datetime) : NaN;
  const seasonYear = Number.isFinite(kickoffMs) ? new Date(kickoffMs).getUTCFullYear() : null;
  return {
    source: BDL_DVP_SOURCE,
    source_match_id: String(match.id),
    home_team_source_id: String(homeId),
    away_team_source_id: String(awayId),
    home_team_name: homeName,
    away_team_name: awayName,
    home_score: match.home_score ?? null,
    away_score: match.away_score ?? null,
    match_date: match.datetime ?? null,
    kickoff_unix: Number.isFinite(kickoffMs) ? Math.floor(kickoffMs / 1000) : null,
    tournament_slug: 'worldcup',
    status: 'completed',
    season_year: seasonYear,
    stage: match.stage?.name ?? null,
  };
}

function bdlPlayerStatToDvpRow(
  row: Record<string, unknown>,
  opts?: { lineupPositionByPair?: Map<string, string>; lineupOnly?: boolean }
): DvpStatRow | null {
  const matchId = row.match_id;
  const playerId = row.player_id;
  const teamId = row.team_id;
  if (matchId == null || playerId == null || teamId == null) return null;

  const minutes = dvpStatNum(row.minutes_played);
  const hasAppearance =
    (minutes != null && minutes > 0) ||
    dvpStatNum(row.goals) != null ||
    dvpStatNum(row.assists) != null ||
    dvpStatNum(row.shots_total) != null ||
    dvpStatNum(row.saves) != null;
  if (!hasAppearance) return null;

  const lineupPos = opts?.lineupPositionByPair?.get(`${matchId}:${playerId}`) ?? null;
  const statPos = typeof row.position === 'string' ? row.position : null;
  const position = opts?.lineupOnly ? lineupPos : statPos;
  if (opts?.lineupOnly && !position) return null;

  return {
    source: BDL_DVP_SOURCE,
    source_match_id: String(matchId),
    source_player_id: String(playerId),
    source_team_id: String(teamId),
    is_home: row.is_home === true,
    position,
    minutes_played: minutes,
    goals: dvpStatNum(row.goals),
    assists: dvpStatNum(row.assists),
    shots_total: dvpStatNum(row.shots_total) ?? dvpStatNum(row.derived_shots_total),
    shots_on_target: dvpStatNum(row.shots_on_target),
    passes_total: dvpStatNum(row.passes_total) ?? dvpStatNum(row.passes),
    passes_accurate: dvpStatNum(row.passes_accurate),
    expected_goals: dvpStatNum(row.expected_goals) ?? dvpStatNum(row.expected_goals_xg),
    yellow_cards: dvpStatNum(row.yellow_cards),
    red_cards: dvpStatNum(row.red_cards),
    tackles: dvpStatNum(row.tackles),
    interceptions: dvpStatNum(row.interceptions),
    fouls: dvpStatNum(row.fouls) ?? dvpStatNum(row.fouls_committed),
    was_fouled: dvpStatNum(row.was_fouled) ?? dvpStatNum(row.fouls_suffered),
    saves: dvpStatNum(row.saves),
    big_chances_created: dvpStatNum(row.big_chances_created),
    raw_aggregates: null,
  };
}

function bdlLineupRowPlayerId(row: Record<string, unknown>): number | null {
  const nested = row.player && typeof row.player === 'object' ? (row.player as Record<string, unknown>) : null;
  const playerId = Number(row.player_id ?? nested?.id);
  return Number.isFinite(playerId) ? playerId : null;
}

function buildBdlLineupPositionMap(lineups: Array<Record<string, unknown>>): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of lineups) {
    const matchId = Number(row.match_id);
    const playerId = bdlLineupRowPlayerId(row);
    if (!Number.isFinite(matchId) || playerId == null) continue;
    const pos = String(row.position ?? '').trim();
    if (!pos) continue;
    // Starters and subs share the same position field on BDL lineup rows.
    map.set(`${matchId}:${playerId}`, pos);
  }
  return map;
}

async function fetchBdlLineupPositionMap(
  matchIds: number[],
  apiKey: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < matchIds.length; i += 50) {
    const chunk = matchIds.slice(i, i + 50);
    const params = new URLSearchParams();
    chunk.forEach((id) => params.append('match_ids[]', String(id)));
    const rows = await bdlDvpFetchAll<Record<string, unknown>>('/match_lineups', params, apiKey, 8);
    for (const [key, pos] of buildBdlLineupPositionMap(rows)) map.set(key, pos);
  }
  return map;
}

/**
 * BDL FIFA World Cup finals (2018/2022/2026) player-match stats are not stored
 * in `international_*` — they live only on the BDL API. Merge them here so DVP
 * windowing includes the latest completed World Cup games (e.g. 2026 friendlies /
 * group openers) exactly like Opponent Breakdown does for team stats.
 */
/**
 * Fetch only 2026 World Cup matches + player stats from BDL — used by the
 * WC-only DVP filter so we don't need the full loadWorldCupDvpSource() pipeline.
 * Much faster since it skips Supabase and only fetches one season.
 */
const BDL_DVP_SUPPLEMENT_CACHE_KEY = 'wc:bdl-dvp-supplement:v5';
const BDL_WC2026_DVP_RAW_CACHE_KEY = 'wc:dvp-wc2026:raw:v4';

export async function loadBdlWc2026DvpData(opts?: { skipCache?: boolean }): Promise<{
  matches: DvpMatchRow[];
  statRows: DvpStatRow[];
  /** Slugs of every team that has played ≥1 completed WC 2026 game. */
  teamsWithGames: Set<string>;
}> {
  if (!opts?.skipCache) {
    const cached = await getWorldCupCache<{
      matches: DvpMatchRow[];
      statRows: DvpStatRow[];
      teamsWithGames: string[];
    }>(BDL_WC2026_DVP_RAW_CACHE_KEY);
    if (cached?.matches?.length && (cached.statRows?.length ?? 0) > 0) {
      return {
        matches: cached.matches,
        statRows: cached.statRows,
        teamsWithGames: new Set(cached.teamsWithGames ?? []),
      };
    }
  }

  const apiKey = getBdlDvpApiKey();
  if (!apiKey) return { matches: [], statRows: [], teamsWithGames: new Set() };

  const seasonsParam = new URLSearchParams();
  seasonsParam.append('seasons[]', '2026');
  const rawMatches = await bdlDvpFetchAll<BdlDvpMatch>('/matches', seasonsParam, apiKey, 8);
  const completed = rawMatches.filter(
    (match) => match.status === 'completed' && isBdlWorldCupTournamentStage(match.stage?.name)
  );
  const matches = completed.map(bdlMatchToDvpRow).filter((row): row is DvpMatchRow => row != null);
  if (!matches.length) return { matches: [], statRows: [], teamsWithGames: new Set() };

  // Build position-agnostic "teams that have played" set — both home and away
  // for every completed match, so "has played" check is independent of position.
  const teamsWithGames = new Set<string>();
  for (const m of matches) {
    const homeSlug = dvpTeamSlug(m.home_team_name);
    const awaySlug = dvpTeamSlug(m.away_team_name);
    if (homeSlug) teamsWithGames.add(homeSlug);
    if (awaySlug) teamsWithGames.add(awaySlug);
  }

  const statRows: DvpStatRow[] = [];
  const matchIds = completed.map((m) => m.id).filter((id) => Number.isFinite(id));
  const lineupPositionByPair = await fetchBdlLineupPositionMap(matchIds, apiKey);
  let rawStatCount = 0;
  for (let i = 0; i < matchIds.length; i += 50) {
    const chunk = matchIds.slice(i, i + 50);
    const params = new URLSearchParams();
    chunk.forEach((id) => params.append('match_ids[]', String(id)));
    const rows = await bdlDvpFetchAll<Record<string, unknown>>('/player_match_stats', params, apiKey, 8);
    rawStatCount += rows.length;
    for (const row of rows) {
      const mapped = bdlPlayerStatToDvpRow(row, {
        lineupPositionByPair,
        lineupOnly: true,
      });
      if (mapped) statRows.push(mapped);
    }
  }
  if (matches.length && statRows.length === 0) {
    console.warn(
      `[dvp] BDL WC2026: 0 stat rows after lineup join (${rawStatCount} raw stats, ${lineupPositionByPair.size} lineup positions)`
    );
  }

  return { matches, statRows, teamsWithGames };
}

/** Pre-warm BDL 2018/2022/2026 player stats used by DVP + player-vs-pool (all scope). */
export async function warmBdlWorldCupDvpSupplementCache(opts?: { force?: boolean }): Promise<void> {
  if (!opts?.force) {
    const existing = await getWorldCupCache<{ matches: DvpMatchRow[] }>(BDL_DVP_SUPPLEMENT_CACHE_KEY);
    if (existing?.matches?.length) return;
  }
  await loadBdlWorldCupDvpSupplement({ skipCache: true });
}

async function loadBdlWorldCupDvpSupplement(opts?: { skipCache?: boolean }): Promise<{
  matches: DvpMatchRow[];
  statRows: DvpStatRow[];
}> {
  if (!opts?.skipCache) {
    const cached = await getWorldCupCache<{ matches: DvpMatchRow[]; statRows: DvpStatRow[] }>(
      BDL_DVP_SUPPLEMENT_CACHE_KEY
    );
    if (cached?.matches?.length && (cached.statRows?.length ?? 0) > 0) return cached;
  }

  const apiKey = getBdlDvpApiKey();
  if (!apiKey) return { matches: [], statRows: [] };

  const seasonsParam = new URLSearchParams();
  BDL_DVP_SEASONS.forEach((season) => seasonsParam.append('seasons[]', String(season)));
  const rawMatches = await bdlDvpFetchAll<BdlDvpMatch>('/matches', seasonsParam, apiKey, 8);
  const completed = rawMatches.filter((match) => match.status === 'completed');
  const matches = completed
    .map(bdlMatchToDvpRow)
    .filter((row): row is DvpMatchRow => row != null);
  if (!matches.length) return { matches: [], statRows: [] };

  const statRows: DvpStatRow[] = [];
  const matchIds = completed.map((match) => match.id).filter((id) => Number.isFinite(id));
  for (let i = 0; i < matchIds.length; i += 50) {
    const chunk = matchIds.slice(i, i + 50);
    const params = new URLSearchParams();
    chunk.forEach((id) => params.append('match_ids[]', String(id)));
    const rows = await bdlDvpFetchAll<Record<string, unknown>>(
      '/player_match_stats',
      params,
      apiKey,
      8
    );
    for (const row of rows) {
      const mapped = bdlPlayerStatToDvpRow(row);
      if (mapped) statRows.push(mapped);
    }
  }

  const payload = { matches, statRows };
  const ok = await setWorldCupCache(BDL_DVP_SUPPLEMENT_CACHE_KEY, payload);
  if (ok) clearWcBdlSupplementPayloadMem();
  return payload;
}

/**
 * Load every national-team match + player-match stat row (club games excluded)
 * and build the canonical position map. Call once, then pass to
 * `aggregateInternationalDvp` for each position/window.
 *
 * Sources: Supabase `international_*` tables PLUS live BDL World Cup finals
 * player stats (so the most recent WC games count toward L5/L10 windows).
 */
export async function loadWorldCupDvpSource(): Promise<WorldCupDvpSource> {
  const sb = supabaseAdmin;
  const PAGE = 1000;

  // 1. Every national-team match across all sources (club games excluded).
  const matches: DvpMatchRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('international_matches')
      .select(
        'source, source_match_id, home_team_source_id, away_team_source_id, home_team_name, away_team_name, home_score, away_score, match_date, kickoff_unix, tournament_slug, status, season_year'
      )
      .not('tournament_slug', 'like', 'club%')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`DVP matches load failed: ${error.message}`);
    const page = (data ?? []) as DvpMatchRow[];
    matches.push(...page);
    if (page.length < PAGE) break;
  }

  const matchInfo = new Map<string, DvpMatchRow>();
  const matchIdsBySource = new Map<string, string[]>();
  const slugNames = new Map<string, string>();
  const teamMatchesBySlug = new Map<string, Array<{ key: string; ts: number }>>();

  const matchSortTs = (m: DvpMatchRow): number =>
    (typeof m.kickoff_unix === 'number' ? m.kickoff_unix * 1000 : 0) ||
    (m.match_date ? Date.parse(m.match_date) : 0) ||
    0;
  for (const m of matches) {
    const key = dvpMatchKey(m.source, m.source_match_id);
    matchInfo.set(key, m);
    const ids = matchIdsBySource.get(m.source) ?? [];
    ids.push(m.source_match_id);
    matchIdsBySource.set(m.source, ids);
  }

  // 2. All player-match stat rows for those matches (queried by national match
  //    ids per source so club player-games are never pulled). Each chunk is
  //    paginated with .range() because Supabase caps a query at 1000 rows by
  //    default — without paging, a chunk with >1000 player-games silently drops
  //    the overflow (which previously made whole nations disappear from the DVP).
  const statRows: DvpStatRow[] = [];
  const STAT_CHUNK = 100;
  const STAT_PAGE = 1000;
  for (const [source, ids] of matchIdsBySource) {
    for (let i = 0; i < ids.length; i += STAT_CHUNK) {
      const chunk = ids.slice(i, i + STAT_CHUNK);
      for (let from = 0; ; from += STAT_PAGE) {
        const { data, error } = await sb
          .from('international_player_match_stats')
          .select('*')
          .eq('source', source)
          .in('source_match_id', chunk)
          .order('source_match_id', { ascending: true })
          .order('source_player_id', { ascending: true })
          .range(from, from + STAT_PAGE - 1);
        if (error) throw new Error(`DVP stats load failed: ${error.message}`);
        const page = (data ?? []) as DvpStatRow[];
        statRows.push(...page);
        if (page.length < STAT_PAGE) break;
      }
    }
  }

  // 2b. BDL World Cup finals — player stats for completed 2018/2022/2026 games.
  const bdl = await loadBdlWorldCupDvpSupplement();
  for (const m of bdl.matches) {
    const key = dvpMatchKey(m.source, m.source_match_id);
    matchInfo.set(key, m);
  }
  statRows.push(...bdl.statRows);

  // 3. Build each nation's game list from ONLY the matches that actually have
  //    player stats. Windowing/denominators must use games-with-data so "last 5"
  //    means the last 5 games we can measure (and per-game averages aren't
  //    diluted by recent games that have no player-level stats yet).
  const matchesWithStats = new Set<string>();
  for (const row of statRows) {
    matchesWithStats.add(dvpMatchKey(row.source, row.source_match_id));
  }
  const addTeamMatch = (name: string, key: string, ts: number) => {
    const slug = dvpTeamSlug(name);
    if (!slug) return;
    if (!slugNames.has(slug)) slugNames.set(slug, name);
    const list = teamMatchesBySlug.get(slug) ?? [];
    if (list.some((entry) => entry.key === key)) return;
    list.push({ key, ts });
    teamMatchesBySlug.set(slug, list);
  };
  for (const m of matchInfo.values()) {
    const key = dvpMatchKey(m.source, m.source_match_id);
    if (!matchesWithStats.has(key)) continue;
    const ts = matchSortTs(m);
    addTeamMatch(m.home_team_name, key, ts);
    addTeamMatch(m.away_team_name, key, ts);
  }
  for (const list of teamMatchesBySlug.values()) {
    list.sort((a, b) => b.ts - a.ts);
  }

  // 4. Canonical position for every player from their whole sample.
  const positionMap = buildIntlPlayerPositionMap(statRows);

  return { matchInfo, teamMatchesBySlug, slugNames, statRows, positionMap };
}

export const WORLD_CUP_PLAYER_VS_POOL_STAT_KEYS = [
  'goals',
  'assists',
  'shots_total',
  'shots_on_target',
  'fouls',
  'was_fouled',
  'passes_total',
  'yellow_cards',
  'red_cards',
  'saves',
  'goals_conceded',
] as const;

export type WorldCupPlayerPoolStatKey = (typeof WORLD_CUP_PLAYER_VS_POOL_STAT_KEYS)[number];

export type WorldCupPlayerPoolEntry = {
  playerKey: string;
  source: string;
  sourcePlayerId: string;
  teamSlug: string;
  position: IntlPositionBucket | null;
  games: number;
  averages: Partial<Record<WorldCupPlayerPoolStatKey, number>>;
};

function poolStatValue(row: DvpStatRow, stat: WorldCupPlayerPoolStatKey): number | null {
  if (stat === 'fouls') {
    return dvpStatNum(row.fouls) ?? dvpStatNum((row as { fouls_committed?: number | null }).fouls_committed);
  }
  if (stat === 'was_fouled') {
    return dvpStatNum(row.was_fouled) ?? dvpStatNum((row as { fouls_suffered?: number | null }).fouls_suffered);
  }
  if (stat === 'shots_total') {
    return (
      dvpStatNum(row.shots_total) ??
      dvpStatNum((row as { derived_shots_total?: number | null }).derived_shots_total)
    );
  }
  return dvpStatNum((row as unknown as Record<string, number | null | undefined>)[stat]);
}

/**
 * Per-player per-game averages across every international + BDL World Cup player
 * appearance. Powers the Player vs Team rank badges (vs squad / vs tournament).
 */
export function aggregateWorldCupPlayerPool(src: WorldCupDvpSource): WorldCupPlayerPoolEntry[] {
  type Acc = {
    source: string;
    sourcePlayerId: string;
    teamSlug: string;
    position: IntlPositionBucket;
    games: number;
    sums: Partial<Record<WorldCupPlayerPoolStatKey, number>>;
  };
  const buckets = new Map<string, Acc>();

  for (const row of src.statRows) {
    const minutes = row.minutes_played;
    if (minutes != null && minutes < 1) continue;
    const match = src.matchInfo.get(dvpMatchKey(row.source, row.source_match_id));
    if (!match) continue;

    const playerKey = intlPlayerKey(row.source, row.source_player_id);
    const playerIsHome = String(row.source_team_id) === String(match.home_team_source_id);
    const teamName = playerIsHome ? match.home_team_name : match.away_team_name;
    const teamSlug = dvpTeamSlug(teamName);
    if (!teamSlug) continue;

    const position = src.positionMap.get(playerKey) ?? 'MID';
    let acc =
      buckets.get(playerKey) ??
      ({
        source: row.source,
        sourcePlayerId: String(row.source_player_id),
        teamSlug,
        position,
        games: 0,
        sums: {},
      } satisfies Acc);
    acc.games += 1;

    for (const stat of WORLD_CUP_PLAYER_VS_POOL_STAT_KEYS) {
      const value = poolStatValue(row, stat);
      if (value == null) continue;
      acc.sums[stat] = (acc.sums[stat] ?? 0) + value;
    }
    buckets.set(playerKey, acc);
  }

  return [...buckets.values()].map((acc) => ({
    playerKey: intlPlayerKey(acc.source, acc.sourcePlayerId),
    source: acc.source,
    sourcePlayerId: acc.sourcePlayerId,
    teamSlug: acc.teamSlug,
    position: acc.position,
    games: acc.games,
    averages: Object.fromEntries(
      Object.entries(acc.sums).map(([key, total]) => [
        key,
        Number((total / acc.games).toFixed(3)),
      ])
    ) as Partial<Record<WorldCupPlayerPoolStatKey, number>>,
  }));
}

const WC_PLAYER_VS_POOL_CACHE_KEY = 'wc:player-vs-pool:v1';
const WC_PLAYER_VS_POOL_WC_FINALS_CACHE_KEY = 'wc:player-vs-pool:worldcup-finals:v1';

const PLAYER_VS_OPPONENT_ALLOWED_STATS = [
  'goals',
  'shots_total',
  'shots_on_target',
  'fouls',
  'was_fouled',
  'passes_total',
  'yellow_cards',
  'red_cards',
] as const satisfies readonly WorldCupPlayerPoolStatKey[];

/** Rank every qualified nation: #1 = least allowed (toughest, red), #48 = most (easiest, green). Unplayed = 0 allowed. */
export function rankPlayerVsOpponentAllowed(
  values: Record<string, number>,
  qualifiedUniverse: Map<string, string> | Set<string> | undefined,
  games?: Record<string, number>
): Record<string, number> {
  const universe =
    qualifiedUniverse instanceof Map
      ? qualifiedUniverse
      : qualifiedUniverse?.size
        ? new Map([...qualifiedUniverse].map((slug) => [slug, slug]))
        : new Map(Object.keys(values).map((slug) => [slug, slug]));

  const slugs = [...universe.keys()];
  if (!slugs.length) return {};

  const rankEntries = slugs.map((slug) => {
    const hasPlayed = (games?.[slug] ?? 0) >= 1 && Number.isFinite(values[slug]);
    return {
      slug,
      value: hasPlayed ? values[slug]! : 0,
    };
  });

  rankEntries.sort((a, b) => a.value - b.value || a.slug.localeCompare(b.slug));

  return rankOpponentAllowedValues(rankEntries);
}

export function opponentAllowedRankingTotal(
  qualifiedUniverse: Map<string, string> | Set<string> | undefined
): number {
  if (qualifiedUniverse instanceof Map) return qualifiedUniverse.size;
  return qualifiedUniverse?.size ?? 0;
}

function dvpMatchEditionYear(match: DvpMatchRow): number | null {
  if (typeof match.season_year === 'number' && Number.isFinite(match.season_year)) {
    return match.season_year;
  }
  if (typeof match.kickoff_unix === 'number' && Number.isFinite(match.kickoff_unix)) {
    return new Date(match.kickoff_unix * 1000).getUTCFullYear();
  }
  if (match.match_date) {
    const parsed = Date.parse(match.match_date);
    if (Number.isFinite(parsed)) return new Date(parsed).getUTCFullYear();
  }
  return null;
}

/** Keep only matches from one World Cup edition year (e.g. 2026). */
export function filterWorldCupDvpSourceByEditionYear(
  src: WorldCupDvpSource,
  year: number
): WorldCupDvpSource {
  const matchInfo = new Map<string, DvpMatchRow>();
  for (const [key, match] of src.matchInfo) {
    if (dvpMatchEditionYear(match) === year) matchInfo.set(key, match);
  }

  const allowedKeys = new Set(matchInfo.keys());
  const statRows = src.statRows.filter((row) =>
    allowedKeys.has(dvpMatchKey(row.source, row.source_match_id))
  );

  const matchesWithStats = new Set<string>();
  for (const row of statRows) {
    matchesWithStats.add(dvpMatchKey(row.source, row.source_match_id));
  }

  const matchSortTs = (match: DvpMatchRow): number =>
    (typeof match.kickoff_unix === 'number' ? match.kickoff_unix * 1000 : 0) ||
    (match.match_date ? Date.parse(match.match_date) : 0) ||
    0;

  const slugNames = new Map<string, string>();
  const teamMatchesBySlug = new Map<string, Array<{ key: string; ts: number }>>();
  const addTeamMatch = (name: string, key: string, ts: number) => {
    const slug = dvpTeamSlug(name);
    if (!slug) return;
    if (!slugNames.has(slug)) slugNames.set(slug, name);
    const list = teamMatchesBySlug.get(slug) ?? [];
    if (list.some((entry) => entry.key === key)) return;
    list.push({ key, ts });
    teamMatchesBySlug.set(slug, list);
  };

  for (const match of matchInfo.values()) {
    const key = dvpMatchKey(match.source, match.source_match_id);
    if (!matchesWithStats.has(key)) continue;
    const ts = matchSortTs(match);
    addTeamMatch(match.home_team_name, key, ts);
    addTeamMatch(match.away_team_name, key, ts);
  }
  for (const list of teamMatchesBySlug.values()) {
    list.sort((a, b) => b.ts - a.ts);
  }

  return {
    matchInfo,
    teamMatchesBySlug,
    slugNames,
    statRows,
    positionMap: buildIntlPlayerPositionMap(statRows),
  };
}

/** Keep only completed FIFA World Cup finals matches and their player stats. */
export function filterCompletedWorldCupDvpSource(src: WorldCupDvpSource): WorldCupDvpSource {
  const matchInfo = new Map<string, DvpMatchRow>();
  for (const [key, match] of src.matchInfo) {
    if (isCompletedWorldCupFinalsMatch(match)) matchInfo.set(key, match);
  }

  const allowedKeys = new Set(matchInfo.keys());
  const statRows = src.statRows.filter((row) =>
    allowedKeys.has(dvpMatchKey(row.source, row.source_match_id))
  );

  const matchesWithStats = new Set<string>();
  for (const row of statRows) {
    matchesWithStats.add(dvpMatchKey(row.source, row.source_match_id));
  }

  const matchSortTs = (match: DvpMatchRow): number =>
    (typeof match.kickoff_unix === 'number' ? match.kickoff_unix * 1000 : 0) ||
    (match.match_date ? Date.parse(match.match_date) : 0) ||
    0;

  const slugNames = new Map<string, string>();
  const teamMatchesBySlug = new Map<string, Array<{ key: string; ts: number }>>();
  const addTeamMatch = (name: string, key: string, ts: number) => {
    const slug = dvpTeamSlug(name);
    if (!slug) return;
    if (!slugNames.has(slug)) slugNames.set(slug, name);
    const list = teamMatchesBySlug.get(slug) ?? [];
    if (list.some((entry) => entry.key === key)) return;
    list.push({ key, ts });
    teamMatchesBySlug.set(slug, list);
  };

  for (const match of matchInfo.values()) {
    const key = dvpMatchKey(match.source, match.source_match_id);
    if (!matchesWithStats.has(key)) continue;
    const ts = matchSortTs(match);
    addTeamMatch(match.home_team_name, key, ts);
    addTeamMatch(match.away_team_name, key, ts);
  }
  for (const list of teamMatchesBySlug.values()) {
    list.sort((a, b) => b.ts - a.ts);
  }

  return {
    matchInfo,
    teamMatchesBySlug,
    slugNames,
    statRows,
    positionMap: buildIntlPlayerPositionMap(statRows),
  };
}

export type WorldCupPlayerVsOpponentBreakdown = {
  window: number;
  names: Record<string, string>;
  games: Record<string, number>;
  totalGames: Record<string, number>;
  /** Full qualified-nation count used as rank denominator (e.g. 48). */
  rankingTotal: number;
  metrics: Record<string, { values: Record<string, number>; ranks: Record<string, number> }>;
};

/** Opponent allowed averages from completed World Cup finals player stats only. */
export function computeWorldCupPlayerVsOpponentBreakdown(
  src: WorldCupDvpSource,
  opts?: { qualifiedUniverse?: Map<string, string> }
): WorldCupPlayerVsOpponentBreakdown {
  const opponentMatchTotals = new Map<string, Map<string, Record<string, number>>>();
  const slugNames = new Map<string, string>();

  for (const row of src.statRows) {
    const minutes = row.minutes_played;
    if (minutes != null && minutes < 1) continue;
    const key = dvpMatchKey(row.source, row.source_match_id);
    const match = src.matchInfo.get(key);
    if (!match) continue;

    const playerIsHome = String(row.source_team_id) === String(match.home_team_source_id);
    const opponentName = playerIsHome ? match.away_team_name : match.home_team_name;
    const opponentSlug = dvpTeamSlug(opponentName);
    if (!opponentSlug) continue;
    if (!slugNames.has(opponentSlug)) slugNames.set(opponentSlug, opponentName);

    const matchMap = opponentMatchTotals.get(opponentSlug) ?? new Map();
    const matchSums =
      matchMap.get(key) ??
      Object.fromEntries(PLAYER_VS_OPPONENT_ALLOWED_STATS.map((stat) => [stat, 0]));
    for (const stat of PLAYER_VS_OPPONENT_ALLOWED_STATS) {
      const value = poolStatValue(row, stat);
      if (value != null) matchSums[stat] = (matchSums[stat] ?? 0) + value;
    }
    matchMap.set(key, matchSums);
    opponentMatchTotals.set(opponentSlug, matchMap);
  }

  const names: Record<string, string> = {};
  const games: Record<string, number> = {};
  const totalGames: Record<string, number> = {};
  const metrics: WorldCupPlayerVsOpponentBreakdown['metrics'] = {};
  for (const stat of PLAYER_VS_OPPONENT_ALLOWED_STATS) {
    metrics[stat] = { values: {}, ranks: {} };
  }

  for (const [slug, matchMap] of opponentMatchTotals) {
    const gameCount = matchMap.size;
    if (!gameCount) continue;
    names[slug] = slugNames.get(slug) ?? slug;
    games[slug] = gameCount;
    totalGames[slug] = gameCount;
    for (const stat of PLAYER_VS_OPPONENT_ALLOWED_STATS) {
      let sum = 0;
      for (const matchSums of matchMap.values()) {
        sum += matchSums[stat] ?? 0;
      }
      metrics[stat].values[slug] = Number((sum / gameCount).toFixed(3));
    }
  }

  if (opts?.qualifiedUniverse?.size) {
    for (const [slug, displayName] of opts.qualifiedUniverse) {
      if (!names[slug]) names[slug] = displayName;
      if (games[slug] == null) games[slug] = 0;
      if (totalGames[slug] == null) totalGames[slug] = 0;
    }
  }

  for (const stat of PLAYER_VS_OPPONENT_ALLOWED_STATS) {
    metrics[stat].ranks = rankPlayerVsOpponentAllowed(
      metrics[stat].values,
      opts?.qualifiedUniverse,
      games
    );
  }

  const rankingTotal =
    opponentAllowedRankingTotal(opts?.qualifiedUniverse) || Object.keys(names).length;
  return { window: 0, names, games, totalGames, rankingTotal, metrics };
}

/** Seed every qualified nation into the breakdown and re-rank across the full universe. */
export function expandWorldCupOpponentBreakdownUniverse(
  breakdown: WorldCupPlayerVsOpponentBreakdown,
  qualifiedUniverse: Map<string, string>
): WorldCupPlayerVsOpponentBreakdown {
  if (!qualifiedUniverse.size) return breakdown;

  const names = { ...breakdown.names };
  const games = { ...breakdown.games ?? {} };
  const totalGames = { ...breakdown.totalGames ?? {} };
  for (const [slug, displayName] of qualifiedUniverse) {
    if (!names[slug]) names[slug] = displayName;
    if (games[slug] == null) games[slug] = 0;
    if (totalGames[slug] == null) totalGames[slug] = 0;
  }

  const metrics: WorldCupPlayerVsOpponentBreakdown['metrics'] = {};
  for (const stat of PLAYER_VS_OPPONENT_ALLOWED_STATS) {
    const prior = breakdown.metrics[stat] ?? { values: {}, ranks: {} };
    metrics[stat] = {
      values: prior.values,
      ranks: rankPlayerVsOpponentAllowed(prior.values, qualifiedUniverse, games),
    };
  }

  return {
    window: breakdown.window,
    names,
    games,
    totalGames,
    rankingTotal: opponentAllowedRankingTotal(qualifiedUniverse) || Object.keys(names).length,
    metrics,
  };
}

/** Patch / refresh one opponent's allowed averages and re-rank every stat. */
export function mergeWorldCupOpponentAllowedSnapshot(
  breakdown: WorldCupPlayerVsOpponentBreakdown,
  slug: string,
  name: string,
  games: number,
  allowed: Partial<Record<(typeof PLAYER_VS_OPPONENT_ALLOWED_STATS)[number], number>>,
  opts?: { qualifiedUniverse?: Map<string, string> }
): WorldCupPlayerVsOpponentBreakdown {
  const next: WorldCupPlayerVsOpponentBreakdown = {
    window: breakdown.window,
    names: { ...breakdown.names, [slug]: name },
    games: { ...breakdown.games, [slug]: games },
    totalGames: { ...breakdown.totalGames, [slug]: games },
    rankingTotal: breakdown.rankingTotal,
    metrics: {},
  };
  for (const stat of PLAYER_VS_OPPONENT_ALLOWED_STATS) {
    const prior = breakdown.metrics[stat] ?? { values: {}, ranks: {} };
    const values = { ...prior.values };
    if (typeof allowed[stat] === 'number' && Number.isFinite(allowed[stat])) {
      values[slug] = allowed[stat]!;
    }
    next.metrics[stat] = {
      values,
      ranks: rankPlayerVsOpponentAllowed(values, opts?.qualifiedUniverse, next.games),
    };
  }
  next.rankingTotal =
    opponentAllowedRankingTotal(opts?.qualifiedUniverse) || breakdown.rankingTotal;
  return next;
}

export type WorldCupPlayerVsPoolPayload = {
  generatedAt: string;
  scope: 'all' | 'worldcup';
  players: WorldCupPlayerPoolEntry[];
  opponentBreakdown?: WorldCupPlayerVsOpponentBreakdown;
};

export async function loadWorldCupPlayerPool(opts?: {
  scope?: 'all' | 'worldcup';
  seasonYear?: number;
  qualifiedUniverse?: Map<string, string>;
}): Promise<WorldCupPlayerVsPoolPayload> {
  const worldCupOnly = opts?.scope === 'worldcup';
  const cacheKey = worldCupOnly ? WC_PLAYER_VS_POOL_WC_FINALS_CACHE_KEY : WC_PLAYER_VS_POOL_CACHE_KEY;
  // World Cup finals pool must stay live — BDL player stats update as games complete.
  if (!worldCupOnly) {
    const cached = await getWorldCupCache<WorldCupPlayerVsPoolPayload>(cacheKey);
    if (cached?.players?.length) return cached;
  }

  const fullSrc = await loadWorldCupDvpSource();
  let src = worldCupOnly ? filterCompletedWorldCupDvpSource(fullSrc) : fullSrc;
  if (worldCupOnly && opts?.seasonYear != null) {
    src = filterWorldCupDvpSourceByEditionYear(src, opts.seasonYear);
  }
  const payload: WorldCupPlayerVsPoolPayload = {
    generatedAt: new Date().toISOString(),
    scope: worldCupOnly ? 'worldcup' : 'all',
    players: aggregateWorldCupPlayerPool(src),
    ...(worldCupOnly
      ? {
          opponentBreakdown: computeWorldCupPlayerVsOpponentBreakdown(src, {
            qualifiedUniverse: opts?.qualifiedUniverse,
          }),
        }
      : {}),
  };
  if (!worldCupOnly) {
    await setWorldCupCache(cacheKey, payload);
  }
  return payload;
}

/**
 * Diagnostic: report DVP coverage for the qualified World Cup nations. Prints how
 * many games-with-stats each qualified team has, which qualified teams have none,
 * and which data nations did NOT match any qualified slug (these are alias/name
 * gaps — teams that DO have data but whose names don't resolve to the same FIFA
 * slug as the qualified list, so they're wrongly excluded).
 */
export async function diagnoseWorldCupDvpCoverage(
  qualified: Map<string, string>,
  log: (msg: string) => void = (m) => console.log(m)
): Promise<void> {
  const sb = supabaseAdmin;
  const PAGE = 1000;
  type MatchRow = { home_team_name: string; away_team_name: string; source: string; source_match_id: string };
  const matches: MatchRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('international_matches')
      .select('source, source_match_id, home_team_name, away_team_name')
      .not('tournament_slug', 'like', 'club%')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`match load failed: ${error.message}`);
    const page = (data ?? []) as MatchRow[];
    matches.push(...page);
    if (page.length < PAGE) break;
  }

  const totalMatchesBySlug = new Map<string, number>();
  const addMatch = (name: string) => {
    const slug = dvpTeamSlug(name);
    if (!slug) return;
    totalMatchesBySlug.set(slug, (totalMatchesBySlug.get(slug) ?? 0) + 1);
  };
  for (const m of matches) {
    addMatch(m.home_team_name);
    addMatch(m.away_team_name);
  }

  const src = await loadWorldCupDvpSource();
  const playerGames = (slug: string) => src.teamMatchesBySlug.get(slug)?.length ?? 0;

  log(`=== Qualified WC teams: ${qualified.size} ===`);
  log(`(DVP needs per-PLAYER stats — team-level match stats alone are not enough)`);
  let withPlayerData = 0;
  const missingPlayerStats: string[] = [];
  const sorted = [...qualified.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  for (const [slug, name] of sorted) {
    const total = totalMatchesBySlug.get(slug) ?? 0;
    const withStats = playerGames(slug);
    if (withStats > 0) withPlayerData += 1;
    else missingPlayerStats.push(`${name} [${slug}]`);
    const tag = withStats > 0 ? 'OK' : total > 0 ? '!!' : '--';
    const detail =
      total > 0 && withStats === 0
        ? `${total} matches in DB, 0 with player stats`
        : `${withStats} games-with-player-stats (${total} total matches)`;
    log(`  ${tag} ${name} [${slug}]: ${detail}`);
  }
  log(`Qualified WITH player stats (DVP-ready): ${withPlayerData}/${qualified.size}`);
  if (missingPlayerStats.length) {
    log(`Qualified WITHOUT player stats: ${missingPlayerStats.join(', ')}`);
    log('');
    log('Teams marked !! have MATCHES but no per-player stat rows.');
    log('DVP cannot compute until player stats are ingested for their competitions.');
    log('Likely fix — re-run SofaScore/API-Football ingest WITHOUT --team-stats-only:');
    log('  npm run build:sofascore:wcq-africa:players');
    log('  npm run build:sofascore:wcq-oceania:players');
    log('  npm run build:api-football:afcon');
    log('  npm run build:api-football:wcq-concacaf');
    log('Then rebuild: npm run build:world-cup:dvp');
  }

  const unmatched: Array<[string, string, number, number]> = [];
  for (const [slug] of src.teamMatchesBySlug) {
    if (!qualified.has(slug)) {
      unmatched.push([
        src.slugNames.get(slug) ?? slug,
        slug,
        playerGames(slug),
        totalMatchesBySlug.get(slug) ?? 0,
      ]);
    }
  }
  unmatched.sort((a, b) => b[2] - a[2]);
  log(`=== Non-qualified nations with player stats: ${unmatched.length} ===`);
  for (const [name, slug, withStats, total] of unmatched.slice(0, 15)) {
    log(`  ${name} [${slug}]: ${withStats} player-stat games (${total} total matches)`);
  }
  if (unmatched.length > 15) log(`  ... and ${unmatched.length - 15} more`);
}

/**
 * Aggregate Defense vs Position across ALL international national-team
 * competitions combined (Euros, Nations League, Copa, AFCON, Asian Cup, WC
 * qualifiers — club games excluded), from preloaded source data. For the
 * requested position bucket, sums the stats that opposing players in that bucket
 * recorded AGAINST each team, then averages per team game. Every player with
 * data is included — by default each player is bucketed by their canonical
 * GK/DEF/MID/FWD label (`buildIntlPlayerPositionMap`). Pass
 * `positionMode: 'lineupPerMatch'` for WC 2026-only DvP where BDL lineups
 * define the bucket per game.
 *
 * Keyed by FIFA country slug, so the same nation's games from every source/
 * competition collapse into one ranking (matching the Opponent Breakdown join).
 */
export function aggregateInternationalDvp(
  src: WorldCupDvpSource,
  opts: {
    position: IntlPositionBucket;
    requestedStats: string[];
    window?: number;
    /**
     * `canonical` (default): one static GK/DEF/MID/FWD label per player via
     * `positionMap` — used by the normal all-competitions DvP panel.
     * `lineupPerMatch`: bucket each game by that match's BDL lineup position.
     */
    positionMode?: 'canonical' | 'lineupPerMatch';
    /**
     * Restrict the ranking universe to these FIFA slugs (the 48 qualified World
     * Cup nations). When empty/omitted, every nation with data is ranked.
     */
    restrictSlugs?: Set<string>;
  }
): WorldCupDvpAggregateResult {
  const windowN = Number.isFinite(opts.window) && (opts.window ?? 0) > 0 ? Math.floor(opts.window!) : 0;
  const restrict = opts.restrictSlugs && opts.restrictSlugs.size > 0 ? opts.restrictSlugs : null;
  const perMatch = opts.positionMode === 'lineupPerMatch';

  // Per-team window: the set of match keys counting toward each team (by slug),
  // plus the games-played denominators.
  const teamWindowKeys = new Map<string, Set<string>>();
  const teamGamesBySlug = new Map<string, number>();
  const teamTotalGamesBySlug = new Map<string, number>();
  for (const [slug, list] of src.teamMatchesBySlug) {
    const windowed = windowN > 0 ? list.slice(0, windowN) : list;
    teamWindowKeys.set(slug, new Set(windowed.map((g) => g.key)));
    teamGamesBySlug.set(slug, windowed.length);
    teamTotalGamesBySlug.set(slug, list.length);
  }

  // Attribute each in-bucket player-game to the opponent (slug) they faced.
  // matchKeys tracks distinct match IDs per opponent so the per-game divisor is
  // always exact — no slug-join required (avoids the teamMatchesBySlug mismatch bug).
  const byOpponent = new Map<string, { sums: Record<string, number>; count: number; matchKeys: Set<string> }>();
  for (const row of src.statRows) {
    const bucket = perMatch
      ? dvpBucketForStatRow(row)
      : src.positionMap.get(intlPlayerKey(row.source, row.source_player_id)) ?? 'MID';
    if (!bucket || bucket !== opts.position) continue;
    const key = dvpMatchKey(row.source, row.source_match_id);
    const m = src.matchInfo.get(key);
    if (!m) continue;
    const playerIsHome = String(row.source_team_id) === String(m.home_team_source_id);
    const opponentName = playerIsHome ? m.away_team_name : m.home_team_name;
    if (!opponentName) continue;
    const opponentSlug = dvpTeamSlug(opponentName);
    if (!opponentSlug) continue;
    // Restrict the ranking universe to the qualified World Cup nations.
    if (restrict && !restrict.has(opponentSlug)) continue;
    // Only count games inside the opponent team's recency window.
    if (windowN > 0 && !(teamWindowKeys.get(opponentSlug)?.has(key) ?? false)) continue;
    // Goals the player's own team conceded that match = the opponent's score.
    const goalsConceded = playerIsHome ? m.away_score : m.home_score;
    let entry = byOpponent.get(opponentSlug);
    if (!entry) {
      entry = { sums: {}, count: 0, matchKeys: new Set() };
      byOpponent.set(opponentSlug, entry);
    }
    entry.count += 1;
    entry.matchKeys.add(key);
    for (const stat of opts.requestedStats) {
      const v =
        stat === 'goals_conceded'
          ? goalsConceded
          : (row as unknown as Record<string, number | null>)[stat];
      if (typeof v === 'number' && Number.isFinite(v)) {
        entry.sums[stat] = (entry.sums[stat] ?? 0) + v;
      }
    }
  }

  const opponents = Array.from(byOpponent.keys()).sort();
  const samples: Record<string, number> = {};
  const teamGames: Record<string, number> = {};
  const totalGames: Record<string, number> = {};
  const names: Record<string, string> = {};
  const metrics: Record<string, Record<string, number>> = {};
  for (const stat of opts.requestedStats) metrics[stat] = {};
  for (const opp of opponents) {
    const entry = byOpponent.get(opp)!;
    samples[opp] = entry.count;
    // Use the distinct match count from the aggregation loop — this is always
    // correct and avoids slug-mismatch bugs with teamMatchesBySlug.
    const games = entry.matchKeys.size || 1;
    teamGames[opp] = games;
    totalGames[opp] = teamTotalGamesBySlug.get(opp) ?? games;
    names[opp] = src.slugNames.get(opp) ?? opp;
    for (const stat of opts.requestedStats) {
      metrics[stat]![opp] = Number(((entry.sums[stat] ?? 0) / games).toFixed(3));
    }
  }

  return { opponents, samples, teamGames, totalGames, names, metrics };
}

/**
 * Convenience wrapper: load the source data and aggregate a single
 * position/window. Used by the live API route (falls back to this when the
 * precomputed cache entry is missing).
 */
export async function loadInternationalDvpAggregate(opts: {
  position: IntlPositionBucket;
  requestedStats: string[];
  /** Per-team recency window: only count each team's last N games. 0 = all. */
  window?: number;
  /** Restrict ranking to the 48 qualified World Cup nations (by FIFA slug). */
  restrictSlugs?: Set<string>;
}): Promise<WorldCupDvpAggregateResult> {
  const src = await loadWorldCupDvpSource();
  return aggregateInternationalDvp(src, opts);
}

/**
 * Precompute and persist EVERY position×window aggregate DVP entry to the
 * permanent Supabase cache, loading the heavy source data only once. After this
 * runs, the World Cup dashboard's DVP card is instant for every team.
 */
export async function refreshWorldCupDvpCache(
  onProgress?: (msg: string) => void,
  restrictSlugs?: Set<string>
): Promise<{ entries: number; teams: number }> {
  const log = onProgress ?? ((msg: string) => console.log(`[dvp] ${msg}`));
  log('loading source data (international tables + BDL World Cup player stats)…');
  const src = await loadWorldCupDvpSource();
  const bdlRows = src.statRows.filter((row) => row.source === BDL_DVP_SOURCE).length;
  log(
    `loaded ${src.statRows.length} player-game rows (${bdlRows} from BDL World Cup) across ${src.teamMatchesBySlug.size} nations`
  );
  if (restrictSlugs && restrictSlugs.size > 0) {
    log(`restricting ranking universe to ${restrictSlugs.size} qualified World Cup nations`);
  } else {
    log('WARNING: no World Cup team list available — ranking across all nations seen');
  }

  let entries = 0;
  let maxTeams = 0;
  for (const position of WC_DVP_POSITIONS) {
    const stats = getWorldCupDvpStats(position);
    for (const window of WC_DVP_WINDOWS) {
      const result = aggregateInternationalDvp(src, { position, requestedStats: stats, window, restrictSlugs });
      const key = buildWorldCupDvpCacheKey(position, window, stats);
      const ok = await setWorldCupCache(key, result);
      if (!ok) throw new Error(`Failed to write cache for ${position} w${window}`);
      entries += 1;
      maxTeams = Math.max(maxTeams, result.opponents.length);
      log(`${position} w${window === 0 ? 'All' : window}: ${result.opponents.length} teams cached`);
    }
  }
  return { entries, teams: maxTeams };
}

function bucketPosition(position: string | null, stats: IntlStatRow): 'DEF' | 'MID' | 'ATT' | null {
  const p = (position || '').toLowerCase().trim();
  if (!p) {
    if ((stats.saves ?? 0) > 0) return 'DEF';
    const att = (stats.goals ?? 0) * 2 + (stats.shots_total ?? 0) + (stats.shots_on_target ?? 0);
    const def = (stats.tackles ?? 0) + (stats.interceptions ?? 0);
    if (att > def) return 'ATT';
    if (def > 0) return 'DEF';
    return 'MID';
  }
  // API-Football short codes: G, D, M, F.
  if (p === 'g') return 'DEF';
  if (p === 'd') return 'DEF';
  if (p === 'm') return 'MID';
  if (p === 'f' || p === 'w') return 'ATT';
  // StatsBomb / longer descriptors
  if (/(goalkeeper|keeper|^gk)/.test(p)) return 'DEF';
  if (/(back|defender|cb|lb|rb|wb|sweeper|fullback)/.test(p)) return 'DEF';
  if (/(forward|striker|wing|cf|st|ff|center forward|second striker|att)/.test(p)) return 'ATT';
  if (/(midfield|mid|cm|dm|am|lm|rm)/.test(p)) return 'MID';
  return 'MID';
}

/**
 * Team form for international competitions. Returns a similar shape to the
 * BDL team-form handler: a flat list of matches for the team (+opponent),
 * plus per-match aggregated team stats.
 */
export async function loadInternationalTeamForm(opts: {
  competition: InternationalCompetition;
  teamId: string;
  opponentId?: string | null;
}): Promise<{
  teamMatches: Array<Record<string, unknown>>;
  opponentMatches: Array<Record<string, unknown>>;
  teamMatchStats: Array<Record<string, unknown>>;
}> {
  const source = COMPETITION_TO_SOURCE[opts.competition];
  const sb = supabaseAdmin;
  const teamId = String(opts.teamId);
  const opponentId = opts.opponentId ? String(opts.opponentId) : null;

  const { data: matchRows } = await sb
    .from('international_matches')
    .select(
      INTL_MATCH_SELECT
    )
    .eq('source', source)
    .eq('tournament_slug', opts.competition)
    .or(
      `home_team_source_id.eq.${teamId},away_team_source_id.eq.${teamId}` +
        (opponentId
          ? `,home_team_source_id.eq.${opponentId},away_team_source_id.eq.${opponentId}`
          : '')
    )
    .order('kickoff_unix', { ascending: false });

  const allMatches = (matchRows ?? []) as Array<{
    source_match_id: string;
    match_date: string | null;
    kickoff_unix: number | null;
    stage: string | null;
    season_year: number;
    home_team_source_id: string;
    away_team_source_id: string;
    home_team_name: string;
    away_team_name: string;
    home_score: number | null;
    away_score: number | null;
    status: string | null;
  }>;

  const formatMatch = (m: (typeof allMatches)[number]) => ({
    id: m.source_match_id,
    datetime: m.match_date
      ? new Date(`${m.match_date}T${secondsToTimeOfDay(m.kickoff_unix)}`).toISOString()
      : null,
    status: m.status || 'completed',
    home_team: { id: m.home_team_source_id, name: m.home_team_name },
    away_team: { id: m.away_team_source_id, name: m.away_team_name },
    home_score: m.home_score,
    away_score: m.away_score,
    stage: m.stage,
    season: { year: m.season_year },
  });

  const teamMatches = allMatches
    .filter((m) => m.home_team_source_id === teamId || m.away_team_source_id === teamId)
    .map(formatMatch);

  const opponentMatches = opponentId
    ? allMatches
        .filter((m) => m.home_team_source_id === opponentId || m.away_team_source_id === opponentId)
        .map(formatMatch)
    : [];

  // Aggregate per-match team stats from per-player stats so the UI can render
  // average shots / passes / etc.
  const matchIds = Array.from(new Set([...teamMatches, ...opponentMatches].map((m) => String(m.id))));
  let teamMatchStats: Array<Record<string, unknown>> = [];
  if (matchIds.length) {
    const { data: statRows } = await sb
      .from('international_player_match_stats')
      .select('*')
      .eq('source', source)
      .in('source_match_id', matchIds);
    const grouped = new Map<
      string,
      Record<string, number>
    >();
    for (const r of (statRows ?? []) as IntlStatRow[]) {
      const key = `${r.source_match_id}|${r.source_team_id}`;
      let agg = grouped.get(key);
      if (!agg) {
        agg = { goals: 0, shots_total: 0, shots_on_target: 0, passes_total: 0, passes_accurate: 0, yellow_cards: 0, red_cards: 0, fouls: 0 };
        grouped.set(key, agg);
      }
      agg.goals += r.goals ?? 0;
      agg.shots_total += r.shots_total ?? 0;
      agg.shots_on_target += r.shots_on_target ?? 0;
      agg.passes_total += r.passes_total ?? 0;
      agg.passes_accurate += r.passes_accurate ?? 0;
      agg.yellow_cards += r.yellow_cards ?? 0;
      agg.red_cards += r.red_cards ?? 0;
      agg.fouls += r.fouls ?? 0;
    }
    teamMatchStats = Array.from(grouped.entries()).map(([key, agg]) => {
      const [matchId, teamIdStr] = key.split('|');
      return {
        match_id: matchId,
        team_id: teamIdStr,
        ...agg,
      };
    });
  }

  return { teamMatches, opponentMatches, teamMatchStats };
}

const INTERNATIONAL_TEAM_SOURCES = ['statsbomb', 'api-football', 'sofascore'];

/**
 * Aggregate a national team's per-match team stats across EVERY international
 * competition we ingest (Euros via StatsBomb + Nations League / Copa América /
 * AFCON via API-Football). The result is shaped to drop straight into the World
 * Cup dashboard's team-mode chart: each stat row's `team_id` is rewritten to the
 * BDL team id (so the chart's `team_id === selectedTeamId` filter keeps it) and
 * every match is returned in the same summarized shape the chart's lookup uses.
 *
 * Cross-source team identity is resolved through `resolveWorldCupFlagCode`, which
 * canonicalizes either a country code or a country name to one FIFA slug, so we
 * don't depend on the (inconsistent) `country_code` column being populated.
 */
export async function loadInternationalTeamStatsByCountry(opts: {
  countryCode?: string | null;
  teamName?: string | null;
  bdlTeamId?: string | null;
}): Promise<{
  teamMatchStats: Array<Record<string, unknown>>;
  matches: Array<Record<string, unknown>>;
}> {
  const sb = supabaseAdmin;
  const targetSlug =
    resolveWorldCupFlagCode(opts.countryCode) || resolveWorldCupFlagCode(opts.teamName);
  if (!targetSlug) return { teamMatchStats: [], matches: [] };

  const teamIdOut =
    opts.bdlTeamId && /^\d+$/.test(String(opts.bdlTeamId)) ? String(opts.bdlTeamId) : null;
  if (!teamIdOut) return { teamMatchStats: [], matches: [] };

  // 1. Resolve this country's source_team_id in each international source, and
  //    keep team metadata for every team so we can label opponents.
  const { data: teamRows } = await sb
    .from('international_teams')
    .select('source, source_team_id, team_name, country_code')
    .in('source', INTERNATIONAL_TEAM_SOURCES);

  const teamMetaById = new Map<string, { country_code: string | null; name: string }>();
  const ourTeamIdsBySource = new Map<string, Set<string>>();
  for (const t of (teamRows ?? []) as IntlTeamRow[]) {
    teamMetaById.set(`${t.source}:${t.source_team_id}`, {
      country_code: t.country_code,
      name: t.team_name,
    });
    const slug = resolveWorldCupFlagCode(t.country_code) || resolveWorldCupFlagCode(t.team_name);
    if (slug && slug === targetSlug) {
      const set = ourTeamIdsBySource.get(t.source) ?? new Set<string>();
      set.add(String(t.source_team_id));
      ourTeamIdsBySource.set(t.source, set);
    }
  }
  if (!ourTeamIdsBySource.size) return { teamMatchStats: [], matches: [] };

  const teamMatchStats: Array<Record<string, unknown>> = [];
  const matches: Array<Record<string, unknown>> = [];

  for (const [source, ids] of ourTeamIdsBySource) {
    const idList = Array.from(ids);
    if (!idList.length) continue;

    const { data: matchRows } = await sb
      .from('international_matches')
      .select(
        `${INTL_MATCH_SELECT}, tournament_slug`
      )
      .eq('source', source)
      .or(
        `home_team_source_id.in.(${idList.join(',')}),away_team_source_id.in.(${idList.join(',')})`
      );

    const mRows = (matchRows ?? []) as IntlMatchRow[];
    if (!mRows.length) continue;

    const matchIds = mRows.map((m) => m.source_match_id);

    // Per-match aggregate of OUR team's player stats. We track which stats had
    // at least one non-null contribution so absent metrics can be emitted as
    // `null` (vs a misleading 0) — the dashboard uses that to only show stats
    // that every competition actually provides.
    type TeamStatAgg = { sums: Record<string, number>; present: Set<string>; is_home: boolean };
    const AGG_KEYS = [
      'goals',
      'assists',
      'shots_total',
      'shots_on_target',
      'passes_total',
      'passes_accurate',
      'expected_goals',
      'yellow_cards',
      'red_cards',
      'fouls',
      'was_fouled',
      'tackles',
      'interceptions',
    ] as const;
    // `agg` holds OUR team's per-match aggregate; `aggOpp` holds the single
    // opponent's, so the dashboard can offer team / opponent / home / away
    // perspective toggles for every stat.
    const agg = new Map<string, TeamStatAgg>();
    const aggOpp = new Map<string, TeamStatAgg>();
    // Supabase caps rows; chunk match-id lookups to stay safe.
    const chunkSize = 200;
    for (let i = 0; i < matchIds.length; i += chunkSize) {
      const chunk = matchIds.slice(i, i + chunkSize);
      const { data: statRows } = await sb
        .from('international_player_match_stats')
        .select(
          'source_match_id, source_team_id, is_home, goals, assists, shots_total, shots_on_target, passes_total, passes_accurate, expected_goals, yellow_cards, red_cards, fouls, was_fouled, tackles, interceptions'
        )
        .eq('source', source)
        .in('source_match_id', chunk);
      for (const r of (statRows ?? []) as Array<Record<string, unknown>>) {
        const isOurs = ids.has(String(r.source_team_id));
        const target = isOurs ? agg : aggOpp;
        let a = target.get(String(r.source_match_id));
        if (!a) {
          a = { sums: {}, present: new Set<string>(), is_home: r.is_home === true };
          target.set(String(r.source_match_id), a);
        }
        for (const key of AGG_KEYS) {
          const value = r[key];
          if (value == null) continue;
          const num = typeof value === 'number' ? value : Number.parseFloat(String(value));
          if (!Number.isFinite(num)) continue;
          a.sums[key] = (a.sums[key] ?? 0) + num;
          a.present.add(key);
        }
        if (r.is_home === true) a.is_home = true;
      }
    }

    // Team-only stats (corners, possession, offsides, shot splits, throw-ins,
    // crosses) that cannot be summed from player rows. Stored per (match, team)
    // in international_team_match_stats. Keyed here by source_match_id.
    const teamOnly = new Map<string, Record<string, number | null>>();
    const teamOnlyOpp = new Map<string, Record<string, number | null>>();
    // Pure team-only markets (not derivable from player rows).
    const TEAM_ONLY_KEYS = [
      'corners',
      'offsides',
      'possession_pct',
      'shots_off_target',
      'shots_blocked',
      'shots_inside_box',
      'shots_outside_box',
      'throw_ins',
      'goal_kicks',
      'free_kicks',
      'crosses_total',
      'crosses_accurate',
      'big_chances',
      'big_chances_missed',
      'hit_woodwork',
    ];
    // Core stats that are normally summed from player rows, but which sources
    // ingested team-stats-only (e.g. SofaScore WCQ Asia/Africa) provide directly
    // on international_team_match_stats. Loaded here so the dashboard can fall
    // back to them when no per-player rows exist for the match.
    const TEAM_FALLBACK_KEYS = [
      'goals',
      'expected_goals',
      'shots_total',
      'shots_on_target',
      'passes_total',
      'passes_accurate',
      'yellow_cards',
      'red_cards',
      'fouls',
      'tackles',
      'interceptions',
      'saves',
    ];
    const TEAM_STAT_KEYS = [...TEAM_ONLY_KEYS, ...TEAM_FALLBACK_KEYS];
    for (let i = 0; i < matchIds.length; i += chunkSize) {
      const chunk = matchIds.slice(i, i + chunkSize);
      const { data: teamRows } = await sb
        .from('international_team_match_stats')
        .select('*')
        .eq('source', source)
        .in('source_match_id', chunk);
      for (const r of (teamRows ?? []) as Array<Record<string, unknown>>) {
        const extras: Record<string, number | null> = {};
        for (const key of TEAM_STAT_KEYS) {
          const value = r[key];
          if (value == null) continue;
          const num = typeof value === 'number' ? value : Number.parseFloat(String(value));
          extras[key] = Number.isFinite(num) ? num : null;
        }
        const target = ids.has(String(r.source_team_id)) ? teamOnly : teamOnlyOpp;
        target.set(String(r.source_match_id), extras);
      }
    }

    for (const m of mRows) {
      const prefixedId = `intl-${source}-${m.source_match_id}`;
      const homeMeta = teamMetaById.get(`${source}:${m.home_team_source_id}`);
      const awayMeta = teamMetaById.get(`${source}:${m.away_team_source_id}`);
      const home = {
        id: m.home_team_source_id,
        name: m.home_team_name,
        country_code: homeMeta?.country_code ?? null,
      };
      const away = {
        id: m.away_team_source_id,
        name: m.away_team_name,
        country_code: awayMeta?.country_code ?? null,
      };
      matches.push({
        id: prefixedId,
        datetime: m.match_date
          ? new Date(`${m.match_date}T${secondsToTimeOfDay(m.kickoff_unix)}`).toISOString()
          : null,
        status: m.status || 'completed',
        season: { year: m.season_year },
        stage: { name: m.stage ?? null },
        home_team: home,
        away_team: away,
        homeTeam: home,
        awayTeam: away,
        homeLabel: home.name,
        awayLabel: away.name,
        homeScore: m.home_score,
        awayScore: m.away_score,
        home_score: m.home_score,
        away_score: m.away_score,
        ...mapIntlMatchPenaltyFields(m),
        tournament_slug: m.tournament_slug,
        source,
      });

      const a = agg.get(String(m.source_match_id));
      const extras = teamOnly.get(String(m.source_match_id));
      const aOpp = aggOpp.get(String(m.source_match_id));
      const extrasOpp = teamOnlyOpp.get(String(m.source_match_id));
      // Skip only when we have neither player-aggregated nor team-level stats.
      if (!a && !extras) continue;
      const ourIsHome = ids.has(String(m.home_team_source_id));
      // Goals are most reliable straight from the scoreline.
      const goalsFromScore = ourIsHome ? m.home_score : m.away_score;
      const oppGoalsFromScore = ourIsHome ? m.away_score : m.home_score;
      const stat = (key: string): number | null =>
        a && a.present.has(key) ? a.sums[key] ?? 0 : null;
      const extra = (key: string): number | null =>
        extras && extras[key] != null ? extras[key] : null;
      const statOpp = (key: string): number | null =>
        aOpp && aOpp.present.has(key) ? aOpp.sums[key] ?? 0 : null;
      const extraOpp = (key: string): number | null =>
        extrasOpp && extrasOpp[key] != null ? extrasOpp[key] : null;
      // Prefer team-level stats (international_team_match_stats) for core team
      // metrics so the Game Props chart matches Opponent Breakdown and the BDL
      // website. Player sums undercount shots/passes when not every player is
      // tracked. Player rows remain the source for assists and other player-only
      // fields; team-stats-only sources still work via the extra() fallback.
      const val = (key: string): number | null =>
        (TEAM_FALLBACK_KEYS as readonly string[]).includes(key)
          ? (extra(key) ?? stat(key))
          : (stat(key) ?? extra(key));
      const valOpp = (key: string): number | null =>
        (TEAM_FALLBACK_KEYS as readonly string[]).includes(key)
          ? (extraOpp(key) ?? statOpp(key))
          : (statOpp(key) ?? extraOpp(key));
      teamMatchStats.push({
        match_id: prefixedId,
        team_id: teamIdOut,
        is_home: ourIsHome,
        source,
        tournament_slug: m.tournament_slug,
        goals: goalsFromScore != null ? goalsFromScore : val('goals'),
        assists: stat('assists'),
        shots_total: val('shots_total'),
        shots_on_target: val('shots_on_target'),
        passes_total: val('passes_total'),
        passes_accurate: val('passes_accurate'),
        expected_goals: val('expected_goals'),
        yellow_cards: val('yellow_cards'),
        red_cards: val('red_cards'),
        fouls: val('fouls'),
        // Fouls suffered == opponent's fouls committed. Prefer the opponent's
        // team-level fouls (reliable) over the player sum, which often marks
        // was_fouled "present" as 0 when only a subset of players are tracked.
        was_fouled: valOpp('fouls') ?? stat('was_fouled'),
        tackles: val('tackles'),
        interceptions: val('interceptions'),
        // Team-only markets (corners, possession, offsides, shot splits, ...).
        corners: extra('corners'),
        offsides: extra('offsides'),
        possession_pct: extra('possession_pct'),
        shots_off_target: extra('shots_off_target'),
        shots_blocked: extra('shots_blocked'),
        shots_inside_box: extra('shots_inside_box'),
        shots_outside_box: extra('shots_outside_box'),
        throw_ins: extra('throw_ins'),
        goal_kicks: extra('goal_kicks'),
        free_kicks: extra('free_kicks'),
        crosses_total: extra('crosses_total'),
        // Opponent values for the same match (team/opponent/home/away toggle).
        opp_goals: oppGoalsFromScore != null ? oppGoalsFromScore : valOpp('goals'),
        opp_assists: statOpp('assists'),
        opp_shots_total: valOpp('shots_total'),
        opp_shots_on_target: valOpp('shots_on_target'),
        opp_passes_total: valOpp('passes_total'),
        opp_passes_accurate: valOpp('passes_accurate'),
        opp_expected_goals: valOpp('expected_goals'),
        opp_yellow_cards: valOpp('yellow_cards'),
        opp_red_cards: valOpp('red_cards'),
        opp_fouls: valOpp('fouls'),
        // Opponent's fouls suffered == our committed fouls (same symmetry).
        opp_was_fouled: val('fouls') ?? statOpp('was_fouled'),
        opp_tackles: valOpp('tackles'),
        opp_interceptions: valOpp('interceptions'),
        opp_corners: extraOpp('corners'),
        opp_offsides: extraOpp('offsides'),
        opp_possession_pct: extraOpp('possession_pct'),
        opp_shots_off_target: extraOpp('shots_off_target'),
        opp_shots_blocked: extraOpp('shots_blocked'),
        opp_shots_inside_box: extraOpp('shots_inside_box'),
        opp_shots_outside_box: extraOpp('shots_outside_box'),
        opp_throw_ins: extraOpp('throw_ins'),
        opp_goal_kicks: extraOpp('goal_kicks'),
        opp_free_kicks: extraOpp('free_kicks'),
        opp_crosses_total: extraOpp('crosses_total'),
      });
    }
  }

  return { teamMatchStats, matches };
}
