/**
 * Boxscores Position Analysis API
 * 
 * Fetches recent boxscores and analyzes player positions using:
 * - Starter positions from NBA API START_POSITION (exact PG/SG/SF/PF/C or generic G/F/C)
 * - Context-based filling for generic starter positions
 * - Bench player sorting: guards by assists (PG=most), forwards by rebounds (PF=most)
 * 
 * Query params:
 * - team: Team abbreviation (required, e.g., "MIL")
 * - season: Season year (default: "2025")
 * - days: Number of days to look back (default: 7, not used currently)
 * - limit: Max games to analyze (default: 10)
 * - summary: If "1", returns only summary without full game details
 * 
 * Example:
 *   GET /api/positions/boxscores?team=MIL&limit=5
 *   GET /api/positions/boxscores?team=MIL&limit=10&summary=1
 * 
 * Response includes:
 * - games: Array of games with starter/bench positions
 * - playerRecommendations: Aggregated position recommendations per player
 */

import { NextRequest, NextResponse } from 'next/server';

const VALID_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
type Position = typeof VALID_POSITIONS[number];

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
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function idx(headers: string[], ...names: string[]): number {
  for (const name of names) {
    const i = headers.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

async function nbaFetch(pathAndQuery: string) {
  const url = `https://stats.nba.com/stats/${pathAndQuery}`;
  const res = await fetch(url, { headers: NBA_HEADERS });
  if (!res.ok) {
    throw new Error(`NBA API ${res.status}`);
  }
  return res.json();
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
    
    // First pass: collect all team players
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
    
    // Second pass: determine final positions
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
    
    // Process bench players with sorting logic
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
    
    // Guards: most assists = PG, others = SG
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
    
    // Forwards: most rebounds = PF, others = SF
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
    
    // Centers
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

async function fetchTeamGameLog(teamId: number, seasonLabel: string): Promise<string[]> {
  try {
    const data = await nbaFetch(`teamgamelog?TeamID=${teamId}&Season=${encodeURIComponent(seasonLabel)}&SeasonType=${encodeURIComponent('Regular Season')}`);
    const rs = (data?.resultSets || []).find((r: any) => (r?.name || '').toLowerCase().includes('teamgamelog')) || data?.resultSets?.[0];
    const headers = rs?.headers || [];
    const rows = rs?.rowSet || [];
    const iGameId = idx(headers, 'GAME_ID', 'Game_ID');
    
    if (iGameId < 0) return [];
    
    return rows.map((r: any) => String(r[iGameId])).filter(Boolean);
  } catch (e: any) {
    console.error(`Error fetching game log for team ${teamId}:`, e.message);
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const team = searchParams.get('team');
    const season = searchParams.get('season') || '2025';
    const days = parseInt(searchParams.get('days') || '7', 10); // Last N days (not used currently)
    const limit = parseInt(searchParams.get('limit') || '10', 10); // Max games to fetch
    const summary = searchParams.get('summary') === '1'; // Return summary only
    
    if (!team) {
      return NextResponse.json(
        { error: 'Team parameter is required' },
        { status: 400 }
      );
    }
    
    const teamAbbr = team.toUpperCase();
    const teamId = ABBR_TO_TEAM_ID[teamAbbr];
    if (!teamId) {
      return NextResponse.json(
        { error: `Unknown team: ${team}` },
        { status: 400 }
      );
    }
    
    // Fetch game log
    const seasonLabel = formatSeason(season);
    const gameIds = await fetchTeamGameLog(teamId, seasonLabel);
    
    // Limit to most recent games
    const recentGameIds = gameIds.slice(0, limit);
    
    // Fetch boxscores for recent games
    const games: Array<{
      gameId: string;
      players: PlayerPosition[];
      error?: string;
    }> = [];
    
    for (const gameId of recentGameIds) {
      try {
        const positions = await fetchBoxscorePositions(gameId, teamId);
        games.push({ gameId, players: positions });
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e: any) {
        games.push({ gameId, players: [], error: e.message });
      }
    }
    
    // Aggregate position counts per player
    const playerStats = new Map<string, {
      name: string;
      normalized: string;
      positions: Record<Position, { count: number; starterCount: number; benchCount: number }>;
      totalGames: number;
      starterGames: number;
      benchGames: number;
    }>();
    
    for (const game of games) {
      for (const player of game.players) {
        if (!playerStats.has(player.normalized)) {
          playerStats.set(player.normalized, {
            name: player.name,
            normalized: player.normalized,
            positions: {} as any,
            totalGames: 0,
            starterGames: 0,
            benchGames: 0
          });
        }
        
        const stats = playerStats.get(player.normalized)!;
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
    }
    
    // Calculate recommended positions
    const playerRecommendations = Array.from(playerStats.values()).map(stats => {
      let mostCommonPos: Position | null = null;
      let maxCount = 0;
      let maxStarterCount = 0;
      let maxBenchCount = 0;
      let maxExactCount = 0;
      
      for (const [pos, posStats] of Object.entries(stats.positions)) {
        const position = pos as Position;
        const exactCount = posStats.starterCount; // Only exact if from starter_exact
        if (posStats.count > maxCount ||
            (posStats.count === maxCount && posStats.starterCount > maxStarterCount) ||
            (posStats.count === maxCount && posStats.starterCount === maxStarterCount && posStats.benchCount > maxBenchCount)) {
          mostCommonPos = position;
          maxCount = posStats.count;
          maxStarterCount = posStats.starterCount;
          maxBenchCount = posStats.benchCount;
        }
      }
      
      return {
        name: stats.name,
        normalized: stats.normalized,
        recommendedPosition: mostCommonPos,
        totalGames: stats.totalGames,
        starterGames: stats.starterGames,
        benchGames: stats.benchGames,
        positionBreakdown: stats.positions,
        confidence: mostCommonPos ? (maxCount / stats.totalGames) : 0
      };
    });
    
    playerRecommendations.sort((a, b) => b.totalGames - a.totalGames);
    
    const response: any = {
      team: teamAbbr,
      season: seasonLabel,
      gamesAnalyzed: games.length,
      playerRecommendations: playerRecommendations.map(p => ({
        name: p.name,
        recommendedPosition: p.recommendedPosition,
        totalGames: p.totalGames,
        starterGames: p.starterGames,
        benchGames: p.benchGames,
        confidence: Math.round(p.confidence * 100),
        positionBreakdown: Object.entries(p.positionBreakdown)
          .filter(([_, stats]) => stats.count > 0)
          .map(([pos, stats]) => ({
            position: pos,
            total: stats.count,
            starter: stats.starterCount,
            bench: stats.benchCount
          }))
      }))
    };
    
    // Include full game details unless summary mode
    if (!summary) {
      response.games = games.map(g => ({
        gameId: g.gameId,
        playerCount: g.players.length,
        starters: g.players.filter(p => p.isStarter).map(p => ({
          name: p.name,
          position: p.position,
          originalStartPos: p.originalStartPos,
          inferenceMethod: p.inferenceMethod,
          isExact: p.isExact,
          minutes: p.minutes
        })),
        bench: g.players.filter(p => !p.isStarter).map(p => ({
          name: p.name,
          position: p.position,
          inferenceMethod: p.inferenceMethod,
          minutes: p.minutes,
          stats: p.stats
        }))
      }));
    }
    
    return NextResponse.json(response);
    
  } catch (error: any) {
    console.error('[Boxscores] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch boxscores', details: error.message },
      { status: 500 }
    );
  }
}

