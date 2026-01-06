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
    
    // Helper to decode HTML entities (depth chart API returns &#x27; for apostrophes)
    const decodeHtmlEntities = (text: string): string => {
      if (!text) return text;
      return text
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
    };
    
    const fullName = selectedPlayer.full || '';
    const constructed = `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim();
    const names = [fullName, constructed].filter(Boolean) as string[];
    const normalize = (s: string) => {
      // Decode HTML entities first, then normalize
      const decoded = decodeHtmlEntities(s);
      return decoded
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };
    const normNames = names.map(normalize);
    const roster = (playerTeamRoster && Object.keys(playerTeamRoster || {}).length ? playerTeamRoster : allTeamRosters[originalPlayerTeam]) as any;
    if (!roster) return null;
    const POS: Array<'PG' | 'SG' | 'SF' | 'PF' | 'C'> = ['PG', 'SG', 'SF', 'PF', 'C'];

    const matchAt = (pos: 'PG' | 'SG' | 'SF' | 'PF' | 'C', idx: number): boolean => {
      const arr = Array.isArray(roster[pos]) ? roster[pos] : [];
      if (!arr[idx]) return false;
      // Decode HTML entities from depth chart name before normalizing
      const chartNameRaw = String(arr[idx]?.name || '');
      const chartName = decodeHtmlEntities(chartNameRaw);
      const pn = normalize(chartName);
      if (!pn) return false;
      
      // Try multiple matching strategies for names with symbols
      return normNames.some(cand => {
        // Exact match
        if (pn === cand) return true;
        
        // One contains the other (handles partial matches after symbol removal)
        if (pn.includes(cand) || cand.includes(pn)) return true;
        
        // Ends with match (handles "First Last" vs "Last")
        if (pn.endsWith(' ' + cand) || cand.endsWith(' ' + pn)) return true;
        
        // Last name match (for cases where first name differs or has symbols)
        const candParts = cand.split(' ').filter(p => p.length > 0);
        const pnParts = pn.split(' ').filter(p => p.length > 0);
        if (candParts.length >= 2 && pnParts.length >= 2) {
          const candLast = candParts[candParts.length - 1];
          const pnLast = pnParts[pnParts.length - 1];
          // If last names match and first names are similar (one contains the other)
          if (candLast === pnLast) {
            const candFirst = candParts[0];
            const pnFirst = pnParts[0];
            // Match if first names are similar (handles "DeAaron" vs "De'Aaron" after normalization)
            if (candFirst === pnFirst || candFirst.includes(pnFirst) || pnFirst.includes(candFirst)) {
              return true;
            }
          }
        }
        
        return false;
      });
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

