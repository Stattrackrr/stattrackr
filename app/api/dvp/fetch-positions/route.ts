/**
 * API endpoint to fetch actual player positions from NBA Stats API
 * This runs server-side where NBA API calls work better
 * 
 * Usage: /api/dvp/fetch-positions?team=MIL&season=2025
 */

import { NextRequest, NextResponse } from 'next/server';

const NBA_BASE = "https://stats.nba.com/stats";
const NBA_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.nba.com",
  Referer: "https://www.nba.com/stats/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "sec-ch-ua": '"Chromium";v=124, "Google Chrome";v=124, "Not=A?Brand";v=99',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"'
};

const ABBR_TO_TEAM_ID: Record<string, number> = {
  ATL: 1610612737, BOS: 1610612738, BKN: 1610612751, CHA: 1610612766, CHI: 1610612741,
  CLE: 1610612739, DAL: 1610612742, DEN: 1610612743, DET: 1610612765, GSW: 1610612744,
  HOU: 1610612745, IND: 1610612754, LAC: 1610612746, LAL: 1610612747, MEM: 1610612763,
  MIA: 1610612748, MIL: 1610612749, MIN: 1610612750, NOP: 1610612740, NYK: 1610612752,
  OKC: 1610612760, ORL: 1610612753, PHI: 1610612755, PHX: 1610612756, POR: 1610612757,
  SAC: 1610612758, SAS: 1610612759, TOR: 1610612761, UTA: 1610612762, WAS: 1610612764
};

function formatSeason(year: number): string {
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}

function idx(headers: string[], ...names: string[]): number {
  const lower = headers.map(h => String(h || '').toLowerCase());
  for (const name of names) {
    const i = lower.indexOf(name.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

async function nbaFetch(pathAndQuery: string, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${NBA_BASE}/${pathAndQuery}`, {
      headers: NBA_HEADERS,
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`NBA API ${res.status}: ${errorText.substring(0, 200)}`);
    }
    return await res.json();
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw e;
  }
}

async function fetchTeamGameLog(teamId: number, seasonLabel: string): Promise<string[]> {
  try {
    console.log(`[Fetch Positions] Calling NBA API: teamgamelog?TeamID=${teamId}&Season=${seasonLabel}&SeasonType=Regular+Season`);
    const data = await nbaFetch(`teamgamelog?TeamID=${teamId}&Season=${encodeURIComponent(seasonLabel)}&SeasonType=Regular+Season`);
    
    console.log(`[Fetch Positions] NBA API response received, resultSets:`, data?.resultSets?.map((r: any) => r?.name) || 'none');
    
    const rs = (data?.resultSets || []).find((r: any) => (r?.name || '').toLowerCase().includes('teamgamelog')) || data?.resultSets?.[0];
    
    if (!rs) {
      console.log(`[Fetch Positions] No resultSet found in response`);
      return [];
    }
    
    const headers = rs?.headers || [];
    const rows = rs?.rowSet || [];
    console.log(`[Fetch Positions] ResultSet found: ${rs?.name}, headers: ${headers.length}, rows: ${rows.length}`);
    
    const iGameId = idx(headers, 'GAME_ID', 'Game_ID');
    
    if (iGameId < 0) {
      console.log(`[Fetch Positions] GAME_ID column not found in headers:`, headers);
      return [];
    }
    
    const gameIds = rows.map((r: any[]) => String(r[iGameId])).filter(Boolean);
    console.log(`[Fetch Positions] Extracted ${gameIds.length} game IDs`);
    return gameIds;
  } catch (e: any) {
    console.error(`[Fetch Positions] Error fetching game log for team ${teamId}:`, e.message);
    if (e.stack) {
      console.error(`[Fetch Positions] Stack:`, e.stack.split('\n').slice(0, 5).join('\n'));
    }
    return [];
  }
}

async function fetchBoxscorePositions(gameId: string, teamId: number) {
  try {
    const data = await nbaFetch(`boxscoretraditionalv2?GameID=${gameId}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`);
    const pset = (data?.resultSets || []).find((r: any) => (r?.name || '').toLowerCase().includes('playerstats')) || data?.resultSets?.[0];
    
    if (!pset) {
      return [];
    }
    
    const headers = pset?.headers || [];
    const rows = pset?.rowSet || [];
    
    const iTeamId = idx(headers, 'TEAM_ID');
    const iPlayer = idx(headers, 'PLAYER_NAME');
    const iStartPos = idx(headers, 'START_POSITION');
    const iMin = idx(headers, 'MIN');
    
    if (iTeamId < 0 || iPlayer < 0 || iStartPos < 0) {
      return [];
    }
    
    const positions: Array<{ name: string; position: string; isStarter: boolean; minutes: string }> = [];
    
    for (const row of rows) {
      const rowTeamId = Number(row[iTeamId]);
      if (rowTeamId !== teamId) continue;
      
      const playerName = String(row[iPlayer] || '').trim();
      const startPos = String(row[iStartPos] || '').toUpperCase().trim();
      const minutes = String(row[iMin] || '').trim();
      
      if (!playerName || !minutes || minutes === '') continue;
      
      const isStarter = startPos && startPos.length > 0;
      let finalPosition = startPos;
      
      // Handle generic positions
      if (startPos === 'G') {
        finalPosition = 'SG'; // Default, could be improved with context
      } else if (startPos === 'F') {
        finalPosition = 'SF'; // Default, could be improved with context
      }
      
      if (['PG', 'SG', 'SF', 'PF', 'C'].includes(finalPosition)) {
        positions.push({
          name: playerName,
          position: finalPosition,
          isStarter,
          minutes
        });
      }
    }
    
    return positions;
  } catch (e: any) {
    console.error(`Error fetching boxscore for game ${gameId}:`, e.message);
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const teamAbbr = searchParams.get('team')?.toUpperCase();
    const seasonParam = searchParams.get('season');
    const season = seasonParam ? parseInt(seasonParam, 10) : 2025; // Default to 2025-26 season
    
    if (!teamAbbr) {
      return NextResponse.json({ error: 'Team abbreviation required' }, { status: 400 });
    }
    
    const teamId = ABBR_TO_TEAM_ID[teamAbbr];
    if (!teamId) {
      return NextResponse.json({ error: `Invalid team: ${teamAbbr}` }, { status: 400 });
    }
    
    const seasonLabel = formatSeason(season);
    console.log(`[Fetch Positions] Fetching positions for ${teamAbbr} (${seasonLabel}), teamId: ${teamId}...`);
    
    // Fetch game log
    const gameIds = await fetchTeamGameLog(teamId, seasonLabel);
    console.log(`[Fetch Positions] Found ${gameIds.length} game IDs for ${teamAbbr}`);
    
    if (gameIds.length === 0) {
      // Try to get more info about why no games were found
      try {
        const testUrl = `teamgamelog?TeamID=${teamId}&Season=${encodeURIComponent(seasonLabel)}&SeasonType=Regular+Season`;
        console.log(`[Fetch Positions] Testing NBA API call: ${testUrl}`);
        const testData = await nbaFetch(testUrl);
        console.log(`[Fetch Positions] NBA API response:`, JSON.stringify(testData, null, 2).substring(0, 500));
      } catch (e: any) {
        console.error(`[Fetch Positions] NBA API test error:`, e.message);
      }
      
      return NextResponse.json({
        team: teamAbbr,
        season: seasonLabel,
        error: 'No games found - NBA API may not have data for this season yet, or API is unavailable',
        players: []
      });
    }
    
    console.log(`[Fetch Positions] Found ${gameIds.length} games, fetching boxscores...`);
    
    // Track positions per player
    const playerPositions = new Map<string, {
      name: string;
      positions: Record<string, number>;
      totalGames: number;
      starterGames: number;
    }>();
    
    // Process first 10 games (to avoid timeout)
    const gamesToProcess = gameIds.slice(0, 10);
    for (let i = 0; i < gamesToProcess.length; i++) {
      const gameId = gamesToProcess[i];
      try {
        const positions = await fetchBoxscorePositions(gameId, teamId);
        
        for (const pos of positions) {
          const key = pos.name.toLowerCase().trim();
          if (!playerPositions.has(key)) {
            playerPositions.set(key, {
              name: pos.name,
              positions: {},
              totalGames: 0,
              starterGames: 0
            });
          }
          
          const p = playerPositions.get(key)!;
          p.totalGames++;
          if (pos.isStarter) {
            p.starterGames++;
          }
          
          if (!p.positions[pos.position]) {
            p.positions[pos.position] = 0;
          }
          p.positions[pos.position]++;
        }
        
        // Small delay to avoid rate limiting
        if (i < gamesToProcess.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (e: any) {
        console.error(`Error processing game ${gameId}:`, e.message);
      }
    }
    
    // Calculate most common position for each player
    const results = Array.from(playerPositions.entries()).map(([key, data]) => {
      let mostCommonPos = '';
      let maxCount = 0;
      
      for (const [pos, count] of Object.entries(data.positions)) {
        if (count > maxCount) {
          mostCommonPos = pos;
          maxCount = count;
        }
      }
      
      return {
        name: data.name,
        recommendedPosition: mostCommonPos,
        totalGames: data.totalGames,
        starterGames: data.starterGames,
        positionBreakdown: data.positions,
        confidence: maxCount / data.totalGames
      };
    });
    
    return NextResponse.json({
      team: teamAbbr,
      season: seasonLabel,
      gamesProcessed: gamesToProcess.length,
      totalGames: gameIds.length,
      players: results.sort((a, b) => b.totalGames - a.totalGames)
    });
    
  } catch (error: any) {
    console.error('[Fetch Positions] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch positions' },
      { status: 500 }
    );
  }
}

