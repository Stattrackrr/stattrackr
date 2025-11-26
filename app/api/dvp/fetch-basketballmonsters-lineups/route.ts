/**
 * Fetch starting lineups from BasketballMonster.com
 * Has historical games via back/next buttons, shows both projected and verified lineups
 * Caches results in Supabase for instant subsequent requests
 * 
 * Usage: /api/dvp/fetch-basketballmonsters-lineups?team=MIL&season=2025
 */

import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { getNBACache, setNBACache } from '@/lib/nbaCache';

// Puppeteer requires Node.js runtime
export const runtime = "nodejs";
export const maxDuration = 60;

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
        roster.add(normName(fullName));
        // Also add last name only for matching
        roster.add(normName(lastName));
      }
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

async function scrapeBasketballMonstersLineupForDate(date: string, teamAbbr: string, bypassCache: boolean = false, expectedOpponent?: string | null, teamRoster?: Set<string>): Promise<Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }>> {
  const logKey = `${teamAbbr}:${date}`;
  if (!debugLogs.has(logKey)) {
    debugLogs.set(logKey, []);
  }
  const logs = debugLogs.get(logKey)!;
  
  const addLog = (msg: string) => {
    logs.push(`[${date}] ${msg}`);
    console.log(`[BasketballMonsters] ${msg}`);
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
  const targetDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  targetDate.setHours(0, 0, 0, 0);
  const daysDiff = Math.floor((today.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
  
  addLog(`Date calculation: target=${date}, today=${today.toISOString().split('T')[0]}, daysDiff=${daysDiff}`);
  
  let html = '';
  let browser: any = null;
  
  try {
    // For today (daysDiff === 0) or very recent dates (daysDiff <= 2), try direct fetch first
    // BasketballMonster's main page might show recent games
    // For older dates (daysDiff > 2), always use Puppeteer
    const useDirectFetch = daysDiff <= 2;
    
    if (useDirectFetch) {
      // For today or recent dates, try direct fetch first
      addLog(`${daysDiff === 0 ? "Today's" : `Recent (${daysDiff} days ago)`} date - attempting direct fetch first...`);
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
        const teamUpper = teamAbbr.toUpperCase();
        const hasGame = html.match(new RegExp(`${teamUpper}\\s*@|@\\s*${teamUpper}`, 'i'));
        if (hasGame) {
          addLog(`✅ Found ${teamAbbr} game on main page - will parse directly`);
          // For recent dates, the main page might show today's game, not the target date
          // We'll validate the opponent later to ensure we got the right game
        } else {
          addLog(`⚠️ ${teamAbbr} game not found on main page - will need Puppeteer`);
          html = ''; // Clear HTML so we fall through to Puppeteer
        }
      } catch (e: any) {
        addLog(`Direct fetch failed: ${e.message}, will try Puppeteer`);
        // Fall through to Puppeteer
      }
    } else {
      addLog(`Historical date (${daysDiff} days ago) - must use Puppeteer to navigate to correct date`);
    }
    
    // Use Puppeteer for historical dates or if direct fetch failed
    if (!html) {
      addLog(`Historical date (${daysDiff} days ago) - using Puppeteer to navigate`);
      
      // Retry Puppeteer up to 3 times
      let retries = 3;
      let lastError: any = null;
      
      while (retries > 0 && !html) {
        try {
          addLog(`🚀 Launching Puppeteer... (${4 - retries}/3 attempts)`);
          
          // More robust Puppeteer launch options
          browser = await puppeteer.launch({
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--disable-gpu',
              '--no-first-run',
              '--disable-extensions',
              '--disable-background-networking',
              '--disable-background-timer-throttling',
              '--disable-renderer-backgrounding',
              '--disable-backgrounding-occluded-windows',
              '--disable-breakpad',
              '--disable-component-extensions-with-background-pages',
              '--disable-features=TranslateUI',
              '--disable-ipc-flooding-protection',
              '--disable-hang-monitor',
              '--disable-prompt-on-repost',
              '--disable-sync',
              '--metrics-recording-only',
              '--no-default-browser-check',
              '--no-first-run',
              '--safebrowsing-disable-auto-update',
              '--enable-automation',
              '--password-store=basic',
              '--use-mock-keychain',
              '--single-process'
            ],
            timeout: 60000, // Increased timeout
            protocolTimeout: 120000 // Protocol timeout
          });
          
          addLog(`✅ Puppeteer launched successfully`);
          
          const page = await browser.newPage();
          
          // Set longer timeouts
          page.setDefaultNavigationTimeout(120000);
          page.setDefaultTimeout(120000);
          
          // Set viewport
          await page.setViewport({ width: 1920, height: 1080 });
          
          // Set user agent to avoid bot detection
          await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
          
          const url = `https://basketballmonster.com/nbalineups.aspx`;
          addLog(`Navigating to ${url}...`);
          
          // Navigate with retry logic
          try {
            await page.goto(url, { 
              waitUntil: 'networkidle0', // Changed to networkidle0 for more reliable loading
              timeout: 120000 
            });
            addLog(`Page loaded successfully`);
          } catch (navError: any) {
            addLog(`Navigation warning: ${navError.message}, continuing anyway...`);
            // Continue even if navigation has warnings
          }
          
          // Wait for page to be ready
          await page.waitForTimeout(2000);
          
          // Click "back" the appropriate number of times
          addLog(`Navigating ${daysDiff} days back...`);
          for (let i = 0; i < daysDiff; i++) {
            try {
              addLog(`Looking for back button (attempt ${i + 1}/${daysDiff})...`);
              
              // Wait for page to be interactive
              await page.waitForSelector('a', { timeout: 10000 }).catch(() => {
                addLog(`No links found, page may not be loaded`);
              });
              
              const clicked = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const backLink = links.find(a => {
                  const text = a.textContent?.toLowerCase() || '';
                  return text.includes('back') && !text.includes('background');
                });
                if (backLink) {
                  (backLink as HTMLElement).click();
                  return true;
                }
                return false;
              });
              
              if (clicked) {
                addLog(`Clicked back button`);
                // Wait for navigation to complete
                await page.waitForTimeout(4000); // Increased wait time
                // Wait for network to be idle (Puppeteer doesn't have waitForLoadState)
                await page.waitForTimeout(2000);
              } else {
                addLog(`Back button not found on attempt ${i + 1}`);
                // Try to continue anyway - maybe we're already at the target date
                break;
              }
            } catch (e: any) {
              addLog(`Error clicking back (attempt ${i + 1}): ${e.message}`);
              // Continue to next iteration
            }
          }
          
          // Final wait for page to stabilize
          await page.waitForTimeout(3000);
          
          // Get HTML content
          html = await page.content();
          addLog(`Got HTML via Puppeteer: ${html.length} characters`);
          
          // Verify we got valid HTML
          if (html && html.length > 1000 && html.includes(teamAbbr.toUpperCase())) {
            addLog(`✅ Successfully retrieved HTML for historical date`);
            break; // Success, exit retry loop
          } else {
            throw new Error(`HTML too short or doesn't contain team: ${html?.length || 0} chars`);
          }
          
        } catch (e: any) {
          lastError = e;
          addLog(`❌ Puppeteer attempt failed: ${e.message}`);
          retries--;
          
          // Close browser if it exists
          if (browser) {
            try {
              await browser.close();
            } catch (closeError: any) {
              addLog(`Error closing browser: ${closeError.message}`);
            }
            browser = null;
          }
          
          if (retries > 0) {
            const waitTime = (4 - retries) * 2000; // Exponential backoff: 2s, 4s, 6s
            addLog(`Retrying in ${waitTime}ms... (${retries} attempts remaining)`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
      }
      
      // Final cleanup
      if (browser) {
        try {
          await browser.close();
          addLog(`Browser closed`);
        } catch (closeError: any) {
          addLog(`Error closing browser: ${closeError.message}`);
        }
      }
      
      if (!html && lastError) {
        // Don't throw - let it fall through to return empty array
        // The caller will track this as a skipped game
        addLog(`⚠️ All Puppeteer retries failed: ${lastError.message}`);
        addLog(`⚠️ This game will be skipped. Puppeteer connection issues may be due to serverless environment limitations.`);
        addLog(`💡 Tip: For dates within 2 days, direct fetch is used (no Puppeteer needed).`);
      }
    }
    
    if (!html) {
      addLog(`❌ No HTML obtained - cannot scrape lineup for this date`);
      addLog(`This game will be skipped. Try again later or check if Puppeteer is available.`);
      return [];
    }
    const teamUpper = teamAbbr.toUpperCase();
    const starters: Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }> = [];
    
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
    const targetDateStr = formatDate(date);
    const datePatterns = [
      new RegExp(targetDateStr.replace(/\//g, '[/-]'), 'i'), // Match "11/26/2025" or "11-26-2025"
      new RegExp(String(new Date(date).getDate()), 'i'), // Match day of month
    ];
    const hasDateMatch = datePatterns.some(pattern => pattern.test(html.substring(0, 50000))); // Check first 50k chars
    if (daysDiff > 0 && !hasDateMatch) {
      addLog(`⚠️ WARNING: Page may not be for target date ${targetDateStr} (daysDiff=${daysDiff})`);
      addLog(`This could mean Puppeteer navigation failed or page shows wrong date`);
    }
    
    // Find all game matchups on the page
    // Format: "MIL @ MIA" means MIL (away) @ MIA (home)
    // BasketballMonster typically shows HOME team in first column, AWAY team in second column
    const allGameMatches = Array.from(html.matchAll(/([A-Z]{3})\s*@\s*([A-Z]{3})/gi));
    let targetGameMatch: RegExpMatchArray | null = null;
    let matchupIndex = -1;
    let isFirstTeam = false; // Track if our team is the first team in the matchup string
    let isHomeTeam = false; // Track if our team is the home team (first column in table)
    
    // Find the matchup that includes our team
    // If we have expected opponent, prefer matches that include the opponent, but don't skip if not found
    for (const match of allGameMatches) {
      const team1 = match[1].toUpperCase(); // Away team (first in "TEAM1 @ TEAM2")
      const team2 = match[2].toUpperCase(); // Home team (second in "TEAM1 @ TEAM2")
      
      // Must include our team
      if (team1 !== teamUpper && team2 !== teamUpper) {
        continue; // Skip this matchup - doesn't include our team
      }
      
      // If we have expected opponent, validate but only warn (don't skip)
      if (gameInfo.opponent) {
        const hasOpponent = team1 === gameInfo.opponent || team2 === gameInfo.opponent;
        if (!hasOpponent) {
          addLog(`⚠️ WARNING: Matchup ${match[0]} doesn't match expected opponent ${gameInfo.opponent}, but continuing anyway`);
        } else {
          addLog(`✅ Matchup ${match[0]} matches expected opponent ${gameInfo.opponent}`);
        }
      }
      
      if (team1 === teamUpper) {
        targetGameMatch = match;
        matchupIndex = match.index || -1;
        isFirstTeam = true; // Our team is first in matchup string (away team)
        isHomeTeam = false; // Away team is in second column
        break;
      } else if (team2 === teamUpper) {
        targetGameMatch = match;
        matchupIndex = match.index || -1;
        isFirstTeam = false; // Our team is second in matchup string (home team)
        isHomeTeam = true; // Home team is in first column
        break;
      }
    }
    
    if (!targetGameMatch || matchupIndex === -1) {
      addLog(`❌ No game found with team ${teamAbbr} on ${date}`);
      addLog(`   Searched for: ${teamUpper}`);
      addLog(`   Found ${allGameMatches.length} game matchups on page`);
      if (allGameMatches.length > 0) {
        const sampleMatches = allGameMatches.slice(0, 5).map(m => m[0]).join(', ');
        addLog(`   Sample matchups found: ${sampleMatches}`);
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
    console.log(`[BasketballMonsters] Isolated game box for ${teamAbbr}: ${boxEnd - boxStart} chars`);
    
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
    
    // Also need to determine which column is our team
    // BasketballMonster has two columns - we need to figure out which one
    // Look for team name indicators in the table structure
    const teamColumnIndex = gameTableHtml.toUpperCase().indexOf(teamUpper);
    
    for (const row of tableRows) {
      // Extract position from <span>PG</span> or <span>SG</span> etc.
      const positionMatch = row.match(/<span[^>]*>(PG|SG|SF|PF|C)<\/span>/i);
      if (!positionMatch) continue;
      
      const position = positionMatch[1].toUpperCase();
      if (foundPositions.has(position)) continue;
      
      // Extract player names from <a> tags
      const playerLinks = row.match(/<a[^>]*href=['"]playerinfo\.aspx\?i=\d+['"][^>]*>([^<]+)<\/a>/gi) || [];
      
      if (playerLinks.length >= 2 && playerLinks[0] && playerLinks[1]) {
        // Two players - determine which column is our team
        const player1Match = playerLinks[0].match(/>([^<]+)</);
        const player2Match = playerLinks[1].match(/>([^<]+)</);
        
        if (player1Match && player2Match) {
          const player1 = player1Match[1].trim();
          const player2 = player2Match[1].trim();
          
          // Determine which column is our team based on home/away
          // BasketballMonster shows: first column = HOME team, second column = AWAY team
          // If our team is home (second in "MIA @ MIL"), we want player1 (first column = HOME)
          // If our team is away (first in "MIL @ MIA"), we want player2 (second column = AWAY)
          // BUT WAIT - the logs show player1 is AWAY and player2 is HOME, so it's reversed!
          // Actually: player1 = AWAY, player2 = HOME (opposite of what we thought)
          // So: if our team is away, we want player1; if our team is home, we want player2
          const selectedPlayer = isHomeTeam ? player2 : player1;
          
          // Debug: Log the selection
          addLog(`Position ${position}: player1="${player1}" (${isHomeTeam ? 'HOME' : 'AWAY'}), player2="${player2}" (${isHomeTeam ? 'AWAY' : 'HOME'}), selected="${selectedPlayer}" (isHomeTeam=${isHomeTeam})`);
          
          // Validate: Check if selected player actually belongs to the team
          if (selectedPlayer) {
            // Basic validation: check if player name looks reasonable (not empty, has letters)
            const playerNameLower = selectedPlayer.toLowerCase().trim();
            if (playerNameLower.length < 2 || !/[a-z]/.test(playerNameLower)) {
              addLog(`⚠️ WARNING: Invalid player name "${selectedPlayer}" - skipping`);
              continue;
            }
            
            // Validate against team roster if available
            if (teamRoster && teamRoster.size > 0) {
              const normalizedPlayer = normName(selectedPlayer);
              const nameParts = normalizedPlayer.split(' ');
              const lastName = nameParts[nameParts.length - 1];
              
              const isOnRoster = teamRoster.has(normalizedPlayer) || teamRoster.has(lastName);
              
              if (!isOnRoster) {
                addLog(`⚠️ WARNING: Player "${selectedPlayer}" (normalized: "${normalizedPlayer}") NOT found in ${teamAbbr} roster`);
                addLog(`   This might indicate wrong column selection or incorrect data from BasketballMonster`);
                // Don't skip - BasketballMonster might have correct data that roster doesn't have yet
              } else {
                addLog(`✅ Player "${selectedPlayer}" validated against ${teamAbbr} roster`);
              }
            }
            
            // Log selection
            if (gameInfo.opponent) {
              addLog(`Selected player "${selectedPlayer}" for ${teamAbbr} vs ${gameInfo.opponent}`);
            }
          }
          
          // Use the section-level verification status (determined above)
          // Individual rows may also have indicators, but section-level is more reliable
          const rowIsVerified = row.includes("class='verified'") ||
                               row.includes('class="verified"') ||
                               row.includes('verified') ||
                               row.match(/class=['"]verified['"]/i) !== null;
          
          // Prefer section-level status, but allow row-level override
          // If section is unknown, default to projected (most lineups are projected)
          const isVerified = isVerifiedSection || (rowIsVerified && !isProjectedSection);
          const isProjected = !isVerified;
          
          starters.push({
            name: selectedPlayer,
            position: position,
            isVerified: isVerified,
            isProjected: isProjected
          });
          
          foundPositions.add(position);
          
          if (starters.length === 5) break;
        }
      } else if (playerLinks.length === 1) {
        // Only one player - check if it's in our team's context
        const playerMatch = playerLinks[0].match(/>([^<]+)</);
        if (playerMatch) {
          const playerName = playerMatch[1].trim();
          const rowContext = gameTableHtml.substring(
            Math.max(0, gameTableHtml.indexOf(row) - 500),
            Math.min(gameTableHtml.length, gameTableHtml.indexOf(row) + row.length + 500)
          );
          
          if (rowContext.toUpperCase().includes(teamUpper)) {
            const rowIsVerified = row.includes("class='verified'") ||
                              row.includes('class="verified"') ||
                              row.includes('verified') ||
                              rowContext.includes('Verified Lineup') ||
                              rowContext.match(/class=['"]verified['"]/i) !== null;
            const isVerified = isVerifiedSection || (rowIsVerified && !isProjectedSection);
            starters.push({
              name: playerName,
              position: position,
              isVerified: isVerified,
              isProjected: !isVerified
            });
            foundPositions.add(position);
          }
        }
      }
    }
    
    // Cache the result (24 hour TTL)
    if (starters.length > 0) {
      await setNBACache(cacheKey, 'basketballmonsters_lineup', starters, 24 * 60);
      const verifiedCount = starters.filter(s => s.isVerified).length;
      const projectedCount = starters.filter(s => s.isProjected).length;
      addLog(`Cached ${starters.length} starters (${verifiedCount} verified, ${projectedCount} projected): ${starters.map(s => s.name).join(', ')}`);
    } else {
      addLog(`No starters found for ${teamAbbr}`);
    }
    
    return starters;
    
  } catch (e: any) {
    if (browser) {
      try {
        await browser.close();
        addLog(`Browser closed`);
      } catch (closeError: any) {
        addLog(`Error closing browser: ${closeError.message}`);
      }
    }
    addLog(`❌ Error scraping: ${e.message}`);
    addLog(`Stack: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`);
    console.error(`[BasketballMonsters] Error scraping ${date}:`, e.message);
    return [];
  }
}

export async function GET(req: NextRequest) {
  console.log(`[BasketballMonsters] ===== API CALLED =====`);
  try {
    const { searchParams } = new URL(req.url);
    const teamAbbr = searchParams.get('team')?.toUpperCase();
    const seasonParam = searchParams.get('season');
    const season = seasonParam ? parseInt(seasonParam, 10) : 2025;
    const bypassCache = searchParams.get('bypassCache') === 'true';
    
    console.log(`[BasketballMonsters] Request params: team=${teamAbbr}, season=${season}, bypassCache=${bypassCache}`);
    
    if (!teamAbbr) {
      console.log(`[BasketballMonsters] ERROR: No team provided`);
      return NextResponse.json({ error: 'Team abbreviation required' }, { status: 400 });
    }
    
    const bdlTeamId = ABBR_TO_TEAM_ID_BDL[teamAbbr];
    if (!bdlTeamId) {
      console.log(`[BasketballMonsters] ERROR: Invalid team ${teamAbbr}`);
      return NextResponse.json({ error: `Invalid team: ${teamAbbr}` }, { status: 400 });
    }
    
    console.log(`[BasketballMonsters] Fetching lineups for ${teamAbbr} (season ${season}, BDL ID: ${bdlTeamId})...`);
    
    // Get games from BDL
    const gamesUrl = new URL(`${BDL_BASE}/games`);
    gamesUrl.searchParams.set('per_page', '100');
    gamesUrl.searchParams.append('seasons[]', String(season));
    gamesUrl.searchParams.append('team_ids[]', String(bdlTeamId));
    
    console.log(`[BasketballMonsters] Fetching games from: ${gamesUrl.toString()}`);
    
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
    console.log(`[BasketballMonsters] BDL returned ${games.length} games`);
    
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
    
    // Filter out future games (only process games that have already happened)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pastGames = games.filter((game: any) => {
      const gameDate = new Date(game.date);
      gameDate.setHours(0, 0, 0, 0);
      return gameDate <= today;
    });
    
    console.log(`[BasketballMonsters] Found ${games.length} total games, ${pastGames.length} past games, scraping lineups...`);
    
    if (pastGames.length === 0) {
      return NextResponse.json({
        team: teamAbbr,
        season,
        error: 'No past games found (all games are in the future)',
        players: [],
        debug: {
          messages: [`All ${games.length} games are in the future`, `Today: ${today.toISOString().split('T')[0]}`]
        }
      });
    }
    
    // Track positions per player
    const playerPositions = new Map<string, {
      name: string;
      positions: Record<string, { count: number; verifiedCount: number }>;
      totalGames: number;
    }>();
    
    // Get team roster for player validation
    console.log(`[BasketballMonsters] Fetching roster for ${teamAbbr}...`);
    const teamRoster = await getTeamRoster(teamAbbr, season);
    console.log(`[BasketballMonsters] Roster has ${teamRoster.size} players`);
    
    // Process games in reverse order (most recent first)
    // This ensures we process today's games first (direct fetch, fast)
    // Then work backwards through recent games
    // Note: Only games from today (daysDiff === 0) will work without Puppeteer
    const gamesToProcess = pastGames.slice().reverse().slice(0, 20);
    let processed = 0;
    let skipped = 0;
    
    for (const game of gamesToProcess) {
      const gameDate = game.date;
      
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
      
      try {
        const lineup = await scrapeBasketballMonstersLineupForDate(gameDate, teamAbbr, bypassCache, opponent);
        
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
              p.positions[starter.position] = { count: 0, verifiedCount: 0 };
            }
            p.positions[starter.position].count++;
            if (starter.isVerified) {
              p.positions[starter.position].verifiedCount++;
            }
            // Log verification status for debugging
            if (starter.isProjected) {
              console.log(`[BasketballMonsters] Game ${gameDate}: ${starter.name} (${starter.position}) is PROJECTED`);
            } else if (starter.isVerified) {
              console.log(`[BasketballMonsters] Game ${gameDate}: ${starter.name} (${starter.position}) is VERIFIED`);
            }
          }
          
          processed++;
        } else if (lineup.length > 0) {
          console.log(`[BasketballMonsters] Game ${gameDate}: Only found ${lineup.length} starters (expected 5)`);
          skipped++; // Count as skipped since we need exactly 5
        } else {
          // No lineup found - might be Puppeteer failure for historical dates
          console.log(`[BasketballMonsters] Game ${gameDate}: No lineup found (empty array returned)`);
          skipped++;
        }
        
        // Delay to avoid rate limiting
        if (processed < gamesToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (e: any) {
        console.error(`[BasketballMonsters] Error processing game ${gameDate}:`, e.message);
        console.error(`[BasketballMonsters] Stack:`, e.stack?.split('\n').slice(0, 3).join(' | '));
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
    
    if (playerPositions.size === 0) {
      return NextResponse.json({
        team: teamAbbr,
        season,
        gamesProcessed: processed,
        gamesSkipped: skipped,
        totalGames: games.length,
        error: `No starting lineups found. Processed ${processed} games, skipped ${skipped} games (likely Puppeteer failures for historical dates).`,
        players: [],
        debug: {
          messages: [`Processed ${processed} games, skipped ${skipped} games, found 0 players`],
          detailedLogs: allLogs.slice(0, 50),
          note: 'Check detailedLogs. Historical dates may fail due to Puppeteer issues - try processing only recent games.'
        }
      });
    }
    
    // Calculate most common position (prioritize verified lineups)
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

