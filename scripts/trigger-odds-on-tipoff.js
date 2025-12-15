/**
 * Script to trigger odds refresh when latest game tips off
 * Runs in GitHub Actions to avoid Vercel timeout issues
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_URL = process.env.PROD_URL || 'https://www.stattrackr.co';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
const LAST_TIPOFF_TRIGGER_KEY_PREFIX = 'odds-refresh-triggered-on-tipoff';

/**
 * Get today's date in US Eastern Time
 */
function getUSEasternDateString(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date).replace(/(\d+)\/(\d+)\/(\d+)/, (_, month, day, year) => {
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  });
}

/**
 * Get Eastern timezone offset in minutes for a given date
 */
function getEasternOffsetMinutes(date) {
  const jan = new Date(date.getFullYear(), 0, 1);
  const jul = new Date(date.getFullYear(), 6, 1);
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  const isDst = date.getTimezoneOffset() < stdOffset;
  const startDst = new Date(date.getFullYear(), 2, 14 - (1 + new Date(date.getFullYear(), 2, 1).getDay()) % 7);
  const endDst = new Date(date.getFullYear(), 10, 7 - (1 + new Date(date.getFullYear(), 10, 1).getDay()) % 7);
  const isDstActive = date >= startDst && date < endDst;
  return isDstActive ? -240 : -300; // minutes offset from UTC
}

/**
 * Parse tipoff time from BallDon'tLie game data (same logic as props page)
 */
function parseBallDontLieTipoff(game) {
  if (!game) return null;
  const iso = String(game?.date || '');
  if (!iso) return null;
  const status = String(game?.status || '');
  const datePart = iso.split('T')[0];
  if (!datePart) return null;

  const timeMatch = status.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
  if (!timeMatch) {
    const fallback = new Date(iso);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  let hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);
  const meridiem = timeMatch[3].toUpperCase();
  if (meridiem === 'PM' && hour !== 12) {
    hour += 12;
  } else if (meridiem === 'AM' && hour === 12) {
    hour = 0;
  }

  const baseDate = new Date(iso);
  const offsetMinutes = getEasternOffsetMinutes(baseDate);
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetMins = Math.abs(offsetMinutes) % 60;
  const offsetSign = offsetMinutes <= 0 ? '-' : '+';
  const offsetStr = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;

  const zonedIso = `${datePart}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offsetStr}`;
  const parsed = new Date(zonedIso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Calculate tipoff time for a game using the same logic as the props page
 */
function calculateTipoffTime(game) {
  if (!game) return null;
  
  const now = Date.now();
  let tipoffDate = null;
  
  // First, try to use the datetime field from the game object (most reliable)
  if (game.datetime) {
    const gameDateTime = new Date(game.datetime);
    if (!Number.isNaN(gameDateTime.getTime())) {
      tipoffDate = gameDateTime;
    }
  }
  
  // If that didn't work, check if status is a valid ISO timestamp
  if (!tipoffDate && game.status) {
    const statusTime = Date.parse(game.status);
    if (!Number.isNaN(statusTime)) {
      const parsedStatus = new Date(statusTime);
      // Check if it's at midnight (00:00:00) - if so, it's just a date placeholder, not the actual game time
      const isMidnight = parsedStatus.getUTCHours() === 0 && parsedStatus.getUTCMinutes() === 0 && parsedStatus.getUTCSeconds() === 0;
      
      // Use if NOT midnight and within reasonable range (not midnight means it's just a date, not actual game time)
      if (!isMidnight && parsedStatus.getTime() < now + (7 * 24 * 60 * 60 * 1000)) {
        tipoffDate = parsedStatus;
      }
    }
  }
  
  // Try to parse tipoff from status (this extracts time from status like "7:00 PM")
  if (!tipoffDate) {
    tipoffDate = parseBallDontLieTipoff(game);
    
    // If parseBallDontLieTipoff returned midnight UTC, it's likely just a date - try extracting time from status manually
    if (tipoffDate) {
      const isMidnight = tipoffDate.getUTCHours() === 0 && tipoffDate.getUTCMinutes() === 0 && tipoffDate.getUTCSeconds() === 0;
      if (isMidnight && game.status) {
        // Try to extract time from status string manually
        const timeMatch = game.status.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
        if (timeMatch) {
          const gameDateStr = game.date?.split('T')[0] || new Date().toISOString().split('T')[0];
          let hour = parseInt(timeMatch[1], 10);
          const minute = parseInt(timeMatch[2], 10);
          const meridiem = timeMatch[3].toUpperCase();
          if (meridiem === 'PM' && hour !== 12) hour += 12;
          else if (meridiem === 'AM' && hour === 12) hour = 0;
          
          // Create date with the game date and the parsed time (in local timezone)
          const baseDate = new Date(gameDateStr);
          const tipoff = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hour, minute, 0);
          
          // If this time has already passed, assume it's for tomorrow
          if (tipoff.getTime() <= now) {
            tipoff.setDate(tipoff.getDate() + 1);
          }
          
          tipoffDate = tipoff;
        } else {
          // No time in status, use date with 7:30 PM local time
          const dateStr = game.date?.split('T')[0] || '';
          if (dateStr) {
            const localDate = new Date(dateStr);
            localDate.setHours(19, 30, 0, 0); // 7:30 PM local
            if (localDate.getTime() <= now) {
              localDate.setDate(localDate.getDate() + 1);
            }
            tipoffDate = localDate;
          }
        }
      }
    }
  }
  
  // Last resort: use game.date with 7:30 PM local time
  if (!tipoffDate && game.date) {
    const dateStr = game.date.split('T')[0];
    if (dateStr) {
      const localDate = new Date(dateStr);
      localDate.setHours(19, 30, 0, 0); // 7:30 PM local
      if (localDate.getTime() <= now) {
        localDate.setDate(localDate.getDate() + 1);
      }
      tipoffDate = localDate;
    }
  }
  
  // Also try parsing from commenceTime (from odds cache)
  if (!tipoffDate && game.commenceTime) {
    const commenceStr = String(game.commenceTime).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      // Date-only string - use 7:30 PM ET as fallback
      const [y, m, d] = commenceStr.split('-').map(Number);
      const etDateStr = `${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}T19:30:00`;
      tipoffDate = new Date(etDateStr + '-05:00');
      if (m >= 3 && m <= 11) {
        tipoffDate = new Date(etDateStr + '-04:00');
      }
    } else {
      // Has time component - parse it
      tipoffDate = new Date(commenceStr);
    }
  }
  
  // Return the tipoff date if we found one (don't filter by future - we want the latest scheduled game)
  // The caller will determine if it's the latest among all games
  return tipoffDate;
}

/**
 * Get cache from Supabase
 */
async function getCache(key) {
  try {
    const { data, error } = await supabase
      .from('nba_api_cache')
      .select('data, expires_at, updated_at')
      .eq('cache_key', key)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    // Check if expired
    const expiresAt = new Date(data.expires_at);
    if (expiresAt < new Date()) {
      return null;
    }
    
    return data.data;
  } catch (e) {
    console.error(`Error getting cache for ${key}:`, e.message);
    return null;
  }
}

/**
 * Set cache in Supabase
 */
async function setCache(key, value, ttlMinutes = 24 * 60) {
  try {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + ttlMinutes);
    
    const { error } = await supabase
      .from('nba_api_cache')
      .upsert({
        cache_key: key,
        cache_type: 'cache-tracking',
        data: value,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'cache_key'
      });
    
    if (error) {
      console.error(`Error setting cache for ${key}:`, error.message);
      return false;
    }
    
    return true;
  } catch (e) {
    console.error(`Error setting cache for ${key}:`, e.message);
    return false;
  }
}

/**
 * Call API endpoint
 */
async function callAPI(endpoint) {
  try {
    const url = `${PROD_URL}${endpoint}`;
    console.log(`[Trigger Odds on Tipoff] 🌐 Calling: ${url}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`[Trigger Odds on Tipoff] ❌ API call failed: ${response.status} ${response.statusText}`);
      console.error(`[Trigger Odds on Tipoff] Response: ${text.substring(0, 200)}`);
      return null;
    }
    
    return await response.json();
  } catch (e) {
    console.error(`[Trigger Odds on Tipoff] ❌ Error calling API:`, e.message);
    return null;
  }
}

/**
 * Trigger GitHub Actions workflow to process player props
 */
async function triggerPlayerPropsWorkflow() {
  try {
    const githubToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!githubToken) {
      console.error(`[Trigger Odds on Tipoff] ❌ GITHUB_TOKEN not set - cannot trigger player props workflow`);
      return false;
    }

    const owner = 'Stattrackrr';
    const repo = 'stattrackr';
    const workflowId = 'process-player-props.yml';
    
    const githubApiUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`;
    
    console.log(`[Trigger Odds on Tipoff] 🔄 Triggering player props workflow...`);
    
    const response = await fetch(githubApiUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${githubToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'master',
        inputs: {
          trigger: 'tipoff-odds-refresh'
        }
      }),
    });

    if (response.ok || response.status === 204) {
      console.log(`[Trigger Odds on Tipoff] ✅ Player props workflow triggered successfully`);
      return true;
    } else {
      const errorText = await response.text();
      console.error(`[Trigger Odds on Tipoff] ❌ Failed to trigger player props workflow: ${response.status} ${response.statusText} - ${errorText}`);
      return false;
    }
  } catch (error) {
    console.error(`[Trigger Odds on Tipoff] ❌ Error triggering player props workflow:`, error.message);
    return false;
  }
}

/**
 * Fetch games from BDL API for a specific date
 */
async function fetchBDLGames(dateStr) {
  try {
    const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;
    if (!BALLDONTLIE_API_KEY) {
      console.error('[Trigger Odds on Tipoff] ❌ BALLDONTLIE_API_KEY not set');
      return null;
    }

    const url = `https://api.balldontlie.io/v1/games?dates[]=${dateStr}`;
    console.log(`[Trigger Odds on Tipoff] 🌐 Fetching games from BDL API for ${dateStr}...`);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      console.error(`[Trigger Odds on Tipoff] ❌ BDL API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    return data.data || [];
  } catch (e) {
    console.error(`[Trigger Odds on Tipoff] ❌ Error fetching BDL games:`, e.message);
    return null;
  }
}

/**
 * Find the latest game tipoff time for today's games
 * Uses BDL API to get accurate tipoff times (same as props page)
 */
async function findLatestTipoff(oddsCache) {
  if (!oddsCache?.games || !Array.isArray(oddsCache.games)) {
    return null;
  }

  const now = new Date();
  const todayUSET = getUSEasternDateString(now);
  
  // Get tomorrow's date in US ET as well (to catch games that might be scheduled for tomorrow)
  const [year, month, day] = todayUSET.split('-').map(Number);
  const tomorrowDate = new Date(year, month - 1, day + 1);
  const tomorrowUSET = getUSEasternDateString(tomorrowDate);
  
  // Get games from odds cache for TODAY or TOMORROW only (in US ET)
  // We only care about games happening today or tomorrow, not games days away
  const allGamesFromOdds = oddsCache.games.filter((game) => {
    if (!game.commenceTime) return false;
    
    const commenceStr = String(game.commenceTime).trim();
    let gameDateUSET;
    
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      // Date-only string - this is the game date
      gameDateUSET = commenceStr;
    } else {
      // Has time component - parse and convert to US ET
      const date = new Date(commenceStr);
      gameDateUSET = getUSEasternDateString(date);
    }
    
    // Only include games from today or tomorrow (in US ET)
    return gameDateUSET === todayUSET || gameDateUSET === tomorrowUSET;
  });
  
  console.log(`[Trigger Odds on Tipoff] 📅 Filtering games: ${oddsCache.games.length} total games, ${allGamesFromOdds.length} games for today (${todayUSET}) or tomorrow (${tomorrowUSET})`);

  if (allGamesFromOdds.length === 0) {
    return null;
  }

  // First, calculate tipoff times for ALL games using commenceTime (this is our baseline)
  // This ensures we don't miss any games even if BDL API doesn't have them
  const gameTipoffs = new Map(); // Map of gameId -> tipoff Date
  const gameDetails = new Map(); // Map of gameId -> game info for logging
  
  console.log(`[Trigger Odds on Tipoff] 🔍 Calculating tipoff times for ${allGamesFromOdds.length} games...`);
  
  for (const game of allGamesFromOdds) {
    const tipoffDate = calculateTipoffTime(game);
    if (tipoffDate) {
      gameTipoffs.set(game.gameId, tipoffDate);
      gameDetails.set(game.gameId, {
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        commenceTime: game.commenceTime,
        tipoffISO: tipoffDate.toISOString(),
        tipoffLocal: tipoffDate.toLocaleString('en-US', { timeZone: 'America/New_York' })
      });
      console.log(`[Trigger Odds on Tipoff] ⏰ ${game.awayTeam} @ ${game.homeTeam}: ${tipoffDate.toISOString()} (${tipoffDate.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET)`);
    } else {
      console.log(`[Trigger Odds on Tipoff] ⚠️ Could not calculate tipoff for ${game.awayTeam} @ ${game.homeTeam} (commenceTime: ${game.commenceTime})`);
    }
  }

  // Find the latest tipoff from our baseline calculation
  let latestTipoff = null;
  let latestGameId = null;
  for (const [gameId, tipoffDate] of gameTipoffs.entries()) {
    if (!latestTipoff || tipoffDate > latestTipoff) {
      latestTipoff = tipoffDate;
      latestGameId = gameId;
    }
  }
  
  if (latestGameId) {
    const details = gameDetails.get(latestGameId);
    console.log(`[Trigger Odds on Tipoff] 🏆 Initial latest tipoff: ${details?.awayTeam} @ ${details?.homeTeam} at ${latestTipoff.toISOString()} (${details?.tipoffLocal} ET)`);
  }

  // Now try to enhance with BDL API data if available (for more accurate times)
  const [bdlGamesToday, bdlGamesTomorrow] = await Promise.all([
    fetchBDLGames(todayUSET),
    fetchBDLGames(tomorrowUSET)
  ]);
  
  const allBdlGames = [...(bdlGamesToday || []), ...(bdlGamesTomorrow || [])];
  
  // Filter BDL games to only include those from today or tomorrow (double-check)
  const filteredBdlGames = allBdlGames.filter((bdlGame) => {
    if (!bdlGame.date) return false;
    const gameDateStr = bdlGame.date.split('T')[0]; // Get YYYY-MM-DD part
    return gameDateStr === todayUSET || gameDateStr === tomorrowUSET;
  });
  
  if (filteredBdlGames.length !== allBdlGames.length) {
    console.log(`[Trigger Odds on Tipoff] 🔍 Filtered BDL games: ${allBdlGames.length} total, ${filteredBdlGames.length} for today/tomorrow`);
  }
  
  if (filteredBdlGames.length > 0) {
    console.log(`[Trigger Odds on Tipoff] 🔄 Enhancing with BDL API data (${filteredBdlGames.length} games for today/tomorrow)...`);
    // Match BDL games with odds cache games and update tipoff times if BDL has better data
    for (const bdlGame of filteredBdlGames) {
      const homeTeam = bdlGame.home_team?.abbreviation || bdlGame.home_team?.full_name;
      const awayTeam = bdlGame.visitor_team?.abbreviation || bdlGame.visitor_team?.full_name;
      
      // Find matching game in odds cache
      const matchingOddsGame = allGamesFromOdds.find((oddsGame) => {
        const oddsHome = oddsGame.homeTeam?.toUpperCase();
        const oddsAway = oddsGame.awayTeam?.toUpperCase();
        const bdlHome = homeTeam?.toUpperCase();
        const bdlAway = awayTeam?.toUpperCase();
        
        return (oddsHome === bdlHome && oddsAway === bdlAway) ||
               (oddsHome === bdlAway && oddsAway === bdlHome);
      });
      
      if (matchingOddsGame) {
        const bdlTipoff = calculateTipoffTime(bdlGame);
        if (bdlTipoff) {
          const oldTipoff = gameTipoffs.get(matchingOddsGame.gameId);
          // Update with BDL tipoff time (usually more accurate)
          gameTipoffs.set(matchingOddsGame.gameId, bdlTipoff);
          const details = gameDetails.get(matchingOddsGame.gameId);
          if (details) {
            details.tipoffISO = bdlTipoff.toISOString();
            details.tipoffLocal = bdlTipoff.toLocaleString('en-US', { timeZone: 'America/New_York' });
          }
          console.log(`[Trigger Odds on Tipoff] 🔄 Updated ${awayTeam} @ ${homeTeam}: ${oldTipoff?.toISOString()} → ${bdlTipoff.toISOString()} (${bdlTipoff.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET)`);
        }
      }
    }
    
    // After enhancing with BDL data, re-check ALL games to find the latest tipoff
    console.log(`[Trigger Odds on Tipoff] 🔍 Re-checking all games after BDL enhancement...`);
    latestTipoff = null;
    latestGameId = null;
    for (const [gameId, tipoffDate] of gameTipoffs.entries()) {
      if (!latestTipoff || tipoffDate > latestTipoff) {
        latestTipoff = tipoffDate;
        latestGameId = gameId;
      }
    }
    
    if (latestGameId) {
      const details = gameDetails.get(latestGameId);
      console.log(`[Trigger Odds on Tipoff] 🏆 Latest tipoff after BDL enhancement: ${details?.awayTeam} @ ${details?.homeTeam} at ${latestTipoff.toISOString()} (${details?.tipoffLocal} ET)`);
    }
  } else {
    console.log(`[Trigger Odds on Tipoff] ⚠️ No BDL games found, using commenceTime parsing`);
  }

  if (!latestTipoff) {
    console.log(`[Trigger Odds on Tipoff] ⚠️ No valid tipoff times found`);
    return null;
  }

  // Find the game info for logging
  const latestGame = allGamesFromOdds.find(g => g.gameId === latestGameId);
  if (latestGame) {
    const details = gameDetails.get(latestGameId);
    console.log(`[Trigger Odds on Tipoff] 📅 FINAL Latest tipoff: ${latestTipoff.toISOString()} (${details?.tipoffLocal || latestTipoff.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET) for ${latestGame.awayTeam} @ ${latestGame.homeTeam}`);
    console.log(`[Trigger Odds on Tipoff] 📅 Game commenceTime: ${latestGame.commenceTime}`);
  } else {
    console.log(`[Trigger Odds on Tipoff] 📅 FINAL Latest tipoff: ${latestTipoff.toISOString()} (${latestTipoff.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET)`);
  }

  return latestTipoff;
}

/**
 * Main function
 */
async function main() {
  console.log(`[Trigger Odds on Tipoff] 🕐 Started at ${new Date().toISOString()}`);

  try {
    // Get odds cache to find today's games
    const oddsCache = await getCache(ODDS_CACHE_KEY);

    if (!oddsCache) {
      console.log(`[Trigger Odds on Tipoff] ⚠️ No odds cache available - skipping check`);
      process.exit(0);
    }

    // Find the latest tipoff time for today's games (uses BDL API for accuracy)
    const latestTipoff = await findLatestTipoff(oddsCache);
    
    if (!latestTipoff) {
      console.log(`[Trigger Odds on Tipoff] ℹ️ No games found for today`);
      process.exit(0);
    }

    const now = new Date();
    const todayUSET = getUSEasternDateString(now);
    const trackingKey = `${LAST_TIPOFF_TRIGGER_KEY_PREFIX}-${todayUSET}`;

    console.log(`[Trigger Odds on Tipoff] 📅 Latest tipoff: ${latestTipoff.toISOString()}`);
    console.log(`[Trigger Odds on Tipoff] ⏰ Current time: ${now.toISOString()}`);

    // Check if latest tipoff has passed
    if (now >= latestTipoff) {
      // Check if we've already triggered today
      const lastTriggered = await getCache(trackingKey);

      if (lastTriggered) {
        const lastTriggeredDate = new Date(lastTriggered);
        const minutesSinceTrigger = (now.getTime() - lastTriggeredDate.getTime()) / (60 * 1000);
        console.log(`[Trigger Odds on Tipoff] ⏸️ Already triggered ${minutesSinceTrigger.toFixed(1)} minutes ago - skipping`);
        process.exit(0);
      }

      // Latest tipoff has passed and we haven't triggered yet - trigger odds refresh
      console.log(`[Trigger Odds on Tipoff] 🚨 Latest tipoff has passed - triggering odds refresh`);
      
      // Call the odds refresh API endpoint
      const result = await callAPI('/api/odds/refresh');
      
      if (result && result.success !== false) {
        console.log(`[Trigger Odds on Tipoff] ✅ Odds refresh completed`);
        console.log(`[Trigger Odds on Tipoff] 📊 Result: ${result.gamesCount || 0} games, ${result.apiCalls || 0} API calls`);
        
        // Wait a few seconds for odds cache to update
        console.log(`[Trigger Odds on Tipoff] ⏳ Waiting 10 seconds for odds cache to update...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Now trigger the player props workflow to process tomorrow's props
        console.log(`[Trigger Odds on Tipoff] 🚀 Triggering player props workflow to process tomorrow's props...`);
        const propsTriggered = await triggerPlayerPropsWorkflow();
        
        if (propsTriggered) {
          // Record that we triggered (24 hour TTL - will auto-expire tomorrow)
          await setCache(trackingKey, now.toISOString(), 24 * 60);
          console.log(`[Trigger Odds on Tipoff] ✅ Odds refresh and player props workflow triggered successfully`);
          process.exit(0);
        } else {
          // Still record odds refresh even if props workflow failed
          await setCache(trackingKey, now.toISOString(), 24 * 60);
          console.warn(`[Trigger Odds on Tipoff] ⚠️ Odds refresh completed but player props workflow failed to trigger`);
          process.exit(0); // Don't fail - odds refresh succeeded
        }
      } else {
        console.error(`[Trigger Odds on Tipoff] ❌ Failed to trigger odds refresh`);
        process.exit(1);
      }
    } else {
      // Latest tipoff hasn't happened yet
      const minutesUntilTipoff = (latestTipoff.getTime() - now.getTime()) / (60 * 1000);
      console.log(`[Trigger Odds on Tipoff] ⏳ Latest tipoff in ${minutesUntilTipoff.toFixed(1)} minutes`);
      process.exit(0);
    }
  } catch (e) {
    console.error(`[Trigger Odds on Tipoff] ❌ Error:`, e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

main();

