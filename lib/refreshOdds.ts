/* eslint-disable @typescript-eslint/no-explicit-any */
import cache, { CACHE_TTL } from './cache';
import { getNBACache, setNBACache } from './nbaCache';
import type { GameOdds, OddsCache } from '@/app/api/odds/refresh/route';
import { createClient } from '@supabase/supabase-js';
import { getPlayerNameFromMapping } from './playerIdMapping';

// Validate required environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL environment variable is required');
}
if (!supabaseServiceKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
}

// Use service role for server-side operations
const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Store all odds data in a single cache entry (versioned to avoid old The Odds API cache)
const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';

// Temporary flag to disable line movement + odds snapshots (reduces Supabase size)
const LINE_MOVEMENT_ENABLED = process.env.ENABLE_LINE_MOVEMENT === 'true';

const PICKEM_BOOKMAKERS = [
  'draftkings pick6',
  'pick6',
  'prizepicks',
  'prize picks',
  'underdog fantasy',
  'underdog',
];

const isPickemBookmaker = (name: string): boolean => {
  const lower = (name || '').toLowerCase();
  return PICKEM_BOOKMAKERS.some(key => lower.includes(key));
};

const formatOddsPrice = (price: any, bookmakerName: string): string => {
  const fallback = isPickemBookmaker(bookmakerName) ? '+100' : 'N/A';
  if (price === null || price === undefined) return fallback;
  const raw = String(price).trim();
  if (!raw) return fallback;

  if (/^[+-]?\d+$/.test(raw)) {
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return parsed > 0 ? `+${parsed}` : String(parsed);
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return raw || fallback;

  if (Number.isInteger(numeric)) {
    return numeric > 0 ? `+${numeric}` : String(numeric);
  }

  if (numeric <= 1.01 || numeric === 1) return fallback;

  const american = numeric >= 2
    ? Math.round((numeric - 1) * 100)
    : Math.round(-100 / (numeric - 1));

  if (!Number.isFinite(american)) return fallback;
  return american > 0 ? `+${american}` : String(american);
};

const determinePickemVariant = (overOdds: string, underOdds: string): 'Goblin' | 'Demon' | null => {
  if (overOdds === '+100' && underOdds === '+100') return 'Demon';
  if (overOdds === 'Pick\'em' && underOdds === 'Pick\'em') return 'Goblin';
  if (overOdds === '+100' || underOdds === '+100') return 'Demon';
  return 'Goblin';
};

/**
 * Save odds snapshots to database for line movement tracking
 */
type MovementSnapshot = {
  compositeKey: string;
  gameId: string;
  playerName: string;
  market: string;
  bookmaker: string;
  line: number;
  overOdds: number;
  underOdds: number;
  recordedAt: string;
};

async function saveLineMovementState(movementSnapshots: MovementSnapshot[]) {
  if (!LINE_MOVEMENT_ENABLED) {
    console.log('[Line Movement] ⏸️ Disabled - skipping movement state save');
    return;
  }
  console.log(`📊 Starting line movement state save for ${movementSnapshots.length} snapshots...`);
  const keys = Array.from(new Set(movementSnapshots.map((m) => m.compositeKey)));

  const chunkArray = <T,>(arr: T[], size: number): T[][] => {
    if (size <= 0) return [arr];
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  };

  const latestRows: any[] = [];
  const lastEventTimestamps = new Map<string, string>();
  
  if (keys.length > 0) {
    console.log(`🔍 Fetching existing state for ${keys.length} composite keys...`);
    const keyChunks = chunkArray(keys, 10);
    for (const chunk of keyChunks) {
      const { data, error } = await supabaseAdmin
        .from('line_movement_latest')
        .select('composite_key, opening_line, opening_over_odds, opening_under_odds, opening_recorded_at, line_last_changed_at, current_line')
        .in('composite_key', chunk);

      if (error) {
        console.error('Failed to load existing line movement state:', error);
        throw error;
      }

      if (data) {
        latestRows.push(...data);
      }
      
      // Also fetch the most recent event timestamp for each composite key
      const { data: lastEvents, error: eventsError } = await supabaseAdmin
        .from('line_movement_events')
        .select('composite_key, recorded_at')
        .in('composite_key', chunk)
        .order('recorded_at', { ascending: false })
        .limit(1000); // Get recent events
      
      if (!eventsError && lastEvents) {
        // Group by composite_key and get the most recent for each
        const eventsByKey = new Map<string, string>();
        for (const event of lastEvents) {
          if (!eventsByKey.has(event.composite_key)) {
            eventsByKey.set(event.composite_key, event.recorded_at);
          }
        }
        eventsByKey.forEach((timestamp, key) => {
          lastEventTimestamps.set(key, timestamp);
        });
      }
    }
  }

  const latestMap = new Map(
    latestRows.map((row) => [
      row.composite_key,
      {
        openingLine: typeof row.opening_line === 'number' ? row.opening_line : null,
        openingOverOdds: typeof row.opening_over_odds === 'number' ? row.opening_over_odds : null,
        openingUnderOdds: typeof row.opening_under_odds === 'number' ? row.opening_under_odds : null,
        openingRecordedAt: row.opening_recorded_at as string | null,
        currentLine: typeof row.current_line === 'number' ? row.current_line : null,
        lineLastChangedAt: row.line_last_changed_at as string | null,
      },
    ])
  );

  const latestUpserts: any[] = [];
  const movementEvents: any[] = [];

  for (const snapshot of movementSnapshots) {
    const prev = latestMap.get(snapshot.compositeKey);
    const previousLine = prev?.currentLine ?? null;
    const change = previousLine === null ? 0 : Number((snapshot.line - previousLine).toFixed(2));
    const hasChanged = previousLine === null ? false : Math.abs(change) >= 0.01;

    // Check when the last event was created for this composite key
    const lastEventTime = lastEventTimestamps.get(snapshot.compositeKey);
    const timeSinceLastEvent = lastEventTime 
      ? new Date(snapshot.recordedAt).getTime() - new Date(lastEventTime).getTime()
      : Infinity;

    // Create event if:
    // 1. Line changed (>= 0.01 difference)
    // 2. This is a new entry (no previous line)
    // 3. More than 3 hours have passed since last event (to track ongoing monitoring)
    const shouldCreateEvent = hasChanged || 
      (previousLine === null) || 
      (timeSinceLastEvent > 3 * 60 * 60 * 1000); // 3 hours

    if (shouldCreateEvent) {
      movementEvents.push({
        composite_key: snapshot.compositeKey,
        game_id: snapshot.gameId,
        player_name: snapshot.playerName,
        market: snapshot.market,
        bookmaker: snapshot.bookmaker,
        previous_line: previousLine,
        new_line: snapshot.line,
        change: hasChanged ? change : 0,
        recorded_at: snapshot.recordedAt,
      });
    }

    latestUpserts.push({
      composite_key: snapshot.compositeKey,
      game_id: snapshot.gameId,
      player_name: snapshot.playerName,
      market: snapshot.market,
      bookmaker: snapshot.bookmaker,
      opening_line: prev?.openingLine ?? snapshot.line,
      opening_over_odds: prev?.openingLine ? prev.openingOverOdds : snapshot.overOdds,
      opening_under_odds: prev?.openingLine ? prev.openingUnderOdds : snapshot.underOdds,
      opening_recorded_at: prev?.openingLine ? prev.openingRecordedAt : snapshot.recordedAt,
      current_line: snapshot.line,
      current_over_odds: snapshot.overOdds,
      current_under_odds: snapshot.underOdds,
      current_recorded_at: snapshot.recordedAt,
      line_last_changed_at: hasChanged
        ? snapshot.recordedAt
        : prev?.lineLastChangedAt ?? snapshot.recordedAt,
      updated_at: snapshot.recordedAt,
    });

    latestMap.set(snapshot.compositeKey, {
      openingLine: prev?.openingLine ?? snapshot.line,
      openingOverOdds: prev?.openingLine ? prev.openingOverOdds : snapshot.overOdds,
      openingUnderOdds: prev?.openingLine ? prev.openingUnderOdds : snapshot.underOdds,
      openingRecordedAt: prev?.openingLine ? prev.openingRecordedAt : snapshot.recordedAt,
      currentLine: snapshot.line,
      lineLastChangedAt: hasChanged
        ? snapshot.recordedAt
        : prev?.lineLastChangedAt ?? snapshot.recordedAt,
    });
  }

  if (latestUpserts.length > 0) {
    console.log(`💾 Upserting ${latestUpserts.length} latest movement rows...`);
    const latestChunks = chunkArray(latestUpserts, 500);
    for (const chunk of latestChunks) {
      const { error: upsertError } = await supabaseAdmin
        .from('line_movement_latest')
        .upsert(chunk, { onConflict: 'composite_key' });

      if (upsertError) {
        console.error('Failed to upsert line movement latest rows:', upsertError);
        throw upsertError;
      }
    }
    console.log(`✅ Successfully upserted ${latestUpserts.length} latest movement rows`);
  }

  if (movementEvents.length > 0) {
    console.log(`📊 Creating ${movementEvents.length} line movement events`);
    const eventChunks = chunkArray(movementEvents, 500);
    for (const chunk of eventChunks) {
      const { error: eventsError } = await supabaseAdmin
        .from('line_movement_events')
        .insert(chunk);

      if (eventsError) {
        console.error('Failed to insert line movement events:', eventsError);
        throw eventsError;
      }
    }
    console.log(`✅ Successfully inserted ${movementEvents.length} line movement events`);
  } else {
    console.log('⚠️ No line movement events to insert (lines may not have changed)');
  }
}

// Allow all vendors provided by BDL (including sportsbooks and pick'em)
function isAllowedBookmaker(_bookmakerName: string): boolean {
  return true;
}

async function saveOddsSnapshots(games: GameOdds[]) {
  if (!LINE_MOVEMENT_ENABLED) {
    console.log(`[Line Movement] ⏸️ Disabled - skipping odds snapshots for ${games.length} games`);
    return;
  }
  const snapshots: any[] = [];
  const movementSnapshots: MovementSnapshot[] = [];
  const now = new Date().toISOString();

  for (const game of games) {
    // Save player prop snapshots
    for (const [bookmakerName, playerProps] of Object.entries(game.playerPropsByBookmaker)) {
      // Filter: Only save snapshots from allowed bookmakers
      if (!isAllowedBookmaker(bookmakerName)) {
        continue; // Skip this bookmaker
      }
      for (const [playerName, props] of Object.entries(playerProps)) {
        // Map stat keys to market names
        const statToMarket: Record<string, string> = {
          'PTS': 'player_points',
          'REB': 'player_rebounds',
          'AST': 'player_assists',
          'THREES': 'player_threes',
          'BLK': 'player_blocks',
          'STL': 'player_steals',
          'TO': 'player_turnovers',
          'PRA': 'player_points_rebounds_assists',
          'PR': 'player_points_rebounds',
          'PA': 'player_points_assists',
          'RA': 'player_rebounds_assists',
        };

        for (const [statKey, propData] of Object.entries(props)) {
          const market = statToMarket[statKey];
          if (!market) continue;

          const entries = Array.isArray(propData) ? propData : [propData];

          for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue;

            const { line: rawLine, over, under } = entry as Record<string, unknown>;
            if (
              rawLine === undefined ||
              over === undefined ||
              under === undefined
            ) {
              continue;
            }

            const line = parseFloat(String(rawLine));
            const overOdds = parseInt(String(over));
            const underOdds = parseInt(String(under));

            if (!isNaN(line) && !isNaN(overOdds) && !isNaN(underOdds)) {
              const compositeKey = [
                game.gameId,
                playerName,
                market,
                bookmakerName
              ].join('|');

              snapshots.push({
                game_id: game.gameId,
                player_name: playerName,
                bookmaker: bookmakerName,
                market,
                line,
                over_odds: overOdds,
                under_odds: underOdds,
                snapshot_at: now,
              });

              movementSnapshots.push({
                compositeKey,
                gameId: game.gameId,
                playerName,
                market,
                bookmaker: bookmakerName,
                line,
                overOdds,
                underOdds,
                recordedAt: now,
              });
            }
          }
        }
      }
    }
  }

  // Batch insert snapshots using service role (bypasses RLS)
  if (snapshots.length > 0) {
    const { error } = await supabaseAdmin
      .from('odds_snapshots')
      .insert(snapshots);

    if (error) {
      console.error('Supabase insert error:', error);
      throw error;
    }

    const bookmakers = [...new Set(snapshots.map(s => s.bookmaker))];
    console.log(`💾 Saved ${snapshots.length} odds snapshots from ${bookmakers.length} bookmakers: ${bookmakers.join(', ')}`);
  } else {
    console.log(`💾 No odds snapshots to save (filtered by allowed bookmakers)`);
  }

  if (movementSnapshots.length > 0) {
    await saveLineMovementState(movementSnapshots);
  }
}

/**
 * Fetch all NBA odds from BallDontLie (BDL) V2 odds endpoints
 * This replaces The Odds API integration.
 */
type RefreshSource =
  | 'scheduler'
  | 'api/odds/refresh'
  | 'api/odds'
  | 'api/player-props'
  | 'ensureOddsCache'
  | 'cron/refresh-player-odds';

let ongoingRefresh: Promise<OddsCache | null> | null = null;

type BdlOddsRow = {
  id: number;
  game_id: number;
  vendor: string;
  spread_home_value: string | null;
  spread_home_odds: number | null;
  spread_away_value: string | null;
  spread_away_odds: number | null;
  moneyline_home_odds: number | null;
  moneyline_away_odds: number | null;
  total_value: string | null;
  total_over_odds: number | null;
  total_under_odds: number | null;
  updated_at: string;
};

type BdlGame = {
  id: number;
  date: string;
  home_team: { abbreviation?: string; full_name?: string; name?: string };
  visitor_team: { abbreviation?: string; full_name?: string; name?: string };
};

type BdlPlayerProp = {
  id: number;
  game_id: number;
  player_id: number;
  vendor: string;
  prop_type: string;
  line_value: string;
  market: {
    type: 'over_under' | 'milestone';
    over_odds?: number;
    under_odds?: number;
    odds?: number;
  };
  updated_at: string;
};

const BDL_BASE_V2 = 'https://api.balldontlie.io/v2';
const BDL_BASE_V1 = 'https://api.balldontlie.io/v1'; // games endpoint still v1

const bdlAuthHeader = (() => {
  const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';
  return apiKey ? (apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`) : '';
})();

const BDL_PER_PAGE = 100;

async function fetchAllPages<T>(baseUrl: string, path: string, params: URLSearchParams, timeoutMs = 30000): Promise<T[]> {
  let cursor: string | null = null;
  const results: T[] = [];

  do {
    const search = new URLSearchParams(params);
    search.set('per_page', String(BDL_PER_PAGE));
    if (cursor) search.set('cursor', cursor);

    const url = `${baseUrl}${path}?${search.toString()}`;
    
    // Add timeout to fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const resp = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Authorization': bdlAuthHeader,
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`BDL fetch failed (${path}): ${resp.status} ${text}`);
      }
      const json = await resp.json();
      const data: T[] = json?.data || [];
      results.push(...data);
      cursor = json?.meta?.next_cursor || null;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.error(`⏱️ Timeout fetching ${path} after ${timeoutMs}ms`);
        throw new Error(`BDL fetch timeout (${path}): Request took longer than ${timeoutMs}ms`);
      }
      throw err;
    }
  } while (cursor);

  return results;
}

async function fetchGamesForDates(dateStrings: string[]): Promise<BdlGame[]> {
  const params = new URLSearchParams();
  dateStrings.forEach(d => params.append('dates[]', d));
  // Games are on v1
  return fetchAllPages<BdlGame>(BDL_BASE_V1, '/games', params);
}

async function fetchOddsForDates(dateStrings: string[]): Promise<BdlOddsRow[]> {
  const params = new URLSearchParams();
  dateStrings.forEach(d => params.append('dates[]', d));
  return fetchAllPages<BdlOddsRow>(BDL_BASE_V2, '/odds', params);
}

async function fetchPropsForGame(gameId: number): Promise<BdlPlayerProp[]> {
  const params = new URLSearchParams();
  params.set('game_id', String(gameId));
  const startTime = Date.now();
  try {
    // Use longer timeout for player props (60s) as they can be large
    const props = await fetchAllPages<BdlPlayerProp>(BDL_BASE_V2, '/odds/player_props', params, 60000);
    const fetchTime = Date.now() - startTime;
    
    // Debug: Log vendors per game with detailed breakdown
    const vendorsForGame = Array.from(new Set(props.map(p => p.vendor))).sort();
    const propsByVendor = new Map<string, number>();
    props.forEach(p => {
      const count = propsByVendor.get(p.vendor) || 0;
      propsByVendor.set(p.vendor, count + 1);
    });
    if (vendorsForGame.length > 0) {
      console.log(`📊 Game ${gameId}: BDL returned ${props.length} player props from ${vendorsForGame.length} vendors: ${vendorsForGame.join(', ')} (took ${fetchTime}ms)`);
      console.log(`📊 Game ${gameId}: Props per vendor:`, Array.from(propsByVendor.entries()).map(([v, c]) => `${v}:${c}`).join(', '));
    } else {
      console.log(`⚠️ Game ${gameId}: BDL returned 0 player props (took ${fetchTime}ms)`);
    }
    return props;
  } catch (err: any) {
    const fetchTime = Date.now() - startTime;
    console.error(`❌ Game ${gameId}: Failed to fetch player props after ${fetchTime}ms:`, err.message);
    throw err;
  }
}

function getDateStringsNext24h(): string[] {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return [today, tomorrow];
}

function normalizeTeamName(team: { abbreviation?: string; full_name?: string; name?: string } | null | undefined): string {
  if (!team) return 'N/A';
  return team.abbreviation || team.full_name || team.name || 'N/A';
}

function mapPropTypeToStatKey(propType: string): string | null {
  const map: Record<string, string> = {
    points: 'PTS',
    rebounds: 'REB',
    assists: 'AST',
    threes: 'THREES',
    blocks: 'BLK',
    steals: 'STL',
    turnovers: 'TO',
    points_rebounds_assists: 'PRA',
    points_rebounds: 'PR',
    points_assists: 'PA',
    rebounds_assists: 'RA',
    double_double: 'DD',
    triple_double: 'TD',
    points_first3min: 'PTS', // best-effort mapping
    rebounds_first3min: 'REB',
    assists_first3min: 'AST',
    points_1q: 'PTS',
    rebounds_1q: 'REB',
    assists_1q: 'AST',
  };
  return map[propType] || null;
}

function buildMilestoneEntry(line: string, odds: number | string | null): { line: string; over: string; under: string; variantLabel: string; isMilestone: boolean } {
  const price = odds === null || odds === undefined ? 'N/A' : formatOddsPrice(odds, 'milestone');
  return {
    line,
    over: price,
    under: 'N/A',
    variantLabel: 'Milestone',
    isMilestone: true,
  };
}

async function fetchPlayerPropsForGames(gameIds: number[], concurrency = 6): Promise<BdlPlayerProp[]> {
  const results: BdlPlayerProp[] = [];
  const errors: Array<{ gameId: number; error: string }> = [];
  let index = 0;

  async function worker() {
    while (index < gameIds.length) {
      const current = gameIds[index++];
      try {
        const props = await fetchPropsForGame(current);
        results.push(...props);
      } catch (err: any) {
        const errorMsg = err?.message || String(err);
        errors.push({ gameId: current, error: errorMsg });
        console.warn(`⚠️ Failed to fetch props for game ${current}:`, errorMsg);
      }
    }
  }

  const startTime = Date.now();
  const workers = Array.from({ length: Math.min(concurrency, gameIds.length) }, () => worker());
  await Promise.all(workers);
  const totalTime = Date.now() - startTime;
  
  if (errors.length > 0) {
    console.warn(`⚠️ ${errors.length} games failed to fetch player props:`, errors.map(e => `Game ${e.gameId}: ${e.error}`).join('; '));
  }
  console.log(`📊 Fetched player props for ${gameIds.length} games (${results.length} total props, ${errors.length} failed) in ${totalTime}ms`);
  
  return results;
}

export async function refreshOddsData(
  options: { source: RefreshSource } = { source: 'scheduler' }
) {
  const bdlApiKeyPresent = !!bdlAuthHeader;
  
  if (!bdlApiKeyPresent) {
    throw new Error('BallDontLie API key not configured');
  }

  console.log(`🔄 Starting BDL odds refresh... (source: ${options.source})`);
  const startTime = Date.now();
  const dates = getDateStringsNext24h();

  try {
    // 1) Fetch odds (spreads/ML/totals) for next 24h
    const oddsRows = await fetchOddsForDates(dates);
    const gameIds = Array.from(new Set(oddsRows.map(o => o.game_id)));
    const vendorsFromOdds = Array.from(new Set(oddsRows.map(o => o.vendor))).sort();
    console.log(`📊 BDL returned ${oddsRows.length} odds rows from ${vendorsFromOdds.length} vendors: ${vendorsFromOdds.join(', ')}`);
    console.log(`📊 Expected 10 vendors per docs: betmgm, fanduel, draftkings, bet365, caesars, ballybet, betway, betparx, betrivers, rebet`);
    const expectedGameVendors = ['betmgm', 'fanduel', 'draftkings', 'bet365', 'caesars', 'ballybet', 'betway', 'betparx', 'betrivers', 'rebet'];
    const missingGameVendors = expectedGameVendors.filter(v => !vendorsFromOdds.includes(v));
    console.log(`📊 Missing vendors: ${missingGameVendors.join(', ') || 'none'}`);
    if (vendorsFromOdds.some(v => !expectedGameVendors.includes(v))) {
      const extraVendors = vendorsFromOdds.filter(v => !expectedGameVendors.includes(v));
      console.log(`📊 Extra vendors (not in docs): ${extraVendors.join(', ')}`);
    }

    // 2) Fetch games to map game_id -> teams/date
    const gamesData = await fetchGamesForDates(dates);
    const gameMap = new Map<number, BdlGame>();
    for (const g of gamesData) gameMap.set(g.id, g);

    // 3) Fetch player props for those games
    const playerProps = await fetchPlayerPropsForGames(gameIds);
    const vendorsFromProps = Array.from(new Set(playerProps.map(p => p.vendor))).sort();
    const propsCountByVendor = new Map<string, number>();
    playerProps.forEach(p => {
      const count = propsCountByVendor.get(p.vendor) || 0;
      propsCountByVendor.set(p.vendor, count + 1);
    });
    console.log(`📊 BDL returned ${playerProps.length} player props from ${vendorsFromProps.length} vendors: ${vendorsFromProps.join(', ')}`);
    console.log(`📊 Props count per vendor:`, Array.from(propsCountByVendor.entries()).map(([v, c]) => `${v}:${c}`).sort().join(', '));
    console.log(`📊 Expected 8 vendors per docs: draftkings, betway, betrivers, ballybet, betparx, caesars, fanduel, rebet`);
    const expectedVendors = ['draftkings', 'betway', 'betrivers', 'ballybet', 'betparx', 'caesars', 'fanduel', 'rebet'];
    const missingVendors = expectedVendors.filter(v => !vendorsFromProps.includes(v));
    console.log(`📊 Missing vendors: ${missingVendors.join(', ') || 'none'}`);
    if (missingVendors.length > 0) {
      console.warn(`⚠️ WARNING: BDL API is missing ${missingVendors.length} expected vendors for player props!`);
    }

    // 4) Transform into our GameOdds structure
    const games: GameOdds[] = [];

    const oddsByGame = new Map<number, BdlOddsRow[]>();
    for (const row of oddsRows) {
      if (!oddsByGame.has(row.game_id)) oddsByGame.set(row.game_id, []);
      oddsByGame.get(row.game_id)!.push(row);
    }

    const propsByGame = new Map<number, BdlPlayerProp[]>();
    for (const p of playerProps) {
      if (!propsByGame.has(p.game_id)) propsByGame.set(p.game_id, []);
      propsByGame.get(p.game_id)!.push(p);
    }

    for (const gameId of gameIds) {
      const oddsList = oddsByGame.get(gameId) || [];
      const gameInfo = gameMap.get(gameId) || null;

      const gameOdds: GameOdds = {
        gameId: String(gameId),
        homeTeam: normalizeTeamName(gameInfo?.home_team),
        awayTeam: normalizeTeamName(gameInfo?.visitor_team),
        commenceTime: gameInfo?.date || '',
        bookmakers: [],
        playerPropsByBookmaker: {},
      };

      // Bookmakers for spreads/ML/totals
      // Group by vendor to avoid duplicates (BDL might return multiple rows per vendor)
      const bookmakersByVendor = new Map<string, any>();
      
      for (const row of oddsList) {
        let bookRow = bookmakersByVendor.get(row.vendor);
        if (!bookRow) {
          // Create new bookmaker entry
          bookRow = {
            name: row.vendor,
            H2H: { home: 'N/A', away: 'N/A' },
            Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
            Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
            PTS: { line: 'N/A', over: 'N/A', under: 'N/A' },
            REB: { line: 'N/A', over: 'N/A', under: 'N/A' },
            AST: { line: 'N/A', over: 'N/A', under: 'N/A' },
            THREES: { line: 'N/A', over: 'N/A', under: 'N/A' },
            BLK: { line: 'N/A', over: 'N/A', under: 'N/A' },
            STL: { line: 'N/A', over: 'N/A', under: 'N/A' },
            TO: { line: 'N/A', over: 'N/A', under: 'N/A' },
            DD: { yes: 'N/A', no: 'N/A' },
            TD: { yes: 'N/A', no: 'N/A' },
            PRA: { line: 'N/A', over: 'N/A', under: 'N/A' },
            PR: { line: 'N/A', over: 'N/A', under: 'N/A' },
            PA: { line: 'N/A', over: 'N/A', under: 'N/A' },
            RA: { line: 'N/A', over: 'N/A', under: 'N/A' },
            FIRST_BASKET: { yes: 'N/A', no: 'N/A' },
            meta: {
              gameHomeTeam: gameOdds.homeTeam,
              gameAwayTeam: gameOdds.awayTeam,
            },
          };
          bookmakersByVendor.set(row.vendor, bookRow);
        }

        // Update odds for this vendor (merge data from multiple rows if needed)
        if (row.moneyline_home_odds !== null && bookRow.H2H.home === 'N/A') {
          bookRow.H2H.home = formatOddsPrice(row.moneyline_home_odds, row.vendor);
        }
        if (row.moneyline_away_odds !== null && bookRow.H2H.away === 'N/A') {
          bookRow.H2H.away = formatOddsPrice(row.moneyline_away_odds, row.vendor);
        }
        if (row.spread_home_value !== null && bookRow.Spread.line === 'N/A') {
          bookRow.Spread.line = String(row.spread_home_value);
          bookRow.Spread.over = formatOddsPrice(row.spread_home_odds, row.vendor);
          bookRow.Spread.under = formatOddsPrice(row.spread_away_odds, row.vendor);
        }
        if (row.total_value !== null && bookRow.Total.line === 'N/A') {
          bookRow.Total.line = String(row.total_value);
          bookRow.Total.over = formatOddsPrice(row.total_over_odds, row.vendor);
          bookRow.Total.under = formatOddsPrice(row.total_under_odds, row.vendor);
        }
      }
      
      // Add all unique vendors to gameOdds
      gameOdds.bookmakers = Array.from(bookmakersByVendor.values());
      
      if (gameOdds.bookmakers.length > 0) {
        const vendorNames = gameOdds.bookmakers.map(b => b.name).sort().join(', ');
        console.log(`📊 Game ${gameId} processed ${gameOdds.bookmakers.length} unique vendors for game odds: ${vendorNames}`);
      }

      // Player props
      const props = propsByGame.get(gameId) || [];
      // Allowed milestone values for points only: 10, 15, 20, 25, 30
      const ALLOWED_POINTS_MILESTONES = [10, 15, 20, 25, 30];
      
      // Debug: Track which vendors have which prop types
      const vendorPropTypes = new Map<string, Set<string>>();
      let skippedProps = 0;
      let processedProps = 0;
      
      for (const prop of props) {
        const statKey = mapPropTypeToStatKey(prop.prop_type);
        if (!statKey) {
          skippedProps++;
          continue;
        }
        processedProps++;
        
        // Track vendor and prop type
        if (!vendorPropTypes.has(prop.vendor)) {
          vendorPropTypes.set(prop.vendor, new Set());
        }
        vendorPropTypes.get(prop.vendor)!.add(prop.prop_type);

        const playerName = getPlayerNameFromMapping(prop.player_id) || `Player ${prop.player_id}`;
        const vendorName = prop.vendor;

        if (!gameOdds.playerPropsByBookmaker[vendorName]) {
          gameOdds.playerPropsByBookmaker[vendorName] = {};
        }
        if (!gameOdds.playerPropsByBookmaker[vendorName][playerName]) {
          gameOdds.playerPropsByBookmaker[vendorName][playerName] = {};
        }

        const bucket = gameOdds.playerPropsByBookmaker[vendorName][playerName] as Record<string, any>;

        const pushEntry = (entry: any) => {
          const current = bucket[statKey];
          if (!Array.isArray(current)) {
            bucket[statKey] = current ? [current] : [];
          }
          const list = bucket[statKey] as Array<any>;
          list.push(entry);
        };

        if (prop.market?.type === 'over_under') {
          // Parse line_value as number to ensure proper sorting
          const lineNum = parseFloat(prop.line_value);
          const line = Number.isFinite(lineNum) ? lineNum : parseFloat(String(prop.line_value)) || 0;
          
          // Get raw odds values from BDL - use them as-is, BDL should return them correctly
          const rawOverOdds = prop.market.over_odds;
          const rawUnderOdds = prop.market.under_odds;
          
          // Format odds
          const over = formatOddsPrice(rawOverOdds, vendorName);
          const under = formatOddsPrice(rawUnderOdds, vendorName);
          
          pushEntry({
            line,
            over,
            under,
          });
        } else if (prop.market?.type === 'milestone') {
          // Only include milestones for points prop type, from DraftKings or FanDuel only
          // Normal over/under lines can come from all bookmakers
          const vendorLower = (vendorName || prop.vendor || '').toLowerCase().trim();
          // Check for exact match or contains (handles variations like "draftkings pick6")
          const isAllowedMilestoneVendor = 
            vendorLower === 'draftkings' || 
            vendorLower === 'fanduel' ||
            vendorLower.includes('draftkings') ||
            vendorLower.includes('fanduel');
          
          // Debug: only log milestones in development (too verbose for production)
          if (process.env.NODE_ENV === 'development' && prop.prop_type === 'points') {
            const numericLine = Number(prop.line_value);
            if (ALLOWED_POINTS_MILESTONES.includes(numericLine)) {
              console.log(`🎯 Milestone ${prop.line_value}+ from vendor: "${vendorName}" (lowercase: "${vendorLower}") - Allowed: ${isAllowedMilestoneVendor}`);
            }
          }
          
          // CRITICAL: Skip milestones from non-allowed vendors (Caesars, Betway, etc.)
          if (!isAllowedMilestoneVendor) {
            // Don't add this milestone at all - skip to next prop
            continue;
          }
          
          // Only process points milestones from allowed vendors
          if (prop.prop_type === 'points') {
            const numericLine = Number(prop.line_value);
            const oddsVal = prop.market.odds;
            
            // Check if line value is in allowed list and odds are valid
            if (Number.isFinite(numericLine) && 
                ALLOWED_POINTS_MILESTONES.includes(numericLine) &&
                oddsVal !== null && 
                oddsVal !== undefined && 
                typeof oddsVal === 'number' && 
                Number.isFinite(oddsVal)) {
              pushEntry(buildMilestoneEntry(prop.line_value, oddsVal));
            }
          }
          // For all other prop types, non-allowed milestone values, or non-DK/FD vendors, skip (leave blank)
        }
      }
      
      // Log vendors for debugging
      const allVendors = new Set<string>();
      gameOdds.bookmakers.forEach(b => allVendors.add(b.name));
      Object.keys(gameOdds.playerPropsByBookmaker).forEach(v => allVendors.add(v));
      if (allVendors.size > 0) {
        console.log(`📊 Game ${gameId} all vendors: ${Array.from(allVendors).sort().join(', ')}`);
        const playerPropVendors = Object.keys(gameOdds.playerPropsByBookmaker).sort();
        console.log(`📊 Game ${gameId} player prop vendors: ${playerPropVendors.length} - ${playerPropVendors.join(', ')}`);
        console.log(`📊 Game ${gameId} processed ${processedProps} props, skipped ${skippedProps} props (unmapped prop types)`);
        if (vendorPropTypes.size > 0) {
          console.log(`📊 Game ${gameId} vendors and their prop types:`, Array.from(vendorPropTypes.entries()).map(([v, types]) => `${v}:[${Array.from(types).join(',')}]`).join('; '));
        }
      }

      games.push(gameOdds);
    }
    
    // Summary: Log all unique vendors found across all games
    const allUniqueVendors = new Set<string>();
    games.forEach(g => {
      g.bookmakers.forEach(b => allUniqueVendors.add(b.name));
      Object.keys(g.playerPropsByBookmaker).forEach(v => allUniqueVendors.add(v));
    });
    console.log(`📊 SUMMARY: Found ${allUniqueVendors.size} unique vendors across all games: ${Array.from(allUniqueVendors).sort().join(', ')}`);
    const allPlayerPropVendors = new Set<string>();
    games.forEach(g => {
      Object.keys(g.playerPropsByBookmaker).forEach(v => allPlayerPropVendors.add(v));
    });
    console.log(`📊 SUMMARY: Found ${allPlayerPropVendors.size} unique player prop vendors: ${Array.from(allPlayerPropVendors).sort().join(', ')}`);

    const now = new Date();
    const ttlMinutes = 2 * 60; // cache for 2 hours
    const nextUpdate = new Date(now.getTime() + ttlMinutes * 60 * 1000);

    // Prune games that started more than 1 hour ago (player props not needed after start)
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const nowMs = now.getTime();
    const prunedGames = games.filter((g) => {
      const startMs = g?.commenceTime ? new Date(g.commenceTime).getTime() : Number.NaN;
      // Keep if start time invalid (be conservative), or starts in future, or started within past hour
      if (!Number.isFinite(startMs)) return true;
      return startMs >= (nowMs - ONE_HOUR_MS);
    });

    if (prunedGames.length !== games.length) {
      console.log(`🧹 Pruned ${games.length - prunedGames.length} games that started >1h ago. Keeping ${prunedGames.length}.`);
    }

    // If pruning removed everything, keep previous cache to avoid blanking the UI between windows
    if (prunedGames.length === 0) {
      console.warn('[Odds Cache] ⚠️ Pruned games is empty (all games started >1h ago). Keeping previous cache.');
      const previous = (await getNBACache<OddsCache>(ODDS_CACHE_KEY)) || cache.get<OddsCache>(ODDS_CACHE_KEY);
      if (previous) {
        return {
          success: true,
          gamesCount: previous.games.length,
          lastUpdated: previous.lastUpdated,
          nextUpdate: previous.nextUpdate,
          note: 'served previous cache because pruning removed all games'
        };
      }
    }

    const newCache: OddsCache = {
      games: prunedGames,
      lastUpdated: now.toISOString(),
      nextUpdate: nextUpdate.toISOString(),
    };

    // If the new payload is empty, keep the previous cache (avoid zeroing)
    if (games.length === 0) {
      console.warn('[Odds Cache] ⚠️ Refresh returned 0 games. Keeping previous cache.');
      const previous = (await getNBACache<OddsCache>(ODDS_CACHE_KEY)) || cache.get<OddsCache>(ODDS_CACHE_KEY);
      if (previous) {
        return {
          success: true,
          gamesCount: previous.games.length,
          lastUpdated: previous.lastUpdated,
          nextUpdate: previous.nextUpdate,
          note: 'served previous cache because refresh returned 0 games'
        };
      }
      // If no previous cache, fall through and set empty (rare)
    }

    // Cache the data in both in-memory and Supabase (persistent, shared across instances)
    cache.set(ODDS_CACHE_KEY, newCache, ttlMinutes);
    await setNBACache(ODDS_CACHE_KEY, 'odds', newCache, ttlMinutes);
    console.log(`[Odds Cache] 💾 Cached BDL odds to Supabase (${games.length} games)`);
    
    // Trigger background player props update (non-blocking)
    // This ensures player props cache updates automatically when odds change
    // Users continue seeing old cached data until new cache is ready
    try {
      // Call background update endpoint internally (don't await - fire and forget)
      const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}` 
        : process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      
      fetch(`${baseUrl}/api/nba/player-props/background-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Don't wait for response - this is fire-and-forget
      }).catch(err => {
        // Silently fail - this is background processing
        if (process.env.NODE_ENV === 'development') {
          console.log('[Odds Refresh] Background player props update triggered (may fail in dev if server not running)');
        }
      });
      
      console.log(`[Odds Refresh] 🔄 Triggered background player props update (non-blocking)`);
    } catch (err) {
      // Ignore errors - background update is optional
      if (process.env.NODE_ENV === 'development') {
        console.log('[Odds Refresh] Could not trigger background update (expected in dev)');
      }
    }

    // Save snapshots (line movement) only if enabled
    if (process.env.NODE_ENV === 'production') {
      try {
        await Promise.race([
          saveOddsSnapshots(games),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Snapshot save timeout after 60s')), 60000)
          )
        ]);
        console.log('📸 Odds snapshots saved to database');
      } catch (error) {
        console.error('❌ Failed to save odds snapshots:', error);
      }
    } else {
      console.log('⚠️ Skipping odds snapshots in development mode');
    }

    const elapsed = Date.now() - startTime;
    console.log(`✅ BDL odds refresh complete in ${elapsed}ms - ${games.length} games cached`);

    return {
      success: true,
      gamesCount: games.length,
      lastUpdated: newCache.lastUpdated,
      nextUpdate: newCache.nextUpdate,
      apiCalls: oddsRows.length + playerProps.length, // approximate
      elapsed: `${elapsed}ms`
    };
  } catch (error) {
    console.error('❌ BDL odds refresh failed:', error);
    throw error;
  }
}

export async function ensureOddsCache(options: {
  source: RefreshSource;
  force?: boolean;
}): Promise<OddsCache | null> {
  const existing = cache.get<OddsCache>(ODDS_CACHE_KEY);

  // If we have cache and not forcing, return it immediately but trigger a background refresh if stale
  if (existing && !options.force) {
    const lastUpdated = existing.lastUpdated ? new Date(existing.lastUpdated).getTime() : 0;
    const ageMinutes = lastUpdated ? (Date.now() - lastUpdated) / 60000 : Infinity;
    const STALE_MINUTES = 45; // background refresh threshold requested

    if (ageMinutes > STALE_MINUTES && !ongoingRefresh) {
      console.log(`[ensureOddsCache] Cache age ${ageMinutes.toFixed(1)}m > ${STALE_MINUTES}m. Triggering background refresh (non-blocking).`);
      ensureOddsCache({ source: 'ensureOddsCache', force: true }).catch(err => {
        console.warn('[ensureOddsCache] Background refresh failed:', err);
      });
    }

    return existing;
  }

  if (!ongoingRefresh) {
    ongoingRefresh = (async () => {
      try {
        await refreshOddsData({ source: options.source });
      } catch (error) {
        console.error('❌ ensureOddsCache refresh failed:', error);
        throw error;
      }
      return cache.get<OddsCache>(ODDS_CACHE_KEY);
    })().finally(() => {
      ongoingRefresh = null;
    });
  }

  return ongoingRefresh;
}

/**
 * Transform The Odds API response into our cache format
 */
function transformOddsData(gamesData: any[], playerPropsData: any[]): GameOdds[] {
  const games: GameOdds[] = [];

  for (const game of gamesData) {
    const gameOdds: GameOdds = {
      gameId: game.id,
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      commenceTime: game.commence_time,
      bookmakers: [],
      playerPropsByBookmaker: {},
    };

    // Process bookmakers for game odds (only allowed bookmakers)
    for (const bookmaker of game.bookmakers || []) {
      // Filter: Only include allowed bookmakers
      if (!isAllowedBookmaker(bookmaker.title)) {
        continue; // Skip this bookmaker
      }
      
      const bookRow: any = {
        name: bookmaker.title,
        H2H: { home: 'N/A', away: 'N/A' },
        Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
        Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
        PTS: { line: 'N/A', over: 'N/A', under: 'N/A' },
        REB: { line: 'N/A', over: 'N/A', under: 'N/A' },
        AST: { line: 'N/A', over: 'N/A', under: 'N/A' },
        THREES: { line: 'N/A', over: 'N/A', under: 'N/A' },
        BLK: { line: 'N/A', over: 'N/A', under: 'N/A' },
        STL: { line: 'N/A', over: 'N/A', under: 'N/A' },
        TO: { line: 'N/A', over: 'N/A', under: 'N/A' },
        DD: { yes: 'N/A', no: 'N/A' },
        TD: { yes: 'N/A', no: 'N/A' },
        PRA: { line: 'N/A', over: 'N/A', under: 'N/A' },
        PR: { line: 'N/A', over: 'N/A', under: 'N/A' },
        PA: { line: 'N/A', over: 'N/A', under: 'N/A' },
        RA: { line: 'N/A', over: 'N/A', under: 'N/A' },
        FIRST_BASKET: { yes: 'N/A', no: 'N/A' },
      };

      for (const market of bookmaker.markets || []) {
        if (market.key === 'h2h') {
          const homeOutcome = market.outcomes.find((o: any) => o.name === game.home_team);
          const awayOutcome = market.outcomes.find((o: any) => o.name === game.away_team);
          if (homeOutcome) bookRow.H2H.home = String(homeOutcome.price);
          if (awayOutcome) bookRow.H2H.away = String(awayOutcome.price);
        } else if (market.key === 'spreads') {
          const homeOutcome = market.outcomes.find((o: any) => o.name === game.home_team);
          const awayOutcome = market.outcomes.find((o: any) => o.name === game.away_team);
          if (homeOutcome) {
            bookRow.Spread.line = String(homeOutcome.point);
            bookRow.Spread.over = String(homeOutcome.price);
          }
          if (awayOutcome) {
            bookRow.Spread.under = String(awayOutcome.price);
          }
        } else if (market.key === 'totals') {
          const overOutcome = market.outcomes.find((o: any) => o.name === 'Over');
          const underOutcome = market.outcomes.find((o: any) => o.name === 'Under');
          if (overOutcome) {
            bookRow.Total.line = String(overOutcome.point);
            bookRow.Total.over = String(overOutcome.price);
          }
          if (underOutcome) {
            bookRow.Total.under = String(underOutcome.price);
          }
        }
      }

      gameOdds.bookmakers.push(bookRow);
    }

    games.push(gameOdds);
  }

  // Process player props if available
  if (playerPropsData && Array.isArray(playerPropsData)) {
    // Debug: Log all bookmakers found in player props
    const allBookmakers = new Set<string>();
    for (const game of playerPropsData) {
      for (const bookmaker of game.bookmakers || []) {
        if (bookmaker.title) {
          allBookmakers.add(bookmaker.title);
        }
      }
    }
    
    if (allBookmakers.size > 0) {
      const sortedBookmakers = Array.from(allBookmakers).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      // Only log if we're not filtering at API level (for debugging)
      if (allBookmakers.size > 0) {
        console.log(`📊 Found ${allBookmakers.size} unique bookmakers in player props (filtered at API level):`, sortedBookmakers.join(', '));
      }
    }
    
    for (const game of playerPropsData) {
      const matchingGame = games.find(g => g.gameId === game.id);
      if (!matchingGame) continue;

      for (const bookmaker of game.bookmakers || []) {
        // Filter: Only include allowed bookmakers
        if (!isAllowedBookmaker(bookmaker.title)) {
          continue; // Skip this bookmaker
        }
        
        const ensureBookmakerEntry = (name: string) => {
          if (!matchingGame.playerPropsByBookmaker[name]) {
            matchingGame.playerPropsByBookmaker[name] = {};
          }
        };

        const ensurePlayerBucket = (bookName: string, playerNameKey: string) => {
          ensureBookmakerEntry(bookName);
          const bookBucket = matchingGame.playerPropsByBookmaker[bookName];
          if (!bookBucket[playerNameKey]) {
            bookBucket[playerNameKey] = {};
          }
          return bookBucket[playerNameKey] as Record<string, any>;
        };

        const pushStatEntry = (
          bookName: string,
          playerNameKey: string,
          statKeyName: string,
          entry: { 
            line: string; 
            over: string; 
            under: string; 
            isPickem?: boolean; 
            variantLabel?: string | null;
            multiplier?: number;
            goblinCount?: number;
            demonCount?: number;
          }
        ) => {
          const playerBucket = ensurePlayerBucket(bookName, playerNameKey);
          const current = playerBucket[statKeyName];
          if (!Array.isArray(current)) {
            playerBucket[statKeyName] = current ? [current] : [];
          }
          const list = playerBucket[statKeyName] as Array<any>;
          const exists = list.some((e: any) =>
            e.line === entry.line &&
            e.over === entry.over &&
            e.under === entry.under &&
            (e.variantLabel || null) === (entry.variantLabel || null)
          );
          if (!exists) {
            list.push(entry);
          }
        };

        // Initialize bookmaker's player props if needed
        const baseBookmakerName = bookmaker.title;
        ensureBookmakerEntry(baseBookmakerName);

        for (const market of bookmaker.markets || []) {
          // Map API market keys to our stat keys
          const marketKeyMap: Record<string, string> = {
            'player_points': 'PTS',
            'player_rebounds': 'REB',
            'player_assists': 'AST',
            'player_threes': 'THREES',
            'player_blocks': 'BLK',
            'player_steals': 'STL',
            'player_turnovers': 'TO',
            'player_double_double': 'DD',
            'player_triple_double': 'TD',
            'player_points_rebounds_assists': 'PRA',
            'player_points_rebounds': 'PR',
            'player_points_assists': 'PA',
            'player_rebounds_assists': 'RA',
            'player_first_basket': 'FIRST_BASKET',
          };

          const statKey = marketKeyMap[market.key.replace(/_alternate$/, '')];
          if (!statKey) continue;
          
          const registerPickemVariant = (variantLabel: 'Goblin' | 'Demon' | null, lineValue: number, playerNameKey: string, statBucket: string) => {
            pushStatEntry(baseBookmakerName, playerNameKey, statBucket, {
              line: String(lineValue),
              over: 'Pick\'em',
              under: 'Pick\'em',
              isPickem: true,
              variantLabel,
            });
          };

        for (const outcome of market.outcomes || []) {
          const playerName = outcome.description || outcome.name;
          if (!playerName || playerName === 'Over' || playerName === 'Under' || playerName === 'Yes' || playerName === 'No') continue;

          const isAlternateMarket = /_alternate$/.test(market.key);
          const isPickemBook = isPickemBookmaker(baseBookmakerName);

          // Handle over/under markets (most props)
          if (['PTS', 'REB', 'AST', 'THREES', 'BLK', 'STL', 'TO', 'PRA', 'PR', 'PA', 'RA'].includes(statKey)) {
            // Skip straight entries for pick'em-only books
            if (isPickemBook && !isAlternateMarket) continue;

            const allOvers = market.outcomes.filter((o: any) => o.name === 'Over' && o.description === playerName);
            const allUnders = market.outcomes.filter((o: any) => o.name === 'Under' && o.description === playerName);
            
            // Special handling for PrizePicks alternate markets (pick'em style - only Over outcomes)
            if (isPickemBook && isAlternateMarket && allOvers.length > 0 && allUnders.length === 0) {
              // PrizePicks alternate markets only have Over outcomes - treat each as a pick'em line
              
              // Calculate market baseline line from other bookmakers (excluding PrizePicks)
              // This is used to determine if PrizePicks line is a Demon (upward) or Goblin (downward)
              let marketBaseline: number | null = null;
              const allBookmakers = game.bookmakers || [];
              const nonPrizePicksLines: number[] = [];
              
              for (const book of allBookmakers) {
                const bookName = (book as any)?.name || '';
                if (bookName.toLowerCase().includes('prizepicks')) continue;
                
                const statData = (book as any)?.[statKey];
                if (statData && statData.line && statData.line !== 'N/A') {
                  const lineValue = parseFloat(String(statData.line));
                  if (!isNaN(lineValue)) {
                    nonPrizePicksLines.push(lineValue);
                  }
                }
              }
              
              // Calculate average of non-PrizePicks lines as market baseline
              if (nonPrizePicksLines.length > 0) {
                marketBaseline = nonPrizePicksLines.reduce((sum, line) => sum + line, 0) / nonPrizePicksLines.length;
              }
              
              for (const over of allOvers) {
                const prizepicksLine = parseFloat(String(over.point));
                if (isNaN(prizepicksLine)) continue;
                
                // Check if API provides goblin_count and demon_count
                // Log the outcome object to see what fields are available
                if (process.env.NODE_ENV !== 'production') {
                  console.log('[PrizePicks Debug] Outcome object keys:', Object.keys(over));
                  console.log('[PrizePicks Debug] Outcome object:', JSON.stringify(over, null, 2));
                  if ((over as any).goblin_count !== undefined || (over as any).goblinCount !== undefined) {
                    console.log('[PrizePicks Debug] Found goblin_count in API response!');
                  }
                  if ((over as any).demon_count !== undefined || (over as any).demonCount !== undefined) {
                    console.log('[PrizePicks Debug] Found demon_count in API response!');
                  }
                }
                
                // Check for goblin_count and demon_count in various possible field names
                const goblinCountFromAPI = (over as any).goblin_count ?? (over as any).goblinCount ?? (over as any).goblin_count ?? undefined;
                const demonCountFromAPI = (over as any).demon_count ?? (over as any).demonCount ?? (over as any).demon_count ?? undefined;
                
                // Determine variant based on line comparison to market baseline
                // Demon = upward adjustment (PrizePicks line > market line)
                // Goblin = downward adjustment (PrizePicks line < market line)
                let variantLabel: 'Goblin' | 'Demon';
                if (marketBaseline !== null) {
                  // Compare to market baseline
                  variantLabel = prizepicksLine > marketBaseline ? 'Demon' : 'Goblin';
                } else {
                  // Fallback: use price-based determination if no baseline available
                  const priceValue = over.price;
                  variantLabel = (priceValue === 100 || priceValue === -100) ? 'Demon' : 'Goblin';
                }
                
                // PrizePicks multiplier calculation based on goblin/demon counts
                // Formula: multiplier = 1 + (0.10 * count)
                // Use API-provided counts if available, otherwise estimate from price
                let goblinCount: number | undefined = goblinCountFromAPI;
                let demonCount: number | undefined = demonCountFromAPI;
                let multiplier: number | undefined = undefined;
                
                // If API provided counts, use them directly
                if (goblinCount !== undefined) {
                  multiplier = 1 + (0.10 * goblinCount);
                  if (process.env.NODE_ENV !== 'production') {
                    console.log(`[PrizePicks] Using API goblin_count: ${goblinCount}, multiplier: ${multiplier}`);
                  }
                } else if (demonCount !== undefined) {
                  multiplier = 1 + (0.10 * demonCount);
                  if (process.env.NODE_ENV !== 'production') {
                    console.log(`[PrizePicks] Using API demon_count: ${demonCount}, multiplier: ${multiplier}`);
                  }
                } else {
                  // API didn't provide counts - estimate from price
                  const priceValue = over.price;
                  if (priceValue !== null && priceValue !== undefined) {
                    const priceNum = typeof priceValue === 'number' ? priceValue : parseFloat(String(priceValue));
                    if (!isNaN(priceNum)) {
                      // Estimate counts from price
                      if (variantLabel === 'Goblin') {
                        // Estimate goblin count: multiplier = 1 + (0.10 * goblin_count)
                        if (Math.abs(priceNum) >= 100) {
                          const estimatedMultiplier = (Math.abs(priceNum) / 100) + 1;
                          goblinCount = Math.round((estimatedMultiplier - 1) / 0.10);
                          multiplier = 1 + (0.10 * goblinCount);
                        } else if (priceNum > 1 && priceNum <= 10) {
                          goblinCount = Math.round((priceNum - 1) / 0.10);
                          multiplier = 1 + (0.10 * goblinCount);
                        }
                      } else if (variantLabel === 'Demon') {
                        // Estimate demon count: multiplier = 1 + (0.10 * demon_count)
                        if (Math.abs(priceNum) >= 100) {
                          const estimatedMultiplier = (Math.abs(priceNum) / 100) + 1;
                          demonCount = Math.round((estimatedMultiplier - 1) / 0.10);
                          multiplier = 1 + (0.10 * demonCount);
                        } else if (priceNum > 1 && priceNum <= 10) {
                          demonCount = Math.round((priceNum - 1) / 0.10);
                          multiplier = 1 + (0.10 * demonCount);
                        }
                      }
                    }
                  }
                  
                  // Fallback: if we couldn't calculate, use default estimates
                  if (multiplier === undefined) {
                    if (variantLabel === 'Goblin') {
                      goblinCount = 1; // Default: 1 goblin = 1.10x
                      multiplier = 1.10;
                    } else {
                      demonCount = 1; // Default: 1 demon = 1.10x
                      multiplier = 1.10;
                    }
                  }
                }

                pushStatEntry(baseBookmakerName, playerName, statKey, {
                  line: String(over.point),
                  over: 'Pick\'em',
                  under: 'Pick\'em',
                  isPickem: true,
                  variantLabel,
                  multiplier,
                  goblinCount,
                  demonCount,
                });

                registerPickemVariant(variantLabel, prizepicksLine, playerName, statKey);
              }
              continue; // Skip the normal Over/Under matching logic
            }
            
            // Normal Over/Under matching for other bookmakers
            if (allOvers.length === 0 || allUnders.length === 0) continue;
            
            for (const over of allOvers) {
              const matchingUnder = allUnders.find((u: any) => Math.abs(parseFloat(u.point) - parseFloat(over.point)) < 0.01);
              if (!matchingUnder) continue;

              const formattedOver = isAlternateMarket && isPickemBook ? 'Pick\'em' : formatOddsPrice(over.price, baseBookmakerName);
              const formattedUnder = isAlternateMarket && isPickemBook ? 'Pick\'em' : formatOddsPrice(matchingUnder.price, baseBookmakerName);
              const variantLabel = isPickemBook && isAlternateMarket
                ? determinePickemVariant(formattedOver, formattedUnder) || 'Goblin'
                : null;

              pushStatEntry(baseBookmakerName, playerName, statKey, {
                line: String(over.point),
                over: formattedOver,
                under: formattedUnder,
                isPickem: isPickemBook && isAlternateMarket,
                variantLabel,
              });

              if (isPickemBook && isAlternateMarket) {
                registerPickemVariant(variantLabel, parseFloat(String(over.point)), playerName, statKey);
              }
            }
          }
          // Handle yes/no markets (double-double, triple-double, first basket)
          else if (['DD', 'TD', 'FIRST_BASKET'].includes(statKey)) {
            const yesOutcome = market.outcomes.find((o: any) => o.name === 'Yes' && o.description === playerName);
            const noOutcome = market.outcomes.find((o: any) => o.name === 'No' && o.description === playerName);

            if (yesOutcome && noOutcome) {
              const bucket = ensurePlayerBucket(baseBookmakerName, playerName);
              bucket[statKey] = {
                yes: formatOddsPrice(yesOutcome.price, baseBookmakerName),
                no: formatOddsPrice(noOutcome.price, baseBookmakerName),
              };
            }
          }
        }
      }
    }
    }
  }

  return games;
}