/**
 * BasketballMonsters lineup scraping utilities
 * Extracted from route file to allow sharing across API routes
 */

import { getNBACache, setNBACache } from '@/lib/nbaCache';

const BDL_BASE = 'https://api.balldontlie.io/v1';

function getBdlApiKey(): string {
  const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY;
  if (!apiKey) {
    throw new Error('BALLDONTLIE_API_KEY environment variable is required');
  }
  return apiKey;
}

function getBdlHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    'User-Agent': 'StatTrackr/1.0',
    Authorization: `Bearer ${getBdlApiKey()}`,
  };
}

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
  'NO': 'NOP',   // New Orleans (short)
  'NOR': 'NOP',  // New Orleans (full)
  'NY': 'NYK',   // New York
  'SA': 'SAS',   // San Antonio
  'UTAH': 'UTA', // Utah
  'WSH': 'WAS',  // Washington
};

// Reverse mapping: standard abbreviations to BasketballMonsters abbreviations
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
  const res = await fetch(url, { headers: getBdlHeaders(), cache: 'no-store' });
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

export async function scrapeBasketballMonstersLineupForDate(
  date: string,
  teamAbbr: string,
  bypassCache: boolean = false,
  expectedOpponent?: string | null,
  teamRoster?: Set<string>
): Promise<Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }>> {
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
  // Use Eastern Time to match BasketballMonsters (they use Eastern Time)
  const now = new Date();
  const easternTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const today = new Date(easternTime);
  today.setHours(0, 0, 0, 0);
  today.setMinutes(0, 0, 0);
  today.setSeconds(0, 0);
  today.setMilliseconds(0);
  
  // Parse target date string (YYYY-MM-DD format)
  const targetDateParts = date.split('-');
  const year = parseInt(targetDateParts[0]);
  const month = parseInt(targetDateParts[1]) - 1; // 0-indexed
  const day = parseInt(targetDateParts[2]);
  
  // Create target date in Eastern Time
  const targetDate = new Date(year, month, day, 0, 0, 0, 0);
  
  const daysDiff = Math.floor((today.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
  
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const targetDateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
  addLog(`Date calculation (Eastern Time): target=${date}, today=${todayStr}, targetDate=${targetDateStr}, daysDiff=${daysDiff}`);
  
  // ONLY scrape today and future games - skip past games
  if (daysDiff > 0) {
    // Only log in development
    if (process.env.NODE_ENV !== 'production') {
      addLog(`⚠️ Skipping past date (${daysDiff} days ago) - only scraping today and future games`);
      addLog(`   Past game starters should be manually fixed in DvP store`);
    }
    return [];
  }
  
  // Allow today and tomorrow (BasketballMonsters shows tomorrow's games if no games today)
  // Skip dates more than 1 day in the future
  if (daysDiff < -1) {
    // Only log in development
    if (process.env.NODE_ENV !== 'production') {
      addLog(`⚠️ Skipping future date (${Math.abs(daysDiff)} days ahead) - only today and tomorrow's games are available on BasketballMonsters`);
    }
    return [];
  }
  
  // For tomorrow's games, BasketballMonsters shows them on the main page
  if (daysDiff === -1) {
    addLog(`📅 Tomorrow's game - BasketballMonsters should show this on main page`);
  }
  
  let html = '';
  
  try {
    // For today and tomorrow, use direct fetch (main page shows these games)
    addLog(`${daysDiff === 0 ? "Today's" : daysDiff === -1 ? "Tomorrow's" : "Future"} date - attempting direct fetch...`);
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
      // Note: Some teams use 2-letter abbreviations (GS, NO) or 3-letter (NOR) so we need word boundaries
      const standardPattern = new RegExp(`\\b${teamUpper}\\b\\s*@|@\\s*\\b${teamUpper}\\b`, 'i');
      const bmPattern = new RegExp(`\\b${bmAbbr}\\b\\s*@|@\\s*\\b${bmAbbr}\\b`, 'i');
      // For NOP, also check NOR (BasketballMonsters uses NOR in matchup strings, not just NO)
      const norPattern = teamUpper === 'NOP' ? new RegExp(`\\bNOR\\b\\s*@|@\\s*\\bNOR\\b`, 'i') : null;
      const hasGame = html.match(standardPattern) || html.match(bmPattern) || (norPattern && html.match(norPattern));
      
      if (hasGame && teamUpper === 'NOP') {
        addLog(`✅ Found NOP game using ${html.match(norPattern!) ? 'NOR' : html.match(bmPattern) ? 'NO' : 'NOP'} abbreviation`);
      }
      
      if (hasGame) {
        addLog(`✅ Found ${teamAbbr} game on main page (checked ${teamUpper} and ${bmAbbr}) - will parse directly`);
      } else {
        // Only log detailed debug info if we're in development or if this is unexpected
        // (e.g., if the team should have a game today but isn't on the page)
        const anyGameMatch = html.match(/([A-Z]{2,3})\s*@\s*([A-Z]{2,3})/gi);
        if (anyGameMatch && anyGameMatch.length > 0) {
          // Team has games scheduled but not on BasketballMonsters page yet - this is expected for tomorrow's games
          // Only log in development to reduce console spam
          if (process.env.NODE_ENV !== 'production') {
            addLog(`⚠️ ${teamAbbr} game not found on main page (checked ${teamUpper} and ${bmAbbr})`);
            addLog(`   Found ${anyGameMatch.length} total game matchups on page: ${anyGameMatch.slice(0, 5).join(', ')}`);
            const teamInHtml = html.includes(teamUpper) || html.includes(bmAbbr);
            addLog(`   Team ${teamUpper} or ${bmAbbr} appears in HTML: ${teamInHtml}`);
          }
        } else {
          // No games at all on page - this might be an error
          addLog(`❌ No game matchups found in HTML at all - page structure may have changed`);
        }
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
    // Note: Some teams use 2-letter abbreviations (GS, NO) so we need to match both 2 and 3 letters
    const allGameMatches = Array.from(html.matchAll(/([A-Z]{2,3})\s*@\s*([A-Z]{2,3})/gi));
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
      
      // Must include our team (check both normalized and raw for NOP/NOR case)
      const team1Matches = team1 === teamUpper || (teamUpper === 'NOP' && (team1Raw === 'NOR' || team1Raw === 'NO'));
      const team2Matches = team2 === teamUpper || (teamUpper === 'NOP' && (team2Raw === 'NOR' || team2Raw === 'NO'));
      
      if (!team1Matches && !team2Matches) {
        continue; // Skip this matchup - doesn't include our team
      }
      
      // If we have expected opponent, check if it matches (using normalized abbreviations)
      // But don't skip if opponent doesn't match - BasketballMonsters might have more accurate schedule
      if (gameInfo.opponent) {
        const opponentUpper = gameInfo.opponent.toUpperCase();
        const normalizedOpponent = normalizeTeamAbbr(opponentUpper);
        const hasOpponent = team1 === normalizedOpponent || team2 === normalizedOpponent;
        
        if (!hasOpponent) {
          // Only log in development - opponent mismatch is expected sometimes (BM schedule may differ from BDL)
          if (process.env.NODE_ENV !== 'production') {
            addLog(`⚠️ WARNING: Matchup ${match[0]} (normalized: ${team1} @ ${team2}) doesn't match expected opponent ${gameInfo.opponent} (normalized: ${normalizedOpponent})`);
            addLog(`   Using BasketballMonsters matchup anyway (BM schedule may be more accurate)`);
          }
          // Don't skip - continue with this matchup
        } else {
          // Only log successful matches in development
          if (process.env.NODE_ENV !== 'production') {
            addLog(`✅ Matchup ${match[0]} (normalized: ${team1} @ ${team2}) matches expected opponent ${gameInfo.opponent}`);
          }
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
    const nextGameMatch = afterMatchup.match(/([A-Z]{2,3})\s*@\s*([A-Z]{2,3})/i);
    
    if (nextGameMatch && nextGameMatch.index !== undefined) {
      boxEnd = Math.min(boxEnd, matchupIndex + targetGameMatch[0].length + nextGameMatch.index);
    }
    
    const teamSection = html.substring(boxStart, boxEnd);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[BasketballMonsters] Isolated game box for ${teamAbbr}: ${boxEnd - boxStart} chars`);
    }
    
    // Find the table within the game box
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
    const contextBefore = html.substring(Math.max(0, boxStart - 15000), boxStart);
    const contextAfter = html.substring(boxEnd, Math.min(html.length, boxEnd + 5000));
    const fullContext = contextBefore + teamSection + contextAfter;
    
    // Look for various indicators of verified/projected status
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

// Export function to get debug logs for a specific team/date
export function getDebugLogs(teamAbbr: string, date: string): string[] {
  const logKey = `${teamAbbr}:${date}`;
  return debugLogs.get(logKey) || [];
}
