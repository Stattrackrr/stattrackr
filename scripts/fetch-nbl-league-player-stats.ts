#!/usr/bin/env tsx
/**
 * Fetch NBL roster + per-player season averages from Rosetta.
 * Writes:
 *   data/nbl-roster-{year}.json
 *   data/nbl-league-player-stats-{year}.json
 *
 * Usage: npx tsx scripts/fetch-nbl-league-player-stats.ts --year=2025
 */
import fs from 'fs';
import path from 'path';
import {
  fetchNblPlayerSeasonStats,
  fetchNblSeasonPlayers,
  normalizeLeaguePlayerStatRow,
  pickPlayerSeasonStatsForYear,
} from '../lib/nbl/rosettaPlayer';
import { isCurrentNblClubId, nblSeasonLabel } from '../lib/nblTeamCanonical';

const year = Number(
  process.argv.find((arg) => arg.startsWith('--year='))?.slice(7) ||
    process.argv.find((arg) => arg.startsWith('--season='))?.slice(9) ||
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
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

async function main() {
  const roster = await fetchNblSeasonPlayers(year);
  if (!roster?.length) throw new Error(`Rosetta roster unavailable for ${year}`);

  const currentClubRoster = roster.filter((r) => isCurrentNblClubId(r.team?.id));
  const rosterPlayers = currentClubRoster
    .map((r) => ({
      playerId: r.player.id,
      name: r.player.full_name || `${r.player.first_name || ''} ${r.player.last_name || ''}`.trim(),
      team: r.team?.name ?? '',
      teamCode: r.team?.team_code ?? null,
      teamId: r.team?.id ?? null,
      position: r.playing_position ?? r.player.playing_position ?? null,
      jersey: r.jersey_number != null ? String(r.jersey_number) : null,
      imageUrl: r.player.external_player_image ?? r.player.image ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const rosterFile = path.join(process.cwd(), 'data', `nbl-roster-${year}.json`);
  fs.writeFileSync(
    rosterFile,
    JSON.stringify(
      {
        year,
        seasonLabel: nblSeasonLabel(year),
        generatedAt: new Date().toISOString(),
        source: 'rosetta.nbl.com.au',
        playerCount: rosterPlayers.length,
        players: rosterPlayers,
      },
      null,
      2
    )
  );
  console.log(`Wrote ${rosterFile} (${rosterPlayers.length} players)`);

  console.log(`Fetching season averages for ${currentClubRoster.length} players...`);
  let ok = 0;
  let missing = 0;
  const players = await mapPool(currentClubRoster, 8, async (entry, index) => {
    const statsRows = await fetchNblPlayerSeasonStats(entry.player.id);
    const seasonRow = pickPlayerSeasonStatsForYear(statsRows, year, 'regular');
    if (seasonRow) ok += 1;
    else missing += 1;
    if ((index + 1) % 25 === 0 || index + 1 === currentClubRoster.length) {
      console.log(`  … ${index + 1}/${currentClubRoster.length} (with stats: ${ok}, missing: ${missing})`);
    }
    return normalizeLeaguePlayerStatRow(entry, seasonRow);
  });

  players.sort((a, b) => a.name.localeCompare(b.name));

  const statsFile = path.join(process.cwd(), 'data', `nbl-league-player-stats-${year}.json`);
  fs.writeFileSync(
    statsFile,
    JSON.stringify(
      {
        year,
        seasonLabel: nblSeasonLabel(year),
        generatedAt: new Date().toISOString(),
        source: 'rosetta.nbl.com.au',
        playerCount: players.length,
        withSeasonStats: ok,
        missingSeasonStats: missing,
        players,
      },
      null,
      2
    )
  );
  console.log(`Wrote ${statsFile} (${players.length} players, ${ok} with season averages)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
