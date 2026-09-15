/**
 * Rebuild NBL player shot-chart aggregates from cached SportRadar fixtures.
 * Does not call the live API.
 *
 *   npx tsx scripts/rebuild-nbl-shot-chart-players.ts
 */
import fs from 'fs';
import path from 'path';
import { rebuildPlayerShotChartAggregatesFromFixtures } from '../lib/nbl/nblShotChartData';
import { NBL_SHOT_CHART_CACHE_YEARS } from '../lib/nblTeamCanonical';

function loadRosterNames(): string[] {
  const names = new Set<string>();
  for (const year of [...NBL_SHOT_CHART_CACHE_YEARS, 2026, 2025, 2024, 2023]) {
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

const rosterNames = loadRosterNames();
const result = rebuildPlayerShotChartAggregatesFromFixtures({ rosterNames });
console.log(
  `[rebuild-nbl-shot-chart-players] written=${result.playersWritten} withShots=${result.withShots} rosterNames=${rosterNames.length}`
);
