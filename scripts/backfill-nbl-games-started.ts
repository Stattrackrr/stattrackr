#!/usr/bin/env tsx
/**
 * Backfill `gamesStarted` onto existing nbl-league-player-stats-{year}.json files.
 * Usage: npx tsx scripts/backfill-nbl-games-started.ts --year=2025
 */
import fs from 'fs';
import path from 'path';
import {
  fetchNblPlayerSeasonStats,
  pickPlayerSeasonStatsForYear,
} from '../lib/nbl/rosettaPlayer';

const year = Number(
  process.argv.find((a) => a.startsWith('--year='))?.slice(7) ||
    process.argv.find((a) => a.startsWith('--season='))?.slice(9) ||
    2025
);

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run())
  );
  return results;
}

async function main() {
  const file = path.join(process.cwd(), 'data', `nbl-league-player-stats-${year}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const payload = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    players: Array<Record<string, unknown>>;
    [k: string]: unknown;
  };
  const players = payload.players || [];
  console.log(`Backfilling gamesStarted for ${players.length} players (${year})…`);

  let done = 0;
  const updated = await mapPool(players, 8, async (p, index) => {
    const playerId = String(p.playerId || '');
    let gamesStarted = Number(p.gamesStarted) || 0;
    if (playerId) {
      const rows = await fetchNblPlayerSeasonStats(playerId);
      const season = pickPlayerSeasonStatsForYear(rows, year, 'regular');
      if (season?.games_started != null) gamesStarted = Number(season.games_started) || 0;
      else if (season?.games != null && p.gamesStarted == null) gamesStarted = 0;
    }
    done += 1;
    if (done % 25 === 0 || done === players.length) {
      console.log(`  … ${done}/${players.length}`);
    }
    return { ...p, gamesStarted };
  });

  payload.players = updated;
  payload.generatedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
