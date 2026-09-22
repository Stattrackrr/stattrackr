/**
 * Snapshot PulseScore NBL player lines (Sportsbet / TAB) to
 * data/nbl-model/cache/player-prop-lines/
 *
 * Usage: npx tsx scripts/snapshot-nbl-player-props.ts
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

import { upsertCombinedSnapshotNblFromList } from '../lib/combinedPropsSnapshotPaint';
import { persistNblPlayerPropSnapshots } from '../lib/nbl/playerPropSnapshots';
import { getNblPlayerPropsList } from '../lib/nbl/playerPropsList';
import { getNblPulseScoreBoard } from '../lib/nbl/pulseScore';

async function main() {
  const key = String(process.env.PULSESCORE_API_KEY || process.env.PULSE_SCORE_KEY || '').trim();
  if (!key) {
    throw new Error('PULSESCORE_API_KEY is not set');
  }

  const games = await getNblPulseScoreBoard({ force: true });
  const result = await persistNblPlayerPropSnapshots(games, { disk: true });
  console.log(
    `[nbl player-prop snapshot] games=${games.length} saved=${result.saved} frozen=${result.frozen} skipped=${result.skipped}`
  );
  for (const g of games) {
    const books = g.bookmakers.map((b) => `${b.name}:${(b.markets || []).length}`).join(', ');
    console.log(`  ${g.commenceTime.slice(0, 16)} ${g.homeTeam} vs ${g.awayTeam} (${books})`);
  }

  const list = await getNblPlayerPropsList({ refresh: true });
  console.log(`[nbl player-prop list] props=${list.data.length} games=${list.games.length}`);
  try {
    const combined = await upsertCombinedSnapshotNblFromList(list);
    console.log(`[nbl player-prop list] combined nbl=${combined}`);
  } catch (err) {
    console.warn(
      '[nbl player-prop list] combined upsert skipped',
      err instanceof Error ? err.message : err
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
