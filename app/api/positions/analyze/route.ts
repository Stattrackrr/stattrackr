import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const VALID_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
type Position = typeof VALID_POSITIONS[number];

function normName(name: string): string {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

interface PlayerPositionAnalysis {
  name: string;
  normalized: string;
  recommendedPosition: Position;
  totalGames: number;
  starterGames: number;
  totalPoints: number;
  positionBreakdown: Record<Position, { count: number; starterCount: number }>;
  confidence: number;
}

async function analyzeTeam(teamAbbr: string, season: string = '2025', minGames: number = 1): Promise<{
  team: string;
  players: PlayerPositionAnalysis[];
  totalGames: number;
  error?: string;
}> {
  const storeDir = path.resolve(process.cwd(), 'data', 'dvp_store', season);
  const filePath = path.join(storeDir, `${teamAbbr}.json`);
  
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const games = JSON.parse(content);
    
    if (!Array.isArray(games)) {
      return { team: teamAbbr, error: 'Invalid data format', players: [], totalGames: 0 };
    }
    
    // Track position counts per player
    const playerPositions = new Map<string, {
      name: string;
      normalized: string;
      positions: Record<Position, { count: number; starterCount: number }>;
      totalGames: number;
      starterGames: number;
      totalPoints: number;
    }>();
    
    for (const game of games) {
      if (!Array.isArray(game.players)) continue;
      
      for (const player of game.players) {
        const name = String(player.name || '').trim();
        if (!name) continue;
        
        const normalized = normName(name);
        const bucket = player.bucket as Position;
        
        // Only count valid positions
        if (!bucket || !VALID_POSITIONS.includes(bucket)) continue;
        
        if (!playerPositions.has(normalized)) {
          playerPositions.set(normalized, {
            name: name,
            normalized: normalized,
            positions: {} as Record<Position, { count: number; starterCount: number }>,
            totalGames: 0,
            starterGames: 0,
            totalPoints: 0
          });
        }
        
        const p = playerPositions.get(normalized)!;
        p.totalGames++;
        p.totalPoints += Number(player.pts || 0);
        if (player.isStarter) p.starterGames++;
        
        // Count occurrences of each position
        if (!p.positions[bucket]) {
          p.positions[bucket] = { count: 0, starterCount: 0 };
        }
        p.positions[bucket].count++;
        if (player.isStarter) {
          p.positions[bucket].starterCount++;
        }
      }
    }
    
    // Calculate most common position for each player
    const results: PlayerPositionAnalysis[] = [];
    for (const [normalized, data] of playerPositions.entries()) {
      if (data.totalGames < minGames) continue;
      
      // Find most common position (prioritize starter appearances)
      let mostCommonPos: Position | null = null;
      let maxCount = 0;
      let maxStarterCount = 0;
      
      for (const [pos, stats] of Object.entries(data.positions)) {
        const position = pos as Position;
        const starterCount = stats.starterCount;
        const count = stats.count;
        
        // Prioritize starter appearances, then total count
        if (starterCount > maxStarterCount || 
            (starterCount === maxStarterCount && count > maxCount)) {
          mostCommonPos = position;
          maxCount = count;
          maxStarterCount = starterCount;
        }
      }
      
      if (mostCommonPos) {
        results.push({
          name: data.name,
          normalized: normalized,
          recommendedPosition: mostCommonPos,
          totalGames: data.totalGames,
          starterGames: data.starterGames,
          totalPoints: data.totalPoints,
          positionBreakdown: data.positions,
          confidence: maxCount / data.totalGames
        });
      }
    }
    
    // Sort by total games (most active first)
    results.sort((a, b) => b.totalGames - a.totalGames);
    
    return {
      team: teamAbbr,
      players: results,
      totalGames: games.length
    };
    
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return { team: teamAbbr, error: 'No game data found', players: [], totalGames: 0 };
    }
    return { team: teamAbbr, error: e.message, players: [], totalGames: 0 };
  }
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const team = searchParams.get('team');
    const season = searchParams.get('season') || '2025';
    const minGames = parseInt(searchParams.get('minGames') || '1', 10);
    
    const isServerless = process.env.VERCEL === '1' || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME;
    if (isServerless) {
      return NextResponse.json(
        { error: 'Position analysis is not supported in serverless environment.' },
        { status: 503 }
      );
    }
    
    if (!team) {
      return NextResponse.json(
        { error: 'Team parameter is required' },
        { status: 400 }
      );
    }
    
    const result = await analyzeTeam(team.toUpperCase(), season, minGames);
    
    return NextResponse.json(result);
    
  } catch (error: any) {
    console.error('[Position Analyze] Error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze positions', details: error.message },
      { status: 500 }
    );
  }
}


