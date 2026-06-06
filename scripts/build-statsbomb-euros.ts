#!/usr/bin/env npx tsx

/**
 * Ingest StatsBomb open-data UEFA Euro tournaments into Supabase.
 *
 * Run with:
 *   npx tsx scripts/build-statsbomb-euros.ts            # all available Euros
 *   npx tsx scripts/build-statsbomb-euros.ts --year=2024 # one season
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local.
 *
 * The script is idempotent: every upsert keys off (source, source_*_id) and
 * re-running just refreshes rows. Player-to-BDL matching runs at the end.
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

const STATSBOMB_BASE = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data';
const EURO_COMPETITION_ID = 55;

type EuroSeason = { seasonYear: number; seasonId: number; label: string };

const EURO_SEASONS: EuroSeason[] = [
  { seasonYear: 2020, seasonId: 43, label: 'UEFA Euro 2020' },
  { seasonYear: 2024, seasonId: 282, label: 'UEFA Euro 2024' },
];

type SbCompetition = {
  competition_id: number;
  season_id: number;
  competition_name: string;
  season_name: string;
};

type SbMatch = {
  match_id: number;
  match_date: string;
  kick_off?: string | null;
  competition: { competition_id: number; competition_name: string };
  season: { season_id: number; season_name: string };
  home_team: { home_team_id: number; home_team_name: string };
  away_team: { away_team_id: number; away_team_name: string };
  home_score: number | null;
  away_score: number | null;
  match_status?: string;
  competition_stage?: { id: number; name: string };
};

type SbLineupTeam = {
  team_id: number;
  team_name: string;
  lineup: Array<{
    player_id: number;
    player_name: string;
    player_nickname?: string | null;
    jersey_number?: number | null;
    country?: { id: number; name: string } | null;
    positions?: Array<{
      position_id: number;
      position: string;
      from?: string;
      to?: string | null;
      from_period?: number;
      to_period?: number | null;
      start_reason?: string;
      end_reason?: string;
    }>;
  }>;
};

type SbEvent = {
  id: string;
  index: number;
  period: number;
  timestamp: string;
  minute: number;
  second: number;
  type: { id: number; name: string };
  team?: { id: number; name: string };
  player?: { id: number; name: string };
  position?: { id: number; name: string };
  location?: number[];
  shot?: {
    statsbomb_xg?: number;
    outcome?: { id: number; name: string };
    type?: { id: number; name: string };
  };
  pass?: {
    outcome?: { id: number; name: string } | null;
    goal_assist?: boolean;
    shot_assist?: boolean;
    type?: { id: number; name: string } | null;
    cross?: boolean;
  };
  bad_behaviour?: {
    card?: { id: number; name: string };
  };
  foul_committed?: {
    card?: { id: number; name: string };
  };
  duel?: {
    type?: { id: number; name: string };
    outcome?: { id: number; name: string };
  };
  interception?: {
    outcome?: { id: number; name: string };
  };
  goalkeeper?: {
    type?: { id: number; name: string };
    outcome?: { id: number; name: string };
  };
};

type PlayerAggRow = {
  source_player_id: string;
  source_team_id: string;
  player_name: string;
  position: string | null;
  is_home: boolean;
  minutes_played: number;
  goals: number;
  assists: number;
  shots_total: number;
  shots_on_target: number;
  passes_total: number;
  passes_accurate: number;
  expected_goals: number;
  yellow_cards: number;
  red_cards: number;
  tackles: number;
  interceptions: number;
  fouls: number;
  was_fouled: number;
  saves: number;
  big_chances_created: number;
  raw_aggregates: Record<string, number>;
};

const SHOT_ON_TARGET_OUTCOME_IDS = new Set<number>([97, 100, 116]); // Goal, Saved, Saved to Post
const YELLOW_CARD_IDS = new Set<number>([7, 65]); // 7 Yellow, 65 Second Yellow
const RED_CARD_IDS = new Set<number>([5, 6]); // 5 Red, 6 Second Yellow -> Red

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function parseTimestampSeconds(ts: string | null | undefined): number {
  if (!ts) return 0;
  const [hh = '0', mm = '0', ss = '0'] = ts.split(':');
  return Number(hh) * 3600 + Number(mm) * 60 + Number.parseFloat(ss);
}

function buildKickoffUnix(matchDate: string, kickOff: string | null | undefined): number | null {
  if (!matchDate) return null;
  const time = kickOff && /^\d{2}:\d{2}/.test(kickOff) ? kickOff.slice(0, 8) : '00:00:00';
  const isoUtc = `${matchDate}T${time}Z`;
  const ms = Date.parse(isoUtc);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function makeEmptyAgg(
  player: { player_id: number; player_name: string; position: string | null },
  teamId: number,
  isHome: boolean
): PlayerAggRow {
  return {
    source_player_id: String(player.player_id),
    source_team_id: String(teamId),
    player_name: player.player_name,
    position: player.position,
    is_home: isHome,
    minutes_played: 0,
    goals: 0,
    assists: 0,
    shots_total: 0,
    shots_on_target: 0,
    passes_total: 0,
    passes_accurate: 0,
    expected_goals: 0,
    yellow_cards: 0,
    red_cards: 0,
    tackles: 0,
    interceptions: 0,
    fouls: 0,
    was_fouled: 0,
    saves: 0,
    big_chances_created: 0,
    raw_aggregates: {},
  };
}

function bumpRaw(agg: PlayerAggRow, key: string, by = 1): void {
  agg.raw_aggregates[key] = (agg.raw_aggregates[key] ?? 0) + by;
}

function computeMinutesFromLineup(team: SbLineupTeam, matchMaxMinute: number): Map<number, number> {
  const minutes = new Map<number, number>();
  // Hard cap a single match's minutes at 120 (90 regulation + 30 extra time).
  // Some StatsBomb position timestamps can be malformed (e.g. "65:04") which
  // the parser sees as hours, producing absurd totals.
  const MAX_MATCH_SECONDS = 120 * 60;
  for (const player of team.lineup) {
    let total = 0;
    for (const pos of player.positions ?? []) {
      const fromSec = parseTimestampSeconds(pos.from);
      const toSec = pos.to ? parseTimestampSeconds(pos.to) : matchMaxMinute * 60;
      const seconds = Math.max(0, toSec - fromSec);
      total += seconds;
    }
    const totalCapped = Math.min(total, MAX_MATCH_SECONDS);
    minutes.set(player.player_id, Math.round(totalCapped / 60));
  }
  return minutes;
}

function aggregateMatch(
  events: SbEvent[],
  lineups: SbLineupTeam[],
  homeTeamId: number,
  awayTeamId: number
): PlayerAggRow[] {
  const matchMaxMinute = events.reduce((max, ev) => Math.max(max, ev.minute || 0), 90);

  const minutesByPlayer = new Map<number, number>();
  const teamByPlayer = new Map<number, number>();
  const positionByPlayer = new Map<number, string | null>();
  const playerNames = new Map<number, string>();

  for (const team of lineups) {
    const teamMinutes = computeMinutesFromLineup(team, matchMaxMinute);
    for (const [pid, mins] of teamMinutes) {
      minutesByPlayer.set(pid, mins);
      teamByPlayer.set(pid, team.team_id);
    }
    for (const player of team.lineup) {
      playerNames.set(player.player_id, player.player_nickname || player.player_name);
      const positions = player.positions ?? [];
      const longest = positions.reduce<{ pos: string | null; secs: number }>(
        (acc, pos) => {
          const fromSec = parseTimestampSeconds(pos.from);
          const toSec = pos.to ? parseTimestampSeconds(pos.to) : matchMaxMinute * 60;
          const secs = Math.max(0, toSec - fromSec);
          return secs > acc.secs ? { pos: pos.position, secs } : acc;
        },
        { pos: null, secs: 0 }
      );
      positionByPlayer.set(player.player_id, longest.pos);
    }
  }

  const aggByPlayer = new Map<number, PlayerAggRow>();
  for (const [playerId, teamId] of teamByPlayer) {
    const isHome = teamId === homeTeamId;
    const agg = makeEmptyAgg(
      {
        player_id: playerId,
        player_name: playerNames.get(playerId) ?? `player-${playerId}`,
        position: positionByPlayer.get(playerId) ?? null,
      },
      teamId,
      isHome
    );
    agg.minutes_played = minutesByPlayer.get(playerId) ?? 0;
    aggByPlayer.set(playerId, agg);
  }

  for (const event of events) {
    const playerId = event.player?.id;
    if (!playerId) continue;
    let agg = aggByPlayer.get(playerId);
    if (!agg) {
      // Player appeared in events but not in lineup; create on demand
      const teamId = event.team?.id ?? homeTeamId;
      const isHome = teamId === homeTeamId;
      agg = makeEmptyAgg(
        {
          player_id: playerId,
          player_name: event.player?.name ?? `player-${playerId}`,
          position: event.position?.name ?? null,
        },
        teamId,
        isHome
      );
      aggByPlayer.set(playerId, agg);
    }

    const typeName = event.type?.name;
    bumpRaw(agg, `event_${typeName}`);

    if (typeName === 'Shot' && event.shot) {
      agg.shots_total += 1;
      const xg = Number(event.shot.statsbomb_xg ?? 0);
      if (Number.isFinite(xg)) agg.expected_goals += xg;
      const outcomeId = event.shot.outcome?.id;
      if (outcomeId === 97) agg.goals += 1;
      if (outcomeId != null && SHOT_ON_TARGET_OUTCOME_IDS.has(outcomeId)) {
        agg.shots_on_target += 1;
      }
    }

    if (typeName === 'Pass' && event.pass) {
      agg.passes_total += 1;
      if (!event.pass.outcome) agg.passes_accurate += 1;
      if (event.pass.goal_assist) agg.assists += 1;
      if (event.pass.shot_assist || event.pass.goal_assist) agg.big_chances_created += 1;
    }

    if (typeName === 'Foul Committed') {
      agg.fouls += 1;
      const cardId = event.foul_committed?.card?.id;
      if (cardId != null) {
        if (YELLOW_CARD_IDS.has(cardId)) agg.yellow_cards += 1;
        if (RED_CARD_IDS.has(cardId)) agg.red_cards += 1;
      }
    }

    if (typeName === 'Bad Behaviour') {
      const cardId = event.bad_behaviour?.card?.id;
      if (cardId != null) {
        if (YELLOW_CARD_IDS.has(cardId)) agg.yellow_cards += 1;
        if (RED_CARD_IDS.has(cardId)) agg.red_cards += 1;
      }
    }

    if (typeName === 'Foul Won') agg.was_fouled += 1;

    if (typeName === 'Duel' && event.duel?.type?.name === 'Tackle') {
      agg.tackles += 1;
    }

    if (typeName === 'Interception') {
      agg.interceptions += 1;
    }

    if (typeName === 'Goal Keeper') {
      const gkType = event.goalkeeper?.type?.name?.toLowerCase() ?? '';
      if (gkType.includes('save') || gkType.includes('shot saved')) {
        agg.saves += 1;
      }
    }
  }

  return Array.from(aggByPlayer.values());
}

type TeamStatRow = {
  source_team_id: string;
  is_home: boolean;
  goals: number;
  expected_goals: number;
  shots_total: number;
  shots_on_target: number;
  shots_off_target: number;
  shots_blocked: number;
  shots_inside_box: number;
  shots_outside_box: number;
  corners: number;
  offsides: number;
  fouls: number;
  yellow_cards: number;
  red_cards: number;
  throw_ins: number;
  goal_kicks: number;
  free_kicks: number;
  passes_total: number;
  passes_accurate: number;
  crosses_total: number;
  crosses_accurate: number;
  tackles: number;
  interceptions: number;
  saves: number;
  possession_pct: number;
};

// StatsBomb shot outcome ids.
const SHOT_BLOCKED_ID = 96;
const SHOT_OFF_TARGET_IDS = new Set<number>([98, 99, 101, 115]); // Off T, Post, Wayward, Saved Off T

function makeEmptyTeamStat(teamId: number, isHome: boolean): TeamStatRow {
  return {
    source_team_id: String(teamId),
    is_home: isHome,
    goals: 0,
    expected_goals: 0,
    shots_total: 0,
    shots_on_target: 0,
    shots_off_target: 0,
    shots_blocked: 0,
    shots_inside_box: 0,
    shots_outside_box: 0,
    corners: 0,
    offsides: 0,
    fouls: 0,
    yellow_cards: 0,
    red_cards: 0,
    throw_ins: 0,
    goal_kicks: 0,
    free_kicks: 0,
    passes_total: 0,
    passes_accurate: 0,
    crosses_total: 0,
    crosses_accurate: 0,
    tackles: 0,
    interceptions: 0,
    saves: 0,
    possession_pct: 0,
  };
}

/**
 * Derive team-level match stats from StatsBomb events. Possession is
 * approximated from each team's share of total passes (StatsBomb open data has
 * no possession-time field); everything else is an exact event count.
 */
function aggregateTeamStats(
  events: SbEvent[],
  homeTeamId: number,
  awayTeamId: number,
  homeScore: number | null,
  awayScore: number | null
): TeamStatRow[] {
  const home = makeEmptyTeamStat(homeTeamId, true);
  const away = makeEmptyTeamStat(awayTeamId, false);
  const pick = (teamId: number | undefined): TeamStatRow | null =>
    teamId === homeTeamId ? home : teamId === awayTeamId ? away : null;

  for (const event of events) {
    const agg = pick(event.team?.id);
    if (!agg) continue;
    const typeName = event.type?.name;

    if (typeName === 'Shot' && event.shot) {
      agg.shots_total += 1;
      const xg = Number(event.shot.statsbomb_xg ?? 0);
      if (Number.isFinite(xg)) agg.expected_goals += xg;
      const outcomeId = event.shot.outcome?.id;
      if (outcomeId != null && SHOT_ON_TARGET_OUTCOME_IDS.has(outcomeId)) agg.shots_on_target += 1;
      else if (outcomeId === SHOT_BLOCKED_ID) agg.shots_blocked += 1;
      else if (outcomeId != null && SHOT_OFF_TARGET_IDS.has(outcomeId)) agg.shots_off_target += 1;
      // Pitch is 120 long; penalty box starts at x=102.
      const x = Array.isArray(event.location) ? event.location[0] : null;
      if (x != null) {
        if (x >= 102) agg.shots_inside_box += 1;
        else agg.shots_outside_box += 1;
      }
      if (event.shot.type?.name === 'Free Kick') agg.free_kicks += 1;
    }

    if (typeName === 'Pass' && event.pass) {
      agg.passes_total += 1;
      if (!event.pass.outcome) agg.passes_accurate += 1;
      const passType = event.pass.type?.name;
      if (passType === 'Corner') agg.corners += 1;
      if (passType === 'Throw-in') agg.throw_ins += 1;
      if (passType === 'Goal Kick') agg.goal_kicks += 1;
      if (passType === 'Free Kick') agg.free_kicks += 1;
      if (event.pass.cross) {
        agg.crosses_total += 1;
        if (!event.pass.outcome) agg.crosses_accurate += 1;
      }
    }

    if (typeName === 'Offside') agg.offsides += 1;

    if (typeName === 'Foul Committed') {
      agg.fouls += 1;
      const cardId = event.foul_committed?.card?.id;
      if (cardId != null) {
        if (YELLOW_CARD_IDS.has(cardId)) agg.yellow_cards += 1;
        if (RED_CARD_IDS.has(cardId)) agg.red_cards += 1;
      }
    }
    if (typeName === 'Bad Behaviour') {
      const cardId = event.bad_behaviour?.card?.id;
      if (cardId != null) {
        if (YELLOW_CARD_IDS.has(cardId)) agg.yellow_cards += 1;
        if (RED_CARD_IDS.has(cardId)) agg.red_cards += 1;
      }
    }

    if (typeName === 'Duel' && event.duel?.type?.name === 'Tackle') agg.tackles += 1;
    if (typeName === 'Interception') agg.interceptions += 1;
    if (typeName === 'Goal Keeper') {
      const gkType = event.goalkeeper?.type?.name?.toLowerCase() ?? '';
      if (gkType.includes('save') || gkType.includes('shot saved')) agg.saves += 1;
    }
  }

  // Goals from the final score (own goals, etc. are already reflected there).
  home.goals = homeScore ?? 0;
  away.goals = awayScore ?? 0;

  // Possession proxy from pass share.
  const totalPasses = home.passes_total + away.passes_total;
  if (totalPasses > 0) {
    home.possession_pct = Math.round((home.passes_total / totalPasses) * 1000) / 10;
    away.possession_pct = Math.round((away.passes_total / totalPasses) * 1000) / 10;
  }

  return [home, away];
}

async function ensureCompetitionRegistered(
  supabase: ReturnType<typeof getSupabase>,
  season: EuroSeason
): Promise<void> {
  const { error } = await supabase
    .from('international_competitions')
    .upsert(
      {
        source: 'statsbomb',
        competition_id: String(EURO_COMPETITION_ID),
        competition_name: 'UEFA Euro',
        season_id: String(season.seasonId),
        season_year: season.seasonYear,
        tournament_slug: 'euros',
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'source,competition_id,season_id' }
    );
  if (error) throw new Error(`Failed to upsert competition: ${error.message}`);
}

async function ingestSeason(
  supabase: ReturnType<typeof getSupabase>,
  season: EuroSeason
): Promise<{ matches: number; players: number; statRows: number }> {
  console.log(`\n[statsbomb] === ${season.label} (season_id=${season.seasonId}) ===`);
  await ensureCompetitionRegistered(supabase, season);

  const matchesUrl = `${STATSBOMB_BASE}/matches/${EURO_COMPETITION_ID}/${season.seasonId}.json`;
  const matches = await fetchJson<SbMatch[]>(matchesUrl);
  console.log(`[statsbomb] fetched ${matches.length} matches`);

  // Upsert matches + teams
  const teamRows = new Map<string, { source_team_id: string; team_name: string }>();
  for (const match of matches) {
    teamRows.set(String(match.home_team.home_team_id), {
      source_team_id: String(match.home_team.home_team_id),
      team_name: match.home_team.home_team_name,
    });
    teamRows.set(String(match.away_team.away_team_id), {
      source_team_id: String(match.away_team.away_team_id),
      team_name: match.away_team.away_team_name,
    });
  }
  if (teamRows.size) {
    const { error } = await supabase
      .from('international_teams')
      .upsert(
        Array.from(teamRows.values()).map((row) => ({
          source: 'statsbomb',
          source_team_id: row.source_team_id,
          team_name: row.team_name,
          fetched_at: new Date().toISOString(),
        })),
        { onConflict: 'source,source_team_id' }
      );
    if (error) throw new Error(`Failed to upsert teams: ${error.message}`);
  }

  const matchUpserts = matches.map((m) => ({
    source: 'statsbomb',
    source_match_id: String(m.match_id),
    competition_id: String(EURO_COMPETITION_ID),
    season_id: String(season.seasonId),
    tournament_slug: 'euros',
    season_year: season.seasonYear,
    match_date: m.match_date ?? null,
    kickoff_unix: buildKickoffUnix(m.match_date, m.kick_off),
    stage: m.competition_stage?.name ?? null,
    home_team_source_id: String(m.home_team.home_team_id),
    away_team_source_id: String(m.away_team.away_team_id),
    home_team_name: m.home_team.home_team_name,
    away_team_name: m.away_team.away_team_name,
    home_score: m.home_score,
    away_score: m.away_score,
    status: m.match_status === 'available' ? 'completed' : (m.match_status ?? 'completed'),
    fetched_at: new Date().toISOString(),
  }));
  for (let i = 0; i < matchUpserts.length; i += 200) {
    const chunk = matchUpserts.slice(i, i + 200);
    const { error } = await supabase
      .from('international_matches')
      .upsert(chunk, { onConflict: 'source,source_match_id' });
    if (error) throw new Error(`Failed to upsert matches: ${error.message}`);
  }
  console.log(`[statsbomb] upserted ${matchUpserts.length} matches`);

  // Per-match: lineups + events -> aggregate per player
  let totalPlayerRows = 0;
  let totalUniquePlayers = 0;
  const playerRowMap = new Map<
    string,
    { source_player_id: string; full_name: string; normalized_name: string; position: string | null }
  >();

  let processed = 0;
  for (const match of matches) {
    processed += 1;
    if (processed % 5 === 0 || processed === matches.length) {
      console.log(`[statsbomb] match ${processed}/${matches.length} (id=${match.match_id})`);
    }
    const [lineups, events] = await Promise.all([
      fetchJson<SbLineupTeam[]>(`${STATSBOMB_BASE}/lineups/${match.match_id}.json`),
      fetchJson<SbEvent[]>(`${STATSBOMB_BASE}/events/${match.match_id}.json`),
    ]);
    const aggregated = aggregateMatch(
      events,
      lineups,
      match.home_team.home_team_id,
      match.away_team.away_team_id
    );

    const teamAggregated = aggregateTeamStats(
      events,
      match.home_team.home_team_id,
      match.away_team.away_team_id,
      match.home_score,
      match.away_score
    );
    const teamStatRows = teamAggregated.map((row) => ({
      source: 'statsbomb',
      source_match_id: String(match.match_id),
      source_team_id: row.source_team_id,
      tournament_slug: 'euros',
      season_year: season.seasonYear,
      is_home: row.is_home,
      goals: row.goals,
      expected_goals: Number(row.expected_goals.toFixed(3)),
      shots_total: row.shots_total,
      shots_on_target: row.shots_on_target,
      shots_off_target: row.shots_off_target,
      shots_blocked: row.shots_blocked,
      shots_inside_box: row.shots_inside_box,
      shots_outside_box: row.shots_outside_box,
      corners: row.corners,
      offsides: row.offsides,
      fouls: row.fouls,
      yellow_cards: row.yellow_cards,
      red_cards: row.red_cards,
      throw_ins: row.throw_ins,
      goal_kicks: row.goal_kicks,
      free_kicks: row.free_kicks,
      possession_pct: row.possession_pct,
      passes_total: row.passes_total,
      passes_accurate: row.passes_accurate,
      crosses_total: row.crosses_total,
      crosses_accurate: row.crosses_accurate,
      tackles: row.tackles,
      interceptions: row.interceptions,
      saves: row.saves,
      raw_aggregates: null,
      fetched_at: new Date().toISOString(),
    }));
    {
      const { error } = await supabase
        .from('international_team_match_stats')
        .upsert(teamStatRows, { onConflict: 'source,source_match_id,source_team_id' });
      if (error) throw new Error(`Failed to upsert team_match_stats: ${error.message}`);
    }

    for (const row of aggregated) {
      const existing = playerRowMap.get(row.source_player_id);
      if (!existing) {
        playerRowMap.set(row.source_player_id, {
          source_player_id: row.source_player_id,
          full_name: row.player_name,
          normalized_name: normalizeName(row.player_name),
          position: row.position,
        });
      } else if (!existing.position && row.position) {
        existing.position = row.position;
      }
    }

    const statRows = aggregated.map((row) => ({
      source: 'statsbomb',
      source_match_id: String(match.match_id),
      source_player_id: row.source_player_id,
      source_team_id: row.source_team_id,
      is_home: row.is_home,
      position: row.position,
      minutes_played: row.minutes_played,
      goals: row.goals,
      assists: row.assists,
      shots_total: row.shots_total,
      shots_on_target: row.shots_on_target,
      passes_total: row.passes_total,
      passes_accurate: row.passes_accurate,
      expected_goals: Number(row.expected_goals.toFixed(3)),
      yellow_cards: row.yellow_cards,
      red_cards: row.red_cards,
      tackles: row.tackles,
      interceptions: row.interceptions,
      fouls: row.fouls,
      was_fouled: row.was_fouled,
      saves: row.saves,
      big_chances_created: row.big_chances_created,
      raw_aggregates: row.raw_aggregates,
      fetched_at: new Date().toISOString(),
    }));

    for (let i = 0; i < statRows.length; i += 200) {
      const chunk = statRows.slice(i, i + 200);
      const { error } = await supabase
        .from('international_player_match_stats')
        .upsert(chunk, { onConflict: 'source,source_match_id,source_player_id' });
      if (error) {
        throw new Error(`Failed to upsert player_match_stats: ${error.message}`);
      }
    }
    totalPlayerRows += statRows.length;
  }

  // Upsert player profiles
  if (playerRowMap.size) {
    const playerUpserts = Array.from(playerRowMap.values()).map((row) => ({
      source: 'statsbomb',
      source_player_id: row.source_player_id,
      full_name: row.full_name,
      normalized_name: row.normalized_name,
      primary_position: row.position,
      fetched_at: new Date().toISOString(),
    }));
    for (let i = 0; i < playerUpserts.length; i += 200) {
      const chunk = playerUpserts.slice(i, i + 200);
      const { error } = await supabase
        .from('international_players')
        .upsert(chunk, { onConflict: 'source,source_player_id' });
      if (error) throw new Error(`Failed to upsert players: ${error.message}`);
    }
    totalUniquePlayers = playerUpserts.length;
  }

  console.log(
    `[statsbomb] ${season.label}: ${matchUpserts.length} matches, ${totalUniquePlayers} unique players, ${totalPlayerRows} stat rows`
  );
  return { matches: matchUpserts.length, players: totalUniquePlayers, statRows: totalPlayerRows };
}

/**
 * After ingestion, attempt fuzzy match StatsBomb players -> any existing
 * BDL-derived player rows. We don't have a BDL `players` table here yet, so
 * we only normalize names. When you pull a unified player list, the API will
 * merge by `normalized_name`.
 *
 * This step writes warnings for any StatsBomb player whose normalized name
 * is not unique within the StatsBomb set itself (a heuristic flag).
 */
async function flagAmbiguousPlayers(supabase: ReturnType<typeof getSupabase>): Promise<void> {
  const { data, error } = await supabase
    .from('international_players')
    .select('source, source_player_id, full_name, normalized_name')
    .eq('source', 'statsbomb');
  if (error) {
    console.warn('[statsbomb] could not load players for ambiguity scan:', error.message);
    return;
  }
  const byNormalized = new Map<string, Array<{ source_player_id: string; full_name: string }>>();
  for (const row of data ?? []) {
    const key = row.normalized_name ?? '';
    if (!key) continue;
    const list = byNormalized.get(key) ?? [];
    list.push({ source_player_id: row.source_player_id, full_name: row.full_name });
    byNormalized.set(key, list);
  }

  const warnings: Array<{
    source: string;
    source_player_id: string;
    full_name: string;
    reason: string;
    bdl_candidates: unknown;
  }> = [];
  for (const [, list] of byNormalized) {
    if (list.length <= 1) continue;
    for (const entry of list) {
      warnings.push({
        source: 'statsbomb',
        source_player_id: entry.source_player_id,
        full_name: entry.full_name,
        reason: 'multiple_statsbomb_matches',
        bdl_candidates: list.filter((other) => other.source_player_id !== entry.source_player_id),
      });
    }
  }
  if (!warnings.length) {
    console.log('[statsbomb] no ambiguous player names detected.');
    return;
  }

  const { error: insertError } = await supabase.from('international_player_warnings').insert(warnings);
  if (insertError) {
    console.warn('[statsbomb] could not write warnings:', insertError.message);
    return;
  }
  console.log(`[statsbomb] flagged ${warnings.length} ambiguous player rows`);
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function main() {
  const yearArg = process.argv.find((arg) => arg.startsWith('--year='));
  const onlyYear = yearArg ? Number.parseInt(yearArg.split('=')[1] || '', 10) : null;
  const seasonsToRun = onlyYear
    ? EURO_SEASONS.filter((s) => s.seasonYear === onlyYear)
    : EURO_SEASONS;
  if (!seasonsToRun.length) {
    throw new Error(`No EURO season matches --year=${String(onlyYear)}`);
  }

  const supabase = getSupabase();

  let totalMatches = 0;
  let totalPlayers = 0;
  let totalStatRows = 0;
  for (const season of seasonsToRun) {
    const result = await ingestSeason(supabase, season);
    totalMatches += result.matches;
    totalPlayers += result.players;
    totalStatRows += result.statRows;
  }

  await flagAmbiguousPlayers(supabase);

  console.log(`\n[statsbomb] DONE. matches=${totalMatches} players=${totalPlayers} stat_rows=${totalStatRows}`);
}

main().catch((error) => {
  console.error('[statsbomb] failed:', error);
  process.exitCode = 1;
});
