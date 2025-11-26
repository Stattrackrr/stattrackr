/**
 * Fetch actual starting positions from NBA Stats API boxscores
 * Uses the same approach as DvP ingest - gets START_POSITION from boxscoretraditionalv2
 * This is the most accurate source as it's the official NBA data
 * 
 * Usage: /api/dvp/fetch-nba-starting-positions?team=MIL&season=2025
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

const BDL_BASE = 'https://api.balldontlie.io/v1';
const BDL_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent': 'StatTrackr/1.0',
  Authorization: `Bearer ${process.env.BALLDONTLIE_API_KEY || '9823adcf-57dc-4036-906d-aeb9f0003cfd'}`,
};

const ABBR_TO_TEAM_ID_BDL: Record<string, number> = {
  ATL:1,BOS:2,BKN:3,CHA:4,CHI:5,CLE:6,DAL:7,DEN:8,DET:9,GSW:10,
  HOU:11,IND:12,LAC:13,LAL:14,MEM:15,MIA:16,MIL:17,MIN:18,NOP:19,NYK:20,
  OKC:21,ORL:22,PHI:23,PHX:24,POR:25,SAC:26,SAS:27,TOR:28,UTA:29,WAS:30,
};

function normName(name: string): string {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
}

function formatMDY(d: string | Date): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function idx(headers: string[], ...names: string[]): number {
  const lower = headers.map(h => String(h || '').toLowerCase());
  for (const name of names) {
    const i = lower.indexOf(name.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

async function nbaFetch(pathAndQuery: string, timeoutMs = 6000) {
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

async function bdlFetch(url: string) {
  const res = await fetch(url, { headers: BDL_HEADERS, cache: 'no-store' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`BDL ${res.status}: ${t || url}`);
  }
  return res.json();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const teamAbbr = searchParams.get('team')?.toUpperCase();
    const seasonParam = searchParams.get('season');
    const season = seasonParam ? parseInt(seasonParam, 10) : 2025;
    
    if (!teamAbbr) {
      return NextResponse.json({ error: 'Team abbreviation required' }, { status: 400 });
    }
    
    const teamId = ABBR_TO_TEAM_ID[teamAbbr];
    if (!teamId) {
      return NextResponse.json({ error: `Invalid team: ${teamAbbr}` }, { status: 400 });
    }
    
    console.log(`[NBA Starting Positions] Fetching for ${teamAbbr} (season ${season})...`);
    
    // Get games from BDL
    const bdlTeamId = ABBR_TO_TEAM_ID_BDL[teamAbbr];
    const gamesUrl = new URL(`${BDL_BASE}/games`);
    gamesUrl.searchParams.set('per_page', '100');
    gamesUrl.searchParams.append('seasons[]', String(season));
    gamesUrl.searchParams.append('team_ids[]', String(bdlTeamId));
    
    const gamesData = await bdlFetch(gamesUrl.toString());
    const games = Array.isArray(gamesData?.data) ? gamesData.data : [];
    
    if (games.length === 0) {
      return NextResponse.json({
        team: teamAbbr,
        season,
        error: 'No games found for this team/season',
        players: []
      });
    }
    
    console.log(`[NBA Starting Positions] Found ${games.length} games, fetching NBA boxscores...`);
    
    // Track positions per player
    const playerPositions = new Map<string, {
      name: string;
      positions: Record<string, { count: number }>;
      totalGames: number;
      starterGames: number;
    }>();
    
    // Process first 10 games (NBA API is slow, process fewer at once)
    const gamesToProcess = games.slice(0, 10);
    let processed = 0;
    let errors = 0;
    
    for (const game of gamesToProcess) {
      const gameDate = game.date;
      const homeTeam = String(game.home_team?.abbreviation || '').toUpperCase();
      const awayTeam = String(game.visitor_team?.abbreviation || '').toUpperCase();
      
      try {
        // Get NBA game ID from scoreboard
        const mdy = formatMDY(new Date(gameDate));
        const sb = await nbaFetch(`scoreboardv2?GameDate=${encodeURIComponent(mdy)}&DayOffset=0`);
        const sset = (sb?.resultSets || []).find((r: any) => (r?.name || '').toLowerCase().includes('games')) || sb?.resultSets?.[0];
        const sh = sset?.headers || [];
        const srows: any[] = sset?.rowSet || [];
        const iGid = idx(sh, 'GAME_ID');
        const iHome = idx(sh, 'HOME_TEAM_ID');
        const iAway = idx(sh, 'VISITOR_TEAM_ID');
        
        const wantHome = ABBR_TO_TEAM_ID[homeTeam] || 0;
        const wantAway = ABBR_TO_TEAM_ID[awayTeam] || 0;
        const gameRow = srows.find((r: any) => 
          (Number(r[iHome]) === wantHome && Number(r[iAway]) === wantAway) || 
          (Number(r[iHome]) === wantAway && Number(r[iAway]) === wantHome)
        );
        
        if (!gameRow || iGid < 0) {
          console.log(`[NBA Starting Positions] No NBA game ID found for ${gameDate}`);
          continue;
        }
        
        const nbaGameId = String(gameRow[iGid]);
        console.log(`[NBA Starting Positions] Processing game ${gameDate}, NBA Game ID: ${nbaGameId}`);
        
        // Get boxscore with START_POSITION
        const bs = await nbaFetch(`boxscoretraditionalv2?GameID=${nbaGameId}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`);
        const pset = (bs?.resultSets || []).find((r: any) => (r?.name || '').toLowerCase().includes('playerstats')) || bs?.resultSets?.[0];
        
        if (!pset) {
          console.log(`[NBA Starting Positions] No player stats in boxscore for game ${nbaGameId}`);
          continue;
        }
        
        const h = pset?.headers || [];
        const rsRows: any[] = pset?.rowSet || [];
        const iTeamAbbr = idx(h, 'TEAM_ABBREVIATION');
        const iPlayer = idx(h, 'PLAYER_NAME');
        const iStartPos = idx(h, 'START_POSITION');
        const iMin = idx(h, 'MIN');
        
        if (iTeamAbbr < 0 || iPlayer < 0 || iStartPos < 0) {
          console.log(`[NBA Starting Positions] Missing required columns in boxscore`);
          continue;
        }
        
        // Filter to target team and players who started
        const teamPlayers = rsRows.filter((r: any) => 
          String(r[iTeamAbbr] || '').toUpperCase() === teamAbbr && 
          String(r[iStartPos] || '').length > 0 &&
          String(r[iMin] || '').trim() !== '' // Has minutes (actually played)
        );
        
        console.log(`[NBA Starting Positions] Game ${gameDate}: Found ${teamPlayers.length} starters for ${teamAbbr}`);
        
        for (const player of teamPlayers) {
          const playerName = String(player[iPlayer] || '').trim();
          const startPos = String(player[iStartPos] || '').toUpperCase().trim();
          
          if (!playerName || !startPos) continue;
          
          // Map generic positions to specific ones
          let finalPosition = startPos;
          if (startPos === 'G') {
            // Need to infer PG vs SG - for now use context or default
            finalPosition = 'SG'; // Default, could be improved
          } else if (startPos === 'F') {
            finalPosition = 'SF'; // Default
          }
          
          if (!['PG', 'SG', 'SF', 'PF', 'C'].includes(finalPosition)) continue;
          
          const normalized = normName(playerName);
          
          if (!playerPositions.has(normalized)) {
            playerPositions.set(normalized, {
              name: playerName,
              positions: {},
              totalGames: 0,
              starterGames: 0
            });
          }
          
          const p = playerPositions.get(normalized)!;
          p.totalGames++;
          p.starterGames++;
          
          if (!p.positions[finalPosition]) {
            p.positions[finalPosition] = { count: 0 };
          }
          p.positions[finalPosition].count++;
        }
        
        processed++;
        
        // Delay to avoid rate limiting (NBA API is sensitive)
        if (processed < gamesToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (e: any) {
        errors++;
        // Silently continue on error (like DvP ingest does)
        // NBA API can be unreliable, so we continue processing other games
        if (process.env.NODE_ENV !== 'production') {
          console.error(`[NBA Starting Positions] Error processing game ${gameDate}:`, e.message);
        }
      }
    }
    
    console.log(`[NBA Starting Positions] Processed ${processed}/${gamesToProcess.length} games (${errors} errors)`);
    
    if (playerPositions.size === 0) {
      return NextResponse.json({
        team: teamAbbr,
        season,
        gamesProcessed: processed,
        totalGames: games.length,
        error: `No starting positions found. Processed ${processed} games but no starters with START_POSITION data.`,
        players: []
      });
    }
    
    // Calculate most common position
    const results = Array.from(playerPositions.entries()).map(([key, data]) => {
      let mostCommonPos = '';
      let maxCount = 0;
      
      for (const [pos, stats] of Object.entries(data.positions)) {
        if (stats.count > maxCount) {
          mostCommonPos = pos;
          maxCount = stats.count;
        }
      }
      
      return {
        name: data.name,
        recommendedPosition: mostCommonPos,
        totalGames: data.totalGames,
        starterGames: data.starterGames,
        benchGames: 0, // Only tracking starters
        positionBreakdown: data.positions,
        confidence: maxCount / data.totalGames
      };
    });
    
    return NextResponse.json({
      team: teamAbbr,
      season,
      source: 'NBA Stats API (boxscoretraditionalv2)',
      gamesProcessed: processed,
      totalGames: games.length,
      players: results.sort((a, b) => b.totalGames - a.totalGames)
    });
    
  } catch (error: any) {
    console.error('[NBA Starting Positions] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch starting positions' },
      { status: 500 }
    );
  }
}

