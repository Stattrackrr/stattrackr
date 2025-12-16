/**
 * Check latest game tipoff time and trigger player props processing
 * if 10 minutes have passed since the last tipoff
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const PROD_URL = process.env.PROD_URL;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

async function getOddsCache() {
  try {
    const { data, error } = await supabase
      .from('nba_api_cache')
      .select('data, expires_at')
      .eq('cache_key', 'all_nba_odds_v2_bdl')
      .single();
    
    if (error || !data) {
      console.log('⚠️ No odds cache found');
      return null;
    }
    
    const expiresAt = new Date(data.expires_at);
    if (expiresAt < new Date()) {
      console.log('⚠️ Odds cache expired');
      return null;
    }
    
    return data.data;
  } catch (e) {
    console.error('❌ Error fetching odds cache:', e.message);
    return null;
  }
}

async function fetchLatestGameTimeFromNBA(dateStr) {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const mdy = `${month}/${day}/${year}`;
    
    const NBA_BASE = "https://stats.nba.com/stats";
    const NBA_HEADERS = {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.nba.com",
      Referer: "https://www.nba.com/stats/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "x-nba-stats-origin": "stats",
      "x-nba-stats-token": "true",
    };
    
    const url = `${NBA_BASE}/scoreboardv2?GameDate=${encodeURIComponent(mdy)}&DayOffset=0`;
    const res = await fetch(url, { headers: NBA_HEADERS, cache: "no-store" });
    
    if (!res.ok) {
      return null;
    }
    
    const data = await res.json();
    const resultSets = data?.resultSets || [];
    const gamesSet = resultSets.find((r) => (r?.name || '').toLowerCase().includes('game')) || resultSets[0];
    
    if (!gamesSet?.headers || !gamesSet?.rowSet || gamesSet.rowSet.length === 0) {
      return null;
    }
    
    const headers = gamesSet.headers.map((h) => String(h || '').toLowerCase());
    const possibleTimeFields = [
      'gamedatetimeest',
      'datetimeest',
      'gamedatetime',
      'datetime',
      'starttimeest',
      'starttime'
    ];
    
    let gameDateTimeEstIdx = -1;
    for (const field of possibleTimeFields) {
      const idx = headers.findIndex((h) => h.includes(field));
      if (idx >= 0) {
        gameDateTimeEstIdx = idx;
        break;
      }
    }
    
    if (gameDateTimeEstIdx < 0) {
      return null;
    }
    
    let latestTipoff = null;
    for (const row of gamesSet.rowSet) {
      const gameDateTimeEst = row[gameDateTimeEstIdx];
      if (!gameDateTimeEst) continue;
      
      let tipoffDate;
      if (typeof gameDateTimeEst === 'string') {
        tipoffDate = new Date(gameDateTimeEst);
      } else if (typeof gameDateTimeEst === 'number') {
        tipoffDate = new Date(gameDateTimeEst);
      } else {
        continue;
      }
      
      if (!isNaN(tipoffDate.getTime())) {
        if (!latestTipoff || tipoffDate > latestTipoff) {
          latestTipoff = tipoffDate;
        }
      }
    }
    
    return latestTipoff;
  } catch (error) {
    console.error('❌ Error fetching NBA schedule:', error.message);
    return null;
  }
}

async function findLastGameTipoff(oddsCache) {
  if (!oddsCache?.games || !Array.isArray(oddsCache.games)) {
    return null;
  }

  const todayUSET = getUSEasternDateString(new Date());
  const todayGames = oddsCache.games.filter((game) => {
    if (!game.commenceTime) return false;
    const commenceStr = String(game.commenceTime).trim();
    let gameDateUSET;
    
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      gameDateUSET = commenceStr;
    } else {
      const date = new Date(commenceStr);
      gameDateUSET = getUSEasternDateString(date);
    }
    
    return gameDateUSET === todayUSET;
  });

  if (todayGames.length === 0) {
    return null;
  }

  // Fetch latest game time from NBA Stats API (more accurate)
  const nbaLatestTipoff = await fetchLatestGameTimeFromNBA(todayUSET);
  
  let latestTipoff = null;

  for (const game of todayGames) {
    if (!game.commenceTime) continue;
    
    const commenceStr = String(game.commenceTime).trim();
    let tipoffDate = null;
    
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      // Date-only string - use NBA Stats API time if available
      if (nbaLatestTipoff) {
        tipoffDate = nbaLatestTipoff;
      } else {
        // Fallback: Use 2:00 AM UTC (1pm Sydney time, common for late games)
        const [year, month, day] = commenceStr.split('-').map(Number);
        const utcDateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T02:00:00.000Z`;
        tipoffDate = new Date(utcDateStr);
      }
    } else {
      // Has time component - parse it
      tipoffDate = new Date(commenceStr);
    }

    if (tipoffDate && (!latestTipoff || tipoffDate > latestTipoff)) {
      latestTipoff = tipoffDate;
    }
  }

  return latestTipoff;
}

async function checkIfAlreadyProcessed() {
  const todayUSET = getUSEasternDateString(new Date());
  const lastProcessedKey = `tomorrow-props-last-processed-${todayUSET}`;
  
  try {
    const { data, error } = await supabase
      .from('nba_api_cache')
      .select('data, expires_at')
      .eq('cache_key', lastProcessedKey)
      .single();
    
    if (error || !data) {
      return false;
    }
    
    const expiresAt = new Date(data.expires_at);
    if (expiresAt < new Date()) {
      return false;
    }
    
    return true;
  } catch (e) {
    return false;
  }
}

async function triggerGitHubWorkflow() {
  // Try GITHUB_TOKEN first (from secrets), fallback to built-in GITHUB_TOKEN
  const token = GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('❌ GITHUB_TOKEN not set - cannot trigger workflow');
    return false;
  }

  const owner = 'Stattrackrr';
  const repo = 'stattrackr';
  const workflowId = 'process-player-props.yml';
  
  const githubApiUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`;
  
  console.log('🔄 Triggering GitHub Actions workflow...');
  
  try {
    const response = await fetch(githubApiUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'master',
        inputs: {
          trigger: 'tipoff-checker'
        }
      }),
    });

    if (response.ok || response.status === 204) {
      console.log('✅ GitHub Actions workflow triggered successfully');
      return true;
    } else {
      const errorText = await response.text();
      console.error(`❌ Failed to trigger workflow: ${response.status} ${response.statusText} - ${errorText}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error triggering workflow:`, error.message);
    return false;
  }
}

async function main() {
  console.log('🕐 Starting tipoff check...');
  
  // Get odds cache
  const oddsCache = await getOddsCache();
  if (!oddsCache) {
    console.log('⚠️ No odds cache available - cannot determine tipoff');
    process.exit(0);
  }

  // Find last game tipoff
  const lastTipoff = await findLastGameTipoff(oddsCache);
  if (!lastTipoff) {
    console.log('⚠️ No games found for today - skipping');
    process.exit(0);
  }

  const now = new Date();
  const tipoffTime = lastTipoff.getTime();
  const currentTime = now.getTime();
  const tenMinutesAfterTipoff = tipoffTime + (10 * 60 * 1000);

  console.log(`📅 Last game tipoff: ${lastTipoff.toISOString()}`);
  console.log(`⏰ Current time: ${now.toISOString()}`);
  console.log(`⏰ 10 minutes after tipoff: ${new Date(tenMinutesAfterTipoff).toISOString()}`);

  // Check if we should trigger processing (10 minutes after last tipoff)
  if (currentTime >= tenMinutesAfterTipoff) {
    // Check if already processed today
    const alreadyProcessed = await checkIfAlreadyProcessed();
    if (alreadyProcessed) {
      console.log('✅ Already processed today - skipping');
      process.exit(0);
    }

    // Trigger processing
    console.log('🚀 Triggering processing for tomorrow\'s props...');
    const triggered = await triggerGitHubWorkflow();

    if (triggered) {
      // Mark as processed
      const todayUSET = getUSEasternDateString(new Date());
      const lastProcessedKey = `tomorrow-props-last-processed-${todayUSET}`;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 1); // Expire tomorrow
      
      await supabase.from('nba_api_cache').upsert({
        cache_key: lastProcessedKey,
        data: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString()
      });
      
      console.log('✅ Processing triggered and marked');
      process.exit(0);
    } else {
      console.error('❌ Failed to trigger processing');
      process.exit(1);
    }
  } else {
    // Not time yet
    const timeUntilTrigger = tenMinutesAfterTipoff - currentTime;
    const minutesUntil = Math.ceil(timeUntilTrigger / (60 * 1000));
    console.log(`⏳ Will trigger processing in ${minutesUntil} minutes`);
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

