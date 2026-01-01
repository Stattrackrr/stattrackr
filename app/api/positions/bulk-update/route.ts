/**
 * Bulk Position Update API
 * 
 * Recalculates positions for all teams from NBA boxscores and updates master.json
 * 
 * Query params:
 * - season: Season year (default: "2025")
 * - minGames: Minimum games a player must have to be updated (default: 3)
 * - dryRun: If "1", shows what would be updated without saving (default: "0")
 * - team: Optional single team to process (otherwise processes all teams)
 * 
 * Example:
 *   GET /api/positions/bulk-update?season=2025&minGames=3&dryRun=1
 *   GET /api/positions/bulk-update?season=2025&team=MIL
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const VALID_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
type Position = typeof VALID_POSITIONS[number];

const TEAMS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
];

const ABBR_TO_TEAM_ID: Record<string, number> = {
  ATL: 1610612737, BOS: 1610612738, BKN: 1610612751, CHA: 1610612766, CHI: 1610612741,
  CLE: 1610612739, DAL: 1610612742, DEN: 1610612743, DET: 1610612765, GSW: 1610612744,
  HOU: 1610612745, IND: 1610612754, LAC: 1610612746, LAL: 1610612747, MEM: 1610612763,
  MIA: 1610612748, MIL: 1610612749, MIN: 1610612750, NOP: 1610612740, NYK: 1610612752,
  OKC: 1610612760, ORL: 1610612753, PHI: 1610612755, PHX: 1610612756, POR: 1610612757,
  SAC: 1610612758, SAS: 1610612759, TOR: 1610612761, UTA: 1610612762, WAS: 1610612764
};

const NBA_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://www.nba.com',
  'Referer': 'https://www.nba.com/stats/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
};

function normName(name: string): string {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z\s]/g, ' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function idx(headers: string[], ...names: string[]): number {
  for (const name of names) {
    const i = headers.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

async function nbaFetch(pathAndQuery: string, timeout: number = 15000) {
  const url = `https://stats.nba.com/stats/${pathAndQuery}`;
  
  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const res = await fetch(url, { 
      headers: NBA_HEADERS,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      const text = await res.text();
      console.error(`[Bulk Update] NBA API error ${res.status}: ${text.substring(0, 200)}`);
      throw new Error(`NBA API ${res.status}: ${text.substring(0, 100)}`);
    }
    const data = await res.json();
    
    // Check for API error messages
    if (data?.errorMessage) {
      console.error(`[Bulk Update] NBA API error message: ${data.errorMessage}`);
      throw new Error(`NBA API error: ${data.errorMessage}`);
    }
    
    return data;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }
}

function formatSeason(season: string): string {
  const year = parseInt(season, 10);
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}

interface PlayerPosition {
  name: string;
  normalized: string;
  position: Position;
  isStarter: boolean;
  minutes: string;
  isExact: boolean;
  originalStartPos: string;
  inferenceMethod: string;
  stats: { ast: number; reb: number; blk: number; pts: number };
}

async function fetchBoxscorePositions(gameId: string, teamId: number): Promise<PlayerPosition[]> {
  try {
    // Using boxscoretraditionalv2 endpoint
    // Endpoint: https://stats.nba.com/stats/boxscoretraditionalv2?GameID={gameId}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0
    console.log(`[Bulk Update] Fetching boxscore: boxscoretraditionalv2?GameID=${gameId}`);
    const data = await nbaFetch(`boxscoretraditionalv2?GameID=${gameId}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`);
    const pset = (data?.resultSets || []).find((r: any) => (r?.name || '').toLowerCase().includes('playerstats')) || data?.resultSets?.[0];
    const headers = pset?.headers || [];
    const rows = pset?.rowSet || [];
    
    const iTeamId = idx(headers, 'TEAM_ID');
    const iPlayer = idx(headers, 'PLAYER_NAME');
    const iStartPos = idx(headers, 'START_POSITION');
    const iMin = idx(headers, 'MIN');
    const iAst = idx(headers, 'AST');
    const iReb = idx(headers, 'REB');
    const iBlk = idx(headers, 'BLK');
    
    if (iTeamId < 0 || iPlayer < 0 || iStartPos < 0) return [];
    
    const teamPlayers: Array<{
      name: string;
      normalized: string;
      startPos: string;
      isStarter: boolean;
      minutes: string;
      stats: { ast: number; reb: number; blk: number; pts: number };
    }> = [];
    const starterPositions = new Set<string>();
    
    for (const row of rows) {
      const rowTeamId = Number(row[iTeamId]);
      if (rowTeamId !== teamId) continue;
      
      const playerName = String(row[iPlayer] || '').trim();
      const startPos = String(row[iStartPos] || '').toUpperCase().trim();
      const minutes = String(row[iMin] || '').trim();
      
      if (!playerName || !minutes || minutes === '') continue;
      
      // Log what START_POSITION values we're getting for debugging
      if (startPos && startPos.length > 0 && !['PG', 'SG', 'SF', 'PF', 'C'].includes(startPos)) {
        console.log(`[Bulk Update] ⚠️ Got non-standard START_POSITION: "${startPos}" for ${playerName}`);
      }
      
      const isStarter = Boolean(startPos && startPos.length > 0);
      const ast = Number(row[iAst] || 0);
      const reb = Number(row[iReb] || 0);
      const blk = Number(row[iBlk] || 0);
      const iPts = idx(headers, 'PTS');
      const pts = iPts >= 0 ? Number(row[iPts] || 0) : 0;
      
      if (isStarter && VALID_POSITIONS.includes(startPos as Position)) {
        starterPositions.add(startPos);
      }
      
      teamPlayers.push({
        name: playerName,
        normalized: normName(playerName),
        startPos: startPos,
        isStarter: isStarter,
        minutes: minutes,
        stats: { ast, reb, blk, pts }
      });
    }
    
    const positions: PlayerPosition[] = [];
    const benchPlayers: typeof teamPlayers = [];
    
    // Process starters first
    for (const player of teamPlayers) {
      if (!player.isStarter) {
        benchPlayers.push(player);
        continue;
      }
      
      const { name, normalized, startPos, minutes, stats } = player;
      const { ast, reb, blk } = stats;
      
      let finalPosition: Position | null = null;
      let isExact = false;
      let inferenceMethod = '';
      
      if (VALID_POSITIONS.includes(startPos as Position)) {
        finalPosition = startPos as Position;
        isExact = true;
        inferenceMethod = 'starter_exact';
      } else if (startPos === 'G') {
        if (starterPositions.has('PG') && !starterPositions.has('SG')) {
          finalPosition = 'SG';
          inferenceMethod = 'starter_context_fill';
        } else if (starterPositions.has('SG') && !starterPositions.has('PG')) {
          finalPosition = 'PG';
          inferenceMethod = 'starter_context_fill';
        } else {
          finalPosition = ast >= 5 ? 'PG' : 'SG';
          inferenceMethod = 'starter_heuristic';
        }
        isExact = false;
      } else if (startPos === 'F') {
        if (starterPositions.has('SF') && !starterPositions.has('PF')) {
          finalPosition = 'PF';
          inferenceMethod = 'starter_context_fill';
        } else if (starterPositions.has('PF') && !starterPositions.has('SF')) {
          finalPosition = 'SF';
          inferenceMethod = 'starter_context_fill';
        } else {
          finalPosition = (reb >= 8 || blk >= 2) ? 'PF' : 'SF';
          inferenceMethod = 'starter_heuristic';
        }
        isExact = false;
      } else if (startPos === 'C') {
        finalPosition = 'C';
        isExact = true;
        inferenceMethod = 'starter_exact';
      }
      
      if (finalPosition) {
        positions.push({
          name,
          normalized,
          position: finalPosition,
          isStarter: true,
          minutes,
          isExact,
          originalStartPos: startPos,
          inferenceMethod,
          stats
        });
      }
    }
    
    // Process bench players
    const benchGuards: typeof teamPlayers = [];
    const benchForwards: typeof teamPlayers = [];
    const benchCenters: typeof teamPlayers = [];
    
    for (const player of benchPlayers) {
      const { reb, blk, ast } = player.stats;
      if (reb >= 10 || blk >= 2) {
        benchCenters.push(player);
      } else if (ast >= 3 || reb < 6) {
        benchGuards.push(player);
      } else {
        benchForwards.push(player);
      }
    }
    
    benchGuards.sort((a, b) => b.stats.ast - a.stats.ast);
    for (let i = 0; i < benchGuards.length; i++) {
      const player = benchGuards[i];
      positions.push({
        name: player.name,
        normalized: player.normalized,
        position: i === 0 ? 'PG' : 'SG',
        isStarter: false,
        minutes: player.minutes,
        isExact: false,
        originalStartPos: 'BENCH',
        inferenceMethod: i === 0 ? 'bench_guard_most_ast' : 'bench_guard_other',
        stats: player.stats
      });
    }
    
    benchForwards.sort((a, b) => b.stats.reb - a.stats.reb);
    for (let i = 0; i < benchForwards.length; i++) {
      const player = benchForwards[i];
      positions.push({
        name: player.name,
        normalized: player.normalized,
        position: i === 0 ? 'PF' : 'SF',
        isStarter: false,
        minutes: player.minutes,
        isExact: false,
        originalStartPos: 'BENCH',
        inferenceMethod: i === 0 ? 'bench_forward_most_reb' : 'bench_forward_other',
        stats: player.stats
      });
    }
    
    for (const player of benchCenters) {
      positions.push({
        name: player.name,
        normalized: player.normalized,
        position: 'C',
        isStarter: false,
        minutes: player.minutes,
        isExact: false,
        originalStartPos: 'BENCH',
        inferenceMethod: 'bench_center',
        stats: player.stats
      });
    }
    
    return positions;
  } catch (e: any) {
    console.error(`Error fetching boxscore for game ${gameId}:`, e.message);
    return [];
  }
}

function formatMDY(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const y = d.getFullYear();
  return `${m}/${day}/${y}`;
}

async function fetchStartingLineupsForDate(date: string): Promise<Map<string, Array<{ name: string; position: string; teamAbbr: string }>>> {
  // Try to fetch starting lineups from core-api.nba.com
  // This is the endpoint used by nba.com/players/todays-lineups
  const lineups = new Map<string, Array<{ name: string; position: string; teamAbbr: string }>>();
  
  try {
    // Try different possible endpoints
    const endpoints = [
      `https://core-api.nba.com/cp/api/v1.9/lineups?date=${date}&platform=web`,
      `https://core-api.nba.com/cp/api/v1.9/starting-lineups?date=${date}&platform=web`,
      `https://stats.nba.com/stats/leaguedashlineups?DateFrom=${date}&DateTo=${date}&GameSegment=&LastNGames=0&LeagueID=00&Location=&MeasureType=Base&Month=0&OpponentTeamID=0&Outcome=&PaceAdjust=N&PerMode=Totals&Period=0&PlusMinus=N&Rank=N&Season=2025-26&SeasonSegment=&SeasonType=Regular+Season&VsConference=&VsDivision=`,
    ];
    
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(10000)
        });
        
        if (res.ok) {
          const data = await res.json();
          console.log(`[Bulk Update] ✅ Found lineups API: ${endpoint}`);
          // Parse the response and extract lineups
          // This will need to be adjusted based on actual API response format
          return lineups;
        }
      } catch (e: any) {
        // Try next endpoint
        continue;
      }
    }
    
    console.log(`[Bulk Update] ⚠️ Could not find lineups API for ${date}`);
  } catch (e: any) {
    console.error(`[Bulk Update] Error fetching lineups: ${e.message}`);
  }
  
  return lineups;
}

async function fetchTeamGameLogFromBDL(teamAbbr: string, seasonYear: number, teamId: number): Promise<Array<{ gameId: string; date: string }>> {
  try {
    // Use BDL API to get games (more reliable than NBA Stats teamgamelog)
    const BDL_BASE = 'https://api.balldontlie.io/v1';
    const ABBR_TO_TEAM_ID_BDL: Record<string, number> = {
      ATL:1,BOS:2,BKN:3,CHA:4,CHI:5,CLE:6,DAL:7,DEN:8,DET:9,GSW:10,
      HOU:11,IND:12,LAC:13,LAL:14,MEM:15,MIA:16,MIL:17,MIN:18,NOP:19,NYK:20,
      OKC:21,ORL:22,PHI:23,PHX:24,POR:25,SAC:26,SAS:27,TOR:28,UTA:29,WAS:30,
    };
    
    const bdlTeamId = ABBR_TO_TEAM_ID_BDL[teamAbbr];
    if (!bdlTeamId) {
      console.error(`[Bulk Update] No BDL team ID for ${teamAbbr}`);
      return [];
    }
    
    const gamesUrl = new URL(`${BDL_BASE}/games`);
    gamesUrl.searchParams.set('per_page', '100');
    gamesUrl.searchParams.append('seasons[]', String(seasonYear));
    gamesUrl.searchParams.append('team_ids[]', String(bdlTeamId));
    
    const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';
    const authHeader = apiKey ? (apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`) : '';
    
    console.log(`[Bulk Update] Fetching games from BDL: ${gamesUrl.toString()}`);
    const response = await fetch(gamesUrl.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'StatTrackr/1.0',
        'Authorization': authHeader,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Bulk Update] BDL API error ${response.status}: ${errorText}`);
      return [];
    }
    
    const json = await response.json();
    const games = Array.isArray(json?.data) ? json.data : [];
    const finals = games.filter((g: any) => String(g?.status || '').toLowerCase().includes('final'));
    
    console.log(`[Bulk Update] Found ${finals.length} final games from BDL for ${teamAbbr}`);
    
    // Convert BDL games to NBA game IDs using scoreboard
    const gameInfo: Array<{ gameId: string; date: string }> = [];
    
    for (const game of finals) {
      if (!game.date) continue;
      
      try {
        const gameDate = new Date(game.date);
        const mdy = formatMDY(gameDate);
        const homeAbbr = String(game?.home_team?.abbreviation || '').toUpperCase();
        const awayAbbr = String(game?.visitor_team?.abbreviation || '').toUpperCase();
        
        console.log(`[Bulk Update] Converting game: ${game.date}, ${awayAbbr} @ ${homeAbbr}, MDY: ${mdy}`);
        
        // Fetch NBA scoreboard for this date with retry logic
        let sb: any = null;
        let retries = 2;
        while (retries > 0 && !sb) {
          try {
            sb = await nbaFetch(`scoreboardv2?GameDate=${encodeURIComponent(mdy)}&DayOffset=0`, 10000); // 10s timeout
          } catch (e: any) {
            retries--;
            if (retries > 0) {
              console.log(`[Bulk Update] Scoreboard fetch failed (${e.message}), retrying... (${retries} left)`);
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            } else {
              console.error(`[Bulk Update] Scoreboard fetch failed after retries: ${e.message}`);
              // Continue to next game instead of crashing
              continue;
            }
          }
        }
        
        if (!sb) {
          console.log(`[Bulk Update] ⚠️ Skipping game ${awayAbbr} @ ${homeAbbr} on ${game.date} - scoreboard fetch failed`);
          continue;
        }
        const sset = (sb?.resultSets || []).find((r: any) => (r?.name || '').toLowerCase().includes('games')) || sb?.resultSets?.[0];
        const sh = sset?.headers || [];
        const srows: any[] = sset?.rowSet || [];
        
        console.log(`[Bulk Update] Scoreboard for ${mdy}: ${srows.length} games found`);
        
        const iGid = idx(sh, 'GAME_ID');
        const iHome = idx(sh, 'HOME_TEAM_ID');
        const iAway = idx(sh, 'VISITOR_TEAM_ID');
        const iHomeAbbr = idx(sh, 'HOME_TEAM_ABBREVIATION');
        const iAwayAbbr = idx(sh, 'VISITOR_TEAM_ABBREVIATION');
        
        if (iGid < 0 || iHome < 0 || iAway < 0) {
          console.error(`[Bulk Update] Missing required columns. GID: ${iGid}, Home: ${iHome}, Away: ${iAway}`);
          continue;
        }
        
        const wantHome = ABBR_TO_TEAM_ID[homeAbbr] || 0;
        const wantAway = ABBR_TO_TEAM_ID[awayAbbr] || 0;
        
        console.log(`[Bulk Update] Looking for: Home=${homeAbbr} (${wantHome}), Away=${awayAbbr} (${wantAway})`);
        
        // Try matching by team IDs first, then by abbreviations
        let nbaGame = srows.find((r: any) => 
          (Number(r[iHome]) === wantHome && Number(r[iAway]) === wantAway) || 
          (Number(r[iHome]) === wantAway && Number(r[iAway]) === wantHome)
        );
        
        // Fallback to abbreviation matching
        if (!nbaGame && iHomeAbbr >= 0 && iAwayAbbr >= 0) {
          nbaGame = srows.find((r: any) => {
            const rHome = String(r[iHomeAbbr] || '').toUpperCase();
            const rAway = String(r[iAwayAbbr] || '').toUpperCase();
            return (rHome === homeAbbr && rAway === awayAbbr) || (rHome === awayAbbr && rAway === homeAbbr);
          });
        }
        
        if (nbaGame && nbaGame[iGid]) {
          console.log(`[Bulk Update] ✅ Found NBA game ID: ${nbaGame[iGid]} for ${awayAbbr} @ ${homeAbbr}`);
          gameInfo.push({ gameId: String(nbaGame[iGid]), date: game.date });
        } else {
          // Scoreboard doesn't have the game - try a smart sequential search
          // Based on screenshot showing 0022500048, format is: 00225XXXXX
          // We'll search with date checking to find the right game quickly
          console.log(`[Bulk Update] Scoreboard didn't have game, trying smart sequential search (1-150)...`);
          const seasonPrefix = '00225';
          const targetDate = new Date(game.date);
          let found = false;
          let lastCheckedDate: Date | null = null;
          
          // Try game numbers 1-300 (wider range for early-mid season)
          // Game ID 0022500048 exists, so we know games are in this range
          for (let gameNum = 1; gameNum <= 300 && !found; gameNum++) {
            const potentialGameId = `${seasonPrefix}${String(gameNum).padStart(5, '0')}`;
            
            try {
              const testBs = await nbaFetch(`boxscoretraditionalv2?GameID=${potentialGameId}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`);
              const testPset = (testBs?.resultSets || []).find((r: any) => (r?.name || '').toLowerCase().includes('playerstats')) || testBs?.resultSets?.[0];
              const testRows = testPset?.rowSet || [];
              
              if (testRows.length > 0) {
                const testHeaders = testPset?.headers || [];
                const iTeamId = idx(testHeaders, 'TEAM_ID');
                const iTeamAbbr = idx(testHeaders, 'TEAM_ABBREVIATION');
                const iGameDate = idx(testHeaders, 'GAME_DATE');
                
                // Check date first (faster than team check)
                if (iGameDate >= 0 && testRows.length > 0) {
                  const gameDateStr = String(testRows[0][iGameDate] || '');
                  const boxscoreDate = new Date(gameDateStr);
                  
                  if (!isNaN(boxscoreDate.getTime())) {
                    lastCheckedDate = boxscoreDate;
                    
                    // If we've passed the target date, we won't find it (games are sequential by date)
                    if (boxscoreDate > targetDate && gameNum > 10) {
                      console.log(`[Bulk Update] Passed target date (found ${boxscoreDate.toISOString().split('T')[0]}, looking for ${game.date}), stopping search`);
                      break;
                    }
                    
                    // Check if date matches (within 1 day tolerance)
                    const dateDiff = Math.abs(boxscoreDate.getTime() - targetDate.getTime());
                    const dateMatches = dateDiff < 24 * 60 * 60 * 1000; // Within 1 day
                    
                    if (dateMatches) {
                      // Date matches, now check team
                      const hasOurTeam = testRows.some((r: any) => {
                        if (iTeamId >= 0) {
                          return Number(r[iTeamId]) === teamId;
                        }
                        if (iTeamAbbr >= 0) {
                          return String(r[iTeamAbbr] || '').toUpperCase() === teamAbbr;
                        }
                        return false;
                      });
                      
                      if (hasOurTeam) {
                        console.log(`[Bulk Update] ✅ Found NBA game ID: ${potentialGameId} for ${awayAbbr} @ ${homeAbbr} on ${game.date} (checked ${gameNum} games)`);
                        gameInfo.push({ gameId: potentialGameId, date: game.date });
                        found = true;
                        break;
                      }
                    }
                  }
                } else {
                  // No date field, check team directly
                  const hasOurTeam = testRows.some((r: any) => {
                    if (iTeamId >= 0) return Number(r[iTeamId]) === teamId;
                    if (iTeamAbbr >= 0) return String(r[iTeamAbbr] || '').toUpperCase() === teamAbbr;
                    return false;
                  });
                  
                  if (hasOurTeam) {
                    console.log(`[Bulk Update] ✅ Found NBA game ID (no date check): ${potentialGameId} for ${awayAbbr} @ ${homeAbbr} (checked ${gameNum} games)`);
                    gameInfo.push({ gameId: potentialGameId, date: game.date });
                    found = true;
                    break;
                  }
                }
              }
              
              // Progress logging
              if (gameNum % 50 === 0) {
                const dateInfo = lastCheckedDate ? ` (last date: ${lastCheckedDate.toISOString().split('T')[0]})` : '';
                console.log(`[Bulk Update] Checked ${gameNum} game IDs${dateInfo}...`);
              }
              
              // Minimal delay - only every 20 games to speed up
              if (gameNum % 20 === 0) {
                await new Promise(resolve => setTimeout(resolve, 100));
              }
            } catch (e: any) {
              // Game doesn't exist or error - continue
              continue;
            }
          }
          
          if (!found) {
            console.log(`[Bulk Update] ❌ Could not find NBA game ID for ${awayAbbr} @ ${homeAbbr} on ${game.date} after checking 150 games`);
          }
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e: any) {
        console.error(`[Bulk Update] Error converting game ${game.id}:`, e.message);
        console.error(`[Bulk Update] Error stack:`, e.stack);
      }
    }
    
    console.log(`[Bulk Update] Converted ${gameInfo.length} BDL games to NBA game IDs for ${teamAbbr}`);
    return gameInfo;
  } catch (e: any) {
    console.error(`[Bulk Update] Error fetching BDL games for ${teamAbbr}:`, e.message);
    return [];
  }
}

async function fetchTeamGameLog(teamId: number, seasonLabel: string): Promise<string[]> {
  try {
    const url = `teamgamelog?TeamID=${teamId}&Season=${encodeURIComponent(seasonLabel)}&SeasonType=${encodeURIComponent('Regular Season')}`;
    console.log(`[Bulk Update] Fetching: ${url}`);
    const data = await nbaFetch(url);
    
    // Check if we got a valid response
    if (!data) {
      console.error(`[Bulk Update] No data returned for team ${teamId}`);
      return [];
    }
    
    // Log the full response structure for debugging
    console.log(`[Bulk Update] Response structure:`, {
      hasResultSets: !!data.resultSets,
      resultSetsLength: data.resultSets?.length || 0,
      resultSetsNames: data.resultSets?.map((r: any) => r?.name) || [],
      hasResultSet: !!data.resultSet,
      keys: Object.keys(data)
    });
    
    // Try multiple ways to find the result set
    let rs = null;
    if (data?.resultSets && Array.isArray(data.resultSets)) {
      rs = data.resultSets.find((r: any) => (r?.name || '').toLowerCase().includes('teamgamelog')) 
        || data.resultSets.find((r: any) => (r?.name || '').toLowerCase().includes('game'))
        || data.resultSets[0];
    }
    
    if (!rs && data?.resultSet) {
      rs = Array.isArray(data.resultSet) ? data.resultSet[0] : data.resultSet;
    }
    
    if (!rs) {
      console.error(`[Bulk Update] No result set found for team ${teamId}. Full response:`, JSON.stringify(data, null, 2).substring(0, 500));
      return [];
    }
    
    const headers = rs?.headers || [];
    const rows = rs?.rowSet || [];
    
    console.log(`[Bulk Update] Team ${teamId}: Result set name: "${rs?.name}", Headers: ${headers.length}, Rows: ${rows.length}`);
    
    if (rows.length === 0 && headers.length > 0) {
      console.log(`[Bulk Update] Sample headers:`, headers.slice(0, 10));
      console.log(`[Bulk Update] Full result set:`, JSON.stringify(rs, null, 2).substring(0, 1000));
    }
    
    const iGameId = idx(headers, 'GAME_ID', 'Game_ID');
    
    if (iGameId < 0) {
      console.error(`[Bulk Update] No GAME_ID column found for team ${teamId}. Headers:`, headers);
      return [];
    }
    
    const gameIds = rows.map((r: any) => String(r[iGameId])).filter(Boolean);
    console.log(`[Bulk Update] Team ${teamId}: Found ${gameIds.length} games`);
    return gameIds;
  } catch (e: any) {
    console.error(`[Bulk Update] Error fetching game log for team ${teamId}:`, e.message);
    console.error(`[Bulk Update] Error stack:`, e.stack);
    return [];
  }
}

async function loadMaster(): Promise<{ positions: Record<string, Position>; aliases: Record<string, string> }> {
  const filePath = path.resolve(process.cwd(), 'data', 'player_positions', 'master.json');
  try {
    try {
      await fs.promises.access(filePath);
    } catch {
      return { positions: {}, aliases: {} };
    }
    const content = await fs.promises.readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    return {
      positions: data.positions || {},
      aliases: data.aliases || {}
    };
  } catch {
    return { positions: {}, aliases: {} };
  }
}

async function saveMaster(data: { positions: Record<string, Position>; aliases: Record<string, string> }): Promise<void> {
  const filePath = path.resolve(process.cwd(), 'data', 'player_positions', 'master.json');
  const dir = path.dirname(filePath);
  try {
    await fs.promises.access(dir);
  } catch {
    await fs.promises.mkdir(dir, { recursive: true });
  }
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function GET(req: NextRequest) {
  try {
    // Authentication check - admin only
    const { authorizeAdminRequest } = await import('@/lib/adminAuth');
    const authResult = await authorizeAdminRequest(req);
    if (!authResult.authorized) {
      return authResult.response;
    }

    // Rate limiting
    const { checkRateLimit, strictRateLimiter } = await import('@/lib/rateLimit');
    const rateResult = checkRateLimit(req, strictRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }

    const { searchParams } = new URL(req.url);
    let season = searchParams.get('season') || '2025';
    const minGames = parseInt(searchParams.get('minGames') || '3', 10);
    const dryRun = searchParams.get('dryRun') === '1';
    const teamParam = searchParams.get('team');
    
    const teamsToProcess = teamParam ? [teamParam.toUpperCase()] : TEAMS;
    let seasonLabel = formatSeason(season);
    
    // If season is 2025 but we're getting 0 games, the season might not have started yet
    // Try 2024-25 as fallback
    const tryPreviousSeason = season === '2025';
    
    const allPlayerStats = new Map<string, {
      name: string;
      normalized: string;
      positions: Record<Position, { count: number; starterCount: number; benchCount: number }>;
      totalGames: number;
      starterGames: number;
      benchGames: number;
    }>();
    
    const results: Array<{
      team: string;
      gamesProcessed: number;
      playersFound: number;
      error?: string;
    }> = [];
    
    // Process each team
    for (const teamAbbr of teamsToProcess) {
      const teamId = ABBR_TO_TEAM_ID[teamAbbr];
      if (!teamId) {
        results.push({ team: teamAbbr, gamesProcessed: 0, playersFound: 0, error: 'Unknown team' });
        continue;
      }
      
      try {
        console.log(`[Bulk Update] Processing ${teamAbbr} (ID: ${teamId}, Season: ${seasonLabel})...`);
        
        // Try BDL API first (more reliable for current season)
        let gameInfoList = await fetchTeamGameLogFromBDL(teamAbbr, parseInt(season), teamId);
        let actualSeason = seasonLabel;
        
        // If BDL found games but we couldn't convert them (NBA API doesn't have data yet)
        // Try NBA Stats API directly
        if (gameInfoList.length === 0) {
          console.log(`[Bulk Update] ${teamAbbr}: Could not convert BDL games to NBA IDs, trying NBA Stats API directly...`);
          const nbaGameIds = await fetchTeamGameLog(teamId, seasonLabel);
          gameInfoList = nbaGameIds.map(gid => ({ gameId: gid, date: '' }));
          
          // If still no games and we're trying 2025, try 2024-25 as fallback
          if (gameInfoList.length === 0 && tryPreviousSeason) {
            const prevSeason = '2024-25';
            console.log(`[Bulk Update] ${teamAbbr}: No games in ${seasonLabel}, trying ${prevSeason}...`);
            const prevGameIds = await fetchTeamGameLog(teamId, prevSeason);
            if (prevGameIds.length > 0) {
              gameInfoList = prevGameIds.map(gid => ({ gameId: gid, date: '' }));
              actualSeason = prevSeason;
              console.log(`[Bulk Update] ${teamAbbr}: Using ${prevSeason} (${prevGameIds.length} games found)`);
            }
          }
        }
        
        // If we still have no games, the NBA API doesn't have this season's data yet
        if (gameInfoList.length === 0) {
          console.log(`[Bulk Update] ${teamAbbr}: No games found. NBA Stats API may not have ${seasonLabel} data yet.`);
          console.log(`[Bulk Update] ${teamAbbr}: Recommendation: Use season=2024 for 2024-25 season which has complete data.`);
          results.push({ 
            team: teamAbbr, 
            gamesProcessed: 0, 
            playersFound: 0, 
            error: `No games found. NBA Stats API may not have ${seasonLabel} data yet. Try season=2024 for 2024-25 season.` 
          });
          continue;
        }
        
        console.log(`[Bulk Update] ${teamAbbr}: Found ${gameInfoList.length} games to process`);
        
        console.log(`[Bulk Update] ${teamAbbr}: Found ${gameInfoList.length} games`);
        
        if (gameInfoList.length === 0) {
          results.push({ team: teamAbbr, gamesProcessed: 0, playersFound: 0, error: 'No games found' });
          continue;
        }
        
        // Process each game
        let gamesProcessed = 0;
        for (const gameInfo of gameInfoList) {
          const gameId = gameInfo.gameId;
          try {
            const positions = await fetchBoxscorePositions(gameId, teamId);
            
            for (const player of positions) {
              if (!allPlayerStats.has(player.normalized)) {
                allPlayerStats.set(player.normalized, {
                  name: player.name,
                  normalized: player.normalized,
                  positions: {} as any,
                  totalGames: 0,
                  starterGames: 0,
                  benchGames: 0
                });
              }
              
              const stats = allPlayerStats.get(player.normalized)!;
              stats.totalGames++;
              if (player.isStarter) {
                stats.starterGames++;
              } else {
                stats.benchGames++;
              }
              
              if (!stats.positions[player.position]) {
                stats.positions[player.position] = { count: 0, starterCount: 0, benchCount: 0 };
              }
              stats.positions[player.position].count++;
              if (player.isStarter) {
                stats.positions[player.position].starterCount++;
              } else {
                stats.positions[player.position].benchCount++;
              }
            }
            
            gamesProcessed++;
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (e: any) {
            console.error(`[Bulk Update] Error processing game ${gameId}:`, e.message);
          }
        }
        
        results.push({
          team: teamAbbr,
          gamesProcessed,
          playersFound: Array.from(allPlayerStats.values()).filter(s => s.totalGames >= minGames).length
        });
        
      } catch (e: any) {
        console.error(`[Bulk Update] Error processing team ${teamAbbr}:`, e.message);
        results.push({ team: teamAbbr, gamesProcessed: 0, playersFound: 0, error: e.message });
      }
    }
    
    // Calculate recommended positions
    const updates: Array<{
      name: string;
      normalized: string;
      currentPosition?: Position;
      recommendedPosition: Position;
      confidence: number;
      totalGames: number;
      starterGames: number;
      positionBreakdown: Record<string, { total: number; starter: number; bench: number }>;
    }> = [];
    
    for (const stats of allPlayerStats.values()) {
      if (stats.totalGames < minGames) continue;
      
      let mostCommonPos: Position | null = null;
      let maxCount = 0;
      let maxStarterCount = 0;
      let maxBenchCount = 0;
      
      for (const [pos, posStats] of Object.entries(stats.positions)) {
        const position = pos as Position;
        if (posStats.count > maxCount ||
            (posStats.count === maxCount && posStats.starterCount > maxStarterCount) ||
            (posStats.count === maxCount && posStats.starterCount === maxStarterCount && posStats.benchCount > maxBenchCount)) {
          mostCommonPos = position;
          maxCount = posStats.count;
          maxStarterCount = posStats.starterCount;
          maxBenchCount = posStats.benchCount;
        }
      }
      
      if (mostCommonPos) {
        const master = await loadMaster();
        const currentPosition = master.positions[stats.normalized];
        
        updates.push({
          name: stats.name,
          normalized: stats.normalized,
          currentPosition,
          recommendedPosition: mostCommonPos,
          confidence: Math.round((maxCount / stats.totalGames) * 100),
          totalGames: stats.totalGames,
          starterGames: stats.starterGames,
          positionBreakdown: Object.entries(stats.positions)
            .filter(([_, s]) => s.count > 0)
            .reduce((acc, [pos, s]) => {
              acc[pos] = { total: s.count, starter: s.starterCount, bench: s.benchCount };
              return acc;
            }, {} as Record<string, { total: number; starter: number; bench: number }>)
        });
      }
    }
    
    // Sort by total games
    updates.sort((a, b) => b.totalGames - a.totalGames);
    
    // Update master.json if not dry run
    if (!dryRun) {
      const master = await loadMaster();
      let updatedCount = 0;
      let newCount = 0;
      
      for (const update of updates) {
        if (update.currentPosition !== update.recommendedPosition) {
          master.positions[update.normalized] = update.recommendedPosition;
          if (update.currentPosition) {
            updatedCount++;
          } else {
            newCount++;
          }
        }
      }
      
      await saveMaster(master);
      
      return NextResponse.json({
        success: true,
        dryRun: false,
        season: seasonLabel,
        teamsProcessed: results.length,
        totalGamesProcessed: results.reduce((sum, r) => sum + r.gamesProcessed, 0),
        playersAnalyzed: updates.length,
        playersUpdated: updatedCount,
        playersAdded: newCount,
        results,
        updates: updates.slice(0, 50) // Return first 50 for preview
      });
    } else {
      return NextResponse.json({
        success: true,
        dryRun: true,
        season: seasonLabel,
        teamsProcessed: results.length,
        totalGamesProcessed: results.reduce((sum, r) => sum + r.gamesProcessed, 0),
        playersAnalyzed: updates.length,
        wouldUpdate: updates.filter(u => u.currentPosition !== u.recommendedPosition).length,
        results,
        updates: updates.slice(0, 100) // Return first 100 for preview
      });
    }
    
  } catch (error: any) {
    console.error('[Bulk Update] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to bulk update positions', details: error.message },
      { status: 500 }
    );
  }
}

