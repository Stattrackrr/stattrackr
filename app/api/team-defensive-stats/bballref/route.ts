export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL } from '@/lib/cache';
import { NBA_TEAMS, normalizeAbbr } from '@/lib/nbaAbbr';
import { currentNbaSeason } from '@/lib/nbaConstants';

export const runtime = 'nodejs';

// Basketball Reference URL - use current season
// Note: Season format is YYYY where YYYY is the year the season starts (e.g., 2024 for 2024-25 season)
const BBALLREF_URL = `https://www.basketball-reference.com/leagues/NBA_${currentNbaSeason()}.html`;

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
  const showRankings = searchParams.get('showRankings') === '1';

  try {
    // Always check the "all" cache first - it contains all teams
    const allCacheKey = 'bballref_defensive_stats_all';
    let allData = cache.get<any>(allCacheKey);
    
    // If we have cached "all" data, check if rankings are missing/empty and recalculate if needed
    if (allData && allData.success && allData.teamStats) {
      // Check if rankings are missing or empty
      const hasRankings = allData.rankings && Object.keys(allData.rankings).length > 0;
      if (!hasRankings && Object.keys(allData.teamStats).length > 0) {
        // Recalculate rankings if they're missing
        console.log('[bballref] Rankings missing from cache, recalculating...');
        const metrics = ['pts', 'reb', 'ast', 'fg_pct', 'fg3_pct', 'stl', 'blk'] as const;
        const rankings: Record<string, Record<string, number>> = {};
        const teamCount = Object.keys(allData.teamStats).length;
        console.log(`[bballref] Recalculating rankings for ${teamCount} teams`);

        for (const metric of metrics) {
          const teamsWithStats = Object.entries(allData.teamStats as Record<string, any>)
            .filter(([_, stats]) => stats && typeof (stats as any)[metric] === 'number') // Only include teams with valid stats
            .sort(([_, a], [__, b]) => {
              // Sort descending (highest first) - rank 30 is best
              return ((b as any)[metric] || 0) - ((a as any)[metric] || 0);
            });

          console.log(`[bballref] ${metric}: Found ${teamsWithStats.length} teams with stats`);
          
          teamsWithStats.forEach(([team], index) => {
            if (!rankings[team]) rankings[team] = {};
            // Rank 30 = best (index 0), Rank 1 = worst (index 29)
            rankings[team][metric] = 30 - index;
          });
          
          // Log first 5 and last 5 teams for verification
          if (teamsWithStats.length > 0) {
            const top5 = teamsWithStats.slice(0, 5).map(([team, stats]) => `${team}:${((stats as any)[metric] || 0).toFixed(1)}`);
            const bottom5 = teamsWithStats.slice(-5).map(([team, stats]) => `${team}:${((stats as any)[metric] || 0).toFixed(1)}`);
            console.log(`[bballref] ${metric} rankings - Top 5 (rank 30-26): ${top5.join(', ')}`);
            console.log(`[bballref] ${metric} rankings - Bottom 5 (rank 5-1): ${bottom5.join(', ')}`);
          }
        }
        
        // Verify all teams have rankings
        const teamsWithRankings = Object.keys(rankings);
        const teamsInStats = Object.keys(allData.teamStats);
        console.log(`[bballref] Rankings calculated: ${teamsWithRankings.length} teams have rankings, ${teamsInStats.length} teams in stats`);
        if (teamsWithRankings.length !== teamsInStats.length) {
          const missing = teamsInStats.filter(t => !rankings[t]);
          console.warn(`[bballref] ⚠️ Some teams missing rankings: ${missing.join(', ')}`);
        }
        
        // Update the cached data with rankings
        allData.rankings = rankings;
        cache.set(allCacheKey, allData, 24 * 60); // Re-cache with rankings
      }
      
      // If we have cached "all" data, use it
      if (getAll) {
        // If showRankings is requested, format the rankings
        if (showRankings && allData.rankings) {
          const metrics = ['pts', 'reb', 'ast', 'fg_pct', 'fg3_pct', 'stl', 'blk'] as const;
          const formattedRankings: Record<string, Array<{ team: string; rank: number; value: number }>> = {};
          
          for (const metric of metrics) {
            const teamsWithStats = Object.entries(allData.teamStats as Record<string, any>)
              .filter(([_, stats]) => stats && typeof (stats as any)[metric] === 'number')
              .sort(([_, a], [__, b]) => ((b as any)[metric] || 0) - ((a as any)[metric] || 0))
              .map(([team, stats], index) => ({
                team,
                rank: 30 - index,
                value: (stats as any)[metric] || 0,
              }));
            
            formattedRankings[metric] = teamsWithStats;
          }
          
          return NextResponse.json({
            ...allData,
            formattedRankings,
            summary: {
              totalTeams: Object.keys(allData.teamStats).length,
              teamsWithRankings: Object.keys(allData.rankings).length,
              metrics: metrics.map(m => ({
                metric: m,
                teamsRanked: formattedRankings[m]?.length || 0,
                rank1: formattedRankings[m]?.[formattedRankings[m].length - 1]?.team, // Worst (rank 1)
                rank30: formattedRankings[m]?.[0]?.team, // Best (rank 30)
              })),
            },
          });
        }
        
        return NextResponse.json(allData);
      }
      // For single team, extract from the cached all data
      if (teamParam) {
        const team = normalizeAbbr(teamParam);
        const teamStats = allData.teamStats[team];
        if (teamStats) {
          return NextResponse.json({
            success: true,
            source: 'basketball-reference',
            team,
            perGame: teamStats,
          });
        }
      }
    }
    
    // If no cache or team not found, we need to fetch and parse
    const cacheKey = getAll ? allCacheKey : `bballref_defensive_stats_${teamParam || 'single'}`;

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
    
    // Debug: Check if HTML was fetched successfully
    console.log(`[bballref] Fetched HTML, length: ${html.length}`);
    console.log(`[bballref] URL used: ${BBALLREF_URL}`);
    console.log(`[bballref] HTML contains "opponent": ${html.includes('opponent')}`);
    console.log(`[bballref] HTML contains "/teams/": ${html.includes('/teams/')}`);
    console.log(`[bballref] HTML contains "San Antonio": ${html.includes('San Antonio')}`);
    console.log(`[bballref] HTML contains "Spurs": ${html.includes('Spurs')}`);
    
    // Parse the defensive stats table
    // Basketball Reference uses id="team-stats-per_game-opponent" for opponent stats
    // Try multiple strategies to find the table
    
    let tableHtml: string | null = null;
    
    // Strategy 1: Look for table with id="team-stats-per_game-opponent" (exact match)
    let tableMatch = html.match(/<table[^>]*id="team-stats-per_game-opponent"[^>]*>([\s\S]*?)<\/table>/i);
    if (tableMatch && tableMatch[1]) {
      tableHtml = tableMatch[1];
      console.log('[bballref] Found table by id="team-stats-per_game-opponent"');
    }
    
    // Strategy 2: Look for table with id containing "opponent" AND "per_game" or "per-game"
    if (!tableHtml) {
      tableMatch = html.match(/<table[^>]*id="[^"]*opponent[^"]*per[^"]*game[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
      if (tableMatch && tableMatch[1]) {
        tableHtml = tableMatch[1];
        console.log('[bballref] Found table by id="*opponent*per*game*"');
      }
    }
    
    // Strategy 3: Look for table with id containing "opponent" (but verify it's defensive stats, not standings)
    if (!tableHtml) {
      tableMatch = html.match(/<table[^>]*id="[^"]*opponent[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
      if (tableMatch && tableMatch[1]) {
        const content = tableMatch[1];
        // Verify it's a defensive stats table, not a standings table
        // Standings tables have "wins", "losses", "team_name" - defensive stats have "opp_pts", "opp_fg", etc.
        if (content.includes('opp_pts') || content.includes('opp_fg') || content.includes('data-stat="opp_')) {
          tableHtml = content;
          console.log('[bballref] Found table by id="*opponent*" (verified as defensive stats)');
        } else {
          console.log('[bballref] Found table with "opponent" id but it appears to be standings, skipping');
        }
      }
    }
    
    // Strategy 4: Look for "Opponent Per Game" heading and find the table immediately after it
    if (!tableHtml) {
      // Find the h2 or div with "Opponent Per Game" and get the next table
      const opponentHeading = html.match(/(?:<h2[^>]*>|<div[^>]*>)[^<]*Opponent Per Game[^<]*(?:<\/h2>|<\/div>)[\s\S]{0,2000}(<table[^>]*>[\s\S]*?<\/table>)/i);
      if (opponentHeading && opponentHeading[1]) {
        const tableContent = opponentHeading[1].match(/<table[^>]*>([\s\S]*?)<\/table>/i);
        if (tableContent && tableContent[1]) {
          const content = tableContent[1];
          // Verify it's defensive stats
          if (content.includes('opp_pts') || content.includes('opp_fg') || content.includes('data-stat="opp_')) {
            tableHtml = content;
            console.log('[bballref] Found table after "Opponent Per Game" heading (verified as defensive stats)');
          }
        }
      }
    }
    
    // Strategy 5: Look for table with "opponent" in class or nearby, but verify it's defensive stats
    if (!tableHtml) {
      tableMatch = html.match(/<table[^>]*class="[^"]*"[^>]*>([\s\S]*?opponent[\s\S]*?)<\/table>/i);
      if (tableMatch && tableMatch[1]) {
        const content = tableMatch[1];
        // Verify it's defensive stats
        if (content.includes('opp_pts') || content.includes('opp_fg') || content.includes('data-stat="opp_')) {
          tableHtml = content;
          console.log('[bballref] Found table by class with "opponent" (verified as defensive stats)');
        }
      }
    }
    
    // Strategy 4: Find all tables and look for one with team links and defensive stats
    if (!tableHtml) {
      const allTables = html.match(/<table[^>]*>([\s\S]{0,100000})<\/table>/gi);
      if (allTables) {
        for (const table of allTables) {
          const tableContent = table.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
          if (tableContent && tableContent[1]) {
            const content = tableContent[1];
            // Check if this table has team links and defensive stat data
            // Must have defensive stats (opp_pts, opp_fg, etc.) and NOT be standings (wins, losses)
            const hasDefensiveStats = content.includes('opp_pts') || content.includes('opp_fg') || content.includes('data-stat="opp_');
            const isStandings = content.includes('data-stat="wins"') || content.includes('data-stat="losses"') || content.includes('data-stat="team_name"');
            if (content.includes('/teams/') && hasDefensiveStats && !isStandings) {
              tableHtml = content;
              console.log('[bballref] Found table with team links and defensive stat attributes');
              break;
            }
          }
        }
      }
    }
    
    // Strategy 5: Extract tbody with team links
    if (!tableHtml) {
      const tbodyMatches = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi);
      if (tbodyMatches) {
        for (const tbodyMatch of tbodyMatches) {
          const tbodyContent = tbodyMatch.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
          if (tbodyContent && tbodyContent[1]) {
            const content = tbodyContent[1];
            if (content.includes('/teams/') && (content.includes('data-stat') || content.includes('opp_') || content.match(/<tr[^>]*>[\s\S]{100,}[\d.]+[\s\S]{100,}<\/tr>/i))) {
              tableHtml = content;
              console.log('[bballref] Found tbody with team links and stats');
              break;
            }
          }
        }
      }
    }
    
    if (!tableHtml) {
      // Log a sample of the HTML to help debug
      const htmlSample = html.substring(0, 10000);
      console.error('[bballref] Could not find defensive stats table. HTML length:', html.length);
      console.error('[bballref] HTML sample (first 10000 chars):', htmlSample);
      console.error('[bballref] Searching for "opponent" in HTML:', html.includes('opponent'));
      console.error('[bballref] Searching for "/teams/" in HTML:', html.includes('/teams/'));
      throw new Error('Could not find defensive stats table in Basketball Reference HTML');
    }
    
    console.log(`[bballref] Found table HTML, length: ${tableHtml.length}`);
    
    // Extract team rows - Basketball Reference uses <tr> with data-stat attributes
    // First, try to extract from tbody if it exists within tableHtml
    let rowsToParse = tableHtml;
    const tbodyMatch = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    if (tbodyMatch && tbodyMatch[1]) {
      rowsToParse = tbodyMatch[1];
      console.log('[bballref] Using tbody content for row parsing');
    }
    
    // Try multiple regex patterns to find rows
    const rowPatterns = [
      /<tr[^>]*>([\s\S]*?)<\/tr>/gi,  // Standard <tr>...</tr>
      /<tr[^>]*data-stat[^>]*>([\s\S]*?)<\/tr>/gi,  // Rows with data-stat
    ];
    
    const teamRows: string[] = [];
    let totalRows = 0;
    
    for (const rowRegex of rowPatterns) {
      rowRegex.lastIndex = 0; // Reset regex
      let rowMatch;
      while ((rowMatch = rowRegex.exec(rowsToParse)) !== null) {
        totalRows++;
        const rowHtml = rowMatch[1];
        
        // Check if this row has team data FIRST - be very flexible
        // Look for team indicators: /teams/ link, team name, or data-stat="team"
        const hasTeamLink = rowHtml.includes('/teams/');
        const hasTeamDataStat = rowHtml.includes('data-stat="team"') || rowHtml.includes("data-stat='team'");
        const hasTeamName = /(Spurs|Lakers|Celtics|Warriors|Heat|Bucks|Nuggets|Mavericks|Suns|76ers|Knicks|Nets|Hawks|Bulls|Cavaliers|Pistons|Rockets|Pacers|Clippers|Grizzlies|Timberwolves|Pelicans|Thunder|Magic|Trail Blazers|Kings|Raptors|Jazz|Wizards|Hornets)/i.test(rowHtml);
        
        // Skip header rows - but be careful: data rows can have <th> tags for ranker column
        // Only skip if it's clearly a header (has <th> but NO team data, or has "Rk"/"Rank" text without team)
        const isHeaderRow = (
          (rowHtml.includes('<th') && !hasTeamLink && !hasTeamDataStat && !hasTeamName) ||  // <th> without team data
          (rowHtml.includes('>Rk</') && !hasTeamLink) ||  // "Rk" text without team link
          (rowHtml.includes('>Rank</') && !hasTeamLink) ||  // "Rank" text without team link
          (rowHtml.trim() === '') ||  // Empty row
          (rowHtml.length < 50 && !hasTeamLink && !hasTeamDataStat)  // Very short row without team data
        );
        
        if (isHeaderRow) {
          continue;
        }
        
        // Accept if it has any team indicator (data rows with <th> for ranker are OK)
        if (hasTeamLink || hasTeamDataStat || hasTeamName) {
          // Avoid duplicates
          if (!teamRows.some(existing => existing.substring(0, 100) === rowHtml.substring(0, 100))) {
            teamRows.push(rowHtml);
          }
        }
      }
      
      // If we found rows with this pattern, break
      if (teamRows.length > 0) {
        break;
      }
    }
    
    // If still no rows found, try parsing the entire tableHtml again (maybe rows are at top level)
    if (teamRows.length === 0 && rowsToParse !== tableHtml) {
      console.log('[bballref] No rows found in tbody, trying full tableHtml');
      const fullRowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let fullRowMatch;
      while ((fullRowMatch = fullRowRegex.exec(tableHtml)) !== null) {
        const rowHtml = fullRowMatch[1];
        if (rowHtml.includes('<th') || 
            rowHtml.includes('data-stat="ranker"') || 
            rowHtml.includes('>Rk</') || 
            rowHtml.includes('>Rank</') || 
            rowHtml.trim() === '' ||
            rowHtml.length < 50) {
          continue;
        }
        const hasTeamLink = rowHtml.includes('/teams/');
        const hasTeamDataStat = rowHtml.includes('data-stat="team"') || rowHtml.includes("data-stat='team'");
        const hasTeamName = /(Spurs|Lakers|Celtics|Warriors|Heat|Bucks|Nuggets|Mavericks|Suns|76ers|Knicks|Nets|Hawks|Bulls|Cavaliers|Pistons|Rockets|Pacers|Clippers|Grizzlies|Timberwolves|Pelicans|Thunder|Magic|Trail Blazers|Kings|Raptors|Jazz|Wizards|Hornets)/i.test(rowHtml);
        if (hasTeamLink || hasTeamDataStat || hasTeamName) {
          if (!teamRows.some(existing => existing.substring(0, 100) === rowHtml.substring(0, 100))) {
            teamRows.push(rowHtml);
          }
        }
      }
    }
    
    // Last resort: if still no rows, try to find any row with numbers (stats) and team-like content
    if (teamRows.length === 0) {
      console.log('[bballref] Last resort: looking for any rows with stats and team indicators');
      const anyRowRegex = /<tr[^>]*>([\s\S]{200,2000})<\/tr>/gi;
      let anyRowMatch;
      while ((anyRowMatch = anyRowRegex.exec(tableHtml)) !== null) {
        const rowHtml = anyRowMatch[1];
        // Look for rows that have numbers (stats) and some team-like content
        if (/\d+\.\d+/.test(rowHtml) && (rowHtml.includes('/teams/') || /[A-Z]{2,3}/.test(rowHtml))) {
          teamRows.push(rowHtml);
          if (teamRows.length >= 5) break; // Get a few samples
        }
      }
    }
    
    console.log(`[bballref] Found ${teamRows.length} team rows out of ${totalRows} total rows`);
    console.log(`[bballref] First few team rows (first 200 chars each):`, teamRows.slice(0, 3).map(r => r.substring(0, 200)));
    
    // If we found very few teams (< 10), we might be parsing the wrong table
    // Store original rows and tableHtml in case we need to revert
    const originalTeamRows = [...teamRows];
    const originalTableHtml = tableHtml;
    
    if (teamRows.length > 0 && teamRows.length < 10) {
      console.warn(`[bballref] ⚠️ Only found ${teamRows.length} teams - might be parsing wrong table. Expected ~30 teams.`);
      console.warn(`[bballref] Table HTML length: ${tableHtml.length}, First 500 chars:`, tableHtml.substring(0, 500));
      console.warn(`[bballref] Searching for larger table with more teams...`);
      
      // Try to find a table with more rows - prioritize "Per Game" table
      const allTables = html.match(/<table[^>]*>([\s\S]{0,200000})<\/table>/gi);
      if (allTables) {
        let bestTable: { content: string; linkCount: number; isPerGame: boolean } | null = null;
        
        for (const table of allTables) {
          const tableContent = table.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
          if (tableContent && tableContent[1]) {
            const content = tableContent[1];
            // Count how many team links are in this table
            const teamLinkCount = (content.match(/\/teams\/[A-Z]{3}\//gi) || []).length;
            // Check if this is a "Per Game" defensive stats table (preferred)
            // Must have "Per Game" AND defensive stats indicators (opp_pts, opp_fg, etc.)
            // NOT standings (wins, losses, team_name)
            const caption = table.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i)?.[1] || '';
            const hasPerGame = content.includes('Per Game') || content.includes('per_game') || caption.includes('Per Game');
            const hasDefensiveStats = content.includes('opp_pts') || content.includes('opp_fg') || content.includes('data-stat="opp_') || 
                                     content.includes('opp_trb') || content.includes('opp_ast');
            const isStandings = content.includes('data-stat="wins"') || content.includes('data-stat="losses"') || 
                               content.includes('data-stat="team_name"') || caption.includes('Standings');
            const isPerGame = hasPerGame && hasDefensiveStats && !isStandings;
            
            console.log(`[bballref] Table has ${teamLinkCount} team links, isPerGame: ${isPerGame}, hasDefensiveStats: ${hasDefensiveStats}, isStandings: ${isStandings}`);
            
            // Prefer tables with team links, STRONGLY prioritizing "Per Game" defensive stats tables
            // Exclude standings tables - they have team links but aren't defensive stats
            if (teamLinkCount >= 15) {
              // Skip standings tables completely
              if (isStandings) {
                console.log(`[bballref] Skipping standings table with ${teamLinkCount} links`);
                continue;
              }
              
              // Only consider tables with defensive stats
              if (!hasDefensiveStats) {
                console.log(`[bballref] Skipping table with ${teamLinkCount} links (no defensive stats)`);
                continue;
              }
              
              if (!bestTable) {
                bestTable = { content, linkCount: teamLinkCount, isPerGame };
              } else if (isPerGame && !bestTable.isPerGame) {
                // Always prefer Per Game over Total Stats
                bestTable = { content, linkCount: teamLinkCount, isPerGame };
                console.log(`[bballref] Preferring Per Game table (${teamLinkCount} links) over Total Stats table`);
              } else if (isPerGame === bestTable.isPerGame) {
                // If both are same type, prefer the one with more links
                if (teamLinkCount > bestTable.linkCount) {
                  bestTable = { content, linkCount: teamLinkCount, isPerGame };
                }
              }
              // If bestTable is Per Game and this is not, don't replace it
            }
          }
        }
        
        // After finding the best table, switch to it and re-parse
        // Always switch to Per Game table if we found one, even if current has more teams
        // Only switch to Total Stats if it has significantly more links AND we have very few teams
        const shouldSwitch = bestTable && (
          (bestTable.isPerGame && teamRows.length < 25) || // Always switch to Per Game if we have < 25 teams
          (!bestTable.isPerGame && bestTable.linkCount > teamRows.length * 3 && teamRows.length < 10) // Only switch to Total Stats if we have very few teams
        );
        
        if (shouldSwitch) {
          console.log(`[bballref] Found better table with ${bestTable.linkCount} team links (Per Game: ${bestTable.isPerGame}), switching to it`);
          const newTableHtml = bestTable.content;
          
          // Re-parse rows from this table - use the SAME simple logic that worked initially
          const newTbodyMatch = newTableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
          const newRowsToParse = newTbodyMatch && newTbodyMatch[1] ? newTbodyMatch[1] : newTableHtml;
          
          const newTeamRows: string[] = [];
          let newTotalRows = 0;
          
          // Use the SAME simple logic that worked for the initial parsing (lines 240-277)
          const newRowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          let newRowMatch;
          while ((newRowMatch = newRowPattern.exec(newRowsToParse)) !== null) {
            newTotalRows++;
            const rowHtml = newRowMatch[1];
            
            // Check if this row has team data FIRST (same logic as initial parsing)
            const hasTeamLink = rowHtml.includes('/teams/');
            const hasTeamDataStat = rowHtml.includes('data-stat="team"') || rowHtml.includes("data-stat='team'");
            const hasTeamName = /(Spurs|Lakers|Celtics|Warriors|Heat|Bucks|Nuggets|Mavericks|Suns|76ers|Knicks|Nets|Hawks|Bulls|Cavaliers|Pistons|Rockets|Pacers|Clippers|Grizzlies|Timberwolves|Pelicans|Thunder|Magic|Trail Blazers|Kings|Raptors|Jazz|Wizards|Hornets)/i.test(rowHtml);
            
            // Skip header rows - but be careful: data rows can have <th> tags for ranker column
            // Only skip if it's clearly a header (has <th> but NO team data, or has "Rk"/"Rank" text without team)
            const isHeaderRow = (
              (rowHtml.includes('<th') && !hasTeamLink && !hasTeamDataStat && !hasTeamName) ||  // <th> without team data
              (rowHtml.includes('>Rk</') && !hasTeamLink) ||  // "Rk" text without team link
              (rowHtml.includes('>Rank</') && !hasTeamLink) ||  // "Rank" text without team link
              (rowHtml.trim() === '') ||  // Empty row
              (rowHtml.length < 50 && !hasTeamLink && !hasTeamDataStat)  // Very short row without team data
            );
            
            if (isHeaderRow) {
              continue;
            }
            
            // Accept if it has any team indicator (data rows with <th> for ranker are OK)
            if (hasTeamLink || hasTeamDataStat || hasTeamName) {
              // Avoid duplicates
              if (!newTeamRows.some(existing => existing.substring(0, 100) === rowHtml.substring(0, 100))) {
                newTeamRows.push(rowHtml);
              }
            }
          }
          
          // Only switch if we found rows
          if (newTeamRows.length > 0) {
            console.log(`[bballref] Successfully parsed ${newTeamRows.length} rows from new table`);
            tableHtml = newTableHtml;
            teamRows.length = 0;
            teamRows.push(...newTeamRows);
            totalRows = newTotalRows;
          } else {
            console.warn(`[bballref] ⚠️ Failed to parse rows from new table. Keeping original table with ${originalTeamRows.length} teams.`);
            // Keep original table and rows - don't switch
          }
          
          console.log(`[bballref] After switching attempt, found ${teamRows.length} team rows out of ${totalRows} total rows`);
          
          // If still no rows, try a more aggressive approach - look for ANY row with team links
          if (teamRows.length === 0) {
            console.log('[bballref] No rows found with standard patterns, trying aggressive parsing...');
            console.log(`[bballref] newRowsToParse length: ${newRowsToParse.length}, contains /teams/: ${newRowsToParse.includes('/teams/')}`);
            
            // Try multiple patterns to find team rows
            const aggressivePatterns = [
              /<tr[^>]*>([\s\S]*?\/teams\/[A-Z]{3}\/[\s\S]*?)<\/tr>/gi,  // Standard pattern
              /<tr[^>]*>([\s\S]*?href=['"]\/teams\/[A-Z]{3}\/[\s\S]*?)<\/tr>/gi,  // With href attribute
              /<tr[^>]*>([\s\S]*?href=['']\/teams\/[A-Z]{3}\/[\s\S]*?)<\/tr>/gi,  // With single quotes
            ];
            
            for (const aggressivePattern of aggressivePatterns) {
              aggressivePattern.lastIndex = 0; // Reset regex
              let aggressiveMatch;
              while ((aggressiveMatch = aggressivePattern.exec(newRowsToParse)) !== null && teamRows.length < 30) {
                const rowHtml = aggressiveMatch[1];
                // Skip if it's clearly a header (has <th> or ranker without team)
                if (rowHtml.includes('<th') || (rowHtml.includes('data-stat="ranker"') && !rowHtml.includes('data-stat="team"'))) {
                  continue;
                }
                // Accept any row with a team link
                if (rowHtml.includes('/teams/')) {
                  // Avoid duplicates
                  if (!teamRows.some(existing => existing.substring(0, 100) === rowHtml.substring(0, 100))) {
                    teamRows.push(rowHtml);
                  }
                }
              }
              if (teamRows.length > 0) {
                console.log(`[bballref] Found ${teamRows.length} rows with pattern ${aggressivePatterns.indexOf(aggressivePattern) + 1}`);
                break;
              }
            }
            
            // Last resort: find any occurrence of /teams/ and extract surrounding context
            if (teamRows.length === 0) {
              console.log('[bballref] Trying last resort: extracting rows around team links...');
              const teamLinkMatches = newRowsToParse.matchAll(/\/teams\/([A-Z]{3})\//gi);
              for (const match of teamLinkMatches) {
                const matchIndex = match.index || 0;
                // Find the <tr> tag before this match
                const beforeMatch = newRowsToParse.substring(Math.max(0, matchIndex - 500), matchIndex);
                const trStart = beforeMatch.lastIndexOf('<tr');
                if (trStart !== -1) {
                  const startIndex = Math.max(0, matchIndex - 500) + trStart;
                  // Find the </tr> tag after this match
                  const afterMatch = newRowsToParse.substring(matchIndex, matchIndex + 2000);
                  const trEnd = afterMatch.indexOf('</tr>');
                  if (trEnd !== -1) {
                    const endIndex = matchIndex + trEnd + 5;
                    const rowHtml = newRowsToParse.substring(startIndex, endIndex);
                    if (!teamRows.some(existing => existing.substring(0, 100) === rowHtml.substring(0, 100))) {
                      teamRows.push(rowHtml);
                      if (teamRows.length >= 30) break;
                    }
                  }
                }
              }
            }
            
            console.log(`[bballref] After aggressive parsing, found ${teamRows.length} team rows`);
          }
          
          // If still no rows, try parsing the full tableHtml
          if (teamRows.length === 0 && newRowsToParse !== tableHtml) {
            console.log('[bballref] No rows found in tbody of new table, trying full tableHtml');
            const fullRowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
            let fullRowMatch;
            while ((fullRowMatch = fullRowRegex.exec(tableHtml)) !== null) {
              const rowHtml = fullRowMatch[1];
              if (rowHtml.includes('<th') || 
                  rowHtml.includes('data-stat="ranker"') || 
                  rowHtml.includes('>Rk</') || 
                  rowHtml.includes('>Rank</') || 
                  rowHtml.trim() === '' ||
                  rowHtml.length < 50) {
                continue;
              }
              const hasTeamLink = rowHtml.includes('/teams/');
              const hasTeamDataStat = rowHtml.includes('data-stat="team"') || rowHtml.includes("data-stat='team'");
              const hasTeamName = /(Spurs|Lakers|Celtics|Warriors|Heat|Bucks|Nuggets|Mavericks|Suns|76ers|Knicks|Nets|Hawks|Bulls|Cavaliers|Pistons|Rockets|Pacers|Clippers|Grizzlies|Timberwolves|Pelicans|Thunder|Magic|Trail Blazers|Kings|Raptors|Jazz|Wizards|Hornets)/i.test(rowHtml);
              const hasStats = /\d+\.\d+/.test(rowHtml) || /\d+,\d+/.test(rowHtml);
              if ((hasTeamLink || hasTeamDataStat || hasTeamName) && (hasStats || rowHtml.length > 100)) {
                if (!teamRows.some(existing => existing.substring(0, 100) === rowHtml.substring(0, 100))) {
                  teamRows.push(rowHtml);
                }
              }
            }
            console.log(`[bballref] After parsing full tableHtml, found ${teamRows.length} team rows`);
          }
        }
      }
    }
    
    if (teamRows.length === 0) {
      // Log a sample to help debug
      const sampleRows = tableHtml.match(/<tr[^>]*>([\s\S]{0,500})<\/tr>/gi);
      console.error('[bballref] No team rows found. Total rows parsed:', totalRows);
      console.error('[bballref] Sample rows (first 3):', sampleRows?.slice(0, 3));
      console.error('[bballref] Table HTML length:', tableHtml.length);
      console.error('[bballref] Table HTML sample (first 1000 chars):', tableHtml.substring(0, 1000));
      throw new Error('Could not find any team rows in the defensive stats table');
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
          'DAL': 'DAL', 'PHO': 'PHX', 'PHX': 'PHX', 
          'NOH': 'NOP', 'NOR': 'NOP', // Basketball Reference uses NOR for New Orleans
          'UTA': 'UTA', 'UTH': 'UTA',
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
            return ((b as any)[metric] || 0) - ((a as any)[metric] || 0);
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

      // Always cache the "all" data for reuse
      cache.set(allCacheKey, payload, 24 * 60); // Cache for 24 hours (1440 minutes)
      
      // If showRankings is requested, add a formatted rankings list
      if (showRankings) {
        const metrics = ['pts', 'reb', 'ast', 'fg_pct', 'fg3_pct', 'stl', 'blk'] as const;
        const formattedRankings: Record<string, Array<{ team: string; rank: number; value: number }>> = {};
        
        for (const metric of metrics) {
          const teamsWithStats = Object.entries(allTeamStats)
            .filter(([_, stats]) => stats && typeof (stats as any)[metric] === 'number')
            .sort(([_, a], [__, b]) => ((b as any)[metric] || 0) - ((a as any)[metric] || 0))
            .map(([team, stats], index) => ({
              team,
              rank: 30 - index,
              value: (stats as any)[metric] || 0,
            }));
          
          formattedRankings[metric] = teamsWithStats;
        }
        
        return NextResponse.json({
          ...payload,
          formattedRankings,
          summary: {
            totalTeams: Object.keys(allTeamStats).length,
            teamsWithRankings: Object.keys(rankings).length,
            metrics: metrics.map(m => ({
              metric: m,
              teamsRanked: formattedRankings[m]?.length || 0,
              rank1: formattedRankings[m]?.[formattedRankings[m].length - 1]?.team, // Worst (rank 1)
              rank30: formattedRankings[m]?.[0]?.team, // Best (rank 30)
            })),
          },
        });
      }
      
      return NextResponse.json(payload);
    }

    // Single team request - extract from parsed allTeamStats
    if (!teamParam) {
      return NextResponse.json({ error: 'Missing team parameter' }, { status: 400 });
    }

    const team = normalizeAbbr(teamParam);
    let teamStats = allTeamStats[team];
    
    // If team not found, check if it's in the available teams (case-insensitive)
    if (!teamStats) {
      const availableTeams = Object.keys(allTeamStats);
      const foundTeam = availableTeams.find(t => t.toUpperCase() === team.toUpperCase());
      if (foundTeam) {
        teamStats = allTeamStats[foundTeam];
      }
    }

    if (!teamStats) {
      // Return available teams for debugging
      const availableTeams = Object.keys(allTeamStats).sort();
      console.log(`[bballref] Team ${team} not found. Available teams:`, availableTeams);
      console.log(`[bballref] Total teams parsed: ${Object.keys(allTeamStats).length}`);
      return NextResponse.json({
        success: false,
        error: `Team ${team} not found. Available teams: ${availableTeams.join(', ')}`,
        team,
        availableTeams,
        totalParsed: Object.keys(allTeamStats).length,
      }, { status: 404 });
    }

    // Cache the "all" data for future requests (even for single team requests)
    // Always calculate rankings so they're available when ?all=1 is requested
    const metrics = ['pts', 'reb', 'ast', 'fg_pct', 'fg3_pct', 'stl', 'blk'] as const;
    const rankings: Record<string, Record<string, number>> = {};
    const teamCount = Object.keys(allTeamStats).length;
    console.log(`[bballref] Calculating rankings for ${teamCount} teams (single team request)`);

    for (const metric of metrics) {
      const teamsWithStats = Object.entries(allTeamStats)
        .filter(([_, stats]) => stats && typeof (stats as any)[metric] === 'number') // Only include teams with valid stats
        .sort(([_, a], [__, b]) => {
          // Sort descending (highest first) - rank 30 is best
          return ((b as any)[metric] || 0) - ((a as any)[metric] || 0);
        });

      console.log(`[bballref] ${metric}: Found ${teamsWithStats.length} teams with stats`);
      
      teamsWithStats.forEach(([team], index) => {
        if (!rankings[team]) rankings[team] = {};
        // Rank 30 = best (index 0), Rank 1 = worst (index 29)
        rankings[team][metric] = 30 - index;
      });
      
      // Log first 5 and last 5 teams for verification
      if (teamsWithStats.length > 0) {
        const top5 = teamsWithStats.slice(0, 5).map(([team, stats]) => `${team}:${((stats as any)[metric] || 0).toFixed(1)}`);
        const bottom5 = teamsWithStats.slice(-5).map(([team, stats]) => `${team}:${((stats as any)[metric] || 0).toFixed(1)}`);
        console.log(`[bballref] ${metric} rankings - Top 5 (rank 30-26): ${top5.join(', ')}`);
        console.log(`[bballref] ${metric} rankings - Bottom 5 (rank 5-1): ${bottom5.join(', ')}`);
      }
    }
    
    // Verify all teams have rankings
    const teamsWithRankings = Object.keys(rankings);
    const teamsInStats = Object.keys(allTeamStats);
    console.log(`[bballref] Rankings calculated: ${teamsWithRankings.length} teams have rankings, ${teamsInStats.length} teams in stats`);
    if (teamsWithRankings.length !== teamsInStats.length) {
      const missing = teamsInStats.filter(t => !rankings[t]);
      console.warn(`[bballref] ⚠️ Some teams missing rankings: ${missing.join(', ')}`);
    }

    const allPayload = {
      success: true,
      source: 'basketball-reference',
      teamStats: allTeamStats,
      rankings,
    };
    cache.set(allCacheKey, allPayload, 24 * 60);

    const payload = {
      success: true,
      source: 'basketball-reference',
      team,
      perGame: teamStats,
    };

    return NextResponse.json(payload);
  } catch (e: any) {
    console.error('[bballref-defensive-stats] Error:', e);
    return NextResponse.json({
      success: false,
      error: e?.message || 'Failed to fetch defensive stats from Basketball Reference',
    }, { status: 500 });
  }
}

