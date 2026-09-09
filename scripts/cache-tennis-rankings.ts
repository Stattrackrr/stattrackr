#!/usr/bin/env tsx
/**
 * Compile match-day ranking history onto API-Tennis player ids.
 *
 * Sources (rankings-only; no match CSVs):
 * - Tennismylife official ATP CSVs (2024–2025) + TML 2026 (early January)
 * - Sackmann ranking archives (ATP+WTA weekly, deep lists through 2026-06-08)
 * - ATP Rankings Database weekly top-100 JSON (Mondays through 2026-08-31)
 * - Tennis Explorer weekly top-400 for post-Sackmann weeks (ATP+WTA)
 * - API-Tennis current standings stamped as this ranking week's Monday
 *
 * Usage: npx tsx scripts/cache-tennis-rankings.ts
 */
import { loadApiTennisCache } from '../lib/tennis/apiTennis';
import { compactTennisName, foldTennisName, tennisNameTokenKey } from '../lib/tennis/hands';
import { tennisRankHistoryPath, type TennisRankHistoryCache } from '../lib/tennis/rankHistory';
import fs from 'fs';
import path from 'path';
import {
  loadAtpWeeksApi,
  loadSackmannRankings,
  loadTennisExplorerWeeks,
  loadTmlOfficialYear,
  loadTmlRankings2026,
  mondaysBetween,
  rankingWeekMondayInt,
  type RankRow,
} from './tennis-rank-sources';

type NameIndex = {
  byFold: Map<string, string>;
  byCompact: Map<string, string | 'conflict'>;
  byTokens: Map<string, string | 'conflict'>;
  byLast: Map<string, string | 'conflict'>;
};

function setOrConflict(map: Map<string, string | 'conflict'>, key: string | null, id: string) {
  if (!key) return;
  const existing = map.get(key);
  if (!existing) map.set(key, id);
  else if (existing !== id) map.set(key, 'conflict');
}

function buildNameIndex(players: Array<{ playerId: string; name: string }>): NameIndex {
  const index: NameIndex = {
    byFold: new Map(),
    byCompact: new Map(),
    byTokens: new Map(),
    byLast: new Map(),
  };
  for (const p of players) {
    const fold = foldTennisName(p.name);
    if (fold) {
      const existing = index.byFold.get(fold);
      if (existing && existing !== p.playerId) index.byFold.delete(fold);
      else index.byFold.set(fold, p.playerId);
    }
    setOrConflict(index.byCompact, compactTennisName(p.name) || null, p.playerId);
    setOrConflict(index.byTokens, tennisNameTokenKey(p.name), p.playerId);
    const parts = fold.split(' ').filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.length >= 5) setOrConflict(index.byLast, last, p.playerId);
  }
  return index;
}

function resolveName(index: NameIndex, name: string, allowLast: boolean): string | null {
  const fold = foldTennisName(name);
  if (!fold) return null;
  const exact = index.byFold.get(fold);
  if (exact) return exact;
  const compact = index.byCompact.get(compactTennisName(name));
  if (compact && compact !== 'conflict') return compact;
  const tokens = index.byTokens.get(tennisNameTokenKey(name) || '');
  if (tokens && tokens !== 'conflict') return tokens;
  if (allowLast) {
    const parts = fold.split(' ').filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.length >= 5) {
      const hit = index.byLast.get(last);
      if (hit && hit !== 'conflict') return hit;
    }
  }
  return null;
}

function flipLastFirst(name: string): string {
  const parts = foldTennisName(name).split(' ').filter(Boolean);
  if (parts.length < 2) return name;
  return [...parts.slice(1), parts[0]].join(' ');
}

function resolveExternal(index: NameIndex, name: string): string | null {
  const direct = resolveName(index, name, false);
  if (direct) return direct;
  const flipped = flipLastFirst(name);
  if (flipped && flipped !== foldTennisName(name)) {
    const hit = resolveName(index, flipped, true);
    if (hit) return hit;
  }
  return resolveName(index, name, true);
}

function addPoint(
  byId: Map<string, Map<number, { rank: number; points: number }>>,
  playerId: string,
  date: number,
  rank: number,
  points: number
) {
  if (!playerId || !date || !rank) return;
  let series = byId.get(playerId);
  if (!series) {
    series = new Map();
    byId.set(playerId, series);
  }
  series.set(date, { rank, points });
}

function ingestRows(
  label: string,
  rows: RankRow[],
  index: NameIndex,
  byId: Map<string, Map<number, { rank: number; points: number }>>,
  dates: Set<number>
) {
  let mapped = 0;
  for (const row of rows) {
    const id = resolveExternal(index, row.name);
    if (!id) continue;
    addPoint(byId, id, row.date, row.rank, row.points);
    dates.add(row.date);
    mapped += 1;
  }
  console.log(`[ranks] ${label} rows=${rows.length} mapped=${mapped}`);
}

function writeCache(byId: Map<string, Map<number, { rank: number; points: number }>>, source: string) {
  const byPlayerId: Record<string, number[]> = {};
  for (const [id, series] of byId) {
    const dates = [...series.keys()].sort((a, b) => a - b);
    const flat: number[] = [];
    for (const d of dates) {
      const pt = series.get(d);
      if (!pt) continue;
      flat.push(d, pt.rank, pt.points);
    }
    if (flat.length) byPlayerId[id] = flat;
  }
  const out: TennisRankHistoryCache = {
    fetchedAt: new Date().toISOString(),
    source,
    mapped: Object.keys(byPlayerId).length,
    byPlayerId,
  };
  fs.mkdirSync(path.dirname(tennisRankHistoryPath()), { recursive: true });
  fs.writeFileSync(tennisRankHistoryPath(), JSON.stringify(out));
  const mb = (fs.statSync(tennisRankHistoryPath()).size / (1024 * 1024)).toFixed(1);
  console.log(`[ranks] wrote ${tennisRankHistoryPath()} (${mb} MB) players=${out.mapped}`);
}

function rankOn(
  byId: Map<string, Map<number, { rank: number; points: number }>>,
  playerId: string | null,
  date: number
): { rank: number; points: number; date: number } | null {
  if (!playerId) return null;
  const series = byId.get(playerId);
  if (!series?.size) return null;
  let best: { rank: number; points: number; date: number } | null = null;
  for (const [d, pt] of series) {
    if (d <= date && (!best || d > best.date)) best = { rank: pt.rank, points: pt.points, date: d };
  }
  return best;
}

function yearDateCount(byId: Map<string, Map<number, { rank: number; points: number }>>, playerId: string | null, year: number) {
  if (!playerId) return 0;
  const series = byId.get(playerId);
  if (!series) return 0;
  const lo = year * 10000 + 101;
  const hi = year * 10000 + 1231;
  return [...series.keys()].filter((d) => d >= lo && d <= hi).length;
}

function findPlayerId(players: Array<{ playerId: string; name: string; tour: string }>, name: string, tour: string): string | null {
  const index = buildNameIndex(players.filter((p) => p.tour === tour).map((p) => ({ playerId: p.playerId, name: p.name })));
  return resolveExternal(index, name);
}

function summarizeDates(dates: Set<number>, year: number) {
  const inYear = [...dates].filter((d) => Math.floor(d / 10000) === year).sort((a, b) => a - b);
  return {
    count: inYear.length,
    first: inYear[0] ?? null,
    last: inYear[inYear.length - 1] ?? null,
  };
}

function printVerify(
  cache: NonNullable<ReturnType<typeof loadApiTennisCache>>,
  byId: Map<string, Map<number, { rank: number; points: number }>>,
  atpDates: Set<number>,
  wtaDates: Set<number>
) {
  const alcaraz = findPlayerId(cache.players, 'Carlos Alcaraz', 'ATP');
  const rinderknech = findPlayerId(cache.players, 'Arthur Rinderknech', 'ATP');
  const paul = findPlayerId(cache.players, 'Tommy Paul', 'ATP');
  const rybakina = findPlayerId(cache.players, 'Elena Rybakina', 'WTA');

  const iw = rankOn(byId, alcaraz, 20260310);
  const iwOpp = rankOn(byId, rinderknech, 20260310);
  const uso = rankOn(byId, alcaraz, 20260906);
  const usoOpp = rankOn(byId, paul, 20260906);

  const wtaIw = rankOn(byId, rybakina, 20260310);
  const wtaMatch = (cache.matches || []).find(
    (m) =>
      m.tour === 'WTA' &&
      m.date &&
      m.date >= '2026-03-01' &&
      m.date <= '2026-03-20' &&
      (foldTennisName(m.playerName).includes('rybakina') || foldTennisName(m.opponent || '').includes('rybakina'))
  );
  const wtaMatchDay = wtaMatch?.date ? Number(wtaMatch.date.replace(/-/g, '').slice(0, 8)) : 20260310;
  const wtaMatchRank = rankOn(byId, rybakina, wtaMatchDay);

  console.log('\n========== RANK VERIFICATION ==========');
  const atp2026 = summarizeDates(atpDates, 2026);
  const wta2026 = summarizeDates(wtaDates, 2026);
  console.log(`ATP 2026 weeks: first=${atp2026.first} last=${atp2026.last} count=${atp2026.count}`);
  console.log(`WTA 2026 weeks: first=${wta2026.first} last=${wta2026.last} count=${wta2026.count}`);
  console.log(`Alcaraz 2026 series dates: ${yearDateCount(byId, alcaraz, 2026)} (id=${alcaraz})`);
  console.log(`Rybakina 2026 series dates: ${yearDateCount(byId, rybakina, 2026)} (id=${rybakina})`);
  console.log(
    `ATP Indian Wells 2026-03-10 Alcaraz vs Rinderknech: ${iw?.rank ?? 'none'} (from ${iw?.date}) vs ${iwOpp?.rank ?? 'none'} (from ${iwOpp?.date})`
  );
  console.log(
    `ATP US Open 2026-09-06 Alcaraz vs Paul: ${uso?.rank ?? 'none'} (from ${uso?.date}) vs ${usoOpp?.rank ?? 'none'} (from ${usoOpp?.date})`
  );
  console.log(`WTA 2026-03-10 Rybakina: ${wtaIw?.rank ?? 'none'} (from ${wtaIw?.date}) — weekly, not 20260101`);
  if (wtaMatch?.date) {
    console.log(
      `WTA ${wtaMatch.date} ${wtaMatch.tourneyName} Rybakina: ${wtaMatchRank?.rank ?? 'none'} (from ${wtaMatchRank?.date})`
    );
  }
  console.log('=======================================\n');
}

async function main() {
  const cache = loadApiTennisCache();
  if (!cache?.players?.length) throw new Error('API-Tennis cache missing. Run npm run fetch:tennis:api first.');

  const atpIndex = buildNameIndex(cache.players.filter((p) => p.tour === 'ATP').map((p) => ({ playerId: p.playerId, name: p.name })));
  const wtaIndex = buildNameIndex(cache.players.filter((p) => p.tour === 'WTA').map((p) => ({ playerId: p.playerId, name: p.name })));
  const byId = new Map<string, Map<number, { rank: number; points: number }>>();
  const atpDates = new Set<number>();
  const wtaDates = new Set<number>();
  const minDate = 20240101;
  const maxHist = 20260831;

  console.log('[ranks] Sackmann ATP rankings (rankings-only archive)');
  ingestRows('sackmann-atp', await loadSackmannRankings('atp', minDate, maxHist), atpIndex, byId, atpDates);
  console.log('[ranks] Sackmann WTA rankings (rankings-only archive)');
  ingestRows('sackmann-wta', await loadSackmannRankings('wta', minDate, maxHist), wtaIndex, byId, wtaDates);

  console.log('[ranks] TML official ATP 2024/2025');
  ingestRows('tml-official-2024', await loadTmlOfficialYear(2024), atpIndex, byId, atpDates);
  ingestRows('tml-official-2025', await loadTmlOfficialYear(2025), atpIndex, byId, atpDates);
  ingestRows('tml-2026', await loadTmlRankings2026(), atpIndex, byId, atpDates);

  console.log('[ranks] ATP weekly top-100 JSON');
  ingestRows('atp-weeks-api', await loadAtpWeeksApi(minDate, maxHist), atpIndex, byId, atpDates);

  const teDates = mondaysBetween(20260615, maxHist);
  console.log(`[ranks] Tennis Explorer post-Sackmann weeks: ${teDates.length}`);
  ingestRows('te-atp', await loadTennisExplorerWeeks({ tour: 'atp', dates: teDates, pages: 8 }), atpIndex, byId, atpDates);
  ingestRows('te-wta', await loadTennisExplorerWeeks({ tour: 'wta', dates: teDates, pages: 8 }), wtaIndex, byId, wtaDates);

  const monday = rankingWeekMondayInt();
  for (const p of cache.players) {
    if (p.rank != null && p.rank > 0) {
      addPoint(byId, p.playerId, monday, p.rank, p.rankPoints || 0);
      if (p.tour === 'ATP') atpDates.add(monday);
      if (p.tour === 'WTA') wtaDates.add(monday);
    }
  }
  console.log(`[ranks] current standings snapshot dated ranking-week Monday ${monday}`);

  const source =
    'sackmann-rankings+tml-official-atp+atp-weeks-api+tennisexplorer+api-tennis-monday';
  writeCache(byId, source);
  printVerify(cache, byId, atpDates, wtaDates);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
