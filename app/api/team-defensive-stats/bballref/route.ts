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
    if (!tableMatch) {
      // Try to find table by looking for team rows with stats
      const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
      if (tbodyMatch) {
        tableMatch = [null, tbodyMatch[1]];
      }
    }
    
    if (!tableMatch) {
      throw new Error('Could not find defensive stats table in Basketball Reference HTML');
    }

    const tableHtml = tableMatch[1];
    
    // Extract team rows - Basketball Reference uses <tr> with data-stat attributes
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const teamRows: string[] = [];
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      // Check if this row has team data
      if (rowMatch[1].includes('data-stat="team"') || rowMatch[1].includes('team_name')) {
        teamRows.push(rowMatch[1]);
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
      
      // Extract team name/abbreviation
      const teamLinkMatch = rowHtml.match(/<a[^>]*>([^<]+)<\/a>/);
      if (!teamLinkMatch) continue;
      
      const teamName = teamLinkMatch[1].trim();
      
      // Find matching team abbreviation
      let teamAbbr: string | null = null;
      for (const [abbr, name] of Object.entries(TEAM_NAME_MAP)) {
        if (name === teamName || teamName.includes(name.split(' ').pop() || '')) {
          teamAbbr = abbr;
          break;
        }
      }
      
      if (!teamAbbr) continue;

      // Extract stats from the row
      // Points allowed (opp_pts_per_g)
      const ptsMatch = rowHtml.match(/data-stat="opp_pts_per_g"[^>]*>([^<]+)</);
      // Rebounds allowed (opp_trb_per_g)
      const rebMatch = rowHtml.match(/data-stat="opp_trb_per_g"[^>]*>([^<]+)</);
      // Assists allowed (opp_ast_per_g)
      const astMatch = rowHtml.match(/data-stat="opp_ast_per_g"[^>]*>([^<]+)</);
      // FG% allowed (opp_fg_pct)
      const fgPctMatch = rowHtml.match(/data-stat="opp_fg_pct"[^>]*>([^<]+)</);
      // 3P% allowed (opp_fg3_pct)
      const fg3PctMatch = rowHtml.match(/data-stat="opp_fg3_pct"[^>]*>([^<]+)</);
      // Steals (opp_stl_per_g)
      const stlMatch = rowHtml.match(/data-stat="opp_stl_per_g"[^>]*>([^<]+)</);
      // Blocks (opp_blk_per_g)
      const blkMatch = rowHtml.match(/data-stat="opp_blk_per_g"[^>]*>([^<]+)</);

      const parseNumber = (str: string | null) => {
        if (!str) return 0;
        const cleaned = str.replace(/[^\d.-]/g, '');
        const num = Number.parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
      };

      allTeamStats[teamAbbr] = {
        pts: parseNumber(ptsMatch?.[1]),
        reb: parseNumber(rebMatch?.[1]),
        ast: parseNumber(astMatch?.[1]),
        fg_pct: parseNumber(fgPctMatch?.[1]) * 100, // Convert to percentage
        fg3_pct: parseNumber(fg3PctMatch?.[1]) * 100, // Convert to percentage
        stl: parseNumber(stlMatch?.[1]),
        blk: parseNumber(blkMatch?.[1]),
      };
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

