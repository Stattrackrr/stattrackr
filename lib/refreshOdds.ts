/* eslint-disable @typescript-eslint/no-explicit-any */
import cache, { CACHE_TTL } from './cache';
import type { GameOdds, OddsCache } from '@/app/api/odds/refresh/route';
import { createClient } from '@supabase/supabase-js';

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

// Store all odds data in a single cache entry
const ODDS_CACHE_KEY = 'all_nba_odds';

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

// Allowed bookmakers for odds snapshots (to reduce database size)
// Only these bookmakers will have their snapshots saved to reduce database usage
const ALLOWED_BOOKMAKERS = [
  'fanduel',
  'prizepicks',
  'prize picks', // Handle space variation
  'draftkings',
  'betonline',
  'betonline.ag',
  'betonlineag',
  'fanatics',
  'fanatics sportsbook', // Handle full name variation
  'fanatics betting and gaming' // Handle full name variation
];

/**
 * Normalize bookmaker name and check if it's in the allowed list
 * Handles variations in naming (case, spaces, punctuation)
 */
function isAllowedBookmaker(bookmakerName: string): boolean {
  if (!bookmakerName) return false;
  
  const normalized = bookmakerName.toLowerCase().trim().replace(/[.\s]/g, '');
  
  return ALLOWED_BOOKMAKERS.some(allowed => {
    const normalizedAllowed = allowed.toLowerCase().trim().replace(/[.\s]/g, '');
    return normalized === normalizedAllowed || 
           normalized.includes(normalizedAllowed) ||
           normalizedAllowed.includes(normalized);
  });
}

async function saveOddsSnapshots(games: GameOdds[]) {
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
 * Fetch all NBA odds from The Odds API
 * This function is called by the scheduler and the API route
 */
type RefreshSource =
  | 'scheduler'
  | 'api/odds/refresh'
  | 'api/odds'
  | 'api/player-props'
  | 'ensureOddsCache';

let ongoingRefresh: Promise<OddsCache | null> | null = null;

export async function refreshOddsData(
  options: { source: RefreshSource } = { source: 'scheduler' }
) {
  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  
  if (!ODDS_API_KEY) {
    throw new Error('Odds API key not configured');
  }

    console.log(`🔄 Starting bulk odds refresh... (source: ${options.source})`);
  const startTime = Date.now();
  
  try {
    // Fetch all NBA games with game odds (H2H, spreads, totals)
    const gamesUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds`;
    const baseRegions = process.env.ODDS_REGIONS || 'us,us_dfs';
    const gamesParams = new URLSearchParams({
      apiKey: ODDS_API_KEY,
      regions: baseRegions,
      markets: 'h2h,spreads,totals',
      oddsFormat: 'american',
      dateFormat: 'iso',
    });

    const gamesResponse = await fetch(`${gamesUrl}?${gamesParams}`);
    const gamesData = await gamesResponse.json();

    if (!gamesResponse.ok) {
      throw new Error(`Odds API error: ${gamesData.message || 'Unknown error'}`);
    }

    // Fetch player props for games starting soon (default: next 20 hours)
    const now = new Date();
    const propsWindowHours = Number(process.env.ODDS_PROPS_WINDOW_HOURS || '20');
    const cutoffTime = new Date(now.getTime() + propsWindowHours * 60 * 60 * 1000);
    
    const upcomingGames = gamesData.filter((game: any) => {
      const gameTime = new Date(game.commence_time);
      return gameTime >= now && gameTime <= cutoffTime;
    });
    
    console.log(`📊 Fetching player props for ${upcomingGames.length}/${gamesData.length} games (next ${propsWindowHours}h)`);
    console.log(`⏰ Cutoff: ${cutoffTime.toLocaleString()}`);
    if (upcomingGames.length > 0) {
      console.log(`🏀 Sample games: ${upcomingGames.slice(0, 3).map((g: any) => `${g.home_team} vs ${g.away_team} at ${new Date(g.commence_time).toLocaleString()}`).join(', ')}`);
    }
    
    // Include standard and alternate markets (DFS pick'em multipliers live in *_alternate keys)
    const playerPropsMarkets = [
      // Standard markets
      'player_points',
      'player_rebounds',
      'player_assists',
      'player_threes',
      'player_points_rebounds_assists',
      'player_points_rebounds',
      'player_points_assists',
      'player_rebounds_assists',
      // Alternate (DFS pick’em goblins/demons) markets
      'player_points_alternate',
      'player_rebounds_alternate',
      'player_assists_alternate',
      'player_threes_alternate',
      'player_points_rebounds_assists_alternate',
      'player_points_rebounds_alternate',
      'player_points_assists_alternate',
      'player_rebounds_assists_alternate',
    ].join(',');
    const playerPropsPromises = upcomingGames.map(async (game: any) => {
      try {
        const eventUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${game.id}/odds`;
        const eventParams = new URLSearchParams({
          apiKey: ODDS_API_KEY,
          regions: baseRegions,
          markets: playerPropsMarkets,
          oddsFormat: 'american',
          dateFormat: 'iso',
        });
        
        const response = await fetch(`${eventUrl}?${eventParams}`);
        if (response.ok) {
          return await response.json();
        }
        return null;
      } catch (error) {
        console.warn(`Failed to fetch props for game ${game.id}:`, error);
        return null;
      }
    });
    
    const playerPropsResults = await Promise.all(playerPropsPromises);
    const playerPropsData = playerPropsResults.filter(r => r !== null);
    console.log(`✅ Player props fetched for ${playerPropsData.length}/${gamesData.length} games`);
    console.log(`⚠️  Note: Each game with props counts as 1 additional API call`);
    console.log(`📊 Total API calls: ${1 + playerPropsData.length} (1 games + ${playerPropsData.length} props)`);
    

    // Transform the data
    const games: GameOdds[] = transformOddsData(gamesData, playerPropsData);

    const nextUpdate = new Date(now.getTime() + CACHE_TTL.ODDS * 60 * 1000);

    const oddsCache: OddsCache = {
      games,
      lastUpdated: now.toISOString(),
      nextUpdate: nextUpdate.toISOString(),
    };

    // Cache the data
    cache.set(ODDS_CACHE_KEY, oddsCache, CACHE_TTL.ODDS);

    // Save snapshots to database for line movement tracking
    // Skip in development to prevent server freezing
    if (process.env.NODE_ENV === 'production') {
      try {
        // Add 30-second timeout to prevent hanging (saving 5000+ snapshots can take time)
        await Promise.race([
          saveOddsSnapshots(games),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Snapshot save timeout after 30s')), 30000)
          )
        ]);
        console.log('📸 Odds snapshots saved to database');
      } catch (error) {
        console.error('❌ Failed to save odds snapshots:', error);
        // Don't fail the whole refresh if snapshot saving fails
      }
    } else {
      console.log('⚠️ Skipping odds snapshots in development mode');
    }

    const elapsed = Date.now() - startTime;
    console.log(`✅ Bulk odds refresh complete in ${elapsed}ms - ${games.length} games cached`);
    console.log('Sample game teams:', games.slice(0, 3).map(g => `${g.homeTeam} vs ${g.awayTeam}`));

    return {
      success: true,
      gamesCount: games.length,
      lastUpdated: oddsCache.lastUpdated,
      nextUpdate: oddsCache.nextUpdate,
      apiCalls: 1 + playerPropsData.length, // 1 for games + 1 per game with props
      elapsed: `${elapsed}ms`
    };
  } catch (error) {
    console.error('❌ Bulk odds refresh failed:', error);
    throw error;
  }
}

export async function ensureOddsCache(options: {
  source: RefreshSource;
  force?: boolean;
}): Promise<OddsCache | null> {
  const existing = cache.get<OddsCache>(ODDS_CACHE_KEY);
  if (existing && !options.force) {
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

    // Process bookmakers for game odds
    for (const bookmaker of game.bookmakers || []) {
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
    
    for (const game of playerPropsData) {
      const matchingGame = games.find(g => g.gameId === game.id);
      if (!matchingGame) continue;

      for (const bookmaker of game.bookmakers || []) {
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
          entry: { line: string; over: string; under: string; isPickem?: boolean; variantLabel?: string | null }
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
              for (const over of allOvers) {
                // Determine variant based on price: +100 (100) = Demon, others = Goblin
                const priceValue = over.price;
                const variantLabel: 'Goblin' | 'Demon' = (priceValue === 100 || priceValue === -100) ? 'Demon' : 'Goblin';

                pushStatEntry(baseBookmakerName, playerName, statKey, {
                  line: String(over.point),
                  over: 'Pick\'em',
                  under: 'Pick\'em',
                  isPickem: true,
                  variantLabel,
                });

                registerPickemVariant(variantLabel, parseFloat(String(over.point)), playerName, statKey);
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