/**
 * Scrape SportsLine NBA player projections
 * 
 * Extracts projected minutes from SportsLine's expert projections page
 * Data is embedded in __NEXT_DATA__ JSON in the HTML
 */

import { NextRequest, NextResponse } from 'next/server';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import { normalizeAbbr } from '@/lib/nbaAbbr';

export const runtime = "nodejs";
export const maxDuration = 30;

interface SportsLineProjection {
  player: string;
  team: string;
  game: string;
  minutes: number;
  points?: number;
  [key: string]: any;
}

interface SportsLineResponse {
  playerMinutes: SportsLineProjection[];
  summary: {
    playersWithProjections: number;
    lastUpdated: string;
  };
}

/**
 * Fetch and parse SportsLine projections
 */
export async function fetchSportsLineProjections(): Promise<SportsLineProjection[]> {
  const url = 'https://www.sportsline.com/nba/expert-projections/simulation/';
  
  console.log('[SportsLine] Fetching projections from:', url);
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`SportsLine fetch failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  
  // Extract __NEXT_DATA__ script tag
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nextDataMatch) {
    throw new Error('Could not find __NEXT_DATA__ in SportsLine HTML');
  }

  const nextData = JSON.parse(nextDataMatch[1]);
  
  // Navigate to projections: props.initialState.fantasyState.projectionsPageState.data.projections
  const initialState = typeof nextData.props?.initialState === 'string'
    ? JSON.parse(nextData.props.initialState)
    : nextData.props?.initialState;

  const projections = initialState?.fantasyState?.projectionsPageState?.data?.projections;
  
  if (!projections || !Array.isArray(projections)) {
    console.warn('[SportsLine] No projections found in data structure');
    return [];
  }

  console.log(`[SportsLine] Found ${projections.length} projections`);

  // Parse projections into our format
  const playerMinutes: SportsLineProjection[] = [];

  for (const proj of projections) {
    if (!proj.projectionFields || !Array.isArray(proj.projectionFields)) {
      continue;
    }

    // Extract fields from projectionFields array
    const fields: Record<string, any> = {};
    for (const field of proj.projectionFields) {
      if (field.field && field.value !== undefined) {
        fields[field.field] = field.value;
      }
    }

    const player = fields.PLAYER || fields.player || '';
    const team = fields.TEAM || fields.team || '';
    const game = fields.GAME || fields.game || '';
    const minutes = typeof fields.MIN === 'number' ? fields.MIN : null;

    if (!player || !team || minutes === null) {
      continue;
    }

    // Normalize team abbreviation
    const normalizedTeam = normalizeAbbr(team);

    playerMinutes.push({
      player: player.trim(),
      team: normalizedTeam,
      game: game.trim(),
      minutes: minutes,
      points: typeof fields.PTS === 'number' ? fields.PTS : undefined,
    });
  }

  console.log(`[SportsLine] Parsed ${playerMinutes.length} player projections with minutes`);
  
  return playerMinutes;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const forceRefresh = searchParams.get('refresh') === 'true';
    
    // Check cache first (cache for 2 hours)
    const cacheKey = 'sportsline-nba-projections';
    const cacheTTL = 120; // 2 hours in minutes
    
    if (!forceRefresh) {
      const cached = await getNBACache<SportsLineResponse>(cacheKey);
      if (cached && cached.playerMinutes && cached.playerMinutes.length > 0) {
        console.log(`[SportsLine] Cache HIT: ${cached.playerMinutes.length} projections`);
        return NextResponse.json(cached);
      }
    }

    // Fetch fresh data
    console.log('[SportsLine] Fetching fresh projections...');
    const playerMinutes = await fetchSportsLineProjections();

    const response: SportsLineResponse = {
      playerMinutes,
      summary: {
        playersWithProjections: playerMinutes.length,
        lastUpdated: new Date().toISOString(),
      },
    };

    // Cache the response
    await setNBACache(cacheKey, response, cacheTTL, 'projections');
    console.log(`[SportsLine] Cached ${playerMinutes.length} projections`);

    return NextResponse.json(response);

  } catch (error: any) {
    console.error('[SportsLine] Error:', error);
    return NextResponse.json(
      { 
        error: error.message || 'Failed to fetch SportsLine projections',
        playerMinutes: [],
        summary: {
          playersWithProjections: 0,
          lastUpdated: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}

