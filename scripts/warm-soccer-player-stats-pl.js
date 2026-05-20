#!/usr/bin/env node

/**
 * Warm deep player-stats cache for every Premier League squad (current season).
 * Runs one /api/soccer/player-stats-batch per team, with team-level concurrency.
 *
 * Requires a running app (npm run dev) or production URL.
 * GitHub Actions: .github/workflows/soccer-pl-player-stats.yml (same logs; uses PROD_URL + CRON_SECRET).
 *
 * Usage:
 *   node scripts/warm-soccer-player-stats-pl.js
 *   SOCCER_PL_STATS_TEAM_CONCURRENCY=3 node scripts/warm-soccer-player-stats-pl.js
 *   SOCCER_PL_STATS_BASE_URL=https://your-app.vercel.app CRON_SECRET=... node scripts/warm-soccer-player-stats-pl.js
 *   SOCCER_PL_STATS_TEAMS=arsenal,liverpool node scripts/warm-soccer-player-stats-pl.js
 *   SOCCER_PL_STATS_DRY_RUN=1 node scripts/warm-soccer-player-stats-pl.js
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');

const TEAM_SAMPLE_PATH = path.join(process.cwd(), 'data', 'soccerway-teams-sample.json');
const COMPETITION_NAME = 'Premier League';
const COMPETITION_COUNTRY = 'England';
const DEFAULT_BASE_URL = 'http://localhost:3000';

const baseUrl = String(process.env.SOCCER_PL_STATS_BASE_URL || process.env.SOCCER_REPAIR_BASE_URL || DEFAULT_BASE_URL)
  .trim()
  .replace(/\/+$/, '');
const MAX_TEAM_CONCURRENCY = 6;
const DEFAULT_TEAM_CONCURRENCY = 3;
const teamConcurrency = Math.max(
  1,
  Math.min(
    MAX_TEAM_CONCURRENCY,
    Number.parseInt(
      process.env.SOCCER_PL_STATS_TEAM_CONCURRENCY || String(DEFAULT_TEAM_CONCURRENCY),
      10
    ) || DEFAULT_TEAM_CONCURRENCY
  )
);
const limitRaw = String(process.env.SOCCER_PL_STATS_LIMIT || 'season').trim().toLowerCase();
const limit =
  !limitRaw || limitRaw === 'season' || limitRaw === 'all' || limitRaw === '0' || limitRaw === 'full'
    ? 0
    : Math.max(1, Number.parseInt(limitRaw, 10) || 0);
const maxPlayers = Math.max(1, Math.min(35, Number.parseInt(process.env.SOCCER_PL_STATS_MAX_PLAYERS || '35', 10) || 35));
const MAX_PLAYER_CONCURRENCY = 8;
const DEFAULT_PLAYER_CONCURRENCY = 6;
const MAX_MATCH_CONCURRENCY = 25;
const DEFAULT_MATCH_CONCURRENCY = 1;
const MAX_FETCH_CONCURRENCY = 60;
const playerConcurrency = Math.max(
  1,
  Math.min(
    MAX_PLAYER_CONCURRENCY,
    Number.parseInt(
      process.env.SOCCER_PL_STATS_PLAYER_CONCURRENCY || String(DEFAULT_PLAYER_CONCURRENCY),
      10
    ) || DEFAULT_PLAYER_CONCURRENCY
  )
);
const matchConcurrency = Math.max(
  1,
  Math.min(
    MAX_MATCH_CONCURRENCY,
    Number.parseInt(process.env.SOCCER_PL_STATS_MATCH_CONCURRENCY || String(DEFAULT_MATCH_CONCURRENCY), 10) ||
      DEFAULT_MATCH_CONCURRENCY
  )
);
const fetchConcurrency = Math.max(
  1,
  Math.min(
    MAX_FETCH_CONCURRENCY,
    Number.parseInt(process.env.SOCCER_PL_STATS_FETCH_CONCURRENCY || String(MAX_FETCH_CONCURRENCY), 10) ||
      MAX_FETCH_CONCURRENCY
  )
);
const teamTimeoutMs = Math.max(
  120_000,
  Number.parseInt(process.env.SOCCER_PL_STATS_TEAM_TIMEOUT_MS || '7200000', 10) || 7_200_000
);
const dryRun = String(process.env.SOCCER_PL_STATS_DRY_RUN || '0') === '1';
const teamFilterRaw = String(process.env.SOCCER_PL_STATS_TEAMS || '').trim();
const puppeteerOnly = String(process.env.SOCCER_PL_STATS_PUPPETEER_ONLY || '1') !== '0';

const cronSecret = String(process.env.CRON_SECRET || '').trim();
const headers = { Accept: 'application/json' };
if (cronSecret) {
  headers.Authorization = `Bearer ${cronSecret}`;
  headers['X-Cron-Secret'] = cronSecret;
}

function normalizeHref(href) {
  const value = String(href || '').trim();
  if (!value) return '';
  return (value.startsWith('/') ? value : `/${value}`).replace(/\/+$/, '') + '/';
}

function normalizeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readPremierLeagueTeams() {
  const raw = fs.readFileSync(TEAM_SAMPLE_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const competitions = Array.isArray(parsed?.competitions) ? parsed.competitions : [];
  const pl = competitions.find(
    (c) =>
      normalizeToken(c?.competition) === normalizeToken(COMPETITION_NAME) &&
      normalizeToken(c?.country) === normalizeToken(COMPETITION_COUNTRY)
  );
  if (!pl || !Array.isArray(pl.teams) || pl.teams.length === 0) {
    throw new Error('Premier League roster not found in data/soccerway-teams-sample.json');
  }

  const requested = teamFilterRaw
    .split(',')
    .map((t) => normalizeToken(t))
    .filter(Boolean);

  const teams = pl.teams
    .map((team) => ({
      name: String(team?.name || '').trim(),
      href: normalizeHref(team?.href),
    }))
    .filter((team) => team.name && team.href);

  const seen = new Set();
  const unique = teams.filter((team) => {
    if (seen.has(team.href)) return false;
    seen.add(team.href);
    return true;
  });

  if (!requested.length) return unique;

  return unique.filter((team) => {
    const nameToken = normalizeToken(team.name);
    const hrefToken = normalizeToken(team.href);
    return requested.some(
      (token) => nameToken === token || nameToken.includes(token) || hrefToken.includes(token)
    );
  });
}

function formatMinutes(elapsedMs) {
  const mins = (Number(elapsedMs) || 0) / 60000;
  return mins < 1 ? `${(mins * 60).toFixed(0)}s` : `${mins.toFixed(1)}m`;
}

function logTeamProgress(result, position, total) {
  const prefix = `[${position}/${total}]`;
  const name = result.team?.name || 'Unknown';

  if (result.dryRun) {
    console.log(`${prefix} ${name} (dry run)`);
    return { ok: false, cached: 0 };
  }

  const mins = formatMinutes(result.elapsedMs);
  const s = result.summary;

  if (!result.ok) {
    console.log(`${prefix} ${name} FAILED (${mins}) — ${result.error || 'unknown error'}`);
    return { ok: false, cached: 0 };
  }

  const cached = Number(s?.cacheWritesOk ?? 0);
  const squad = Number(s?.squadSize ?? 0);
  const newMatches = Number(s?.matchesToScrapeCount ?? 0);
  const seasonN = Number(s?.seasonMatchCount ?? 0);
  const dnp = Number(s?.noAppearances ?? 0);
  const incremental = s?.incrementalRefresh ? 'yes' : 'no';

  let line = `${prefix} ${name} done — ${cached} players cached`;
  if (squad > 0 && cached < squad) {
    line += ` (${cached}/${squad} squad)`;
  }
  if (seasonN > 0) {
    line += ` · ${newMatches} new match(es) / ${seasonN} season`;
  }
  line += ` · incremental=${incremental}`;
  if (dnp > 0) line += ` · ${dnp} DNP`;
  const scrapeErrors = Number(s?.scrapeErrors ?? 0);
  if (scrapeErrors > 0) line += ` · ${scrapeErrors} scrape error(s)`;
  line += ` · ${mins}`;
  console.log(line);

  if (cached === 0 && Array.isArray(result.players) && result.players.length > 0) {
    const sample = result.players.find((p) => p?.error || p?.hint) ?? result.players[0];
    const errText = String(sample?.error || sample?.hint || '');
    if (sample?.error) {
      console.log(`${prefix}   hint: ${errText.slice(0, 240)}`);
    } else if (sample?.hint) {
      console.log(`${prefix}   hint: ${errText.slice(0, 240)}`);
    }
    if (/ETXTBSY/i.test(errText)) {
      console.log(
        `${prefix}   tip: Vercel unpacked Chromium while another team batch was starting — re-run with SOCCER_PL_STATS_TEAM_CONCURRENCY=1 (or retry this workflow).`
      );
    }
  }

  return { ok: true, cached };
}

async function warmTeamsWithLiveLog(teams, concurrency) {
  let index = 0;
  let okTeams = 0;
  let totalCached = 0;
  const failed = [];

  async function worker() {
    while (true) {
      const current = index;
      if (current >= teams.length) return;
      index += 1;
      const team = teams[current];
      const position = current + 1;
      const total = teams.length;

      console.log(`[${position}/${total}] → ${team.name} …`);
      const result = await warmTeam(team);
      const stats = logTeamProgress(result, position, total);
      if (stats.ok) {
        okTeams += 1;
        totalCached += stats.cached;
      } else if (!result.dryRun) {
        failed.push(result);
      }
    }
  }

  const workers = Math.min(concurrency, teams.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return { okTeams, totalCached, failed };
}

function buildBatchUrl(teamHref) {
  const params = new URLSearchParams({
    href: teamHref,
    refresh: '1',
    incremental: '1',
    season: 'current',
    limit: limit > 0 ? String(limit) : '0',
    categories: 'all',
    maxPlayers: String(maxPlayers),
    playerConcurrency: String(playerConcurrency),
    matchConcurrency: String(matchConcurrency),
    fetchConcurrency: String(fetchConcurrency),
    puppeteerOnly: puppeteerOnly ? '1' : '0',
  });
  return `${baseUrl}/api/soccer/player-stats-batch?${params.toString()}`;
}

async function warmTeam(team) {
  const url = buildBatchUrl(team.href);
  if (dryRun) {
    return { team, ok: true, dryRun: true, url, summary: null };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), teamTimeoutMs);
  const started = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    const elapsedMs = Date.now() - started;

    if (!response.ok || !payload?.success) {
      return {
        team,
        ok: false,
        elapsedMs,
        error: payload?.error || `HTTP ${response.status}`,
        summary: payload?.summary ?? null,
      };
    }

    return {
      team,
      ok: true,
      elapsedMs,
      summary: payload.summary ?? null,
      seasonYear: payload.seasonYear ?? null,
      players: Array.isArray(payload.players) ? payload.players : [],
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      team,
      ok: false,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
      summary: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function main() {
  const teams = readPremierLeagueTeams();
  if (!teams.length) {
    console.error('[soccer-pl-stats] No teams matched filter.');
    process.exitCode = 1;
    return;
  }

  console.log(`[soccer-pl-stats] Premier League player-stats warm`);
  console.log(`  baseUrl:           ${baseUrl}`);
  console.log(`  teams:             ${teams.length}`);
  console.log(`  teamConcurrency:   ${teamConcurrency}`);
  console.log(`  season:            current`);
  console.log(
    `  limit:             ${limit > 0 ? limit : 'full season (all current-season games)'}`
  );
  console.log(`  maxPlayers/team:   ${maxPlayers}`);
  console.log(`  playerConcurrency: ${playerConcurrency}`);
  console.log(`  matchConcurrency:  ${matchConcurrency}`);
  console.log(`  fetchConcurrency:  ${fetchConcurrency}`);
  console.log(`  puppeteerOnly:     ${puppeteerOnly}`);
  console.log(`  dryRun:            ${dryRun}`);
  console.log('');

  if (dryRun) {
    for (const team of teams) {
      console.log(`  ${team.name.padEnd(22)} ${buildBatchUrl(team.href)}`);
    }
    return;
  }

  console.log('Progress (each line prints when that team finishes):\n');
  const { okTeams, totalCached, failed } = await warmTeamsWithLiveLog(teams, teamConcurrency);

  console.log('');
  console.log(
    `[soccer-pl-stats] finished — ${okTeams}/${teams.length} teams ok · ${totalCached} players cached this run`
  );
  if (failed.length) process.exitCode = 1;
  const failIfEmpty = String(process.env.SOCCER_PL_STATS_FAIL_IF_EMPTY || '0') === '1';
  if (failIfEmpty && !dryRun && teams.length > 0 && totalCached === 0) {
    console.error('[soccer-pl-stats] no players cached (set SOCCER_PL_STATS_FAIL_IF_EMPTY=0 to allow empty runs)');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[soccer-pl-stats] fatal', err);
  process.exitCode = 1;
});
