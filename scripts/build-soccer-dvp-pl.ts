#!/usr/bin/env npx tsx

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from 'dotenv';

config({ path: '.env.local' });

const seasonArg = process.argv.find((arg) => arg.startsWith('--season='));
const competitionName = 'Premier League';
const competitionCountry = 'England';
const timeframes = ['season', 'last5'] as const;
async function main() {
  const { buildSoccerLeagueDvpMatrix } = await import('../lib/soccerDvp');
  const { getCurrentSoccerSeasonYear } = await import('../lib/soccerOpponentBreakdown');
  const seasonYear = seasonArg ? Number.parseInt(seasonArg.split('=')[1] || '', 10) : getCurrentSoccerSeasonYear();

  if (!Number.isFinite(seasonYear) || seasonYear <= 0) {
    throw new Error(`Invalid season year: ${String(seasonYear)}`);
  }

  await mkdir(path.join(process.cwd(), 'data'), { recursive: true });
  for (const timeframe of timeframes) {
    console.log(`[soccer-dvp] building ${competitionCountry} ${competitionName} season=${seasonYear} timeframe=${timeframe}`);
    const matrix = await buildSoccerLeagueDvpMatrix({
      competitionName,
      competitionCountry,
      timeframe,
      seasonYear,
    });
    const output = {
      generatedAt: new Date().toISOString(),
      source: 'soccer player_stats cache',
      competitionCountry,
      competitionName,
      seasonYear,
      timeframe,
      opponentsSampled: matrix.opponentsSampled,
      roles: matrix.roles,
      opponents: matrix.opponentRows,
      note: matrix.note,
    };

    const suffix = timeframe === 'last5' ? '-last5' : '';
    const outPath = path.join(process.cwd(), 'data', `soccer-dvp-premier-league-${seasonYear}${suffix}.json`);
    await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(`[soccer-dvp] wrote ${outPath}`);
    console.log(`[soccer-dvp] opponents=${output.opponents.length} roles=${output.roles.length}`);
  }
}

main().catch((error) => {
  console.error('[soccer-dvp] failed', error);
  process.exitCode = 1;
});
