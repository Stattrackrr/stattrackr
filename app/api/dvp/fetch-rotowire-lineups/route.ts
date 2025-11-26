/**
 * Fetch starting lineups from Rotowire
 * Rotowire has daily NBA lineups with positions (PG/SG/SF/PF/C)
 * 
 * Usage: /api/dvp/fetch-rotowire-lineups?team=MIL&season=2025
 */

import { NextRequest, NextResponse } from 'next/server';

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

function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${yyyy}`;
}

async function bdlFetch(url: string) {
  const res = await fetch(url, { headers: BDL_HEADERS, cache: 'no-store' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`BDL ${res.status}: ${t || url}`);
  }
  return res.json();
}

async function fetchRotowireLineupForDate(date: string, teamAbbr: string): Promise<Array<{ name: string; position: string }>> {
  try {
    const url = `https://www.rotowire.com/basketball/nba-lineups.php`;
    console.log(`[Rotowire] Fetching lineups for ${date}...`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.rotowire.com/',
        'Cache-Control': 'no-cache'
      },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      throw new Error(`Rotowire HTTP ${response.status}`);
    }
    
    const html = await response.text();
    
    // Rotowire structure: Look for team section and starting lineup
    // The HTML structure may vary, so we'll try multiple patterns
    
    const starters: Array<{ name: string; position: string }> = [];
    const teamUpper = teamAbbr.toUpperCase();
    
    // Try to find team section in HTML
    // Rotowire typically has team names and lineups in a structured format
    // Look for patterns like: team name followed by player names with positions
    
    // Pattern 1: Look for team abbreviation near lineup data
    const teamIndex = html.toUpperCase().indexOf(teamUpper);
    if (teamIndex === -1) {
      console.log(`[Rotowire] Team ${teamAbbr} not found in HTML`);
      return [];
    }
    
    // Extract section around team (5000 chars before and after)
    const start = Math.max(0, teamIndex - 5000);
    const end = Math.min(html.length, teamIndex + 5000);
    const teamSection = html.substring(start, end);
    
    // Rotowire format: "PG Player Name", "SG Player Name", etc.
    // Examples: "PG C. Cunningham", "SG D. Robinson", "SF A. Thompson", "PF Tobias Harris", "C Jalen Duren"
    // Pattern: Position (PG/SG/SF/PF/C) followed by space, then player name
    // Player name can be: "C. Cunningham" (initial.last), "Tobias Harris" (first last), or "Last, First"
    
    const lineupPattern = /\b(PG|SG|SF|PF|C)\s+([A-Z][a-z]*(?:\.[A-Z])?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|[A-Z][a-z]+,\s+[A-Z][a-z]+)/g;
    
    const foundPositions = new Set<string>();
    let match;
    
    while ((match = lineupPattern.exec(teamSection)) !== null) {
      const position = match[1].toUpperCase();
      let playerName = match[2].trim();
      
      // Skip if we already have this position (avoid duplicates from multiple game sections)
      if (foundPositions.has(position)) continue;
      
      // Clean up player name
      // Handle "Last, First" format - convert to "First Last"
      if (playerName.includes(',')) {
        const parts = playerName.split(',').map(p => p.trim());
        if (parts.length === 2) {
          playerName = `${parts[1]} ${parts[0]}`;
        }
      }
      
      // Normalize spacing
      playerName = playerName.replace(/\s+/g, ' ').trim();
      
      // Handle initials like "C. Cunningham" - keep as is (it's a valid format)
      
      starters.push({
        name: playerName,
        position: position
      });
      
      foundPositions.add(position);
      
      // If we found all 5 positions, we're done
      if (starters.length === 5) break;
    }
    
    // If we found 5 starters, we're good
    if (starters.length === 5) {
      console.log(`[Rotowire] Found 5 starters for ${teamAbbr}:`, starters.map(s => `${s.name} (${s.position})`).join(', '));
      return starters;
    }
    
    // Fallback: Try to find table structure
    // Rotowire might have lineups in a table
    const tableMatch = teamSection.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
    if (tableMatch) {
      const tableHtml = tableSection[1];
      // Parse table rows for players and positions
      // This would need more specific parsing based on Rotowire's actual HTML structure
    }
    
    console.log(`[Rotowire] Found ${starters.length} starters for ${teamAbbr} (expected 5)`);
    return starters;
    
  } catch (e: any) {
    console.error(`[Rotowire] Error fetching lineup for ${date}:`, e.message);
    return [];
  }
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
    
    const bdlTeamId = ABBR_TO_TEAM_ID_BDL[teamAbbr];
    if (!bdlTeamId) {
      return NextResponse.json({ error: `Invalid team: ${teamAbbr}` }, { status: 400 });
    }
    
    console.log(`[Rotowire] Fetching lineups for ${teamAbbr} (season ${season})...`);
    
    // Get games from BDL
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
    
    console.log(`[Rotowire] Found ${games.length} games, fetching Rotowire lineups...`);
    
    // Track positions per player
    const playerPositions = new Map<string, {
      name: string;
      positions: Record<string, { count: number }>;
      totalGames: number;
    }>();
    
    // Process first 20 games
    const gamesToProcess = games.slice(0, 20);
    let processed = 0;
    
    for (const game of gamesToProcess) {
      const gameDate = game.date;
      
      try {
        const lineup = await fetchRotowireLineupForDate(gameDate, teamAbbr);
        
        if (lineup.length === 5) {
          for (const starter of lineup) {
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
          
          processed++;
        } else {
          console.log(`[Rotowire] Game ${gameDate}: Only found ${lineup.length} starters (expected 5)`);
        }
        
        // Delay to avoid rate limiting
        if (processed < gamesToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (e: any) {
        console.error(`[Rotowire] Error processing game ${gameDate}:`, e.message);
      }
    }
    
    if (playerPositions.size === 0) {
      return NextResponse.json({
        team: teamAbbr,
        season,
        gamesProcessed: processed,
        totalGames: games.length,
        error: `No starting lineups found. Processed ${processed} games but couldn't extract lineups from Rotowire. May need to adjust parsing logic.`,
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
        positionBreakdown: data.positions,
        confidence: maxCount / data.totalGames
      };
    });
    
    return NextResponse.json({
      team: teamAbbr,
      season,
      source: 'Rotowire',
      gamesProcessed: processed,
      totalGames: games.length,
      players: results.sort((a, b) => b.totalGames - a.totalGames)
    });
    
  } catch (error: any) {
    console.error('[Rotowire] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch Rotowire lineups' },
      { status: 500 }
    );
  }
}

