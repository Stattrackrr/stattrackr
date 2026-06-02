#!/usr/bin/env npx tsx

/**
 * Ingest UEFA Nations League per-player match stats from Sofascore into Supabase.
 *
 * Sofascore blocks direct server fetch (403) — we open their site in Puppeteer and
 * call api.sofascore.com from the page context (same pattern as FotMob leagues).
 *
 * Run:
 *   npx tsx scripts/build-sofascore-nations-league.ts
 *   npx tsx scripts/build-sofascore-nations-league.ts --from=2019
 *   npx tsx scripts/build-sofascore-nations-league.ts --season=40128
 *   npx tsx scripts/build-sofascore-nations-league.ts --limit=5 --dry-run
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */

import { config } from 'dotenv';
import type { Browser, Page } from 'puppeteer-core';
import { launchHeadlessBrowser } from '../lib/puppeteerLaunch';

config({ path: '.env.local' });

const SOFASCORE_API = 'https://api.sofascore.com/api/v1';
const NL_TOURNAMENT_ID = 10783;
const SOURCE = 'sofascore';
const TOURNAMENT_SLUG = 'nations_league';
const REQUEST_DELAY_MS = 800;
const LANDING_URL =
  'https://www.sofascore.com/tournament/football/europe/uefa-nations-league/10783';

/** Fallback if /seasons is blocked — ids from Sofascore (verified via probe). */
const FALLBACK_SEASONS: SofaSeason[] = [
  { id: 58337, year: '24/25', name: 'UEFA Nations League 24/25', seasonYear: 2025 },
  { id: 40128, year: '22/23', name: 'UEFA Nations League 22/23', seasonYear: 2023 },
  { id: 27595, year: '20/21', name: 'UEFA Nations League 20/21', seasonYear: 2021 },
  { id: 16000, year: '18/19', name: 'UEFA Nations League 18/19', seasonYear: 2019 },
];

type SofaSeason = { id: number; year: string; name: string; seasonYear: number };

type SofaEvent = {
  id: number;
  startTimestamp?: number;
  status?: { type?: string };
  hasEventPlayerStatistics?: boolean;
  homeTeam?: { id: number; name: string; shortName?: string };
  awayTeam?: { id: number; name: string; shortName?: string };
  homeScore?: { current?: number };
  awayScore?: { current?: number };
  roundInfo?: { round?: number; name?: string };
};

type SofaPlayerLineup = {
  player: {
    id: number;
    name: string;
    position?: string;
    country?: { alpha3?: string };
  };
  teamId: number;
  position?: string;
  substitute?: boolean;
  statistics?: Record<string, number | string | object | undefined>;
};

type PlayerStatRow = {
  source_player_id: string;
  player_name: string;
  source_team_id: string;
  team_name: string;
  is_home: boolean;
  position: string | null;
  country_code: string | null;
  minutes_played: number;
  goals: number;
  assists: number;
  shots_total: number;
  shots_on_target: number;
  passes_total: number;
  passes_accurate: number;
  expected_goals: number | null;
  yellow_cards: number;
  red_cards: number;
  tackles: number;
  interceptions: number;
  fouls: number;
  was_fouled: number;
  saves: number;
  raw_aggregates: Record<string, number>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseSeasonYear(yearStr: string): number {
  const slash = yearStr.match(/(\d{2})\/(\d{2})/);
  if (slash) {
    const end = Number.parseInt(slash[2], 10);
    return end >= 50 ? 1900 + end : 2000 + end;
  }
  const four = yearStr.match(/(20\d{2})/);
  if (four) return Number.parseInt(four[1], 10);
  return Number.parseInt(yearStr, 10) || 0;
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function mapSofaStats(stats: Record<string, unknown> | undefined): Omit<
  PlayerStatRow,
  'source_player_id' | 'player_name' | 'source_team_id' | 'team_name' | 'is_home' | 'position' | 'country_code'
> {
  const s = stats ?? {};
  const raw: Record<string, number> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'statisticsType') continue;
    const n = num(v);
    if (n !== 0) raw[k] = n;
  }

  const shotsTotal = num(s.totalShots);
  const shotsOnTarget = num(s.onTargetScoringAttempt);
  const xg = num(s.expectedGoals) || num(s.goalsExpected) || null;

  return {
    minutes_played: num(s.minutesPlayed),
    goals: num(s.goals),
    assists: num(s.goalAssist),
    shots_total: shotsTotal,
    shots_on_target: shotsOnTarget,
    passes_total: num(s.totalPass),
    passes_accurate: num(s.accuratePass),
    expected_goals: xg && xg > 0 ? xg : null,
    yellow_cards: num(s.yellowCards),
    red_cards: num(s.redCards),
    tackles: num(s.totalTackle),
    interceptions: num(s.interceptionWon),
    fouls: num(s.fouls),
    was_fouled: num(s.wasFouled),
    saves:
      num(s.saves) ||
      num(s.goalkeeperSaves) ||
      num(s.savedShotsFromInsideTheBox) ||
      num(s.savedShotsFromOutsideTheBox) ||
      0,
    raw_aggregates: raw,
  };
}

async function sofaFetch<T>(page: Page, path: string, attempt = 0): Promise<T> {
  const url = path.startsWith('http') ? path : `${SOFASCORE_API}${path.startsWith('/') ? '' : '/'}${path}`;

  try {
    // Navigate directly to the API URL — same-origin fetch, full browser identity.
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const status = response?.status() ?? 0;
    const text = (await response?.text()) ?? '';

    if (status === 403 || status === 429) {
      if (attempt < 3) {
        const wait = 5000 * (attempt + 1);
        console.warn(`[sofascore] HTTP ${status} on ${path} — backing off ${wait}ms (retry ${attempt + 1}/3)`);
        await sleep(wait);
        // Re-prime cookies by hitting the landing page again.
        if (attempt === 1) {
          await page.goto(LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
          await sleep(2000);
        }
        return sofaFetch<T>(page, path, attempt + 1);
      }
      throw new Error(`Sofascore ${path} failed: HTTP ${status} ${text.slice(0, 200)}`);
    }

    if (status !== 200) {
      throw new Error(`Sofascore ${path} failed: HTTP ${status} ${text.slice(0, 200)}`);
    }

    // The body is wrapped in <pre> when navigated to JSON. Strip if present.
    const stripped = text.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>\s*$/, '');
    try {
      return JSON.parse(stripped) as T;
    } catch {
      // Some responses are inside <pre>...</pre>; try matching that
      const match = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
      if (match) return JSON.parse(match[1]) as T;
      throw new Error(`Sofascore ${path} returned non-JSON: ${text.slice(0, 200)}`);
    }
  } catch (e) {
    if (attempt < 2 && !(e instanceof Error && /HTTP 403/.test(e.message))) {
      console.warn(`[sofascore] error on ${path}: ${(e as Error).message} (retry ${attempt + 1})`);
      await sleep(3000);
      return sofaFetch<T>(page, path, attempt + 1);
    }
    throw e;
  }
}

async function loadSeasons(page: Page): Promise<SofaSeason[]> {
  try {
    const data = await sofaFetch<{ seasons: Array<{ id: number; year: string; name: string }> }>(
      page,
      `/unique-tournament/${NL_TOURNAMENT_ID}/seasons`
    );
    return (data.seasons ?? []).map((s) => ({
      ...s,
      seasonYear: parseSeasonYear(s.year),
    }));
  } catch (error) {
    console.warn('[sofascore] could not load seasons API, using fallback list:', (error as Error).message);
    return FALLBACK_SEASONS;
  }
}

async function loadAllEvents(page: Page, seasonId: number): Promise<SofaEvent[]> {
  const all: SofaEvent[] = [];
  let pageNum = 0;
  for (;;) {
    const data = await sofaFetch<{ events: SofaEvent[]; hasNextPage?: boolean }>(
      page,
      `/unique-tournament/${NL_TOURNAMENT_ID}/season/${seasonId}/events/last/${pageNum}`
    );
    const batch = data.events ?? [];
    all.push(...batch);
    if (!data.hasNextPage) break;
    pageNum += 1;
    await sleep(300);
  }
  return all;
}

function parsePlayersFromLineups(
  lineups: {
    home: { players: SofaPlayerLineup[] };
    away: { players: SofaPlayerLineup[] };
  },
  event: SofaEvent
): PlayerStatRow[] {
  const homeTeamId = String(event.homeTeam?.id ?? '');
  const awayTeamId = String(event.awayTeam?.id ?? '');
  const homeName = event.homeTeam?.name ?? 'Home';
  const awayName = event.awayTeam?.name ?? 'Away';
  const rows: PlayerStatRow[] = [];

  const sides: Array<{ side: SofaPlayerLineup[]; isHome: boolean; teamId: string; teamName: string }> = [
    { side: lineups.home?.players ?? [], isHome: true, teamId: homeTeamId, teamName: homeName },
    { side: lineups.away?.players ?? [], isHome: false, teamId: awayTeamId, teamName: awayName },
  ];

  for (const { side, isHome, teamId, teamName } of sides) {
    for (const entry of side) {
      const stats = entry.statistics as Record<string, unknown> | undefined;
      const mapped = mapSofaStats(stats);
      if (mapped.minutes_played < 1) continue;

      const player = entry.player;
      rows.push({
        source_player_id: String(player.id),
        player_name: player.name,
        source_team_id: String(entry.teamId || teamId),
        team_name: teamName,
        is_home: isHome,
        position: entry.position ?? player.position ?? null,
        country_code: player.country?.alpha3 ?? null,
        ...mapped,
      });
    }
  }
  return rows;
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

async function ensureCompetition(
  supabase: ReturnType<typeof getSupabase>,
  season: SofaSeason
): Promise<void> {
  const { error } = await supabase.from('international_competitions').upsert(
    {
      source: SOURCE,
      competition_id: String(NL_TOURNAMENT_ID),
      competition_name: 'UEFA Nations League',
      season_id: String(season.id),
      season_year: season.seasonYear,
      tournament_slug: TOURNAMENT_SLUG,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'source,competition_id,season_id' }
  );
  if (error) throw new Error(`competition upsert: ${error.message}`);
}

async function ingestSeason(
  page: Page,
  supabase: ReturnType<typeof getSupabase> | null,
  season: SofaSeason,
  options: { limit: number | null; dryRun: boolean }
): Promise<{ matches: number; players: number; statRows: number }> {
  console.log(`\n[sofascore] === ${season.name} (season_id=${season.id}, year=${season.seasonYear}) ===`);
  if (!options.dryRun && supabase) await ensureCompetition(supabase, season);

  const events = await loadAllEvents(page, season.id);
  const finished = events.filter((e) => e.status?.type === 'finished');
  const toProcess = options.limit ? finished.slice(0, options.limit) : finished;
  console.log(`[sofascore]   ${finished.length} finished matches (${toProcess.length} to process)`);

  const teamRows = new Map<string, string>();
  for (const e of finished) {
    if (e.homeTeam) teamRows.set(String(e.homeTeam.id), e.homeTeam.name);
    if (e.awayTeam) teamRows.set(String(e.awayTeam.id), e.awayTeam.name);
  }

  if (!options.dryRun && supabase && teamRows.size) {
    const { error } = await supabase.from('international_teams').upsert(
      [...teamRows.entries()].map(([source_team_id, team_name]) => ({
        source: SOURCE,
        source_team_id,
        team_name,
        fetched_at: new Date().toISOString(),
      })),
      { onConflict: 'source,source_team_id' }
    );
    if (error) throw new Error(`teams upsert: ${error.message}`);
  }

  const matchUpserts = finished.map((e) => ({
    source: SOURCE,
    source_match_id: String(e.id),
    competition_id: String(NL_TOURNAMENT_ID),
    season_id: String(season.id),
    tournament_slug: TOURNAMENT_SLUG,
    season_year: season.seasonYear,
    match_date: e.startTimestamp
      ? new Date(e.startTimestamp * 1000).toISOString().slice(0, 10)
      : null,
    kickoff_unix: e.startTimestamp ?? null,
    stage: e.roundInfo?.name ?? (e.roundInfo?.round != null ? `Round ${e.roundInfo.round}` : null),
    home_team_source_id: String(e.homeTeam?.id ?? ''),
    away_team_source_id: String(e.awayTeam?.id ?? ''),
    home_team_name: e.homeTeam?.name ?? '',
    away_team_name: e.awayTeam?.name ?? '',
    home_score: e.homeScore?.current ?? null,
    away_score: e.awayScore?.current ?? null,
    status: 'completed',
    fetched_at: new Date().toISOString(),
  }));

  if (!options.dryRun && supabase) {
    for (let i = 0; i < matchUpserts.length; i += 200) {
      const chunk = matchUpserts.slice(i, i + 200);
      const { error } = await supabase
        .from('international_matches')
        .upsert(chunk, { onConflict: 'source,source_match_id' });
      if (error) throw new Error(`matches upsert: ${error.message}`);
    }
  }

  const playerProfiles = new Map<
    string,
    {
      source_player_id: string;
      full_name: string;
      normalized_name: string;
      position: string | null;
      country_code: string | null;
    }
  >();
  let totalStatRows = 0;
  let idx = 0;

  for (const event of toProcess) {
    idx += 1;
    const label = `${event.homeTeam?.name ?? '?'} vs ${event.awayTeam?.name ?? '?'}`;
    if (idx % 10 === 0 || idx === toProcess.length) {
      console.log(`[sofascore]   match ${idx}/${toProcess.length}: ${label}`);
    }

    let lineups: { home: { players: SofaPlayerLineup[] }; away: { players: SofaPlayerLineup[] } };
    try {
      lineups = await sofaFetch<typeof lineups>(page, `/event/${event.id}/lineups`);
    } catch (err) {
      console.warn(`[sofascore]     skip ${event.id} (no lineups): ${(err as Error).message}`);
      if (idx < toProcess.length) await sleep(REQUEST_DELAY_MS);
      continue;
    }

    const players = parsePlayersFromLineups(lineups, event);
    if (!players.length) {
      console.warn(`[sofascore]     skip ${event.id} (0 players with minutes)`);
      if (idx < toProcess.length) await sleep(REQUEST_DELAY_MS);
      continue;
    }

    if (options.dryRun) {
      totalStatRows += players.length;
      if (idx < toProcess.length) await sleep(REQUEST_DELAY_MS);
      continue;
    }

    for (const row of players) {
      const existing = playerProfiles.get(row.source_player_id);
      if (!existing) {
        playerProfiles.set(row.source_player_id, {
          source_player_id: row.source_player_id,
          full_name: row.player_name,
          normalized_name: normalizeName(row.player_name),
          position: row.position,
          country_code: row.country_code,
        });
      } else {
        if (!existing.position && row.position) existing.position = row.position;
        if (!existing.country_code && row.country_code) existing.country_code = row.country_code;
      }
    }

    const statRows = players.map((row) => ({
      source: SOURCE,
      source_match_id: String(event.id),
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
      expected_goals: row.expected_goals,
      yellow_cards: row.yellow_cards,
      red_cards: row.red_cards,
      tackles: row.tackles,
      interceptions: row.interceptions,
      fouls: row.fouls,
      was_fouled: row.was_fouled,
      saves: row.saves,
      big_chances_created: num(row.raw_aggregates.bigChanceCreated),
      raw_aggregates: row.raw_aggregates,
      fetched_at: new Date().toISOString(),
    }));

    if (supabase) {
      for (let i = 0; i < statRows.length; i += 200) {
        const chunk = statRows.slice(i, i + 200);
        const { error } = await supabase
          .from('international_player_match_stats')
          .upsert(chunk, { onConflict: 'source,source_match_id,source_player_id' });
        if (error) throw new Error(`player_match_stats upsert: ${error.message}`);
      }
    }
    totalStatRows += statRows.length;

    if (idx < toProcess.length) await sleep(REQUEST_DELAY_MS);
  }

  if (!options.dryRun && supabase && playerProfiles.size) {
    const playerUpserts = [...playerProfiles.values()].map((row) => ({
      source: SOURCE,
      source_player_id: row.source_player_id,
      full_name: row.full_name,
      normalized_name: row.normalized_name,
      primary_position: row.position,
      country_code: row.country_code,
      fetched_at: new Date().toISOString(),
    }));
    for (let i = 0; i < playerUpserts.length; i += 200) {
      const chunk = playerUpserts.slice(i, i + 200);
      const { error } = await supabase
        .from('international_players')
        .upsert(chunk, { onConflict: 'source,source_player_id' });
      if (error) throw new Error(`players upsert: ${error.message}`);
    }
  }

  console.log(
    `[sofascore]   ${season.name}: ${matchUpserts.length} matches, ${playerProfiles.size} players, ${totalStatRows} stat rows`
  );
  return { matches: matchUpserts.length, players: playerProfiles.size, statRows: totalStatRows };
}

async function main() {
  const fromYear = Number.parseInt(getArg('from') ?? '2019', 10);
  const seasonIdArg = getArg('season');
  const limitRaw = getArg('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : null;
  const dryRun = hasFlag('dry-run');

  const supabase = dryRun ? null : getSupabase();
  const browser: Browser = await launchHeadlessBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1280, height: 900 });

  console.log('[sofascore] Nations League ingest');
  if (dryRun) console.log('[sofascore] DRY RUN — no Supabase writes');
  if (limit) console.log(`[sofascore] limit=${limit} matches per season`);

  try {
    console.log(`[sofascore] priming cookies via ${LANDING_URL}`);
    await page.goto(LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(4000);

    let seasons = await loadSeasons(page);
    seasons = seasons.filter((s) => s.seasonYear >= fromYear);
    if (seasonIdArg) {
      seasons = seasons.filter((s) => String(s.id) === seasonIdArg);
      if (!seasons.length) throw new Error(`No season with id ${seasonIdArg}`);
    }

    console.log(`[sofascore] seasons: ${seasons.map((s) => `${s.year}(${s.id})`).join(', ')}`);

    let totalMatches = 0;
    let totalPlayers = 0;
    let totalStatRows = 0;
    for (const season of seasons) {
      const result = await ingestSeason(page, supabase, season, { limit, dryRun });
      totalMatches += result.matches;
      totalPlayers += result.players;
      totalStatRows += result.statRows;
    }

    console.log(
      `\n[sofascore] DONE. matches=${totalMatches} players=${totalPlayers} stat_rows=${totalStatRows}${dryRun ? ' (dry run)' : ''}`
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('[sofascore] failed:', error);
  process.exitCode = 1;
});
