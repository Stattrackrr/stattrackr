'use client';

import { useEffect, useState } from 'react';
import type { PropsDashboardSport } from '@/lib/propsDashboardLinks';
import {
  freePlayerPicksFor,
  isFreePlayerPick,
  readFreePlayerPicks,
  subscribeFreePlayerPicks,
  type FreePlayerPick,
  type FreePlayerPicks,
} from '@/lib/freePlayers';

/**
 * Free accounts see every stat for their one free player per sport. Any other player is locked.
 * `player` is null in team/game mode or before a player is chosen — nothing is locked then.
 */
export function useFreePlayerLock(opts: {
  freeAccount: boolean;
  sports: readonly PropsDashboardSport[];
  player: { name?: string | null; id?: string | number | null } | null;
}): { locked: boolean; freePicks: FreePlayerPick[] } {
  const [picks, setPicks] = useState<FreePlayerPicks | null>(null);
  useEffect(() => {
    setPicks(readFreePlayerPicks());
    return subscribeFreePlayerPicks(() => setPicks(readFreePlayerPicks()));
  }, []);
  const freePicks = picks ? freePlayerPicksFor(picks, opts.sports) : [];
  const hasPlayer = Boolean(opts.player && (opts.player.name || opts.player.id));
  const locked =
    opts.freeAccount && picks !== null && hasPlayer && !isFreePlayerPick(picks, opts.sports, opts.player!);
  return { locked, freePicks };
}
