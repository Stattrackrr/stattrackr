#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TEAM_SAMPLE_PATH = path.join(process.cwd(), 'data', 'soccerway-teams-sample.json');
const DEFAULT_BASE_URL = 'http://localhost:3000';

const baseUrl = String(process.env.SOCCER_REPAIR_BASE_URL || process.env.PROD_URL || DEFAULT_BASE_URL)
  .trim()
  .replace(/\/+$/, '');
const competitionFilter = String(process.env.SOCCER_REPAIR_COMPETITION || 'Premier League').trim();
const countryFilter = String(process.env.SOCCER_REPAIR_COUNTRY || 'England').trim();
const teamFilterRaw = String(process.env.SOCCER_REPAIR_TEAM || '').trim();
const limitRaw = String(process.env.SOCCER_REPAIR_LIMIT || 'all').trim().toLowerCase();
const concurrency = Math.max(1, Number.parseInt(process.env.SOCCER_REPAIR_CONCURRENCY || '30', 10) || 30);
const incrementalPages = Math.max(0, Number.parseInt(process.env.SOCCER_REPAIR_INCREMENTAL_PAGES || '3', 10) || 3);
const refreshMode = String(process.env.SOCCER_REPAIR_MODE || 'auto').trim().toLowerCase();
const dryRun = String(process.env.SOCCER_REPAIR_DRY_RUN || '0') === '1';
const fullOnMissingStats = String(process.env.SOCCER_REPAIR_FULL_ON_MISSING_STATS || '1') === '1';
const refreshFixtures = String(process.env.SOCCER_REPAIR_REFRESH_FIXTURES || '1') === '1';
const refreshLineups = String(process.env.SOCCER_REPAIR_REFRESH_LINEUPS || '1') === '1';
const refreshInjuries = String(process.env.SOCCER_REPAIR_REFRESH_INJURIES || '1') === '1';
const warmNextMatchup = String(process.env.SOCCER_REPAIR_WARM_NEXT_MATCHUP || '1') === '1';
const rebuildRankings = String(process.env.SOCCER_REPAIR_REBUILD_RANKINGS || '1') === '1';
const requestTimeoutMs = Math.max(5000, Number.parseInt(process.env.SOCCER_REPAIR_TIMEOUT_MS || '180000', 10) || 180000);

const cronSecret = String(process.env.CRON_SECRET || '').trim();
const headers = { Accept: 'application/json' };
if (cronSecret) {
  headers.Authorization = `Bearer ${cronSecret}`;
  headers['X-Cron-Secret'] = cronSecret;
}

function normalizeHref(href) {
  const value = String(href || '').trim();
  if (!value) return '';
  return (value.startsWith('/') ? value : `/${value}`).replace(/\/+$/, '');
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

function tokenMatches(left, right) {
  const a = normalizeToken(left);
  const b = normalizeToken(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function readTeams() {
  const raw = fs.readFileSync(TEAM_SAMPLE_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const competitions = Array.isArray(parsed?.competitions) ? parsed.competitions : [];
  const requestedTeams = teamFilterRaw
    .split(',')
    .map((team) => normalizeToken(team))
    .filter(Boolean);

  const rows = [];
  for (const competition of competitions) {
    const country = String(competition?.country || '').trim();
    const competitionName = String(competition?.competition || '').trim();
    if (competitionFilter && !tokenMatches(competitionName, competitionFilter)) continue;
    if (countryFilter && !tokenMatches(country, countryFilter)) continue;
    const teams = Array.isArray(competition?.teams) ? competition.teams : [];
    for (const team of teams) {
      const name = String(team?.name || '').trim();
      const href = normalizeHref(team?.href);
      if (!name || !href) continue;
      if (requestedTeams.length > 0) {
        const nameToken = normalizeToken(name);
        const hrefToken = normalizeToken(href);
        if (!requestedTeams.some((token) => nameToken === token || nameToken.includes(token) || hrefToken.includes(token))) {
          continue;
        }
      }
      rows.push({ name, href, competitionName, country });
    }
  }

  const seen = new Set();
  const unique = rows.filter((team) => {
    const key = team.href;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (limitRaw && limitRaw !== 'all') {
    const limit = Number.parseInt(limitRaw, 10);
    if (Number.isFinite(limit) && limit > 0) return unique.slice(0, limit);
  }
  return unique;
}

async function requestJson(pathname, context) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const errorMessage = payload?.error || `HTTP ${response.status}`;
      throw new Error(`${context}: ${errorMessage}`);
    }
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runPool(items, worker, size) {
  let index = 0;
  const results = [];
  async function next() {
    while (index < items.length) {
      const current = items[index++];
      results.push(await worker(current));
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, next));
  return results;
}

function resolveRefreshPlan(audit) {
  if (refreshMode === 'none') return 'none';
  if (refreshMode === 'full') return 'full';
  if (refreshMode === 'incremental') return 'incremental';

  const source = String(audit?.cache?.teamResultsSource || '');
  const totalCount = Number(audit?.totalCount ?? audit?.count ?? 0);
  const statsMissing = Number(audit?.cache?.statsMissing || 0);
  if (source === 'cache-miss' || totalCount <= 0) return 'full';
  if (fullOnMissingStats && statsMissing > 0) return 'full';
  return 'incremental';
}

function findTeamByName(teams, name, competitionName, country) {
  const target = normalizeToken(name);
  if (!target) return null;
  const competitionToken = normalizeToken(competitionName);
  const countryToken = normalizeToken(country);
  const inCompetition = (team) =>
    (!competitionToken || normalizeToken(team.competitionName) === competitionToken) &&
    (!countryToken || normalizeToken(team.country) === countryToken);

  return (
    teams.find((team) => inCompetition(team) && normalizeToken(team.name) === target) ||
    teams.find((team) => inCompetition(team) && (normalizeToken(team.name).includes(target) || target.includes(normalizeToken(team.name)))) ||
    teams.find((team) => normalizeToken(team.name) === target) ||
    null
  );
}

async function warmPanelEndpoints(team, allTeams, nextGamePayload) {
  const fixture = nextGamePayload?.fixture;
  if (!fixture?.opponentName || !fixture?.competitionName) return { warmed: 0, skipped: true };

  const opponent = findTeamByName(allTeams, fixture.opponentName, fixture.competitionName, fixture.competitionCountry);
  const params = new URLSearchParams({
    teamName: team.name,
    teamHref: team.href,
    opponentName: fixture.opponentName,
    nextCompetitionName: fixture.competitionName,
    competitionName: fixture.competitionName,
  });
  if (opponent?.href) {
    params.set('opponentHref', opponent.href);
  }
  if (fixture.competitionCountry) {
    params.set('nextCompetitionCountry', fixture.competitionCountry);
    params.set('competitionCountry', fixture.competitionCountry);
  }

  let warmed = 0;
  for (const timeframe of ['season', 'last5']) {
    const matchupParams = new URLSearchParams(params);
    matchupParams.set('timeframe', timeframe);
    await requestJson(`/api/soccer/team-matchup?${matchupParams.toString()}`, `${team.name} team matchup ${timeframe}`);
    warmed += 1;

    const breakdownParams = new URLSearchParams({
      opponentName: fixture.opponentName,
      competitionName: fixture.competitionName,
      timeframe,
    });
    if (fixture.competitionCountry) breakdownParams.set('competitionCountry', fixture.competitionCountry);
    if (opponent?.href) breakdownParams.set('opponentHref', opponent.href);
    await requestJson(`/api/soccer/opponent-breakdown?${breakdownParams.toString()}`, `${team.name} opponent breakdown ${timeframe}`);
    warmed += 1;
  }

  return { warmed, skipped: false };
}

async function repairTeam(team, allTeams) {
  const encodedHref = encodeURIComponent(team.href);
  const audit = await requestJson(
    `/api/soccer/team-results?href=${encodedHref}&cacheOnly=1&limitMatches=1`,
    `${team.name} cache audit`
  );
  const plan = resolveRefreshPlan(audit);

  const summary = {
    team: team.name,
    href: team.href,
    beforeSource: audit?.cache?.teamResultsSource || null,
    beforeTotalCount: Number(audit?.totalCount ?? audit?.count ?? 0),
    beforeStatsMissing: Number(audit?.cache?.statsMissing || 0),
    plan,
    afterTotalCount: null,
    newMatchesAdded: 0,
    fixturesRefreshed: false,
    lineupsRefreshed: false,
    injuriesRefreshed: false,
    panelEndpointsWarmed: 0,
    error: null,
  };

  if (dryRun) return summary;

  try {
    let refreshed = audit;
    if (plan === 'full') {
      refreshed = await requestJson(`/api/soccer/team-results?href=${encodedHref}&refresh=1`, `${team.name} full team-results refresh`);
    } else if (plan === 'incremental') {
      refreshed = await requestJson(
        `/api/soccer/team-results?href=${encodedHref}&refresh=1&incremental=1&pages=${incrementalPages}`,
        `${team.name} incremental team-results refresh`
      );
    }
    summary.afterTotalCount = Number(refreshed?.totalCount ?? refreshed?.count ?? 0);
    summary.newMatchesAdded = Number(refreshed?.cache?.newMatchesAdded || 0);

    let nextGamePayload = null;
    if (refreshFixtures) {
      nextGamePayload = await requestJson(`/api/soccer/next-game?href=${encodedHref}&refresh=1`, `${team.name} next fixture refresh`);
      summary.fixturesRefreshed = true;
    }

    if (refreshLineups) {
      await requestJson(`/api/soccer/predicted-lineup?href=${encodedHref}&refresh=1`, `${team.name} lineup refresh`);
      summary.lineupsRefreshed = true;
    }

    if (refreshInjuries) {
      const injuryParams = new URLSearchParams({ href: team.href, teamName: team.name, refresh: '1' });
      await requestJson(`/api/soccer/injuries?${injuryParams.toString()}`, `${team.name} injuries refresh`);
      summary.injuriesRefreshed = true;
    }

    if (warmNextMatchup && nextGamePayload) {
      const warmed = await warmPanelEndpoints(team, allTeams, nextGamePayload);
      summary.panelEndpointsWarmed = warmed.warmed;
    }
  } catch (error) {
    summary.error = error instanceof Error ? error.message : String(error);
  }

  return summary;
}

function rebuildPremierLeagueRankings() {
  if (!rebuildRankings || dryRun) return;
  const rebuildEnv = {
    ...process.env,
    SOCCER_BREAKDOWN_CONCURRENCY: process.env.SOCCER_BREAKDOWN_CONCURRENCY || String(concurrency),
    SOCCER_BREAKDOWN_STATS_CONCURRENCY: process.env.SOCCER_BREAKDOWN_STATS_CONCURRENCY || String(concurrency),
  };
  const commands = [
    ['node', ['scripts/build-soccer-opponent-breakdown-pl.js']],
    ['node', ['scripts/build-soccer-team-matchup-pl.js']],
    ['node', ['scripts/build-soccer-last5-pl.js']],
  ];

  for (const [command, args] of commands) {
    console.log(`[Soccer Repair] Running ${command} ${args.join(' ')}`);
    const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', env: rebuildEnv });
    if (result.status !== 0) {
      throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
    }
  }
}

async function main() {
  const teams = readTeams();
  if (teams.length === 0) {
    throw new Error('No teams matched the soccer repair filters.');
  }

  console.log(
    JSON.stringify(
      {
        baseUrl,
        competitionFilter,
        countryFilter,
        teamFilter: teamFilterRaw || null,
        teams: teams.length,
        refreshMode,
        dryRun,
        fullOnMissingStats,
        incrementalPages,
        concurrency,
        refreshFixtures,
        refreshLineups,
        refreshInjuries,
        warmNextMatchup,
        rebuildRankings,
      },
      null,
      2
    )
  );

  const results = await runPool(
    teams,
    async (team) => {
      console.log(`[Soccer Repair] ${dryRun ? 'Auditing' : 'Repairing'} ${team.name} (${team.href})`);
      const result = await repairTeam(team, teams);
      console.log(`[Soccer Repair] ${team.name}: ${JSON.stringify(result)}`);
      return result;
    },
    concurrency
  );

  const failed = results.filter((result) => result.error);
  const totals = {
    teams: results.length,
    failed: failed.length,
    fullRefreshes: results.filter((result) => result.plan === 'full').length,
    incrementalRefreshes: results.filter((result) => result.plan === 'incremental').length,
    newMatchesAdded: results.reduce((sum, result) => sum + Number(result.newMatchesAdded || 0), 0),
    missingStatsBefore: results.reduce((sum, result) => sum + Number(result.beforeStatsMissing || 0), 0),
  };

  console.log('[Soccer Repair] Summary');
  console.log(JSON.stringify({ totals, failures: failed }, null, 2));

  if (failed.length > 0) {
    process.exitCode = 1;
    return;
  }

  rebuildPremierLeagueRankings();
}

main().catch((error) => {
  console.error('[Soccer Repair] Failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
