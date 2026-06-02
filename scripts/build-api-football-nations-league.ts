#!/usr/bin/env npx tsx

/**
 * Ingest UEFA Nations League data from API-Football (v3) into Supabase.
 *
 * Run with:
 *   npx tsx scripts/build-api-football-nations-league.ts
 *   npx tsx scripts/build-api-football-nations-league.ts --year=2024
 *   npx tsx scripts/build-api-football-nations-league.ts --year=2022,2024
 *   npx tsx scripts/build-api-football-nations-league.ts --resume
 *   npx tsx scripts/build-api-football-nations-league.ts --include-2018
 *
 * Requires API_FOOTBALL_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 *
 * Note: API-Football has almost no per-player stats for the 2018 Nations League
 * (~4/142 fixtures). Default seasons are 2020, 2022, 2024 (full coverage).
 *
 * The script is idempotent: every upsert keys off (source, source_*_id) and
 * re-running just refreshes rows. --resume skips fixtures that already have
 * stat rows in international_player_match_stats.
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const NATIONS_LEAGUE_LEAGUE_ID = 5;
const TOURNAMENT_SLUG = 'nations-league';
const SOURCE = 'api-football';

// API-Football season param = calendar year the UNL edition started.
// 2018-19 → 2018 (sparse player stats), 2020-21 → 2020, etc.
const DEFAULT_SEASONS = [2020, 2022, 2024];
const ALL_SEASONS = [2018, 2020, 2022, 2024];

type ApiResponse<T> = {
  get: string;
  parameters: Record<string, string>;
  errors: unknown;
  results: number;
  paging: { current: number; total: number };
  response: T;
};

type ApiFixture = {
  fixture: {
    id: number;
    referee: string | null;
    timezone: string;
    date: string;
    timestamp: number;
    status: { long: string; short: string; elapsed: number | null };
    venue: { id: number | null; name: string | null; city: string | null };
  };
  league: {
    id: number;
    season: number;
    round: string;
    name: string;
  };
  teams: {
    home: { id: number; name: string; logo: string };
    away: { id: number; name: string; logo: string };
  };
  goals: { home: number | null; away: number | null };
  score: {
    fulltime: { home: number | null; away: number | null };
  };
};

type ApiPlayerStatBlock = {
  games: {
    minutes: number | null;
    number: number | null;
    position: string | null;
    rating: string | null;
    captain: boolean;
    substitute: boolean;
  };
  offsides: number | null;
  shots: { total: number | null; on: number | null };
  goals: {
    total: number | null;
    conceded: number | null;
    assists: number | null;
    saves: number | null;
  };
  passes: { total: number | null; key: number | null; accuracy: number | null };
  tackles: { total: number | null; blocks: number | null; interceptions: number | null };
  duels: { total: number | null; won: number | null };
  dribbles: { attempts: number | null; success: number | null; past: number | null };
  fouls: { drawn: number | null; committed: number | null };
  cards: { yellow: number | null; red: number | null };
  penalty: {
    won: number | null;
    commited: number | null; // API-Football typo, preserved
    scored: number | null;
    missed: number | null;
    saved: number | null;
  };
};

type ApiFixturePlayers = {
  team: { id: number; name: string; logo: string; update: string };
  players: Array<{
    player: { id: number; name: string; photo: string };
    statistics: ApiPlayerStatBlock[];
  }>;
};

type IngestStats = { matches: number; players: number; statRows: number };

function n(value: number | null | undefined): number {
  return Number.isFinite(value as number) ? (value as number) : 0;
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseYearArg(): number[] | null {
  const arg = process.argv.find((a) => a.startsWith('--year='));
  if (!arg) return null;
  const raw = arg.split('=')[1] ?? '';
  const years = raw
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  return years.length ? years : null;
}

let _requestCount = 0;
async function apiFootballFetch<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY missing from .env.local');

  const url = new URL(`${API_FOOTBALL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  // Gentle pacing - paid plans allow 10 req/sec but we stay well under.
  if (_requestCount > 0 && _requestCount % 9 === 0) {
    await new Promise((r) => setTimeout(r, 1100));
  }
  _requestCount += 1;

  const maxAttempts = 4;
  let attempt = 0;
  let lastErr: unknown = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await fetch(url.toString(), {
        headers: {
          'x-apisports-key': key,
          Accept: 'application/json',
        },
      });

      // Rate-limit signalling
      if (response.status === 429) {
        const wait = Math.min(15000, 1500 * attempt);
        console.warn(`[api-football] 429 rate-limited, waiting ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url.pathname}`);
      }

      const body = (await response.json()) as ApiResponse<T> & { message?: string };

      // API-Football returns 200 with an `errors` body for plan/quota issues.
      const errors = body.errors;
      const hasErrors =
        (Array.isArray(errors) && errors.length > 0) ||
        (errors && typeof errors === 'object' && Object.keys(errors as object).length > 0);
      if (hasErrors) {
        const text = JSON.stringify(errors);
        // Plan/limit errors are non-retryable
        if (/limit|plan|subscription|requires/i.test(text)) {
          throw new Error(`API-Football plan error on ${path}: ${text}`);
        }
        throw new Error(`API-Football errors on ${path}: ${text}`);
      }

      return body.response as T;
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts) break;
      const wait = 1000 * attempt;
      console.warn(`[api-football] attempt ${attempt} failed (${(err as Error).message}), retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Failed to fetch ${url.pathname}`);
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

async function ensureCompetitionRegistered(
  supabase: ReturnType<typeof getSupabase>,
  seasonYear: number
): Promise<void> {
  const { error } = await supabase.from('international_competitions').upsert(
    {
      source: SOURCE,
      competition_id: String(NATIONS_LEAGUE_LEAGUE_ID),
      competition_name: 'UEFA Nations League',
      season_id: String(seasonYear),
      season_year: seasonYear,
      tournament_slug: TOURNAMENT_SLUG,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'source,competition_id,season_id' }
  );
  if (error) throw new Error(`Failed to upsert competition: ${error.message}`);
}

async function loadFixturesForSeason(seasonYear: number): Promise<ApiFixture[]> {
  console.log(`[api-football] loading fixtures league=${NATIONS_LEAGUE_LEAGUE_ID} season=${seasonYear}`);
  const fixtures = await apiFootballFetch<ApiFixture[]>('/fixtures', {
    league: NATIONS_LEAGUE_LEAGUE_ID,
    season: seasonYear,
  });
  // Only ingest finished fixtures - "FT" = Full Time, "AET" / "PEN" = extra/pens finished.
  const finishedStatuses = new Set(['FT', 'AET', 'PEN']);
  return fixtures.filter((f) => finishedStatuses.has(f.fixture.status.short));
}

async function loadFixturePlayers(fixtureId: number): Promise<ApiFixturePlayers[]> {
  const data = await apiFootballFetch<ApiFixturePlayers[]>('/fixtures/players', { fixture: fixtureId });
  return Array.isArray(data) ? data : [];
}

/** Quick probe: does API-Football return player stats for this season? */
async function probeSeasonPlayerCoverage(seasonYear: number): Promise<number> {
  const fixtures = await loadFixturesForSeason(seasonYear);
  if (!fixtures.length) return 0;
  const probeId = fixtures[0]!.fixture.id;
  const teams = await loadFixturePlayers(probeId);
  const playerCount = teams.reduce((sum, t) => sum + (t.players?.length ?? 0), 0);
  return playerCount;
}

async function upsertTeams(
  supabase: ReturnType<typeof getSupabase>,
  fixtures: ApiFixture[]
): Promise<void> {
  const teamMap = new Map<string, { id: number; name: string }>();
  for (const f of fixtures) {
    teamMap.set(String(f.teams.home.id), { id: f.teams.home.id, name: f.teams.home.name });
    teamMap.set(String(f.teams.away.id), { id: f.teams.away.id, name: f.teams.away.name });
  }
  if (!teamMap.size) return;
  const rows = Array.from(teamMap.values()).map((t) => ({
    source: SOURCE,
    source_team_id: String(t.id),
    team_name: t.name,
    fetched_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase
      .from('international_teams')
      .upsert(chunk, { onConflict: 'source,source_team_id' });
    if (error) throw new Error(`Failed to upsert teams: ${error.message}`);
  }
}

async function upsertMatches(
  supabase: ReturnType<typeof getSupabase>,
  fixtures: ApiFixture[],
  seasonYear: number
): Promise<void> {
  const rows = fixtures.map((f) => {
    const date = f.fixture.date ? new Date(f.fixture.date) : null;
    const matchDate = date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null;
    return {
      source: SOURCE,
      source_match_id: String(f.fixture.id),
      competition_id: String(NATIONS_LEAGUE_LEAGUE_ID),
      season_id: String(seasonYear),
      tournament_slug: TOURNAMENT_SLUG,
      season_year: seasonYear,
      match_date: matchDate,
      kickoff_unix: f.fixture.timestamp ?? null,
      stage: f.league.round ?? null,
      home_team_source_id: String(f.teams.home.id),
      away_team_source_id: String(f.teams.away.id),
      home_team_name: f.teams.home.name,
      away_team_name: f.teams.away.name,
      home_score: f.goals.home ?? f.score.fulltime.home ?? null,
      away_score: f.goals.away ?? f.score.fulltime.away ?? null,
      status: 'completed',
      fetched_at: new Date().toISOString(),
    };
  });
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase
      .from('international_matches')
      .upsert(chunk, { onConflict: 'source,source_match_id' });
    if (error) throw new Error(`Failed to upsert matches: ${error.message}`);
  }
}

async function loadAlreadyIngestedFixtureIds(
  supabase: ReturnType<typeof getSupabase>,
  seasonYear: number
): Promise<Set<string>> {
  const set = new Set<string>();
  const { data: matchRows, error: matchErr } = await supabase
    .from('international_matches')
    .select('source_match_id')
    .eq('source', SOURCE)
    .eq('tournament_slug', TOURNAMENT_SLUG)
    .eq('season_year', seasonYear);
  if (matchErr) {
    console.warn('[api-football] could not load existing matches:', matchErr.message);
    return set;
  }
  const ids = (matchRows ?? []).map((r: { source_match_id: string }) => r.source_match_id);
  if (!ids.length) return set;

  // Check which of those match ids already have at least one player stat row.
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data, error } = await supabase
      .from('international_player_match_stats')
      .select('source_match_id')
      .eq('source', SOURCE)
      .in('source_match_id', chunk);
    if (error) {
      console.warn('[api-football] could not load existing stats:', error.message);
      return set;
    }
    for (const row of data ?? []) {
      set.add(String((row as { source_match_id: string }).source_match_id));
    }
  }
  return set;
}

async function ingestFixtureStats(
  supabase: ReturnType<typeof getSupabase>,
  fixture: ApiFixture
): Promise<{ playerRows: number; uniquePlayers: number; noPlayerData: boolean }> {
  const homeId = fixture.teams.home.id;
  const fixtureId = fixture.fixture.id;
  const teams = await loadFixturePlayers(fixtureId);

  const statRows: Array<Record<string, unknown>> = [];
  const playerProfiles = new Map<
    string,
    { source_player_id: string; full_name: string; normalized_name: string; position: string | null }
  >();

  for (const teamBlock of teams) {
    const teamId = teamBlock.team.id;
    const isHome = teamId === homeId;
    for (const playerBlock of teamBlock.players) {
      const stat = playerBlock.statistics?.[0];
      if (!stat) continue;

      const minutes = n(stat.games?.minutes);
      const position = stat.games?.position ?? null;
      const passesTotal = n(stat.passes?.total);
      const passAccuracyPct = stat.passes?.accuracy != null ? Number(stat.passes.accuracy) : 0;
      const passesAccurate =
        passesTotal > 0 && Number.isFinite(passAccuracyPct)
          ? Math.round((passesTotal * passAccuracyPct) / 100)
          : 0;

      const rawAggregates = {
        rating: stat.games?.rating ? Number(stat.games.rating) : null,
        captain: stat.games?.captain ?? false,
        substitute: stat.games?.substitute ?? false,
        offsides: n(stat.offsides),
        key_passes: n(stat.passes?.key),
        duels_total: n(stat.duels?.total),
        duels_won: n(stat.duels?.won),
        dribbles_attempted: n(stat.dribbles?.attempts),
        dribbles_completed: n(stat.dribbles?.success),
        dribbles_past: n(stat.dribbles?.past),
        clearances: n(stat.tackles?.blocks),
        penalty_won: n(stat.penalty?.won),
        penalty_committed: n(stat.penalty?.commited),
        penalty_scored: n(stat.penalty?.scored),
        penalty_missed: n(stat.penalty?.missed),
        penalty_saved: n(stat.penalty?.saved),
        passes_accuracy_pct: passAccuracyPct,
      };

      statRows.push({
        source: SOURCE,
        source_match_id: String(fixtureId),
        source_player_id: String(playerBlock.player.id),
        source_team_id: String(teamId),
        is_home: isHome,
        position,
        minutes_played: minutes,
        goals: n(stat.goals?.total),
        assists: n(stat.goals?.assists),
        shots_total: n(stat.shots?.total),
        shots_on_target: n(stat.shots?.on),
        passes_total: passesTotal,
        passes_accurate: passesAccurate,
        expected_goals: null, // API-Football does not provide xG
        yellow_cards: n(stat.cards?.yellow),
        red_cards: n(stat.cards?.red),
        tackles: n(stat.tackles?.total),
        interceptions: n(stat.tackles?.interceptions),
        fouls: n(stat.fouls?.committed),
        was_fouled: n(stat.fouls?.drawn),
        saves: n(stat.goals?.saves),
        big_chances_created: 0, // not provided
        raw_aggregates: rawAggregates,
        fetched_at: new Date().toISOString(),
      });

      const pid = String(playerBlock.player.id);
      if (!playerProfiles.has(pid)) {
        playerProfiles.set(pid, {
          source_player_id: pid,
          full_name: playerBlock.player.name,
          normalized_name: normalizeName(playerBlock.player.name),
          position,
        });
      } else if (!playerProfiles.get(pid)!.position && position) {
        playerProfiles.get(pid)!.position = position;
      }
    }
  }

  if (statRows.length) {
    for (let i = 0; i < statRows.length; i += 200) {
      const chunk = statRows.slice(i, i + 200);
      const { error } = await supabase
        .from('international_player_match_stats')
        .upsert(chunk, { onConflict: 'source,source_match_id,source_player_id' });
      if (error) {
        throw new Error(`Failed to upsert player_match_stats for fixture ${fixtureId}: ${error.message}`);
      }
    }
  }

  if (playerProfiles.size) {
    const rows = Array.from(playerProfiles.values()).map((p) => ({
      source: SOURCE,
      source_player_id: p.source_player_id,
      full_name: p.full_name,
      normalized_name: p.normalized_name,
      primary_position: p.position,
      fetched_at: new Date().toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await supabase
        .from('international_players')
        .upsert(chunk, { onConflict: 'source,source_player_id' });
      if (error) throw new Error(`Failed to upsert players: ${error.message}`);
    }
  }

  return {
    playerRows: statRows.length,
    uniquePlayers: playerProfiles.size,
    noPlayerData: statRows.length === 0,
  };
}

async function ingestSeason(
  supabase: ReturnType<typeof getSupabase>,
  seasonYear: number,
  resume: boolean
): Promise<IngestStats> {
  console.log(`\n[api-football] === UEFA Nations League ${seasonYear} season ===`);
  await ensureCompetitionRegistered(supabase, seasonYear);

  const fixtures = await loadFixturesForSeason(seasonYear);
  console.log(`[api-football] ${fixtures.length} finished fixtures`);

  await upsertTeams(supabase, fixtures);
  await upsertMatches(supabase, fixtures, seasonYear);

  const alreadyIngested = resume ? await loadAlreadyIngestedFixtureIds(supabase, seasonYear) : new Set<string>();
  if (resume && alreadyIngested.size) {
    console.log(`[api-football] resume mode: ${alreadyIngested.size} fixtures already have stats, will skip`);
  }

  let processed = 0;
  let totalStatRows = 0;
  let fixturesWithStats = 0;
  let fixturesWithoutStats = 0;
  let skippedResume = 0;

  for (const fixture of fixtures) {
    processed += 1;
    const idStr = String(fixture.fixture.id);
    if (alreadyIngested.has(idStr)) {
      skippedResume += 1;
      continue;
    }

    try {
      const { playerRows, noPlayerData } = await ingestFixtureStats(supabase, fixture);
      totalStatRows += playerRows;
      if (noPlayerData) fixturesWithoutStats += 1;
      else fixturesWithStats += 1;

      // Log progress when we actually ingest rows, or every 25 fixtures.
      if (playerRows > 0 || processed % 25 === 0 || processed === fixtures.length) {
        console.log(
          `[api-football] fixture ${processed}/${fixtures.length} (id=${fixture.fixture.id}) +${playerRows} rows`
        );
      }
    } catch (err) {
      console.warn(
        `[api-football] fixture ${fixture.fixture.id} failed: ${(err as Error).message} - continuing`
      );
    }
  }

  if (fixturesWithoutStats > 0) {
    console.warn(
      `[api-football] season ${seasonYear}: ${fixturesWithoutStats} fixtures had no player stats in API-Football` +
        (seasonYear === 2018
          ? ' (expected — use 2020+ seasons; 2018 has ~3% coverage)'
          : '')
    );
  }
  if (skippedResume > 0) {
    console.log(`[api-football] season ${seasonYear}: skipped ${skippedResume} fixtures (already ingested)`);
  }

  console.log(
    `[api-football] season ${seasonYear} DONE: ${fixtures.length} matches, ${fixturesWithStats} with stats, ${totalStatRows} stat rows`
  );
  return { matches: fixtures.length, players: fixturesWithStats, statRows: totalStatRows };
}

async function flagAmbiguousPlayers(supabase: ReturnType<typeof getSupabase>): Promise<void> {
  const { data, error } = await supabase
    .from('international_players')
    .select('source, source_player_id, full_name, normalized_name')
    .eq('source', SOURCE);
  if (error) {
    console.warn('[api-football] could not load players for ambiguity scan:', error.message);
    return;
  }
  const byNorm = new Map<string, Array<{ source_player_id: string; full_name: string }>>();
  for (const row of data ?? []) {
    const key = (row as { normalized_name: string | null }).normalized_name ?? '';
    if (!key) continue;
    const list = byNorm.get(key) ?? [];
    list.push({
      source_player_id: (row as { source_player_id: string }).source_player_id,
      full_name: (row as { full_name: string }).full_name,
    });
    byNorm.set(key, list);
  }
  const warnings: Array<{
    source: string;
    source_player_id: string;
    full_name: string;
    reason: string;
    bdl_candidates: unknown;
  }> = [];
  for (const [, list] of byNorm) {
    if (list.length <= 1) continue;
    for (const entry of list) {
      warnings.push({
        source: SOURCE,
        source_player_id: entry.source_player_id,
        full_name: entry.full_name,
        reason: 'multiple_api_football_matches',
        bdl_candidates: list.filter((other) => other.source_player_id !== entry.source_player_id),
      });
    }
  }
  if (!warnings.length) {
    console.log('[api-football] no ambiguous player names detected.');
    return;
  }
  const { error: insertError } = await supabase.from('international_player_warnings').insert(warnings);
  if (insertError) {
    console.warn('[api-football] could not write warnings:', insertError.message);
    return;
  }
  console.log(`[api-football] flagged ${warnings.length} ambiguous player rows`);
}

function resolveSeasons(): number[] {
  const yearFilter = parseYearArg();
  const include2018 = process.argv.includes('--include-2018');
  const base = include2018 ? ALL_SEASONS : DEFAULT_SEASONS;
  const seasons = yearFilter ? base.filter((y) => yearFilter.includes(y)) : base;
  return [...seasons].sort((a, b) => b - a);
}

async function main() {
  const resume = process.argv.includes('--resume');
  const seasons = resolveSeasons();
  if (!seasons.length) {
    throw new Error(`No matching seasons. Available: ${ALL_SEASONS.join(', ')}`);
  }

  console.log(`[api-football] seasons to ingest: ${seasons.join(', ')}`);
  for (const year of seasons) {
    const players = await probeSeasonPlayerCoverage(year);
    if (players === 0) {
      console.warn(
        `[api-football] WARNING: season ${year} probe returned 0 players — API may not have stats for this edition`
      );
    } else {
      console.log(`[api-football] season ${year} probe OK (${players} players in sample fixture)`);
    }
  }

  const supabase = getSupabase();
  let totalMatches = 0;
  let totalStatRows = 0;
  for (const year of seasons) {
    const r = await ingestSeason(supabase, year, resume);
    totalMatches += r.matches;
    totalStatRows += r.statRows;
  }
  await flagAmbiguousPlayers(supabase);

  console.log(
    `\n[api-football] ALL DONE. seasons=${seasons.join(',')} matches=${totalMatches} stat_rows=${totalStatRows}`
  );
  console.log(`[api-football] total requests: ${_requestCount}`);
}

main().catch((error) => {
  console.error('[api-football] failed:', error);
  process.exitCode = 1;
});
