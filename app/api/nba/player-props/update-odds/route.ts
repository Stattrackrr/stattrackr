/**
 * Update player props with new odds/lines while preserving calculated stats
 * Called after odds refresh to update lines without reprocessing stats
 */

import { NextRequest, NextResponse } from 'next/server';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import { cache } from '@/lib/cache';
import { getGameDateFromOddsCache } from '@/lib/refreshOdds';
import type { OddsCache } from '@/app/api/odds/refresh/route';
import { TEAM_FULL_TO_ABBR } from '@/lib/teamMapping';

const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
const PLAYER_PROPS_CACHE_PREFIX = 'nba-player-props';

function getPlayerPropsCacheKey(gameDate: string): string {
  return `${PLAYER_PROPS_CACHE_PREFIX}-${gameDate}`;
}

function parseAmericanOdds(oddsStr: string): number | null {
  if (!oddsStr || oddsStr === 'N/A') return null;
  const cleaned = oddsStr.replace(/[^0-9+-]/g, '');
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) return null;
  return num >= 0 ? (num / 100) + 1 : (100 / Math.abs(num)) + 1;
}

function americanToImpliedProb(american: number): number {
  if (american >= 0) {
    return 100 / (american + 100);
  } else {
    return Math.abs(american) / (Math.abs(american) + 100);
  }
}

function calculateImpliedProbabilities(overOddsStr: string, underOddsStr: string): { overImpliedProb: number; underImpliedProb: number } | null {
  try {
    const overNum = parseFloat(overOddsStr.replace(/[^0-9+-]/g, ''));
    const underNum = parseFloat(underOddsStr.replace(/[^0-9+-]/g, ''));
    
    if (isNaN(overNum) || isNaN(underNum)) return null;
    
    const overProb = americanToImpliedProb(overNum);
    const underProb = americanToImpliedProb(underNum);
    
    // Normalize to sum to 1.0 (account for vig)
    const total = overProb + underProb;
    if (total === 0) return null;
    
    return {
      overImpliedProb: overProb / total,
      underImpliedProb: underProb / total,
    };
  } catch {
    return null;
  }
}

/**
 * Recalculate hit rates based on new line (preserving stat values)
 */
function recalculateHitRates(
  statValues: number[] | undefined,
  newLine: number
): { hits: number; total: number } | null {
  if (!statValues || statValues.length === 0 || !Number.isFinite(newLine)) {
    return null;
  }
  
  const hits = statValues.filter(val => val > newLine).length;
  return { hits, total: statValues.length };
}

/**
 * Update a single prop with new odds while preserving stats
 */
function updatePropWithNewOdds(
  oldProp: any,
  newLine: number,
  newOverOdds: string,
  newUnderOdds: string
): any {
  // Parse new odds
  const overOddsDecimal = parseAmericanOdds(newOverOdds);
  const underOddsDecimal = parseAmericanOdds(newUnderOdds);
  
  if (overOddsDecimal === null || underOddsDecimal === null) {
    return oldProp; // Keep old prop if new odds are invalid
  }
  
  // Calculate new probabilities
  const implied = calculateImpliedProbabilities(newOverOdds, newUnderOdds);
  const overProb = implied ? implied.overImpliedProb : americanToImpliedProb(parseFloat(newOverOdds.replace(/[^0-9+-]/g, '')));
  const underProb = implied ? implied.underImpliedProb : americanToImpliedProb(parseFloat(newUnderOdds.replace(/[^0-9+-]/g, '')));
  
  // Recalculate hit rates using stored stat value arrays (if available)
  let last5HitRate = oldProp.last5HitRate;
  let last10HitRate = oldProp.last10HitRate;
  let h2hHitRate = oldProp.h2hHitRate;
  let seasonHitRate = oldProp.seasonHitRate;
  
  // Recalculate hit rates if stat value arrays are stored and line changed
  if (oldProp.__last5Values && Array.isArray(oldProp.__last5Values)) {
    last5HitRate = recalculateHitRates(oldProp.__last5Values, newLine);
  }
  if (oldProp.__last10Values && Array.isArray(oldProp.__last10Values)) {
    last10HitRate = recalculateHitRates(oldProp.__last10Values, newLine);
  }
  if (oldProp.__h2hStats && Array.isArray(oldProp.__h2hStats)) {
    h2hHitRate = recalculateHitRates(oldProp.__h2hStats, newLine);
  }
  if (oldProp.__seasonValues && Array.isArray(oldProp.__seasonValues)) {
    seasonHitRate = recalculateHitRates(oldProp.__seasonValues, newLine);
  }
  
  // Update prop with new odds/lines but preserve all stats
  return {
    ...oldProp,
    line: newLine,
    overOdds: newOverOdds,
    underOdds: newUnderOdds,
    overProb,
    underProb,
    impliedOverProb: overProb,
    impliedUnderProb: underProb,
    bestLine: newLine,
    confidence: Math.max(overProb, underProb) > 70 ? 'High' : Math.max(overProb, underProb) > 65 ? 'Medium' : 'Low',
    // Update bookmakerLines array
    bookmakerLines: [{
      bookmaker: oldProp.bookmaker,
      line: newLine,
      overOdds: newOverOdds,
      underOdds: newUnderOdds,
    }],
    // Preserve all stats (last5Avg, last10Avg, h2hAvg, seasonAvg, streak, dvpRating, etc.)
    // Hit rates are recalculated above using stored stat value arrays
    last5HitRate,
    last10HitRate,
    h2hHitRate,
    seasonHitRate,
  };
}

/**
 * Find matching prop in odds cache
 */
function findMatchingPropInOdds(
  oldProp: any,
  oddsCache: OddsCache
): { line: number; overOdds: string; underOdds: string } | null {
  const games = oddsCache.games || [];
  
  for (const game of games) {
    const homeTeam = game.homeTeam || '';
    const awayTeam = game.awayTeam || '';
    
    // Check if this game matches the prop's teams
    const propTeam = oldProp.team;
    const propOpponent = oldProp.opponent;
    
    // Normalize team names for matching
    const homeTeamAbbr = TEAM_FULL_TO_ABBR[homeTeam] || homeTeam;
    const awayTeamAbbr = TEAM_FULL_TO_ABBR[awayTeam] || awayTeam;
    
    // Try to match teams (handle abbreviations vs full names)
    const gameMatches = 
      (homeTeamAbbr === propTeam || awayTeamAbbr === propTeam) &&
      (homeTeamAbbr === propOpponent || awayTeamAbbr === propOpponent);
    
    if (!gameMatches) continue;
    
    // Look for player props in this game
    const playerProps = game.playerPropsByBookmaker || {};
    
    for (const [bookmakerName, bookmakerProps] of Object.entries(playerProps)) {
      if (bookmakerName !== oldProp.bookmaker) continue;
      
      const playerData = (bookmakerProps as any)[oldProp.playerName];
      if (!playerData) continue;
      
      const statData = playerData[oldProp.statType];
      if (!statData) continue;
      
      const entries = Array.isArray(statData) ? statData : [statData];
      
      // Find best matching line (closest to old line)
      let bestMatch: { line: number; overOdds: string; underOdds: string } | null = null;
      let minDiff = Infinity;
      
      for (const entry of entries) {
        if (!entry || !entry.line || entry.line === 'N/A') continue;
        if (entry.isPickem === true) continue;
        if (entry.variantLabel && (entry.variantLabel.toLowerCase().includes('goblin') || entry.variantLabel.toLowerCase().includes('demon'))) {
          continue;
        }
        
        const line = parseFloat(entry.line);
        if (isNaN(line)) continue;
        
        const overOddsStr = entry.over;
        const underOddsStr = entry.under;
        
        if (!overOddsStr || overOddsStr === 'N/A' || !underOddsStr || underOddsStr === 'N/A') continue;
        
        // Prefer exact match, then closest match
        const diff = Math.abs(line - oldProp.line);
        if (diff < minDiff) {
          minDiff = diff;
          bestMatch = { line, overOdds: overOddsStr, underOdds: underOddsStr };
        }
      }
      
      if (bestMatch) {
        return bestMatch;
      }
    }
  }
  
  return null;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 1 minute max

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    console.log('[Player Props Update Odds] 🔄 Starting odds update for player props...');
    
    // Get current odds cache
    let oddsCache: OddsCache | null = await getNBACache<OddsCache>(ODDS_CACHE_KEY, {
      restTimeoutMs: 10000,
      jsTimeoutMs: 10000,
      quiet: false,
    });
    
    if (!oddsCache) {
      const { cache: inMemoryCache } = await import('@/lib/cache');
      oddsCache = inMemoryCache.get(ODDS_CACHE_KEY);
    }
    
    if (!oddsCache || !oddsCache.lastUpdated) {
      return NextResponse.json({
        success: false,
        error: 'No odds data available',
        message: 'Cannot update player props without odds data'
      }, { status: 503 });
    }
    
    // Get game date and cache key
    const gameDate = getGameDateFromOddsCache(oddsCache);
    const cacheKey = getPlayerPropsCacheKey(gameDate);
    
    console.log(`[Player Props Update Odds] 📅 Updating props for game date: ${gameDate}`);
    console.log(`[Player Props Update Odds] 🔑 Cache key: ${cacheKey}`);
    
    // Load existing player props cache
    let cachedProps: any[] = await getNBACache<any>(cacheKey, {
      restTimeoutMs: 5000,
      jsTimeoutMs: 5000,
      quiet: true,
    });
    
    if (!cachedProps) {
      cachedProps = cache.get<any>(cacheKey);
    }
    
    if (!cachedProps || !Array.isArray(cachedProps) || cachedProps.length === 0) {
      console.log(`[Player Props Update Odds] ⚠️ No existing props cache found - nothing to update`);
      return NextResponse.json({
        success: true,
        message: 'No existing props cache to update',
        updated: 0,
        total: 0
      });
    }
    
    console.log(`[Player Props Update Odds] 📊 Found ${cachedProps.length} existing props, updating odds...`);
    
    // Update each prop with new odds
    let updatedCount = 0;
    let notFoundCount = 0;
    const updatedProps: any[] = [];
    
    for (const oldProp of cachedProps) {
      const match = findMatchingPropInOdds(oldProp, oddsCache);
      
      if (match) {
        const updatedProp = updatePropWithNewOdds(
          oldProp,
          match.line,
          match.overOdds,
          match.underOdds
        );
        updatedProps.push(updatedProp);
        updatedCount++;
      } else {
        // Keep old prop if no match found (odds might have been removed)
        updatedProps.push(oldProp);
        notFoundCount++;
      }
    }
    
    // Save updated props back to cache
    await setNBACache(cacheKey, 'player-props', updatedProps, 24 * 60, false);
    cache.set(cacheKey, updatedProps, 24 * 60);
    
    const elapsed = Date.now() - startTime;
    console.log(`[Player Props Update Odds] ✅ Updated ${updatedCount}/${cachedProps.length} props (${notFoundCount} not found in new odds) in ${elapsed}ms`);
    
    return NextResponse.json({
      success: true,
      message: 'Player props odds updated',
      updated: updatedCount,
      notFound: notFoundCount,
      total: cachedProps.length,
      elapsed: `${elapsed}ms`
    });
    
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[Player Props Update Odds] ❌ Error after ${elapsed}ms:`, error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to update player props odds',
      elapsed: `${elapsed}ms`
    }, { status: 500 });
  }
}

