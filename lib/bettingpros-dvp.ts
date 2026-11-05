/**
 * Shared utilities for fetching and parsing BettingPros DVP data
 */

import cache from "@/lib/cache";
import { getNBACache, setNBACache } from "@/lib/nbaCache";
import { normalizeAbbr } from "@/lib/nbaAbbr";
import JSON5 from "json5";

const BETTINGPROS_URL = 'https://www.bettingpros.com/nba/defense-vs-position/';
const MIN_TEAMS = 25;
const hasTeams = (data: any) => Object.keys(data?.teamStats ?? {}).length >= MIN_TEAMS;

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
  
  // BettingPros may return JSON5-style object literals (unquoted keys/trailing commas).
  // Parse as data only; never execute remote content.
  let parsed: any;
  try {
    // Try direct JSON parse first (in case they've changed to JSON format)
    parsed = JSON.parse(jsonStr);
  } catch (jsonError: any) {
    // Fallback to JSON5 parser for JS object-literal syntax.
    try {
      parsed = JSON5.parse(jsonStr);
    } catch (funcError: any) {
      // If JSON5 parse also fails, log detailed error
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

const CACHE_KEY = 'bettingpros_dvp_data';
/** The last full table, kept indefinitely (over 300 days never expires in nbaCache) for when the page is empty. */
export const BETTINGPROS_LAST_GOOD_KEY = 'bettingpros_dvp_last_good';
const LAST_GOOD_TTL_MINUTES = 400 * 24 * 60;
const BP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

/** The page, parsed; null when it can't be fetched or carries no usable table. */
async function fetchBettingProsPage(url: string): Promise<any | null> {
  try {
    const response = await fetch(url, { headers: BP_HEADERS, cache: 'no-store' });
    if (!response.ok) {
      console.warn(`[BettingPros] HTTP ${response.status}`);
      return null;
    }
    const html = await response.text();
    if (!html || html.length < 1000) return null;
    const data = extractStatsFromHTML(html);
    if (!data || typeof data !== 'object' || !hasTeams(data)) {
      console.warn(`[BettingPros] Page has ${Object.keys(data?.teamStats ?? {}).length} teams in teamStats`);
      return null;
    }
    return data;
  } catch (err: any) {
    console.warn('[BettingPros] Fetch/parse failed:', err?.message ?? err);
    return null;
  }
}

/**
 * BettingPros Defense vs Position data, shared by every DvP view. Order: fresh cache, the page (retried once
 * past the CDN cache), then the recent copy, then the last full table. BettingPros sometimes publishes the
 * page with an empty table (avgGamesPlayed 0): that is never cached or served.
 */
export async function fetchBettingProsData(forceRefresh = false): Promise<any> {
  if (!forceRefresh) {
    const cached = cache.get<any>(CACHE_KEY);
    if (cached && hasTeams(cached)) return cached;
    try {
      const supabaseCached = await getNBACache<any>(CACHE_KEY, { quiet: true });
      if (supabaseCached && hasTeams(supabaseCached)) {
        cache.set(CACHE_KEY, supabaseCached, 60);
        return supabaseCached;
      }
    } catch (error) {
      console.warn('[BettingPros] Supabase cache check failed, continuing with fetch:', error);
    }
  }

  const fresh = (await fetchBettingProsPage(BETTINGPROS_URL)) ?? (await fetchBettingProsPage(`${BETTINGPROS_URL}?_=${Date.now()}`));
  if (fresh) {
    cache.set(CACHE_KEY, fresh, 3600000);
    setNBACache(CACHE_KEY, 'bettingpros_dvp', fresh, 60, true).catch((err) => console.warn('[BettingPros] Failed to store in Supabase cache:', err));
    setNBACache(BETTINGPROS_LAST_GOOD_KEY, 'bettingpros_dvp', fresh, LAST_GOOD_TTL_MINUTES, true).catch(() => undefined);
    return fresh;
  }

  const stale = cache.get<any>(CACHE_KEY);
  if (stale && hasTeams(stale)) return stale;
  for (const key of [CACHE_KEY, BETTINGPROS_LAST_GOOD_KEY]) {
    try {
      const saved = await getNBACache<any>(key, { quiet: true });
      if (saved && hasTeams(saved)) {
        console.warn(`[BettingPros] Live page unusable, serving ${key}`);
        cache.set(CACHE_KEY, saved, 15);
        return saved;
      }
    } catch {
      // try the next copy
    }
  }
  throw new Error('BettingPros data missing teamStats property');
}

