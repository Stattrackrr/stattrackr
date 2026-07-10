/**
 * Re-rank and refresh upcoming R18 soft-locked top picks with prior-round same-side ban.
 * Run: node scripts/refresh-soft-lock-top-picks.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HISTORY_PATH = path.join(ROOT, 'data/afl-model/history/top-picks-history.json');
const PROJ_PATH = path.join(ROOT, 'data/afl-model/latest-disposals-projections.json');
const TOP_PICKS_MAX_SAME_SIDE = 2;

const AFL_2026_ROUND_WINDOWS = [
  { key: '2026-R14', start: '2026-06-11', end: '2026-06-15' },
  { key: '2026-R15', start: '2026-06-18', end: '2026-06-22' },
  { key: '2026-R16', start: '2026-06-25', end: '2026-06-29' },
  { key: '2026-R17', start: '2026-07-02', end: '2026-07-06' },
  { key: '2026-R18', start: '2026-07-09', end: '2026-07-13' },
  { key: '2026-R19', start: '2026-07-16', end: '2026-07-20' },
];

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeTeam(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function calendarRoundKey(commenceTime) {
  const date = String(commenceTime ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  for (const w of AFL_2026_ROUND_WINDOWS) {
    if (date >= w.start && date <= w.end) return w.key;
  }
  return null;
}

function playerSideKey(playerName, side) {
  const playerKey = normalizeName(playerName);
  const sideKey = String(side ?? '').trim().toUpperCase();
  if (!playerKey || (sideKey !== 'OVER' && sideKey !== 'UNDER')) return null;
  return `${playerKey}|${sideKey}`;
}

function parseRoundKey(roundKey) {
  const m = String(roundKey ?? '').trim().match(/^(\d{4})-R(\d{1,2})$/i);
  if (!m) return null;
  return { season: Number(m[1]), round: Number(m[2]) };
}

function sortRoundKeys(keys) {
  return [...keys].sort((a, b) => {
    const ar = parseRoundKey(a);
    const br = parseRoundKey(b);
    if (!ar && !br) return a.localeCompare(b);
    if (!ar) return 1;
    if (!br) return -1;
    if (ar.season !== br.season) return ar.season - br.season;
    return ar.round - br.round;
  });
}

function priorRoundKey(currentRoundKey, historyRoundKeys) {
  const current = parseRoundKey(currentRoundKey);
  if (!current) return null;
  const prior = sortRoundKeys(historyRoundKeys).filter((key) => {
    const p = parseRoundKey(key);
    if (!p) return false;
    if (p.season !== current.season) return p.season < current.season;
    return p.round < current.round;
  });
  return prior[prior.length - 1] ?? null;
}

function buildBlockedSet(records, currentRoundKey) {
  const historyRoundKeys = sortRoundKeys([...new Set(records.map((r) => r.roundKey).filter(Boolean))]);
  const prior = priorRoundKey(currentRoundKey, historyRoundKeys);
  const blocked = new Set();
  if (!prior) return blocked;
  for (const rec of records) {
    if (rec.roundKey !== prior) continue;
    for (const pick of rec.picks ?? []) {
      const key = playerSideKey(pick.playerName, pick.recommendedSide);
      if (key) blocked.add(key);
    }
  }
  return blocked;
}

function gameKey(home, away, commenceTime) {
  return `${normalizeTeam(home)}|${normalizeTeam(away)}|${String(commenceTime ?? '').slice(0, 10)}`;
}

function rankTop3(rows, blocked) {
  const candidates = rows
    .filter((row) => {
      const side = row.recommendedSide;
      return (
        (side === 'OVER' || side === 'UNDER') &&
        typeof row.recommendedEdge === 'number' &&
        Number.isFinite(row.recommendedEdge) &&
        typeof row.recommendedProb === 'number' &&
        Number.isFinite(row.recommendedProb) &&
        row.isRecommendedPick !== false
      );
    })
    .sort((a, b) => {
      if (b.recommendedEdge !== a.recommendedEdge) return b.recommendedEdge - a.recommendedEdge;
      if (b.recommendedProb !== a.recommendedProb) return b.recommendedProb - a.recommendedProb;
      return String(a.playerName ?? '').localeCompare(String(b.playerName ?? ''));
    });

  const selected = [];
  const seen = new Set();
  let overCt = 0;
  let underCt = 0;
  for (const row of candidates) {
    if (selected.length >= 3) break;
    const side = row.recommendedSide;
    const pk = normalizeName(row.playerName);
    if (!pk || seen.has(pk)) continue;
    const bk = playerSideKey(pk, side);
    if (bk && blocked.has(bk)) continue;
    if (side === 'OVER' && overCt >= TOP_PICKS_MAX_SAME_SIDE) continue;
    if (side === 'UNDER' && underCt >= TOP_PICKS_MAX_SAME_SIDE) continue;
    selected.push(row);
    seen.add(pk);
    if (side === 'OVER') overCt += 1;
    else underCt += 1;
  }
  return selected;
}

function isUpcoming(commenceTime) {
  const t = commenceTime ? Date.parse(commenceTime) : NaN;
  return Number.isFinite(t) ? t > Date.now() : true;
}

function hasActuals(record) {
  return (record.picks ?? []).some((p) => typeof p.actualDisposals === 'number');
}

const history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
const proj = JSON.parse(fs.readFileSync(PROJ_PATH, 'utf8'));
const records = Array.isArray(history.records) ? history.records : [];
const rows = Array.isArray(proj.rows) ? proj.rows : [];

const rowsByGame = new Map();
for (const row of rows) {
  if (row.isRecommendedPick === false) continue;
  const gk = gameKey(row.homeTeam, row.awayTeam, row.commenceTime);
  if (!rowsByGame.has(gk)) rowsByGame.set(gk, []);
  rowsByGame.get(gk).push(row);
}

let refreshed = 0;
const byGame = new Map(records.map((r) => [r.gameKey, r]));

for (const [gk, gameRows] of rowsByGame.entries()) {
  const existing = byGame.get(gk);
  if (existing && !isUpcoming(existing.commenceTime) && hasActuals(existing)) continue;
  const roundKey = calendarRoundKey(gameRows[0]?.commenceTime);
  const blocked = buildBlockedSet(records, roundKey);
  const selected = rankTop3(gameRows, blocked);
  if (selected.length === 0) continue;

  const preserved = new Map();
  if (existing) {
    for (const p of existing.picks ?? []) {
      if (typeof p.actualDisposals === 'number') preserved.set(normalizeName(p.playerName), p.actualDisposals);
    }
  }

  const meta = selected[0];
  const incoming = {
    gameKey: gk,
    finalizedAt: existing?.finalizedAt ?? new Date().toISOString(),
    windowHours: existing?.windowHours ?? 2,
    projectionGeneratedAt: proj.generatedAt ?? existing?.projectionGeneratedAt ?? null,
    modelVersion: proj.modelVersion ?? existing?.modelVersion ?? null,
    homeTeam: meta.homeTeam,
    awayTeam: meta.awayTeam,
    commenceTime: meta.commenceTime,
    weekKey: existing?.weekKey ?? null,
    roundKey,
    picks: selected.map((row, idx) => ({
      playerName: String(row.playerName ?? '').trim(),
      bookmaker: row.bookmaker != null ? String(row.bookmaker) : null,
      line: typeof row.line === 'number' ? row.line : null,
      expectedDisposals: typeof row.expectedDisposals === 'number' ? row.expectedDisposals : null,
      recommendedSide: row.recommendedSide,
      recommendedEdge: row.recommendedEdge,
      recommendedProb: row.recommendedProb,
      rank: idx + 1,
      actualDisposals: preserved.get(normalizeName(row.playerName)) ?? null,
    })),
  };
  byGame.set(gk, incoming);
  refreshed += 1;
}

const nextRecords = [...byGame.values()].sort((a, b) =>
  String(a.commenceTime ?? '').localeCompare(String(b.commenceTime ?? ''))
);
fs.writeFileSync(
  HISTORY_PATH,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), count: nextRecords.length, records: nextRecords }, null, 2)}\n`
);
console.log(`refreshed=${refreshed} total=${nextRecords.length}`);
const col = nextRecords.find((r) => r.gameKey.includes('collingwood') && r.gameKey.includes('2026-07-10'));
console.log('Collingwood picks:', (col?.picks ?? []).map((p) => `${p.playerName}:${p.recommendedSide}`).join(' | '));
