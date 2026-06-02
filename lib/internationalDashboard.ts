/**
 * Helper that reads from the `international_*` Supabase tables (StatsBomb
 * Euros + API-Football Nations League) and shapes the response so the
 * existing World Cup dashboard UI can consume it without modification.
 *
 * The shape mirrors the BDL FIFA World Cup API response that
 * `/api/world-cup/dashboard` currently returns.
 */

import { supabaseAdmin } from './supabaseAdmin';

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
  status: string | null;
};

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
      'source, source_match_id, tournament_slug, season_year, match_date, kickoff_unix, stage, home_team_source_id, away_team_source_id, home_team_name, away_team_name, home_score, away_score, status'
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
          'source, source_match_id, tournament_slug, season_year, match_date, kickoff_unix, stage, home_team_source_id, away_team_source_id, home_team_name, away_team_name, home_score, away_score, status'
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
  const norm = opts.query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!norm) return [];

  const sources =
    opts.competition === 'all'
      ? ['statsbomb', 'api-football']
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
  playerName: string
): Promise<{
  playerMatchStats: Array<Record<string, unknown>>;
  matches: Array<Record<string, unknown>>;
}> {
  const sb = supabaseAdmin;
  const norm = playerName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!norm) return { playerMatchStats: [], matches: [] };

  const { data: matchedPlayers } = await sb
    .from('international_players')
    .select('source, source_player_id, full_name')
    .eq('normalized_name', norm)
    .in('source', ['statsbomb', 'api-football']);

  const players = (matchedPlayers ?? []) as Array<{
    source: string;
    source_player_id: string;
    full_name: string;
  }>;
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

  for (const [source, ids] of idsBySource) {
    const { data } = await sb
      .from('international_player_match_stats')
      .select('*')
      .eq('source', source)
      .in('source_player_id', ids);
    const rows = (data as IntlStatRow[] | null) ?? [];
    allStats.push(...rows.map(normalizeStatRow));
    const set = matchIdsBySource.get(source) ?? new Set<string>();
    for (const r of rows) set.add(r.source_match_id);
    matchIdsBySource.set(source, set);
  }

  // Fetch the corresponding match rows for context (datetime, teams, score).
  // Also fetch team metadata so we can resolve country codes for the chart's
  // x-axis flags.
  const allMatches: Array<Record<string, unknown>> = [];
  for (const [source, ids] of matchIdsBySource) {
    if (!ids.size) continue;
    const { data } = await sb
      .from('international_matches')
      .select(
        'source_match_id, match_date, kickoff_unix, stage, season_year, home_team_source_id, away_team_source_id, home_team_name, away_team_name, home_score, away_score, status, tournament_slug'
      )
      .eq('source', source)
      .in('source_match_id', Array.from(ids));
    const rows = (data ?? []) as Array<{
      home_team_source_id: string;
      away_team_source_id: string;
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
    const teamMeta = new Map<
      string,
      { country_code: string | null; name: string }
    >();
    for (const t of (teamData ?? []) as Array<{
      source_team_id: string;
      country_code: string | null;
      team_name: string;
    }>) {
      teamMeta.set(t.source_team_id, {
        country_code: t.country_code,
        name: t.team_name,
      });
    }
    for (const row of (data ?? []) as Array<{
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
      tournament_slug: string;
    }>) {
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
        tournament_slug: row.tournament_slug,
        source,
      });
    }
  }

  return { playerMatchStats: allStats, matches: allMatches };
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
      'source_match_id, match_date, kickoff_unix, stage, season_year, home_team_source_id, away_team_source_id, home_team_name, away_team_name, home_score, away_score, status'
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
