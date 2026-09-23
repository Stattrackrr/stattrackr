/**
 * Cron-only NBL ingest: PulseScore player lines + The Odds API game lines,
 * then bake the props-page list and combined NBL slice into Redis.
 */

import { upsertCombinedSnapshotNblFromList } from '@/lib/combinedPropsSnapshotPaint';
import { persistNblPlayerPropSnapshots } from '@/lib/nbl/playerPropSnapshots';
import { getNblPlayerPropsList } from '@/lib/nbl/playerPropsList';
import { getNblPulseScoreBoard } from '@/lib/nbl/pulseScore';
import { refreshNblOddsData } from '@/lib/nbl/refreshNblOdds';

export type NblOddsAndPropsIngestResult = {
  success: boolean;
  pulseGames: number;
  snapshots: { saved: number; frozen: number; skipped: number };
  gameOdds: {
    success: boolean;
    gamesCount: number;
    lastUpdated: string;
    nextUpdate: string;
    error?: string;
  };
  propsCount: number;
  gamesCount: number;
  combinedNbl: number;
  error?: string;
};

export async function refreshNblOddsAndPropsIngest(options?: {
  disk?: boolean;
}): Promise<NblOddsAndPropsIngestResult> {
  const pulseGames = await getNblPulseScoreBoard({ force: true });
  const snapshots = await persistNblPlayerPropSnapshots(pulseGames, {
    disk: options?.disk !== false,
  });
  const gameOdds = await refreshNblOddsData();
  const list = await getNblPlayerPropsList({ refresh: true });

  let combinedNbl = 0;
  let combinedError: string | undefined;
  try {
    combinedNbl = await upsertCombinedSnapshotNblFromList(list);
  } catch (err) {
    combinedError = err instanceof Error ? err.message : String(err);
    console.warn('[NBL ingest] combined upsert failed', combinedError);
  }

  const success = list.data.length > 0 || gameOdds.success;
  const error = success
    ? combinedError
    : gameOdds.error || combinedError || 'NBL odds ingest produced no props or game lines';

  return {
    success,
    pulseGames: pulseGames.length,
    snapshots,
    gameOdds: {
      success: gameOdds.success,
      gamesCount: gameOdds.gamesCount,
      lastUpdated: gameOdds.lastUpdated,
      nextUpdate: gameOdds.nextUpdate,
      error: gameOdds.error,
    },
    propsCount: list.data.length,
    gamesCount: list.games.length,
    combinedNbl,
    error,
  };
}
