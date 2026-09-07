#!/usr/bin/env tsx
/**
 * Pull ATP/WTA singles match stats from API-Tennis into data/tennis/api-tennis/cache.json.
 * Usage: npx tsx scripts/fetch-api-tennis.ts
 */
import fs from 'fs';
import path from 'path';
import {
  API_TENNIS_EVENT,
  apiTennisCachePath,
  apiTennisDir,
  countryToIoc,
  mapApiFixtureToRows,
  type ApiPlayerInfo,
  type ApiTennisCache,
  type ApiTennisFixture,
  type ApiTennisPlayer,
  type ApiTennisStanding,
} from '../lib/tennis/apiTennis';
import { tennisHeadshotsIndexPath, type TennisHeadshotsIndex } from '../lib/tennis/headshots';
import type { TennisMatchRow, TennisRankingRow, TennisTour } from '../lib/tennis/types';

function loadKey(): string {
  const envPath = path.join(process.cwd(), '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  const m = text.match(/^API_TENNIS_KEY=["']?([^"'\r\n]+)["']?/m);
  const key = (m?.[1] || process.env.API_TENNIS_KEY || '').trim();
  if (!key) throw new Error('API_TENNIS_KEY missing from .env.local');
  return key;
}

const KEY = loadKey();
const BASE = 'https://api.api-tennis.com/tennis/';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiCall(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ APIkey: KEY, ...params });
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${BASE}?${qs.toString()}`, { headers: { Accept: 'application/json' } });
    if (res.status === 429 || res.status >= 500) {
      const wait = attempt * 1500;
      console.warn(`[api-tennis] HTTP ${res.status} — retry ${attempt} in ${wait}ms`);
      await sleep(wait);
      continue;
    }
    const json = await res.json();
    if (!json?.success && attempt < 4) {
      await sleep(attempt * 800);
      continue;
    }
    return json;
  }
  return null;
}

function monthRanges(fromYear: number, toDate: Date): Array<{ start: string; stop: string; label: string }> {
  const out: Array<{ start: string; stop: string; label: string }> = [];
  for (let year = fromYear; year <= toDate.getUTCFullYear(); year++) {
    const lastMonth = year === toDate.getUTCFullYear() ? toDate.getUTCMonth() + 1 : 12;
    for (let month = 1; month <= lastMonth; month++) {
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      let stopDay = lastDay;
      if (year === toDate.getUTCFullYear() && month === toDate.getUTCMonth() + 1) {
        stopDay = toDate.getUTCDate();
      }
      const stop = `${year}-${String(month).padStart(2, '0')}-${String(stopDay).padStart(2, '0')}`;
      out.push({ start, stop, label: `${year}-${String(month).padStart(2, '0')}` });
    }
  }
  return out;
}

function seedExistingLogos(players: Map<string, ApiPlayerInfo>) {
  try {
    const prevPath = apiTennisCachePath();
    if (fs.existsSync(prevPath)) {
      const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8')) as ApiTennisCache;
      for (const p of prev.players || []) {
        const existing = players.get(String(p.playerId));
        if (existing && !existing.imageUrl && p.imageUrl) existing.imageUrl = p.imageUrl;
      }
    }
  } catch {
    /* keep going with fixture logos */
  }
  try {
    const indexPath = tennisHeadshotsIndexPath();
    if (fs.existsSync(indexPath)) {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as TennisHeadshotsIndex;
      for (const [id, entry] of Object.entries(index.byPlayerId || {})) {
        const existing = players.get(id);
        if (existing && !existing.imageUrl && entry?.remoteUrl) existing.imageUrl = entry.remoteUrl;
      }
    }
  } catch {
    /* keep going with fixture logos */
  }
}

function standingToPlayer(row: ApiTennisStanding, tour: TennisTour): ApiPlayerInfo {
  const playerId = String(row.player_key);
  return {
    playerId,
    name: String(row.player || '').trim() || playerId,
    tour,
    ioc: countryToIoc(row.country),
    rank: Number(row.place) || null,
    rankPoints: Number(row.points) || null,
    imageUrl: null,
  };
}

function toRanking(row: ApiTennisStanding, tour: TennisTour): TennisRankingRow {
  return {
    pos: Number(row.place) || 0,
    playerId: String(row.player_key),
    name: String(row.player || '').trim(),
    tour,
    points: Number(row.points) || null,
    ioc: countryToIoc(row.country),
  };
}

function holeMonthKeys(matches: TennisMatchRow[]): Array<{ tour: TennisTour; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ tour: TennisTour; label: string }> = [];
  for (const row of matches) {
    const missingPct =
      (row.breakPointsConverted != null && row.breakPointsConvertedPct == null) ||
      (row.breakPointsSaved != null && row.breakPointsSavedPct == null);
    if (!missingPct) continue;
    const label = String(row.date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(label)) continue;
    const key = `${row.tour}:${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tour: row.tour, label });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label) || a.tour.localeCompare(b.tour));
}

function rangeForMonth(label: string, today: Date): { start: string; stop: string; label: string } {
  const [year, month] = label.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let stopDay = lastDay;
  if (year === today.getUTCFullYear() && month === today.getUTCMonth() + 1) {
    stopDay = today.getUTCDate();
  }
  return {
    start: `${label}-01`,
    stop: `${label}-${String(stopDay).padStart(2, '0')}`,
    label,
  };
}

async function repairBreakPointFractions() {
  const prevPath = apiTennisCachePath();
  if (!fs.existsSync(prevPath)) {
    throw new Error('No API-Tennis cache to repair. Run a full fetch first.');
  }
  const cache = JSON.parse(fs.readFileSync(prevPath, 'utf8')) as ApiTennisCache;
  const holes = holeMonthKeys(cache.matches || []);
  if (!holes.length) {
    console.log('[api-tennis] no break-point fraction holes to repair');
    return;
  }

  const players = new Map<string, ApiPlayerInfo>();
  for (const p of cache.players || []) {
    players.set(p.playerId, {
      playerId: p.playerId,
      name: p.name,
      tour: p.tour,
      ioc: p.ioc,
      rank: p.rank,
      rankPoints: p.rankPoints,
      imageUrl: p.imageUrl ?? null,
    });
  }

  const today = new Date();
  const byId = new Map((cache.matches || []).map((row) => [row.matchId, row]));
  let fixtureCount = 0;
  let replaced = 0;

  console.log(`[api-tennis] repairing ${holes.length} month/tour slices with missing BP %`);
  for (const hole of holes) {
    const range = rangeForMonth(hole.label, today);
    const eventType = hole.tour === 'ATP' ? API_TENNIS_EVENT.ATP_SINGLES : API_TENNIS_EVENT.WTA_SINGLES;
    const json = await apiCall({
      method: 'get_fixtures',
      date_start: range.start,
      date_stop: range.stop,
      event_type_key: eventType,
    });
    const fixtures = (Array.isArray(json?.result) ? json.result : []) as ApiTennisFixture[];
    fixtureCount += fixtures.length;
    let monthReplaced = 0;
    for (const fx of fixtures) {
      for (const row of mapApiFixtureToRows(fx, players)) {
        const prev = byId.get(row.matchId);
        if (prev && prev.breakPointsConvertedPct == null && row.breakPointsConvertedPct != null) {
          monthReplaced += 1;
        }
        byId.set(row.matchId, row);
      }
    }
    replaced += monthReplaced;
    console.log(
      `[api-tennis] repair ${hole.tour} ${range.label}: fixtures=${fixtures.length} newlyFilledBpPct=${monthReplaced}`
    );
    await sleep(120);
  }

  cache.matches = [...byId.values()];
  cache.fetchedAt = new Date().toISOString();
  fs.writeFileSync(prevPath, JSON.stringify(cache));
  const mb = (fs.statSync(prevPath).size / (1024 * 1024)).toFixed(1);
  const stillHoles = cache.matches.filter(
    (row) =>
      (row.breakPointsConverted != null && row.breakPointsConvertedPct == null) ||
      (row.breakPointsSaved != null && row.breakPointsSavedPct == null)
  ).length;
  console.log(
    `[api-tennis] repaired ${prevPath} (${mb} MB) fixtures=${fixtureCount} filled=${replaced} remainingHoles=${stillHoles}`
  );
}

async function main() {
  if (process.argv.includes('--repair')) {
    await repairBreakPointFractions();
    return;
  }

  const today = new Date();
  const ranges = monthRanges(2024, today);
  console.log(`[api-tennis] fetching ATP + WTA singles ${ranges[0]?.start} .. ${ranges.at(-1)?.stop}`);
  console.log(`[api-tennis] ${ranges.length} months × 2 tours = ${ranges.length * 2} fixture calls`);

  const atpStandingsJson = await apiCall({ method: 'get_standings', event_type: 'ATP' });
  const wtaStandingsJson = await apiCall({ method: 'get_standings', event_type: 'WTA' });
  const atpStandings = (Array.isArray(atpStandingsJson?.result) ? atpStandingsJson.result : []) as ApiTennisStanding[];
  const wtaStandings = (Array.isArray(wtaStandingsJson?.result) ? wtaStandingsJson.result : []) as ApiTennisStanding[];
  console.log(`[api-tennis] standings ATP=${atpStandings.length} WTA=${wtaStandings.length}`);

  const players = new Map<string, ApiPlayerInfo>();
  for (const row of atpStandings) players.set(String(row.player_key), standingToPlayer(row, 'ATP'));
  for (const row of wtaStandings) players.set(String(row.player_key), standingToPlayer(row, 'WTA'));

  const tours: Array<{ tour: TennisTour; eventType: string }> = [
    { tour: 'ATP', eventType: API_TENNIS_EVENT.ATP_SINGLES },
    { tour: 'WTA', eventType: API_TENNIS_EVENT.WTA_SINGLES },
  ];

  const matches: TennisMatchRow[] = [];
  const seen = new Set<string>();
  let fixtureCount = 0;
  let mapped = 0;

  for (const { tour, eventType } of tours) {
    for (const range of ranges) {
      const json = await apiCall({
        method: 'get_fixtures',
        date_start: range.start,
        date_stop: range.stop,
        event_type_key: eventType,
      });
      const fixtures = (Array.isArray(json?.result) ? json.result : []) as ApiTennisFixture[];
      fixtureCount += fixtures.length;
      for (const fx of fixtures) {
        const firstId = String(fx.first_player_key ?? '');
        const secondId = String(fx.second_player_key ?? '');
        if (firstId && fx.event_first_player_logo) {
          const existing = players.get(firstId);
          if (existing && !existing.imageUrl) existing.imageUrl = fx.event_first_player_logo;
          if (!existing) {
            players.set(firstId, {
              playerId: firstId,
              name: String(fx.event_first_player || firstId),
              tour,
              ioc: null,
              rank: null,
              rankPoints: null,
              imageUrl: fx.event_first_player_logo || null,
            });
          }
        }
        if (secondId && fx.event_second_player_logo) {
          const existing = players.get(secondId);
          if (existing && !existing.imageUrl) existing.imageUrl = fx.event_second_player_logo;
          if (!existing) {
            players.set(secondId, {
              playerId: secondId,
              name: String(fx.event_second_player || secondId),
              tour,
              ioc: null,
              rank: null,
              rankPoints: null,
              imageUrl: fx.event_second_player_logo || null,
            });
          }
        }
        for (const row of mapApiFixtureToRows(fx, players)) {
          if (seen.has(row.matchId)) continue;
          seen.add(row.matchId);
          matches.push(row);
          mapped += 1;
        }
      }
      console.log(
        `[api-tennis] ${tour} ${range.label}: fixtures=${fixtures.length} rows=${mapped}`
      );
      await sleep(120);
    }
  }

  seedExistingLogos(players);

  const playerList: ApiTennisPlayer[] = [...players.values()]
    .map((p) => ({
      playerId: p.playerId,
      name: p.name,
      tour: p.tour,
      ioc: p.ioc,
      hand: null,
      height: null,
      rank: p.rank,
      rankPoints: p.rankPoints,
      imageUrl: p.imageUrl,
    }))
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.name.localeCompare(b.name));

  const cache: ApiTennisCache = {
    fetchedAt: new Date().toISOString(),
    source: 'api-tennis',
    matches,
    players: playerList,
    standings: {
      ATP: atpStandings.map((row) => toRanking(row, 'ATP')),
      WTA: wtaStandings.map((row) => toRanking(row, 'WTA')),
    },
  };

  fs.mkdirSync(apiTennisDir(), { recursive: true });
  const out = apiTennisCachePath();
  fs.writeFileSync(out, JSON.stringify(cache));
  const mb = (fs.statSync(out).size / (1024 * 1024)).toFixed(1);
  const withAces = matches.filter((m) => m.aces != null).length;
  console.log(
    `[api-tennis] wrote ${out} (${mb} MB) fixtures=${fixtureCount} playerRows=${matches.length} withServeStats=${withAces} players=${playerList.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
