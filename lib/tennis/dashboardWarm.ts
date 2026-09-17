/**
 * Warm computed tennis dashboard payloads for upcoming props matchups.
 * Cron only — overlay is already in memory after ingest.
 */

import sharedCache from '@/lib/sharedCache';
import {
  averagesPayloadHasRows,
  buildTennisAdvancedAverages,
} from '@/lib/tennis/advancedAverages';
import {
  tennisComputedCacheKey,
  tennisSimilarComputedKey,
  writeTennisComputedCache,
} from '@/lib/tennis/dashboardCache';
import { getHydratedTennisOverlay } from '@/lib/tennis/ingest';
import { TENNIS_LIST_CACHE_KEY } from '@/lib/tennis/playerPropsList';
import { buildTennisPlayerForm } from '@/lib/tennis/playerForm';
import { buildTennisPlayerMatchupAsync, tennisMatchupComputedKey, tennisMatchupPayloadUsable } from '@/lib/tennis/playerMatchup';
import { buildTennisSimilarPlayers } from '@/lib/tennis/similarPlayers';
import type { TennisTour } from '@/lib/tennis/types';

type ListRow = {
  playerId?: string | null;
  playerName?: string | null;
  playerTeam?: string | null;
  opponent?: string | null;
  opponentId?: string | null;
  statType?: string | null;
};

function tourOf(row: ListRow): TennisTour | null {
  const team = String(row.playerTeam || '').toUpperCase();
  return team === 'WTA' || team === 'ATP' ? team : null;
}

export async function warmTennisDashboardComputed(): Promise<{ matchups: number }> {
  if (!getHydratedTennisOverlay()?.matches?.length) return { matchups: 0 };
  const list = await sharedCache.getJSON<{ data?: ListRow[] }>(TENNIS_LIST_CACHE_KEY);
  const rows = Array.isArray(list?.data) ? list.data : [];
  const seen = new Set<string>();
  let matchups = 0;
  const MAX_MATCHUPS = 400;
  for (const row of rows) {
    const player = String(row.playerName || '').trim();
    const opponent = String(row.opponent || '').trim();
    const playerId = String(row.playerId || '').trim();
    const opponentId = String(row.opponentId || '').trim();
    if (!player || !opponent) continue;
    const tour = tourOf(row);
    const key = `${playerId || player}:${opponent}:${tour || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (matchups >= MAX_MATCHUPS) break;
    const stat = String(row.statType || 'spread').trim() || 'spread';
    const similar = buildTennisSimilarPlayers({
      playerName: player,
      opponentName: opponent,
      playerId,
      tour,
      stat,
      limit: 8,
    });
    if (similar.similar.length) {
      await writeTennisComputedCache(
        tennisSimilarComputedKey({
          playerId,
          playerName: player,
          opponentId,
          opponentName: opponent,
          tour,
        }),
        { success: true, ...similar }
      );
    }
    const form = buildTennisPlayerForm({
      playerName: player,
      opponentName: opponent,
      tour,
    });
    await writeTennisComputedCache(
      tennisComputedCacheKey('form', [player, opponent, tour]),
      { success: true, ...form }
    );
    const averages = buildTennisAdvancedAverages({
      playerName: player,
      opponentName: opponent,
      playerId,
      opponentId: String(row.opponentId || '').trim() || null,
      tour,
    });
    if (averagesPayloadHasRows(averages)) {
      await writeTennisComputedCache(
        tennisComputedCacheKey('averages', [player, opponent, tour]),
        { success: true, ...averages }
      );
    }
    const matchup = await buildTennisPlayerMatchupAsync({
      playerName: player,
      opponentName: opponent,
      playerId,
      opponentId,
      tour,
    });
    if (
      tennisMatchupPayloadUsable(matchup, {
        expectField: false,
      })
    ) {
      await writeTennisComputedCache(
        tennisMatchupComputedKey({
          playerId,
          playerName: player,
          opponentId,
          opponentName: opponent,
          tour,
        }),
        { success: true, ...matchup }
      );
    }
    matchups += 1;
  }
  return { matchups };
}
