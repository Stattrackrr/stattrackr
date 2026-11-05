/**
 * Cron-only NBL ingest: odds-api.net player lines and game lines,
 * then bake the props-page list and combined NBL slice into Redis.
 */

import { upsertCombinedSnapshotNblFromList } from '@/lib/combinedPropsSnapshotPaint';
import { persistNblPlayerPropSnapshots } from '@/lib/nbl/playerPropSnapshots';
import { getNblPlayerPropsList } from '@/lib/nbl/playerPropsList';
import { getNblPulseScoreBoard } from '@/lib/nbl/pulseScore';
import { getNblOddsCache, refreshNblOddsData } from '@/lib/nbl/refreshNblOdds';

/**
 * Player props and game lines both refresh every cron tick (10 minutes; a little under so jitter
 * never skips one). Game lines cost a credit per game on the odds-api.net plan shared with NBA.
 */
const NBL_GAME_ODDS_MIN_AGE_MS = 9 * 60 * 1000;

async function gameOddsForIngest(writeDisk: boolean): Promise<Awaited<ReturnType<typeof refreshNblOddsData>>> {
  if (!writeDisk) {
    const cached = await getNblOddsCache();
    const age = cached?.lastUpdated ? Date.now() - Date.parse(cached.lastUpdated) : Infinity;
    if (cached?.games.length && age < NBL_GAME_ODDS_MIN_AGE_MS) {
      return {
        success: true,
        gamesCount: cached.games.length,
        lastUpdated: cached.lastUpdated,
        nextUpdate: cached.nextUpdate,
      };
    }
  }
  return refreshNblOddsData({ disk: writeDisk });
}

export type NblOddsAndPropsIngestResult = {
  success: boolean;
  pulseGames: number; // games from odds-api.net board (legacy field name)
  snapshots: { saved: number; frozen: number; skipped: number; historyWrites: number };
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
  const writeDisk = options?.disk !== false;
  const snapshots = await persistNblPlayerPropSnapshots(pulseGames, { disk: writeDisk });
  const gameOdds = await gameOddsForIngest(writeDisk);
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
