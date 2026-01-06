import { DepthChartData } from '../types';
import { NBAPlayer } from '@/lib/nbaPlayers';

export interface CalculateSelectedPositionParams {
  propsMode: 'player' | 'team';
  selectedPlayer: NBAPlayer | null;
  playerTeamRoster: DepthChartData | null;
  allTeamRosters: Record<string, DepthChartData>;
  originalPlayerTeam: string;
}

/**
 * Resolve selected player's exact position from depth chart
 * Rules:
 * 1) Starter always wins (depth index 0). If starter at multiple positions, tie-break by PG > SG > SF > PF > C.
 * 2) Otherwise scan by rows (depth index 1..), first appearance wins; within a row tie-break by PG > SG > SF > PF > C.
 * 3) Name matching uses normalized full/constructed names.
 */
export function calculateSelectedPosition({
  propsMode,
  selectedPlayer,
  playerTeamRoster,
  allTeamRosters,
  originalPlayerTeam,
}: CalculateSelectedPositionParams): 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null {
  try {
    if (propsMode !== 'player' || !selectedPlayer) return null;
    const fullName = selectedPlayer.full || '';
    const constructed = `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim();
    const names = [fullName, constructed].filter(Boolean) as string[];
    const normalize = (s: string) => s
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const normNames = names.map(normalize);
    const roster = (playerTeamRoster && Object.keys(playerTeamRoster || {}).length ? playerTeamRoster : allTeamRosters[originalPlayerTeam]) as any;
    if (!roster) return null;
    const POS: Array<'PG' | 'SG' | 'SF' | 'PF' | 'C'> = ['PG', 'SG', 'SF', 'PF', 'C'];

    const matchAt = (pos: 'PG' | 'SG' | 'SF' | 'PF' | 'C', idx: number): boolean => {
      const arr = Array.isArray(roster[pos]) ? roster[pos] : [];
      if (!arr[idx]) return false;
      const pn = normalize(String(arr[idx]?.name || ''));
      if (!pn) return false;
      return normNames.some(cand => pn === cand || pn.endsWith(' ' + cand) || cand.endsWith(' ' + pn));
    };

    // 1) Starters first
    const starterMatches = POS.filter(pos => matchAt(pos, 0));
    if (starterMatches.length > 0) {
      // Tie-break by priority order: PG > SG > SF > PF > C
      for (const pos of POS) { if (starterMatches.includes(pos)) return pos; }
    }

    // 2) Scan by rows (depth index) then by POS order
    const maxDepth = Math.max(
      ...(POS.map(p => (Array.isArray(roster[p]) ? roster[p].length : 0)))
    );
    for (let depth = 1; depth < maxDepth; depth++) {
      for (const pos of POS) {
        if (matchAt(pos, depth)) return pos;
      }
    }

    return null;
  } catch { return null; }
}

