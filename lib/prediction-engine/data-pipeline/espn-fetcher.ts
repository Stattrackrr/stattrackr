/**
 * ESPN Data Fetcher
 * Fetches injury reports and referee assignments from ESPN
 */

import type { InjuryReport, RefereeData } from '../types';

/**
 * Fetch injuries for specific teams
 * Uses BDL API directly for injuries
 */
export async function fetchInjuries(teams?: string[]): Promise<InjuryReport[]> {
  try {
    const API_KEY = process.env.BALLDONTLIE_API_KEY;
    
    // Build URL with team IDs
    const url = new URL('https://api.balldontlie.io/v1/player_injuries');
    url.searchParams.set('per_page', '100');
    
    // Add team filters if provided
    if (teams && teams.length > 0) {
      teams.forEach(team => {
        const teamId = getTeamIdFromAbbr(team);
        if (teamId) {
          url.searchParams.append('team_ids[]', teamId.toString());
        }
      });
    }
    
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (API_KEY) {
      headers['Authorization'] = API_KEY.startsWith('Bearer ') ? API_KEY : `Bearer ${API_KEY}`;
    }
    
    const response = await fetch(url.toString(), {
      headers,
      cache: 'no-store',
    });
    
    if (!response.ok) {
      console.warn('[ESPN Fetcher] BDL Injuries API error:', response.status);
      return [];
    }
    
    const data = await response.json();
    const injuries = data.data || [];
    
    // Transform to InjuryReport format
    return injuries.map((injury: any) => ({
      playerId: injury.player?.id || 0,
      playerName: `${injury.player?.first_name || ''} ${injury.player?.last_name || ''}`.trim(),
      team: injury.player?.team_id ? getTeamAbbr(injury.player.team_id) : '',
      status: normalizeInjuryStatus(injury.status),
      description: injury.description || '',
      returnDate: injury.return_date || undefined,
    }));
  } catch (error) {
    console.error('[ESPN Fetcher] Error fetching injuries:', error);
    return [];
  }
}

/**
 * Get team ID from abbreviation
 */
function getTeamIdFromAbbr(abbr: string): number | null {
  const teamIdMap: Record<string, number> = {
    ATL: 1, BOS: 2, BKN: 3, CHA: 4, CHI: 5, CLE: 6, DAL: 7, DEN: 8, DET: 9,
    GSW: 10, HOU: 11, IND: 12, LAC: 13, LAL: 14, MEM: 15, MIA: 16, MIL: 17,
    MIN: 18, NOP: 19, NYK: 20, OKC: 21, ORL: 22, PHI: 23, PHX: 24, POR: 25,
    SAC: 26, SAS: 27, TOR: 28, UTA: 29, WAS: 30,
  };
  return teamIdMap[abbr.toUpperCase()] || null;
}

/**
 * Normalize injury status to standard format
 */
function normalizeInjuryStatus(status: string): 'OUT' | 'DOUBTFUL' | 'QUESTIONABLE' | 'PROBABLE' {
  const normalized = status.toUpperCase();
  if (normalized.includes('OUT')) return 'OUT';
  if (normalized.includes('DOUBTFUL')) return 'DOUBTFUL';
  if (normalized.includes('QUESTIONABLE')) return 'QUESTIONABLE';
  if (normalized.includes('PROBABLE')) return 'PROBABLE';
  return 'QUESTIONABLE'; // default
}

/**
 * Get team abbreviation from team ID
 */
function getTeamAbbr(teamId: number): string {
  const teamMap: Record<number, string> = {
    1: 'ATL', 2: 'BOS', 3: 'BKN', 4: 'CHA', 5: 'CHI', 6: 'CLE', 7: 'DAL', 8: 'DEN', 9: 'DET',
    10: 'GSW', 11: 'HOU', 12: 'IND', 13: 'LAC', 14: 'LAL', 15: 'MEM', 16: 'MIA', 17: 'MIL',
    18: 'MIN', 19: 'NOP', 20: 'NYK', 21: 'OKC', 22: 'ORL', 23: 'PHI', 24: 'PHX', 25: 'POR',
    26: 'SAC', 27: 'SAS', 28: 'TOR', 29: 'UTA', 30: 'WAS',
  };
  return teamMap[teamId] || '';
}

/**
 * Fetch referee for a specific game
 * Note: This requires scraping ESPN schedule or using a database
 */
export async function fetchReferee(gameId: string): Promise<RefereeData | null> {
  try {
    // Try to get from database first
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = createClient();
    
    const { data, error } = await supabase
      .from('referee_stats')
      .select('*')
      .limit(1)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    return {
      name: data.referee_name,
      foulsPerGame: data.fouls_per_game || 40,
      pace: data.pace || 100,
      homeBias: data.home_bias || 0,
      totalGames: data.total_games || 0,
    };
  } catch (error) {
    console.error('[ESPN Fetcher] Error fetching referee:', error);
    return null;
  }
}

/**
 * Check if player is injured
 */
export function isPlayerInjured(
  playerId: number,
  injuries: InjuryReport[]
): { injured: boolean; status?: string; impact: number } {
  const injury = injuries.find(inj => inj.playerId === playerId);
  
  if (!injury) {
    return { injured: false, impact: 0 };
  }
  
  // Calculate impact based on status
  let impact = 0;
  switch (injury.status) {
    case 'OUT':
      impact = 1.0; // 100% impact (won't play)
      break;
    case 'DOUBTFUL':
      impact = 0.8; // 80% impact (likely won't play)
      break;
    case 'QUESTIONABLE':
      impact = 0.5; // 50% impact (might play limited)
      break;
    case 'PROBABLE':
      impact = 0.2; // 20% impact (likely plays but limited)
      break;
  }
  
  return {
    injured: true,
    status: injury.status,
    impact,
  };
}

/**
 * Check if key teammates are injured
 */
export function getTeammateInjuries(
  team: string,
  injuries: InjuryReport[],
  excludePlayerId?: number
): InjuryReport[] {
  return injuries.filter(inj => 
    inj.team === team && 
    inj.playerId !== excludePlayerId &&
    (inj.status === 'OUT' || inj.status === 'DOUBTFUL')
  );
}

/**
 * Fetch national TV schedule
 * Note: This should be populated in database manually or via scraping
 * @param teamA One team in the game
 * @param teamB Other team in the game (order doesn't matter)
 */
export async function isNationalTVGame(
  teamA: string,
  teamB: string,
  gameDate: string
): Promise<boolean> {
  try {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = createClient();

    const { data, error } = await supabase
      .from('national_tv_games')
      .select('home_team, away_team')
      .eq('game_date', gameDate);

    if (error || !data) return false;

    const a = (teamA || '').toUpperCase().trim();
    const b = (teamB || '').toUpperCase().trim();
    const match = data.some(
      (row: { home_team?: string; away_team?: string }) =>
        (String(row.home_team || '').toUpperCase() === a && String(row.away_team || '').toUpperCase() === b) ||
        (String(row.home_team || '').toUpperCase() === b && String(row.away_team || '').toUpperCase() === a)
    );
    return match;
  } catch (error) {
    console.error('[ESPN Fetcher] Error checking national TV:', error);
    return false;
  }
}
