export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL } from '@/lib/cache';
import { NBA_TEAMS, normalizeAbbr } from '@/lib/nbaAbbr';

export const runtime = 'nodejs';

const BBALLREF_URL = 'https://www.basketball-reference.com/leagues/NBA_2025.html';

// Map our team abbreviations to Basketball Reference team names/abbreviations
const TEAM_NAME_MAP: Record<string, string> = {
  'ATL': 'Atlanta Hawks',
  'BOS': 'Boston Celtics',
  'BKN': 'Brooklyn Nets',
  'CHA': 'Charlotte Hornets',
  'CHI': 'Chicago Bulls',
  'CLE': 'Cleveland Cavaliers',
  'DAL': 'Dallas Mavericks',
  'DEN': 'Denver Nuggets',
  'DET': 'Detroit Pistons',
  'GSW': 'Golden State Warriors',
  'HOU': 'Houston Rockets',
  'IND': 'Indiana Pacers',
  'LAC': 'LA Clippers',
  'LAL': 'Los Angeles Lakers',
  'MEM': 'Memphis Grizzlies',
  'MIA': 'Miami Heat',
  'MIL': 'Milwaukee Bucks',
  'MIN': 'Minnesota Timberwolves',
  'NOP': 'New Orleans Pelicans',
  'NYK': 'New York Knicks',
  'OKC': 'Oklahoma City Thunder',
  'ORL': 'Orlando Magic',
  'PHI': 'Philadelphia 76ers',
  'PHX': 'Phoenix Suns',
  'POR': 'Portland Trail Blazers',
  'SAC': 'Sacramento Kings',
  'SAS': 'San Antonio Spurs',
  'TOR': 'Toronto Raptors',
  'UTA': 'Utah Jazz',
  'WAS': 'Washington Wizards',
};

/**
 * Scrape team defensive stats from Basketball Reference
 * Returns per-game averages for what opponents score against each team
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const teamParam = searchParams.get('team');
  const getAll = searchParams.get('all') === '1';

  try {
    const cacheKey = `bballref_defensive_stats${getAll ? '_all' : `_${teamParam}`}`;
    const hit = cache.get<any>(cacheKey);
    if (hit) {
      return NextResponse.json(hit);
    }

    // Fetch the HTML page
    const response = await fetch(BBALLREF_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Basketball Reference ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Parse the defensive stats table
    // Basketball Reference uses id="team-stats-per_game-opponent" for opponent stats
    // Or we can look for the table with opponent stats
    let tableMatch = html.match(/<table[^>]*id="[^"]*opponent[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
    
    // Fallback: look for any table with "opponent" in class or nearby text
    if (!tableMatch) {
      tableMatch = html.match(/<table[^>]*class="[^"]*"[^>]*>([\s\S]*?opponent[\s\S]*?)<\/table>/i);
    }
    
    // Another fallback: look for the stats table structure
    let tableHtml: string | null = null;
    if (tableMatch && tableMatch[1]) {
      tableHtml = tableMatch[1];
    } else {
      // Try to find table by looking for team rows with stats
      const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
      if (tbodyMatch && tbodyMatch[1]) {
        tableHtml = tbodyMatch[1];
      }
    }
    
    if (!tableHtml) {
      throw new Error('Could not find defensive stats table in Basketball Reference HTML');
    }
    
    // Extract team rows - Basketball Reference uses <tr> with data-stat attributes
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const teamRows: string[] = [];
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1];
      // Skip header rows (they have <th> tags or "data-stat="ranker"" or "Rk" text)
      if (rowHtml.includes('<th') || rowHtml.includes('data-stat="ranker"') || rowHtml.includes('>Rk</')) {
        continue;
      }
      // Check if this row has team data (has a team link)
      if (rowHtml.includes('data-stat="team"') && rowHtml.includes('/teams/')) {
        teamRows.push(rowHtml);
      }
    }
    
    const allTeamStats: Record<string, {
      pts: number;
      reb: number;
      ast: number;
      fg_pct: number;
      fg3_pct: number;
      stl: number;
      blk: number;
    }> = {};

    for (const rowHtml of teamRows) {
      
      // Extract team abbreviation from URL - Basketball Reference URLs are like /teams/TOR/2025.html
      let teamAbbr: string | null = null;
      const urlMatch = rowHtml.match(/href="[^"]*\/teams\/([A-Z]{3})\/[^"]*"/i);
      if (urlMatch) {
        const urlAbbr = urlMatch[1].toUpperCase();
        // Map Basketball Reference abbreviations to ours (most are the same)
        const bbrefToOurs: Record<string, string> = {
          'TOR': 'TOR', 'LAL': 'LAL', 'BOS': 'BOS', 'GSW': 'GSW',
          'MIA': 'MIA', 'MIL': 'MIL', 'PHI': 'PHI', 'DEN': 'DEN',
          'DAL': 'DAL', 'PHO': 'PHX', 'PHX': 'PHX', 'NOP': 'NOP',
          'NOH': 'NOP', 'NOR': 'NOP', 'UTA': 'UTA', 'UTH': 'UTA',
          'ATL': 'ATL', 'BKN': 'BKN', 'BRK': 'BKN', 'CHA': 'CHA',
          'CHO': 'CHA', 'CHI': 'CHI', 'CLE': 'CLE', 'DET': 'DET',
          'HOU': 'HOU', 'IND': 'IND', 'LAC': 'LAC', 'MEM': 'MEM',
          'MIN': 'MIN', 'NYK': 'NYK', 'OKC': 'OKC', 'ORL': 'ORL',
          'POR': 'POR', 'SAC': 'SAC', 'SAS': 'SAS', 'WAS': 'WAS',
        };
        
        teamAbbr = bbrefToOurs[urlAbbr] || urlAbbr;
      }
      
      // Fallback: try to extract from team name if URL didn't work
      if (!teamAbbr) {
        const teamLinkMatch = rowHtml.match(/<a[^>]*>([^<]+)<\/a>/);
        if (teamLinkMatch) {
          const teamName = teamLinkMatch[1].trim();
          
          // Try exact match first
          for (const [abbr, name] of Object.entries(TEAM_NAME_MAP)) {
            if (name === teamName) {
              teamAbbr = abbr;
              break;
            }
          }
          
          // Try partial match (e.g., "Raptors" matches "Toronto Raptors")
          if (!teamAbbr) {
            for (const [abbr, name] of Object.entries(TEAM_NAME_MAP)) {
              const lastName = name.split(' ').pop() || '';
              if (teamName.includes(lastName) || lastName.includes(teamName)) {
                teamAbbr = abbr;
                break;
              }
            }
          }
        }
      }
      
      if (!teamAbbr) {
        // Debug: log what we found for first few teams
        if (Object.keys(allTeamStats).length < 5) {
          console.log(`[bballref] Could not match team. Row sample: ${rowHtml.substring(0, 200)}`);
        }
        continue;
      }

      // Extract stats from the row using data-stat attributes
      // Basketball Reference uses <td data-stat="stat_name">value</td>
      const extractStat = (statName: string): string | null => {
        // Try multiple patterns to handle different HTML structures
        const patterns = [
          // Standard: <td data-stat="opp_pts_per_g">123.4</td>
          new RegExp(`<td[^>]*data-stat="${statName}"[^>]*>([^<]+)</td>`, 'i'),
          // With attributes after data-stat
          new RegExp(`data-stat="${statName}"[^>]*>([^<]+)<`, 'i'),
          // With single quotes
          new RegExp(`data-stat='${statName}'[^>]*>([^<]+)<`, 'i'),
          // More flexible pattern
          new RegExp(`data-stat=["']${statName}["'][^>]*>\\s*([\\d.]+)`, 'i'),
        ];
        
        for (const pattern of patterns) {
          const match = rowHtml.match(pattern);
          if (match && match[1]) {
            const value = match[1].trim();
            if (value && value !== '' && value !== '—') {
              return value;
            }
          }
        }
        return null;
      };

      // Try multiple possible attribute names for each stat
      // Points allowed - try different variations
      const ptsValue = extractStat('opp_pts_per_g') || extractStat('opp_pts') || extractStat('pts_per_g_opp');
      // Rebounds allowed
      const rebValue = extractStat('opp_trb_per_g') || extractStat('opp_trb') || extractStat('trb_per_g_opp');
      // Assists allowed
      const astValue = extractStat('opp_ast_per_g') || extractStat('opp_ast') || extractStat('ast_per_g_opp');
      // FG% allowed
      const fgPctValue = extractStat('opp_fg_pct') || extractStat('opp_fg%');
      // 3P% allowed
      const fg3PctValue = extractStat('opp_fg3_pct') || extractStat('opp_fg3%');
      // Steals - note: this might be "stl_per_g" not "opp_stl_per_g" (steals by the team, not against)
      const stlValue = extractStat('opp_stl_per_g') || extractStat('stl_per_g') || extractStat('opp_stl');
      // Blocks - same note
      const blkValue = extractStat('opp_blk_per_g') || extractStat('blk_per_g') || extractStat('opp_blk');

      const parseNumber = (str: string | null) => {
        if (!str) return 0;
        const cleaned = str.replace(/[^\d.-]/g, '');
        const num = Number.parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
      };

      allTeamStats[teamAbbr] = {
        pts: parseNumber(ptsValue),
        reb: parseNumber(rebValue),
        ast: parseNumber(astValue),
        fg_pct: parseNumber(fgPctValue) * 100, // Already a decimal, convert to percentage
        fg3_pct: parseNumber(fg3PctValue) * 100, // Already a decimal, convert to percentage
        stl: parseNumber(stlValue),
        blk: parseNumber(blkValue),
      };
      
      // Debug logging for first team to see what we're extracting
      if (Object.keys(allTeamStats).length === 1) {
        console.log(`[bballref] Parsed ${teamAbbr}:`, {
          pts: allTeamStats[teamAbbr].pts,
          reb: allTeamStats[teamAbbr].reb,
          ast: allTeamStats[teamAbbr].ast,
          raw: { ptsValue, rebValue, astValue, fgPctValue, fg3PctValue, stlValue, blkValue },
          sampleRow: rowHtml.substring(0, 500) // First 500 chars of row HTML for debugging
        });
      }
    }

    if (getAll) {
      // Calculate rankings (rank 30 = best/most, rank 1 = worst/least)
      const metrics = ['pts', 'reb', 'ast', 'fg_pct', 'fg3_pct', 'stl', 'blk'] as const;
      const rankings: Record<string, Record<string, number>> = {};

      for (const metric of metrics) {
        const teamsWithStats = Object.entries(allTeamStats)
          .sort(([_, a], [__, b]) => {
            // Sort descending (highest first) - rank 30 is best
            return (b[metric] || 0) - (a[metric] || 0);
          });

        teamsWithStats.forEach(([team], index) => {
          if (!rankings[team]) rankings[team] = {};
          // Rank 30 = best (index 0), Rank 1 = worst (index 29)
          rankings[team][metric] = 30 - index;
        });
      }

      const payload = {
        success: true,
        source: 'basketball-reference',
        teamStats: allTeamStats,
        rankings,
      };

      cache.set(cacheKey, payload, CACHE_TTL.ADVANCED_STATS * 2); // Cache for 2 hours
      return NextResponse.json(payload);
    }

    if (!teamParam) {
      return NextResponse.json({ error: 'Missing team parameter' }, { status: 400 });
    }

    const team = normalizeAbbr(teamParam);
    const teamStats = allTeamStats[team];

    if (!teamStats) {
      return NextResponse.json({
        success: false,
        error: `Team ${team} not found`,
        team,
      }, { status: 404 });
    }

    const payload = {
      success: true,
      source: 'basketball-reference',
      team,
      perGame: teamStats,
    };

    cache.set(cacheKey, payload, CACHE_TTL.ADVANCED_STATS);
    return NextResponse.json(payload);
  } catch (e: any) {
    console.error('[bballref-defensive-stats] Error:', e);
    return NextResponse.json({
      success: false,
      error: e?.message || 'Failed to fetch defensive stats from Basketball Reference',
    }, { status: 500 });
  }
}

