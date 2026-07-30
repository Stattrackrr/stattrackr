#!/usr/bin/env tsx
/**
 * Fetch each club's next NBL tipoff(s) from Rosetta.
 * Writes data/nbl-next-matches-{year}.json
 *
 * Usage: npx tsx scripts/fetch-nbl-next-matches.ts --year=2026
 */
import fs from 'fs';
import path from 'path';
import { fetchNblNextMatches } from '../lib/nbl/rosettaLeague';
import { nblSeasonLabel } from '../lib/nblTeamCanonical';

const year = Number(
  process.argv.find((arg) => arg.startsWith('--year='))?.slice(7) ||
    process.argv.find((arg) => arg.startsWith('--season='))?.slice(9) ||
    2026
);

async function main() {
  const rows = await fetchNblNextMatches(year);
  if (!rows) throw new Error(`Rosetta next matches unavailable for ${year}`);

  const teams = (rows as unknown[]).map((row) => {
    const r = row as {
      id?: string;
      name?: string;
      team_code?: string | null;
      nextMatches?: Array<Record<string, unknown>>;
    };
    return {
      id: r.id ?? null,
      name: r.name ?? '',
      team_code: r.team_code ?? null,
      nextMatches: Array.isArray(r.nextMatches) ? r.nextMatches : [],
    };
  });

  const file = path.join(process.cwd(), 'data', `nbl-next-matches-${year}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        year,
        seasonLabel: nblSeasonLabel(year),
        generatedAt: new Date().toISOString(),
        source: 'rosetta.nbl.com.au',
        teamCount: teams.length,
        teams,
      },
      null,
      2
    )
  );
  console.log(
    `Wrote ${file} (${teams.length} teams, ${teams.reduce((n, t) => n + t.nextMatches.length, 0)} next-match rows, ${nblSeasonLabel(year)})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
