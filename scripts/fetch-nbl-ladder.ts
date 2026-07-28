#!/usr/bin/env tsx
/**
 * Fetch NBL ladder from Rosetta → data/nbl-ladder-{year}.json
 * Usage: npx tsx scripts/fetch-nbl-ladder.ts --year=2025
 */
import fs from 'fs';
import path from 'path';
import { fetchNblLadder } from '../lib/nbl/rosettaLeague';
import { nblSeasonLabel } from '../lib/nblTeamCanonical';

const year = Number(
  process.argv.find((arg) => arg.startsWith('--year='))?.slice(7) ||
    process.argv.find((arg) => arg.startsWith('--season='))?.slice(9) ||
    2025
);

async function main() {
  const rows = await fetchNblLadder(year, 'regular');
  if (!rows?.length) throw new Error(`Rosetta ladder unavailable for ${year}`);

  const teams = [...rows]
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((row) => ({
      pos: Number(row.position) || null,
      team: row.team?.name ?? '',
      teamCode: row.team?.team_code ?? null,
      teamId: row.team?.id ?? null,
      teamLogo: row.team?.team_logo ?? row.team?.external_team_logo ?? null,
      played: Number(row.played) || 0,
      win: Number(row.won) || 0,
      loss: Number(row.lost) || 0,
      points_for: row.points_for ?? null,
      points_against: row.points_against ?? null,
      points_percentage: row.points_percentage ?? null,
      win_percentage: row.win_percentage ?? null,
      last_5: row.last_5 ?? null,
      streak: row.streak ?? null,
      home_wins: row.home_wins ?? null,
      home_losses: row.home_losses ?? null,
      away_wins: row.away_wins ?? null,
      away_losses: row.away_losses ?? null,
    }));

  const file = path.join(process.cwd(), 'data', `nbl-ladder-${year}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        year,
        seasonLabel: nblSeasonLabel(year),
        generatedAt: new Date().toISOString(),
        source: 'rosetta.nbl.com.au',
        teams,
      },
      null,
      2
    )
  );
  console.log(`Wrote ${file} (${teams.length} teams, ${nblSeasonLabel(year)})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
