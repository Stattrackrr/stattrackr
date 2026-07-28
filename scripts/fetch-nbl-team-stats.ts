#!/usr/bin/env tsx
/**
 * Fetch NBL team season stats from Rosetta → data/nbl-team-stats-{year}.json
 * Usage: npx tsx scripts/fetch-nbl-team-stats.ts --year=2025
 */
import fs from 'fs';
import path from 'path';
import { fetchNblTeamStats } from '../lib/nbl/rosettaLeague';
import { isCurrentNblClubId, nblSeasonLabel } from '../lib/nblTeamCanonical';

const year = Number(
  process.argv.find((arg) => arg.startsWith('--year='))?.slice(7) ||
    process.argv.find((arg) => arg.startsWith('--season='))?.slice(9) ||
    2025
);

async function main() {
  const rows = await fetchNblTeamStats(year, 'regular');
  if (!rows?.length) throw new Error(`Rosetta team stats unavailable for ${year}`);

  const byTeam = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const id = r.team?.id;
    if (!isCurrentNblClubId(id)) continue;
    const prev = byTeam.get(id!);
    // Rosetta returns multiple period rows per club — keep the fullest game sample.
    if (!prev || Number(r.games || 0) > Number(prev.games || 0)) {
      byTeam.set(id!, r);
    }
  }

  const teams = [...byTeam.values()]
    .map((r) => ({
      team: r.team?.name ?? '',
      teamCode: r.team?.team_code ?? null,
      teamId: r.team?.id ?? null,
      games: r.games ?? null,
      points: r.points_average ?? null,
      rebounds: r.rebounds_average ?? null,
      assists: r.assists_average ?? null,
      steals: r.steals_average ?? null,
      blocks: r.blocks_average ?? null,
      turnovers: r.turnovers_average ?? null,
      fgPct: r.field_goals_percentage ?? null,
      threePct: r.three_points_percentage ?? null,
      ftPct: r.free_throws_percentage ?? null,
      offensiveRebounds:
        r.offensive_rebounds != null
          ? Number(r.offensive_rebounds) / Math.max(1, Number(r.games) || 1)
          : null,
      results: r.results_string ?? null,
    }))
    .sort((a, b) => String(a.team).localeCompare(String(b.team)));

  const file = path.join(process.cwd(), 'data', `nbl-team-stats-${year}.json`);
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
  console.log(`Wrote ${file} (${teams.length} clubs, ${nblSeasonLabel(year)})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
