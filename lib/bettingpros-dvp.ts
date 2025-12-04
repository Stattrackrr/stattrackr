/**
 * Shared utilities for fetching and parsing BettingPros DVP data
 */

import cache from "@/lib/cache";
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
  const startMarker = 'const bpDefenseVsPositionStats = {';
  const startIdx = html.indexOf(startMarker);

  if (startIdx < 0) {
    throw new Error('Could not find bpDefenseVsPositionStats variable in HTML');
  }

  // Find the matching closing brace
  let braceCount = 0;
  let jsonStart = startIdx + startMarker.length - 1; // Start at the opening brace
  let jsonEnd = jsonStart;

  for (let i = jsonStart; i < html.length; i++) {
    if (html[i] === '{') braceCount++;
    if (html[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }

  const jsonStr = html.substring(jsonStart, jsonEnd);
  
  // Parse the JSON (using eval in a controlled way)
  try {
    return eval('(' + jsonStr + ')');
  } catch (e: any) {
    throw new Error(`Failed to parse JSON: ${e.message}`);
  }
}

/**
 * Fetch and cache BettingPros data (shared across all requests)
 */
export async function fetchBettingProsData(forceRefresh = false): Promise<any> {
  const cacheKey = 'bettingpros_dvp_data';
  
  // Check cache (cache for 1 hour to avoid hitting BettingPros too frequently)
  if (!forceRefresh) {
    const cached = cache.get<any>(cacheKey);
    if (cached) {
      return cached;
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
    throw new Error(`BettingPros ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  const bpData = extractStatsFromHTML(html);
  
  // Cache for 1 hour (3600000 ms)
  cache.set(cacheKey, bpData, 3600000);
  
  return bpData;
}
