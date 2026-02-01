/**
 * Database Fetcher
 * Fetches manual data from Supabase (coaches, arenas, contracts, etc.)
 * Tries real sources (ESPN, static NBA data) first, then DB, then defaults
 */

import type { CoachData, ArenaData, RefereeData } from '../types';
import { fetchCoachFromESPN } from './real-data-fetchers';
import { getArenaFromStatic } from './real-data-fetchers';

/**
 * Fetch coach data for a team
 * 1. Try ESPN API (real source)
 * 2. Try Supabase coach_tendencies
 * 3. Return default
 */
export async function fetchCoachData(team: string): Promise<CoachData | null> {
  try {
    const fromESPN = await fetchCoachFromESPN(team);
    if (fromESPN?.name && fromESPN.name !== 'Unknown') {
      return fromESPN;
    }
  } catch {
    /* ignore, fall through */
  }

  try {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('coach_tendencies')
      .select('*')
      .eq('team', team)
      .single();

    if (!error && data) {
      return {
        name: data.coach_name,
        team: data.team,
        restTendency: data.rest_tendency || 0.5,
        blowoutTendency: data.blowout_tendency || 0.7,
        minutesRestrictionTendency: data.minutes_restriction_tendency || 0.3,
        system: data.system || 'balanced',
        avgStarterMinutes: data.avg_starter_minutes || 32,
      };
    }
  } catch {
    /* ignore */
  }

  return {
    name: 'Unknown',
    team,
    restTendency: 0.5,
    blowoutTendency: 0.7,
    minutesRestrictionTendency: 0.3,
    system: 'balanced',
    avgStarterMinutes: 32,
  };
}

/**
 * Fetch arena data for a team
 * 1. Try static NBA arenas (real data - all 30 teams)
 * 2. Try Supabase arena_factors
 * 3. Return default
 */
export async function fetchArenaData(team: string): Promise<ArenaData | null> {
  const fromStatic = getArenaFromStatic(team);
  if (fromStatic) {
    return fromStatic;
  }

  try {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('arena_factors')
      .select('*')
      .eq('team', team)
      .single();

    if (!error && data) {
      return {
        name: data.arena_name,
        team: data.team,
        city: data.city || '',
        altitude: data.altitude || 0,
        shootingFactor: data.shooting_factor || 1.0,
        homeCourtAdvantage: data.home_court_advantage || 1.0,
        timezone: data.timezone || 'America/New_York',
      };
    }
  } catch {
    /* ignore */
  }

  return {
    name: `${team} Arena`,
    team,
    city: '',
    altitude: 0,
    shootingFactor: 1.0,
    homeCourtAdvantage: 1.0,
    timezone: 'America/New_York',
  };
}

/**
 * Fetch referee data
 */
export async function fetchRefereeData(refereeName: string): Promise<RefereeData | null> {
  try {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from('referee_stats')
      .select('*')
      .eq('referee_name', refereeName)
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
    console.warn('[Database Fetcher] Error fetching referee data:', error);
    return null;
  }
}

/**
 * Check if player is in contract year
 */
export async function isContractYear(playerId: number): Promise<boolean> {
  try {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from('player_contracts')
      .select('contract_year')
      .eq('player_id', playerId)
      .single();
    
    if (error || !data) {
      return false;
    }
    
    return data.contract_year === true;
  } catch (error) {
    console.warn('[Database Fetcher] Error checking contract year:', error);
    return false;
  }
}

/**
 * Get player's former teams (for revenge game modeling)
 */
export async function getFormerTeams(playerId: number): Promise<string[]> {
  try {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from('player_former_teams')
      .select('former_team')
      .eq('player_id', playerId);
    
    if (error || !data) {
      return [];
    }
    
    return data.map(row => row.former_team);
  } catch (error) {
    console.warn('[Database Fetcher] Error fetching former teams:', error);
    return [];
  }
}

/**
 * Calculate distance between two arenas
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate timezone difference between two arenas
 */
export function calculateTimezoneDifference(tz1: string, tz2: string): number {
  try {
    const now = new Date();
    const formatter1 = new Intl.DateTimeFormat('en-US', { timeZone: tz1, hour: 'numeric', hour12: false });
    const formatter2 = new Intl.DateTimeFormat('en-US', { timeZone: tz2, hour: 'numeric', hour12: false });
    
    const hour1 = parseInt(formatter1.format(now));
    const hour2 = parseInt(formatter2.format(now));
    
    return Math.abs(hour1 - hour2);
  } catch (error) {
    console.error('[Database Fetcher] Error calculating timezone difference:', error);
    return 0;
  }
}
