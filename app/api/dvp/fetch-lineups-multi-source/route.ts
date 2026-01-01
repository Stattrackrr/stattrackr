/**
 * Fetch starting lineups from multiple sources
 * Tries: Basketball-Reference, Rotowire, TheScore, Yahoo, etc.
 * 
 * Usage: /api/dvp/fetch-lineups-multi-source?team=MIL&season=2025
 */

import { NextRequest, NextResponse } from 'next/server';

const BDL_BASE = 'https://api.balldontlie.io/v1';

function getBdlHeaders(): Record<string, string> {
  const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY;
  if (!apiKey) {
    throw new Error('BALLDONTLIE_API_KEY environment variable is required');
  }
  return {
    Accept: 'application/json',
    'User-Agent': 'StatTrackr/1.0',
    Authorization: `Bearer ${apiKey}`,
  };
}

const ABBR_TO_TEAM_ID_BDL: Record<string, number> = {
  ATL:1,BOS:2,BKN:3,CHA:4,CHI:5,CLE:6,DAL:7,DEN:8,DET:9,GSW:10,
  HOU:11,IND:12,LAC:13,LAL:14,MEM:15,MIA:16,MIL:17,MIN:18,NOP:19,NYK:20,
  OKC:21,ORL:22,PHI:23,PHX:24,POR:25,SAC:26,SAS:27,TOR:28,UTA:29,WAS:30,
};

// Basketball-Reference team abbreviations (some differ from standard)
const TEAM_TO_BR_ABBR: Record<string, string> = {
  'ATL': 'ATL', 'BOS': 'BOS', 'BKN': 'BRK', 'CHA': 'CHA', 'CHI': 'CHI',
  'CLE': 'CLE', 'DAL': 'DAL', 'DEN': 'DEN', 'DET': 'DET', 'GSW': 'GSW',
  'HOU': 'HOU', 'IND': 'IND', 'LAC': 'LAC', 'LAL': 'LAL', 'MEM': 'MEM',
  'MIA': 'MIA', 'MIL': 'MIL', 'MIN': 'MIN', 'NOP': 'NOP', 'NYK': 'NYK',
  'OKC': 'OKC', 'ORL': 'ORL', 'PHI': 'PHI', 'PHX': 'PHO', 'POR': 'POR',
  'SAC': 'SAC', 'SAS': 'SAS', 'TOR': 'TOR', 'UTA': 'UTA', 'WAS': 'WAS'
};

function normName(name: string): string {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
}

function formatSeason(year: number): string {
  return String(year);
}

// Try Basketball-Reference starting lineups page
async function fetchBasketballReferenceLineups(teamAbbr: string, season: number): Promise<Array<{ date: string; starters: Array<{ name: string; position: string }> }>> {
  try {
    const brAbbr = TEAM_TO_BR_ABBR[teamAbbr] || teamAbbr;
    const url = `https://www.basketball-reference.com/teams/${brAbbr}/${season}_start.html`;
    
    console.log(`[Multi-Source] Fetching Basketball-Reference: ${url}`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://www.basketball-reference.com/'
      },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      throw new Error(`Basketball-Reference ${response.status}`);
    }
    
    const html = await response.text();
    // Parse HTML to extract starting lineups
    // Basketball-Reference has a table with starting lineups per game
    const lineups: Array<{ date: string; starters: Array<{ name: string; position: string }> }> = [];
    
    // Look for table with starting lineups
    // This is a simplified parser - you may need to adjust based on actual HTML structure
    const tableMatch = html.match(/<table[^>]*id="start"[^>]*>([\s\S]*?)<\/table>/i);
    if (tableMatch) {
      const tableHtml = tableMatch[1];
      const rowMatches = tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
      
      for (const rowMatch of rowMatches) {
        const rowHtml = rowMatch[1];
        // Skip header rows
        if (rowHtml.includes('<th') || rowHtml.includes('thead')) continue;
        
        // Extract date
        const dateMatch = rowHtml.match(/<td[^>]*>(\d{4}-\d{2}-\d{2})/i);
        if (!dateMatch) continue;
        
        const date = dateMatch[1];
        const starters: Array<{ name: string; position: string }> = [];
        
        // Extract player names and positions (Basketball-Reference format)
        // This is a simplified version - actual parsing may need more work
        const playerMatches = rowHtml.matchAll(/<td[^>]*><a[^>]*>([^<]+)<\/a><\/td>/gi);
        let posIndex = 0;
        const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
        
        for (const playerMatch of playerMatches) {
          const name = playerMatch[1].trim();
          if (name && posIndex < 5) {
            starters.push({
              name,
              position: positions[posIndex]
            });
            posIndex++;
          }
        }
        
        if (starters.length === 5) {
          lineups.push({ date, starters });
        }
      }
    }
    
    console.log(`[Multi-Source] Basketball-Reference: Found ${lineups.length} games with starting lineups`);
    return lineups;
  } catch (e: any) {
    console.error(`[Multi-Source] Basketball-Reference error:`, e.message);
    return [];
  }
}

// Try Rotowire (they have starting lineups)
async function fetchRotowireLineups(teamAbbr: string, date: string): Promise<Array<{ name: string; position: string }>> {
  try {
    // Rotowire URL structure - may need adjustment
    const url = `https://www.rotowire.com/basketball/nba-lineups.php`;
    console.log(`[Multi-Source] Trying Rotowire for ${teamAbbr} on ${date}`);
    
    // Rotowire requires more complex parsing - would need to scrape their lineup page
    // For now, return empty - can be implemented later
    return [];
  } catch (e: any) {
    return [];
  }
}

// Try TheScore
async function fetchTheScoreLineups(teamAbbr: string, date: string): Promise<Array<{ name: string; position: string }>> {
  try {
    // TheScore API or scraping
    return [];
  } catch (e: any) {
    return [];
  }
}

async function bdlFetch(url: string) {
  const res = await fetch(url, { headers: getBdlHeaders(), cache: 'no-store' });
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
    
    console.log(`[Multi-Source] Fetching lineups for ${teamAbbr} (season ${season})...`);
    
    // Try Basketball-Reference first (most reliable for historical data)
    const brLineups = await fetchBasketballReferenceLineups(teamAbbr, season);
    
    if (brLineups.length === 0) {
      return NextResponse.json({
        team: teamAbbr,
        season,
        error: 'No starting lineups found from Basketball-Reference. Season may not have enough games yet.',
        players: []
      });
    }
    
    // Process lineups to get position counts per player
    const playerPositions = new Map<string, {
      name: string;
      positions: Record<string, { count: number }>;
      totalGames: number;
    }>();
    
    for (const lineup of brLineups) {
      for (const starter of lineup.starters) {
        const normalized = normName(starter.name);
        
        if (!playerPositions.has(normalized)) {
          playerPositions.set(normalized, {
            name: starter.name,
            positions: {},
            totalGames: 0
          });
        }
        
        const p = playerPositions.get(normalized)!;
        p.totalGames++;
        
        if (!p.positions[starter.position]) {
          p.positions[starter.position] = { count: 0 };
        }
        p.positions[starter.position].count++;
      }
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
        positionBreakdown: data.positions,
        confidence: maxCount / data.totalGames
      };
    });
    
    return NextResponse.json({
      team: teamAbbr,
      season,
      source: 'Basketball-Reference',
      gamesProcessed: brLineups.length,
      players: results.sort((a, b) => b.totalGames - a.totalGames)
    });
    
  } catch (error: any) {
    console.error('[Multi-Source] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch lineups' },
      { status: 500 }
    );
  }
}

