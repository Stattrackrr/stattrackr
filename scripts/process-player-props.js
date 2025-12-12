/**
 * Standalone script to process player props
 * Runs in GitHub Actions - no Vercel timeout limits!
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
const PLAYER_PROPS_CACHE_PREFIX = 'nba-player-props-processed-v2';
const CHECKPOINT_CACHE_PREFIX = 'nba-player-props-checkpoint-v2';
const PROD_URL = process.env.PROD_URL || 'https://www.stattrackr.co';

// Helper to get cache from Supabase
async function getCache(key) {
  try {
    const { data, error } = await supabase
      .from('nba_api_cache')
      .select('data, expires_at')
      .eq('cache_key', key)
      .single();
    
    if (error || !data) return null;
    
    // Check if expired
    const expiresAt = new Date(data.expires_at);
    if (expiresAt < new Date()) return null;
    
    return data.data;
  } catch (e) {
    return null;
  }
}

// Helper to set cache in Supabase
async function setCache(key, value, ttlMinutes = 24 * 60) {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  
  try {
    await supabase
      .from('nba_api_cache')
      .upsert({
        cache_key: key,
        cache_type: 'player-props',
        data: value,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      });
  } catch (e) {
    console.error(`Failed to save cache: ${e.message}`);
  }
}

// Call internal API endpoint
async function callAPI(endpoint) {
  const url = `${PROD_URL}${endpoint}`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      'Accept': 'application/json',
    },
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

async function processPlayerProps() {
  console.log('[GitHub Actions] 🚀 Starting player props processing...');
  
  // Get odds cache
  console.log('[GitHub Actions] 📥 Fetching odds cache...');
  const oddsCache = await getCache(ODDS_CACHE_KEY);
  
  if (!oddsCache || !oddsCache.lastUpdated) {
    console.error('[GitHub Actions] ❌ No odds cache found');
    process.exit(1);
  }
  
  console.log(`[GitHub Actions] ✅ Found odds cache: ${oddsCache.games?.length || 0} games`);
  
  // Determine game date and vendor count
  const getGameDate = () => {
    const today = new Date();
    const usEastern = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(today).replace(/(\d+)\/(\d+)\/(\d+)/, (_, m, d, y) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    return usEastern;
  };
  
  const gameDate = getGameDate();
  const vendors = new Set();
  if (oddsCache.games) {
    for (const game of oddsCache.games) {
      if (game.playerPropsByBookmaker) {
        Object.keys(game.playerPropsByBookmaker).forEach(v => vendors.add(v));
      }
    }
  }
  const vendorCount = vendors.size;
  const cacheKey = `${PLAYER_PROPS_CACHE_PREFIX}-${gameDate}-${oddsCache.lastUpdated}-v${vendorCount}`;
  const checkpointKey = `${CHECKPOINT_CACHE_PREFIX}-${gameDate}-${oddsCache.lastUpdated}-v${vendorCount}`;
  
  console.log(`[GitHub Actions] 📅 Processing for game date: ${gameDate}, vendors: ${vendorCount}`);
  console.log(`[GitHub Actions] 🔑 Cache key: ${cacheKey}`);
  
  // Check for existing cache
  const existingCache = await getCache(cacheKey);
  if (existingCache && Array.isArray(existingCache) && existingCache.length > 0) {
    console.log(`[GitHub Actions] ✅ Cache already exists (${existingCache.length} props)`);
    return;
  }
  
  // Check for checkpoint
  let startIndex = 0;
  let processedProps = [];
  const checkpoint = await getCache(checkpointKey);
  if (checkpoint && checkpoint.processedProps && checkpoint.startIndex > 0) {
    console.log(`[GitHub Actions] 📍 Resuming from checkpoint at index ${checkpoint.startIndex}`);
    startIndex = checkpoint.startIndex;
    processedProps = checkpoint.processedProps;
  }
  
  // Call the processing endpoint in a loop until all props are processed
  // Each call processes a batch (up to 5 min), saves checkpoint, then we call again
  let totalProcessed = processedProps.length;
  let totalProps = 0;
  let attempts = 0;
  const maxAttempts = 12; // 12 attempts * 5 min = 60 minutes max
  
  while (attempts < maxAttempts) {
    attempts++;
    console.log(`[GitHub Actions] 🔄 Processing attempt ${attempts}/${maxAttempts}...`);
    
    try {
      const response = await fetch(`${PROD_URL}/api/nba/player-props/process?refresh=1`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(300000), // 5 minute timeout per call
      });
      
      const result = await response.json();
      
      if (result.success) {
        if (result.data && Array.isArray(result.data) && result.data.length > 0) {
          // Completed!
          console.log(`[GitHub Actions] ✅ Processing completed: ${result.data.length} props`);
          totalProcessed = result.data.length;
          break;
        } else if (result.message && result.message.includes('checkpoint')) {
          // Hit timeout, checkpoint saved
          totalProcessed = result.processed || totalProcessed;
          totalProps = result.total || 0;
          console.log(`[GitHub Actions] ⏸️ Batch ${attempts} completed: ${totalProcessed}/${totalProps} props`);
          console.log(`[GitHub Actions] 📝 Continuing from index ${result.nextIndex}...`);
          
          // Wait a bit before next call
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        } else {
          console.log(`[GitHub Actions] ⚠️ Processing completed but no data returned`);
          break;
        }
      } else {
        console.error(`[GitHub Actions] ❌ Processing failed: ${result.error}`);
        break;
      }
    } catch (error) {
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        // Expected timeout - checkpoint should be saved, continue
        console.log(`[GitHub Actions] ⏱️ Request timed out (expected), checking checkpoint...`);
        const newCheckpoint = await getCache(checkpointKey);
        if (newCheckpoint && newCheckpoint.processedProps) {
          totalProcessed = newCheckpoint.processedCount || totalProcessed;
          totalProps = newCheckpoint.totalProps || 0;
          console.log(`[GitHub Actions] 📍 Found checkpoint: ${totalProcessed}/${totalProps} props`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      console.error(`[GitHub Actions] ❌ Error: ${error.message}`);
      break;
    }
  }
  
  if (totalProcessed > 0) {
    console.log(`[GitHub Actions] ✅ Final result: ${totalProcessed} props processed`);
  } else {
    console.error(`[GitHub Actions] ❌ No props were processed`);
    process.exit(1);
  }
}

processPlayerProps().catch((error) => {
  console.error('[GitHub Actions] ❌ Fatal error:', error);
  process.exit(1);
});

