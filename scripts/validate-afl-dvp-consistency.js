#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Validate AFL props-list DvP ratings against /api/afl/dvp/batch.
 * Fails with non-zero exit code when mismatches are found.
 *
 * Usage:
 *   PROD_URL=https://your-app.vercel.app node scripts/validate-afl-dvp-consistency.js
 *   node scripts/validate-afl-dvp-consistency.js --base-url=http://localhost:3000 --season=2026
 */

function getArg(name, fallback) {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTeam(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function canonicalTeamKey(teamRaw) {
  const t = normalizeTeam(teamRaw);
  const map = {
    adelaide: 'adelaide',
    adelaidecrows: 'adelaide',
    crows: 'adelaide',
    brisbane: 'brisbane',
    brisbanelions: 'brisbane',
    lions: 'brisbane',
    carlton: 'carlton',
    carltonblues: 'carlton',
    blues: 'carlton',
    collingwood: 'collingwood',
    collingwoodmagpies: 'collingwood',
    magpies: 'collingwood',
    essendon: 'essendon',
    essendonbombers: 'essendon',
    bombers: 'essendon',
    fremantle: 'fremantle',
    fremantledockers: 'fremantle',
    dockers: 'fremantle',
    geelong: 'geelong',
    geelongcats: 'geelong',
    cats: 'geelong',
    goldcoast: 'goldcoast',
    goldcoastsuns: 'goldcoast',
    suns: 'goldcoast',
    gws: 'gws',
    gwsgiants: 'gws',
    greaterwesternsydney: 'gws',
    greaterwesternsydneygiants: 'gws',
    giants: 'gws',
    hawthorn: 'hawthorn',
    hawthornhawks: 'hawthorn',
    hawks: 'hawthorn',
    melbourne: 'melbourne',
    melbournedemons: 'melbourne',
    demons: 'melbourne',
    northmelbourne: 'northmelbourne',
    northmelbournekangaroos: 'northmelbourne',
    kangaroos: 'northmelbourne',
    north: 'northmelbourne',
    portadelaide: 'portadelaide',
    portadelaidepower: 'portadelaide',
    power: 'portadelaide',
    port: 'portadelaide',
    richmond: 'richmond',
    richmondtigers: 'richmond',
    tigers: 'richmond',
    stkilda: 'stkilda',
    stkildasaints: 'stkilda',
    saints: 'stkilda',
    sydney: 'sydney',
    sydneyswans: 'sydney',
    swans: 'sydney',
    westcoast: 'westcoast',
    westcoasteagles: 'westcoast',
    eagles: 'westcoast',
    westernbulldogs: 'westernbulldogs',
    bulldogs: 'westernbulldogs',
    footscray: 'westernbulldogs',
  };
  return map[t] || t;
}

function headers() {
  const h = { Accept: 'application/json' };
  const secret = process.env.CRON_SECRET || '';
  if (secret) {
    h.Authorization = `Bearer ${secret}`;
    h['X-Cron-Secret'] = secret;
  }
  return h;
}

async function getJson(url) {
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${url} -> HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

function buildPositionIndex(players) {
  const byExact = new Map();
  const byInitialSurnameTeam = new Map();
  const teamByExact = new Map();
  const teamByInitialSurname = new Map();
  for (const p of players) {
    const name = normalizeName(p.name);
    const teamKey = canonicalTeamKey(p.team);
    const pos = String(p.position || '').toUpperCase().trim();
    if (!name || !teamKey || !pos) continue;
    byExact.set(name, pos);
    if (!teamByExact.has(name)) teamByExact.set(name, teamKey);
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      const idx = `${parts[0][0]}|${parts[parts.length - 1]}|${teamKey}`;
      if (!byInitialSurnameTeam.has(idx)) byInitialSurnameTeam.set(idx, pos);
      const idxNoTeam = `${parts[0][0]}|${parts[parts.length - 1]}`;
      const arr = teamByInitialSurname.get(idxNoTeam) || [];
      if (!arr.includes(teamKey)) arr.push(teamKey);
      teamByInitialSurname.set(idxNoTeam, arr);
    }
  }
  return { byExact, byInitialSurnameTeam, teamByExact, teamByInitialSurname };
}

function resolvePosition(playerName, playerTeam, index) {
  const norm = normalizeName(playerName);
  const exact = index.byExact.get(norm);
  if (exact) return exact;
  const parts = norm.split(' ').filter(Boolean);
  if (parts.length < 2) return null;
  const teamKey = canonicalTeamKey(playerTeam);
  const idx = `${parts[0][0]}|${parts[parts.length - 1]}|${teamKey}`;
  return index.byInitialSurnameTeam.get(idx) || null;
}

function resolvePlayerTeam(playerName, homeTeam, awayTeam, index) {
  const norm = normalizeName(playerName);
  const exact = index.teamByExact.get(norm);
  if (exact) return exact;
  const parts = norm.split(' ').filter(Boolean);
  if (parts.length < 2) return null;
  const idx = `${parts[0][0]}|${parts[parts.length - 1]}`;
  const candidates = index.teamByInitialSurname.get(idx) || [];
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const homeKey = canonicalTeamKey(homeTeam);
  const awayKey = canonicalTeamKey(awayTeam);
  const matched = candidates.find((c) => c === homeKey || c === awayKey);
  return matched || candidates[0] || null;
}

function findValueByTeam(values, teamName) {
  if (!values || typeof values !== 'object') return null;
  const direct = values[teamName];
  if (Number.isFinite(Number(direct))) return Number(direct);
  const teamKey = canonicalTeamKey(teamName);
  for (const [k, v] of Object.entries(values)) {
    if (!Number.isFinite(Number(v))) continue;
    if (canonicalTeamKey(k) === teamKey) return Number(v);
  }
  return null;
}

async function validateOnce(baseUrl, season) {
  const [listJson, fantasyJson, batchDEF, batchMID, batchFWD, batchRUC] = await Promise.all([
    getJson(`${baseUrl}/api/afl/player-props/list?debugStats=1`),
    getJson(`${baseUrl}/api/afl/fantasy-positions?season=${season}`),
    getJson(`${baseUrl}/api/afl/dvp/batch?season=${season}&position=DEF&stats=disposals,goals`),
    getJson(`${baseUrl}/api/afl/dvp/batch?season=${season}&position=MID&stats=disposals,goals`),
    getJson(`${baseUrl}/api/afl/dvp/batch?season=${season}&position=FWD&stats=disposals,goals`),
    getJson(`${baseUrl}/api/afl/dvp/batch?season=${season}&position=RUC&stats=disposals,goals`),
  ]);

  const rows = Array.isArray(listJson?.data) ? listJson.data : [];
  const fantasyPlayers = Array.isArray(fantasyJson?.players) ? fantasyJson.players : [];
  const posIndex = buildPositionIndex(fantasyPlayers);
  const byPos = { DEF: batchDEF, MID: batchMID, FWD: batchFWD, RUC: batchRUC };
  const supported = new Set(['disposals', 'goals_over']);

  const mismatches = [];
  const unresolved = [];
  let checked = 0;
  let unresolvedTeam = 0;

  for (const row of rows) {
    const statType = String(row?.statType || '');
    if (!supported.has(statType)) continue;
    const player = String(row?.playerName || '');
    const playerTeamRaw = String(row?.playerTeam || '');
    const home = String(row?.homeTeam || '');
    const away = String(row?.awayTeam || '');
    const listedRank = Number(row?.dvpRating);
    if (!Number.isFinite(listedRank)) continue;
    const playerTeam = playerTeamRaw.trim()
      ? canonicalTeamKey(playerTeamRaw)
      : resolvePlayerTeam(player, home, away, posIndex);
    if (!playerTeam) {
      unresolvedTeam += 1;
      mismatches.push({
        player,
        statType,
        position: 'MID',
        playerTeam: '',
        opponent: '',
        listedRank,
        expectedRank: null,
        reason: 'unresolved_team',
      });
      continue;
    }

    const debugPos = String(row?._dvpPosition || '').toUpperCase().trim();
    const resolvedPos = resolvePosition(player, playerTeam, posIndex);
    const position = ['DEF', 'MID', 'FWD', 'RUC'].includes(debugPos) ? debugPos : (resolvedPos || 'MID');
    if (!['DEF', 'MID', 'FWD', 'RUC'].includes(debugPos) && !resolvedPos) {
      unresolved.push({ player, team: playerTeam, fallback: 'MID' });
    }

    const opponent =
      playerTeam === canonicalTeamKey(home) ? away :
      playerTeam === canonicalTeamKey(away) ? home :
      away;

    const metric = statType === 'goals_over' ? 'goals' : 'disposals';
    const payload = byPos[position] || byPos.MID;
    const ranks = payload?.metrics?.[metric]?.teamTotalRanks;
    const expectedRank = findValueByTeam(ranks, opponent);
    if (!Number.isFinite(expectedRank)) continue;

    checked += 1;
    if (Number(listedRank) !== Number(expectedRank)) {
      mismatches.push({
        player,
        statType,
        position,
        playerTeam,
        opponent,
        listedRank,
        expectedRank,
      });
    }
  }

  return { checked, mismatches, unresolved, unresolvedTeam };
}

async function main() {
  const season = Number(getArg('season', '2026'));
  const attempts = Number(getArg('attempts', '3'));
  const delayMs = Number(getArg('delay_ms', '15000'));
  const maxMismatches = Number(getArg('max_mismatches', '0'));
  const baseUrl = (getArg('base-url', process.env.PROD_URL || 'http://localhost:3000') || '')
    .trim()
    .replace(/\/+$/, '');

  if (!baseUrl) {
    throw new Error('Missing base URL. Set PROD_URL or pass --base-url=...');
  }

  let best = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const res = await validateOnce(baseUrl, season);
    best = res;
    console.log(
      `[attempt ${attempt}/${attempts}] checked=${res.checked} mismatches=${res.mismatches.length} unresolvedPosition=${res.unresolved.length} unresolvedTeam=${res.unresolvedTeam}`
    );
    if (res.mismatches.length <= maxMismatches) break;
    if (attempt < attempts) await sleep(delayMs);
  }

  const result = best || { checked: 0, mismatches: [], unresolved: [], unresolvedTeam: 0 };
  const sample = result.mismatches.slice(0, 25);
  if (sample.length > 0) {
    console.error('DVP mismatch sample (first 25):');
    console.error(JSON.stringify(sample, null, 2));
  }
  if (result.unresolved.length > 0) {
    const unique = [];
    const seen = new Set();
    for (const r of result.unresolved) {
      const k = `${r.player}|${r.team}`;
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(r);
    }
    console.log(`unresolved position matches: ${unique.length} (fallback MID)`);
  }

  if (result.mismatches.length > maxMismatches) {
    throw new Error(
      `AFL DvP consistency failed: mismatches=${result.mismatches.length} (allowed=${maxMismatches}) checked=${result.checked}`
    );
  }

  console.log(`✅ AFL DvP consistency passed: checked=${result.checked}, mismatches=${result.mismatches.length}, unresolvedTeam=${result.unresolvedTeam}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

