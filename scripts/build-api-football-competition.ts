#!/usr/bin/env npx tsx

/**
 * Generalized API-Football (v3) ingestion for international national-team
 * tournaments into the shared `international_*` Supabase tables. Same shape as
 * the Nations League ingestion, parameterized by competition so Copa América,
 * AFCON, Nations League, etc. all flow through one code path.
 *
 * Run with:
 *   npx tsx scripts/build-api-football-competition.ts --competition=copa-america
 *   npx tsx scripts/build-api-football-competition.ts --competition=afcon
 *   npx tsx scripts/build-api-football-competition.ts --competition=copa-america --year=2021,2024
 *   npx tsx scripts/build-api-football-competition.ts --competition=afcon --resume
 *
 * Requires API_FOOTBALL_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 *
 * Idempotent: every upsert keys off (source, source_*_id); re-running refreshes
 * rows. --resume skips fixtures that already have stat rows.
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const SOURCE = 'api-football';

type CompetitionConfig = {
  slug: string;
  leagueId: number;
  name: string;
  /** API-Football season param = calendar year the edition is listed under. */
  defaultSeasons: number[];
};

// Confirmed via scripts/probe-api-football-competitions.ts — all have full
// per-player match-stat coverage.
const COMPETITIONS: Record<string, CompetitionConfig> = {
  'copa-america': {
    slug: 'copa-america',
    leagueId: 9,
    name: 'Copa América',
    defaultSeasons: [2024],
  },
  afcon: {
    slug: 'afcon',
    leagueId: 6,
    name: 'Africa Cup of Nations',
    defaultSeasons: [2025],
  },
  'asian-cup': {
    slug: 'asian-cup',
    leagueId: 7,
    name: 'AFC Asian Cup',
    // API season year is the tournament edition (2023 played Jan 2024).
    defaultSeasons: [2023],
  },
  'nations-league': {
    slug: 'nations-league',
    leagueId: 5,
    name: 'UEFA Nations League',
    defaultSeasons: [2020, 2022, 2024],
  },
  // World Cup qualifiers (api-sports league ids: 29=CAF, 30=AFC, 31=CONCACAF,
  // 32=UEFA, 33=OFC, 34=CONMEBOL). Only CONMEBOL / UEFA / CONCACAF expose
  // per-player and team match stats; CAF / AFC / OFC qualifiers have fixtures
  // only. Season numbers below are the 2026-cycle editions (verified via API).
  'wcq-conmebol': {
    slug: 'wcq-conmebol',
    leagueId: 34,
    name: 'World Cup Qualification (CONMEBOL)',
    defaultSeasons: [2026],
  },
  'wcq-uefa': {
    slug: 'wcq-uefa',
    leagueId: 32,
    name: 'World Cup Qualification (UEFA)',
    defaultSeasons: [2024],
  },
  'wcq-concacaf': {
    slug: 'wcq-concacaf',
    leagueId: 31,
    name: 'World Cup Qualification (CONCACAF)',
    defaultSeasons: [2026],
  },

  // ---- Club leagues (player + team club form) ----
  // Slugs are prefixed `club-` so the World Cup dashboard tags every one of
  // them as a single "Club" competition (vs the national-team tags). Default to
  // the most recent completed season only (2025 = the 2025/26 European season
  // that just finished, and the 2025 calendar-year season elsewhere). Coverage
  // for all 15 verified via scripts/probe-club-league-coverage.ts.
  // ── Domestic leagues ──────────────────────────────────────────────────────
  epl: { slug: 'club-epl', leagueId: 39, name: 'Premier League', defaultSeasons: [2025] },
  championship: { slug: 'club-championship', leagueId: 40, name: 'Championship', defaultSeasons: [2025] },
  'la-liga': { slug: 'club-la-liga', leagueId: 140, name: 'La Liga', defaultSeasons: [2025] },
  'serie-a': { slug: 'club-serie-a', leagueId: 135, name: 'Serie A', defaultSeasons: [2025] },
  bundesliga: { slug: 'club-bundesliga', leagueId: 78, name: 'Bundesliga', defaultSeasons: [2025] },
  brasileirao: { slug: 'club-brasileirao', leagueId: 71, name: 'Brasileirão', defaultSeasons: [2025] },
  'ligue-1': { slug: 'club-ligue-1', leagueId: 61, name: 'Ligue 1', defaultSeasons: [2025] },
  'liga-portugal': { slug: 'club-liga-portugal', leagueId: 94, name: 'Liga Portugal', defaultSeasons: [2025] },
  eredivisie: { slug: 'club-eredivisie', leagueId: 88, name: 'Eredivisie', defaultSeasons: [2025] },
  mls: { slug: 'club-mls', leagueId: 253, name: 'Major League Soccer', defaultSeasons: [2025] },
  'belgian-pro-league': { slug: 'club-belgian-pro-league', leagueId: 144, name: 'Belgian Pro League', defaultSeasons: [2025] },
  'saudi-pro-league': { slug: 'club-saudi-pro-league', leagueId: 307, name: 'Saudi Pro League', defaultSeasons: [2025] },
  'argentine-primera': { slug: 'club-argentine-primera', leagueId: 128, name: 'Argentine Primera División', defaultSeasons: [2025] },
  'liga-mx': { slug: 'club-liga-mx', leagueId: 262, name: 'Liga MX', defaultSeasons: [2025] },
  'super-lig': { slug: 'club-super-lig', leagueId: 203, name: 'Süper Lig', defaultSeasons: [2025] },
  'j1-league': { slug: 'club-j1-league', leagueId: 98, name: 'J1 League', defaultSeasons: [2025] },
  'k-league': { slug: 'club-k-league', leagueId: 292, name: 'K League 1', defaultSeasons: [2025] },
  'a-league': { slug: 'club-a-league', leagueId: 188, name: 'A-League', defaultSeasons: [2025] },
  'scottish-prem': { slug: 'club-scottish-prem', leagueId: 179, name: 'Scottish Premiership', defaultSeasons: [2025] },
  'south-african-psl': { slug: 'club-south-african-psl', leagueId: 288, name: 'South African PSL', defaultSeasons: [2025] },

  // ── UEFA club competitions ─────────────────────────────────────────────────
  'champions-league': { slug: 'club-champions-league', leagueId: 2, name: 'UEFA Champions League', defaultSeasons: [2025] },
  'europa-league': { slug: 'club-europa-league', leagueId: 3, name: 'UEFA Europa League', defaultSeasons: [2025] },
  'conference-league': { slug: 'club-conference-league', leagueId: 848, name: 'UEFA Conference League', defaultSeasons: [2025] },

  // ── Domestic cups ──────────────────────────────────────────────────────────
  'fa-cup': { slug: 'club-fa-cup', leagueId: 45, name: 'FA Cup', defaultSeasons: [2025] },
  'efl-cup': { slug: 'club-efl-cup', leagueId: 48, name: 'EFL Cup', defaultSeasons: [2025] },
  'copa-del-rey': { slug: 'club-copa-del-rey', leagueId: 143, name: 'Copa del Rey', defaultSeasons: [2025] },
  'dfb-pokal': { slug: 'club-dfb-pokal', leagueId: 81, name: 'DFB-Pokal', defaultSeasons: [2025] },
  'coppa-italia': { slug: 'club-coppa-italia', leagueId: 137, name: 'Coppa Italia', defaultSeasons: [2025] },
  'coupe-de-france': { slug: 'club-coupe-de-france', leagueId: 66, name: 'Coupe de France', defaultSeasons: [2025] },
  'taca-de-portugal': { slug: 'club-taca-de-portugal', leagueId: 96, name: 'Taça de Portugal', defaultSeasons: [2025] },
};

/** Club-competition preset keys, for the convenience all-clubs runner / docs. */
const CLUB_COMPETITION_KEYS = [
  // Domestic leagues
  'epl',
  'la-liga',
  'serie-a',
  'bundesliga',
  'brasileirao',
  'ligue-1',
  'liga-portugal',
  'eredivisie',
  'mls',
  'belgian-pro-league',
  'saudi-pro-league',
  'argentine-primera',
  'liga-mx',
  'super-lig',
  'j1-league',
  'championship',
  'k-league',
  'a-league',
  'scottish-prem',
  'south-african-psl',
  // UEFA club competitions
  'champions-league',
  'europa-league',
  'conference-league',
  // Domestic cups
  'fa-cup',
  'efl-cup',
  'copa-del-rey',
  'dfb-pokal',
  'coppa-italia',
  'coupe-de-france',
  'taca-de-portugal',
] as const;

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
  league: { id: number; season: number; round: string; name: string };
  teams: {
    home: { id: number; name: string; logo: string; winner?: boolean | null };
    away: { id: number; name: string; logo: string; winner?: boolean | null };
  };
  goals: { home: number | null; away: number | null };
  score: {
    fulltime: { home: number | null; away: number | null };
    extratime?: { home: number | null; away: number | null };
    penalty?: { home: number | null; away: number | null };
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
  goals: { total: number | null; conceded: number | null; assists: number | null; saves: number | null };
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

type ApiFixtureStatistics = {
  team: { id: number; name: string; logo: string };
  statistics: Array<{ type: string; value: number | string | null }>;
};

type IngestStats = { matches: number; players: number; statRows: number };

type ApiSquadPlayer = {
  id: number;
  name: string;
  firstname: string;
  lastname: string;
  age: number;
  number: number | null;
  position: string;
  photo: string;
};

type ApiSquadResponse = {
  team: { id: number; name: string; logo: string };
  players: ApiSquadPlayer[];
};

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
    .filter((v) => Number.isFinite(v));
  return years.length ? years : null;
}

/**
 * Resolve which competition(s) to ingest. Supports a single `--competition=epl`
 * or the meta value `--competition=all-clubs` to run every club league in one
 * pass (sequentially, so API-Football rate limits are respected).
 */
function parseCompetitionArgs(): CompetitionConfig[] {
  const arg = process.argv.find((a) => a.startsWith('--competition='));
  const key = (arg?.split('=')[1] ?? '').trim().toLowerCase();
  if (!key) {
    throw new Error(
      `--competition is required. Available: ${Object.keys(COMPETITIONS).join(', ')} (or all-clubs)`
    );
  }
  if (key === 'all-clubs') {
    return CLUB_COMPETITION_KEYS.map((k) => COMPETITIONS[k]);
  }
  const cfg = COMPETITIONS[key];
  if (!cfg) {
    throw new Error(
      `Unknown competition "${key}". Available: ${Object.keys(COMPETITIONS).join(', ')} (or all-clubs)`
    );
  }
  return [cfg];
}

let _requestCount = 0;
async function apiFootballFetch<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY missing from .env.local');

  const url = new URL(`${API_FOOTBALL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

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
        headers: { 'x-apisports-key': key, Accept: 'application/json' },
      });
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
      const errors = body.errors;
      const hasErrors =
        (Array.isArray(errors) && errors.length > 0) ||
        (errors && typeof errors === 'object' && Object.keys(errors as object).length > 0);
      if (hasErrors) {
        const text = JSON.stringify(errors);
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
  cfg: CompetitionConfig,
  seasonYear: number
): Promise<void> {
  const { error } = await supabase.from('international_competitions').upsert(
    {
      source: SOURCE,
      competition_id: String(cfg.leagueId),
      competition_name: cfg.name,
      season_id: String(seasonYear),
      season_year: seasonYear,
      tournament_slug: cfg.slug,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'source,competition_id,season_id' }
  );
  if (error) throw new Error(`Failed to upsert competition: ${error.message}`);
}

async function loadFixturesForSeason(cfg: CompetitionConfig, seasonYear: number): Promise<ApiFixture[]> {
  console.log(`[api-football] loading fixtures league=${cfg.leagueId} (${cfg.slug}) season=${seasonYear}`);
  const fixtures = await apiFootballFetch<ApiFixture[]>('/fixtures', {
    league: cfg.leagueId,
    season: seasonYear,
  });
  const finishedStatuses = new Set(['FT', 'AET', 'PEN']);
  return fixtures.filter((f) => finishedStatuses.has(f.fixture.status.short));
}

async function loadFixturePlayers(fixtureId: number): Promise<ApiFixturePlayers[]> {
  const data = await apiFootballFetch<ApiFixturePlayers[]>('/fixtures/players', { fixture: fixtureId });
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch full player names for every team in a season via /players/squads.
 * Returns a Map<playerId, fullName> built from firstname + lastname so the
 * ingestion can store proper names instead of abbreviated fixture names.
 */
async function buildPlayerNameCache(
  leagueId: number,
  seasonYear: number
): Promise<Map<number, string>> {
  const cache = new Map<number, string>();
  try {
    type ApiSquadsResponse = { team: { id: number }; players: ApiSquadPlayer[] }[];
    const squads = await apiFootballFetch<ApiSquadsResponse>('/players/squads', {
      league: leagueId,
      season: seasonYear,
    });
    if (!Array.isArray(squads)) return cache;
    for (const squadBlock of squads) {
      for (const p of squadBlock.players ?? []) {
        if (!p.id) continue;
        const full =
          p.firstname && p.lastname
            ? `${p.firstname} ${p.lastname}`
            : p.name || '';
        if (full) cache.set(p.id, full);
      }
    }
    console.log(`[api-football] name cache: ${cache.size} players for league=${leagueId} season=${seasonYear}`);
  } catch (err) {
    console.warn(`[api-football] name cache fetch failed (league=${leagueId} season=${seasonYear}):`, (err as Error).message);
  }
  return cache;
}

async function loadFixtureStatistics(fixtureId: number): Promise<ApiFixtureStatistics[]> {
  const data = await apiFootballFetch<ApiFixtureStatistics[]>('/fixtures/statistics', { fixture: fixtureId });
  return Array.isArray(data) ? data : [];
}

/** Parse an API-Football stat value: numbers, "55%", "12", or null. */
function parseStatValue(value: number | string | null): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = value.replace('%', '').trim();
  if (!cleaned) return null;
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

/** Map API-Football's statistics `type` labels to our team-stat columns. */
function mapApiFootballTeamStats(
  stats: Array<{ type: string; value: number | string | null }>
): Record<string, number | null> {
  const byType = new Map<string, number | null>();
  for (const s of stats) byType.set(s.type.trim().toLowerCase(), parseStatValue(s.value));
  const get = (label: string) => byType.get(label.toLowerCase()) ?? null;
  return {
    shots_total: get('Total Shots'),
    shots_on_target: get('Shots on Goal'),
    shots_off_target: get('Shots off Goal'),
    shots_blocked: get('Blocked Shots'),
    shots_inside_box: get('Shots insidebox'),
    shots_outside_box: get('Shots outsidebox'),
    corners: get('Corner Kicks'),
    offsides: get('Offsides'),
    fouls: get('Fouls'),
    yellow_cards: get('Yellow Cards'),
    red_cards: get('Red Cards'),
    saves: get('Goalkeeper Saves'),
    possession_pct: get('Ball Possession'),
    passes_total: get('Total passes'),
    passes_accurate: get('Passes accurate'),
    passes_final_third: get('Passes final third') ?? get('Passes in final third') ?? get('Passes into final third'),
    throw_ins: get('Throw Ins') ?? get('Throw-ins'),
    goal_kicks: get('Goal Kicks') ?? get('Goal kicks'),
    free_kicks: get('Free Kicks') ?? get('Free kicks'),
    long_balls_total: get('Long Balls') ?? get('Total Long Balls'),
    long_balls_accurate: get('Long Balls Accurate') ?? get('Accurate Long Balls'),
    crosses_total: get('Total Crosses') ?? get('Crosses'),
    crosses_accurate: get('Accurate Crosses'),
    expected_goals: get('expected_goals'),
  };
}

async function probeSeasonPlayerCoverage(cfg: CompetitionConfig, seasonYear: number): Promise<number> {
  const fixtures = await loadFixturesForSeason(cfg, seasonYear);
  if (!fixtures.length) return 0;
  const probeId = fixtures[0]!.fixture.id;
  const teams = await loadFixturePlayers(probeId);
  return teams.reduce((sum, t) => sum + (t.players?.length ?? 0), 0);
}

async function upsertTeams(supabase: ReturnType<typeof getSupabase>, fixtures: ApiFixture[]): Promise<void> {
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
    const { error } = await supabase.from('international_teams').upsert(chunk, { onConflict: 'source,source_team_id' });
    if (error) throw new Error(`Failed to upsert teams: ${error.message}`);
  }
}

async function upsertMatches(
  supabase: ReturnType<typeof getSupabase>,
  cfg: CompetitionConfig,
  fixtures: ApiFixture[],
  seasonYear: number
): Promise<void> {
  const rows = fixtures.map((f) => {
    const date = f.fixture.date ? new Date(f.fixture.date) : null;
    const matchDate = date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null;
    return {
      source: SOURCE,
      source_match_id: String(f.fixture.id),
      competition_id: String(cfg.leagueId),
      season_id: String(seasonYear),
      tournament_slug: cfg.slug,
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
      home_score_penalty: f.score.penalty?.home ?? null,
      away_score_penalty: f.score.penalty?.away ?? null,
      has_penalty_shootout:
        f.score.penalty?.home != null &&
        f.score.penalty?.away != null &&
        f.score.penalty.home !== f.score.penalty.away,
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
  cfg: CompetitionConfig,
  seasonYear: number
): Promise<Set<string>> {
  const set = new Set<string>();
  const { data: matchRows, error: matchErr } = await supabase
    .from('international_matches')
    .select('source_match_id')
    .eq('source', SOURCE)
    .eq('tournament_slug', cfg.slug)
    .eq('season_year', seasonYear);
  if (matchErr) {
    console.warn('[api-football] could not load existing matches:', matchErr.message);
    return set;
  }
  const ids = (matchRows ?? []).map((r: { source_match_id: string }) => r.source_match_id);
  if (!ids.length) return set;
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
    for (const row of data ?? []) set.add(String((row as { source_match_id: string }).source_match_id));
  }
  return set;
}

async function ingestFixtureStats(
  supabase: ReturnType<typeof getSupabase>,
  fixture: ApiFixture,
  playerNameCache: Map<number, string> = new Map()
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
        expected_goals: null,
        yellow_cards: n(stat.cards?.yellow),
        red_cards: n(stat.cards?.red),
        tackles: n(stat.tackles?.total),
        interceptions: n(stat.tackles?.interceptions),
        fouls: n(stat.fouls?.committed),
        was_fouled: n(stat.fouls?.drawn),
        saves: n(stat.goals?.saves),
        big_chances_created: 0,
        raw_aggregates: rawAggregates,
        fetched_at: new Date().toISOString(),
      });

      const pid = String(playerBlock.player.id);
      if (!playerProfiles.has(pid)) {
        // Prefer the squad-cached full name (e.g. "Heung-Min Son") over the
        // fixture abbreviated name (e.g. "H. Son") so cross-source name matching
        // works in the dashboard.
        const cachedName = playerNameCache.get(playerBlock.player.id);
        const fullName = cachedName || playerBlock.player.name;
        playerProfiles.set(pid, {
          source_player_id: pid,
          full_name: fullName,
          normalized_name: normalizeName(fullName),
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
      if (error) throw new Error(`Failed to upsert player_match_stats for fixture ${fixtureId}: ${error.message}`);
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

  return { playerRows: statRows.length, uniquePlayers: playerProfiles.size, noPlayerData: statRows.length === 0 };
}

async function ingestFixtureTeamStats(
  supabase: ReturnType<typeof getSupabase>,
  cfg: CompetitionConfig,
  fixture: ApiFixture,
  seasonYear: number
): Promise<number> {
  const fixtureId = fixture.fixture.id;
  const homeId = fixture.teams.home.id;
  const teams = await loadFixtureStatistics(fixtureId);
  if (!teams.length) return 0;

  const rows = teams.map((teamBlock) => {
    const teamId = teamBlock.team.id;
    const isHome = teamId === homeId;
    const mapped = mapApiFootballTeamStats(teamBlock.statistics ?? []);
    const scoreGoals = isHome
      ? fixture.goals.home ?? fixture.score.fulltime.home
      : fixture.goals.away ?? fixture.score.fulltime.away;
    return {
      source: SOURCE,
      source_match_id: String(fixtureId),
      source_team_id: String(teamId),
      tournament_slug: cfg.slug,
      season_year: seasonYear,
      is_home: isHome,
      goals: scoreGoals ?? null,
      expected_goals: mapped.expected_goals,
      shots_total: mapped.shots_total,
      shots_on_target: mapped.shots_on_target,
      shots_off_target: mapped.shots_off_target,
      shots_blocked: mapped.shots_blocked,
      shots_inside_box: mapped.shots_inside_box,
      shots_outside_box: mapped.shots_outside_box,
      corners: mapped.corners,
      offsides: mapped.offsides,
      fouls: mapped.fouls,
      yellow_cards: mapped.yellow_cards,
      red_cards: mapped.red_cards,
      possession_pct: mapped.possession_pct,
      passes_total: mapped.passes_total,
      passes_accurate: mapped.passes_accurate,
      passes_final_third: mapped.passes_final_third,
      throw_ins: mapped.throw_ins,
      goal_kicks: mapped.goal_kicks,
      free_kicks: mapped.free_kicks,
      long_balls_total: mapped.long_balls_total,
      long_balls_accurate: mapped.long_balls_accurate,
      crosses_total: mapped.crosses_total,
      crosses_accurate: mapped.crosses_accurate,
      saves: mapped.saves,
      raw_aggregates: null,
      fetched_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from('international_team_match_stats')
    .upsert(rows, { onConflict: 'source,source_match_id,source_team_id' });
  if (error) throw new Error(`Failed to upsert team_match_stats for fixture ${fixtureId}: ${error.message}`);
  return rows.length;
}

async function ingestSeason(
  supabase: ReturnType<typeof getSupabase>,
  cfg: CompetitionConfig,
  seasonYear: number,
  resume: boolean,
  skipTeamStats: boolean
): Promise<IngestStats> {
  console.log(`\n[api-football] === ${cfg.name} ${seasonYear} season ===`);
  await ensureCompetitionRegistered(supabase, cfg, seasonYear);

  const fixtures = await loadFixturesForSeason(cfg, seasonYear);
  console.log(`[api-football] ${fixtures.length} finished fixtures`);

  await upsertTeams(supabase, fixtures);
  await upsertMatches(supabase, cfg, fixtures, seasonYear);

  // Build a full-name cache from /players/squads so fixture abbreviated names
  // (e.g. "H. Son") are replaced with proper names (e.g. "Heung-Min Son")
  // before they are stored in international_players.
  const playerNameCache = await buildPlayerNameCache(cfg.leagueId, seasonYear);

  const alreadyIngested = resume ? await loadAlreadyIngestedFixtureIds(supabase, cfg, seasonYear) : new Set<string>();
  if (resume && alreadyIngested.size) {
    console.log(`[api-football] resume mode: ${alreadyIngested.size} fixtures already have stats, will skip`);
  }

  let processed = 0;
  let totalStatRows = 0;
  let totalTeamRows = 0;
  let fixturesWithStats = 0;
  let fixturesWithoutStats = 0;
  let skippedResume = 0;

  for (const fixture of fixtures) {
    processed += 1;
    const idStr = String(fixture.fixture.id);

    // Team-level stats (corners, possession, offsides, shot splits) normally run
    // for every fixture, even ones whose player stats already exist in resume
    // mode. Skipped entirely with --player-stats-only (one fewer API call per
    // fixture — roughly halves request usage).
    if (!skipTeamStats) {
      try {
        totalTeamRows += await ingestFixtureTeamStats(supabase, cfg, fixture, seasonYear);
      } catch (err) {
        console.warn(`[api-football] fixture ${fixture.fixture.id} team-stats failed: ${(err as Error).message} - continuing`);
      }
    }

    if (alreadyIngested.has(idStr)) {
      skippedResume += 1;
      continue;
    }
    try {
      const { playerRows, noPlayerData } = await ingestFixtureStats(supabase, fixture, playerNameCache);
      totalStatRows += playerRows;
      if (noPlayerData) fixturesWithoutStats += 1;
      else fixturesWithStats += 1;
      if (playerRows > 0 || processed % 25 === 0 || processed === fixtures.length) {
        console.log(
          `[api-football] fixture ${processed}/${fixtures.length} (id=${fixture.fixture.id}) +${playerRows} rows`
        );
      }
    } catch (err) {
      console.warn(`[api-football] fixture ${fixture.fixture.id} failed: ${(err as Error).message} - continuing`);
    }
  }
  console.log(`[api-football] season ${seasonYear}: ${totalTeamRows} team-stat rows`);

  if (fixturesWithoutStats > 0) {
    console.warn(`[api-football] season ${seasonYear}: ${fixturesWithoutStats} fixtures had no player stats`);
  }
  if (skippedResume > 0) {
    console.log(`[api-football] season ${seasonYear}: skipped ${skippedResume} fixtures (already ingested)`);
  }
  console.log(
    `[api-football] ${cfg.name} ${seasonYear} DONE: ${fixtures.length} matches, ${fixturesWithStats} with stats, ${totalStatRows} stat rows`
  );
  return { matches: fixtures.length, players: fixturesWithStats, statRows: totalStatRows };
}

/**
 * Finds all API Football player records whose stored name is abbreviated
 * (e.g. "H. Son") and replaces them with the full name fetched from the
 * /players endpoint. Run this after ingestion to fix name-matching failures
 * in the dashboard's cross-source stat merge. Only updates rows that actually
 * differ so re-runs are idempotent.
 */
async function enrichAbbreviatedPlayerNames(supabase: ReturnType<typeof getSupabase>): Promise<void> {
  const { data: abbrevRows, error } = await supabase
    .from('international_players')
    .select('source_player_id, full_name')
    .eq('source', SOURCE)
    .like('full_name', '%. %'); // matches "H. Son", "J. Doe", etc.

  if (error) {
    console.warn('[api-football] enrich: could not load abbreviated players:', error.message);
    return;
  }
  if (!abbrevRows?.length) {
    console.log('[api-football] enrich: no abbreviated player names found');
    return;
  }
  console.log(`[api-football] enrich: resolving ${abbrevRows.length} abbreviated names...`);

  type ApiPlayerEntry = {
    player: { id: number; name: string; firstname: string; lastname: string };
    statistics: unknown[];
  };

  let enriched = 0;
  for (const row of abbrevRows) {
    try {
      const data = await apiFootballFetch<ApiPlayerEntry[]>('/players', {
        id: row.source_player_id,
        season: 2024,
      });
      if (!Array.isArray(data) || !data[0]?.player) continue;
      const { firstname, lastname, name: apiName } = data[0].player;
      const fullName =
        firstname && lastname ? `${firstname} ${lastname}` : apiName || '';
      if (!fullName || fullName === row.full_name) continue;
      const newNorm = normalizeName(fullName);
      await supabase
        .from('international_players')
        .update({ full_name: fullName, normalized_name: newNorm })
        .eq('source', SOURCE)
        .eq('source_player_id', row.source_player_id);
      console.log(`[api-football] enrich: "${row.full_name}" → "${fullName}"`);
      enriched += 1;
    } catch {
      // Player may not have stats in 2024 season; skip silently
    }
  }
  console.log(`[api-football] enrich: updated ${enriched}/${abbrevRows.length} names`);
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

function resolveSeasons(cfg: CompetitionConfig): number[] {
  const yearFilter = parseYearArg();
  const seasons = yearFilter ?? cfg.defaultSeasons;
  return [...seasons].sort((a, b) => b - a);
}

async function diagnoseMissingPlayers(supabase: ReturnType<typeof getSupabase>): Promise<void> {
  const BDL_FIFA_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';
  const bdlKey = process.env.BALLDONTLIE_API_KEY || process.env.BDL_API_KEY || process.env.NEXT_PUBLIC_BDL_API_KEY || '';
  if (!bdlKey) {
    console.error('[diagnose] BDL_API_KEY not set');
    return;
  }

  console.log('[diagnose] fetching 2026 WC players from BDL...');

  const allPlayers: Array<{ id: number; name: string; team?: { name?: string; country?: string } }> = [];
  let cursor: string | null = null;
  do {
    const url = new URL(`${BDL_FIFA_BASE}/players`);
    url.searchParams.set('seasons[]', '2026');
    url.searchParams.set('per_page', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url.toString(), { headers: { Authorization: bdlKey } });
    if (!res.ok) throw new Error('BDL /players ' + res.status);
    const body = (await res.json()) as {
      data: Array<{ id: number; name: string; team?: { name?: string; country?: string } }>;
      meta?: { next_cursor?: string };
    };
    allPlayers.push(...body.data);
    cursor = body.meta?.next_cursor ?? null;
  } while (cursor);

  console.log('[diagnose] loaded ' + allPlayers.length + ' players\n');

  const countryArg = process.argv.find((a) => a.startsWith('--country='));
  const countryFilter = countryArg ? countryArg.split('=')[1]!.toLowerCase() : null;
  const filtered = countryFilter
    ? allPlayers.filter(
        (p) =>
          (p.team?.name ?? '').toLowerCase().includes(countryFilter) ||
          (p.team?.country ?? '').toLowerCase().includes(countryFilter)
      )
    : allPlayers;

  const noMatch: Array<{
    name: string; id: number; team: string;
    closeMatch: Array<{ source: string; full_name: string; normalized_name: string }>;
  }> = [];
  const matchCount: { n: number } = { n: 0 };

  for (const player of filtered) {
    const norm = normalizeName(player.name);
    const parts = norm.split(' ');
    const searched = [norm];
    if (parts.length >= 2) {
      const reversed = [...parts.slice(1), parts[0]!].join(' ');
      if (reversed !== norm) searched.push(reversed);
    }

    const { data: exactData } = await supabase
      .from('international_players')
      .select('source, full_name')
      .in('normalized_name', searched)
      .in('source', ['api-football', 'sofascore']);

    const found = (exactData ?? []) as Array<{ source: string; full_name: string }>;
    if (found.length > 0) {
      matchCount.n += 1;
      continue;
    }

    // Try fuzzy: does DB have anyone whose normalized_name contains the last word?
    const lastName = parts[parts.length - 1]!;
    const { data: fuzzyData } = await supabase
      .from('international_players')
      .select('source, full_name, normalized_name')
      .ilike('normalized_name', '%' + lastName + '%')
      .in('source', ['api-football', 'sofascore'])
      .limit(5);

    noMatch.push({
      name: player.name,
      id: player.id,
      team: player.team?.name ?? '?',
      closeMatch: (fuzzyData ?? []) as Array<{ source: string; full_name: string; normalized_name: string }>,
    });
  }

  const fixable = noMatch.filter((p) => p.closeMatch.length > 0);
  const notInDb = noMatch.filter((p) => p.closeMatch.length === 0);

  console.log('MATCHED:    ' + matchCount.n + '/' + filtered.length);
  console.log('FIXABLE:    ' + fixable.length + ' (in DB under different name)');
  console.log('NOT IN DB:  ' + notInDb.length + ' (club data not ingested)\n');

  if (fixable.length > 0) {
    console.log('=== FIXABLE — add aliases for these ===');
    for (const p of fixable) {
      console.log('  BDL "' + p.name + '" [' + p.id + ']');
      for (const c of p.closeMatch) {
        console.log('    DB ' + c.source + ': "' + c.full_name + '" (norm: ' + c.normalized_name + ')');
        console.log("    -> add alias: '" + normalizeName(p.name) + "': ['" + c.normalized_name + "']");
      }
    }
  }

  if (notInDb.length > 0) {
    console.log('\n=== NOT IN DB — need ingestion for their club league ===');
    for (const p of notInDb) {
      console.log('  "' + p.name + '" (' + p.team + ')');
    }
  }
}

async function main() {
  const enrichNames = process.argv.includes('--enrich-names');
  const diagnose = process.argv.includes('--diagnose');
  const supabase = getSupabase();

  // Standalone modes — no --competition needed, checked before parseCompetitionArgs().
  if (enrichNames) {
    await enrichAbbreviatedPlayerNames(supabase);
    console.log(`[api-football] total requests: ${_requestCount}`);
    return;
  }
  if (diagnose) {
    await diagnoseMissingPlayers(supabase);
    return;
  }

  // --dvp-gap=<slug>  Show team-stat vs player-stat coverage gap for a nation (e.g. --dvp-gap=rsa)
  const dvpGapArg = process.argv.find((a) => a.startsWith('--dvp-gap='));
  if (dvpGapArg) {
    const slug = dvpGapArg.split('=').slice(1).join('=').toLowerCase().trim();
    console.log(`\n[dvp-gap] Checking coverage gap for slug="${slug}"...\n`);

    // international_matches that involve this nation (search by known team names for the slug)
    // Try both exact slug match via resolveWorldCupFlagCode logic and common team name patterns
    const namePattern = slug === 'rsa' ? 'south africa' : slug;
    type IntlMatchRow = {
      source: string;
      source_match_id: string;
      tournament_slug: string | null;
      season_year: number | null;
      home_team_name: string;
      away_team_name: string;
      match_date: string | null;
    };
    const { data: intlMatchesRaw } = await supabase
      .from('international_matches')
      .select('source, source_match_id, tournament_slug, season_year, home_team_name, away_team_name, match_date')
      .or(`home_team_name.ilike.%${namePattern}%,away_team_name.ilike.%${namePattern}%`)
      .not('tournament_slug', 'like', 'club%')
      .order('match_date', { ascending: false })
      .limit(50);
    const intlMatches = (intlMatchesRaw ?? []) as IntlMatchRow[];

    console.log(`\n[dvp-gap] international_matches (non-club): ${intlMatches.length} rows`);
    const matchByTournament: Record<string, number> = {};
    for (const r of intlMatches) {
      const key = `${r.tournament_slug ?? 'unknown'} / ${r.season_year ?? '?'} (${r.source})`;
      matchByTournament[key] = (matchByTournament[key] ?? 0) + 1;
    }
    for (const [k, count] of Object.entries(matchByTournament).sort()) {
      console.log(`  ${count}x  ${k}`);
    }

    if (intlMatches.length === 0) {
      console.log('\n[dvp-gap] No international_matches found — the Opponent Breakdown 12 games must come from international_team_match_stats with a different key.');
    }

    const matchIds = intlMatches.map((m) => m.source_match_id);
    if (matchIds.length > 0) {
      type StatRow = { source: string; source_match_id: string; tournament_slug?: string | null; season_year?: number | null };
      const { data: teamStatRowsRaw } = await supabase
        .from('international_team_match_stats')
        .select('source, source_match_id, tournament_slug, season_year')
        .in('source_match_id', matchIds.slice(0, 30))
        .limit(200);
      const teamStatRows = (teamStatRowsRaw ?? []) as StatRow[];
      const matchesWithTeamStats = new Set(teamStatRows.map((r) => r.source_match_id));
      console.log(`\n[dvp-gap] international_team_match_stats for those matches: ${teamStatRows.length} rows (${matchesWithTeamStats.size} unique matches)`);
    }

    if (matchIds.length > 0) {
      type PlayerRow = { source: string; source_match_id: string };
      const { data: playerRowsRaw } = await supabase
        .from('international_player_match_stats')
        .select('source, source_match_id')
        .in('source_match_id', matchIds.slice(0, 30))
        .limit(200);
      const playerRows = (playerRowsRaw ?? []) as PlayerRow[];
      const matchesWithPlayerStats = new Set(playerRows.map((r) => r.source_match_id));
      const matchesWithoutPlayerStats = matchIds.filter((id) => !matchesWithPlayerStats.has(id));
      console.log(`\n[dvp-gap] international_player_match_stats rows for those matches: ${playerRows.length}`);
      console.log(`[dvp-gap] matches WITH player stats:    ${matchesWithPlayerStats.size}/${matchIds.length}`);
      console.log(`[dvp-gap] matches WITHOUT player stats: ${matchesWithoutPlayerStats.length}/${matchIds.length}`);
      for (const id of matchesWithoutPlayerStats.slice(0, 10)) {
        const m = intlMatches.find((x) => x.source_match_id === id);
        if (m) console.log(`  match_id=${id}  ${m.home_team_name} vs ${m.away_team_name}  [${m.tournament_slug}/${m.season_year}]  (${m.source})`);
      }
    }
    return;
  }

  // --lookup=<name>  Search international_players for any name containing a word
  const lookupArg = process.argv.find((a) => a.startsWith('--lookup='));
  if (lookupArg) {
    const term = lookupArg.split('=').slice(1).join('=').toLowerCase().trim();
    const { data } = await supabase
      .from('international_players')
      .select('source, source_player_id, full_name, normalized_name')
      .ilike('normalized_name', '%' + term + '%')
      .in('source', ['api-football', 'sofascore'])
      .limit(20);
    if (!data?.length) {
      console.log('[lookup] No records found for "' + term + '"');
    } else {
      console.log('[lookup] Results for "' + term + '":');
      for (const r of data as Array<{ source: string; source_player_id: string; full_name: string; normalized_name: string }>) {
        console.log('  ' + r.source + ':' + r.source_player_id + '  "' + r.full_name + '"  (norm: ' + r.normalized_name + ')');
      }
    }
    return;
  }

  const configs = parseCompetitionArgs();
  const resume = process.argv.includes('--resume');
  const skipTeamStats =
    process.argv.includes('--player-stats-only') || process.argv.includes('--skip-team-stats');
  if (skipTeamStats) console.log('[api-football] PLAYER-STATS-ONLY — skipping team fixture statistics');

  let grandMatches = 0;
  let grandStatRows = 0;

  for (const cfg of configs) {
    const seasons = resolveSeasons(cfg);
    if (!seasons.length) throw new Error(`No seasons resolved for ${cfg.slug}`);

    console.log(
      `\n[api-football] ######## competition=${cfg.slug} (league ${cfg.leagueId}) seasons: ${seasons.join(', ')} ########`
    );
    for (const year of seasons) {
      const players = await probeSeasonPlayerCoverage(cfg, year);
      if (players === 0) {
        console.warn(`[api-football] WARNING: season ${year} probe returned 0 players — API may lack stats for this edition`);
      } else {
        console.log(`[api-football] season ${year} probe OK (${players} players in sample fixture)`);
      }
    }

    for (const year of seasons) {
      const r = await ingestSeason(supabase, cfg, year, resume, skipTeamStats);
      grandMatches += r.matches;
      grandStatRows += r.statRows;
    }
  }

  // After ingestion, expand abbreviated names so cross-source dashboard matching works
  await enrichAbbreviatedPlayerNames(supabase);
  await flagAmbiguousPlayers(supabase);

  console.log(
    `\n[api-football] ALL DONE. competitions=${configs.map((c) => c.slug).join(',')} matches=${grandMatches} stat_rows=${grandStatRows}`
  );
  console.log(`[api-football] total requests: ${_requestCount}`);
}

main().catch((error) => {
  console.error('[api-football] failed:', error);
  process.exitCode = 1;
});
