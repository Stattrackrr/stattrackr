#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');

const TEAM_SAMPLE_PATH = path.join(process.cwd(), 'data', 'soccerway-teams-sample.json');
const MATCHUP_OUT_PATH = path.join(process.cwd(), 'data', 'soccer-team-matchup-premier-league-last5.json');
const BREAKDOWN_OUT_PATH = path.join(process.cwd(), 'data', 'soccer-opponent-breakdown-premier-league-last5.json');
const TEAM_CONCURRENCY = Math.max(1, Number.parseInt(process.env.SOCCER_BREAKDOWN_CONCURRENCY || '2', 10) || 2);
const STATS_CONCURRENCY = Math.max(1, Number.parseInt(process.env.SOCCER_BREAKDOWN_STATS_CONCURRENCY || '6', 10) || 6);
const REQUEST_TIMEOUT_MS = Math.max(15000, Number.parseInt(process.env.SOCCER_BREAKDOWN_REQUEST_TIMEOUT_MS || '30000', 10) || 30000);
const MAX_SHOW_MORE_PAGES = Math.max(1, Number.parseInt(process.env.SOCCER_BREAKDOWN_MAX_PAGES || '8', 10) || 8);
const COMPETITION_NAME = 'Premier League';
const COMPETITION_COUNTRY = 'England';
const SOCCERWAY_BASE = 'https://www.soccerway.com';
const SOCCERWAY_HTML_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};
const SOCCERWAY_FEED_HEADERS = {
  'User-Agent': SOCCERWAY_HTML_HEADERS['User-Agent'],
  Accept: '*/*',
  'Accept-Language': SOCCERWAY_HTML_HEADERS['Accept-Language'],
  Referer: 'https://www.soccerway.com/',
  Origin: 'https://www.soccerway.com',
};

const MATCHUP_STATS = [
  { id: 'goals', label: 'Goals', statName: null },
  { id: 'expected_goals_xg', label: 'xG', statName: 'Expected goals (xG)' },
  { id: 'total_shots', label: 'Shots', statName: 'Total shots' },
  { id: 'shots_on_target', label: 'SOT', statName: 'Shots on target' },
  { id: 'corner_kicks', label: 'Corners', statName: 'Corner kicks' },
];

const BREAKDOWN_STATS = [
  { id: 'goals', label: 'Goals allowed', shortLabel: 'GA', statName: '', lowerIsBetter: true, niche: false, isPercent: false },
  { id: 'expected_goals_xg', label: 'xG allowed', shortLabel: 'xGA', statName: 'Expected goals (xG)', lowerIsBetter: true, niche: false, isPercent: false },
  { id: 'total_shots', label: 'Shots allowed', shortLabel: 'Shots', statName: 'Total shots', lowerIsBetter: true, niche: false, isPercent: false },
  { id: 'shots_on_target', label: 'SOT allowed', shortLabel: 'SOT', statName: 'Shots on target', lowerIsBetter: true, niche: false, isPercent: false },
  { id: 'xg_on_target_xgot', label: 'xGOT allowed', shortLabel: 'xGOTA', statName: 'xG on target (xGOT)', lowerIsBetter: true, niche: true, isPercent: false },
  { id: 'corner_kicks', label: 'Corners conceded', shortLabel: 'Corners', statName: 'Corner kicks', lowerIsBetter: true, niche: true, isPercent: false },
  { id: 'big_chances', label: 'Big chances allowed', shortLabel: 'Big ch.', statName: 'Big chances', lowerIsBetter: true, niche: true, isPercent: false },
  { id: 'shots_inside_the_box', label: 'Shots in box allowed', shortLabel: 'In box', statName: 'Shots inside the box', lowerIsBetter: true, niche: true, isPercent: false },
  { id: 'touches_in_opp_box', label: 'Opp. box touches', shortLabel: 'Box touches', statName: 'Touches in opposition box', lowerIsBetter: true, niche: true, isPercent: false },
  { id: 'ball_possession', label: 'Opp. possession', shortLabel: 'Poss.', statName: 'Ball possession', lowerIsBetter: true, niche: true, isPercent: true },
  { id: 'crosses', label: 'Crosses allowed', shortLabel: 'Crosses', statName: 'Crosses', lowerIsBetter: true, niche: true, isPercent: false },
  { id: 'accurate_passes', label: 'Accurate passes allowed', shortLabel: 'Passes', statName: 'Accurate passes', lowerIsBetter: true, niche: true, isPercent: false },
];

function normalizeTeamHref(href) {
  const value = String(href || '').trim();
  if (!value) return '';
  return (value.startsWith('/') ? value : `/${value}`).replace(/\/+$/, '');
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*$/g, '')
    .replace(/\s+/g, ' ');
}

function normalizeCompetitionToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensMatch(a, b) {
  const left = normalizeCompetitionToken(a);
  const right = normalizeCompetitionToken(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function readPremierLeagueRoster() {
  const raw = fs.readFileSync(TEAM_SAMPLE_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const competitions = Array.isArray(parsed?.competitions) ? parsed.competitions : [];
  const premierLeague = competitions.find(
    (competition) => tokensMatch(competition?.competition, COMPETITION_NAME) && tokensMatch(competition?.country, COMPETITION_COUNTRY)
  );
  if (!premierLeague || !Array.isArray(premierLeague.teams) || premierLeague.teams.length === 0) {
    throw new Error('Premier League roster not found in data/soccerway-teams-sample.json');
  }
  return premierLeague.teams
    .map((team) => ({
      name: String(team?.name || '').trim(),
      href: normalizeTeamHref(team?.href),
    }))
    .filter((team) => team.name && team.href);
}

function getCurrentSoccerSeasonYear() {
  const now = new Date();
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

function getSoccerSeasonYearFromKickoffUnix(kickoffUnix) {
  if (kickoffUnix == null || !Number.isFinite(kickoffUnix)) return 0;
  const kickoff = new Date(kickoffUnix * 1000);
  const month = kickoff.getUTCMonth();
  const year = kickoff.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

function parseNum(raw) {
  if (raw == null || raw === '') return null;
  const match = String(raw).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getTeamSide(match, teamName) {
  const normalizedTeam = normalizeName(teamName);
  if (normalizeName(match.homeTeam) === normalizedTeam) return 'home';
  if (normalizeName(match.awayTeam) === normalizedTeam) return 'away';
  return null;
}

function getMatchStats(match) {
  const periods = Array.isArray(match?.stats?.periods) ? match.stats.periods : [];
  const matchPeriod = periods.find((period) => String(period?.name || '').trim().toLowerCase() === 'match');
  if (!matchPeriod || !Array.isArray(matchPeriod.categories)) return [];
  return matchPeriod.categories.flatMap((category) => (Array.isArray(category?.stats) ? category.stats : []));
}

function findStat(match, statName) {
  return getMatchStats(match).find((stat) => String(stat?.name || '').trim().toLowerCase() === String(statName).toLowerCase()) || null;
}

function getTeamPerspectiveValue(match, teamName, stat) {
  const side = getTeamSide(match, teamName);
  if (!side || !stat) return null;
  return parseNum(side === 'home' ? stat.homeValue : stat.awayValue);
}

function getOpponentPerspectiveValue(match, teamName, stat) {
  const side = getTeamSide(match, teamName);
  if (!side || !stat) return null;
  return parseNum(side === 'home' ? stat.awayValue : stat.homeValue);
}

function goalsScored(match, teamName) {
  const side = getTeamSide(match, teamName);
  if (!side) return 0;
  return side === 'home' ? Number(match.homeScore || 0) : Number(match.awayScore || 0);
}

function goalsConceded(match, teamName) {
  const side = getTeamSide(match, teamName);
  if (!side) return 0;
  return side === 'home' ? Number(match.awayScore || 0) : Number(match.homeScore || 0);
}

function computeTeamMatchupAverages(team, matches) {
  const attack = {};
  const defence = {};
  for (const stat of MATCHUP_STATS) {
    if (stat.id === 'goals') {
      attack[stat.id] = average(matches.map((match) => goalsScored(match, team.name)));
      defence[stat.id] = average(matches.map((match) => goalsConceded(match, team.name)));
      continue;
    }
    const attackValues = [];
    const defenceValues = [];
    for (const match of matches) {
      const statRow = findStat(match, stat.statName);
      if (!statRow) continue;
      const teamValue = getTeamPerspectiveValue(match, team.name, statRow);
      const opponentValue = getOpponentPerspectiveValue(match, team.name, statRow);
      if (teamValue != null) attackValues.push(teamValue);
      if (opponentValue != null) defenceValues.push(opponentValue);
    }
    attack[stat.id] = average(attackValues);
    defence[stat.id] = average(defenceValues);
  }
  return {
    name: team.name,
    href: team.href,
    leagueGames: matches.length,
    attack,
    defence,
  };
}

function computeTeamDefensiveAverages(team, matches) {
  const byStat = {};
  for (const stat of BREAKDOWN_STATS) {
    if (stat.id === 'goals') {
      byStat[stat.id] = { perGame: average(matches.map((match) => goalsConceded(match, team.name))), gamesCounted: matches.length };
      continue;
    }
    let sum = 0;
    let gamesCounted = 0;
    for (const match of matches) {
      const statRow = findStat(match, stat.statName);
      if (!statRow) continue;
      const value = getOpponentPerspectiveValue(match, team.name, statRow);
      if (value == null) continue;
      sum += value;
      gamesCounted += 1;
    }
    byStat[stat.id] = gamesCounted > 0 ? { perGame: sum / gamesCounted, gamesCounted } : { perGame: null, gamesCounted: 0 };
  }
  return {
    name: team.name,
    href: team.href,
    leagueGames: matches.length,
    byStat,
  };
}

function rankTeams(teams, statId, mode) {
  const withValues = teams
    .map((team) => {
      const value = mode === 'attack' ? team.attack?.[statId] : team.defence?.[statId];
      if (value == null || !Number.isFinite(value)) return null;
      return { key: team.href, value };
    })
    .filter(Boolean);
  const sorted = [...withValues].sort((a, b) => (mode === 'attack' ? b.value - a.value : a.value - b.value));
  const ranks = new Map();
  let rank = 1;
  for (let index = 0; index < sorted.length; index += 1) {
    if (index > 0 && sorted[index].value !== sorted[index - 1].value) rank = index + 1;
    ranks.set(sorted[index].key, rank);
  }
  return { ranks, rankedSize: sorted.length };
}

function rankTeamsByStat(teams, stat) {
  const withValues = teams
    .map((team) => {
      const value = team.byStat?.[stat.id]?.perGame;
      if (value == null || !Number.isFinite(value)) return null;
      return { key: team.href, value };
    })
    .filter(Boolean);
  const sorted = [...withValues].sort((a, b) => (stat.lowerIsBetter ? a.value - b.value : b.value - a.value));
  const ranks = new Map();
  let rank = 1;
  for (let index = 0; index < sorted.length; index += 1) {
    if (index > 0 && sorted[index].value !== sorted[index - 1].value) rank = index + 1;
    ranks.set(sorted[index].key, rank);
  }
  return { ranks, rankedSize: sorted.length };
}

function leagueAverage(teams, stat) {
  const values = teams
    .map((team) => team.byStat?.[stat.id]?.perGame)
    .filter((value) => value != null && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function pickInt(raw) {
  if (raw == null || raw === '') return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickUnix(raw) {
  const parsed = pickInt(raw);
  return parsed != null && parsed > 1_000_000_000 ? parsed : null;
}

function splitSoccerwayFeedSegments(raw) {
  return String(raw || '')
    .split('~')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .flatMap((segment) => {
      if (segment.startsWith('AA÷')) return [{ type: 'match', body: segment.slice(3) }];
      if (segment.startsWith('ZA÷')) return [{ type: 'competition', body: segment }];
      return [];
    });
}

function parseFeedFields(segment) {
  const out = {};
  for (const part of String(segment || '').split('¬')) {
    const div = part.indexOf('÷');
    if (div === -1) continue;
    const key = part.slice(0, div);
    const value = part.slice(div + 1);
    if (key) out[key] = value;
  }
  return out;
}

function buildFlashscoreLogoUrl(token) {
  const value = String(token || '').trim();
  if (!value || !/\.png$/i.test(value)) return null;
  return `https://static.flashscore.com/res/image/data/${value}`;
}

function parseSoccerwayTeamResultsHtml(html) {
  const segments = splitSoccerwayFeedSegments(html);
  const out = [];
  const seenKeys = new Set();
  let currentCompetitionName = null;
  let currentCompetitionCountry = null;

  for (const segment of segments) {
    if (segment.type === 'competition') {
      const fields = parseFeedFields(segment.body);
      currentCompetitionName = fields.ZK ?? null;
      currentCompetitionCountry = fields.ZY ?? null;
      continue;
    }

    const parts = segment.body.split('¬');
    const matchId = parts[0]?.trim() || null;
    if (!matchId) continue;

    const fields = {};
    for (let index = 1; index < parts.length; index += 1) {
      const item = parts[index];
      const div = item.indexOf('÷');
      if (div === -1) continue;
      const key = item.slice(0, div);
      const value = item.slice(div + 1);
      if (key) fields[key] = value;
    }

    const wu = fields.WU;
    const px = fields.PX;
    const wv = fields.WV;
    const py = fields.PY;
    const homeTeam = fields.AE;
    const awayTeam = fields.AF;
    const homeScore = pickInt(fields.AG);
    const awayScore = pickInt(fields.AH);
    const kickoffUnix = pickUnix(fields.AD);
    if (!wu || !px || !wv || !py || !homeTeam || !awayTeam || homeScore == null || awayScore == null) continue;

    const summaryPath = `/match/${wu}-${px}/${wv}-${py}/summary/`;
    const dedupeKey = `${matchId}:${summaryPath}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    out.push({
      matchId,
      homeTeam,
      awayTeam,
      homeLogoUrl: buildFlashscoreLogoUrl(fields.OA),
      awayLogoUrl: buildFlashscoreLogoUrl(fields.OB),
      competitionName: fields.ZK ?? currentCompetitionName,
      competitionCountry: fields.ZY ?? currentCompetitionCountry,
      homeScore,
      awayScore,
      kickoffUnix,
      summaryPath,
      stats: null,
    });
  }

  return out;
}

function extractSoccerwayFeedSign(html) {
  return html.match(/"feed_sign":"([^"]+)"/)?.[1] ?? html.match(/var\s+feed_sign\s*=\s*'([^']+)'/)?.[1] ?? null;
}

function extractSoccerwayCountryId(html) {
  return html.match(/country_id\s*=\s*"([^"]+)"/)?.[1] ?? html.match(/country_id:\s*"([^"]+)"/)?.[1] ?? null;
}

function extractParticipantIdFromTeamHref(teamHref) {
  return String(teamHref || '')
    .trim()
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean)
    .at(-1) || '';
}

function buildSoccerwayParticipantResultsFeedUrl(params) {
  const sportId = params.sportId ?? 1;
  const timezoneHour = params.timezoneHour ?? 0;
  const language = params.language ?? 'en';
  const projectTypeId = params.projectTypeId ?? 1;
  return `https://global.flashscore.ninja/2020/x/feed/pr_${sportId}_${params.countryId}_${params.participantId}_${params.page}_${timezoneHour}_${language}_${projectTypeId}`;
}

function buildSoccerwayMatchStatsFeedUrl(matchId, sportId = 1) {
  return `https://global.flashscore.ninja/2020/x/feed/df_st_${sportId}_${matchId}`;
}

function parseSoccerwayMatchStatsFeed(raw, feedUrl) {
  const segments = String(raw || '')
    .split('~')
    .map((segment) => segment.trim())
    .filter(Boolean);

  const periods = [];
  let currentPeriod = null;
  let currentCategory = null;

  for (const segment of segments) {
    const fields = parseFeedFields(segment);
    if (fields.SE) {
      currentPeriod = { name: fields.SE, categories: [] };
      periods.push(currentPeriod);
      currentCategory = null;
      continue;
    }

    if (fields.SF) {
      if (!currentPeriod) {
        currentPeriod = { name: 'Match', categories: [] };
        periods.push(currentPeriod);
      }
      currentCategory = { name: fields.SF, stats: [] };
      currentPeriod.categories.push(currentCategory);
      continue;
    }

    if (fields.SG || fields.SH || fields.SI) {
      if (!currentPeriod) {
        currentPeriod = { name: 'Match', categories: [] };
        periods.push(currentPeriod);
      }
      if (!currentCategory) {
        currentCategory = { name: 'Stats', stats: [] };
        currentPeriod.categories.push(currentCategory);
      }
      currentCategory.stats.push({
        id: fields.SD ?? null,
        name: fields.SG || fields.SD || 'Stat',
        homeValue: fields.SH ?? null,
        awayValue: fields.SI ?? null,
        fields,
      });
    }
  }

  if (periods.length === 0) return null;
  return { feedUrl, periods, raw };
}

async function fetchText(url, headers, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

function appendUniqueMatches(target, incoming, seasonYear) {
  const seen = new Set(target.map((match) => `${match.matchId}:${match.summaryPath}`));
  let added = 0;
  for (const match of incoming) {
    const key = `${match.matchId}:${match.summaryPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (getSoccerSeasonYearFromKickoffUnix(match.kickoffUnix) !== seasonYear) continue;
    target.push(match);
    added += 1;
  }
  return added;
}

async function fetchTeamCurrentSeasonResults(team, seasonYear) {
  const resultsUrl = `${SOCCERWAY_BASE}${team.href}/results/`;
  const html = await fetchText(resultsUrl, SOCCERWAY_HTML_HEADERS, REQUEST_TIMEOUT_MS);
  const feedSign = extractSoccerwayFeedSign(html);
  const countryId = extractSoccerwayCountryId(html);
  const participantId = extractParticipantIdFromTeamHref(team.href);
  const matches = parseSoccerwayTeamResultsHtml(html).filter((match) => getSoccerSeasonYearFromKickoffUnix(match.kickoffUnix) === seasonYear);

  if (feedSign && countryId && participantId) {
    for (let page = 1; page <= MAX_SHOW_MORE_PAGES; page += 1) {
      const feedUrl = buildSoccerwayParticipantResultsFeedUrl({
        countryId,
        participantId,
        page,
        timezoneHour: 0,
        language: 'en',
        projectTypeId: 1,
      });
      let feedText = '';
      try {
        feedText = await fetchText(
          feedUrl,
          {
            ...SOCCERWAY_FEED_HEADERS,
            'x-fsign': feedSign,
          },
          REQUEST_TIMEOUT_MS
        );
      } catch {
        break;
      }

      const pageMatches = parseSoccerwayTeamResultsHtml(feedText);
      if (pageMatches.length === 0) break;
      appendUniqueMatches(matches, pageMatches, seasonYear);

      const reachedOlderSeason = pageMatches.some((match) => getSoccerSeasonYearFromKickoffUnix(match.kickoffUnix) < seasonYear);
      if (reachedOlderSeason) break;
    }
  }

  return {
    team,
    feedSign,
    matches,
  };
}

async function fetchMatchStats(matchId, feedSign) {
  if (!matchId || !feedSign) return null;
  const feedUrl = buildSoccerwayMatchStatsFeedUrl(matchId);
  try {
    const raw = await fetchText(
      feedUrl,
      {
        ...SOCCERWAY_FEED_HEADERS,
        'x-fsign': feedSign,
      },
      REQUEST_TIMEOUT_MS
    );
    return parseSoccerwayMatchStatsFeed(raw, feedUrl);
  } catch {
    return null;
  }
}

async function runPool(items, worker, size) {
  let index = 0;
  const results = new Array(items.length);
  async function runOne() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => runOne()));
  return results;
}

async function main() {
  const roster = readPremierLeagueRoster();
  const seasonYear = getCurrentSoccerSeasonYear();
  console.log(`[Soccer Last5 PL] Building snapshot for ${roster.length} teams from Soccerway`);
  console.log(`[Soccer Last5 PL] Using season ${seasonYear}/${String(seasonYear + 1).slice(-2)}`);

  const teamFetches = await runPool(
    roster,
    async (team, index) => {
      try {
        console.log(`[${index + 1}/${roster.length}] ${team.name}`);
        const result = await fetchTeamCurrentSeasonResults(team, seasonYear);
        console.log(`  scraped: ${result.matches.length} current-season matches`);
        return result;
      } catch (error) {
        console.log(`  failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    },
    TEAM_CONCURRENCY
  );

  const validTeams = teamFetches.filter(Boolean);
  if (validTeams.length === 0) {
    throw new Error('No Premier League teams could be scraped from Soccerway.');
  }
  if (validTeams.length !== roster.length) {
    const scrapedNames = new Set(validTeams.map((entry) => entry.team.name));
    const missingTeams = roster
      .filter((team) => !scrapedNames.has(team.name))
      .map((team) => team.name);
    throw new Error(`Failed to scrape all Premier League teams. Missing: ${missingTeams.join(', ')}`);
  }

  const matchIndex = new Map();
  const teamMatches = new Map();

  for (const entry of validTeams) {
    teamMatches.set(entry.team.href, entry.matches.map((match) => match.matchId));
    for (const match of entry.matches) {
      const existing = matchIndex.get(match.matchId);
      if (!existing || (!existing.feedSign && entry.feedSign)) {
        matchIndex.set(match.matchId, {
          ...match,
          feedSign: existing?.feedSign || entry.feedSign || null,
        });
      }
    }
  }

  const uniqueMatches = Array.from(matchIndex.values());
  console.log(`[Soccer Last5 PL] Fetching stats for ${uniqueMatches.length} unique matches`);
  await runPool(
    uniqueMatches,
    async (match, index) => {
      const stats = await fetchMatchStats(match.matchId, match.feedSign);
      matchIndex.set(match.matchId, {
        ...match,
        stats,
      });
      if ((index + 1) % 25 === 0 || index === uniqueMatches.length - 1) {
        console.log(`  stats ${index + 1}/${uniqueMatches.length}`);
      }
      return null;
    },
    STATS_CONCURRENCY
  );

  const last5Teams = validTeams
    .map((entry) => {
      const matchIds = teamMatches.get(entry.team.href) || [];
      const hydratedMatches = matchIds
        .map((matchId) => {
          const match = matchIndex.get(matchId);
          if (!match) return null;
          const { feedSign, ...rest } = match;
          return rest;
        })
        .filter(Boolean)
        .sort((a, b) => {
          const aKickoff = a.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
          const bKickoff = b.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
          if (aKickoff !== bKickoff) return bKickoff - aKickoff;
          return String(b.matchId || '').localeCompare(String(a.matchId || ''));
        })
        .slice(0, 5);
      if (hydratedMatches.length === 0) return null;
      return {
        team: entry.team,
        matches: hydratedMatches,
      };
    })
    .filter(Boolean);
  if (last5Teams.length !== roster.length) {
    const sampledNames = new Set(last5Teams.map((entry) => entry.team.name));
    const missingTeams = roster
      .filter((team) => !sampledNames.has(team.name))
      .map((team) => team.name);
    throw new Error(`Failed to build last5 data for all Premier League teams. Missing: ${missingTeams.join(', ')}`);
  }
  const teamsWithTooFewMatches = last5Teams.filter((entry) => entry.matches.length < 5).map((entry) => `${entry.team.name} (${entry.matches.length})`);
  if (teamsWithTooFewMatches.length > 0) {
    throw new Error(`Expected 5 recent current-season matches for every team. Short teams: ${teamsWithTooFewMatches.join(', ')}`);
  }

  const matchupTeams = last5Teams.map((entry) => computeTeamMatchupAverages(entry.team, entry.matches));
  const matchupSnapshotTeams = matchupTeams.map((team) => {
    const attack = {};
    const defence = {};
    for (const stat of MATCHUP_STATS) {
      const attackRanking = rankTeams(matchupTeams, stat.id, 'attack');
      const defenceRanking = rankTeams(matchupTeams, stat.id, 'defence');
      attack[stat.id] = {
        perGame: team.attack?.[stat.id] ?? null,
        rank: attackRanking.ranks.get(team.href) ?? null,
        rankedSize: attackRanking.rankedSize,
      };
      defence[stat.id] = {
        perGame: team.defence?.[stat.id] ?? null,
        rank: defenceRanking.ranks.get(team.href) ?? null,
        rankedSize: defenceRanking.rankedSize,
      };
    }
    return {
      name: team.name,
      href: team.href,
      leagueGames: team.leagueGames,
      attack,
      defence,
    };
  });

  const breakdownTeams = last5Teams.map((entry) => computeTeamDefensiveAverages(entry.team, entry.matches));
  const breakdownSnapshotTeams = breakdownTeams.map((team) => ({
    name: team.name,
    href: team.href,
    leagueGames: team.leagueGames,
    stats: BREAKDOWN_STATS.map((stat) => {
      const ranking = rankTeamsByStat(breakdownTeams, stat);
      return {
        id: stat.id,
        label: stat.label,
        shortLabel: stat.shortLabel,
        perGame: team.byStat?.[stat.id]?.perGame ?? null,
        rank: ranking.ranks.get(team.href) ?? null,
        rankedSize: ranking.rankedSize,
        leagueAverage: leagueAverage(breakdownTeams, stat),
        niche: Boolean(stat.niche),
        lowerIsBetter: stat.lowerIsBetter,
        isPercent: Boolean(stat.isPercent),
      };
    }),
  }));

  const generatedAt = new Date().toISOString();
  const matchupPayload = {
    generatedAt,
    source: 'build-soccer-last5-pl',
    sourceBaseUrl: SOCCERWAY_BASE,
    timeframe: 'last5',
    competitionName: COMPETITION_NAME,
    competitionCountry: COMPETITION_COUNTRY,
    competitionLabel: `${COMPETITION_COUNTRY} · ${COMPETITION_NAME}`,
    seasonYear,
    teamsInLeague: roster.length,
    teamsSampled: matchupSnapshotTeams.length,
    stats: MATCHUP_STATS.map((stat) => ({ id: stat.id, label: stat.label })),
    teams: matchupSnapshotTeams,
  };
  const breakdownPayload = {
    generatedAt,
    source: 'build-soccer-last5-pl',
    sourceBaseUrl: SOCCERWAY_BASE,
    timeframe: 'last5',
    competitionName: COMPETITION_NAME,
    competitionCountry: COMPETITION_COUNTRY,
    competitionLabel: `${COMPETITION_COUNTRY} · ${COMPETITION_NAME}`,
    seasonYear,
    teamsInLeague: roster.length,
    teamsSampled: breakdownSnapshotTeams.length,
    teams: breakdownSnapshotTeams,
  };

  fs.writeFileSync(MATCHUP_OUT_PATH, JSON.stringify(matchupPayload, null, 2), 'utf8');
  fs.writeFileSync(BREAKDOWN_OUT_PATH, JSON.stringify(breakdownPayload, null, 2), 'utf8');

  console.log(`[Soccer Last5 PL] Wrote ${MATCHUP_OUT_PATH}`);
  console.log(`[Soccer Last5 PL] Wrote ${BREAKDOWN_OUT_PATH}`);
  console.log(`[Soccer Last5 PL] Teams sampled: ${last5Teams.length}/${roster.length}`);
}

main().catch((error) => {
  console.error('[Soccer Last5 PL] Failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
