/**
 * Snapshot odds-api.net NBL player lines (Sportsbet / TAB / Bet365 / Unibet) to
 * data/nbl-model/cache/player-prop-lines/ and bake the props list.
 *
 * Usage: npx tsx scripts/snapshot-nbl-player-props.ts
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

import { refreshNblOddsAndPropsIngest } from '../lib/nbl/refreshNblPropsIngest';

async function main() {
  const key = String(process.env.ODDS_API_NET_KEY || process.env.ODDS_API_NET || '').trim();
  if (!key) {
    throw new Error('ODDS_API_NET_KEY is not set');
  }

  const result = await refreshNblOddsAndPropsIngest({ disk: true });
  console.log(
    `[nbl ingest] games=${result.pulseGames} saved=${result.snapshots.saved} frozen=${result.snapshots.frozen} skipped=${result.snapshots.skipped}`
  );
  console.log(
    `[nbl ingest] gameOdds=${result.gameOdds.gamesCount} success=${result.gameOdds.success}${result.gameOdds.error ? ` (${result.gameOdds.error})` : ''}`
  );
  console.log(
    `[nbl ingest] props=${result.propsCount} games=${result.gamesCount} combined=${result.combinedNbl}`
  );
  if (!result.success) {
    console.warn('[nbl ingest] incomplete', result.error || result.gameOdds.error || 'no props or game lines');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
