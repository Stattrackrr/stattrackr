/**
 * Extract positions from stored DvP data files
 * This reads from data/dvp_store/{season}/{team}.json which already has position data
 * 
 * Usage: /api/dvp/extract-positions?team=MIL&season=2024
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const NBA_TEAMS = ['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW', 
                   'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK', 
                   'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'];

function normalizeAbbr(abbr: string): string {
  const upper = abbr.toUpperCase();
  if (NBA_TEAMS.includes(upper)) return upper;
  return abbr.toUpperCase();
}

function normName(name: string): string {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
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
    
    const team = normalizeAbbr(teamAbbr);
    if (!NBA_TEAMS.includes(team)) {
      return NextResponse.json({ error: `Invalid team: ${teamAbbr}` }, { status: 400 });
    }
    
    // Check if we're in serverless (can't read files)
    const isServerless = process.env.VERCEL === '1' || 
                         process.env.VERCEL_ENV !== undefined ||
                         process.env.VERCEL_URL !== undefined;
    
    if (isServerless) {
      return NextResponse.json({
        error: 'Cannot read files in serverless environment. Use DvP ingest endpoint instead.',
        team,
        season
      }, { status: 400 });
    }
    
    // Load stored DvP data
    const storeDir = path.resolve(process.cwd(), 'data', 'dvp_store', String(season));
    const storeFile = path.join(storeDir, `${team}.json`);
    
    if (!fs.existsSync(storeFile)) {
      return NextResponse.json({
        team,
        season,
        error: `No stored DvP data found for ${team} in season ${season}. Run DvP ingest first.`,
        players: []
      });
    }
    
    console.log(`[Extract Positions] Reading stored DvP data from ${storeFile}`);
    const raw = fs.readFileSync(storeFile, 'utf8');
    const games = JSON.parse(raw);
    
    if (!Array.isArray(games)) {
      return NextResponse.json({
        team,
        season,
        error: 'Invalid data format in stored file',
        players: []
      });
    }
    
    // Track positions per player
    const playerPositions = new Map<string, {
      name: string;
      positions: Record<string, { count: number; starterCount: number; benchCount: number }>;
      totalGames: number;
      starterGames: number;
    }>();
    
    // Process all games
    for (const game of games) {
      const players = Array.isArray(game?.players) ? game.players : [];
      
      for (const player of players) {
        const playerName = String(player?.name || '').trim();
        if (!playerName) continue;
        
        const normalized = normName(playerName);
        const position = String(player?.bucket || '').toUpperCase();
        const isStarter = Boolean(player?.isStarter);
        
        if (!['PG', 'SG', 'SF', 'PF', 'C'].includes(position)) continue;
        
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
        if (isStarter) {
          p.starterGames++;
        }
        
        if (!p.positions[position]) {
          p.positions[position] = { count: 0, starterCount: 0, benchCount: 0 };
        }
        p.positions[position].count++;
        if (isStarter) {
          p.positions[position].starterCount++;
        } else {
          p.positions[position].benchCount++;
        }
      }
    }
    
    // Calculate most common position for each player
    const results = Array.from(playerPositions.entries()).map(([key, data]) => {
      let mostCommonPos = '';
      let maxCount = 0;
      let maxStarterCount = 0;
      
      // Prioritize starter positions, then total count
      for (const [pos, stats] of Object.entries(data.positions)) {
        if (stats.starterCount > maxStarterCount ||
            (stats.starterCount === maxStarterCount && stats.count > maxCount)) {
          mostCommonPos = pos;
          maxCount = stats.count;
          maxStarterCount = stats.starterCount;
        }
      }
      
      return {
        name: data.name,
        recommendedPosition: mostCommonPos,
        totalGames: data.totalGames,
        starterGames: data.starterGames,
        benchGames: data.totalGames - data.starterGames,
        positionBreakdown: data.positions,
        confidence: maxCount / data.totalGames
      };
    });
    
    return NextResponse.json({
      team,
      season,
      totalGames: games.length,
      players: results.sort((a, b) => b.totalGames - a.totalGames)
    });
    
  } catch (error: any) {
    console.error('[Extract Positions] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to extract positions' },
      { status: 500 }
    );
  }
}

