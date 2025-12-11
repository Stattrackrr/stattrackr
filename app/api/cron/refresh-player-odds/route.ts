export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cronAuth";
import { checkRateLimit, strictRateLimiter } from "@/lib/rateLimit";
import { getNBACache, setNBACache } from "@/lib/nbaCache";
import { refreshOddsData } from "@/lib/refreshOdds";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

/**
 * Cron job to refresh player odds
 * 
 * Phase 1: Initial scan (every 120 minutes)
 * - Gets all players with games today/tomorrow
 * - Fetches their stats and odds
 * - Caches for 120 minutes
 * 
 * Phase 2: Update scan (runs more frequently)
 * - Only updates lines that changed
 * - Preserves unchanged lines
 */

const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
const PLAYER_ODDS_CACHE_PREFIX = 'player_odds:';
const PLAYER_STATS_CACHE_PREFIX = 'player_stats:';
const CACHE_TTL_MINUTES = 120; // 2 hours
const HOURS_BETWEEN_PLAYER_SCANS = 20; // Only process players once per day
const PLAYER_SCAN_BUDGET_MS = 4 * 60 * 1000; // 4 minutes to stay under Vercel's 5m limit
const PLAYER_SCAN_BATCH_SIZE = 5; // smaller batch to reduce spikes
const LAST_FULL_SCAN_KEY = 'player_odds:last_full_scan';
const PLAYER_SCAN_CHECKPOINT_KEY = 'player_odds:last_full_scan_checkpoint';

// Only these bookmakers will be included (all others excluded to reduce API calls)
const ALLOWED_BOOKMAKERS: string[] = [
  'draftkings',
  'fanduel',
  'prizepicks',
  'prize picks', // Handle space variation
  'underdog',
  'underdog fantasy',
  'fanatics',
  'fanatics sportsbook',
  'fanatics betting and gaming',
  'caesars',
];

/**
 * Check if a bookmaker is in the allowed list
 */
function isAllowedBookmaker(bookmakerName: string): boolean {
  if (!bookmakerName) return false;
  const normalized = bookmakerName.toLowerCase().trim().replace(/[.\s]/g, '');
  return ALLOWED_BOOKMAKERS.some(allowed => {
    const normalizedAllowed = allowed.toLowerCase().trim().replace(/[.\s]/g, '');
    return normalized === normalizedAllowed || 
           normalized.includes(normalizedAllowed) ||
           normalizedAllowed.includes(normalized);
  });
}

interface PlayerOddsCache {
  playerName: string;
  playerId?: string;
  team: string;
  opponent: string;
  gameId: string;
  gameDate: string;
  stats: {
    // Player stats from BDL or NBA Stats
    [key: string]: any;
  };
  odds: {
    // Odds per bookmaker per stat
    [bookmaker: string]: {
      [stat: string]: {
        line: string;
        over: string;
        under: string;
        lastUpdated: string;
      }[];
    };
  };
  lastFullScan: string; // ISO timestamp
  lastUpdateScan: string; // ISO timestamp
}

/**
 * Get all players with games today or tomorrow (in US Eastern Time)
 * NBA games are scheduled in US Eastern Time, so we need to use ET dates
 */
async function getPlayersWithGames(): Promise<Array<{
  playerId: string;
  playerName: string;
  team: string;
  opponent: string;
  gameId: string;
  gameDate: string;
}>> {
  try {
    // Get dates in US Eastern Time (NBA games are scheduled in ET)
    const getUSEasternDateString = (date: Date): string => {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(date).replace(/(\d+)\/(\d+)\/(\d+)/, (_, month, day, year) => {
        // Convert MM/DD/YYYY to YYYY-MM-DD
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      });
    };
    
    const now = new Date();
    const todayUSET = getUSEasternDateString(now);
    const tomorrowUSET = getUSEasternDateString(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    
    console.log(`[CRON] 📅 Using US Eastern Time dates: today=${todayUSET}, tomorrow=${tomorrowUSET}`);
    
    const BDL_BASE = 'https://api.balldontlie.io/v1';
    const BDL_HEADERS: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'StatTrackr/1.0',
      Authorization: `Bearer ${process.env.BALLDONTLIE_API_KEY || '9823adcf-57dc-4036-906d-aeb9f0003cfd'}`,
    };
    
    // Fetch games for today and tomorrow (in US ET)
    const gamesUrl = new URL(`${BDL_BASE}/games`);
    gamesUrl.searchParams.set('per_page', '100');
    gamesUrl.searchParams.set('dates[]', todayUSET);
    gamesUrl.searchParams.append('dates[]', tomorrowUSET);
    
    const gamesResponse = await fetch(gamesUrl.toString(), { headers: BDL_HEADERS, cache: 'no-store' });
    if (!gamesResponse.ok) {
      throw new Error(`BDL API error: ${gamesResponse.status}`);
    }
    
    const gamesData = await gamesResponse.json();
    const games = Array.isArray(gamesData?.data) ? gamesData.data : [];
    
    // Get team ID to abbreviation mapping
    const ABBR_TO_TEAM_ID_BDL: Record<string, number> = {
      ATL:1,BOS:2,BKN:3,CHA:4,CHI:5,CLE:6,DAL:7,DEN:8,DET:9,GSW:10,
      HOU:11,IND:12,LAC:13,LAL:14,MEM:15,MIA:16,MIL:17,MIN:18,NOP:19,NYK:20,
      OKC:21,ORL:22,PHI:23,PHX:24,POR:25,SAC:26,SAS:27,TOR:28,UTA:29,WAS:30,
    };
    
    const teamIdToAbbr: Record<number, string> = {};
    Object.entries(ABBR_TO_TEAM_ID_BDL).forEach(([abbr, id]) => {
      teamIdToAbbr[id] = abbr;
    });
    
    const players: Array<{
      playerId: string;
      playerName: string;
      team: string;
      opponent: string;
      gameId: string;
      gameDate: string;
    }> = [];
    
    // For each game, fetch players from both teams
    for (const game of games) {
      const homeId = game.home_team?.id;
      const visitorId = game.visitor_team?.id;
      const homeAbbr = homeId ? teamIdToAbbr[homeId] : null;
      const awayAbbr = visitorId ? teamIdToAbbr[visitorId] : null;
      
      if (!homeAbbr || !awayAbbr) continue;
      
      // Parse game date and convert to US ET if needed
      let gameDate: string;
      if (game.date) {
        if (typeof game.date === 'string') {
          gameDate = game.date.split('T')[0];
        } else {
          // Convert to US ET date string
          gameDate = getUSEasternDateString(new Date(game.date));
        }
      } else {
        gameDate = todayUSET; // Fallback to today in US ET
      }
      const gameId = String(game.id);
      
      // Fetch players for home team
      const homePlayersUrl = new URL(`${BDL_BASE}/players`);
      homePlayersUrl.searchParams.set('per_page', '100');
      homePlayersUrl.searchParams.append('team_ids[]', String(homeId));
      
      const homePlayersResponse = await fetch(homePlayersUrl.toString(), { headers: BDL_HEADERS, cache: 'no-store' });
      if (homePlayersResponse.ok) {
        const homePlayersData = await homePlayersResponse.json();
        const homePlayers = Array.isArray(homePlayersData?.data) ? homePlayersData.data : [];
        
        for (const player of homePlayers) {
          if (player.first_name && player.last_name) {
            players.push({
              playerId: String(player.id),
              playerName: `${player.first_name} ${player.last_name}`,
              team: homeAbbr,
              opponent: awayAbbr,
              gameId,
              gameDate,
            });
          }
        }
      }
      
      // Fetch players for away team
      const awayPlayersUrl = new URL(`${BDL_BASE}/players`);
      awayPlayersUrl.searchParams.set('per_page', '100');
      awayPlayersUrl.searchParams.append('team_ids[]', String(visitorId));
      
      const awayPlayersResponse = await fetch(awayPlayersUrl.toString(), { headers: BDL_HEADERS, cache: 'no-store' });
      if (awayPlayersResponse.ok) {
        const awayPlayersData = await awayPlayersResponse.json();
        const awayPlayers = Array.isArray(awayPlayersData?.data) ? awayPlayersData.data : [];
        
        for (const player of awayPlayers) {
          if (player.first_name && player.last_name) {
            players.push({
              playerId: String(player.id),
              playerName: `${player.first_name} ${player.last_name}`,
              team: awayAbbr,
              opponent: homeAbbr,
              gameId,
              gameDate,
            });
          }
        }
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return players;
  } catch (error: any) {
    console.error('[refresh-player-odds] Error getting players with games:', error.message);
    return [];
  }
}

/**
 * Get player stats from BDL (with caching)
 */
async function getPlayerStats(playerId: string, season: number): Promise<Record<string, any>> {
  // Check cache first (player stats don't change until next game)
  const statsCacheKey = `${PLAYER_STATS_CACHE_PREFIX}${playerId}:${season}`;
  const cachedStats = await getNBACache<Record<string, any>>(statsCacheKey, { quiet: true });
  if (cachedStats && Object.keys(cachedStats).length > 0) {
    return cachedStats;
  }
  
  try {
    const BDL_BASE = 'https://api.balldontlie.io/v1';
    const BDL_HEADERS: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'StatTrackr/1.0',
      Authorization: `Bearer ${process.env.BALLDONTLIE_API_KEY || '9823adcf-57dc-4036-906d-aeb9f0003cfd'}`,
    };
    
    // Get player stats for current season
    const statsUrl = new URL(`${BDL_BASE}/stats`);
    statsUrl.searchParams.set('per_page', '100');
    statsUrl.searchParams.set('player_ids[]', playerId);
    statsUrl.searchParams.set('seasons[]', String(season));
    
    const statsResponse = await fetch(statsUrl.toString(), { headers: BDL_HEADERS, cache: 'no-store' });
    if (!statsResponse.ok) {
      return {};
    }
    
    const statsData = await statsResponse.json();
    const stats = Array.isArray(statsData?.data) ? statsData.data : [];
    
    // Calculate averages
    if (stats.length === 0) return {};
    
    const totals = stats.reduce((acc: any, stat: any) => ({
      pts: (acc.pts || 0) + (stat.pts || 0),
      reb: (acc.reb || 0) + (stat.reb || 0),
      ast: (acc.ast || 0) + (stat.ast || 0),
      blk: (acc.blk || 0) + (stat.blk || 0),
      stl: (acc.stl || 0) + (stat.stl || 0),
      turnover: (acc.turnover || 0) + (stat.turnover || 0),
      fg3m: (acc.fg3m || 0) + (stat.fg3m || 0),
      games: acc.games + 1,
    }), { pts: 0, reb: 0, ast: 0, blk: 0, stl: 0, turnover: 0, fg3m: 0, games: 0 });
    
    const result = {
      pts: totals.games > 0 ? (totals.pts / totals.games).toFixed(1) : '0.0',
      reb: totals.games > 0 ? (totals.reb / totals.games).toFixed(1) : '0.0',
      ast: totals.games > 0 ? (totals.ast / totals.games).toFixed(1) : '0.0',
      blk: totals.games > 0 ? (totals.blk / totals.games).toFixed(1) : '0.0',
      stl: totals.games > 0 ? (totals.stl / totals.games).toFixed(1) : '0.0',
      turnover: totals.games > 0 ? (totals.turnover / totals.games).toFixed(1) : '0.0',
      fg3m: totals.games > 0 ? (totals.fg3m / totals.games).toFixed(1) : '0.0',
      games: totals.games,
    };
    
    // Cache stats for 24 hours (they only change after games)
    await setNBACache(statsCacheKey, 'player_stats', result, 24 * 60, true);
    
    return result;
  } catch (error: any) {
    console.error(`[refresh-player-odds] Error getting stats for player ${playerId}:`, error.message);
    return {};
  }
}

/**
 * Extract player odds from the bulk odds cache
 */
function extractPlayerOddsFromBulkCache(
  playerName: string,
  team: string,
  bulkOddsCache: any
): PlayerOddsCache['odds'] {
  const playerOdds: PlayerOddsCache['odds'] = {};
  
  if (!bulkOddsCache?.games) return playerOdds;
  
  // Find the game for this player's team
  const game = bulkOddsCache.games.find((g: any) => 
    g.homeTeam === team || g.awayTeam === team
  );
  
  if (!game || !game.playerPropsByBookmaker) return playerOdds;
  
  // Extract odds for this player from each bookmaker
  for (const [bookmakerName, playerProps] of Object.entries(game.playerPropsByBookmaker)) {
    // Only include allowed bookmakers
    if (!isAllowedBookmaker(bookmakerName)) {
      continue;
    }
    
    const playerData = (playerProps as any)[playerName];
    if (!playerData) continue;
    
    playerOdds[bookmakerName] = {};
    
    // Extract each stat's odds
    const stats = ['PTS', 'REB', 'AST', 'THREES', 'BLK', 'STL', 'TO', 'PRA', 'PR', 'PA', 'RA'];
    for (const stat of stats) {
      const statOdds = playerData[stat];
      if (statOdds && Array.isArray(statOdds)) {
        playerOdds[bookmakerName][stat] = statOdds.map((entry: any) => ({
          line: entry.line || '',
          over: entry.over || '',
          under: entry.under || '',
          lastUpdated: new Date().toISOString(),
        }));
      }
    }
  }
  
  return playerOdds;
}

/**
 * Compare two odds entries to see if they changed
 */
function oddsChanged(
  oldEntry: { line: string; over: string; under: string },
  newEntry: { line: string; over: string; under: string }
): boolean {
  return oldEntry.line !== newEntry.line ||
         oldEntry.over !== newEntry.over ||
         oldEntry.under !== newEntry.under;
}

/**
 * Update player odds cache, only updating changed lines
 */
async function updatePlayerOddsCache(
  player: {
    playerId: string;
    playerName: string;
    team: string;
    opponent: string;
    gameId: string;
    gameDate: string;
  },
  isFullScan: boolean,
  bulkOddsResult: any
): Promise<{ updated: number; unchanged: number }> {
  const cacheKey = `${PLAYER_ODDS_CACHE_PREFIX}${player.playerId}:${player.gameId}`;
  
  // Get existing cache
  const existingCache = await getNBACache<PlayerOddsCache>(cacheKey, { quiet: true });
  
  if (!bulkOddsResult) {
    console.warn(`[refresh-player-odds] No bulk odds data for ${player.playerName}`);
    return { updated: 0, unchanged: 0 };
  }
  
  // Get current season
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const season = currentMonth >= 9 ? currentYear : currentYear - 1; // NBA season starts in October
  
  // Get player stats
  const stats = await getPlayerStats(player.playerId, season);
  
  // Extract player odds from bulk cache
  const newOdds = extractPlayerOddsFromBulkCache(player.playerName, player.team, bulkOddsResult);
  
  let updated = 0;
  let unchanged = 0;
  
  if (isFullScan || !existingCache) {
    // Full scan: replace everything
    const playerCache: PlayerOddsCache = {
      playerName: player.playerName,
      playerId: player.playerId,
      team: player.team,
      opponent: player.opponent,
      gameId: player.gameId,
      gameDate: player.gameDate,
      stats,
      odds: newOdds,
      lastFullScan: new Date().toISOString(),
      lastUpdateScan: new Date().toISOString(),
    };
    
    await setNBACache(cacheKey, 'player_odds', playerCache, CACHE_TTL_MINUTES, true);
    // Count all lines across all bookmakers and stats
    for (const bookmakerOdds of Object.values(newOdds)) {
      for (const statOdds of Object.values(bookmakerOdds)) {
        if (Array.isArray(statOdds)) {
          updated += statOdds.length;
        }
      }
    }
  } else {
    // Update scan: only update changed lines
    const updatedOdds: PlayerOddsCache['odds'] = { ...existingCache.odds };
    
    for (const [bookmaker, statOdds] of Object.entries(newOdds)) {
      if (!updatedOdds[bookmaker]) {
        updatedOdds[bookmaker] = {};
      }
      
      for (const [stat, entries] of Object.entries(statOdds)) {
        const existingEntries = updatedOdds[bookmaker][stat] || [];
        
        // Compare each entry
        const updatedEntries = entries.map((newEntry) => {
          const existingEntry = existingEntries.find(
            (e: any) => e.line === newEntry.line
          );
          
          if (!existingEntry) {
            updated++;
            return newEntry;
          }
          
          if (oddsChanged(existingEntry, newEntry)) {
            updated++;
            return newEntry;
          }
          
          unchanged++;
          // Keep existing entry with its original timestamp
          return existingEntry;
        });
        
        updatedOdds[bookmaker][stat] = updatedEntries;
      }
    }
    
    const playerCache: PlayerOddsCache = {
      ...existingCache,
      stats, // Update stats too
      odds: updatedOdds,
      lastUpdateScan: new Date().toISOString(),
    };
    
    await setNBACache(cacheKey, 'player_odds', playerCache, CACHE_TTL_MINUTES, true);
  }
  
  return { updated, unchanged };
}

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  console.log(`[CRON] 🕐 refresh-player-odds started at ${timestamp}`);
  
  const authResult = authorizeCronRequest(req);
  if (!authResult.authorized) {
    console.log(`[CRON] ❌ refresh-player-odds unauthorized`);
    return authResult.response;
  }

  const rateResult = checkRateLimit(req, strictRateLimiter);
  if (!rateResult.allowed && rateResult.response) {
    console.log(`[CRON] ⚠️ refresh-player-odds rate limited`);
    return rateResult.response;
  }

  try {
    // Always refresh bulk odds cache (this is fast and keeps the cache warm)
    console.log(`[CRON] 🔄 refresh-player-odds: Refreshing bulk odds cache...`);
    const bulkOddsResult = await refreshOddsData({ source: 'cron/refresh-player-odds' });
    if (!bulkOddsResult) {
      return NextResponse.json({
        success: false,
        error: 'Failed to refresh bulk odds cache',
      }, { status: 500 });
    }
    console.log(`[CRON] ✅ Bulk odds cache refreshed successfully`);
    
    // Check if we should do per-player processing (only once per day when new odds are released)
    const lastFullScan = await getNBACache<string>(LAST_FULL_SCAN_KEY, { quiet: true });
    const now = Date.now();
    const lastFullScanTime = lastFullScan ? new Date(lastFullScan).getTime() : 0;
    const timeSinceLastFullScan = now - lastFullScanTime;
    const shouldDoPlayerScan = !lastFullScan || 
      timeSinceLastFullScan >= (HOURS_BETWEEN_PLAYER_SCANS * 60 * 60 * 1000);
    
    if (!shouldDoPlayerScan) {
      const elapsed = Date.now() - startTime;
      const hoursSinceLastScan = Math.round(timeSinceLastFullScan / (60 * 60 * 1000));
      console.log(`[CRON] ⏭️ Skipping per-player processing (last scan was ${hoursSinceLastScan} hours ago, only needed once per day)`);
      
      return NextResponse.json({
        success: true,
        bulkOddsRefreshed: true,
        playerScanSkipped: true,
        hoursSinceLastPlayerScan: hoursSinceLastScan,
        elapsed: `${elapsed}ms`,
        timestamp,
        message: 'Bulk odds refreshed, per-player scan skipped (only needed once per day)',
      });
    }
    
    // Do per-player processing (only once per day)
    console.log(`[CRON] 🔄 Starting per-player processing (once per day when new odds are released)...`);
    
    const players = await getPlayersWithGames();
    console.log(`[CRON] Found ${players.length} players with games`);
    
    if (players.length === 0) {
      return NextResponse.json({
        success: true,
        bulkOddsRefreshed: true,
        message: 'Bulk odds refreshed, but no players with games today/tomorrow',
        playersProcessed: 0,
      });
    }
    
    let totalUpdated = 0;
    let totalUnchanged = 0;
    let processed = 0;
    let errors = 0;
    
    // Resume from checkpoint if previous run stopped early
    const checkpoint = await getNBACache<{ index: number; timestamp: string }>(PLAYER_SCAN_CHECKPOINT_KEY, { quiet: true });
    let startIndex = 0;
    if (checkpoint?.index !== undefined) {
      const checkpointAge = checkpoint.timestamp ? now - new Date(checkpoint.timestamp).getTime() : Number.MAX_SAFE_INTEGER;
      // If checkpoint older than 26h, reset
      if (checkpointAge < 26 * 60 * 60 * 1000) {
        startIndex = checkpoint.index;
        console.log(`[CRON] Resuming per-player processing from checkpoint index ${startIndex}`);
      } else {
        console.log('[CRON] Checkpoint expired, starting from beginning');
      }
    }

    const startProcessingTime = Date.now();
    let i = startIndex;
    for (; i < players.length; i += PLAYER_SCAN_BATCH_SIZE) {
      const batch = players.slice(i, i + PLAYER_SCAN_BATCH_SIZE);
      
      const batchResults = await Promise.allSettled(
        batch.map(player => updatePlayerOddsCache(player, true, bulkOddsResult))
      );
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          totalUpdated += result.value.updated;
          totalUnchanged += result.value.unchanged;
          processed++;
        } else {
          errors++;
          console.error('[CRON] Error processing player:', result.reason);
        }
      }
      
      // Delay between batches
      if (i + PLAYER_SCAN_BATCH_SIZE < players.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Stop if we are close to the time budget
      const elapsedBudget = Date.now() - startProcessingTime;
      if (elapsedBudget >= PLAYER_SCAN_BUDGET_MS) {
        const nextIndex = i + PLAYER_SCAN_BATCH_SIZE;
        await setNBACache(PLAYER_SCAN_CHECKPOINT_KEY, 'metadata', { index: nextIndex, timestamp: new Date().toISOString() }, 26 * 60, true);
        const elapsed = Date.now() - startTime;
        console.log(`[CRON] ⏱️ Time budget reached, stopping at index ${nextIndex}/${players.length} after ${elapsedBudget}ms`);
        return NextResponse.json({
          success: true,
          bulkOddsRefreshed: true,
          playerScanCompleted: false,
          checkpointIndex: nextIndex,
          playersProcessed: processed,
          totalPlayers: players.length,
          updated: totalUpdated,
          unchanged: totalUnchanged,
          errors,
          elapsed: `${elapsed}ms`,
          timestamp,
          message: 'Bulk odds refreshed; per-player scan paused at checkpoint (will resume next run)',
        });
      }
    }
    
    // Finished all players: clear checkpoint and update last full scan timestamp
    await setNBACache(PLAYER_SCAN_CHECKPOINT_KEY, 'metadata', null as any, 1, true);
    await setNBACache(LAST_FULL_SCAN_KEY, 'metadata', new Date().toISOString(), 24 * 60, true);
    
    const elapsed = Date.now() - startTime;
    console.log(`[CRON] ✅ refresh-player-odds completed in ${elapsed}ms: bulk odds refreshed, ${processed} players processed, ${totalUpdated} lines updated, ${totalUnchanged} unchanged, ${errors} errors`);
    
    return NextResponse.json({
      success: true,
      bulkOddsRefreshed: true,
      playerScanCompleted: true,
      playersProcessed: processed,
      totalPlayers: players.length,
      updated: totalUpdated,
      unchanged: totalUnchanged,
      errors,
      elapsed: `${elapsed}ms`,
      timestamp,
      message: 'Bulk odds refreshed and per-player scan completed',
    });
  } catch (e: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[CRON] ❌ refresh-player-odds failed after ${elapsed}ms:`, e.message);
    return NextResponse.json(
      { 
        success: false, 
        error: e?.message || 'Refresh player odds failed',
        elapsed: `${elapsed}ms`,
        timestamp 
      },
      { status: 500 }
    );
  }
}

