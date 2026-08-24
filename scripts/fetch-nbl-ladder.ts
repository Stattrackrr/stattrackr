#!/usr/bin/env tsx
/**
 * Fetch NBL ladder from Rosetta → data/nbl-ladder-{year}.json
 * Default year is last completed season until the current season has a finished game.
 * Usage: npx tsx scripts/fetch-nbl-ladder.ts --year=2025
 */
import { fetchNblLadder } from '../lib/nbl/rosettaLeague';
import {
  mapNblLadderRows,
  nblLadderHasPlayedGames,
  resolveNblLadderYear,
  writeNblLadderSnapshot,
} from '../lib/nbl/ladderSeason';
import { NBL_CURRENT_SEASON_YEAR, nblSeasonLabel } from '../lib/nblTeamCanonical';

const year = Number(
  process.argv.find((arg) => arg.startsWith('--year='))?.slice(7) ||
    process.argv.find((arg) => arg.startsWith('--season='))?.slice(9) ||
    resolveNblLadderYear()
);

async function main() {
  const rows = await fetchNblLadder(year, 'regular');
  if (!rows?.length) {
    if (year === NBL_CURRENT_SEASON_YEAR) {
      console.log(`No ${nblSeasonLabel(year)} ladder yet — skip`);
      return;
    }
    throw new Error(`Rosetta ladder unavailable for ${year}`);
  }

  const teams = mapNblLadderRows(rows);
  if (!nblLadderHasPlayedGames(teams) && year === NBL_CURRENT_SEASON_YEAR) {
    console.log(`${nblSeasonLabel(year)} ladder is all 0-0 — skip write`);
    return;
  }

  const file = writeNblLadderSnapshot(year, teams);
  console.log(
    `Wrote data/nbl-ladder-${year}.json (${file.teams.length} teams, ${file.seasonLabel})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
