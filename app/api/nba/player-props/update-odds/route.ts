/**
 * Update player props with new odds/lines while preserving calculated stats
 * Called after odds refresh to update lines without reprocessing stats
 */

import { NextRequest, NextResponse } from 'next/server';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import { cache } from '@/lib/cache';
import type { OddsCache } from '@/app/api/odds/refresh/route';
import { TEAM_FULL_TO_ABBR } from '@/lib/teamMapping';
import { PLAYER_ID_MAPPINGS } from '@/lib/playerIdMapping';
import { currentNbaSeason, TEAM_ID_TO_ABBR, ABBR_TO_TEAM_ID } from '@/lib/nbaConstants';
import { queuedFetch } from '@/lib/requestQueue';

const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
const PLAYER_PROPS_CACHE_PREFIX = 'nba-player-props';

function getPlayerPropsCacheKey(gameDate: string): string {
  return `${PLAYER_PROPS_CACHE_PREFIX}-${gameDate}`;
}

/**
 * Get the game date from odds cache in US Eastern Time
 */
function getGameDateFromOddsCache(oddsCache: OddsCache): string {
  const getUSEasternDateString = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date).replace(/(\d+)\/(\d+)\/(\d+)/, (_, month, day, year) => {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    });
  };
  
  const todayUSET = getUSEasternDateString(new Date());
  
  if (!oddsCache.games || oddsCache.games.length === 0) {
    return todayUSET;
  }
  
  const gameDates = new Set<string>();
  for (const game of oddsCache.games) {
    if (!game.commenceTime) continue;
    const commenceStr = String(game.commenceTime).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      gameDates.add(commenceStr);
    } else {
      const date = new Date(commenceStr);
      gameDates.add(getUSEasternDateString(date));
    }
  }
  
  if (gameDates.has(todayUSET)) {
    return todayUSET;
  }
  
  return Array.from(gameDates).sort()[0] || todayUSET;
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

function isPickemBookmaker(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('prizepicks') || 
         lower.includes('underdog') || 
         lower.includes('draftkings pick6') ||
         lower.includes('pick6');
}

function getPlayerIdFromName(playerName: string): string | null {
  if (!playerName || !PLAYER_ID_MAPPINGS.length) return null;
  const mapping = PLAYER_ID_MAPPINGS.find(m => 
    m.name.toLowerCase() === playerName.toLowerCase() ||
    m.name.toLowerCase().includes(playerName.toLowerCase()) ||
    playerName.toLowerCase().includes(m.name.toLowerCase())
  );
  return mapping?.bdlId || null;
}

/**
 * Get base URL for internal API calls
 */
function getBaseUrl(): string {
  // Try to get from environment variables first
  if (process.env.PROD_URL) return process.env.PROD_URL;
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'https://www.stattrackr.co';
}

/**
 * Parse minutes from various formats (number, string "MM:SS", etc.)
 */
function parseMinutes(minVal: any): number {
  if (typeof minVal === 'number') return minVal;
  if (!minVal) return 0;
  const str = String(minVal);
  const match = str.match(/(\d+):(\d+)/);
  if (match) {
    return parseInt(match[1], 10) + parseInt(match[2], 10) / 60;
  }
  return parseFloat(str) || 0;
}

/**
 * Get stat value from game object based on stat type
 */
function getStatValue(game: any, statType: string): number {
  if (statType === 'PRA') {
    return (parseFloat(game.pts || 0) || 0) + (parseFloat(game.reb || 0) || 0) + (parseFloat(game.ast || 0) || 0);
  }
  if (statType === 'PA') {
    return (parseFloat(game.pts || 0) || 0) + (parseFloat(game.ast || 0) || 0);
  }
  if (statType === 'PR') {
    return (parseFloat(game.pts || 0) || 0) + (parseFloat(game.reb || 0) || 0);
  }
  if (statType === 'RA') {
    return (parseFloat(game.reb || 0) || 0) + (parseFloat(game.ast || 0) || 0);
  }
  
  const statMap: Record<string, string> = {
    'PTS': 'pts',
    'REB': 'reb',
    'AST': 'ast',
    'STL': 'stl',
    'BLK': 'blk',
    'THREES': 'fg3m',
  };
  const key = statMap[statType] || statType.toLowerCase();
  const rawValue = game[key];
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return 0;
  }
  const parsed = parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Process new props with full stats calculation (same logic as daily ingestion)
 * This combines the daily ingestion logic into the 30-minute update
 */
async function processNewProps(newProps: any[], oddsCache: OddsCache): Promise<any[]> {
  const processed: any[] = [];
  const baseUrl = getBaseUrl();
  
  // Process all new props in parallel batches (like manual ingestion)
  const propsToProcess = newProps;
  const BATCH_SIZE = 5; // Process 5 props at a time in parallel (same as manual ingestion)
  
  if (propsToProcess.length > 0) {
    console.log(`[Player Props Update Odds] 🆕 Processing ${propsToProcess.length} new props in batches of ${BATCH_SIZE}...`);
  }
  
  for (let i = 0; i < propsToProcess.length; i += BATCH_SIZE) {
    const batch = propsToProcess.slice(i, i + BATCH_SIZE);
    
    // Process batch in parallel
    const batchPromises = batch.map(async (prop) => {
      try {
        // Get player ID
        let playerId = getPlayerIdFromName(prop.playerName);
        if (!playerId) {
          console.warn(`[Player Props Update Odds] ⚠️ No player ID found for ${prop.playerName} - skipping stats calculation`);
          return prop; // Return prop without stats
        }
        
        prop.playerId = playerId;
        
        // Determine player's actual team and position (try both teams)
        let position: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null = null;
        let actualTeam = prop.team;
        let actualOpponent = prop.opponent;
        
        // Try home team first
        position = await getPlayerPositionFromDepthChart(baseUrl, prop.playerName, prop.team);
        
        // If not found, try away team (player might be on away team)
        if (!position) {
          position = await getPlayerPositionFromDepthChart(baseUrl, prop.playerName, prop.opponent);
          if (position) {
            // Player is on away team, swap
            actualTeam = prop.opponent;
            actualOpponent = prop.team;
          }
        }
        
        prop.team = actualTeam;
        prop.opponent = actualOpponent;
        
        // Calculate full stats (last5, last10, h2h, season, hit rates, streak)
        const stats = await calculatePlayerAveragesForNewProp(
          baseUrl,
          playerId,
          prop.playerName,
          prop.statType,
          actualOpponent,
          actualTeam,
          prop.line
        );
        
        // Get DvP rating
        let dvp = { rank: null, statValue: null };
        if (position && actualOpponent) {
          await new Promise(resolve => setTimeout(resolve, 200)); // Small delay
          dvp = await getDvpRatingForNewProp(baseUrl, actualOpponent, position, prop.statType);
        }
        
        // Combine everything
        const processedProp = {
          ...prop,
          ...stats,
          position,
          dvpRating: dvp.rank,
          dvpStatValue: dvp.statValue,
        };
        
        console.log(`[Player Props Update Odds] ✅ Processed new prop: ${prop.playerName} ${prop.statType}`);
        return processedProp;
        
      } catch (error: any) {
        console.error(`[Player Props Update Odds] ⚠️ Error processing new prop for ${prop.playerName}:`, error.message);
        // Still add the prop even if processing fails - it will be enhanced in next update
        return prop;
      }
    });
    
    // Wait for batch to complete
    const batchResults = await Promise.all(batchPromises);
    processed.push(...batchResults);
    
    // Small delay between batches to avoid overwhelming APIs
    if (i + BATCH_SIZE < propsToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between batches (same as manual ingestion)
    }
  }
  
  return processed;
}

/**
 * Get player position from depth chart (simplified version)
 */
async function getPlayerPositionFromDepthChart(baseUrl: string, playerName: string, team: string): Promise<'PG' | 'SG' | 'SF' | 'PF' | 'C' | null> {
  if (!team) return null;
  
  try {
    const teamAbbr = TEAM_FULL_TO_ABBR[team] || team.toUpperCase().trim();
    const url = `${baseUrl}/api/depth-chart?team=${encodeURIComponent(teamAbbr)}`;
    const response = await queuedFetch(url, { cache: 'no-store' });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    if (!data?.success || !data.depthChart) return null;
    
    const normalize = (s: string) => {
      return String(s || '')
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };
    
    const normalizedPlayerName = normalize(playerName);
    const positions: Array<'PG' | 'SG' | 'SF' | 'PF' | 'C'> = ['PG', 'SG', 'SF', 'PF', 'C'];
    
    for (const pos of positions) {
      const players = data.depthChart[pos] || [];
      for (const player of players) {
        const playerNameFromChart = typeof player === 'string' ? player : (player?.name || player?.displayName || '');
        const normalizedChartName = normalize(playerNameFromChart);
        if (normalizedChartName === normalizedPlayerName || 
            normalizedChartName.includes(normalizedPlayerName) ||
            normalizedPlayerName.includes(normalizedChartName)) {
          return pos;
        }
      }
    }
  } catch (error) {
    // Silent fail
  }
  return null;
}

/**
 * Calculate player averages for new prop (full implementation - same as daily ingestion)
 */
async function calculatePlayerAveragesForNewProp(
  baseUrl: string,
  playerId: string,
  playerName: string,
  statType: string,
  opponent: string,
  playerTeam: string,
  line: number
): Promise<any> {
  if (!playerId) {
    return {
      last5Avg: null,
      last10Avg: null,
      h2hAvg: null,
      seasonAvg: null,
      last5HitRate: null,
      last10HitRate: null,
      h2hHitRate: null,
      seasonHitRate: null,
      streak: null,
      __last5Values: [],
      __last10Values: [],
      __h2hStats: [],
      __seasonValues: [],
    };
  }

  try {
    const currentSeason = currentNbaSeason();
    const allStats: any[] = [];

    // Fetch stats for current and previous season (regular only for speed)
    for (const season of [currentSeason, currentSeason - 1]) {
      try {
        const url = `${baseUrl}/api/stats?player_id=${playerId}&season=${season}&per_page=100&max_pages=3&postseason=false`;
        const response = await queuedFetch(url, { cache: 'no-store' });
        if (response.ok || response.status === 429) {
          const json = await response.json().catch(() => ({}));
          const data = Array.isArray(json?.data) ? json.data : [];
          allStats.push(...data);
        }
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (e) {
        // Continue on error
      }
    }

    // Filter, deduplicate, and sort stats
    const validStats = allStats.filter(s => s && (s?.game?.date || s?.team?.abbreviation));
    const uniqueStatsMap = new Map();
    for (const stat of validStats) {
      const gameId = stat?.game?.id;
      if (gameId && !uniqueStatsMap.has(gameId)) {
        uniqueStatsMap.set(gameId, stat);
      }
    }
    const uniqueStats = Array.from(uniqueStatsMap.values());
    uniqueStats.sort((a: any, b: any) => {
      const da = a?.game?.date ? new Date(a.game.date).getTime() : 0;
      const db = b?.game?.date ? new Date(b.game.date).getTime() : 0;
      return db - da; // newest first
    });

    // Filter games with minutes > 0
    const gamesWithMinutes = uniqueStats.filter((stats: any) => {
      const minutes = parseMinutes(stats.min);
      return minutes > 0;
    });

    // Get stat values
    const gamesWithStats = gamesWithMinutes
      .map((stats: any) => ({
        ...stats,
        statValue: getStatValue(stats, statType),
      }))
      .filter((stats: any) => Number.isFinite(stats.statValue))
      .sort((a: any, b: any) => {
        const dateA = a?.game?.date ? new Date(a.game.date).getTime() : 0;
        const dateB = b?.game?.date ? new Date(b.game.date).getTime() : 0;
        return dateB - dateA;
      });

    if (gamesWithStats.length === 0) {
      return {
        last5Avg: null,
        last10Avg: null,
        h2hAvg: null,
        seasonAvg: null,
        last5HitRate: null,
        last10HitRate: null,
        h2hHitRate: null,
        seasonHitRate: null,
        streak: null,
        __last5Values: [],
        __last10Values: [],
        __h2hStats: [],
        __seasonValues: [],
      };
    }

    // Filter to current season games only
    const getSeasonYear = (stats: any) => {
      if (!stats?.game?.date) return null;
      const gameDate = new Date(stats.game.date);
      const gameYear = gameDate.getFullYear();
      const gameMonth = gameDate.getMonth();
      return gameMonth >= 9 ? gameYear : gameYear - 1;
    };

    const currentSeasonGames = gamesWithStats.filter((stats: any) => {
      const gameSeasonYear = getSeasonYear(stats);
      return gameSeasonYear === currentSeason;
    });

    // Calculate season average and hit rate
    const seasonValues = currentSeasonGames.map((g: any) => g.statValue);
    const seasonSum = seasonValues.reduce((sum: number, val: number) => sum + val, 0);
    const seasonAvg = seasonValues.length > 0 ? seasonSum / seasonValues.length : null;
    let seasonHitRate: { hits: number; total: number } | null = null;
    if (Number.isFinite(line) && seasonValues.length > 0) {
      const hits = seasonValues.filter((val: number) => val > line).length;
      seasonHitRate = { hits, total: seasonValues.length };
    }

    // Calculate last 5 average and hit rate
    const last5Games = gamesWithStats.slice(0, 5);
    const last5Values = last5Games.map((g: any) => g.statValue);
    const last5Sum = last5Values.reduce((sum: number, val: number) => sum + val, 0);
    const last5Avg = last5Values.length > 0 ? last5Sum / last5Values.length : null;
    let last5HitRate: { hits: number; total: number } | null = null;
    if (Number.isFinite(line) && last5Values.length > 0) {
      const hits = last5Values.filter((val: number) => val > line).length;
      last5HitRate = { hits, total: last5Values.length };
    }

    // Calculate last 10 average and hit rate
    const last10Games = gamesWithStats.slice(0, 10);
    const last10Values = last10Games.map((g: any) => g.statValue);
    const last10Sum = last10Values.reduce((sum: number, val: number) => sum + val, 0);
    const last10Avg = last10Values.length > 0 ? last10Sum / last10Values.length : null;
    let last10HitRate: { hits: number; total: number } | null = null;
    if (Number.isFinite(line) && last10Values.length > 0) {
      const hits = last10Values.filter((val: number) => val > line).length;
      last10HitRate = { hits, total: last10Values.length };
    }

    // Calculate H2H average and hit rate
    let h2hAvg: number | null = null;
    let h2hHitRate: { hits: number; total: number } | null = null;
    let h2hStats: number[] = [];
    
    if (opponent && opponent !== 'ALL' && opponent !== 'N/A' && opponent !== '') {
      const normalizeAbbr = (abbr: string): string => {
        if (!abbr) return '';
        return abbr.toUpperCase().trim();
      };
      
      const normalizedOpponent = normalizeAbbr(TEAM_FULL_TO_ABBR[opponent] || opponent);
      
      h2hStats = gamesWithStats
        .filter((stats: any) => {
          const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
          const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
          const homeTeamAbbr = stats?.game?.home_team?.abbreviation || '';
          const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation || '';
          const playerTeamFromStats = stats?.team?.abbreviation || '';
          const playerTeamNorm = normalizeAbbr(playerTeamFromStats);
          
          // Use team ID mapping if available for better accuracy
          const homeTeamAbbrFromId = homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined;
          const visitorTeamAbbrFromId = visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined;
          const finalHomeAbbr = homeTeamAbbrFromId || homeTeamAbbr;
          const finalVisitorAbbr = visitorTeamAbbrFromId || visitorTeamAbbr;
          
          // Determine opponent using team IDs if available
          let gameOpponent = '';
          const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
          
          if (playerTeamId && homeTeamId && visitorTeamId) {
            if (playerTeamId === homeTeamId && finalVisitorAbbr) {
              gameOpponent = normalizeAbbr(finalVisitorAbbr);
            } else if (playerTeamId === visitorTeamId && finalHomeAbbr) {
              gameOpponent = normalizeAbbr(finalHomeAbbr);
            }
          }
          
          // Fallback: compare abbreviations directly if IDs missing
          if (!gameOpponent) {
            if (playerTeamNorm === normalizeAbbr(finalHomeAbbr)) {
              gameOpponent = normalizeAbbr(finalVisitorAbbr);
            } else if (playerTeamNorm === normalizeAbbr(finalVisitorAbbr)) {
              gameOpponent = normalizeAbbr(finalHomeAbbr);
            }
          }
          
          return gameOpponent === normalizedOpponent;
        })
        .slice(0, 6)
        .map((s: any) => s.statValue);
      
      // Fallback: if no H2H stats found (e.g., team mapping edge cases), include any game where either side matches the opponent abbr
      if (h2hStats.length === 0 && normalizedOpponent) {
        const fallbackStats = gamesWithStats
          .filter((stats: any) => {
            const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
            const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
            const homeTeamAbbr = stats?.game?.home_team?.abbreviation || '';
            const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation || '';
            const homeNorm = normalizeAbbr(homeTeamAbbr);
            const awayNorm = normalizeAbbr(visitorTeamAbbr);
            return homeNorm === normalizedOpponent || awayNorm === normalizedOpponent;
          })
          .slice(0, 6)
          .map((s: any) => s.statValue);
        
        if (fallbackStats.length > 0) {
          h2hStats = fallbackStats;
          console.log(`[calculatePlayerAveragesForNewProp][H2H Fallback] Used fallback games for ${playerName} vs ${opponent}`, {
            normalizedOpponent,
            fallbackCount: fallbackStats.length,
          });
        }
      }
      
      h2hAvg = h2hStats.length > 0
        ? h2hStats.reduce((sum: number, val: number) => sum + val, 0) / h2hStats.length
        : null;
      
      if (Number.isFinite(line) && h2hStats.length > 0) {
        const hits = h2hStats.filter((val: number) => val > line).length;
        h2hHitRate = { hits, total: h2hStats.length };
      }
    }

    // Calculate streak
    let streak: number | null = null;
    if (Number.isFinite(line) && gamesWithStats.length > 0) {
      streak = 0;
      for (const game of gamesWithStats) {
        if (game.statValue > line) {
          streak++;
        } else {
          break;
        }
      }
    }

    return {
      last5Avg,
      last10Avg,
      h2hAvg,
      seasonAvg,
      last5HitRate,
      last10HitRate,
      h2hHitRate,
      seasonHitRate,
      streak,
      __last5Values: last5Values,
      __last10Values: last10Values,
      __h2hStats: h2hStats,
      __seasonValues: seasonValues,
    };
  } catch (error) {
    console.error(`[calculatePlayerAveragesForNewProp] Error for ${playerName}:`, error);
    return {
      last5Avg: null,
      last10Avg: null,
      h2hAvg: null,
      seasonAvg: null,
      last5HitRate: null,
      last10HitRate: null,
      h2hHitRate: null,
      seasonHitRate: null,
      streak: null,
      __last5Values: [],
      __last10Values: [],
      __h2hStats: [],
      __seasonValues: [],
    };
  }
}

/**
 * Get DvP rating for new prop (simplified)
 */
async function getDvpRatingForNewProp(
  baseUrl: string,
  opponent: string,
  position: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null,
  statType: string
): Promise<{ rank: number | null; statValue: number | null }> {
  if (!opponent || !position) return { rank: null, statValue: null };
  
  const metricMap: Record<string, string> = {
    'PTS': 'pts', 'REB': 'reb', 'AST': 'ast', 'STL': 'stl', 'BLK': 'blk',
    'THREES': 'fg3m', 'PRA': 'pra', 'PA': 'pa', 'PR': 'pr', 'RA': 'ra',
  };
  const metric = metricMap[statType.toUpperCase()];
  if (!metric) return { rank: null, statValue: null };
  
  try {
    const teamAbbr = TEAM_FULL_TO_ABBR[opponent] || opponent.toUpperCase().trim();
    const url = `${baseUrl}/api/dvp/rank?pos=${position}&metric=${metric}`;
    const response = await queuedFetch(url, { cache: 'no-store' });
    
    if (!response.ok) return { rank: null, statValue: null };
    
    const data = await response.json();
    if (!data.success || !data.ranks) return { rank: null, statValue: null };
    
    const rank = data.ranks[teamAbbr] || null;
    const values = data.values || [];
    const teamValue = values.find((v: any) => 
      String(v.team || '').toUpperCase().trim() === teamAbbr
    );
    const statValue = teamValue?.value || null;
    
    return { rank, statValue };
  } catch (error) {
    return { rank: null, statValue: null };
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
  
  // ALWAYS recalculate hit rates using stored stat value arrays (if available)
  // This ensures hit rates match the current line, even if the line didn't change
  // (e.g., if hit rates were calculated for 1.5 but line is 2.5, we need to recalculate for 2.5)
  let last5HitRate = oldProp.last5HitRate;
  let last10HitRate = oldProp.last10HitRate;
  let h2hHitRate = oldProp.h2hHitRate;
  let seasonHitRate = oldProp.seasonHitRate;
  
  // Always recalculate hit rates if stat value arrays are stored
  // This ensures hit rates always match the current line
  if (oldProp.__last5Values && Array.isArray(oldProp.__last5Values) && oldProp.__last5Values.length > 0) {
    last5HitRate = recalculateHitRates(oldProp.__last5Values, newLine);
  }
  if (oldProp.__last10Values && Array.isArray(oldProp.__last10Values) && oldProp.__last10Values.length > 0) {
    last10HitRate = recalculateHitRates(oldProp.__last10Values, newLine);
  }
  if (oldProp.__h2hStats && Array.isArray(oldProp.__h2hStats) && oldProp.__h2hStats.length > 0) {
    h2hHitRate = recalculateHitRates(oldProp.__h2hStats, newLine);
  }
  if (oldProp.__seasonValues && Array.isArray(oldProp.__seasonValues) && oldProp.__seasonValues.length > 0) {
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
    // Note: bookmakerLines will be updated by the caller with all matching bookmakers
    // Keep existing bookmakerLines for now (will be replaced)
    bookmakerLines: oldProp.bookmakerLines || [{
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
 * Find ALL matching bookmakers for a prop in odds cache
 * Returns array of all bookmakers with the same line (not just one)
 */
function findAllMatchingBookmakers(
  oldProp: any,
  oddsCache: OddsCache
): Array<{ bookmaker: string; line: number; overOdds: string; underOdds: string }> {
  const games = oddsCache.games || [];
  const matchingBookmakers: Array<{ bookmaker: string; line: number; overOdds: string; underOdds: string }> = [];
  const seenBookmakers = new Set<string>();
  
  // Find ALL available lines for this player/stat (not just the old line)
  // This allows us to update to new lines if odds have changed (e.g., 1.5 -> 2.5)
  const oldLine = Math.round(oldProp.line * 2) / 2;
  
  // Debug: Track what we're looking for (only log first few to avoid spam)
  let debugLogged = false;
  
  // Track all available lines to find the most common one
  const lineCounts = new Map<number, number>();
  
  // First pass: collect all available lines for this player/stat
  const allAvailableLines: Array<{ line: number; bookmaker: string; overOdds: string; underOdds: string }> = [];
  
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
    
    // Look for player props in this game - check ALL bookmakers, not just the one from oldProp
    const playerProps = game.playerPropsByBookmaker || {};
    
    // Normalize player name for matching (case-insensitive, trim spaces)
    const normalizePlayerName = (name: string): string => {
      return name.toLowerCase().trim().replace(/\s+/g, ' ');
    };
    const normalizedPropPlayerName = normalizePlayerName(oldProp.playerName);
    
    for (const [bookmakerName, bookmakerProps] of Object.entries(playerProps)) {
      // Try exact match first (fast path)
      let playerData = (bookmakerProps as any)[oldProp.playerName];
      
      // If no exact match, try case-insensitive normalized match
      if (!playerData) {
        for (const [cachedPlayerName, cachedPlayerData] of Object.entries(bookmakerProps as any)) {
          if (normalizePlayerName(cachedPlayerName) === normalizedPropPlayerName) {
            playerData = cachedPlayerData;
            if (!debugLogged && matchingBookmakers.length === 0) {
              console.log(`[findAllMatchingBookmakers] ✅ Found player "${cachedPlayerName}" (normalized match) for "${oldProp.playerName}" in ${bookmakerName}`);
              debugLogged = true;
            }
            break;
          }
        }
      }
      
      if (!playerData) continue;
      
      const statData = playerData[oldProp.statType];
      if (!statData) continue;
      
      const entries = Array.isArray(statData) ? statData : [statData];
      
      // Find ALL available lines (not just the old line) - this allows line changes
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
        
        const roundedLine = Math.round(line * 2) / 2;
        
        // Collect all available lines (we'll filter to the best one later)
        const bookmakerKey = `${bookmakerName}|${roundedLine}`;
        if (!seenBookmakers.has(bookmakerKey)) {
          seenBookmakers.add(bookmakerKey);
          allAvailableLines.push({
            line: roundedLine,
            bookmaker: bookmakerName,
            overOdds: overOddsStr,
            underOdds: underOddsStr,
          });
          
          // Count this line (to find most common)
          lineCounts.set(roundedLine, (lineCounts.get(roundedLine) || 0) + 1);
        }
      }
    }
  }
  
  // Determine which line to use:
  // ALWAYS use the most common line from new odds (this ensures we update to new lines)
  // This handles cases where the line changed (e.g., 1.5 → 2.5)
  let selectedLine: number | null = null;
  
  if (lineCounts.size > 0) {
    // Find most common line (this is the current market line)
    let maxCount = 0;
    let mostCommonLine = oldLine; // Fallback to old line
    
    for (const [line, count] of lineCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonLine = line;
      } else if (count === maxCount) {
        // If tied, prefer line closer to old line (but still use most common)
        if (Math.abs(line - oldLine) < Math.abs(mostCommonLine - oldLine)) {
          mostCommonLine = line;
        }
      }
    }
    
    selectedLine = mostCommonLine;
    
    // Log if line changed (this is important for debugging)
    if (Math.abs(selectedLine - oldLine) > 0.1) {
      console.log(`[findAllMatchingBookmakers] 🔄 Line changed for ${oldProp.playerName} ${oldProp.statType}: ${oldLine} → ${selectedLine} (most common: ${maxCount} bookmakers)`);
    }
  } else {
    // No lines found - this shouldn't happen, but fallback to old line
    selectedLine = oldLine;
  }
  
  // Filter to only the selected line and add to matchingBookmakers
  if (selectedLine !== null) {
    for (const lineData of allAvailableLines) {
      if (Math.abs(lineData.line - selectedLine) <= 0.1) {
        matchingBookmakers.push({
          bookmaker: lineData.bookmaker,
          line: lineData.line,
          overOdds: lineData.overOdds,
          underOdds: lineData.underOdds,
        });
      }
    }
  }
  
  // Always log when we find multiple bookmakers (this is the key metric we care about)
  const finalLine = selectedLine !== null ? selectedLine : oldLine;
  if (matchingBookmakers.length > 1) {
    console.log(`[findAllMatchingBookmakers] ✅ Found ${matchingBookmakers.length} bookmakers for ${oldProp.playerName} ${oldProp.statType} line ${finalLine} (was ${oldLine}): ${matchingBookmakers.map(m => m.bookmaker).join(', ')}`);
  } else if (matchingBookmakers.length === 1) {
    // Log first few single matches to debug
    if (Math.random() < 0.1) { // Log ~10% of single matches to avoid spam
      console.log(`[findAllMatchingBookmakers] ⚠️ Only found 1 bookmaker for ${oldProp.playerName} ${oldProp.statType} line ${finalLine} (was ${oldLine}): ${matchingBookmakers[0].bookmaker}`);
    }
  } else {
    // Log first few no-match cases
    if (Math.random() < 0.05) { // Log ~5% of no-matches
      console.log(`[findAllMatchingBookmakers] ❌ No bookmakers found for ${oldProp.playerName} ${oldProp.statType} (${oldProp.team} vs ${oldProp.opponent})`);
    }
  }
  
  return matchingBookmakers;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max (processing can take time with many props)

/**
 * POST /api/nba/player-props/update-odds
 * 
 * Efficiently updates player props with new odds/lines without reprocessing stats.
 * 
 * This endpoint:
 * - Processes ALL props in one batch (not per-player)
 * - Uses stored stat value arrays (__last5Values, __last10Values, etc.) - NO API calls
 * - ALWAYS recalculates hit rates when stat arrays exist (ensures hit rates match current line)
 * - Runs automatically after odds refresh (every 30 mins)
 * 
 * Performance: ~2000ms for 144 props (all in-memory calculations)
 */
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
      console.log('[Player Props Update Odds] ⚠️ No odds cache available. Please refresh odds first.');
      return NextResponse.json({
        success: false,
        error: 'No odds data available',
        message: 'Cannot update player props without odds data. Please run /api/odds/refresh first to populate the odds cache.',
        hint: 'Run: GET /api/odds/refresh, then POST /api/nba/player-props/update-odds'
      }, { status: 503 });
    }
    
    // Use all-dates cache only (no date-specific cache)
    const cacheKey = `${PLAYER_PROPS_CACHE_PREFIX}-all-dates`;
    
    console.log(`[Player Props Update Odds] 🔑 Using all-dates cache: ${cacheKey}`);
    
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
    let totalBookmakersFound = 0;
    let propsWithMultiple = 0;
    let linesChanged = 0;
    let hitRatesRecalculated = 0;
    let propsWithStatArrays = 0;
    
    for (const oldProp of cachedProps) {
      const oldLine = oldProp.line;
      const oldL5HitRate = oldProp.last5HitRate;
      const oldL10HitRate = oldProp.last10HitRate;
      
      const matchingBookmakers = findAllMatchingBookmakers(oldProp, oddsCache);
      totalBookmakersFound += matchingBookmakers.length;
      
      if (matchingBookmakers.length > 1) {
        propsWithMultiple++;
      }
      
      if (matchingBookmakers.length > 0) {
        // Use the first match for the main line/odds (best match)
        const primaryMatch = matchingBookmakers[0];
        
        // Check if line changed
        const lineChanged = Math.abs(primaryMatch.line - oldLine) > 0.1;
        if (lineChanged) {
          linesChanged++;
          console.log(`[Player Props Update Odds] 🔄 Line changed for ${oldProp.playerName} ${oldProp.statType}: ${oldLine} → ${primaryMatch.line}`);
        }
        
        // Update the prop with primary match
        const updatedProp = updatePropWithNewOdds(
          oldProp,
          primaryMatch.line,
          primaryMatch.overOdds,
          primaryMatch.underOdds
        );
        
        // Check if hit rates were recalculated (they should always be if stat arrays exist)
        const hasStatArrays = !!(oldProp.__last5Values || oldProp.__last10Values || oldProp.__h2hStats || oldProp.__seasonValues);
        if (hasStatArrays) {
          propsWithStatArrays++;
        }
        
        // Hit rates are ALWAYS recalculated in updatePropWithNewOdds if stat arrays exist
        // Check if the values actually changed (which they should if line changed)
        const l5Recalculated = hasStatArrays && 
          (updatedProp.last5HitRate?.hits !== oldL5HitRate?.hits || updatedProp.last5HitRate?.total !== oldL5HitRate?.total);
        const l10Recalculated = hasStatArrays && 
          (updatedProp.last10HitRate?.hits !== oldL10HitRate?.hits || updatedProp.last10HitRate?.total !== oldL10HitRate?.total);
        
        if (l5Recalculated || l10Recalculated) {
          hitRatesRecalculated++;
          if (hitRatesRecalculated <= 5) { // Log first 5 to avoid spam
            console.log(`[Player Props Update Odds] ✅ Hit rates recalculated for ${oldProp.playerName} ${oldProp.statType} (line ${oldLine} → ${primaryMatch.line}): L5 ${oldL5HitRate?.hits}/${oldL5HitRate?.total} → ${updatedProp.last5HitRate?.hits}/${updatedProp.last5HitRate?.total}, L10 ${oldL10HitRate?.hits}/${oldL10HitRate?.total} → ${updatedProp.last10HitRate?.hits}/${updatedProp.last10HitRate?.total}`);
          }
        } else if (!hasStatArrays) {
          if (updatedCount <= 5) {
            console.log(`[Player Props Update Odds] ⚠️ No stat arrays stored for ${oldProp.playerName} ${oldProp.statType} - will recalculate stats`);
          }
        }
        
        // Update bookmakerLines array with ALL matching bookmakers
        updatedProp.bookmakerLines = matchingBookmakers.map(m => ({
          bookmaker: m.bookmaker,
          line: m.line,
          overOdds: m.overOdds,
          underOdds: m.underOdds,
        }));
        
        // Log if we found multiple bookmakers (for debugging)
        if (matchingBookmakers.length > 1) {
          console.log(`[Player Props Update Odds] ✅ Found ${matchingBookmakers.length} bookmakers for ${oldProp.playerName} ${oldProp.statType} line ${primaryMatch.line}: ${matchingBookmakers.map(m => m.bookmaker).join(', ')}`);
        }
        
        updatedProps.push(updatedProp);
        updatedCount++;
      } else {
        // Don't keep old prop if no match found - odds disappeared (game started/line removed)
        // This ensures we only show active props
        notFoundCount++;
        console.log(`[Player Props Update Odds] 🗑️ Removing prop (odds disappeared): ${oldProp.playerName} ${oldProp.statType} ${oldProp.line} (${oldProp.team} vs ${oldProp.opponent})`);
      }
    }
    
    // Recalculate stats for props missing stat arrays OR missing averages (even if arrays exist but are empty/null)
    console.log(`[Player Props Update Odds] 🔄 Checking for props missing stat arrays or averages...`);
    const propsNeedingStats = updatedProps.filter(prop => {
      const hasStatArrays = !!(prop.__last5Values || prop.__last10Values || prop.__h2hStats || prop.__seasonValues);
      const hasAverages = !!(prop.last5Avg !== null || prop.last10Avg !== null || prop.h2hAvg !== null || prop.seasonAvg !== null);
      // Recalculate if: no stat arrays OR no averages (even if arrays exist, they might be empty)
      return (!hasStatArrays || !hasAverages) && prop.playerName && prop.statType;
    });
    
    let statsRecalculatedCount = 0;
    
    if (propsNeedingStats.length > 0) {
      console.log(`[Player Props Update Odds] 📊 Found ${propsNeedingStats.length} props missing stat arrays - recalculating stats...`);
      
      // Process all props needing stats in parallel batches (like manual ingestion)
      const propsToRecalc = propsNeedingStats;
      const BATCH_SIZE = 5; // Process 5 props at a time in parallel (same as manual ingestion)
      const baseUrl = getBaseUrl();
      
      for (let i = 0; i < propsToRecalc.length; i += BATCH_SIZE) {
        const batch = propsToRecalc.slice(i, i + BATCH_SIZE);
        
        // Process batch in parallel
        const batchPromises = batch.map(async (prop) => {
          try {
            // Get player ID if missing
            if (!prop.playerId) {
              prop.playerId = getPlayerIdFromName(prop.playerName);
            }
            
            if (!prop.playerId) {
              console.warn(`[Player Props Update Odds] ⚠️ No player ID found for ${prop.playerName} - skipping stats calculation`);
              return null;
            }
            
            // Determine position if missing
            if (!prop.position) {
              let position: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null = null;
              let actualTeam = prop.team;
              let actualOpponent = prop.opponent;
              
              // Try home team first
              position = await getPlayerPositionFromDepthChart(baseUrl, prop.playerName, prop.team);
              
              // If not found, try the opponent team
              if (!position) {
                position = await getPlayerPositionFromDepthChart(baseUrl, prop.playerName, prop.opponent);
                if (position) {
                  actualTeam = prop.opponent;
                  actualOpponent = prop.team;
                  prop.team = actualTeam;
                  prop.opponent = actualOpponent;
                }
              }
              
              prop.position = position;
            }
            
            // Calculate full stats
            const averages = await calculatePlayerAveragesForNewProp(
              baseUrl,
              prop.playerId,
              prop.playerName,
              prop.statType,
              prop.opponent,
              prop.team,
              prop.line
            );
            
            // Update prop with calculated stats
            Object.assign(prop, averages);
            
            // Get DvP rating if position exists
            if (prop.position) {
              await new Promise(resolve => setTimeout(resolve, 200)); // Small delay
              const dvp = await getDvpRatingForNewProp(baseUrl, prop.opponent, prop.position, prop.statType);
              prop.dvpRating = dvp.rank;
              prop.dvpStatValue = dvp.statValue;
            }
            
            // Recalculate hit rates now that we have stat arrays
            if (prop.__last5Values && Array.isArray(prop.__last5Values) && prop.__last5Values.length > 0) {
              prop.last5HitRate = recalculateHitRates(prop.__last5Values, prop.line);
            }
            if (prop.__last10Values && Array.isArray(prop.__last10Values) && prop.__last10Values.length > 0) {
              prop.last10HitRate = recalculateHitRates(prop.__last10Values, prop.line);
            }
            if (prop.__h2hStats && Array.isArray(prop.__h2hStats) && prop.__h2hStats.length > 0) {
              prop.h2hHitRate = recalculateHitRates(prop.__h2hStats, prop.line);
            }
            if (prop.__seasonValues && Array.isArray(prop.__seasonValues) && prop.__seasonValues.length > 0) {
              prop.seasonHitRate = recalculateHitRates(prop.__seasonValues, prop.line);
            }
            
            console.log(`[Player Props Update Odds] ✅ Recalculated stats for ${prop.playerName} ${prop.statType}`);
            return prop;
          } catch (error: any) {
            console.error(`[Player Props Update Odds] ⚠️ Error recalculating stats for ${prop.playerName} ${prop.statType}:`, error.message);
            return null;
          }
        });
        
        // Wait for batch to complete
        const batchResults = await Promise.all(batchPromises);
        statsRecalculatedCount += batchResults.filter(r => r !== null).length;
        
        // Small delay between batches to avoid overwhelming APIs
        if (i + BATCH_SIZE < propsToRecalc.length) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between batches (same as manual ingestion)
        }
      }
      
      console.log(`[Player Props Update Odds] ✅ Recalculated stats for ${statsRecalculatedCount} props`);
    } else {
      console.log(`[Player Props Update Odds] ✅ All props already have stat arrays - no recalculation needed`);
    }
    
    // Log summary of stats recalculation
    if (statsRecalculatedCount > 0) {
      console.log(`[Player Props Update Odds] 📊 Stats Recalculation Summary: ${statsRecalculatedCount} props processed`);
    }
    
    // Now detect and process NEW players that aren't in the cache yet
    console.log(`[Player Props Update Odds] 🔍 Checking for new players in odds cache...`);
    
    // Build a set of existing player/stat/line/opponent combinations (include opponent to avoid duplicates for different games)
    const existingPropKeys = new Set(
      updatedProps.map(prop => 
        `${prop.playerName}|${prop.statType}|${Math.round(prop.line * 2) / 2}|${prop.opponent || 'ALL'}`
      )
    );
    
    // Extract new props from odds cache
    const newProps: any[] = [];
    const games = oddsCache.games || [];
    
    for (const game of games) {
      if (!game?.playerPropsByBookmaker || typeof game.playerPropsByBookmaker !== 'object') continue;
      
      const homeTeam = game.homeTeam || '';
      const awayTeam = game.awayTeam || '';
      const homeTeamAbbr = TEAM_FULL_TO_ABBR[homeTeam] || homeTeam;
      const awayTeamAbbr = TEAM_FULL_TO_ABBR[awayTeam] || awayTeam;
      
      for (const [bookmakerName, bookmakerProps] of Object.entries(game.playerPropsByBookmaker)) {
        if (!bookmakerProps || typeof bookmakerProps !== 'object') continue;
        if (isPickemBookmaker(bookmakerName)) continue;
        
        for (const [playerName, playerData] of Object.entries(bookmakerProps as any)) {
          if (!playerData || typeof playerData !== 'object') continue;
          
          const propsData = playerData;
          // Get ALL stat types dynamically
          const allStatTypes = Object.keys(propsData).filter(key => {
            const statData = propsData[key];
            return statData && (typeof statData === 'object' || Array.isArray(statData));
          });
          
          for (const statTypeKey of allStatTypes) {
            const statData = propsData[statTypeKey];
            if (!statData) continue;
            
            const entries = Array.isArray(statData) ? statData : [statData];
            
            for (const entry of entries) {
              if (!entry || !entry.line || entry.line === 'N/A') continue;
              if (entry.isPickem === true) continue;
              if (entry.variantLabel && (entry.variantLabel.toLowerCase().includes('goblin') || entry.variantLabel.toLowerCase().includes('demon'))) continue;
              
              const line = parseFloat(entry.line);
              if (isNaN(line)) continue;
              
              const statType = statTypeKey.toUpperCase();
              // Include opponent in key to avoid duplicates for different games
              const opponent = awayTeamAbbr; // Use away team as opponent (player is on home team initially)
              const propKey = `${playerName}|${statType}|${Math.round(line * 2) / 2}|${opponent || 'ALL'}`;
              
              // Skip if this prop already exists
              if (existingPropKeys.has(propKey)) continue;
              
              const overOddsStr = entry.over;
              const underOddsStr = entry.under;
              
              if (!overOddsStr || overOddsStr === 'N/A' || !underOddsStr || underOddsStr === 'N/A') continue;
              if (overOddsStr === '+100' && underOddsStr === '+100') continue;
              
              const overOdds = parseAmericanOdds(overOddsStr);
              const underOdds = parseAmericanOdds(underOddsStr);
              
              if (overOdds === null || underOdds === null) continue;
              
              const implied = calculateImpliedProbabilities(overOddsStr, underOddsStr);
              const overProb = implied ? implied.overImpliedProb : americanToImpliedProb(parseFloat(overOddsStr.replace(/[^0-9+-]/g, '')));
              const underProb = implied ? implied.underImpliedProb : americanToImpliedProb(parseFloat(underOddsStr.replace(/[^0-9+-]/g, '')));
              
              // Only add if implied probability > 50%
              const bestProb = Math.max(overProb, underProb);
              if (bestProb <= 0.5) continue;
              
              newProps.push({
                playerName,
                playerId: '',
                team: homeTeamAbbr,
                opponent: awayTeamAbbr,
                statType,
                line,
                overOdds: overOddsStr,
                underOdds: underOddsStr,
                overProb,
                underProb,
                impliedOverProb: overProb,
                impliedUnderProb: underProb,
                bestLine: line,
                bookmaker: bookmakerName,
                confidence: bestProb > 70 ? 'High' : bestProb > 65 ? 'Medium' : 'Low',
                gameDate: game.commenceTime || 'unknown',
                last5Avg: null,
                last10Avg: null,
                h2hAvg: null,
                seasonAvg: null,
                last5HitRate: null,
                last10HitRate: null,
                h2hHitRate: null,
                seasonHitRate: null,
                streak: null,
                dvpRating: null,
                dvpStatValue: null,
                bookmakerLines: [{
                  bookmaker: bookmakerName,
                  line,
                  overOdds: overOddsStr,
                  underOdds: underOddsStr,
                }],
              });
              
              // Mark as seen to avoid duplicates
              existingPropKeys.add(propKey);
            }
          }
        }
      }
    }
    
    // Group and deduplicate new props (include opponent to avoid duplicates for different games)
    const newPropsByKey = new Map<string, any[]>();
    for (const prop of newProps) {
      const roundedLine = Math.round(prop.line * 2) / 2;
      const key = `${prop.playerName}|${prop.statType}|${roundedLine}|${prop.opponent || 'ALL'}`;
      if (!newPropsByKey.has(key)) {
        newPropsByKey.set(key, []);
      }
      newPropsByKey.get(key)!.push(prop);
    }
    
    // Keep only the best prop from each group
    const processedNewProps: any[] = [];
    for (const [key, propGroup] of newPropsByKey.entries()) {
      const bestProb = Math.max(...propGroup.map(p => Math.max(p.overProb, p.underProb)));
      const bestProp = propGroup.reduce((best, current) => {
        const bestMaxProb = Math.max(best.overProb, best.underProb);
        const currentMaxProb = Math.max(current.overProb, current.underProb);
        return currentMaxProb > bestMaxProb ? current : best;
      });
      
      // Merge bookmakerLines from all props in group
      const allBookmakerLines: any[] = [];
      const seenBookmakers = new Set<string>();
      const propLineValue = bestProp.line;
      
      for (const prop of propGroup) {
        if (prop.bookmakerLines && Array.isArray(prop.bookmakerLines)) {
          for (const line of prop.bookmakerLines) {
            const lineValue = typeof line.line === 'number' ? line.line : parseFloat(line.line);
            if (isNaN(lineValue) || Math.abs(lineValue - propLineValue) > 0.1) continue;
            
            const bookmakerKey = `${line.bookmaker}|${lineValue}`;
            if (!seenBookmakers.has(bookmakerKey)) {
              allBookmakerLines.push(line);
              seenBookmakers.add(bookmakerKey);
            }
          }
        }
      }
      
      bestProp.bookmakerLines = allBookmakerLines.length > 0 ? allBookmakerLines : bestProp.bookmakerLines;
      processedNewProps.push(bestProp);
    }
    
    // Special handling: Deduplicate PTS props (keep only highest line)
    const ptsPropsByPlayer = new Map<string, any[]>();
    const nonPtsProps: any[] = [];
    
    for (const prop of processedNewProps) {
      if (prop.statType === 'PTS') {
        if (!ptsPropsByPlayer.has(prop.playerName)) {
          ptsPropsByPlayer.set(prop.playerName, []);
        }
        ptsPropsByPlayer.get(prop.playerName)!.push(prop);
      } else {
        nonPtsProps.push(prop);
      }
    }
    
    const filteredPtsProps: any[] = [];
    for (const [playerName, ptsProps] of ptsPropsByPlayer.entries()) {
      if (ptsProps.length > 1) {
        // Multiple PTS lines - keep only the highest one
        const highestLineProp = ptsProps.reduce((highest, current) => {
          return current.line > highest.line ? current : highest;
        });
        filteredPtsProps.push(highestLineProp);
      } else {
        filteredPtsProps.push(ptsProps[0]);
      }
    }
    
    const finalNewProps = [...filteredPtsProps, ...nonPtsProps];
    
    if (finalNewProps.length > 0) {
      console.log(`[Player Props Update Odds] 🆕 Found ${finalNewProps.length} new props from ${newProps.length} raw props`);
      
      // Process all new props (get player IDs, stats, DvP, etc.)
      // Process all props with delays to avoid overwhelming APIs
      const propsToProcess = finalNewProps;
      
      if (propsToProcess.length > 0) {
        console.log(`[Player Props Update Odds] 🆕 Processing ${propsToProcess.length} new props...`);
      }
      
      // Process new props by calling the process endpoint for just these props
      // This will get player IDs, stats, DvP, etc.
      try {
        const baseUrl = process.env.PROD_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://www.stattrackr.co';
        const processUrl = `${baseUrl}/api/nba/player-props/process-new`;
        
        // Create a simplified processing function inline
        const processedNewPropsWithStats = await processNewProps(propsToProcess, oddsCache);
        
        // Merge new props into existing cache
        updatedProps.push(...processedNewPropsWithStats);
        
        console.log(`[Player Props Update Odds] ✅ Processed and added ${processedNewPropsWithStats.length} new props`);
      } catch (processError: any) {
        console.error(`[Player Props Update Odds] ⚠️ Error processing new props:`, processError.message);
        // Continue without new props - they'll be picked up in next update or daily ingestion
      }
    } else {
      console.log(`[Player Props Update Odds] ✅ No new players/props found in odds cache`);
    }
    
    // Final deduplication: remove any remaining duplicates (same player/stat/line/opponent)
    const finalDedupMap = new Map<string, any>();
    for (const prop of updatedProps) {
      const key = `${prop.playerName}|${prop.statType}|${Math.round(prop.line * 2) / 2}|${prop.opponent || 'ALL'}`;
      const existing = finalDedupMap.get(key);
      if (!existing) {
        finalDedupMap.set(key, prop);
      } else {
        // Keep the one with more bookmakers or better stats
        const existingBookmakers = existing.bookmakerLines?.length || 0;
        const newBookmakers = prop.bookmakerLines?.length || 0;
        const existingHasStats = !!(existing.last5Avg !== null || existing.h2hAvg !== null || existing.seasonAvg !== null);
        const newHasStats = !!(prop.last5Avg !== null || prop.h2hAvg !== null || prop.seasonAvg !== null);
        if (newBookmakers > existingBookmakers || 
            (newBookmakers === existingBookmakers && newHasStats && !existingHasStats) ||
            (newBookmakers === existingBookmakers && newHasStats === existingHasStats && prop.dvpRating !== null && existing.dvpRating === null)) {
          finalDedupMap.set(key, prop);
        }
      }
    }
    const finalProps = Array.from(finalDedupMap.values());
    
    if (finalProps.length !== updatedProps.length) {
      console.log(`[Player Props Update Odds] 🔄 Removed ${updatedProps.length - finalProps.length} duplicate props (kept ${finalProps.length} unique props)`);
    }
    
    // Save updated props back to cache (now includes new props and deduplicated)
    await setNBACache(cacheKey, 'player-props', finalProps, 24 * 60, false);
    cache.set(cacheKey, finalProps, 24 * 60);
    
    // Count how many props have multiple bookmakers
    let propsWithMultipleBookmakers = 0;
    for (const prop of finalProps) {
      if (prop.bookmakerLines && Array.isArray(prop.bookmakerLines) && prop.bookmakerLines.length > 1) {
        propsWithMultipleBookmakers++;
      }
    }
    
    const elapsed = Date.now() - startTime;
    const newPropsCount = finalProps.length - cachedProps.length;
    const finalTotal = finalProps.length;
    const removedCount = notFoundCount; // Props removed because odds disappeared
    
    console.log(`[Player Props Update Odds] ✅ Updated ${updatedCount}/${cachedProps.length} existing props in ${elapsed}ms`);
    if (removedCount > 0) {
      console.log(`[Player Props Update Odds] 🗑️ Removed ${removedCount} props (odds disappeared - game started/line removed)`);
    }
    if (newPropsCount > 0) {
      console.log(`[Player Props Update Odds] 🆕 Added ${newPropsCount} new props (total now: ${finalTotal})`);
    }
    console.log(`[Player Props Update Odds] 📊 Total bookmakers found: ${totalBookmakersFound} (avg ${(totalBookmakersFound / updatedCount).toFixed(2)} per prop)`);
    console.log(`[Player Props Update Odds] 📊 Props with multiple bookmakers: ${propsWithMultiple}/${updatedCount}`);
    console.log(`[Player Props Update Odds] 🔄 Lines changed: ${linesChanged}/${updatedCount}`);
    console.log(`[Player Props Update Odds] 📈 Props with stat arrays: ${propsWithStatArrays}/${updatedCount} (hit rates recalculated automatically)`);
    console.log(`[Player Props Update Odds] ✅ Hit rates changed: ${hitRatesRecalculated}/${propsWithStatArrays} (hit rates are ALWAYS recalculated when stat arrays exist, values change when line changes)`);
    if (statsRecalculatedCount > 0) {
      console.log(`[Player Props Update Odds] 🔄 Stats recalculated: ${statsRecalculatedCount} props (these props were missing stat arrays and got full stats calculated)`);
    }
    
    // Log a sample of props that should have multiple bookmakers
    if (propsWithMultiple === 0 && updatedCount > 0) {
      console.log(`[Player Props Update Odds] ⚠️ No props with multiple bookmakers found. Sample prop:`, {
        playerName: updatedProps[0]?.playerName,
        statType: updatedProps[0]?.statType,
        line: updatedProps[0]?.line,
        team: updatedProps[0]?.team,
        opponent: updatedProps[0]?.opponent,
        bookmakerLinesCount: updatedProps[0]?.bookmakerLines?.length || 0,
        bookmakers: updatedProps[0]?.bookmakerLines?.map((b: any) => b.bookmaker).join(', ') || 'none'
      });
    }
    
    return NextResponse.json({
      success: true,
      message: 'Player props odds updated',
      updated: updatedCount,
      removed: removedCount,
      newProps: newPropsCount,
      statsRecalculated: statsRecalculatedCount,
      total: finalTotal,
      previousTotal: cachedProps.length,
      propsWithMultipleBookmakers,
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

