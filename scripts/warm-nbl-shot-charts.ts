/**
 * Warm NBL SportRadar shot-chart fixture caches + player/defense aggregates.
 * Live API calls happen here only — the dashboard reads disk caches.
 *
 * Usage:
 *   npx tsx scripts/warm-nbl-shot-charts.ts
 *   npx tsx scripts/warm-nbl-shot-charts.ts --years=2025 --concurrency=3 --force
 */

import fs from 'fs';
import path from 'path';
import {
  NBL_CLUBS,
  NBL_SHOT_CHART_CACHE_YEARS,
  resolveNblClubName,
} from '../lib/nblTeamCanonical';
import {
  buildTeamDefenseShotChart,
  fixtureIdOf,
  getMatchShotChart,
  isCompletedGame,
  loadScheduleGames,
  normalizeNblShotPlayerKey,
  readCachedShotChart,
  rebuildPlayerShotChartAggregatesFromFixtures,
  writeShotChartManifest,
  writeTeamDefenseShotChartCache,
  type NblShotChartManifest,
} from '../lib/nbl/nblShotChartData';

type RosterPlayer = {
  name?: string;
  team?: string | null;
  playerId?: string | null;
};

function parseArgs(argv: string[]) {
  let years = [...NBL_SHOT_CHART_CACHE_YEARS];
  let concurrency = 3;
  let force = false;
  for (const arg of argv) {
    if (arg.startsWith('--years=')) {
      const parsed = arg
        .slice('--years='.length)
        .split(',')
        .map((p) => Number(p.trim()))
        .filter((y) => Number.isFinite(y) && y >= 2020 && y <= 2100);
      if (parsed.length) years = [...new Set(parsed)].sort((a, b) => b - a);
    } else if (arg.startsWith('--concurrency=')) {
      const n = Number(arg.slice('--concurrency='.length));
      if (Number.isFinite(n) && n >= 1 && n <= 8) concurrency = Math.floor(n);
    } else if (arg === '--force') {
      force = true;
    }
  }
  return { years, concurrency, force };
}

function loadPlayersForYears(years: number[]): RosterPlayer[] {
  const byKey = new Map<string, RosterPlayer>();
  for (const year of years) {
    for (const fileName of [`nbl-league-player-stats-${year}.json`, `nbl-roster-${year}.json`]) {
      const file = path.join(process.cwd(), 'data', fileName);
      if (!fs.existsSync(file)) continue;
      try {
        const snap = JSON.parse(fs.readFileSync(file, 'utf8')) as { players?: RosterPlayer[] };
        for (const raw of snap.players || []) {
          const name = String(raw?.name || '').trim();
          if (!name) continue;
          const key = normalizeNblShotPlayerKey(name);
          const existing = byKey.get(key);
          const team = raw.team ? resolveNblClubName(raw.team) || raw.team : existing?.team || null;
          if (!existing) {
            byKey.set(key, { name, team, playerId: raw.playerId ?? null });
          } else if (!existing.team && team) {
            byKey.set(key, { ...existing, team });
          }
        }
      } catch {
        /* skip corrupt */
      }
    }
  }
  return [...byKey.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
}

async function main() {
  const { years, concurrency, force } = parseArgs(process.argv.slice(2));
  console.log(`[warm-nbl-shot-charts] years=${years.join(',')} concurrency=${concurrency} force=${force}`);

  const games = loadScheduleGames(years).filter(isCompletedGame);
  const fixtureIds = [...new Set(games.map((g) => fixtureIdOf(g)).filter(Boolean) as string[])];
  console.log(`[warm-nbl-shot-charts] completed games=${games.length} unique fixtures=${fixtureIds.length}`);

  let fixturesCached = 0;
  let fixturesFetched = 0;
  let fixturesMissing = 0;

  await mapPool(fixtureIds, concurrency, async (fixtureId, i) => {
    const before = Boolean(readCachedShotChart(fixtureId));
    const chart = await getMatchShotChart(fixtureId, { forceRefresh: force, cacheOnly: false });
    if (!chart || chart.shots.length === 0) {
      fixturesMissing += 1;
      if ((i + 1) % 25 === 0 || i === fixtureIds.length - 1) {
        console.log(`[warm-nbl-shot-charts] fixtures ${i + 1}/${fixtureIds.length} (missing=${fixturesMissing})`);
      }
      return;
    }
    if (before && !force) fixturesCached += 1;
    else fixturesFetched += 1;
    if ((i + 1) % 25 === 0 || i === fixtureIds.length - 1) {
      console.log(
        `[warm-nbl-shot-charts] fixtures ${i + 1}/${fixtureIds.length} cached=${fixturesCached} fetched=${fixturesFetched} missing=${fixturesMissing}`
      );
    }
  });

  const players = loadPlayersForYears([...new Set([...years, 2026])]);
  const rosterNames = players.map((p) => String(p.name || '').trim()).filter(Boolean);
  console.log(
    `[warm-nbl-shot-charts] rebuilding player aggregates from fixture caches (${rosterNames.length} roster names)…`
  );
  const rebuilt = rebuildPlayerShotChartAggregatesFromFixtures({ rosterNames, years });
  const playersCached = rebuilt.playersWritten;
  const playersWithShots = rebuilt.withShots;
  console.log(
    `[warm-nbl-shot-charts] players written=${playersCached} withShots=${playersWithShots}`
  );

  console.log(`[warm-nbl-shot-charts] building defense aggregates for ${NBL_CLUBS.length} clubs…`);
  let defenseTeamsCached = 0;
  for (const club of NBL_CLUBS) {
    const result = await buildTeamDefenseShotChart({
      team: club.name,
      years,
      maxGames: 200,
      cacheOnly: true,
      withLeagueRanks: true,
    });
    writeTeamDefenseShotChartCache(result);
    defenseTeamsCached += 1;
    console.log(
      `[warm-nbl-shot-charts] defense ${club.code}: shots=${result.shotCount} games=${result.gamesUsed}`
    );
  }

  const manifest: NblShotChartManifest = {
    years,
    generatedAt: new Date().toISOString(),
    fixturesTotal: fixtureIds.length,
    fixturesCached,
    fixturesFetched,
    fixturesMissing,
    playersCached,
    defenseTeamsCached,
  };
  writeShotChartManifest(manifest);
  console.log('[warm-nbl-shot-charts] done', manifest);
}

main().catch((err) => {
  console.error('[warm-nbl-shot-charts] failed', err);
  process.exit(1);
});
