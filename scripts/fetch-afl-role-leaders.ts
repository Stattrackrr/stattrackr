#!/usr/bin/env tsx
/**
 * Refresh AFL Role Stats leaders (CBA / kick-ins) from FootyInfo fantasy-tools.
 * Writes data/afl-role-leaders-{season}.json for the API + dashboard.
 *
 *   npx tsx scripts/fetch-afl-role-leaders.ts --season=2026
 *   npm run fetch:afl:role-leaders -- --season=2026
 */

import fs from 'fs';
import path from 'path';
import {
  fetchFootyinfoCbaLeaders,
  fetchFootyinfoFantasyTeams,
  fetchFootyinfoKickinLeaders,
} from '../lib/afl/footyinfoFantasyTools';
import type { AflRoleLeadersSnapshot } from '../lib/afl/roleLeadersSnapshot';

const season = Number(
  process.argv.find((arg) => arg.startsWith('--season='))?.slice(9) || new Date().getFullYear()
);
const leadersLimit = Math.max(
  5,
  Number(process.argv.find((arg) => arg.startsWith('--limit='))?.slice(8) || 10)
);
const concurrency = Math.max(
  1,
  Number(process.argv.find((arg) => arg.startsWith('--concurrency='))?.slice(14) || 4)
);

async function mapPool<T, R>(items: T[], size: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await worker(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => run()));
  return out;
}

async function main() {
  if (!Number.isFinite(season) || season < 2017) {
    console.error('Invalid --season');
    process.exit(1);
  }

  console.log(`[Role Leaders] Fetching fantasy-tools teams for ${season}...`);
  const teams = await fetchFootyinfoFantasyTeams();
  if (!teams.length) {
    console.error('[Role Leaders] No teams returned from /fantasy-tools/teams');
    process.exit(1);
  }
  console.log(`[Role Leaders] ${teams.length} teams — concurrency=${concurrency}, leadersLimit=${leadersLimit}`);

  const snapshot: AflRoleLeadersSnapshot = {
    season,
    generatedAt: new Date().toISOString(),
    source: 'footyinfo.com/fantasy-tools',
    teams: {},
  };

  let ok = 0;
  let failed = 0;

  await mapPool(teams, concurrency, async (team) => {
    try {
      const [cba, kickIns] = await Promise.all([
        fetchFootyinfoCbaLeaders(team.slug, season, leadersLimit),
        fetchFootyinfoKickinLeaders(team.slug, season, leadersLimit),
      ]);
      snapshot.teams[team.slug] = {
        slug: team.slug,
        name: team.name,
        abbrev: team.abbrev,
        cba,
        kick_ins: kickIns,
      };
      ok += 1;
      console.log(
        `[Role Leaders] ✅ ${team.name}: CBA top=${cba.leaders[0]?.player || '—'} (${cba.teamTotal})` +
          ` | KI top=${kickIns.leaders[0]?.player || '—'} (${kickIns.teamTotal})`
      );
    } catch (e) {
      failed += 1;
      console.error(
        `[Role Leaders] ❌ ${team.name}:`,
        e instanceof Error ? e.message : String(e)
      );
    }
  });

  if (ok === 0) {
    console.error('[Role Leaders] All teams failed — not writing snapshot');
    process.exit(1);
  }

  const outPath = path.join(process.cwd(), 'data', `afl-role-leaders-${season}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(
    `[Role Leaders] Wrote ${outPath} (teams=${Object.keys(snapshot.teams).length}, ok=${ok}, failed=${failed})`
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[Role Leaders] Failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
