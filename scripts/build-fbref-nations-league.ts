#!/usr/bin/env npx tsx

/**
 * Ingest UEFA Nations League player match stats from FBref into Supabase.
 *
 * FBref is behind Cloudflare — uses Puppeteer (same as Soccerway scrapes).
 *
 * Run:
 *   npx tsx scripts/build-fbref-nations-league.ts
 *   npx tsx scripts/build-fbref-nations-league.ts --from=2020
 *   npx tsx scripts/build-fbref-nations-league.ts --season=2022-2023
 *   npx tsx scripts/build-fbref-nations-league.ts --limit=3   # smoke test
 *   npx tsx scripts/build-fbref-nations-league.ts --dry-run
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * Respects ~6s delay between match pages (FBref rate-limit etiquette).
 */

import { config } from 'dotenv';
import type { Browser, Page } from 'puppeteer-core';
import { launchHeadlessBrowser } from '../lib/puppeteerLaunch';

config({ path: '.env.local' });

const FBREF_COMP_ID = '179';
const SOURCE = 'fbref';
const TOURNAMENT_SLUG = 'nations_league';
const REQUEST_DELAY_MS = 6000;

type NlSeason = {
  slug: string;
  seasonYear: number;
  label: string;
};

/** FBref season slugs for UEFA Nations League (comp 179). */
const NL_SEASONS: NlSeason[] = [
  { slug: '2018-2019', seasonYear: 2019, label: 'UEFA Nations League 2018-19' },
  { slug: '2020-2021', seasonYear: 2021, label: 'UEFA Nations League 2020-21' },
  { slug: '2022-2023', seasonYear: 2023, label: 'UEFA Nations League 2022-23' },
  { slug: '2024-2025', seasonYear: 2025, label: 'UEFA Nations League 2024-25' },
];

type ScheduleMatch = {
  matchId: string;
  matchUrl: string;
  matchDate: string | null;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  homeScore: number | null;
  awayScore: number | null;
  stage: string | null;
};

type PlayerStatRow = {
  source_player_id: string;
  player_name: string;
  source_team_id: string;
  team_name: string;
  is_home: boolean;
  position: string | null;
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

type MatchScrapeResult = {
  matchId: string;
  matchDate: string | null;
  kickoffUnix: number | null;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  homeScore: number | null;
  awayScore: number | null;
  stage: string | null;
  players: PlayerStatRow[];
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

function scheduleUrl(seasonSlug: string): string {
  return `https://fbref.com/en/comps/${FBREF_COMP_ID}/${seasonSlug}/schedule/UEFA-Nations-League-Scores-and-Fixtures`;
}

function absFbrefUrl(href: string): string {
  if (href.startsWith('http')) return href;
  return `https://fbref.com${href.startsWith('/') ? '' : '/'}${href}`;
}

function parseMatchIdFromUrl(url: string): string | null {
  const m = url.match(/\/matches\/([a-f0-9]+)\//i);
  return m ? m[1] : null;
}

function parseTeamIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = href.match(/\/squads\/[^/]+\/([a-f0-9]+)/i) || href.match(/\/teams\/([a-f0-9]+)/i);
  return m ? m[1] : null;
}

function parsePlayerIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = href.match(/\/players\/[^/]+\/([a-f0-9]+)/i);
  return m ? m[1] : null;
}

async function scrapeSchedule(page: Page, season: NlSeason): Promise<ScheduleMatch[]> {
  const url = scheduleUrl(season.slug);
  console.log(`[fbref] schedule ${season.label}: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(2500);

  const rows = await page.evaluate(() => {
    type Row = {
      matchId: string;
      matchUrl: string;
      matchDate: string | null;
      homeTeamId: string;
      homeTeamName: string;
      awayTeamId: string;
      awayTeamName: string;
      homeScore: number | null;
      awayScore: number | null;
      stage: string | null;
    };

    const out: Row[] = [];
    const tables = [...document.querySelectorAll('table.stats_table')];
    const schedTable =
      tables.find((t) => t.id.startsWith('sched_')) ?? tables.find((t) => t.querySelector('th[data-stat="score"]'));
    if (!schedTable) return out;

    const parseScore = (text: string): { home: number | null; away: number | null } => {
      const m = text.replace(/\s+/g, '').match(/(\d+)[–—-](\d+)/);
      if (!m) return { home: null, away: null };
      return { home: Number(m[1]), away: Number(m[2]) };
    };

    const teamIdFromCell = (cell: Element | null): { id: string; name: string } | null => {
      if (!cell) return null;
      const link = cell.querySelector('a[href*="/squads/"], a[href*="/teams/"]');
      const name = (link?.textContent ?? cell.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!name) return null;
      const href = link?.getAttribute('href') ?? '';
      const idMatch = href.match(/\/(?:squads|teams)\/[^/]+\/([a-f0-9]+)/i);
      const id = idMatch ? idMatch[1] : name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return { id, name };
    };

    for (const tr of schedTable.querySelectorAll('tbody tr')) {
      if (tr.classList.contains('spacer') || tr.classList.contains('thead')) continue;
      const scoreCell = tr.querySelector('td[data-stat="score"], th[data-stat="score"]');
      const scoreLink = scoreCell?.querySelector('a[href*="/matches/"]');
      const href = scoreLink?.getAttribute('href') ?? '';
      if (!href.includes('/matches/')) continue;
      const idMatch = href.match(/\/matches\/([a-f0-9]+)\//i);
      if (!idMatch) continue;

      const home = teamIdFromCell(tr.querySelector('td[data-stat="home_team"], th[data-stat="home_team"]'));
      const away = teamIdFromCell(tr.querySelector('td[data-stat="away_team"], th[data-stat="away_team"]'));
      if (!home || !away) continue;

      const dateCell = tr.querySelector('td[data-stat="date"], th[data-stat="date"]');
      const dateLink = dateCell?.querySelector('a');
      const matchDate =
        dateLink?.getAttribute('csk')?.slice(0, 10) ??
        (dateCell?.getAttribute('csk')?.slice(0, 10) || null);

      const scoreText = (scoreCell?.textContent ?? '').trim();
      const { home: homeScore, away: awayScore } = parseScore(scoreText);

      const roundCell = tr.querySelector('td[data-stat="round"], th[data-stat="round"]');
      const stage = (roundCell?.textContent ?? '').replace(/\s+/g, ' ').trim() || null;

      out.push({
        matchId: idMatch[1],
        matchUrl: href.startsWith('http') ? href : `https://fbref.com${href}`,
        matchDate,
        homeTeamId: home.id,
        homeTeamName: home.name,
        awayTeamId: away.id,
        awayTeamName: away.name,
        homeScore,
        awayScore,
        stage,
      });
    }
    return out;
  });

  console.log(`[fbref]   found ${rows.length} completed fixtures`);
  return rows;
}

async function scrapeMatch(page: Page, match: ScheduleMatch): Promise<MatchScrapeResult> {
  await page.goto(match.matchUrl, { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(2000);

  const scraped = await page.evaluate((meta) => {
    type PRow = {
      source_player_id: string;
      player_name: string;
      source_team_id: string;
      team_name: string;
      is_home: boolean;
      position: string | null;
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

    const parseNum = (v: string | null | undefined): number => {
      if (v == null || v === '') return 0;
      const n = Number.parseFloat(String(v).replace(/,/g, ''));
      return Number.isFinite(n) ? n : 0;
    };

    const parseMinutes = (v: string | null | undefined): number => {
      if (!v) return 0;
      const s = v.trim();
      if (!s || s === '0') return 0;
      const plus = s.match(/^(\d+)\+(\d+)$/);
      if (plus) return Number(plus[1]) + Number(plus[2]);
      const n = Number.parseInt(s, 10);
      return Number.isFinite(n) ? n : 0;
    };

    const cellVal = (tr: Element, stat: string): string => {
      const td = tr.querySelector(`[data-stat="${stat}"]`);
      return (td?.textContent ?? '').trim();
    };

    const players: PRow[] = [];

    const tables = [...document.querySelectorAll('table.stats_table')];
    const statTables = tables.filter((t) => {
      const hasMin = t.querySelector('thead [data-stat="minutes"]');
      const hasPlayer = t.querySelector('thead [data-stat="player"]');
      return Boolean(hasMin && hasPlayer);
    });

    for (const table of statTables) {
      let teamId = '';
      let teamName = '';
      const caption = table.querySelector('caption');
      const captionLink = caption?.querySelector('a[href*="/squads/"], a[href*="/teams/"]');
      if (captionLink) {
        teamName = (captionLink.textContent ?? '').trim();
        const href = captionLink.getAttribute('href') ?? '';
        const m = href.match(/\/(?:squads|teams)\/[^/]+\/([a-f0-9]+)/i);
        teamId = m ? m[1] : teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      } else {
        const prev = table.closest('div')?.previousElementSibling;
        const h2 = prev?.querySelector('h2') ?? table.parentElement?.querySelector('h2');
        teamName = (h2?.textContent ?? '').replace(/ Player Stats.*$/i, '').trim();
        teamId = teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      }

      const isHome =
        teamId === meta.homeTeamId ||
        teamName.toLowerCase() === meta.homeTeamName.toLowerCase();

      for (const tr of table.querySelectorAll('tbody tr')) {
        if (tr.classList.contains('thead') || tr.classList.contains('spacer')) continue;
        const playerCell = tr.querySelector('[data-stat="player"]');
        const playerLink = playerCell?.querySelector('a[href*="/players/"]');
        const playerName = (playerLink?.textContent ?? playerCell?.textContent ?? '').trim();
        if (!playerName || playerName === 'Player' || playerName === 'Squad Total') continue;

        const href = playerLink?.getAttribute('href') ?? '';
        const pidMatch = href.match(/\/players\/[^/]+\/([a-f0-9]+)/i);
        const source_player_id = pidMatch ? pidMatch[1] : `${teamId}-${playerName}`;

        const minutes = parseMinutes(cellVal(tr, 'minutes'));
        if (minutes < 1) continue;

        const raw: Record<string, number> = {};
        for (const td of tr.querySelectorAll('[data-stat]')) {
          const key = td.getAttribute('data-stat');
          if (!key || key === 'player') continue;
          const val = parseNum((td.textContent ?? '').trim());
          if (val !== 0) raw[key] = val;
        }

        const xgRaw = cellVal(tr, 'xg') || cellVal(tr, 'xg_assist');
        const xg = xgRaw ? parseNum(xgRaw) : null;

        players.push({
          source_player_id,
          player_name: playerName,
          source_team_id: teamId || (isHome ? meta.homeTeamId : meta.awayTeamId),
          team_name: teamName || (isHome ? meta.homeTeamName : meta.awayTeamName),
          is_home: isHome,
          position: cellVal(tr, 'position') || null,
          minutes_played: minutes,
          goals: parseNum(cellVal(tr, 'goals')),
          assists: parseNum(cellVal(tr, 'assists')),
          shots_total: parseNum(cellVal(tr, 'shots')),
          shots_on_target: parseNum(cellVal(tr, 'shots_on_target')),
          passes_total: parseNum(cellVal(tr, 'passes')),
          passes_accurate: parseNum(cellVal(tr, 'passes_completed')),
          expected_goals: xg,
          yellow_cards: parseNum(cellVal(tr, 'cards_yellow')),
          red_cards: parseNum(cellVal(tr, 'cards_red')),
          tackles: parseNum(cellVal(tr, 'tackles')),
          interceptions: parseNum(cellVal(tr, 'interceptions')),
          fouls: parseNum(cellVal(tr, 'fouls')),
          was_fouled: parseNum(cellVal(tr, 'fouls_drawn')),
          saves: parseNum(cellVal(tr, 'gk_shots_on_target_against')) || parseNum(cellVal(tr, 'gk_saves')),
          raw_aggregates: raw,
        });
      }
    }

    const dateNode = document.querySelector('[data-stat="date"] a, .scorebox_meta div');
    let matchDate: string | null = meta.matchDate;
    const dateLink = document.querySelector('div.scorebox_meta a[href*="/matches/"]');
    if (!matchDate && dateLink) {
      matchDate = dateLink.getAttribute('csk')?.slice(0, 10) ?? null;
    }

    return { players, matchDate };
  }, {
    homeTeamId: match.homeTeamId,
    homeTeamName: match.homeTeamName,
    awayTeamId: match.awayTeamId,
    awayTeamName: match.awayTeamName,
    matchDate: match.matchDate,
  });

  const kickoffUnix = scraped.matchDate
    ? Math.floor(Date.parse(`${scraped.matchDate}T12:00:00Z`) / 1000)
    : null;

  return {
    matchId: match.matchId,
    matchDate: scraped.matchDate ?? match.matchDate,
    kickoffUnix: Number.isFinite(kickoffUnix as number) ? kickoffUnix : null,
    homeTeamId: match.homeTeamId,
    homeTeamName: match.homeTeamName,
    awayTeamId: match.awayTeamId,
    awayTeamName: match.awayTeamName,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    stage: match.stage,
    players: scraped.players,
  };
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

async function ensureCompetition(supabase: ReturnType<typeof getSupabase>, season: NlSeason): Promise<void> {
  const { error } = await supabase.from('international_competitions').upsert(
    {
      source: SOURCE,
      competition_id: FBREF_COMP_ID,
      competition_name: 'UEFA Nations League',
      season_id: season.slug,
      season_year: season.seasonYear,
      tournament_slug: TOURNAMENT_SLUG,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'source,competition_id,season_id' }
  );
  if (error) throw new Error(`competition upsert: ${error.message}`);
}

async function ingestSeason(
  browser: Browser,
  supabase: ReturnType<typeof getSupabase>,
  season: NlSeason,
  options: { limit: number | null; dryRun: boolean }
): Promise<{ matches: number; players: number; statRows: number }> {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1280, height: 900 });

  console.log(`\n[fbref] === ${season.label} ===`);
  if (!options.dryRun) await ensureCompetition(supabase, season);

  const schedule = await scrapeSchedule(page, season);
  const toProcess = options.limit ? schedule.slice(0, options.limit) : schedule;

  const teamRows = new Map<string, string>();
  for (const m of schedule) {
    teamRows.set(m.homeTeamId, m.homeTeamName);
    teamRows.set(m.awayTeamId, m.awayTeamName);
  }

  if (!options.dryRun && teamRows.size) {
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

  const matchUpserts = schedule.map((m) => ({
    source: SOURCE,
    source_match_id: m.matchId,
    competition_id: FBREF_COMP_ID,
    season_id: season.slug,
    tournament_slug: TOURNAMENT_SLUG,
    season_year: season.seasonYear,
    match_date: m.matchDate,
    kickoff_unix: m.matchDate ? Math.floor(Date.parse(`${m.matchDate}T12:00:00Z`) / 1000) : null,
    stage: m.stage,
    home_team_source_id: m.homeTeamId,
    away_team_source_id: m.awayTeamId,
    home_team_name: m.homeTeamName,
    away_team_name: m.awayTeamName,
    home_score: m.homeScore,
    away_score: m.awayScore,
    status: 'completed',
    fetched_at: new Date().toISOString(),
  }));

  if (!options.dryRun) {
    for (let i = 0; i < matchUpserts.length; i += 200) {
      const chunk = matchUpserts.slice(i, i + 200);
      const { error } = await supabase
        .from('international_matches')
        .upsert(chunk, { onConflict: 'source,source_match_id' });
      if (error) throw new Error(`matches upsert: ${error.message}`);
    }
  }
  console.log(`[fbref]   ${matchUpserts.length} matches registered`);

  const playerProfiles = new Map<
    string,
    { source_player_id: string; full_name: string; normalized_name: string; position: string | null }
  >();
  let totalStatRows = 0;

  let idx = 0;
  for (const schedMatch of toProcess) {
    idx += 1;
    console.log(`[fbref]   match ${idx}/${toProcess.length} ${schedMatch.homeTeamName} vs ${schedMatch.awayTeamName}`);
    const result = await scrapeMatch(page, schedMatch);
    console.log(`[fbref]     ${result.players.length} player rows (1+ min)`);

    if (options.dryRun) {
      totalStatRows += result.players.length;
      if (idx < toProcess.length) await sleep(REQUEST_DELAY_MS);
      continue;
    }

    for (const row of result.players) {
      const existing = playerProfiles.get(row.source_player_id);
      if (!existing) {
        playerProfiles.set(row.source_player_id, {
          source_player_id: row.source_player_id,
          full_name: row.player_name,
          normalized_name: normalizeName(row.player_name),
          position: row.position,
        });
      } else if (!existing.position && row.position) {
        existing.position = row.position;
      }
    }

    const statRows = result.players.map((row) => ({
      source: SOURCE,
      source_match_id: result.matchId,
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
      big_chances_created: 0,
      raw_aggregates: row.raw_aggregates,
      fetched_at: new Date().toISOString(),
    }));

    for (let i = 0; i < statRows.length; i += 200) {
      const chunk = statRows.slice(i, i + 200);
      const { error } = await supabase
        .from('international_player_match_stats')
        .upsert(chunk, { onConflict: 'source,source_match_id,source_player_id' });
      if (error) throw new Error(`player_match_stats upsert: ${error.message}`);
    }
    totalStatRows += statRows.length;

    if (idx < toProcess.length) await sleep(REQUEST_DELAY_MS);
  }

  if (!options.dryRun && playerProfiles.size) {
    const playerUpserts = [...playerProfiles.values()].map((row) => ({
      source: SOURCE,
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
      if (error) throw new Error(`players upsert: ${error.message}`);
    }
  }

  await page.close();
  return {
    matches: matchUpserts.length,
    players: playerProfiles.size,
    statRows: totalStatRows,
  };
}

async function main() {
  const fromYear = Number.parseInt(getArg('from') ?? '2019', 10);
  const seasonSlug = getArg('season');
  const limitRaw = getArg('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : null;
  const dryRun = hasFlag('dry-run');

  let seasons = NL_SEASONS.filter((s) => s.seasonYear >= fromYear);
  if (seasonSlug) {
    seasons = NL_SEASONS.filter((s) => s.slug === seasonSlug);
    if (!seasons.length) throw new Error(`Unknown season slug: ${seasonSlug}`);
  }

  console.log(`[fbref] Nations League ingest — seasons: ${seasons.map((s) => s.slug).join(', ')}`);
  if (dryRun) console.log('[fbref] DRY RUN — no Supabase writes');
  if (limit) console.log(`[fbref] limit=${limit} matches per season`);

  const supabase = dryRun ? null : getSupabase();
  const browser = await launchHeadlessBrowser();

  let totalMatches = 0;
  let totalPlayers = 0;
  let totalStatRows = 0;

  try {
    for (const season of seasons) {
      const result = await ingestSeason(browser, supabase as ReturnType<typeof getSupabase>, season, {
        limit,
        dryRun,
      });
      totalMatches += result.matches;
      totalPlayers += result.players;
      totalStatRows += result.statRows;
    }
  } finally {
    await browser.close();
  }

  console.log(
    `\n[fbref] DONE. matches=${totalMatches} players=${totalPlayers} stat_rows=${totalStatRows}${dryRun ? ' (dry run)' : ''}`
  );
}

main().catch((error) => {
  console.error('[fbref] failed:', error);
  process.exitCode = 1;
});
