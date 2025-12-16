export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import cache from '@/lib/cache';
import type { OddsCache } from '@/app/api/odds/refresh/route';
import { TEAM_FULL_TO_ABBR } from '@/lib/teamMapping';
import { calculateImpliedProbabilities } from '@/lib/impliedProbability';
import { currentNbaSeason, TEAM_ID_TO_ABBR, ABBR_TO_TEAM_ID } from '@/lib/nbaConstants';
import { PLAYER_ID_MAPPINGS } from '@/lib/playerIdMapping';
import { queuedFetch } from '@/lib/requestQueue';

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
const PLAYER_PROPS_CACHE_PREFIX = 'nba-player-props';
const CHECKPOINT_CACHE_PREFIX = 'nba-player-props-checkpoint-v2';

// Helper functions (simplified versions from client code)
function parseAmericanOdds(oddsStr: string): number | null {
  if (!oddsStr || oddsStr === 'N/A') return null;
  const cleaned = oddsStr.replace(/[^0-9+-]/g, '');
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) return null;
  return num >= 0 ? (num / 100) + 1 : 1 - (100 / num);
}

function americanToImpliedProb(american: number): number {
  if (american >= 0) {
    return (100 / (american + 100)) * 100;
  } else {
    return (Math.abs(american) / (Math.abs(american) + 100)) * 100;
  }
}

function isPickemBookmaker(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('prizepicks') || 
         lower.includes('underdog') || 
         lower.includes('draftkings pick6') ||
         lower.includes('pick6');
}

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

function getPlayerPropVendors(oddsCache: OddsCache): string[] {
  const vendors = new Set<string>();
  if (oddsCache.games && Array.isArray(oddsCache.games)) {
    for (const game of oddsCache.games) {
      if (game.playerPropsByBookmaker && typeof game.playerPropsByBookmaker === 'object') {
        Object.keys(game.playerPropsByBookmaker).forEach(vendor => {
          if (vendor) vendors.add(vendor);
        });
      }
    }
  }
  return Array.from(vendors).sort();
}

function getPlayerPropsCacheKey(gameDate: string): string {
  return `${PLAYER_PROPS_CACHE_PREFIX}-${gameDate}`;
}

// Helper to get base URL for internal API calls
function getBaseUrl(request: NextRequest): string {
  const host = request.headers.get('host') || 'localhost:3000';
  const protocol = request.headers.get('x-forwarded-proto') || 'http';
  return `${protocol}://${host}`;
}

// Helper to get player ID from name
function getPlayerIdFromName(playerName: string): string {
  const mapping = PLAYER_ID_MAPPINGS.find(m => 
    m.name.toLowerCase() === playerName.toLowerCase() ||
    m.name.toLowerCase().includes(playerName.toLowerCase()) ||
    playerName.toLowerCase().includes(m.name.toLowerCase())
  );
  return mapping?.bdlId || '';
}

// Helper to get stat value from game stats
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

// Helper to parse minutes
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

// Calculate player averages (last5, last10, h2h, seasonAvg, hit rates, streak)
async function calculatePlayerAverages(
  baseUrl: string,
  playerId: string,
  playerName: string,
  statType: string,
  opponent: string,
  playerTeam: string,
  line: number
): Promise<{
  last5Avg: number | null;
  last10Avg: number | null;
  h2hAvg: number | null;
  seasonAvg: number | null;
  last5HitRate: { hits: number; total: number } | null;
  last10HitRate: { hits: number; total: number } | null;
  h2hHitRate: { hits: number; total: number } | null;
  seasonHitRate: { hits: number; total: number } | null;
  streak: number | null;
  __last5Values: number[];
  __last10Values: number[];
  __h2hStats: number[];
  __seasonValues: number[];
}> {
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

    // Fetch stats for current and previous season (regular + playoffs)
    for (const season of [currentSeason, currentSeason - 1]) {
      for (const postseason of [false, true]) {
        try {
          const url = `${baseUrl}/api/stats?player_id=${playerId}&season=${season}&per_page=100&max_pages=3&postseason=${postseason}`;
          const response = await queuedFetch(url, { cache: 'no-store' });
          if (response.ok || response.status === 429) {
            const json = await response.json().catch(() => ({}));
            const data = Array.isArray(json?.data) ? json.data : [];
            allStats.push(...data);
          }
        } catch (e) {
          // Continue on error
        }
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
    uniqueStats.sort((a, b) => {
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
      .sort((a, b) => {
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

    // Calculate season average
    const seasonValues = gamesWithStats.map((g: any) => g.statValue);
    const seasonSum = seasonValues.reduce((sum: number, val: number) => sum + val, 0);
    const seasonAvg = seasonValues.length > 0 ? seasonSum / seasonValues.length : null;
    
    // Calculate season hit rate
    let seasonHitRate: { hits: number; total: number } | null = null;
    if (Number.isFinite(line) && seasonValues.length > 0) {
      const hits = seasonValues.filter((val: number) => val > line).length;
      seasonHitRate = { hits, total: seasonValues.length };
    }

    // Calculate last 5 average
    const last5Games = gamesWithStats.slice(0, 5);
    const last5Values = last5Games.map((g: any) => g.statValue);
    const last5Sum = last5Values.reduce((sum: number, val: number) => sum + val, 0);
    const last5Avg = last5Values.length > 0 ? last5Sum / last5Values.length : null;
    
    // Calculate last 5 hit rate
    let last5HitRate: { hits: number; total: number } | null = null;
    if (Number.isFinite(line) && last5Values.length > 0) {
      const hits = last5Values.filter((val: number) => val > line).length;
      last5HitRate = { hits, total: last5Values.length };
    }

    // Calculate last 10 average
    const last10Games = gamesWithStats.slice(0, 10);
    const last10Values = last10Games.map((g: any) => g.statValue);
    const last10Sum = last10Values.reduce((sum: number, val: number) => sum + val, 0);
    const last10Avg = last10Values.length > 0 ? last10Sum / last10Values.length : null;
    
    // Calculate last 10 hit rate
    let last10HitRate: { hits: number; total: number } | null = null;
    if (Number.isFinite(line) && last10Values.length > 0) {
      const hits = last10Values.filter((val: number) => val > line).length;
      last10HitRate = { hits, total: last10Values.length };
    }

    // Calculate H2H average - EXACT COPY FROM OLD CLIENT-SIDE CODE
    let h2hAvg: number | null = null;
    let h2hHitRate: { hits: number; total: number } | null = null;
    let h2hStats: number[] = [];
    let normalizedOpponent: string | null = null;
    
    if (opponent && opponent !== 'ALL' && opponent !== 'N/A' && opponent !== '') {
      // Use EXACT same normalizeAbbr function as old code
      const normalizeAbbr = (abbr: string): string => {
        if (!abbr) return '';
        return abbr.toUpperCase().trim();
      };
      
      // Determine correct opponent: if player's actual team matches provided opponent, they're swapped
      let correctOpponent = opponent;
      if (gamesWithStats.length > 0 && playerTeam) {
        const playerActualTeam = gamesWithStats[0]?.team?.abbreviation || "";
        const playerActualTeamNorm = normalizeAbbr(playerActualTeam);
        const providedTeamNorm = normalizeAbbr(TEAM_FULL_TO_ABBR[playerTeam] || playerTeam);
        const providedOpponentNorm = normalizeAbbr(TEAM_FULL_TO_ABBR[opponent] || opponent);
        
        // If player's actual team matches the provided opponent, they're swapped
        if (playerActualTeamNorm === providedOpponentNorm) {
          // Player is on the "opponent" team, so the real opponent is the "team"
          correctOpponent = playerTeam;
        }
      }
      
      // Normalize opponent - handle both abbreviations and full names
      // Try TEAM_FULL_TO_ABBR first (if it's a full name), otherwise use as-is (if it's already an abbreviation)
      normalizedOpponent = normalizeAbbr(TEAM_FULL_TO_ABBR[correctOpponent] || correctOpponent);
      
      // EXACT COPY FROM OLD CODE - just filter, no corrections
      h2hStats = gamesWithStats
        .filter((stats: any) => {
          // EXACT COPY: stats?.team?.abbreviation || selectedPlayer?.teamAbbr || ""
          // Use playerTeam parameter as fallback (like old code uses selectedPlayer?.teamAbbr)
          const playerTeamFromStats = stats?.team?.abbreviation || (playerTeam ? (TEAM_FULL_TO_ABBR[playerTeam] || playerTeam) : "") || "";
          const playerTeamNorm = normalizeAbbr(playerTeamFromStats);
          
          // Get opponent from game data (EXACT COPY FROM OLD CODE)
          const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
          const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
          const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
          const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
          
          // Determine opponent using team IDs/abbrs (EXACT COPY FROM OLD CODE)
          const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
          let gameOpponent = "";
          
          if (playerTeamId && homeTeamId && visitorTeamId) {
            if (playerTeamId === homeTeamId && visitorTeamAbbr) {
              gameOpponent = normalizeAbbr(visitorTeamAbbr);
            } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
              gameOpponent = normalizeAbbr(homeTeamAbbr);
            }
          }
          
          // Fallback: compare abbreviations directly if IDs missing (EXACT COPY FROM OLD CODE)
          if (!gameOpponent && homeTeamAbbr && visitorTeamAbbr) {
            const homeNorm = normalizeAbbr(homeTeamAbbr);
            const awayNorm = normalizeAbbr(visitorTeamAbbr);
            if (playerTeamNorm && playerTeamNorm === homeNorm) gameOpponent = awayNorm;
            else if (playerTeamNorm && playerTeamNorm === awayNorm) gameOpponent = homeNorm;
          }
          
          return gameOpponent === normalizedOpponent;
        })
        .slice(0, 6) // Limit to last 6 H2H games (same as old code)
        .map((s: any) => s.statValue);

      // Fallback: if no H2H stats found (e.g., team mapping edge cases), include any game where either side matches the opponent abbr
      if (h2hStats.length === 0 && normalizedOpponent) {
        const fallbackStats = gamesWithStats
          .filter((stats: any) => {
            const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
            const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
            const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
            const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
            const homeNorm = normalizeAbbr(homeTeamAbbr || '');
            const awayNorm = normalizeAbbr(visitorTeamAbbr || '');
            return homeNorm === normalizedOpponent || awayNorm === normalizedOpponent;
          })
          .slice(0, 6)
          .map((s: any) => s.statValue);
        
        if (fallbackStats.length > 0) {
          h2hStats = fallbackStats;
          console.log(`[calculatePlayerAverages][H2H Fallback] Used fallback games for ${playerName} vs ${opponent}`, {
            normalizedOpponent,
            fallbackCount: fallbackStats.length,
          });
        }
      }
      
      h2hAvg = h2hStats.length > 0
        ? h2hStats.reduce((sum: number, val: number) => sum + val, 0) / h2hStats.length
        : null;
      
      // Calculate H2H hit rate (how many times hit over the line)
      if (Number.isFinite(line) && h2hStats && h2hStats.length > 0) {
        const hits = h2hStats.filter((val: number) => val > line).length;
        h2hHitRate = { hits, total: h2hStats.length };
      }
    }

    // Calculate streak: consecutive games over the line (starting from most recent)
    // EXACT COPY FROM OLD CLIENT-SIDE CODE
    let streak: number | null = null;
    if (line !== undefined && line !== null && Number.isFinite(line) && gamesWithStats.length > 0) {
      streak = 0;
      // Games are already sorted newest first, so iterate from start
      for (const game of gamesWithStats) {
        if (game.statValue > line) {
          streak++;
        } else {
          // Once we hit a game that didn't go over, stop counting
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
      // Store stat value arrays for hit rate recalculation when line changes
      __last5Values: last5Values,
      __last10Values: last10Values,
      __h2hStats: h2hStats,
      __seasonValues: seasonValues,
    };
  } catch (error) {
    console.error(`[calculatePlayerAverages] Error for ${playerName}:`, error);
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

// Get player position
async function getPlayerPosition(baseUrl: string, playerName: string, team: string): Promise<'PG' | 'SG' | 'SF' | 'PF' | 'C' | null> {
  if (!team) return null;
  
  try {
    const teamAbbr = TEAM_FULL_TO_ABBR[team] || team.toUpperCase().trim();
    const url = `${baseUrl}/api/depth-chart?team=${encodeURIComponent(teamAbbr)}`;
    const response = await queuedFetch(url, { cache: 'no-store' });
    
    if (!response.ok) {
      console.warn(`[getPlayerPosition] Depth chart API not ok for ${teamAbbr}: ${response.status}`);
      // Try fallback to BDL player search
      return await getPlayerPositionFallback(baseUrl, playerName, teamAbbr);
    }
    
    const data = await response.json();
    if (!data?.success || !data.depthChart) {
      console.warn(`[getPlayerPosition] No depth chart data for ${teamAbbr}`);
      return await getPlayerPositionFallback(baseUrl, playerName, teamAbbr);
    }
    
    const normalize = (s: string) => {
      return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };
    
    const normalizedPlayerName = normalize(playerName);
    const positions: Array<'PG' | 'SG' | 'SF' | 'PF' | 'C'> = ['PG', 'SG', 'SF', 'PF', 'C'];
    
    // Try exact and partial matches
    for (const pos of positions) {
      const players = data.depthChart[pos] || [];
      for (const player of players) {
        const playerNameFromChart = typeof player === 'string' ? player : (player?.name || player?.displayName || player?.fullName || String(player || ''));
        if (!playerNameFromChart) continue;
        
        const normalizedChartName = normalize(playerNameFromChart);
        if (normalizedChartName === normalizedPlayerName || 
            normalizedChartName.includes(normalizedPlayerName) ||
            normalizedPlayerName.includes(normalizedChartName)) {
          return pos;
        }
      }
    }
    
    // Try matching by first and last name separately
    const nameParts = normalizedPlayerName.split(' ').filter(p => p.length > 0);
    if (nameParts.length >= 2) {
      const firstName = nameParts[0];
      const lastName = nameParts[nameParts.length - 1];
      for (const pos of positions) {
        const players = data.depthChart[pos] || [];
        for (const player of players) {
          const playerNameFromChart = typeof player === 'string' ? player : (player?.name || player?.displayName || player?.fullName || String(player || ''));
          if (!playerNameFromChart) continue;
          
          const normalizedChartName = normalize(playerNameFromChart);
          const chartParts = normalizedChartName.split(' ').filter(p => p.length > 0);
          if (chartParts.length >= 2) {
            const chartFirst = chartParts[0];
            const chartLast = chartParts[chartParts.length - 1];
            if ((firstName === chartFirst && lastName === chartLast) ||
                (firstName.includes(chartFirst) && lastName.includes(chartLast)) ||
                (chartFirst.includes(firstName) && chartLast.includes(lastName))) {
              return pos;
            }
          }
        }
      }
    }
    
    // Fallback to BDL player search
    return await getPlayerPositionFallback(baseUrl, playerName, teamAbbr);
  } catch (error) {
    console.warn(`[getPlayerPosition] Error for ${playerName} on ${team}:`, error);
    return await getPlayerPositionFallback(baseUrl, playerName, TEAM_FULL_TO_ABBR[team] || team.toUpperCase().trim());
  }
}

// Fallback: try BallDontLie player search for position
async function getPlayerPositionFallback(baseUrl: string, playerName: string, teamAbbr: string): Promise<'PG' | 'SG' | 'SF' | 'PF' | 'C' | null> {
  try {
    const normalize = (s: string) => {
      return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };
    
    const bdlUrl = `${baseUrl}/api/bdl/players?team=${encodeURIComponent(teamAbbr)}&q=${encodeURIComponent(playerName)}&per_page=5`;
    const bdlRes = await queuedFetch(bdlUrl, { cache: 'no-store' });
    if (bdlRes.ok) {
      const bdlJson = await bdlRes.json();
      const candidates: any[] = Array.isArray(bdlJson?.results) ? bdlJson.results : [];
      const normalizedPlayerName = normalize(playerName);
      const posMap: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'> = {
        'PG': 'PG', 'SG': 'SG', 'SF': 'SF', 'PF': 'PF', 'C': 'C',
        'G': 'SG', 'F': 'SF', 'GF': 'SG', 'FG': 'SF', 'FC': 'C', 'C-F': 'C', 'F-C': 'C'
      };
      for (const cand of candidates) {
        const cName = cand?.full || cand?.name || `${cand?.first_name || ''} ${cand?.last_name || ''}`.trim();
        const cNorm = normalize(cName);
        if (!cNorm) continue;
        if (cNorm === normalizedPlayerName || cNorm.includes(normalizedPlayerName) || normalizedPlayerName.includes(cNorm)) {
          const rawPos = String(cand?.position || cand?.pos || '').toUpperCase().trim();
          const mapped = posMap[rawPos] || null;
          if (mapped) {
            console.log(`[getPlayerPosition] ✅ Fallback matched ${playerName} via BDL (${cName}) -> ${mapped}`);
            return mapped;
          }
        }
      }
    }
  } catch (err) {
    // Silent fail - return null
  }
  return null;
}

// Helper function to map stat type to DvP metric - EXACT COPY FROM OLD CLIENT-SIDE CODE
function mapStatTypeToDvpMetric(statType: string): string | null {
  const mapping: Record<string, string> = {
    'PTS': 'pts',
    'REB': 'reb',
    'AST': 'ast',
    'STL': 'stl',
    'BLK': 'blk',
    'THREES': 'fg3m',
    'FG3M': 'fg3m',
    'FG_PCT': 'fg_pct',
    'TO': 'to',
    // Combined stats - will be calculated from component stats
    'PRA': 'pra',  // Points + Rebounds + Assists
    'PA': 'pa',    // Points + Assists
    'PR': 'pr',    // Points + Rebounds
    'RA': 'ra',    // Rebounds + Assists
  };
  const upperStat = statType.toUpperCase();
  const metric = mapping[upperStat] || null;
  if (!metric) {
    console.warn(`[mapStatTypeToDvpMetric] No mapping for statType: ${statType} (${upperStat})`);
  }
  return metric;
}

// Get DvP rating - EXACT COPY FROM OLD CLIENT-SIDE CODE
async function getDvpRating(
  baseUrl: string,
  opponent: string,
  position: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null,
  statType: string
): Promise<{ rank: number | null; statValue: number | null }> {
  if (!opponent) {
    console.warn(`[getDvpRating] No opponent provided for ${statType}`);
    return { rank: null, statValue: null };
  }
  if (!position) {
    console.warn(`[getDvpRating] No position provided for ${opponent} ${statType}`);
    return { rank: null, statValue: null };
  }
  
  const metric = mapStatTypeToDvpMetric(statType);
  if (!metric) {
    console.warn(`[getDvpRating] No metric mapping for statType: ${statType}`);
    return { rank: null, statValue: null };
  }
  
  try {
    // Opponent might already be an abbreviation, but try both
    let teamAbbr = opponent;
    if (TEAM_FULL_TO_ABBR[opponent]) {
      teamAbbr = TEAM_FULL_TO_ABBR[opponent];
    } else {
      // If it's not in the mapping, assume it's already an abbreviation
      teamAbbr = opponent.toUpperCase().trim();
    }
    
    // Fetch rank instead of perGame value (API uses 'pos' parameter)
    const url = `${baseUrl}/api/dvp/rank?pos=${position}&metric=${metric}`;
    console.log(`[getDvpRating] Fetching rank: ${url} (opponent: "${opponent}" -> teamAbbr: "${teamAbbr}")`);
    
    const response = await queuedFetch(url, { cache: 'no-store' });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.warn(`[getDvpRating] Rank API not ok: ${response.status} for ${url}`, errorText);
      return { rank: null, statValue: null };
    }
    
    const data = await response.json();
    console.log(`[getDvpRating] Rank response for ${opponent} (${teamAbbr}) ${position} ${statType}:`, data);
    
    if (!data.success) {
      console.warn(`[getDvpRating] Rank API returned success: false`, data);
      return { rank: null, statValue: null };
    }
    
    // Extract rank for this team from the ranks object
    const ranks = data.ranks || {};
    // Try both the teamAbbr and normalized versions
    const normalizedTeamAbbr = teamAbbr.toUpperCase().trim();
    let rank = ranks[normalizedTeamAbbr] ?? ranks[teamAbbr];
    
    // If still not found, try all variations
    if (rank === null || rank === undefined) {
      const allKeys = Object.keys(ranks);
      const matchingKey = allKeys.find(k => k.toUpperCase() === normalizedTeamAbbr || normalizedTeamAbbr.includes(k.toUpperCase()) || k.toUpperCase().includes(normalizedTeamAbbr));
      if (matchingKey) {
        rank = ranks[matchingKey];
      }
    }
    
    // Extract stat value for this team from the values array
    const values = data.values || [];
    const normalizedTeamAbbrLower = normalizedTeamAbbr.toLowerCase();
    let statValue: number | null = null;
    const teamValue = values.find((v: any) => {
      const vTeam = String(v.team || '').toUpperCase().trim();
      return vTeam === normalizedTeamAbbr || normalizedTeamAbbr === vTeam;
    });
    
    if (teamValue && teamValue.value !== null && teamValue.value !== undefined) {
      statValue = typeof teamValue.value === 'number' ? teamValue.value : parseFloat(String(teamValue.value));
      if (statValue !== null && isNaN(statValue)) statValue = null;
    }
    
    if (rank === null || rank === undefined) {
      console.warn(`[getDvpRating] No rank value for ${teamAbbr} in response. Available teams:`, Object.keys(ranks).slice(0, 5));
      return { rank: null, statValue };
    }
    
    const rankValue = typeof rank === 'number' ? rank : parseInt(String(rank), 10);
    if (isNaN(rankValue) || rankValue <= 0) {
      console.warn(`[getDvpRating] Invalid rank value: ${rank} for ${teamAbbr}`);
      return { rank: null, statValue };
    }
    
    console.log(`[getDvpRating] ✅ Extracted rank: ${rankValue}, statValue: ${statValue} for ${opponent} (${teamAbbr}) ${position} ${statType}`);
    return { rank: rankValue, statValue };
  } catch (error) {
    console.error(`[getDvpRating] Error for ${opponent} ${position} ${statType}:`, error);
    return { rank: null, statValue: null };
  }
}

/**
 * Server-side player props processing
 * Extracts props from odds cache and processes them
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Player Props Process] 📥 Processing request received');
    
    // Check if this is a background/async request (from cron or manual trigger)
    const { searchParams } = new URL(request.url);
    const asyncMode = searchParams.get('async') === '1' || request.headers.get('x-async') === 'true';
    
    // If async mode, start processing in background and return immediately
    if (asyncMode) {
      console.log('[Player Props Process] 🔄 Starting async processing (will complete in background)');
      
      // Start processing in background (don't await)
      processPlayerPropsAsync(request).catch((error) => {
        console.error('[Player Props Process] ❌ Background processing error:', error);
      });
      
      return NextResponse.json({
        success: true,
        message: 'Processing started in background',
        note: 'Processing will complete asynchronously and update cache when finished. Check logs for progress.',
      });
    }
    
    // Synchronous mode (for testing/debugging)
    return await processPlayerPropsSync(request);
    
  } catch (error) {
    console.error('[Player Props Process] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

async function processPlayerPropsSync(request: NextRequest) {
  return await processPlayerPropsCore(request);
}

async function processPlayerPropsAsync(request: NextRequest) {
  // Process in background - don't await, just start it
  processPlayerPropsCore(request).catch((error) => {
    console.error('[Player Props Process] ❌ Background processing error:', error);
  });
  
  // Return immediately
  return NextResponse.json({
    success: true,
    message: 'Processing started in background',
    note: 'Processing will complete asynchronously and update cache when finished. Check logs for progress.',
  });
}

async function processPlayerPropsCore(request: NextRequest) {
  try {
    // Get odds cache
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
      }, { status: 503 });
    }
    
    const gameDate = getGameDateFromOddsCache(oddsCache);
    const cacheKey = getPlayerPropsCacheKey(gameDate);
    
    console.log(`[Player Props Process] 📅 Processing for game date: ${gameDate}`);
    console.log(`[Player Props Process] 🔑 Cache key: ${cacheKey}`);
    
    // Check for force refresh parameter
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('refresh') === '1' || request.headers.get('x-force-refresh') === 'true';
    
    // Check if already cached (skip if force refresh)
    let cachedProps: any = null;
    if (!forceRefresh) {
      cachedProps = await getNBACache<any>(cacheKey, {
        restTimeoutMs: 5000,
        jsTimeoutMs: 5000,
        quiet: true,
      });
      
      if (!cachedProps) {
        cachedProps = cache.get<any>(cacheKey);
      }
      
      if (cachedProps && Array.isArray(cachedProps) && cachedProps.length > 0) {
        console.log(`[Player Props Process] ✅ Cache already exists (${cachedProps.length} props)`);
        return NextResponse.json({
          success: true,
          cached: true,
          data: cachedProps,
          propsCount: cachedProps.length,
        });
      }
    } else {
      console.log(`[Player Props Process] 🔄 Force refresh requested, skipping cache`);
    }
    
    // Process props from odds cache
    const games = oddsCache.games || [];
    const allProps: any[] = [];
    
    for (const game of games) {
      if (!game?.playerPropsByBookmaker || typeof game.playerPropsByBookmaker !== 'object') {
        continue;
      }
      
      const homeTeam = game.homeTeam || '';
      const awayTeam = game.awayTeam || '';
      const gameDateStr = game.commenceTime || gameDate;
      
      const homeTeamAbbr = TEAM_FULL_TO_ABBR[homeTeam] || homeTeam;
      const awayTeamAbbr = TEAM_FULL_TO_ABBR[awayTeam] || awayTeam;
      
      for (const [bookmakerName, bookmakerProps] of Object.entries(game.playerPropsByBookmaker)) {
        if (!bookmakerProps || typeof bookmakerProps !== 'object') continue;
        if (isPickemBookmaker(bookmakerName)) continue;
        
        for (const [playerName, playerData] of Object.entries(bookmakerProps)) {
          if (!playerData || typeof playerData !== 'object') continue;
          
          const propsData = playerData as any;
          const statTypes = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'THREES', 'PRA', 'PA', 'PR', 'RA'];
          
          for (const statType of statTypes) {
            const statData = propsData[statType];
            if (!statData) continue;
            
            const entries = Array.isArray(statData) ? statData : [statData];
            
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
              if (overOddsStr === '+100' && underOddsStr === '+100') continue;
              
              // Parse American odds to decimal (for storage/display)
              const overOdds = parseAmericanOdds(overOddsStr);
              const underOdds = parseAmericanOdds(underOddsStr);
              
              if (overOdds === null || underOdds === null) continue;
              
              // Calculate implied probabilities from ORIGINAL American odds strings (not decimal)
              const implied = calculateImpliedProbabilities(overOddsStr, underOddsStr);
              const overProb = implied ? implied.overImpliedProb : americanToImpliedProb(parseFloat(overOddsStr.replace(/[^0-9+-]/g, '')));
              const underProb = implied ? implied.underImpliedProb : americanToImpliedProb(parseFloat(underOddsStr.replace(/[^0-9+-]/g, '')));
              
              // Find player ID from mappings
              const playerMapping = PLAYER_ID_MAPPINGS.find(m => 
                m.name.toLowerCase() === playerName.toLowerCase() ||
                m.name.toLowerCase().includes(playerName.toLowerCase()) ||
                playerName.toLowerCase().includes(m.name.toLowerCase())
              );
              
              allProps.push({
                playerName,
                playerId: playerMapping?.bdlId || '',
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
                confidence: Math.max(overProb, underProb) > 70 ? 'High' : Math.max(overProb, underProb) > 65 ? 'Medium' : 'Low',
                gameDate: gameDateStr,
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
            }
          }
        }
      }
    }
    
    // Group and deduplicate (simplified version)
    const propsByPlayerStat = new Map<string, any[]>();
    for (const prop of allProps) {
      const roundedLine = Math.round(prop.line * 2) / 2;
      const key = `${prop.playerName}|${prop.statType}|${roundedLine}`;
      if (!propsByPlayerStat.has(key)) {
        propsByPlayerStat.set(key, []);
      }
      propsByPlayerStat.get(key)!.push(prop);
    }
    
    const processedProps: any[] = [];
    for (const [key, propGroup] of propsByPlayerStat.entries()) {
      const bestProb = Math.max(...propGroup.map(p => Math.max(p.overProb, p.underProb)));
      if (bestProb > 50) {
        const bestProp = propGroup.reduce((best, current) => {
          const bestMaxProb = Math.max(best.overProb, best.underProb);
          const currentMaxProb = Math.max(current.overProb, current.underProb);
          return currentMaxProb > bestMaxProb ? current : best;
        });
        processedProps.push(bestProp);
      }
    }
    
    // Remove duplicates
    const uniqueProps = processedProps.filter((prop, index, self) =>
      index === self.findIndex((p) => 
        p.playerName === prop.playerName && 
        p.statType === prop.statType && 
        Math.abs(p.line - prop.line) < 0.1
      )
    );
    
    console.log(`[Player Props Process] ✅ Processed ${uniqueProps.length} props, calculating stats...`);
    
    // Calculate stats for each prop
    const baseUrl = getBaseUrl(request);
    
    // Checkpoint system: Load existing checkpoint if available
    const checkpointKey = `${CHECKPOINT_CACHE_PREFIX}-${gameDate}`;
    let startIndex = 0;
    let propsWithStats: any[] = [];
    
    // Try to load checkpoint
    const checkpoint = await getNBACache<{ processedProps: any[]; startIndex: number }>(checkpointKey, {
      restTimeoutMs: 5000,
      jsTimeoutMs: 5000,
      quiet: true,
    });
    
    if (checkpoint && checkpoint.processedProps && checkpoint.startIndex > 0) {
      console.log(`[Player Props Process] 📍 Resuming from checkpoint at index ${checkpoint.startIndex} (${checkpoint.processedProps.length} props already processed)`);
      startIndex = checkpoint.startIndex;
      propsWithStats = checkpoint.processedProps;
    } else {
      // No checkpoint, start fresh
      propsWithStats = [];
      startIndex = 0;
    }
    
    // Process props in batches with timeout monitoring
    // Reduced batch size to process more batches before timeout and reduce rate limiting
    const BATCH_SIZE = 5; // Smaller batches = more frequent checkpoints + less rate limiting
    const MAX_RUNTIME_MS = 4 * 60 * 1000; // 4 minutes (leave 1 min buffer)
    const startTime = Date.now();
    
    for (let i = startIndex; i < uniqueProps.length; i += BATCH_SIZE) {
      // Check if we're approaching timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_RUNTIME_MS) {
        console.log(`[Player Props Process] ⏱️ Approaching timeout (${Math.round(elapsed/1000)}s), saving checkpoint at index ${i}...`);
        
        // Save checkpoint
        const checkpointData = {
          processedProps: propsWithStats,
          startIndex: i,
          totalProps: uniqueProps.length,
          processedCount: propsWithStats.length,
        };
        cache.set(checkpointKey, checkpointData, 60); // 1 hour TTL
        await setNBACache(checkpointKey, 'checkpoint', checkpointData, 60, false);
        
        console.log(`[Player Props Process] 💾 Checkpoint saved: ${propsWithStats.length}/${uniqueProps.length} props processed`);
        return NextResponse.json({
          success: true,
          message: 'Processing paused due to timeout - checkpoint saved',
          processed: propsWithStats.length,
          total: uniqueProps.length,
          nextIndex: i,
          note: 'Next cron run will continue from checkpoint',
        });
      }
      const batch = uniqueProps.slice(i, i + BATCH_SIZE);
      
      // Process props sequentially within batch to reduce rate limiting
      // Instead of parallel processing, process one at a time
      const batchResults: any[] = [];
      for (const prop of batch) {
        try {
          // Try to determine player's actual team by trying both teams for position lookup
          // This fixes the issue where we incorrectly assigned homeTeamAbbr to all players
          let position: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null = null;
          let actualTeam = prop.team;
          let actualOpponent = prop.opponent;
          
          // Try home team first
          position = await getPlayerPosition(baseUrl, prop.playerName, prop.team);
          
          // If not found, try the opponent team (player might be on away team)
          if (!position) {
            position = await getPlayerPosition(baseUrl, prop.playerName, prop.opponent);
            if (position) {
              // Player is actually on the "opponent" team, so swap them
              actualTeam = prop.opponent;
              actualOpponent = prop.team;
              console.log(`[Player Props Process] ✅ Found ${prop.playerName} on ${actualTeam} (was incorrectly assigned to ${prop.team})`);
            }
          }
          
          // Run averages and DvP sequentially to reduce rate limiting
          // (Changed from parallel to sequential)
          const averages = await calculatePlayerAverages(
            baseUrl,
            prop.playerId,
            prop.playerName,
            prop.statType,
            actualOpponent,
            actualTeam,
            prop.line
          );
          
          // Small delay before DvP call
          await new Promise(resolve => setTimeout(resolve, 200));
          
          const dvp = await getDvpRating(baseUrl, actualOpponent, position, prop.statType);
          
          // Log if position or DvP is missing for debugging
          if (!position) {
            console.warn(`[Player Props Process] ⚠️ No position found for ${prop.playerName} (tried ${prop.team} and ${prop.opponent}) - DvP will be null`);
          }
          if (!dvp.rank && position) {
            console.warn(`[Player Props Process] ⚠️ No DvP rank for ${prop.playerName} vs ${actualOpponent} (${position})`);
          }
          
          // Store stat value arrays for hit rate recalculation when line changes
          // We need to recalculate these in calculatePlayerAverages to store them
          // For now, we'll store them separately by calling a modified version
          // Actually, let's store them in the prop for now - we'll modify calculatePlayerAverages to return them
          batchResults.push({
            ...prop,
            team: actualTeam, // Use the correctly determined team
            opponent: actualOpponent, // Use the correctly determined opponent
            ...averages,
            position, // Store position for reference/debugging
            dvpRating: dvp.rank,
            dvpStatValue: dvp.statValue,
            // Note: Stat value arrays will be added in update-odds endpoint
            // For now, hit rates will be preserved (slightly inaccurate if line changes)
          });
        } catch (error) {
          console.error(`[Player Props Process] Error calculating stats for ${prop.playerName} ${prop.statType}:`, error);
          // Return prop with null stats instead of completely missing stats
          batchResults.push({
            ...prop,
            last5Avg: null,
            last10Avg: null,
            h2hAvg: null,
            seasonAvg: null,
            last5HitRate: null,
            last10HitRate: null,
            h2hHitRate: null,
            seasonHitRate: null,
            streak: null,
            position: null,
            dvpRating: null,
            dvpStatValue: null,
          });
        }
        
        // Add delay between props to reduce rate limiting
        if (batch.indexOf(prop) < batch.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      propsWithStats.push(...batchResults);
      
      // Save checkpoint after each batch (for recovery)
      const checkpointData = {
        processedProps: propsWithStats,
        startIndex: i + BATCH_SIZE,
        totalProps: uniqueProps.length,
        processedCount: propsWithStats.length,
      };
      cache.set(checkpointKey, checkpointData, 60); // 1 hour TTL
      await setNBACache(checkpointKey, 'checkpoint', checkpointData, 60, false).catch(() => {
        // Ignore checkpoint save errors - not critical
      });
      
      // Increased delay between batches to reduce rate limiting
      if (i + BATCH_SIZE < uniqueProps.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
        // Log progress every 5 batches
        if ((i / BATCH_SIZE) % 5 === 0) {
          const elapsed = Date.now() - startTime;
          console.log(`[Player Props Process] Progress: ${Math.min(i + BATCH_SIZE, uniqueProps.length)}/${uniqueProps.length} props processed (${Math.round(elapsed/1000)}s elapsed)`);
        }
      }
    }
    
    console.log(`[Player Props Process] ✅ Calculated stats for ${propsWithStats.length} props`);
    
    // Clear checkpoint since we're done
    try {
      cache.delete(checkpointKey);
      const { deleteNBACache } = await import('@/lib/nbaCache');
      await deleteNBACache(checkpointKey);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    // Cache the results
    cache.set(cacheKey, propsWithStats, 24 * 60);
    await setNBACache(cacheKey, 'player-props', propsWithStats, 24 * 60, false);
    
    return NextResponse.json({
      success: true,
      cached: false,
      data: propsWithStats,
      propsCount: propsWithStats.length,
      cacheKey,
      gameDate,
      lastUpdated: oddsCache.lastUpdated,
    });
    
  } catch (error) {
    console.error('[Player Props Process] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * GET endpoint for manual triggering
 * Allows manual cache refresh via URL
 */
export async function GET(request: NextRequest) {
  // Check for authorization (optional - can be called manually)
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const cronSecret = process.env.CRON_SECRET;
  
  // If secret is provided, validate it
  if (secret && cronSecret && secret !== cronSecret) {
    return NextResponse.json({
      success: false,
      error: 'Unauthorized',
    }, { status: 401 });
  }
  
  // Call the POST handler logic
  return POST(request);
}

