/**
 * Fetch starting lineups from BasketballMonster.com
 * ONLY scrapes today and future games (no historical games - those should be manually fixed in DvP store)
 * Shows both projected and verified lineups
 * Caches results in Supabase for instant subsequent requests
 * 
 * Usage: /api/dvp/fetch-basketballmonsters-lineups?team=MIL&season=2025
 */

import { NextRequest, NextResponse } from 'next/server';
import { getNBACache, setNBACache } from '@/lib/nbaCache';

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

// BasketballMonsters uses different abbreviations than standard NBA
// Map BasketballMonsters abbreviations to standard abbreviations
const BM_TO_STANDARD_ABBR: Record<string, string> = {
  'PHO': 'PHX',  // Phoenix
  'GS': 'GSW',   // Golden State
  'NO': 'NOP',   // New Orleans
  'NY': 'NYK',   // New York
  'SA': 'SAS',   // San Antonio
  'UTAH': 'UTA', // Utah
  'WSH': 'WAS',  // Washington
};

// Reverse mapping: standard abbreviations to BasketballMonsters abbreviations
// Only teams that use different abbreviations on BasketballMonsters need to be mapped
// All other teams (23 teams) use the same abbreviation on both systems
const STANDARD_TO_BM_ABBR: Record<string, string> = {
  'PHX': 'PHO',  // Phoenix Suns
  'GSW': 'GS',   // Golden State Warriors
  'NOP': 'NO',   // New Orleans Pelicans
  'NYK': 'NY',   // New York Knicks
  'SAS': 'SA',   // San Antonio Spurs
  'UTA': 'UTAH', // Utah Jazz
  'WAS': 'WSH',  // Washington Wizards
};

// Normalize team abbreviation (convert BasketballMonsters format to standard)
function normalizeTeamAbbr(bmAbbr: string): string {
  const upper = bmAbbr.toUpperCase();
  return BM_TO_STANDARD_ABBR[upper] || upper;
}

// Get BasketballMonsters abbreviation from standard abbreviation
function getBMAbbr(standardAbbr: string): string {
  const upper = standardAbbr.toUpperCase();
  return STANDARD_TO_BM_ABBR[upper] || upper;
}

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

// Store debug logs per date for API response
const debugLogs: Map<string, string[]> = new Map();

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

// Helper to get game opponent from BDL for validation
async function getGameOpponent(date: string, teamAbbr: string): Promise<{ opponent: string | null; homeTeam: string | null; awayTeam: string | null }> {
  try {
    const bdlTeamId = ABBR_TO_TEAM_ID_BDL[teamAbbr];
    if (!bdlTeamId) return { opponent: null, homeTeam: null, awayTeam: null };
    
    const gamesUrl = new URL(`${BDL_BASE}/games`);
    gamesUrl.searchParams.set('per_page', '100');
    gamesUrl.searchParams.set('dates[]', date);
    gamesUrl.searchParams.append('team_ids[]', String(bdlTeamId));
    
    const gamesData = await bdlFetch(gamesUrl.toString());
    const games = Array.isArray(gamesData?.data) ? gamesData.data : [];
    
    if (games.length === 0) return { opponent: null, homeTeam: null, awayTeam: null };
    
    const game = games[0];
    const homeId = game.home_team?.id;
    const visitorId = game.visitor_team?.id;
    
    // Find team abbreviations
    const teamIdToAbbr: Record<number, string> = {};
    Object.entries(ABBR_TO_TEAM_ID_BDL).forEach(([abbr, id]) => {
      teamIdToAbbr[id] = abbr;
    });
    
    const homeAbbr = homeId ? teamIdToAbbr[homeId] : null;
    const awayAbbr = visitorId ? teamIdToAbbr[visitorId] : null;
    
    const opponent = teamAbbr === homeAbbr ? awayAbbr : homeAbbr;
    
    return { opponent: opponent || null, homeTeam: homeAbbr || null, awayTeam: awayAbbr || null };
  } catch (e: any) {
    console.error(`[BasketballMonsters] Error getting game opponent: ${e.message}`);
    return { opponent: null, homeTeam: null, awayTeam: null };
  }
}

export async function scrapeBasketballMonstersLineupForDate(date: string, teamAbbr: string, bypassCache: boolean = false, expectedOpponent?: string | null, teamRoster?: Set<string>): Promise<Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }>> {
  const logKey = `${teamAbbr}:${date}`;
  if (!debugLogs.has(logKey)) {
    debugLogs.set(logKey, []);
  }
  const logs = debugLogs.get(logKey)!;
  
  const addLog = (msg: string) => {
    logs.push(`[${date}] ${msg}`);
    // Only log in development to reduce console spam
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[BasketballMonsters] ${msg}`);
    }
  };
  // Check cache first (unless bypassed)
  const cacheKey = `basketballmonsters:lineup:${teamAbbr}:${date}`;
  if (!bypassCache) {
    const cached = await getNBACache<Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }>>(cacheKey);
    if (cached) {
      addLog(`✅ Cache hit for ${teamAbbr} on ${date}`);
      return cached;
    }
  } else {
    addLog(`🔄 Bypassing cache for ${teamAbbr} on ${date} (bypassCache=true)`);
  }
  
  addLog(`🔍 Cache miss - will scrape fresh data for ${teamAbbr} on ${date}`);
  
  addLog(`🔍 Scraping lineups for ${teamAbbr} on ${date}...`);
  
  // Calculate how many days back we need to go
  // Parse date string as local date (YYYY-MM-DD format)
  // Use local timezone to avoid off-by-one day issues
  const targetDateParts = date.split('-');
  const year = parseInt(targetDateParts[0]);
  const month = parseInt(targetDateParts[1]) - 1; // 0-indexed
  const day = parseInt(targetDateParts[2]);
  
  // Create date in local timezone (not UTC)
  const targetDate = new Date(year, month, day, 0, 0, 0, 0);
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  today.setMinutes(0, 0, 0);
  today.setSeconds(0, 0);
  today.setMilliseconds(0);
  
  const daysDiff = Math.floor((today.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
  
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const targetDateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
  addLog(`Date calculation: target=${date}, today=${todayStr}, targetDate=${targetDateStr}, daysDiff=${daysDiff}`);
  
  // ONLY scrape today and future games - skip past games
  if (daysDiff > 0) {
    // Only log in development
    if (process.env.NODE_ENV !== 'production') {
      addLog(`⚠️ Skipping past date (${daysDiff} days ago) - only scraping today and future games`);
      addLog(`   Past game starters should be manually fixed in DvP store`);
    }
    return [];
  }
  
  // ONLY process today's game - skip all future dates (BasketballMonsters only shows today)
  if (daysDiff < 0) {
    // Only log in development
    if (process.env.NODE_ENV !== 'production') {
      addLog(`⚠️ Skipping future date (${Math.abs(daysDiff)} days ahead) - only today's games are available on BasketballMonsters`);
    }
    return [];
  }
  
  let html = '';
  
  try {
    // For today and future dates, use direct fetch (main page shows these games)
    const useDirectFetch = daysDiff <= 0;
    
    // For today and future dates, use direct fetch (main page shows these games)
    addLog(`${daysDiff === 0 ? "Today's" : "Future"} date - attempting direct fetch...`);
    try {
      const url = `https://basketballmonster.com/nbalineups.aspx`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
          'Referer': 'https://basketballmonster.com/',
        },
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      html = await response.text();
      addLog(`Got HTML via direct fetch: ${html.length} characters`);
      
      // Check if our team's game is actually on this page
      // BasketballMonsters may use different abbreviations (e.g., PHO instead of PHX)
      const teamUpper = teamAbbr.toUpperCase();
      const bmAbbr = getBMAbbr(teamUpper);
      
      // Check for both standard abbreviation and BasketballMonsters abbreviation
      const standardPattern = new RegExp(`${teamUpper}\\s*@|@\\s*${teamUpper}`, 'i');
      const bmPattern = new RegExp(`${bmAbbr}\\s*@|@\\s*${bmAbbr}`, 'i');
      const hasGame = html.match(standardPattern) || html.match(bmPattern);
      
      if (hasGame) {
        addLog(`✅ Found ${teamAbbr} game on main page (checked ${teamUpper} and ${bmAbbr}) - will parse directly`);
      } else {
        addLog(`⚠️ ${teamAbbr} game not found on main page (checked ${teamUpper} and ${bmAbbr})`);
        html = '';
      }
    } catch (e: any) {
      addLog(`Direct fetch failed: ${e.message}`);
      html = '';
    }
    
    // No Puppeteer needed - we only handle today and future games
    if (!html) {
      addLog(`❌ No HTML obtained - cannot scrape lineup for this date`);
      addLog(`This game will be skipped. Only today and future games are supported.`);
      return [];
    }
    const teamUpper = teamAbbr.toUpperCase();
    
    // Find the specific game box that contains our team
    // BasketballMonster shows multiple games, each in its own box/table
    // We need to find the game box where our team is one of the two teams
    
    // Get expected opponent from BDL for validation
    let gameInfo = { opponent: null as string | null, homeTeam: null as string | null, awayTeam: null as string | null };
    if (expectedOpponent) {
      gameInfo.opponent = expectedOpponent;
      addLog(`Using provided opponent: ${expectedOpponent}`);
    } else {
      gameInfo = await getGameOpponent(date, teamAbbr);
      addLog(`Game info from BDL: opponent=${gameInfo.opponent}, home=${gameInfo.homeTeam}, away=${gameInfo.awayTeam}`);
    }
    
    // Validate that we're on the correct date's page
    // Check if the page contains date indicators that match our target date
    const targetDateObj = new Date(date);
    const targetDateStr = formatDate(date); // Format: "MM/DD/YYYY"
    const targetDay = targetDateObj.getDate();
    const targetMonth = targetDateObj.getMonth() + 1;
    const targetYear = targetDateObj.getFullYear();
    
    // Look for date patterns in the HTML (check a larger section)
    const dateSection = html.substring(0, 100000); // Check first 100k chars
    const datePatterns = [
      new RegExp(`${targetMonth}[/-]${targetDay}[/-]${targetYear}`, 'i'), // "11/26/2025" or "11-26-2025"
      new RegExp(`${targetMonth.toString().padStart(2, '0')}[/-]${targetDay.toString().padStart(2, '0')}[/-]${targetYear}`, 'i'), // "11/26/2025" with padding
      new RegExp(String(targetYear), 'i'), // At least the year should match
    ];
    const hasDateMatch = datePatterns.some(pattern => pattern.test(dateSection));
    
    // Also check if page shows future dates (which would be wrong for past games)
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = formatDate(tomorrow);
    const hasFutureDate = dateSection.includes(tomorrowStr) || dateSection.includes(formatDate(new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000)));
    
    if (daysDiff > 0 && !hasDateMatch) {
      addLog(`⚠️ WARNING: Page may not be for target date ${targetDateStr} (daysDiff=${daysDiff})`);
      addLog(`This could mean Puppeteer navigation failed or page shows wrong date`);
      if (hasFutureDate) {
        addLog(`❌ ERROR: Page appears to show future dates instead of target date ${targetDateStr}`);
        addLog(`Skipping this game - Puppeteer navigation likely failed`);
        return [];
      }
    }
    
    // Find all game matchups on the page
    // Format: "MIL @ MIA" means MIL (away) @ MIA (home)
    // BasketballMonster typically shows HOME team in first column, AWAY team in second column
    const allGameMatches = Array.from(html.matchAll(/([A-Z]{3})\s*@\s*([A-Z]{3})/gi));
    addLog(`Found ${allGameMatches.length} game matchups on page`);
    if (allGameMatches.length > 0) {
      const sampleMatches = allGameMatches.slice(0, 10).map(m => m[0]).join(', ');
      addLog(`Sample matchups: ${sampleMatches}`);
    }
    
    let targetGameMatch: RegExpMatchArray | null = null;
    let matchupIndex = -1;
    let isFirstTeam = false; // Track if our team is the first team in the matchup string
    let isHomeTeam = false; // Track if our team is the home team (first column in table)
    
    // Find the matchup that includes our team
    // Validate opponent if we have it - use normalized abbreviations for matching
    addLog(`Looking for team: ${teamUpper}, expected opponent: ${gameInfo.opponent || 'ANY'}`);
    for (const match of allGameMatches) {
      const team1Raw = match[1].toUpperCase(); // Away team (first in "TEAM1 @ TEAM2")
      const team2Raw = match[2].toUpperCase(); // Home team (second in "TEAM1 @ TEAM2")
      
      // Normalize BasketballMonsters abbreviations to standard
      const team1 = normalizeTeamAbbr(team1Raw);
      const team2 = normalizeTeamAbbr(team2Raw);
      
      // Must include our team
      if (team1 !== teamUpper && team2 !== teamUpper) {
        continue; // Skip this matchup - doesn't include our team
      }
      
      // If we have expected opponent, check if it matches (using normalized abbreviations)
      if (gameInfo.opponent) {
        const opponentUpper = gameInfo.opponent.toUpperCase();
        const normalizedOpponent = normalizeTeamAbbr(opponentUpper);
        const hasOpponent = team1 === normalizedOpponent || team2 === normalizedOpponent;
        
        if (!hasOpponent) {
          addLog(`⚠️ SKIPPING: Matchup ${match[0]} (normalized: ${team1} @ ${team2}) doesn't match expected opponent ${gameInfo.opponent} (normalized: ${normalizedOpponent})`);
          continue; // Skip this game - wrong opponent
        } else {
          addLog(`✅ Matchup ${match[0]} (normalized: ${team1} @ ${team2}) matches expected opponent ${gameInfo.opponent}`);
        }
      }
      
      if (team1 === teamUpper) {
        targetGameMatch = match;
        matchupIndex = match.index || -1;
        isFirstTeam = true; // Our team is first in matchup string (away team)
        isHomeTeam = false; // Away team is in FIRST column (player1) - BasketballMonster format
        break;
      } else if (team2 === teamUpper) {
        targetGameMatch = match;
        matchupIndex = match.index || -1;
        isFirstTeam = false; // Our team is second in matchup string (home team)
        isHomeTeam = true; // Home team is in SECOND column (player2) - BasketballMonster format
        break;
      }
    }
    
    if (!targetGameMatch || matchupIndex === -1) {
      addLog(`❌ No game found with team ${teamAbbr} on ${date}`);
      addLog(`   Searched for: ${teamUpper}`);
      addLog(`   Expected opponent: ${gameInfo.opponent || 'ANY'}`);
      addLog(`   Found ${allGameMatches.length} game matchups on page`);
      if (allGameMatches.length > 0) {
        const allMatchups = allGameMatches.map(m => m[0]).join(', ');
        addLog(`   All matchups found: ${allMatchups}`);
        // Check if our team appears in any matchup
        const hasOurTeam = allGameMatches.some(m => 
          m[1].toUpperCase() === teamUpper || m[2].toUpperCase() === teamUpper
        );
        if (hasOurTeam) {
          addLog(`   ⚠️ Our team ${teamUpper} found in matchups, but opponent didn't match expected ${gameInfo.opponent || 'ANY'}`);
        } else {
          addLog(`   ⚠️ Our team ${teamUpper} not found in any matchup`);
        }
      }
      return [];
    }
    
    addLog(`Found game: ${targetGameMatch[0]}, our team (${teamAbbr}) is ${isHomeTeam ? 'HOME (first column)' : 'AWAY (second column)'}`);
    addLog(`Team1 (Away): ${targetGameMatch[1]}, Team2 (Home): ${targetGameMatch[2]}, Looking for: ${teamUpper}`);
    
    // Find the game box boundaries
    // Look backwards for the start of this game box (might be a div, table, or header)
    let boxStart = matchupIndex;
    const beforeMatchup = html.substring(Math.max(0, matchupIndex - 3000), matchupIndex);
    
    // Look for common game box start markers
    const boxStartMarkers = [
      beforeMatchup.lastIndexOf('<table'),
      beforeMatchup.lastIndexOf('<div'),
      beforeMatchup.lastIndexOf('game'),
      beforeMatchup.lastIndexOf('lineup')
    ].filter(i => i >= 0);
    
    if (boxStartMarkers.length > 0) {
      boxStart = Math.max(0, matchupIndex - 3000) + Math.max(...boxStartMarkers);
    } else {
      boxStart = Math.max(0, matchupIndex - 2000);
    }
    
    // Find where this game box ends - look for the next game matchup
    let boxEnd = Math.min(html.length, matchupIndex + 20000);
    const afterMatchup = html.substring(matchupIndex + targetGameMatch[0].length);
    const nextGameMatch = afterMatchup.match(/([A-Z]{3})\s*@\s*([A-Z]{3})/i);
    
    if (nextGameMatch && nextGameMatch.index !== undefined) {
      boxEnd = Math.min(boxEnd, matchupIndex + targetGameMatch[0].length + nextGameMatch.index);
    }
    
    const teamSection = html.substring(boxStart, boxEnd);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[BasketballMonsters] Isolated game box for ${teamAbbr}: ${boxEnd - boxStart} chars`);
    }
    
    // BasketballMonster format: Table structure
    // <tr>
    //   <td><span>PG</span></td>
    //   <td><a href='playerinfo.aspx?i=XXXX'>Player Name</a></td>  <!-- Team 1 -->
    //   <td><a href='playerinfo.aspx?i=XXXX'>Player Name</a></td>  <!-- Team 2 -->
    // </tr>
    
    // Find the game box/table that contains our team
    // BasketballMonster shows games in boxes, each with two teams
    // We need to find the specific game box for our team
    
    // Find the table within the game box
    // The table should be directly after the matchup text
    // Look for the first <table> tag in the teamSection
    const tableStart = teamSection.indexOf('<table');
    if (tableStart === -1) {
      addLog(`No table found in game box for ${teamAbbr}`);
      return [];
    }
    
    // Find the matching </table> tag
    let tableEnd = teamSection.indexOf('</table>', tableStart);
    if (tableEnd === -1) {
      addLog(`No closing table tag found for ${teamAbbr}`);
      return [];
    }
    tableEnd += '</table>'.length;
    
    const gameTableHtml = teamSection.substring(tableStart, tableEnd);
    addLog(`Extracted table: ${gameTableHtml.length} chars`);
    
    // Check if this is a verified or projected lineup section
    // BasketballMonster has separate sections: "Verified Lineup" and "Projected Lineup"
    // We need to check a larger context around the game box to find the section header
    // Also check the entire page context, not just before the box
    const contextBefore = html.substring(Math.max(0, boxStart - 15000), boxStart);
    const contextAfter = html.substring(boxEnd, Math.min(html.length, boxEnd + 5000));
    const fullContext = contextBefore + teamSection + contextAfter;
    
    // Look for various indicators of verified/projected status
    // Check for section headers, CSS classes, and text patterns
    const verifiedIndicators = [
      /Verified\s+Lineup/i,
      /class=['"]verified['"]/i,
      /verified\s+lineup/i,
      /lineup\s+verified/i,
      /confirmed\s+lineup/i,
      /lineup\s+confirmed/i,
      /<h[1-6][^>]*>.*?Verified.*?<\/h[1-6]>/i,
      /<div[^>]*class=['"][^'"]*verified[^'"]*['"]/i,
      /<span[^>]*class=['"][^'"]*verified[^'"]*['"]/i
    ];
    const projectedIndicators = [
      /Projected\s+Lineup/i,
      /projected\s+lineup/i,
      /lineup\s+projected/i,
      /predicted\s+lineup/i,
      /lineup\s+prediction/i,
      /<h[1-6][^>]*>.*?Projected.*?<\/h[1-6]>/i,
      /<div[^>]*class=['"][^'"]*projected[^'"]*['"]/i,
      /<span[^>]*class=['"][^'"]*projected[^'"]*['"]/i
    ];
    
    const hasVerifiedIndicator = verifiedIndicators.some(regex => regex.test(fullContext));
    const hasProjectedIndicator = projectedIndicators.some(regex => regex.test(fullContext));
    
    // Also check the table itself for indicators
    const tableHasVerified = /verified/i.test(gameTableHtml);
    const tableHasProjected = /projected/i.test(gameTableHtml);
    
    const isVerifiedSection = (hasVerifiedIndicator || tableHasVerified) && !hasProjectedIndicator && !tableHasProjected;
    const isProjectedSection = (hasProjectedIndicator || tableHasProjected) && !isVerifiedSection;
    
    addLog(`Lineup type: ${isVerifiedSection ? 'VERIFIED' : isProjectedSection ? 'PROJECTED' : 'UNKNOWN'}`);
    if (!isVerifiedSection && !isProjectedSection) {
      addLog(`⚠️ Could not determine lineup type - checking for indicators in context`);
      addLog(`  Verified indicators found: ${hasVerifiedIndicator || tableHasVerified}, Projected indicators found: ${hasProjectedIndicator || tableHasProjected}`);
      // Sample context for debugging - look for any lineup-related text
      const lineupKeywords = fullContext.match(/(lineup|verified|projected|confirmed|predicted)/gi);
      addLog(`  Found keywords: ${lineupKeywords ? lineupKeywords.slice(0, 10).join(', ') : 'none'}`);
    }
    
    // Find table rows with position labels
    const tableRows = gameTableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    
    addLog(`Found ${tableRows.length} table rows`);
    
    // Debug: Show first few rows to understand structure
    if (tableRows.length > 0 && tableRows[0]) {
      const firstRow = tableRows[0];
      const hasPosition = firstRow.match(/<span[^>]*>(PG|SG|SF|PF|C)<\/span>/i);
      const playerLinks = firstRow.match(/<a[^>]*href=['"]playerinfo\.aspx\?i=\d+['"][^>]*>([^<]+)<\/a>/gi) || [];
      addLog(`First row: hasPosition=${!!hasPosition}, playerLinks=${playerLinks.length}`);
      if (playerLinks.length >= 2 && playerLinks[0] && playerLinks[1]) {
        const p1 = playerLinks[0].match(/>([^<]+)</)?.[1];
        const p2 = playerLinks[1].match(/>([^<]+)</)?.[1];
        addLog(`First row players: "${p1 || 'N/A'}" | "${p2 || 'N/A'}"`);
      }
    }
    
    const foundPositions = new Set<string>();
    const positionToPlayer = new Map<string, { name: string; isVerified: boolean; isProjected: boolean; confidence: 'high' | 'medium' | 'low' }>();
    
    // Track which column we're using for consistency (all 5 players must come from same column)
    let selectedColumn: 'player1' | 'player2' | null = null;
    let columnRosterMatches = { player1: 0, player2: 0 };
    
    // Helper function to check if a player is on the roster (defined at function scope)
    const isPlayerOnRoster = (playerName: string): boolean => {
      if (!teamRoster || teamRoster.size === 0) return true; // No roster = assume valid
      const normalized = normName(playerName);
      const nameParts = normalized.split(' ');
      const lastName = nameParts[nameParts.length - 1];
      const firstName = nameParts[0];
      
      // Try multiple matching strategies
      const matches = Boolean(
        teamRoster.has(normalized) || 
        teamRoster.has(lastName) ||
        (firstName && lastName && teamRoster.has(`${firstName} ${lastName}`)) ||
        (lastName && teamRoster.has(lastName.toLowerCase()))
      );
      
      // Debug logging in development
      if (process.env.NODE_ENV !== 'production' && !matches && playerName) {
        // Check if similar names exist
        const similarNames = Array.from(teamRoster).filter(r => 
          r.includes(lastName) || lastName.includes(r) || 
          normalized.includes(r) || r.includes(normalized)
        );
        if (similarNames.length > 0) {
          addLog(`[DEBUG] Player "${playerName}" (normalized: "${normalized}") not found, but similar names: ${similarNames.slice(0, 3).join(', ')}`);
        }
      }
      
      return matches;
    };
    
    // FIRST PASS: Count roster matches per column to determine which column to use
    for (const row of tableRows) {
      const positionMatch = row.match(/<span[^>]*>(PG|SG|SF|PF|C)<\/span>/i);
      if (!positionMatch) continue;
      
      const playerLinks = row.match(/<a[^>]*href=['"]playerinfo\.aspx\?i=\d+['"][^>]*>([^<]+)<\/a>/gi) || [];
      if (playerLinks.length >= 2 && playerLinks[0] && playerLinks[1]) {
        const player1Match = playerLinks[0].match(/>([^<]+)</);
        const player2Match = playerLinks[1].match(/>([^<]+)</);
        
        if (player1Match && player2Match) {
          const player1 = player1Match[1].trim();
          const player2 = player2Match[1].trim();
          
          if (player1.length >= 2 && /[a-z]/i.test(player1) && isPlayerOnRoster(player1)) {
            columnRosterMatches.player1++;
          }
          if (player2.length >= 2 && /[a-z]/i.test(player2) && isPlayerOnRoster(player2)) {
            columnRosterMatches.player2++;
          }
        }
      }
    }
    
    // Determine which column to use based on roster matches
    if (columnRosterMatches.player1 > columnRosterMatches.player2) {
      selectedColumn = 'player1';
    } else if (columnRosterMatches.player2 > columnRosterMatches.player1) {
      selectedColumn = 'player2';
    } else {
      // Tie or no matches - use correct column based on home/away
      selectedColumn = isHomeTeam ? 'player2' : 'player1';
    }
    
    addLog(`[Column Selection] Selected column: ${selectedColumn} (player1 matches: ${columnRosterMatches.player1}, player2 matches: ${columnRosterMatches.player2}, isHomeTeam: ${isHomeTeam})`);
    
    // Helper function to select player from the determined column
    const selectCorrectPlayer = (player1: string, player2: string, position: string): { player: string; column: string; confidence: 'high' | 'medium' | 'low' } | null => {
      const p1OnRoster = isPlayerOnRoster(player1);
      const p2OnRoster = isPlayerOnRoster(player2);
      
      // BasketballMonster column structure (CORRECTED):
      // - Column 1 (player1): AWAY team (first team in "AWAY @ HOME")
      // - Column 2 (player2): HOME team (second team in "AWAY @ HOME")
      
      // Use the pre-determined column consistently
      const useColumn = selectedColumn!;
      const selectedPlayer = useColumn === 'player1' ? player1 : player2;
      const selectedOnRoster = useColumn === 'player1' ? p1OnRoster : p2OnRoster;
      const columnLabel = useColumn === 'player1' ? 'player1 (AWAY)' : 'player2 (HOME)';
      
      if (selectedOnRoster) {
        addLog(`Position ${position}: Using ${useColumn} player "${selectedPlayer}" (on roster: true)`);
        return { player: selectedPlayer, column: columnLabel, confidence: 'high' };
      } else {
        addLog(`⚠️ Position ${position}: Using ${useColumn} player "${selectedPlayer}" (on roster: false, but using for consistency)`);
        return { player: selectedPlayer, column: columnLabel, confidence: 'medium' };
      }
    };
    
    // SECOND PASS: Process all rows and collect players from the selected column
    for (const row of tableRows) {
      // Extract position from <span>PG</span> or <span>SG</span> etc.
      const positionMatch = row.match(/<span[^>]*>(PG|SG|SF|PF|C)<\/span>/i);
      if (!positionMatch) continue;
      
      const position = positionMatch[1].toUpperCase();
      if (foundPositions.has(position)) {
        addLog(`⚠️ Duplicate position ${position} found - skipping duplicate`);
        continue;
      }
      
      // Extract player names from <a> tags
      const playerLinks = row.match(/<a[^>]*href=['"]playerinfo\.aspx\?i=\d+['"][^>]*>([^<]+)<\/a>/gi) || [];
      
      if (playerLinks.length >= 2 && playerLinks[0] && playerLinks[1]) {
        // Two players - determine which column is our team
        const player1Match = playerLinks[0].match(/>([^<]+)</);
        const player2Match = playerLinks[1].match(/>([^<]+)</);
        
        if (player1Match && player2Match) {
          const player1 = player1Match[1].trim();
          const player2 = player2Match[1].trim();
          
          // Basic validation: check if player names look reasonable
          const p1Valid = player1.length >= 2 && /[a-z]/i.test(player1);
          const p2Valid = player2.length >= 2 && /[a-z]/i.test(player2);
          
          if (!p1Valid && !p2Valid) {
            addLog(`⚠️ Position ${position}: Both players invalid - skipping`);
            continue;
          }
          
          // Select the correct player
          const selection = selectCorrectPlayer(
            p1Valid ? player1 : '',
            p2Valid ? player2 : '',
            position
          );
          
          // If selection is null, it means neither player is on the roster - skip this position
          if (!selection) {
            addLog(`⚠️ Position ${position}: Skipped - no player matches team roster`);
            continue;
          }
          
          if (!selection.player || selection.player.length < 2) {
            addLog(`⚠️ Position ${position}: No valid player selected - skipping`);
            continue;
          }
          
          // Determine verification status
          const rowIsVerified = row.includes("class='verified'") ||
                               row.includes('class="verified"') ||
                               row.includes('verified') ||
                               row.match(/class=['"]verified['"]/i) !== null;
          
          const isVerified = isVerifiedSection || (rowIsVerified && !isProjectedSection);
          const isProjected = !isVerified;
          
          positionToPlayer.set(position, {
            name: selection.player,
            isVerified,
            isProjected,
            confidence: selection.confidence
          });
          
          foundPositions.add(position);
          addLog(`✅ Position ${position}: Selected "${selection.player}" (${selection.column}, confidence: ${selection.confidence})`);
        }
      } else if (playerLinks.length === 1) {
        // Only one player - use it if it's in our team's context
        const playerMatch = playerLinks[0].match(/>([^<]+)</);
        if (playerMatch) {
          const playerName = playerMatch[1].trim();
          const rowContext = gameTableHtml.substring(
            Math.max(0, gameTableHtml.indexOf(row) - 500),
            Math.min(gameTableHtml.length, gameTableHtml.indexOf(row) + row.length + 500)
          );
          
          if (rowContext.toUpperCase().includes(teamUpper) || isPlayerOnRoster(playerName)) {
            const rowIsVerified = row.includes("class='verified'") ||
                              row.includes('class="verified"') ||
                              row.includes('verified') ||
                              rowContext.includes('Verified Lineup') ||
                              rowContext.match(/class=['"]verified['"]/i) !== null;
            const isVerified = isVerifiedSection || (rowIsVerified && !isProjectedSection);
            
            positionToPlayer.set(position, {
              name: playerName,
              isVerified,
              isProjected: !isVerified,
              confidence: isPlayerOnRoster(playerName) ? 'high' : 'medium'
            });
            
            foundPositions.add(position);
            addLog(`✅ Position ${position}: Selected "${playerName}" (single player, confidence: ${isPlayerOnRoster(playerName) ? 'high' : 'medium'})`);
          }
        }
      }
    }
    
    // Second pass: Build starters array, ensuring we have all 5 positions
    const requiredPositions = ['PG', 'SG', 'SF', 'PF', 'C'];
    const starters: Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }> = [];
    
    for (const pos of requiredPositions) {
      const playerData = positionToPlayer.get(pos);
      if (playerData) {
        starters.push({
          name: playerData.name,
          position: pos,
          isVerified: playerData.isVerified,
          isProjected: playerData.isProjected
        });
      } else {
        // Missing position - try to find it from other rows or use fallback
        addLog(`⚠️ Position ${pos} not found in table - checking for alternatives...`);
        
        // Look for any row that might have this position but wasn't captured
        for (const row of tableRows) {
          const positionMatch = row.match(/<span[^>]*>(PG|SG|SF|PF|C)<\/span>/i);
          if (!positionMatch || positionMatch[1].toUpperCase() !== pos) continue;
          
          const playerLinks = row.match(/<a[^>]*href=['"]playerinfo\.aspx\?i=\d+['"][^>]*>([^<]+)<\/a>/gi) || [];
          if (playerLinks.length >= 1) {
            const playerMatch = playerLinks[0]?.match(/>([^<]+)</);
            if (playerMatch && playerMatch[1]) {
              const playerName = playerMatch[1].trim();
              // Use this player even if we're not 100% sure - better than missing a position
              addLog(`⚠️ Using fallback player "${playerName}" for position ${pos}`);
              starters.push({
                name: playerName,
                position: pos,
                isVerified: false,
                isProjected: true
              });
              break;
            }
          }
        }
        
        // If still no player found, we'll have fewer than 5 - log warning
        if (starters.length < requiredPositions.indexOf(pos) + 1) {
          addLog(`❌ CRITICAL: Position ${pos} could not be found - lineup will be incomplete`);
        }
      }
    }
    
    // Final validation: Ensure we have exactly 5 starters
    if (starters.length < 5) {
      addLog(`⚠️ WARNING: Only found ${starters.length} starters (expected 5)`);
      
      // Try one more time to find missing positions by re-scanning all rows
      const missingPositions = requiredPositions.filter(pos => 
        !starters.some(s => s.position === pos)
      );
      
      addLog(`Missing positions: ${missingPositions.join(', ')}`);
      
      // For each missing position, try to find ANY player from that row
      for (const missingPos of missingPositions) {
        for (const row of tableRows) {
          const positionMatch = row.match(/<span[^>]*>(PG|SG|SF|PF|C)<\/span>/i);
          if (!positionMatch || positionMatch[1].toUpperCase() !== missingPos) continue;
          
          // Try both columns if available
          const playerLinks = row.match(/<a[^>]*href=['"]playerinfo\.aspx\?i=\d+['"][^>]*>([^<]+)<\/a>/gi) || [];
          
          if (playerLinks.length >= 2 && playerLinks[0] && playerLinks[1]) {
            // Try both players - use the one that's on roster, or default to home/away logic
            const p1Match = playerLinks[0].match(/>([^<]+)</);
            const p2Match = playerLinks[1].match(/>([^<]+)</);
            
            if (p1Match && p1Match[1] && p2Match && p2Match[1]) {
              const p1 = p1Match[1].trim();
              const p2 = p2Match[1].trim();
              
              // Use the one that's on roster, or default to home/away
              const p1OnRoster = isPlayerOnRoster(p1);
              const p2OnRoster = isPlayerOnRoster(p2);
              
              let selectedPlayer = '';
              if (p1OnRoster && !p2OnRoster) {
                selectedPlayer = p1;
              } else if (p2OnRoster && !p1OnRoster) {
                selectedPlayer = p2;
              } else {
                // Both or neither - use home/away logic
                selectedPlayer = isHomeTeam ? p2 : p1;
              }
              
              if (selectedPlayer && selectedPlayer.length >= 2) {
                addLog(`✅ Found fallback player "${selectedPlayer}" for missing position ${missingPos}`);
                starters.push({
                  name: selectedPlayer,
                  position: missingPos,
                  isVerified: false,
                  isProjected: true
                });
                break;
              }
            }
          } else if (playerLinks.length === 1) {
            const playerMatch = playerLinks[0].match(/>([^<]+)</);
            if (playerMatch) {
              const playerName = playerMatch[1].trim();
              if (playerName.length >= 2) {
                addLog(`✅ Found fallback player "${playerName}" for missing position ${missingPos}`);
                starters.push({
                  name: playerName,
                  position: missingPos,
                  isVerified: false,
                  isProjected: true
                });
                break;
              }
            }
          }
        }
      }
    }
    
    // Final check - if we still don't have 5, log error but return what we have
    if (starters.length < 5) {
      addLog(`❌ CRITICAL ERROR: Only ${starters.length} starters found after all attempts (expected 5)`);
      addLog(`   This may indicate: wrong game, incorrect HTML structure, or BasketballMonster data issue`);
      addLog(`   Returning ${starters.length} starters: ${starters.map(s => `${s.position}:${s.name}`).join(', ')}`);
    } else if (starters.length === 5) {
      addLog(`✅ SUCCESS: Found all 5 starters`);
    } else {
      addLog(`⚠️ WARNING: Found ${starters.length} starters (more than expected 5) - taking first 5`);
      starters.splice(5);
    }
    
    // Ensure we have exactly 5 positions (no duplicates)
    const finalStarters: Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }> = [];
    const usedPositions = new Set<string>();
    
    for (const starter of starters) {
      if (!usedPositions.has(starter.position)) {
        finalStarters.push(starter);
        usedPositions.add(starter.position);
      } else {
        addLog(`⚠️ Skipping duplicate position ${starter.position} (already have ${finalStarters.find(s => s.position === starter.position)?.name})`);
      }
    }
    
    // CRITICAL VALIDATION: Verify that the extracted players actually belong to the requested team
    // This prevents caching wrong team's lineup
    if (finalStarters.length === 5 && teamRoster && teamRoster.size > 0) {
      const playersOnRoster = finalStarters.filter(starter => {
        const normalized = normName(starter.name);
        const nameParts = normalized.split(' ');
        const lastName = nameParts[nameParts.length - 1];
        return teamRoster.has(normalized) || teamRoster.has(lastName);
      });
      
      const rosterMatchCount = playersOnRoster.length;
      const rosterMatchPercent = (rosterMatchCount / 5) * 100;
      
      addLog(`🔍 Roster validation: ${rosterMatchCount}/5 players match ${teamAbbr} roster (${rosterMatchPercent.toFixed(0)}%)`);
      addLog(`   Players: ${finalStarters.map(s => s.name).join(', ')}`);
      addLog(`   Matches: ${playersOnRoster.map(s => s.name).join(', ')}`);
      
      // Require at least 2 out of 5 players to be on the roster (40% match)
      // This is very lenient because roster data might be incomplete or names might not match exactly
      // But still strict enough to catch completely wrong team assignments
      if (rosterMatchCount < 2) {
        addLog(`❌ REJECTED: Only ${rosterMatchCount}/5 players match ${teamAbbr} roster - this appears to be the wrong team's lineup!`);
        addLog(`   Expected team: ${teamAbbr}`);
        addLog(`   Extracted players: ${finalStarters.map(s => s.name).join(', ')}`);
        addLog(`   Matched players: ${playersOnRoster.map(s => s.name).join(', ')}`);
        addLog(`   Roster size: ${teamRoster.size} normalized names`);
        // Log sample roster names for debugging
        if (process.env.NODE_ENV !== 'production') {
          const sampleRoster = Array.from(teamRoster).slice(0, 10);
          addLog(`   Sample roster names: ${sampleRoster.join(', ')}`);
        }
        addLog(`   This lineup will NOT be cached to prevent wrong team assignment`);
        return []; // Return empty array - don't cache wrong team's lineup
      }
      
      // If 2-3 players match, log a warning but still accept
      if (rosterMatchCount < 4) {
        addLog(`⚠️ WARNING: Only ${rosterMatchCount}/5 players match ${teamAbbr} roster (${rosterMatchPercent.toFixed(0)}%)`);
        addLog(`   This might indicate roster issues, name variations, or recent trades, but accepting lineup`);
      }
      
      addLog(`✅ VALIDATED: ${rosterMatchCount}/5 players confirmed on ${teamAbbr} roster - lineup is correct`);
    } else if (finalStarters.length === 5 && (!teamRoster || teamRoster.size === 0)) {
      addLog(`⚠️ WARNING: Cannot validate roster (roster not available) - caching lineup anyway`);
      addLog(`   This may result in wrong team assignment if roster validation fails`);
    }
    
    // Cache the result (24 hour TTL) - only if validation passed
    if (finalStarters.length === 5) {
      await setNBACache(cacheKey, 'basketballmonsters_lineup', finalStarters, 24 * 60);
      const verifiedCount = finalStarters.filter(s => s.isVerified).length;
      const projectedCount = finalStarters.filter(s => s.isProjected).length;
      addLog(`✅ Cached ${finalStarters.length} starters for ${teamAbbr} (${verifiedCount} verified, ${projectedCount} projected): ${finalStarters.map(s => `${s.position}:${s.name}`).join(', ')}`);
    } else {
      addLog(`❌ No starters found for ${teamAbbr} - cannot cache`);
    }
    
    return finalStarters;
    
  } catch (e: any) {
    addLog(`❌ Error scraping: ${e.message}`);
    addLog(`Stack: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`);
    console.error(`[BasketballMonsters] Error scraping ${date}:`, e.message);
    return [];
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

