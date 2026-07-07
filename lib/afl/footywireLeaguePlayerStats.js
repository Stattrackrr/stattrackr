const fs = require('fs');
const path = require('path');
const {
  DEFAULT_HEADERS: FOOTYWIRE_HEADERS,
  isFootywireUnavailableStatus,
  probeFootywire,
  fetchFootywireText,
} = require('./footywireHttp');

const FOOTYWIRE_BASE = 'https://www.footywire.com';
const FETCH_ATTEMPTS = 5;
const FETCH_RETRY_BASE_MS = 2500;
const STAT_FETCH_DELAY_MS = 350;

const ADVANCED_STAT_KEYS = ['contested_possessions', 'uncontested_possessions', 'meters_gained', 'free_kicks_for'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeFootywireRankings(season) {
  const url = `${FOOTYWIRE_BASE}/afl/footy/ft_player_rankings?year=${season}&rt=LA&pt=&st=DI&mg=1`;
  return probeFootywire(url);
}

function normalizePlayerName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function hasAdvancedFields(players) {
  if (!Array.isArray(players) || players.length === 0) return false;
  return players.some((player) =>
    ADVANCED_STAT_KEYS.some((key) => Number.isFinite(Number(player?.[key])))
  );
}

function leagueStatsFilePath(season) {
  return path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`);
}

function readExistingLeagueStats(season) {
  try {
    const parsed = JSON.parse(fs.readFileSync(leagueStatsFilePath(season), 'utf8'));
    if (Number(parsed?.season) !== season) return null;
    return parsed;
  } catch {
    return null;
  }
}

function existingLeagueStatsLookValid(existing, season) {
  const players = Array.isArray(existing?.players) ? existing.players : [];
  return players.length >= 100 && hasAdvancedFields(players);
}

function mergeAdvancedFromExisting(players, existingPlayers) {
  const byName = new Map(
    (existingPlayers ?? []).map((player) => [normalizePlayerName(player?.name), player])
  );
  for (const player of players) {
    const existing = byName.get(normalizePlayerName(player?.name));
    if (!existing) continue;
    for (const key of ADVANCED_STAT_KEYS) {
      if (!Number.isFinite(Number(player[key])) && Number.isFinite(Number(existing[key]))) {
        player[key] = existing[key];
      }
    }
  }
}

function htmlToText(v) {
  return String(v || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const FOOTYWIRE_NICKNAME_TO_LEAGUE = {
  Crows: 'Adelaide',
  Lions: 'Brisbane',
  Blues: 'Carlton',
  Magpies: 'Collingwood',
  Bombers: 'Essendon',
  Dockers: 'Fremantle',
  Cats: 'Geelong',
  Suns: 'Gold Coast',
  Giants: 'GWS',
  Hawks: 'Hawthorn',
  Demons: 'Melbourne',
  Kangaroos: 'North Melbourne',
  Power: 'Port Adelaide',
  Tigers: 'Richmond',
  Saints: 'St Kilda',
  Swans: 'Sydney',
  Bulldogs: 'Western Bulldogs',
  Eagles: 'West Coast',
};

const STAT_PAGES = [
  { key: 'disposals', st: 'DI' },
  { key: 'kicks', st: 'KI' },
  { key: 'handballs', st: 'HB' },
  { key: 'marks', st: 'MA' },
  { key: 'goals', st: 'GO' },
  { key: 'tackles', st: 'TA' },
  { key: 'clearances', st: 'CL' },
  { key: 'inside_50s', st: 'I5' },
  { key: 'rebound_50s', st: 'R5' },
  { key: 'contested_possessions', st: 'CP' },
  { key: 'uncontested_possessions', st: 'UP' },
  { key: 'meters_gained', st: 'MG' },
  { key: 'free_kicks_for', st: 'FF' },
];

function findRankingsTable(html) {
  const ppIdx = html.indexOf('pp-');
  if (ppIdx < 0) return null;
  const tableStart = html.lastIndexOf('<table', ppIdx);
  if (tableStart < 0) return null;
  let depth = 1;
  const re = /<table|<\/table>/gi;
  re.lastIndex = html.indexOf('>', tableStart) + 1;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[0].toLowerCase() === '</table>') {
      depth--;
      if (depth === 0) return html.substring(tableStart, m.index + 8);
    } else depth++;
  }
  return null;
}

function parsePlayerRankingsTable(html, statKey) {
  const rows = [];
  const tableHtml = findRankingsTable(html);
  if (!tableHtml) return rows;

  const rowRegex = /<tr[^>]*(?:class="[^"]*(?:dark|light)color[^"]*"[^>]*)?>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableHtml))) {
    const row = rowMatch[1];
    const playerLink = row.match(/<a[^>]+href=['"]([^'"]*pp-[^'"]+)['"][^>]*>([\s\S]*?)<\/a>/i);
    if (!playerLink) continue;
    const name = htmlToText(playerLink[2]).trim();
    if (!name || name.length < 2) continue;
    if (/^(player|rank|#|name)$/i.test(name)) continue;
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = cellRegex.exec(row))) cells.push(htmlToText(c[1]).trim());
    if (cells.length < 4) continue;
    let valueNum = parseFloat(cells[cells.length - 1]);
    if (!Number.isFinite(valueNum) && cells.length >= 5) valueNum = parseFloat(cells[4]);
    if (!Number.isFinite(valueNum) && cells.length >= 4) valueNum = parseFloat(cells[3]);
    if (!Number.isFinite(valueNum)) continue;
    const gamesNum = parseInt(cells[3], 10);
    const team = (cells[2] || '').trim();
    const numberRaw = parseInt(cells[0], 10);
    const number = Number.isFinite(numberRaw) && numberRaw >= 1 && numberRaw <= 99 ? numberRaw : null;
    rows.push({
      name,
      team: team || '—',
      games: Number.isFinite(gamesNum) ? gamesNum : 0,
      number,
      [statKey]: valueNum,
    });
  }
  return rows;
}

function mergeByPlayer(statArrays) {
  const byKey = new Map();
  for (const arr of statArrays) {
    for (const row of arr) {
      const key = `${String(row.name).toLowerCase().trim()}|${String(row.team).toLowerCase().trim()}`;
      let existing = byKey.get(key);
      if (!existing) {
        existing = {
          name: row.name,
          team: row.team,
          games: row.games || 0,
          number: row.number ?? null,
          disposals: 0,
          kicks: 0,
          handballs: 0,
          marks: 0,
          goals: 0,
          tackles: 0,
          clearances: 0,
          inside_50s: 0,
          rebound_50s: 0,
          contested_possessions: 0,
          uncontested_possessions: 0,
          meters_gained: 0,
          free_kicks_for: 0,
        };
        byKey.set(key, existing);
      }
      if (row.games && row.games > existing.games) existing.games = row.games;
      if (row.number != null && existing.number == null) existing.number = row.number;
      const statKey = Object.keys(row).find((k) => !['name', 'team', 'games', 'number'].includes(k));
      if (statKey && existing.hasOwnProperty(statKey)) existing[statKey] = row[statKey];
    }
  }
  return Array.from(byKey.values());
}

async function fetchOne(season, st, statKey) {
  const url = `${FOOTYWIRE_BASE}/afl/footy/ft_player_rankings?year=${season}&rt=LA&pt=&st=${st}&mg=1`;
  const fetched = await fetchFootywireText(url, { headers: FOOTYWIRE_HEADERS, attempts: FETCH_ATTEMPTS, baseDelayMs: FETCH_RETRY_BASE_MS });
  if (!fetched.ok) {
    return { ok: false, html: '', url, rows: [], error: fetched.error || `HTTP ${fetched.status}` };
  }
  const rows = parsePlayerRankingsTable(fetched.text, statKey);
  if (rows.length === 0) {
    return { ok: false, html: fetched.text, url, rows: [], error: 'no rows parsed' };
  }
  return { ok: true, html: fetched.text, url, rows };
}

async function fetchFtPlayersTeamMap() {
  const url = `${FOOTYWIRE_BASE}/afl/footy/ft_players`;
  const fetched = await fetchFootywireText(url, { headers: FOOTYWIRE_HEADERS });
  if (!fetched.ok) return new Map();
  const html = fetched.text;
  const map = new Map();
  const linkRe = /href=["'](?:pp|pg)-([^"'\-]+(?:-[^"'\-]+)*)--([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const teamSlug = (m[1] || '').trim().toLowerCase();
    const playerSlug = (m[2] || '').trim().toLowerCase().replace(/-/g, ' ');
    const linkText = (m[3] || '').trim();
    if (!teamSlug) continue;
    const lastPart = teamSlug.split('-').pop() || '';
    const nickname = lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
    const leagueTeam = FOOTYWIRE_NICKNAME_TO_LEAGUE[nickname] || null;
    if (!leagueTeam) continue;
    const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    if (playerSlug) {
      const nameFromSlug = playerSlug.replace(/\b\w/g, (c) => c.toUpperCase());
      map.set(norm(nameFromSlug), leagueTeam);
    }
    if (linkText && linkText.includes(',')) {
      const [surname, first] = linkText.split(',').map((x) => x.trim());
      if (surname && first) map.set(norm(`${first} ${surname}`), leagueTeam);
    }
  }
  return map;
}

async function fetchSeason(season, options = {}) {
  const debugHtml = options.debugHtml === true;
  const allStats = [];
  for (let i = 0; i < STAT_PAGES.length; i++) {
    const { key, st } = STAT_PAGES[i];
    const { ok, html, url, rows, error } = await fetchOne(season, st, key);
    if (!ok) {
      console.warn(`  Skipping ${key} (st=${st}): request failed`);
      if (i === 0 && /HTTP (429|502|503)/.test(String(error ?? ''))) {
        console.warn('  FootyWire appears unavailable; skipping remaining stat pages.');
        break;
      }
      if (i < STAT_PAGES.length - 1) await sleep(STAT_FETCH_DELAY_MS);
      continue;
    }
    if (debugHtml && key === 'disposals') {
      const ppIdx = html.indexOf('pp-');
      const tableHtml = findRankingsTable(html);
      const outPath = path.join(process.cwd(), 'data', 'debug-league-rankings-snippet.html');
      const snippet = ppIdx >= 0 ? html.substring(Math.max(0, ppIdx - 500), ppIdx + 3000) : (tableHtml || html).substring(0, 8000);
      fs.writeFileSync(outPath, `<!-- ${url} ppIdx=${ppIdx} -->\n${snippet}`, 'utf8');
      console.log(`  Debug: wrote ${outPath} (pp- count: ${(html.match(/pp-/g) || []).length}, tableHtml length: ${tableHtml ? tableHtml.length : 0})`);
    }
    if (rows.length === 0) {
      console.warn(`  No rows for ${key} (st=${st}). Page structure may have changed.`);
      if (i < STAT_PAGES.length - 1) await sleep(STAT_FETCH_DELAY_MS);
      continue;
    }
    console.log(`  ${key}: ${rows.length} players`);
    allStats.push(rows);
    if (i < STAT_PAGES.length - 1) await sleep(STAT_FETCH_DELAY_MS);
  }
  return allStats;
}

async function buildLeaguePlayerStatsPayload(requestedSeason, options = {}) {
  const year = new Date().getFullYear();
  const allowStale = options.allowStale === true;
  const skipStaleProbe = options.skipStaleProbe === true;
  let season = requestedSeason;
  const existing = readExistingLeagueStats(requestedSeason);

  if (!skipStaleProbe && allowStale && existingLeagueStatsLookValid(existing, requestedSeason)) {
    const probe = await probeFootywireRankings(requestedSeason);
    if (!probe.ok && (isFootywireUnavailableStatus(probe.status) || probe.status === 0)) {
      return {
        stale: true,
        reason: `FootyWire unavailable (HTTP ${probe.status || probe.error || 'error'})`,
        existing,
      };
    }
  }

  console.log(`Fetching FootyWire league player stats for ${season}...`);
  let allStats = await fetchSeason(season, { debugHtml: options.debugHtml === true });

  if (allStats.length === 0 && season === requestedSeason && season === year && season > 2020) {
    const fallback = season - 1;
    console.log(`No data for ${season}; trying previous season ${fallback}...`);
    season = fallback;
    allStats = await fetchSeason(season, { debugHtml: options.debugHtml === true });
  }

  let players = mergeByPlayer(allStats);
  const minGames = 1;
  let filtered = players.filter((p) => p.games >= minGames && (p.disposals > 0 || p.kicks > 0 || p.handballs > 0));

  if (!hasAdvancedFields(filtered) && existingLeagueStatsLookValid(existing, requestedSeason)) {
    console.warn(`Advanced stat pages missing for ${requestedSeason}; merging advanced fields from existing file.`);
    mergeAdvancedFromExisting(filtered, existing.players);
  }

  if (!hasAdvancedFields(filtered)) {
    if (allowStale && existingLeagueStatsLookValid(existing, requestedSeason)) {
      return {
        stale: true,
        reason: `FootyWire advanced stats unavailable for ${requestedSeason}`,
        existing,
      };
    }
    throw new Error(
      `League player stats for ${requestedSeason} are missing advanced fields (${ADVANCED_STAT_KEYS.join(', ')}). FootyWire may be rate-limiting.`
    );
  }

  console.log('Fetching current teams from ft_players...');
  const ftPlayersTeamMap = await fetchFtPlayersTeamMap();
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  let teamsOverridden = 0;
  for (const p of filtered) {
    const key = norm(p.name);
    const currentTeam = ftPlayersTeamMap.get(key);
    if (currentTeam) {
      p.team = currentTeam;
      teamsOverridden++;
    }
  }
  if (ftPlayersTeamMap.size) {
    console.log(`  Applied current team from ft_players for ${teamsOverridden} players (source: ${ftPlayersTeamMap.size} entries)`);
  }

  return {
    stale: false,
    payload: {
      season: requestedSeason,
      generatedAt: new Date().toISOString(),
      source: 'footywire.com',
      sourcePage: 'ft_player_rankings (rt=LA, multiple st=)',
      playerCount: filtered.length,
      players: filtered,
    },
  };
}

module.exports = { buildLeaguePlayerStatsPayload, leagueStatsFilePath };
