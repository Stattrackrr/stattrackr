#!/usr/bin/env npx tsx
/**
 * Repair World Cup 2026 player Total Shots + SOT in Supabase cache.
 *
 * BDL /match_shots only returns the first match when several match_ids[] are
 * batched in one request. This script re-fetches shots one match at a time,
 * rebuilds per-player shot event caches, and patches stat rows from /match_shots.
 *
 * Usage:
 *   npx tsx scripts/fix-world-cup-player-shots.ts
 *   npx tsx scripts/fix-world-cup-player-shots.ts --dry-run
 *   npx tsx scripts/fix-world-cup-player-shots.ts --playerId=29945
 *   npx tsx scripts/fix-world-cup-player-shots.ts --match=34 --concurrency=4
 *   npm run fix:world-cup:player-shots
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

for (const file of ['.env.local', '.env.development.local', '.env']) {
  const fullPath = path.resolve(process.cwd(), file);
  if (fs.existsSync(fullPath)) config({ path: fullPath, override: false });
}

const BDL_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';

type BdlMatch = {
  id?: number;
  status?: string;
  datetime?: string;
  home_team?: { id?: number; name?: string };
  away_team?: { id?: number; name?: string };
};

type PlayerBucket = {
  stats: Array<Record<string, unknown>>;
  shots: Array<Record<string, unknown>>;
};

function getArg(name: string, fallback = ''): string {
  const pref = `--${name}=`;
  const fromEq = process.argv.find((a) => a.startsWith(pref));
  if (fromEq) return fromEq.slice(pref.length).trim();
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1]!.startsWith('--')) {
    return process.argv[idx + 1]!.trim();
  }
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getApiKey(): string {
  return (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
}

async function bdlFetchAll<T>(
  endpoint: string,
  params: URLSearchParams,
  apiKey: string
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 12; page++) {
    const url = new URL(`${BDL_BASE}${endpoint}`);
    params.forEach((value, key) => url.searchParams.append(key, value));
    url.searchParams.set('per_page', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const auths = apiKey.startsWith('Bearer ')
      ? [apiKey, apiKey.replace(/^Bearer\s+/i, '').trim()]
      : [apiKey, `Bearer ${apiKey}`];

    let payload: { data?: T[]; meta?: { next_cursor?: string | null } } | null = null;
    for (const auth of auths) {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'StatTrackr/1.0', Authorization: auth },
        cache: 'no-store',
      });
      if (res.ok) {
        payload = (await res.json()) as typeof payload;
        break;
      }
      if (res.status !== 401) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`BDL ${endpoint} HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
    }
    if (!payload) throw new Error(`BDL ${endpoint} unauthorized`);

    rows.push(...(payload.data ?? []));
    cursor = payload.meta?.next_cursor != null ? String(payload.meta.next_cursor) : null;
    if (!cursor) break;
    await sleep(80);
  }
  return rows;
}

/** BDL ignores extra match_ids[] — always fetch one match per request. */
async function fetchMatchShots(matchId: number, apiKey: string): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams();
  params.append('match_ids[]', String(matchId));
  return bdlFetchAll<Record<string, unknown>>('/match_shots', params, apiKey);
}

async function fetchMatchPlayerStats(
  matchId: number,
  apiKey: string
): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams();
  params.append('match_ids[]', String(matchId));
  return bdlFetchAll<Record<string, unknown>>('/player_match_stats', params, apiKey);
}

function statRowKey(row: Record<string, unknown>): string {
  return `${row.match_id ?? ''}|${row.team_id ?? ''}|${row.player_id ?? ''}`;
}

function mergeStatRows(
  existing: Array<Record<string, unknown>>,
  incoming: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of [...existing, ...incoming]) {
    const key = statRowKey(row);
    if (!key.replace(/\|/g, '')) continue;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

function readShotsTotal(row: Record<string, unknown>): number | null {
  return (
    num(row.shots_total) ??
    num(row.derived_shots_total) ??
    num(row.total_shots) ??
    num(row.shots)
  );
}

function rowNeedsRepair(
  row: Record<string, unknown>,
  eventTotal: number,
  eventSot: number
): boolean {
  const minutes = num(row.minutes_played);
  if (minutes == null || minutes < 1) return false;
  if (eventTotal <= 0 && eventSot <= 0) return false;

  const total = readShotsTotal(row);
  const sot = num(row.shots_on_target) ?? 0;
  if (total !== eventTotal) return true;
  if (sot !== eventSot) return true;
  if (total != null && sot != null && total === sot && eventTotal > eventSot) return true;
  return false;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}

function mergeShotEvents(
  existing: Array<Record<string, unknown>>,
  incoming: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  const keyFor = (shot: Record<string, unknown>) =>
    String(
      shot.id ??
        `${shot.match_id}|${shot.player_id}|${shot.shot_type}|${shot.minute}|${shot.player_x}|${shot.player_y}`
    );
  for (const shot of [...existing, ...incoming]) {
    const key = keyFor(shot);
    if (!byKey.has(key)) byKey.set(key, shot);
  }
  return [...byKey.values()];
}

async function main() {
  const { getWorldCupCache, setWorldCupCache } = await import('../lib/worldCupCache');
  const { WC2026_CACHE_KEYS } = await import('../lib/worldCupOpponentBreakdown');
  const { applyWorldCupPlayerShotsToStatRows, buildWorldCupPlayerShotStatsByMatch } = await import(
    '../lib/worldCupPlayerShots'
  );

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('BALLDONTLIE_API_KEY is required.');
    process.exitCode = 1;
    return;
  }

  const dryRun = hasFlag('dry-run');
  const onlyPlayerId = getArg('playerId', '');
  const onlyMatchId = getArg('match', '');
  const concurrency = Math.max(1, Number.parseInt(getArg('concurrency', '5'), 10) || 5);
  const fetchStatsLive = hasFlag('fetch-stats');

  console.log('='.repeat(72));
  console.log('World Cup 2026 player shots / SOT cache repair');
  console.log('='.repeat(72));
  console.log(`dry-run: ${dryRun}`);
  console.log(`concurrency: ${concurrency}`);
  if (onlyPlayerId) console.log(`player filter: ${onlyPlayerId}`);
  if (onlyMatchId) console.log(`match filter: ${onlyMatchId}`);
  console.log('');

  const matches2026 =
    (await getWorldCupCache<BdlMatch[]>(WC2026_CACHE_KEYS.matches2026)) ?? [];
  if (!matches2026.length) {
    console.error('No wc:raw:matches:2026:v1 in cache — run build:world-cup:bdl-cache first.');
    process.exitCode = 1;
    return;
  }

  let completedIds = matches2026
    .filter((match) => match.status === 'completed' && Number.isFinite(match.id))
    .map((match) => Number(match.id));

  if (onlyMatchId && /^\d+$/.test(onlyMatchId)) {
    completedIds = completedIds.filter((id) => id === Number(onlyMatchId));
  }

  if (!completedIds.length) {
    console.log('No completed matches to process.');
    return;
  }

  console.log(`Processing ${completedIds.length} completed match(es)...`);

  const byPlayer = new Map<number, PlayerBucket>();
  const matchById = new Map(matches2026.map((match) => [Number(match.id), match]));

  let matchDetailsWritten = 0;
  let rowsRepaired = 0;
  let playersWritten = 0;
  const repairSamples: string[] = [];

  await mapWithConcurrency(completedIds, concurrency, async (matchId, index) => {
    const match = matchById.get(matchId);
    const label = match
      ? `${String(match.datetime ?? '').slice(0, 10)} ${match.home_team?.name ?? '?'} vs ${match.away_team?.name ?? '?'}`
      : `match ${matchId}`;

    let shots: Array<Record<string, unknown>> = [];
    try {
      shots = await fetchMatchShots(matchId, apiKey);
    } catch (err) {
      console.warn(`  [${index + 1}/${completedIds.length}] ${label} — shots fetch failed:`, err);
      return;
    }

    const detailKey = WC2026_CACHE_KEYS.matchDetail(matchId);
    const existingDetail =
      (await getWorldCupCache<{
        playerStats?: Array<Record<string, unknown>>;
        teamStats?: Array<Record<string, unknown>>;
        shots?: Array<Record<string, unknown>>;
        [key: string]: unknown;
      }>(detailKey)) ?? {};

    let playerStats = Array.isArray(existingDetail.playerStats) ? [...existingDetail.playerStats] : [];
    if (!playerStats.length || fetchStatsLive) {
      try {
        const liveStats = await fetchMatchPlayerStats(matchId, apiKey);
        if (liveStats.length) {
          playerStats = mergeStatRows(playerStats, liveStats);
        }
      } catch (err) {
        console.warn(`  [${index + 1}/${completedIds.length}] ${label} — stats fetch failed:`, err);
      }
    }

    const enrichedStats = playerStats.map((row) => ({
      ...row,
      source: row.source ?? 'bdl',
      tournament_slug: row.tournament_slug ?? 'worldcup',
      match_datetime: row.match_datetime ?? match?.datetime ?? null,
      match_home_team: row.match_home_team ?? match?.home_team ?? null,
      match_away_team: row.match_away_team ?? match?.away_team ?? null,
    }));

    for (const row of enrichedStats) {
      const pid = Number(row.player_id);
      if (!Number.isFinite(pid)) continue;
      if (onlyPlayerId && String(pid) !== onlyPlayerId) continue;

      const mid = Number(row.match_id);
      const { totals, onTarget } = buildWorldCupPlayerShotStatsByMatch(shots, String(pid));
      const eventTotal = totals.get(mid) ?? 0;
      const eventSot = onTarget.get(mid) ?? 0;
      if (rowNeedsRepair(row, eventTotal, eventSot)) {
        rowsRepaired += 1;
        if (repairSamples.length < 25) {
          const name = String((row.player as Record<string, unknown> | undefined)?.name ?? row.player_name ?? pid);
          repairSamples.push(
            `  ${name} | match ${mid} | shots ${readShotsTotal(row) ?? '?'}→${eventTotal} | sot ${num(row.shots_on_target) ?? '?'}→${eventSot}`
          );
        }
      }
    }

    const repairedStats = enrichedStats.map((row) => {
      const pid = String(row.player_id ?? '');
      const [applied] = applyWorldCupPlayerShotsToStatRows([row], shots, pid || null);
      return applied ?? row;
    });

    for (const row of repairedStats) {
      const pid = Number(row.player_id);
      if (!Number.isFinite(pid)) continue;
      if (onlyPlayerId && String(pid) !== onlyPlayerId) continue;

      const bucket = byPlayer.get(pid) ?? { stats: [], shots: [] };
      bucket.stats.push(row);
      byPlayer.set(pid, bucket);
    }

    for (const shot of shots) {
      const pid = Number(shot.player_id);
      if (!Number.isFinite(pid)) continue;
      if (onlyPlayerId && String(pid) !== onlyPlayerId) continue;
      const bucket = byPlayer.get(pid) ?? { stats: [], shots: [] };
      bucket.shots.push(shot);
      byPlayer.set(pid, bucket);
    }

    if (!dryRun) {
      const ok = await setWorldCupCache(detailKey, {
        ...existingDetail,
        playerStats: repairedStats,
        shots,
      });
      if (ok) matchDetailsWritten += 1;
    }

    const shotPlayers = new Set(shots.map((shot) => Number(shot.player_id)).filter(Number.isFinite));
    console.log(
      `  [${index + 1}/${completedIds.length}] ${label} | shots=${shots.length} players=${shotPlayers.size}`
    );

    await sleep(100);
  });

  console.log('\nWriting per-player caches...');

  const refreshedMatchSet = new Set(completedIds);

  for (const [playerId, bucket] of byPlayer) {
    if (onlyPlayerId && String(playerId) !== onlyPlayerId) continue;

    const shotsKey = WC2026_CACHE_KEYS.playerShots(playerId);
    const statsKey = WC2026_CACHE_KEYS.playerStats(playerId);

    const [existingShots, existingStats] = await Promise.all([
      getWorldCupCache<Array<Record<string, unknown>>>(shotsKey),
      getWorldCupCache<Array<Record<string, unknown>>>(statsKey),
    ]);

    const preservedShots = (existingShots ?? []).filter(
      (shot) => !refreshedMatchSet.has(Number(shot.match_id))
    );
    const mergedShots = mergeShotEvents(preservedShots, bucket.shots);

    const preservedStats = (existingStats ?? []).filter(
      (row) => !refreshedMatchSet.has(Number(row.match_id))
    );
    const mergedStats = mergeStatRows(preservedStats, mergeStatRows([], bucket.stats));
    const finalStats = applyWorldCupPlayerShotsToStatRows(mergedStats, mergedShots, String(playerId));

    if (dryRun) {
      playersWritten += 1;
      continue;
    }

    const [shotsOk, statsOk] = await Promise.all([
      setWorldCupCache(shotsKey, mergedShots),
      setWorldCupCache(statsKey, finalStats),
    ]);
    if (shotsOk && statsOk) playersWritten += 1;
  }

  console.log('\n' + '='.repeat(72));
  console.log('Summary');
  console.log('='.repeat(72));
  console.log(`Matches processed:     ${completedIds.length}`);
  console.log(`Match details written: ${matchDetailsWritten}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`Players updated:       ${playersWritten}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`Stat rows repaired:    ${rowsRepaired}`);
  console.log(`Shot events cached:    ${[...byPlayer.values()].reduce((sum, b) => sum + b.shots.length, 0)}`);

  if (repairSamples.length) {
    console.log('\nSample repairs (first 25):');
    for (const line of repairSamples) console.log(line);
  }

  const totalSot = [...byPlayer.values()].reduce((sum, bucket) => {
    const { onTarget } = buildWorldCupPlayerShotStatsByMatch(bucket.shots, null);
    for (const count of onTarget.values()) sum += count;
    return sum;
  }, 0);
  const totalShots = [...byPlayer.values()].reduce((sum, bucket) => sum + bucket.shots.length, 0);
  console.log(`\nAggregate from events: ${totalShots} shots, ${totalSot} on target across ${byPlayer.size} players.`);

  if (!dryRun && playersWritten === 0 && byPlayer.size > 0) {
    console.warn('\nWarning: no player caches were written — check Supabase credentials.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
