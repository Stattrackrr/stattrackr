/**
 * Precompute the World Cup / international Opponent Breakdown rankings and store
 * them in the permanent `world_cup_cache` table, one entry per window (L3 / L10
 * / L20). Each nation's defensive "allowed averages" are computed over their
 * most recent N completed games across EVERY competition we ingest (BDL World
 * Cup + StatsBomb / API-Football / SofaScore internationals).
 *
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts
 *   npm run build:world-cup:opponent-breakdown
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const apiKey = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[opp-breakdown] BALLDONTLIE_API_KEY missing — World Cup games will be skipped (international sources still included).');
  }

  const { refreshOpponentBreakdownCache, OPP_BREAKDOWN_WINDOWS } = await import(
    '../lib/worldCupOpponentBreakdown'
  );

  console.log(`[opp-breakdown] computing windows: ${OPP_BREAKDOWN_WINDOWS.map((w) => `L${w}`).join(', ')}`);
  const started = Date.now();
  const all = await refreshOpponentBreakdownCache(apiKey);

  for (const window of OPP_BREAKDOWN_WINDOWS) {
    const payload = all[window];
    const teamCount = Object.keys(payload.names).length;
    console.log(`[opp-breakdown] L${window}: cached ${teamCount} nations`);
  }
  console.log(`[opp-breakdown] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[opp-breakdown] failed:', err);
    process.exit(1);
  });
