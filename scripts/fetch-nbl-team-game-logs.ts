#!/usr/bin/env tsx
/**
 * Ingest NBL quarter scores from SportRadar → data/nbl-model/cache/period-scores/{year}.json
 * Usage:
 *   npx tsx scripts/fetch-nbl-team-game-logs.ts
 *   npx tsx scripts/fetch-nbl-team-game-logs.ts --year=2025
 *   npx tsx scripts/fetch-nbl-team-game-logs.ts --force
 */
import {
  completedNblScheduleGames,
  loadNblPeriodScoreCache,
  writeNblPeriodScoreCache,
  type NblPeriodScoreCacheEntry,
} from '../lib/nbl/teamGameLogs';
import { fetchNblMatchPeriodScores } from '../lib/nbl/sportRadarPeriods';
import { NBL_CHART_HISTORY_YEARS } from '../lib/nblTeamCanonical';

const yearArg = process.argv.find((arg) => arg.startsWith('--year='))?.slice(7);
const force = process.argv.includes('--force');
const concurrency = Math.max(
  1,
  Number(process.argv.find((arg) => arg.startsWith('--concurrency='))?.slice(14) || 4)
);

function yearsToRun(): number[] {
  if (yearArg) {
    const y = Number(yearArg);
    if (!Number.isFinite(y)) throw new Error(`Invalid --year=${yearArg}`);
    return [y];
  }
  return [...NBL_CHART_HISTORY_YEARS];
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const years = yearsToRun();
  for (const year of years) {
    const completed = completedNblScheduleGames([year]);
    const existing = force ? {} : loadNblPeriodScoreCache(year);
    const missing = completed.filter(({ game }) => {
      const id = String(game.id || game.externalId || '').trim();
      return id && !existing[id];
    });

    console.log(
      `[nbl periods] ${year}: ${completed.length} completed, ${Object.keys(existing).length} cached, ${missing.length} to fetch`
    );

    const next: Record<string, NblPeriodScoreCacheEntry> = { ...existing };
    let ok = 0;
    let fail = 0;

    await mapPool(missing, concurrency, async ({ game }, index) => {
      const id = String(game.id || game.externalId || '').trim();
      if (index > 0 && index % concurrency === 0) await sleep(120);
      const scores = await fetchNblMatchPeriodScores(id);
      if (!scores) {
        fail += 1;
        console.warn(`  miss ${id} (${game.homeTeam} vs ${game.awayTeam})`);
        return;
      }
      next[id] = {
        home_q1: scores.home_q1,
        home_q2: scores.home_q2,
        home_q3: scores.home_q3,
        home_q4: scores.home_q4,
        visitor_q1: scores.visitor_q1,
        visitor_q2: scores.visitor_q2,
        visitor_q3: scores.visitor_q3,
        visitor_q4: scores.visitor_q4,
      };
      ok += 1;
      if ((ok + fail) % 20 === 0) {
        console.log(`  progress ${ok + fail}/${missing.length} (ok=${ok} fail=${fail})`);
      }
    });

    writeNblPeriodScoreCache(year, next);
    console.log(`[nbl periods] wrote ${year} (${Object.keys(next).length} games, fetched ok=${ok} fail=${fail})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
