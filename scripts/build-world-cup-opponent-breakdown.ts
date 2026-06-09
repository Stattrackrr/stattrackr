/**
 * Precompute the World Cup / international Opponent Breakdown rankings and store
 * them in the permanent `world_cup_cache` table, one entry per window (L5 / L10
 * / All). Each nation's defensive "allowed averages" are computed over their
 * most recent N completed games across EVERY competition we ingest (BDL World
 * Cup + StatsBomb / API-Football / SofaScore internationals). The "All" window
 * (id 0) averages over every game we have for a nation.
 *
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts
 *   npm run build:world-cup:opponent-breakdown
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const apiKey = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[opp-breakdown] BALLDONTLIE_API_KEY missing — World Cup games AND the 48-team universe will be skipped. Rankings will fall back to every nation seen in the international sources. Set the key to rank the 48 qualified teams.');
  }

  const { refreshOpponentBreakdownCache, OPP_BREAKDOWN_WINDOWS, OPP_BREAKDOWN_ALL_WINDOW } =
    await import('../lib/worldCupOpponentBreakdown');

  const label = (w: number) => (w === OPP_BREAKDOWN_ALL_WINDOW ? 'All' : `L${w}`);
  console.log(`[opp-breakdown] computing windows: ${OPP_BREAKDOWN_WINDOWS.map(label).join(', ')}`);
  console.log('[opp-breakdown] prefer running with the dev server stopped to avoid BDL rate limits / DB contention.');
  const started = Date.now();
  // Each of the 48 qualified nations (BDL season 2026) is assembled through the
  // SAME pipeline the Game Props chart uses — BDL World Cup history +
  // loadInternationalTeamStatsByCountry, normalized/deduped/rich-filtered — so the
  // breakdown's "allowed" averages always match the chart. Processed one nation
  // at a time, so memory stays flat.
  const all = await refreshOpponentBreakdownCache(apiKey);

  for (const window of OPP_BREAKDOWN_WINDOWS) {
    const payload = all[window];
    const teamCount = Object.keys(payload.names).length;
    console.log(`[opp-breakdown] ${label(window)}: cached ${teamCount} nations`);
  }
  console.log(`[opp-breakdown] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[opp-breakdown] failed:', err);
    process.exit(1);
  });
