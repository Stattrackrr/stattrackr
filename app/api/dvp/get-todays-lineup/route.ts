/**
 * Get today's starting lineup for a team from BasketballMonsters
 * Returns the actual starting 5 with verified/projected status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getNBACache } from '@/lib/nbaCache';

export const runtime = "edge";
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const teamAbbr = searchParams.get('team')?.toUpperCase();
    
    if (!teamAbbr) {
      return NextResponse.json({ error: 'Team abbreviation required' }, { status: 400 });
    }
    
    // Get today's and tomorrow's dates (Eastern Time to match BasketballMonsters)
    // BasketballMonsters shows tomorrow's games on the main page if there are no games today
    const now = new Date();
    const easternTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayStr = `${easternTime.getFullYear()}-${String(easternTime.getMonth() + 1).padStart(2, '0')}-${String(easternTime.getDate()).padStart(2, '0')}`;
    
    // Calculate tomorrow
    const tomorrow = new Date(easternTime);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    
    // Check cache for today's lineup first
    let cacheKey = `basketballmonsters:lineup:${teamAbbr}:${todayStr}`;
    let cached = await getNBACache<Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }>>(cacheKey);
    let targetDate = todayStr;
    
    // If no lineup for today, check tomorrow (BasketballMonsters shows tomorrow if no games today)
    if (!cached || !Array.isArray(cached) || cached.length !== 5) {
      cacheKey = `basketballmonsters:lineup:${teamAbbr}:${tomorrowStr}`;
      cached = await getNBACache<Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }>>(cacheKey);
      targetDate = tomorrowStr;
    }
    
    if (cached && Array.isArray(cached) && cached.length === 5) {
      return NextResponse.json({
        team: teamAbbr,
        date: targetDate,
        lineup: cached,
        source: 'cache'
      });
    }
    
    // If not in cache, check if we should fetch it (only if fetchIfMissing=true)
    const fetchIfMissing = searchParams.get('fetchIfMissing') === 'true';
    
    if (fetchIfMissing) {
      // Trigger server-side fetch (one-time, not from frontend)
      try {
        // Use the request URL to get the origin
        const origin = req.nextUrl.origin || (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
        const fetchUrl = `${origin}/api/dvp/fetch-basketballmonsters-lineups?team=${teamAbbr}&season=2025&bypassCache=false`;
        
        // Fire and forget - don't wait for response
        fetch(fetchUrl).catch(err => {
          if (process.env.NODE_ENV !== 'production') {
            console.error('[GetTodaysLineup] Background fetch error:', err);
          }
        });
        
        // Wait a moment for cache to populate, then check again
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Check cache again after fetch
        const recheckCache = await getNBACache<Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }>>(cacheKey);
        if (recheckCache && Array.isArray(recheckCache) && recheckCache.length === 5) {
          return NextResponse.json({
            team: teamAbbr,
            date: targetDate,
            lineup: recheckCache,
            source: 'cache_after_fetch'
          });
        }
        
        // Still not available - return fetching status
        return NextResponse.json({
          team: teamAbbr,
          date: targetDate,
          lineup: null,
          source: 'fetching',
          message: 'Lineup is being fetched. Please try again in a moment.'
        });
      } catch (error: any) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[GetTodaysLineup] Failed to trigger fetch:', error);
        }
      }
    }
    
    // If not in cache and not fetching, return null
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[GetTodaysLineup] Cache miss for ${teamAbbr} on ${todayStr} or ${tomorrowStr}`);
    }
    
    return NextResponse.json({
      team: teamAbbr,
      date: targetDate,
      lineup: null,
      source: 'not_found',
      message: 'Lineup not yet cached. It will be fetched in the background.'
    });
    
  } catch (error: any) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[GetTodaysLineup] Error:', error);
    }
    return NextResponse.json(
      { error: error.message || 'Failed to fetch lineup' },
      { status: 500 }
    );
  }
}

