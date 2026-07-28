#!/usr/bin/env tsx
/**
 * Fetch NBL schedule from Rosetta → data/nbl-schedule-{year}.json
 * Usage: npx tsx scripts/fetch-nbl-schedule.ts --year=2025
 */
import fs from 'fs';
import path from 'path';
import { fetchNblSchedule } from '../lib/nbl/rosettaLeague';
import { nblSeasonLabel } from '../lib/nblTeamCanonical';

const year = Number(
  process.argv.find((arg) => arg.startsWith('--year='))?.slice(7) ||
    process.argv.find((arg) => arg.startsWith('--season='))?.slice(9) ||
    2025
);

async function main() {
  const matches = await fetchNblSchedule(year, 'regular');
  if (!matches) throw new Error(`Rosetta schedule unavailable for ${year}`);

  const games = matches.map((m) => ({
    id: m.id,
    externalId: m.external_id ?? null,
    startTime: m.start_time_datetime || m.start_time || null,
    round: m.round ?? null,
    status: m.match_status || m.status || null,
    homeTeam: m.home_team?.name ?? '',
    homeTeamCode: m.home_team?.team_code ?? null,
    homeTeamId: m.home_team?.id ?? null,
    homeLogo: m.home_team?.team_logo ?? m.home_team?.external_team_logo ?? null,
    awayTeam: m.away_team?.name ?? '',
    awayTeamCode: m.away_team?.team_code ?? null,
    awayTeamId: m.away_team?.id ?? null,
    awayLogo: m.away_team?.team_logo ?? m.away_team?.external_team_logo ?? null,
    homeScore: m.home_score != null ? Number(m.home_score) : null,
    awayScore: m.away_score != null ? Number(m.away_score) : null,
    venue: m.venue?.name ?? null,
    matchSlug: m.match_slug ?? null,
  }));

  const file = path.join(process.cwd(), 'data', `nbl-schedule-${year}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        year,
        seasonLabel: nblSeasonLabel(year),
        generatedAt: new Date().toISOString(),
        source: 'rosetta.nbl.com.au',
        gameCount: games.length,
        games,
      },
      null,
      2
    )
  );
  console.log(`Wrote ${file} (${games.length} games, ${nblSeasonLabel(year)})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
