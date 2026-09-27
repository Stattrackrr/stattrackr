/**
 * Build 2026 assist locations from shot-chart coordinates.
 * Fetches play-by-play once per completed game, then writes player aggregates.
 *
 *   npx tsx scripts/rebuild-nbl-assist-charts.ts
 */
import fs from 'fs';
import path from 'path';
import { warmSeasonAssistCharts } from '../lib/nbl/nblAssistChart';
import { NBL_SHOT_CHART_CACHE_YEARS, NBL_SHOT_CHART_SEASON_YEAR } from '../lib/nblTeamCanonical';

function loadRosterNames(): string[] {
  const names = new Set<string>();
  for (const year of NBL_SHOT_CHART_CACHE_YEARS) {
    const file = path.join(process.cwd(), 'data', `nbl-roster-${year}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      const snap = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        players?: Array<{ name?: string }>;
      };
      for (const player of snap.players || []) {
        const name = String(player?.name || '').trim();
        if (name) names.add(name);
      }
    } catch {
      /* skip */
    }
  }
  return [...names];
}

async function main() {
  const result = await warmSeasonAssistCharts({
    year: NBL_SHOT_CHART_SEASON_YEAR,
    rosterNames: loadRosterNames(),
    force: process.argv.includes('--force'),
  });
  console.log(
    `[assist-charts] players=${result.playersWritten} withAssists=${result.withAssists} located=${result.located}/${result.assistCount}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
