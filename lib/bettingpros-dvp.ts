/**
 * Shared utilities for fetching and parsing BettingPros DVP data
 */

import cache from "@/lib/cache";
import { getNBACache, setNBACache } from "@/lib/nbaCache";
import { normalizeAbbr } from "@/lib/nbaAbbr";

const BETTINGPROS_URL = 'https://www.bettingpros.com/nba/defense-vs-position/';

// Map BettingPros team abbreviations to our format
export const OUR_TO_BP_ABBR: Record<string, string> = {
  'NOP': 'NOR', // New Orleans - we use NOP, BettingPros uses NOR
  'PHX': 'PHO', // Phoenix - we use PHX, BettingPros uses PHO
  'UTA': 'UTH', // Utah - we use UTA, BettingPros uses UTH
};

// Map BettingPros metric names to our format
const METRIC_MAP: Record<string, string> = {
  'points': 'pts',
  'rebounds': 'reb',
  'assists': 'ast',
  'three_points_made': 'fg3m',
  'steals': 'stl',
  'blocks': 'blk',
  'turnovers': 'to',
  'field_goals_perc': 'fg_pct',
  'free_throw_perc': 'ft_pct',
};

// Reverse map: our metric -> BettingPros metric
export const OUR_TO_BP_METRIC: Record<string, string> = Object.fromEntries(
  Object.entries(METRIC_MAP).map(([bp, ours]) => [ours, bp])
);

/**
 * Extract JSON data from HTML by finding the bpDefenseVsPositionStats variable
 */
export function extractStatsFromHTML(html: string): any {
  // Try multiple possible markers in case the HTML structure changed
  const markers = [
    'const bpDefenseVsPositionStats = {',
    'bpDefenseVsPositionStats = {',
    'var bpDefenseVsPositionStats = {',
    'let bpDefenseVsPositionStats = {',
  ];

  let startIdx = -1;
  let startMarker = '';
  let jsonStart = -1;

  // Find which marker exists in the HTML
  for (const marker of markers) {
    const idx = html.indexOf(marker);
    if (idx >= 0) {
      startIdx = idx;
      startMarker = marker;
      jsonStart = idx + marker.length - 1; // Start at the opening brace
      break;
    }
  }

  if (startIdx < 0) {
    throw new Error('Could not find bpDefenseVsPositionStats variable in HTML. The page structure may have changed.');
  }

  // Find the matching closing brace
  let braceCount = 0;
  let jsonEnd = jsonStart;
  let inString = false;
  let escapeNext = false;
  let stringChar = '';

  for (let i = jsonStart; i < html.length && i < jsonStart + 500000; i++) { // Limit search to 500KB
    const char = html[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (!inString && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
      continue;
    }
    
    if (inString && char === stringChar) {
      inString = false;
      continue;
    }
    
    if (!inString) {
      if (char === '{') braceCount++;
      if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }
  }

  if (braceCount !== 0) {
    throw new Error(`Could not find matching closing brace. Unclosed braces: ${braceCount}`);
  }

  let jsonStr = html.substring(jsonStart, jsonEnd);
  
  // Clean up the string
  // Remove any trailing commas before closing braces/brackets
  jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
  // Remove any comments (though JSON shouldn't have them, but just in case)
  jsonStr = jsonStr.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // Trim whitespace
  jsonStr = jsonStr.trim();
  
  // Validate string starts with {
  if (!jsonStr.startsWith('{')) {
    throw new Error(`Extracted data does not start with '{'. First 50 chars: ${jsonStr.substring(0, 50)}`);
  }
  
  // BettingPros uses JavaScript object literal syntax (unquoted keys), not JSON
  // Try JSON.parse first, but if it fails, use Function constructor to parse JS object literal
  let parsed: any;
  try {
    // Try direct JSON parse first (in case they've changed to JSON format)
    parsed = JSON.parse(jsonStr);
  } catch (jsonError: any) {
    // JSON parse failed - likely JavaScript object literal syntax
    // Use Function constructor (safer than eval) to parse JS object literal
    try {
      // Create a function that returns the object literal
      // This safely evaluates JavaScript object syntax
      const func = new Function('return ' + jsonStr);
      parsed = func();
      
      // Validate it's an object (not array or primitive)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Function constructor did not return a valid object');
      }
    } catch (funcError: any) {
      // If Function constructor also fails, log detailed error
      const errorPos = parseInt(jsonError.message.match(/position (\d+)/)?.[1] || '0', 10);
      const startPos = Math.max(0, errorPos - 200);
      const endPos = Math.min(jsonStr.length, errorPos + 200);
      const context = jsonStr.substring(startPos, endPos);
      
      console.error('[BettingPros] All parsing methods failed:', {
        jsonError: jsonError.message,
        funcError: funcError.message,
        position: errorPos,
        context: context,
        jsonLength: jsonStr.length,
        first500: jsonStr.substring(0, 500),
        last500: jsonStr.substring(Math.max(0, jsonStr.length - 500))
      });
      
      throw new Error(`Failed to parse BettingPros data: ${jsonError.message}. Context: ${context.substring(0, 300)}`);
    }
  }
  
  // Validate structure
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Parsed data is not a valid object');
  }
  
  return parsed;
}

/**
 * Fetch and cache BettingPros data (shared across all requests)
 */
export async function fetchBettingProsData(forceRefresh = false): Promise<any> {
  const cacheKey = 'bettingpros_dvp_data';
  
  // Check cache (cache for 1 hour to avoid hitting BettingPros too frequently)
  if (!forceRefresh) {
    // Try in-memory cache first (fastest)
    const cached = cache.get<any>(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Try Supabase cache (persistent across cold starts)
    try {
      const supabaseCached = await getNBACache<any>(cacheKey, { quiet: true });
      if (supabaseCached) {
        // Store in in-memory cache for faster future access
        cache.set(cacheKey, supabaseCached, 60); // 60 minutes
        return supabaseCached;
      }
    } catch (error) {
      // Supabase cache failed, continue with fetch
      console.warn('[BettingPros] Supabase cache check failed, continuing with fetch:', error);
    }
  }

  // Fetch the HTML page
  const response = await fetch(BETTINGPROS_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    // Try to use stale cache if available (in-memory first, then Supabase)
    let staleCache = cache.get<any>(cacheKey);
    if (staleCache) {
      console.warn(`[BettingPros] HTTP ${response.status}, using stale in-memory cached data`);
      return staleCache;
    }
    
    // Try Supabase cache
    try {
      const supabaseStale = await getNBACache<any>(cacheKey, { quiet: true });
      if (supabaseStale) {
        console.warn(`[BettingPros] HTTP ${response.status}, using stale Supabase cached data`);
        cache.set(cacheKey, supabaseStale, 60);
        return supabaseStale;
      }
    } catch (error) {
      // Supabase check failed, continue
    }
    
    throw new Error(`BettingPros ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  
  if (!html || html.length < 1000) {
    // Try to use stale cache if available (in-memory first, then Supabase)
    let staleCache = cache.get<any>(cacheKey);
    if (staleCache) {
      console.warn('[BettingPros] Empty/invalid HTML, using stale in-memory cached data');
      return staleCache;
    }
    
    // Try Supabase cache
    try {
      const supabaseStale = await getNBACache<any>(cacheKey, { quiet: true });
      if (supabaseStale) {
        console.warn('[BettingPros] Empty/invalid HTML, using stale Supabase cached data');
        cache.set(cacheKey, supabaseStale, 60);
        return supabaseStale;
      }
    } catch (error) {
      // Supabase check failed, continue
    }
    
    throw new Error('BettingPros returned empty or invalid HTML');
  }
  
  let bpData;
  try {
    bpData = extractStatsFromHTML(html);
  } catch (extractError: any) {
    console.error('[BettingPros] Error extracting data from HTML:', extractError.message);
    // Try to use cached data if available (even if expired) - in-memory first, then Supabase
    let staleCache = cache.get<any>(cacheKey);
    if (staleCache) {
      console.warn('[BettingPros] Using stale in-memory cached data due to extraction error');
      return staleCache;
    }
    
    // Try Supabase cache
    try {
      const supabaseStale = await getNBACache<any>(cacheKey, { quiet: true });
      if (supabaseStale) {
        console.warn('[BettingPros] Using stale Supabase cached data due to extraction error');
        cache.set(cacheKey, supabaseStale, 60);
        return supabaseStale;
      }
    } catch (error) {
      // Supabase check failed, continue
    }
    
    throw new Error(`Failed to extract BettingPros data: ${extractError.message}`);
  }
  
  // Validate the extracted data structure
  if (!bpData || typeof bpData !== 'object') {
    // Try to use stale cache if available (in-memory first, then Supabase)
    let staleCache = cache.get<any>(cacheKey);
    if (staleCache) {
      console.warn('[BettingPros] Invalid data structure, using stale in-memory cached data');
      return staleCache;
    }
    
    // Try Supabase cache
    try {
      const supabaseStale = await getNBACache<any>(cacheKey, { quiet: true });
      if (supabaseStale) {
        console.warn('[BettingPros] Invalid data structure, using stale Supabase cached data');
        cache.set(cacheKey, supabaseStale, 60);
        return supabaseStale;
      }
    } catch (error) {
      // Supabase check failed, continue
    }
    
    throw new Error('Extracted BettingPros data is not a valid object');
  }
  
  if (!bpData.teamStats || typeof bpData.teamStats !== 'object') {
    // Try to use stale cache if available (in-memory first, then Supabase)
    let staleCache = cache.get<any>(cacheKey);
    if (staleCache) {
      console.warn('[BettingPros] Missing teamStats, using stale in-memory cached data');
      return staleCache;
    }
    
    // Try Supabase cache
    try {
      const supabaseStale = await getNBACache<any>(cacheKey, { quiet: true });
      if (supabaseStale) {
        console.warn('[BettingPros] Missing teamStats, using stale Supabase cached data');
        cache.set(cacheKey, supabaseStale, 60);
        return supabaseStale;
      }
    } catch (error) {
      // Supabase check failed, continue
    }
    
    throw new Error('BettingPros data missing teamStats property');
  }
  
  // Cache for 1 hour (3600000 ms)
  // Store in in-memory cache (fast, but lost on cold start)
  cache.set(cacheKey, bpData, 3600000);
  // Store in Supabase cache (persistent across cold starts)
  setNBACache(cacheKey, 'bettingpros_dvp', bpData, 60, true).catch(err => {
    console.warn('[BettingPros] Failed to store in Supabase cache:', err);
  });
  
  return bpData;
}
