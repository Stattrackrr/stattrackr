/**
 * Fetch starting lineups from BasketballMonster.com
 * ONLY scrapes today and future games (no historical games - those should be manually fixed in DvP store)
 * Shows both projected and verified lineups
 * Caches results in Supabase for instant subsequent requests
 * 
 * Usage: /api/dvp/fetch-basketballmonsters-lineups?team=MIL&season=2025
 */

import { NextRequest, NextResponse } from 'next/server';
import { scrapeBasketballMonstersLineupForDate } from '@/lib/basketballmonsters';

// No Puppeteer needed - only scraping today and future games
export const runtime = "edge";
export const maxDuration = 30;

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

async function bdlFetch(url: string) {
  const res = await fetch(url, { headers: BDL_HEADERS, cache: 'no-store' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`BDL ${res.status}: ${t || url}`);
  }
  return res.json();
}

// Helper to get team roster from BDL for player validation
async function getTeamRoster(teamAbbr: string, season: number): Promise<Set<string>> {
  try {
    const bdlTeamId = ABBR_TO_TEAM_ID_BDL[teamAbbr];
    if (!bdlTeamId) return new Set();
    
    const playersUrl = new URL(`${BDL_BASE}/players`);
    playersUrl.searchParams.set('per_page', '100');
    playersUrl.searchParams.append('seasons[]', String(season));
    playersUrl.searchParams.append('team_ids[]', String(bdlTeamId));
    
    const playersData = await bdlFetch(playersUrl.toString());
    const players = Array.isArray(playersData?.data) ? playersData.data : [];
    
    const roster = new Set<string>();
    for (const player of players) {
      const firstName = (player.first_name || '').trim();
      const lastName = (player.last_name || '').trim();
      if (firstName && lastName) {
        const fullName = `${firstName} ${lastName}`;
        const normalized = normName(fullName);
        roster.add(normalized);
        // Also add variations: "First Last", "F. Last", "Last" only
        const firstInitial = firstName.charAt(0).toLowerCase();
        roster.add(normName(`${firstInitial}. ${lastName}`));
        roster.add(normName(`${firstInitial} ${lastName}`));
        roster.add(normName(lastName));
        // Add without special characters
        roster.add(normalized.replace(/[^a-z0-9\s]/g, ''));
      }
    }
    
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[BasketballMonsters] Roster for ${teamAbbr}: ${roster.size} normalized names`);
    }
    
    return roster;
  } catch (e: any) {
    console.error(`[BasketballMonsters] Error getting team roster: ${e.message}`);
    return new Set();
  }
}

export async function GET(req: NextRequest) {
  // Only log in development
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[BasketballMonsters] ===== API CALLED =====`);
  }
  try {
    const { searchParams } = new URL(req.url);
    const teamAbbr = searchParams.get('team')?.toUpperCase();
    const seasonParam = searchParams.get('season');
    const season = seasonParam ? parseInt(seasonParam, 10) : 2025;
    const bypassCache = searchParams.get('bypassCache') === 'true';
    
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[BasketballMonsters] Request params: team=${teamAbbr}, season=${season}, bypassCache=${bypassCache}`);
    }
    
    if (!teamAbbr) {
      console.log(`[BasketballMonsters] ERROR: No team provided`);
      return NextResponse.json({ error: 'Team abbreviation required' }, { status: 400 });
    }
    
    const bdlTeamId = ABBR_TO_TEAM_ID_BDL[teamAbbr];
    if (!bdlTeamId) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[BasketballMonsters] ERROR: Invalid team ${teamAbbr}`);
      }
      return NextResponse.json({ error: `Invalid team: ${teamAbbr}` }, { status: 400 });
    }
    
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[BasketballMonsters] Fetching lineups for ${teamAbbr} (season ${season}, BDL ID: ${bdlTeamId})...`);
    }
    
    // Get games from BDL
    const gamesUrl = new URL(`${BDL_BASE}/games`);
    gamesUrl.searchParams.set('per_page', '100');
    gamesUrl.searchParams.append('seasons[]', String(season));
    gamesUrl.searchParams.append('team_ids[]', String(bdlTeamId));
    
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[BasketballMonsters] Fetching games from: ${gamesUrl.toString()}`);
    }
    
    let gamesData;
    try {
      gamesData = await bdlFetch(gamesUrl.toString());
    } catch (e: any) {
      console.error(`[BasketballMonsters] BDL fetch error:`, e.message);
      return NextResponse.json({
        team: teamAbbr,
        season,
        error: `Failed to fetch games from BDL: ${e.message}`,
        players: [],
        debug: {
          messages: [`BDL API error: ${e.message}`, `URL: ${gamesUrl.toString()}`]
        }
      });
    }
    
    const games = Array.isArray(gamesData?.data) ? gamesData.data : [];
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[BasketballMonsters] BDL returned ${games.length} games`);
    }
    
    if (games.length === 0) {
      return NextResponse.json({
        team: teamAbbr,
        season,
        error: 'No games found for this team/season',
        players: [],
        debug: {
          messages: [`BDL returned empty games array`, `URL: ${gamesUrl.toString()}`, `Response: ${JSON.stringify(gamesData).substring(0, 200)}`]
        }
      });
    }
    
    // BasketballMonsters shows tomorrow's games on the main page if there are no games today
    // So we need to check both today and tomorrow
    const today = new Date();
    // Use Eastern Time to match BasketballMonsters
    const easternTime = new Date(today.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    easternTime.setHours(0, 0, 0, 0);
    const todayStr = `${easternTime.getFullYear()}-${String(easternTime.getMonth() + 1).padStart(2, '0')}-${String(easternTime.getDate()).padStart(2, '0')}`;
    
    // Calculate tomorrow
    const tomorrow = new Date(easternTime);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[BasketballMonsters] Looking for today's (${todayStr}) or tomorrow's (${tomorrowStr}) game in ${games.length} total games...`);
    }
    
    // Helper to extract date string from game date
    const getGameDateStr = (game: any): string | null => {
      if (!game.date) return null;
      
      if (typeof game.date === 'string') {
        return game.date.includes('T') ? game.date.split('T')[0] : game.date;
      } else {
        const gameDate = new Date(game.date);
        return `${gameDate.getFullYear()}-${String(gameDate.getMonth() + 1).padStart(2, '0')}-${String(gameDate.getDate()).padStart(2, '0')}`;
      }
    };
    
    // Find today's game first, then tomorrow's if no game today
    let targetGame = games.find((game: any) => {
      const gameDateStr = getGameDateStr(game);
      return gameDateStr === todayStr;
    });
    
    let targetDate = todayStr;
    
    // If no game today, check tomorrow (BasketballMonsters shows tomorrow if no games today)
    if (!targetGame) {
      targetGame = games.find((game: any) => {
        const gameDateStr = getGameDateStr(game);
        return gameDateStr === tomorrowStr;
      });
      targetDate = tomorrowStr;
    }
    
    if (process.env.NODE_ENV !== 'production') {
      if (targetGame) {
        console.log(`[BasketballMonsters] ✅ Found game for ${targetDate === todayStr ? 'today' : 'tomorrow'}: ${targetGame.date}`);
      } else {
        console.log(`[BasketballMonsters] ❌ No game found for today (${todayStr}) or tomorrow (${tomorrowStr})`);
        // Show sample game dates for debugging
        const sampleDates = games.slice(0, 5).map((g: any) => getGameDateStr(g)).filter(Boolean).join(', ');
        console.log(`[BasketballMonsters] Sample game dates: ${sampleDates}`);
      }
    }
    
    if (!targetGame) {
      return NextResponse.json({
        team: teamAbbr,
        season,
        error: `No game found for today (${todayStr}) or tomorrow (${tomorrowStr})`,
        players: [],
        debug: {
          messages: [`No game scheduled for today or tomorrow`, `Today: ${todayStr}, Tomorrow: ${tomorrowStr}`, `Total games in season: ${games.length}`, `Note: BasketballMonsters shows tomorrow's games if there are no games today`]
        }
      });
    }
    
    // Store the actual lineup from the most recent game (for today/tomorrow)
    let actualLineup: Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }> | null = null;
    
    // Track positions per player (for aggregated data - kept for backward compatibility)
    const playerPositions = new Map<string, {
      name: string;
      positions: Record<string, { count: number; verifiedCount: number }>;
      totalGames: number;
    }>();
    
    // Get team roster for player validation
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[BasketballMonsters] Fetching roster for ${teamAbbr}...`);
    }
    const teamRoster = await getTeamRoster(teamAbbr, season);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[BasketballMonsters] Roster has ${teamRoster.size} players`);
    }
    
    // Process the target game (today or tomorrow)
    const gamesToProcess = [targetGame];
    let processed = 0;
    let skipped = 0;
    
    for (const game of gamesToProcess) {
      // Get opponent for validation
      const homeId = game.home_team?.id;
      const visitorId = game.visitor_team?.id;
      const teamIdToAbbr: Record<number, string> = {};
      Object.entries(ABBR_TO_TEAM_ID_BDL).forEach(([abbr, id]) => {
        teamIdToAbbr[id] = abbr;
      });
      const homeAbbr = homeId ? teamIdToAbbr[homeId] : null;
      const awayAbbr = visitorId ? teamIdToAbbr[visitorId] : null;
      const opponent = teamAbbr === homeAbbr ? awayAbbr : homeAbbr;
      
      // Use the target date (today or tomorrow) - BasketballMonsters shows tomorrow if no games today
      const gameDate = targetDate;
      
      try {
        const lineup = await scrapeBasketballMonstersLineupForDate(gameDate, teamAbbr, bypassCache, opponent, teamRoster);
        
        if (lineup.length === 5) {
          // Store the actual lineup (this is what the frontend needs)
          actualLineup = lineup;
          
          // Also track for aggregated data (backward compatibility)
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
              p.positions[starter.position] = { count: 0, verifiedCount: 0 };
            }
            p.positions[starter.position].count++;
            if (starter.isVerified) {
              p.positions[starter.position].verifiedCount++;
            }
            // Log verification status for debugging (only in development)
            if (process.env.NODE_ENV !== 'production') {
              if (starter.isProjected) {
                console.log(`[BasketballMonsters] Game ${gameDate}: ${starter.name} (${starter.position}) is PROJECTED`);
              } else if (starter.isVerified) {
                console.log(`[BasketballMonsters] Game ${gameDate}: ${starter.name} (${starter.position}) is VERIFIED`);
              }
            }
          }
          
          processed++;
        } else if (lineup.length > 0) {
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[BasketballMonsters] Game ${gameDate}: Only found ${lineup.length} starters (expected 5)`);
          }
          skipped++; // Count as skipped since we need exactly 5
        } else {
          // No lineup found - might be Puppeteer failure for historical dates
          // Only log in development to reduce console spam
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[BasketballMonsters] Game ${gameDate}: No lineup found (empty array returned)`);
          }
          skipped++;
        }
        
        // Delay to avoid rate limiting
        if (processed < gamesToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (e: any) {
        // Only log errors in development
        if (process.env.NODE_ENV !== 'production') {
          console.error(`[BasketballMonsters] Error processing game ${gameDate}:`, e.message);
          console.error(`[BasketballMonsters] Stack:`, e.stack?.split('\n').slice(0, 3).join(' | '));
        }
        skipped++;
        
        // Add error to debug logs
        const logKey = `${teamAbbr}:${gameDate}`;
        if (!debugLogs.has(logKey)) {
          debugLogs.set(logKey, []);
        }
        debugLogs.get(logKey)!.push(`[ERROR] ${e.message}`);
      }
    }
    
    // Collect all debug logs even if no players found
    const allLogs: string[] = [];
    for (const game of gamesToProcess.slice(0, Math.min(processed + 1, gamesToProcess.length))) {
      const logKey = `${teamAbbr}:${game.date}`;
      const logs = debugLogs.get(logKey);
      if (logs) {
        allLogs.push(...logs);
      }
    }
    
    // If we have an actual lineup, return it directly (this is what the frontend needs)
    if (actualLineup && actualLineup.length === 5) {
      return NextResponse.json({
        team: teamAbbr,
        season,
        date: targetDate,
        source: 'BasketballMonster.com',
        gamesProcessed: processed,
        gamesSkipped: skipped,
        totalGames: games.length,
        players: actualLineup, // Return the actual lineup with position property
        debug: {
          messages: [`Successfully scraped lineup for ${targetDate}`, `Found ${actualLineup.length} starters`],
          detailedLogs: allLogs.slice(0, 50),
          note: 'Check detailedLogs for step-by-step scraping info'
        }
      });
    }
    
    if (playerPositions.size === 0) {
      return NextResponse.json({
        team: teamAbbr,
        season,
        gamesProcessed: processed,
        gamesSkipped: skipped,
        totalGames: games.length,
        error: `No starting lineups found. Processed ${processed} games, skipped ${skipped} games. Note: Only today and future games are scraped - past games should be manually fixed in DvP store.`,
        players: [],
        debug: {
          messages: [`Processed ${processed} games, skipped ${skipped} games, found 0 players`],
          detailedLogs: allLogs.slice(0, 50),
          note: 'Check detailedLogs. Historical dates may fail due to Puppeteer issues - try processing only recent games.'
        }
      });
    }
    
    // Calculate most common position (prioritize verified lineups) - for backward compatibility
    const results = Array.from(playerPositions.entries()).map(([key, data]) => {
      let mostCommonPos = '';
      let maxCount = 0;
      let maxVerifiedCount = 0;
      
      for (const [pos, stats] of Object.entries(data.positions)) {
        // Prioritize positions with more verified lineups
        if (stats.verifiedCount > maxVerifiedCount ||
            (stats.verifiedCount === maxVerifiedCount && stats.count > maxCount)) {
          mostCommonPos = pos;
          maxCount = stats.count;
          maxVerifiedCount = stats.verifiedCount;
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
    
    // Collect debug info from first few games
    const debugInfo: string[] = [];
    if (processed > 0) {
      debugInfo.push(`Processed ${processed} games successfully`);
      debugInfo.push(`Found ${results.length} unique players`);
      if (results.length > 0) {
        debugInfo.push(`Sample players: ${results.slice(0, 3).map(p => p.name).join(', ')}`);
      }
    }
    
    // Collect all debug logs from processed games (already done above if no players)
    
    return NextResponse.json({
      team: teamAbbr,
      season,
      source: 'BasketballMonster.com',
      gamesProcessed: processed,
      gamesSkipped: skipped,
      totalGames: games.length,
      players: results.sort((a, b) => b.totalGames - a.totalGames),
      debug: {
        messages: debugInfo,
        detailedLogs: allLogs.slice(0, 50), // First 50 log lines
        note: 'Check detailedLogs for step-by-step scraping info'
      }
    });
    
  } catch (error: any) {
    console.error('[BasketballMonsters] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch BasketballMonster lineups' },
      { status: 500 }
    );
  }
}

