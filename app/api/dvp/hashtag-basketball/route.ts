/**
 * Fetch DVP data from Hashtag Basketball
 * 
 * Hashtag Basketball provides Defense vs Position statistics
 * URL: https://hashtagbasketball.com/nba-defense-vs-position
 */

import { NextRequest, NextResponse } from "next/server";
import { normalizeAbbr, NBA_TEAMS } from "@/lib/nbaAbbr";

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HASHTAG_BASE = 'https://hashtagbasketball.com';

// Team name mapping from Hashtag Basketball to our abbreviations
const TEAM_NAME_MAP: Record<string, string> = {
  'Atlanta Hawks': 'ATL',
  'Boston Celtics': 'BOS',
  'Brooklyn Nets': 'BKN',
  'Charlotte Hornets': 'CHA',
  'Chicago Bulls': 'CHI',
  'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL',
  'Denver Nuggets': 'DEN',
  'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GSW',
  'Houston Rockets': 'HOU',
  'Indiana Pacers': 'IND',
  'LA Clippers': 'LAC',
  'Los Angeles Lakers': 'LAL',
  'Memphis Grizzlies': 'MEM',
  'Miami Heat': 'MIA',
  'Milwaukee Bucks': 'MIL',
  'Minnesota Timberwolves': 'MIN',
  'New Orleans Pelicans': 'NOP',
  'New York Knicks': 'NYK',
  'Oklahoma City Thunder': 'OKC',
  'Orlando Magic': 'ORL',
  'Philadelphia 76ers': 'PHI',
  'Phoenix Suns': 'PHX',
  'Portland Trail Blazers': 'POR',
  'Sacramento Kings': 'SAC',
  'San Antonio Spurs': 'SAS',
  'Toronto Raptors': 'TOR',
  'Utah Jazz': 'UTA',
  'Washington Wizards': 'WAS'
};

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
const METRICS = ['pts', 'reb', 'ast', 'fg_pct', 'fg3_pct', 'stl', 'blk'] as const;

async function fetchHashtagDVP(metric: string = 'pts', timeframe: string = 'season') {
  try {
    // Hashtag Basketball DVP page
    // Note: The page might require JavaScript rendering, so we may need to use a headless browser
    // For now, we'll try to fetch the HTML and parse it
    const url = `${HASHTAG_BASE}/nba-defense-vs-position`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://hashtagbasketball.com/',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Hashtag Basketball ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    const results: Record<string, Record<string, number>> = {};
    
    // Method 1: Try to find a data table with team rows
    // Look for table rows that contain team names and position stats
    const teamNamePattern = Object.keys(TEAM_NAME_MAP).join('|');
    const rowPattern = new RegExp(`<tr[^>]*>([\\s\\S]*?${teamNamePattern}[\\s\\S]*?)</tr>`, 'gi');
    const rowMatches = Array.from(html.matchAll(rowPattern));
    
    for (const rowMatch of rowMatches) {
      const rowHtml = rowMatch[1];
      
      // Find which team this row is for
      let teamAbbr: string | null = null;
      for (const [teamName, abbr] of Object.entries(TEAM_NAME_MAP)) {
        if (rowHtml.includes(teamName)) {
          teamAbbr = abbr;
          break;
        }
      }
      
      if (!teamAbbr) continue;
      
      // Extract numeric values that might be position stats
      // Look for patterns like: <td>25.3</td> or similar
      const cellPattern = /<td[^>]*>([^<]+)<\/td>/gi;
      const cells: string[] = [];
      let cellMatch;
      while ((cellMatch = cellPattern.exec(rowHtml)) !== null) {
        cells.push(cellMatch[1].trim());
      }
      
      // Try to find position values (usually 5 numbers after team name)
      // Positions are typically in order: PG, SG, SF, PF, C
      const positionValues: Record<string, number> = {};
      let positionIndex = 0;
      
      for (const cell of cells) {
        // Skip team name and rank columns
        if (TEAM_NAME_MAP[cell] || cell.match(/^\d+$/)) continue;
        
        const numValue = parseFloat(cell.replace(/[^\d.-]/g, ''));
        if (!isNaN(numValue) && positionIndex < POSITIONS.length) {
          positionValues[POSITIONS[positionIndex]] = numValue;
          positionIndex++;
        }
      }
      
      if (Object.keys(positionValues).length >= 3) { // At least 3 positions found
        results[teamAbbr] = positionValues;
      }
    }
    
    // Method 2: If no results, try looking for JSON data in script tags
    if (Object.keys(results).length === 0) {
      const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
      const scriptMatches = Array.from(html.matchAll(scriptPattern));
      
      for (const scriptMatch of scriptMatches) {
        const scriptContent = scriptMatch[1];
        
        // Look for JSON objects that might contain DVP data
        const jsonPattern = /\{[\s\S]{100,10000}\}/g;
        const jsonMatches = Array.from(scriptContent.matchAll(jsonPattern));
        
        for (const jsonMatch of jsonMatches) {
          try {
            const data = JSON.parse(jsonMatch[0]);
            // Try to extract DVP data from the JSON structure
            // This will need to be adjusted based on actual structure
            if (typeof data === 'object' && data !== null) {
              // Process the data structure
              // Example: data might have team names as keys with position stats
              for (const [key, value] of Object.entries(data)) {
                if (typeof value === 'object' && value !== null) {
                  const teamAbbr = TEAM_NAME_MAP[key] || Object.keys(TEAM_NAME_MAP).find(t => key.includes(t));
                  if (teamAbbr && TEAM_NAME_MAP[teamAbbr]) {
                    // Try to extract position values
                    const positionValues: Record<string, number> = {};
                    for (const pos of POSITIONS) {
                      if (value[pos] !== undefined) {
                        positionValues[pos] = Number(value[pos]) || 0;
                      }
                    }
                    if (Object.keys(positionValues).length > 0) {
                      results[teamAbbr] = positionValues;
                    }
                  }
                }
              }
            }
          } catch (e) {
            // Not valid JSON, continue
          }
        }
      }
    }
    
    return results;
  } catch (error: any) {
    console.error('[Hashtag Basketball DVP] Error:', error.message);
    throw error;
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const metric = (searchParams.get('metric') || 'pts').toLowerCase();
    const timeframe = searchParams.get('timeframe') || 'season';
    
    if (!METRICS.includes(metric as any)) {
      return NextResponse.json(
        { success: false, error: `Invalid metric. Must be one of: ${METRICS.join(', ')}` },
        { status: 400 }
      );
    }
    
    const dvpData = await fetchHashtagDVP(metric, timeframe);
    
    return NextResponse.json({
      success: true,
      source: 'hashtag-basketball',
      metric,
      timeframe,
      data: dvpData,
      teams: Object.keys(dvpData).length
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch Hashtag Basketball DVP data' },
      { status: 500 }
    );
  }
}

