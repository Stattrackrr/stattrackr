#!/usr/bin/env tsx
/**
 * Warm / snapshot NBL player game logs from Rosetta box scores.
 * Writes data/nbl-model/cache/player-logs/{playerId}-{year}.json
 * and a combined data/nbl-player-game-logs-index-{year}.json
 *
 * Usage:
 *   npx tsx scripts/fetch-nbl-player-game-logs.ts --year=2025
 *   npx tsx scripts/fetch-nbl-player-game-logs.ts --year=2025 --limit=20
 */
import fs from 'fs';
import path from 'path';
import {
  fetchNblPlayerBoxscores,
  fetchNblSeasonPlayers,
  normalizePlayerBoxScore,
} from '../lib/nbl/rosettaPlayer';
import { isCurrentNblClubId, nblSeasonLabel } from '../lib/nblTeamCanonical';

const year = Number(
  process.argv.find((arg) => arg.startsWith('--year='))?.slice(7) ||
    process.argv.find((arg) => arg.startsWith('--season='))?.slice(9) ||
    2025
);
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='))?.slice(8);
const limit = limitArg ? Math.max(1, Number(limitArg)) : null;

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
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function main() {
  const roster = await fetchNblSeasonPlayers(year);
  if (!roster?.length) throw new Error(`Rosetta roster unavailable for ${year}`);

  let entries = roster.filter((r) => isCurrentNblClubId(r.team?.id));
  if (limit != null) entries = entries.slice(0, limit);

  const cacheDir = path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'player-logs');
  fs.mkdirSync(cacheDir, { recursive: true });

  console.log(`Fetching box scores for ${entries.length} players (${nblSeasonLabel(year)})...`);
  let gamesTotal = 0;

  const index = await mapPool(entries, 6, async (entry, indexNum) => {
    const boxes = await fetchNblPlayerBoxscores(entry.player.id, year, 'regular');
    const logs = (boxes || [])
      .map((b) => normalizePlayerBoxScore(b, year))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

    gamesTotal += logs.length;
    const name =
      entry.player.full_name ||
      `${entry.player.first_name || ''} ${entry.player.last_name || ''}`.trim();
    const payload = {
      playerId: entry.player.id,
      name,
      team: entry.team?.name ?? '',
      teamCode: entry.team?.team_code ?? null,
      year,
      seasonLabel: nblSeasonLabel(year),
      generatedAt: new Date().toISOString(),
      source: 'rosetta.nbl.com.au',
      gameCount: logs.length,
      games: logs,
    };
    const file = path.join(cacheDir, `${entry.player.id}-${year}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));

    if ((indexNum + 1) % 20 === 0 || indexNum + 1 === entries.length) {
      console.log(`  … ${indexNum + 1}/${entries.length} (games rows so far: ${gamesTotal})`);
    }

    return {
      playerId: entry.player.id,
      name,
      team: entry.team?.name ?? '',
      teamCode: entry.team?.team_code ?? null,
      gameCount: logs.length,
      cacheFile: `nbl-model/cache/player-logs/${entry.player.id}-${year}.json`,
    };
  });

  const indexFile = path.join(process.cwd(), 'data', `nbl-player-game-logs-index-${year}.json`);
  fs.writeFileSync(
    indexFile,
    JSON.stringify(
      {
        year,
        seasonLabel: nblSeasonLabel(year),
        generatedAt: new Date().toISOString(),
        source: 'rosetta.nbl.com.au',
        playerCount: index.length,
        gameRows: gamesTotal,
        players: index.sort((a, b) => a.name.localeCompare(b.name)),
      },
      null,
      2
    )
  );
  console.log(`Wrote ${indexFile} (${index.length} players, ${gamesTotal} game rows)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
