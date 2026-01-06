import { EspnPlayerData, AdvancedStats } from '../types';
import { BallDontLieAPI } from '../api';
import { currentNbaSeason } from './playerUtils';

/**
 * Resolve playerId with best match (if needed)
 */
export async function resolvePlayerId(fullName: string, teamAbbr?: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ q: fullName });
    if (teamAbbr) params.set('team', teamAbbr);
    const res = await fetch(`/api/bdl/players?${params.toString()}`);
    const j = await res.json().catch(() => ({}));
    const best = j?.best;
    return best?.id ? String(best.id) : null;
  } catch {
    return null;
  }
}

/**
 * Parse ESPN height format (total inches or "6'10") into feet and inches
 */
export function parseEspnHeight(height: any): { feet?: number; inches?: number } {
  console.log('🏀 ESPN height data:', height, 'Type:', typeof height);
  
  if (!height) return {};
  
  // If it's a number (total inches)
  if (typeof height === 'number' || /^\d+$/.test(String(height))) {
    const totalInches = parseInt(String(height), 10);
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    console.log(`🏀 Converted ${totalInches}" to ${feet}'${inches}"`);
    return { feet, inches };
  }
  
  // Convert to string for other formats
  const heightStr = String(height);
  
  // ESPN format is like "6'10" or "6'10\"" or "6-10"
  const match = heightStr.match(/(\d+)['-](\d+)/);
  if (match) {
    const feet = parseInt(match[1], 10);
    const inches = parseInt(match[2], 10);
    console.log(`🏀 Parsed height: ${feet}'${inches}"`);
    return { feet, inches };
  }
  
  console.log(`❌ Could not parse height: "${heightStr}"`);
  return {};
}

/**
 * Core function to fetch ESPN player data (without UI state updates)
 */
export async function fetchEspnPlayerDataCore(playerName: string, team?: string): Promise<EspnPlayerData | null> {
  try {
    const params = new URLSearchParams({ name: playerName });
    if (team) params.set('team', team.toLowerCase());
    const res = await fetch(`/api/espn/player?${params.toString()}`);
    const json = await res.json();
    return json.data || null;
  } catch (error) {
    console.warn('Failed to fetch ESPN player data:', error);
    return null;
  }
}

/**
 * Fetch ESPN player data (jersey, height, etc.)
 */
export async function fetchEspnPlayerData(playerName: string, team?: string): Promise<EspnPlayerData | null> {
  return await fetchEspnPlayerDataCore(playerName, team);
}

/**
 * Fetch full player data from Ball Don't Lie API (includes height, jersey_number, etc.)
 */
export async function fetchBdlPlayerData(playerId: string): Promise<any | null> {
  try {
    const res = await fetch(`/api/bdl/player/${playerId}`);
    if (!res.ok) {
      console.warn(`❌ Failed to fetch BDL player data for ${playerId}: ${res.status}`);
      return null;
    }
    const json = await res.json();
    const playerData = json.data || null;
    
    if (playerData) {
      console.log(`✅ BDL player data fetched for ${playerId}:`, {
        jersey_number: playerData.jersey_number,
        height: playerData.height,
        hasJersey: !!playerData.jersey_number && playerData.jersey_number !== '',
        hasHeight: !!playerData.height && playerData.height !== ''
      });
    } else {
      console.warn(`⚠️ BDL player data is null for ${playerId}`);
    }
    
    return playerData;
  } catch (error) {
    console.warn('❌ Failed to fetch BDL player data:', error);
    return null;
  }
}

/**
 * Parse BDL height format (can be "6-10", "6'10\"", or total inches as number/string)
 */
export function parseBdlHeight(height: string | number | null | undefined): { feet?: number; inches?: number } {
  if (!height) return {};
  
  // If it's a number (total inches)
  if (typeof height === 'number' || /^\d+$/.test(String(height))) {
    const totalInches = parseInt(String(height), 10);
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    return { feet, inches };
  }
  
  // Convert to string for parsing
  const heightStr = String(height);
  
  // BDL format is typically "6-10" or "6'10" or "6'10\""
  const match = heightStr.match(/(\d+)['-](\d+)/);
  if (match) {
    const feet = parseInt(match[1], 10);
    const inches = parseInt(match[2], 10);
    return { feet, inches };
  }
  
  return {};
}

/**
 * Core function to fetch advanced stats (without UI state updates)
 */
export async function fetchAdvancedStatsCore(playerId: string): Promise<AdvancedStats | null> {
  const playerIdNum = parseInt(playerId);
  if (isNaN(playerIdNum)) {
    throw new Error('Invalid player ID');
  }
  
  const season = currentNbaSeason();
  let stats = await BallDontLieAPI.getAdvancedStats([playerIdNum], String(season));
  
  if (stats.length === 0) {
    // If no current season stats, try previous season
    stats = await BallDontLieAPI.getAdvancedStats([playerIdNum], String(season - 1));
  }
  
  return stats.length > 0 ? stats[0] : null;
}

/**
 * Core function to fetch shot distance stats (without UI state updates)
 */
export async function fetchShotDistanceStatsCore(playerId: string): Promise<any | null> {
  try {
    const season = currentNbaSeason();
    const response = await fetch(`/api/bdl/shot-distance?player_id=${playerId}&season=${season}`);
    const data = await response.json();
    
    if (data && Array.isArray(data.data) && data.data.length > 0) {
      return data.data[0].stats;
    }
    
    return null;
  } catch (error) {
    console.error('Failed to fetch shot distance stats:', error);
    return null;
  }
}

