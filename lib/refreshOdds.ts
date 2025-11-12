/* eslint-disable @typescript-eslint/no-explicit-any */
import cache, { CACHE_TTL } from './cache';
import type { GameOdds, OddsCache } from '@/app/api/odds/refresh/route';
import { createClient } from '@supabase/supabase-js';

// Use service role for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Store all odds data in a single cache entry
const ODDS_CACHE_KEY = 'all_nba_odds';

/**
 * Fetch all NBA odds from The Odds API
 * This function is called by the scheduler and the API route
 */
type RefreshSource = 'scheduler' | 'api/odds/refresh';

export async function refreshOddsData(options: { source: RefreshSource } = { source: 'scheduler' }) {
  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  
  if (!ODDS_API_KEY) {
    throw new Error('Odds API key not configured');
  }

    console.log(`🔄 Starting bulk odds refresh... (source: ${options.source})`);
  const startTime = Date.now();
  
  try {
    // Fetch all NBA games with game odds (H2H, spreads, totals)
    const gamesUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds`;
    const baseRegions = process.env.ODDS_REGIONS || 'us';
    const defaultBookmakers = 'draftkings,fanduel,fanatics,caesars';
    const baseBookmakers = (process.env.ODDS_BOOKMAKERS || defaultBookmakers).trim();
    const gamesParams = new URLSearchParams({
      apiKey: ODDS_API_KEY,
      markets: 'h2h,spreads,totals',
      oddsFormat: 'american',
      dateFormat: 'iso',
    });
    if (baseBookmakers.length > 0) {
      gamesParams.set('bookmakers', baseBookmakers);
    } else {
      gamesParams.set('regions', baseRegions);
    }

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
    
    // Include both standard and alternate markets for DFS sites (goblins/demons/multipliers)
    const playerPropsMarkets = 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists,player_points_rebounds,player_points_assists,player_rebounds_assists';
    const playerPropsPromises = upcomingGames.map(async (game: any) => {
      try {
        const eventUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${game.id}/odds`;
        const eventParams = new URLSearchParams({
          apiKey: ODDS_API_KEY,
          markets: playerPropsMarkets,
          oddsFormat: 'american',
          dateFormat: 'iso',
        });
        if (baseBookmakers.length > 0) {
          eventParams.set('bookmakers', baseBookmakers);
        } else {
          eventParams.set('regions', baseRegions);
        }
        
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
    try {
      await saveOddsSnapshots(games);
      console.log('📸 Odds snapshots saved to database');
    } catch (error) {
      console.error('❌ Failed to save odds snapshots:', error);
      // Don't fail the whole refresh if snapshot saving fails
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
    for (const game of playerPropsData) {
      const matchingGame = games.find(g => g.gameId === game.id);
      if (!matchingGame) continue;

      for (const bookmaker of game.bookmakers || []) {
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

          const statKey = marketKeyMap[market.key];
          if (!statKey) continue;

          // Initialize bookmaker's player props if needed
          const bookmakerName = bookmaker.title;
          if (!matchingGame.playerPropsByBookmaker[bookmakerName]) {
            matchingGame.playerPropsByBookmaker[bookmakerName] = {};
          }

          for (const outcome of market.outcomes || []) {
            const playerName = outcome.description || outcome.name;
            if (!playerName || playerName === 'Over' || playerName === 'Under' || playerName === 'Yes' || playerName === 'No') continue;

            // Initialize player's props for this bookmaker
            if (!matchingGame.playerPropsByBookmaker[bookmakerName][playerName]) {
              matchingGame.playerPropsByBookmaker[bookmakerName][playerName] = {};
            }

            // Handle over/under markets (most props)
            if (['PTS', 'REB', 'AST', 'THREES', 'BLK', 'STL', 'TO', 'PRA', 'PR', 'PA', 'RA'].includes(statKey)) {
              // Find all over/under pairs for this player
              const allOvers = market.outcomes.filter((o: any) => o.name === 'Over' && o.description === playerName);
              const allUnders = market.outcomes.filter((o: any) => o.name === 'Under' && o.description === playerName);
              
              // Skip if no valid pairs
              if (allOvers.length === 0 || allUnders.length === 0) continue;
              
              // Find the main line (most balanced odds, closest to even)
              // Main lines typically have odds between -150 and +150
              const mainLinePairs = [];
              for (const over of allOvers) {
                const matchingUnder = allUnders.find((u: any) => Math.abs(parseFloat(u.point) - parseFloat(over.point)) < 0.01);
                if (matchingUnder) {
                  const overPrice = parseInt(String(over.price));
                  const underPrice = parseInt(String(matchingUnder.price));
                  // Calculate how "balanced" the odds are (main lines are more balanced)
                  const balance = Math.abs(Math.abs(overPrice) - Math.abs(underPrice));
                  // Prefer odds in the -150 to +150 range (typical main lines)
                  const inMainRange = overPrice >= -150 && overPrice <= 150 && underPrice >= -150 && underPrice <= 150;
                  mainLinePairs.push({ over, under: matchingUnder, balance, inMainRange });
                }
              }
              
              if (mainLinePairs.length > 0) {
                // Sort: prefer main range first, then most balanced
                mainLinePairs.sort((a, b) => {
                  if (a.inMainRange && !b.inMainRange) return -1;
                  if (!a.inMainRange && b.inMainRange) return 1;
                  return a.balance - b.balance;
                });
                
                const bestPair = mainLinePairs[0];
                (matchingGame.playerPropsByBookmaker[bookmakerName][playerName] as any)[statKey] = {
                  line: String(bestPair.over.point),
                  over: String(bestPair.over.price),
                  under: String(bestPair.under.price),
                };
              }
            }
            // Handle yes/no markets (double-double, triple-double, first basket)
            else if (['DD', 'TD', 'FIRST_BASKET'].includes(statKey)) {
              const yesOutcome = market.outcomes.find((o: any) => o.name === 'Yes' && o.description === playerName);
              const noOutcome = market.outcomes.find((o: any) => o.name === 'No' && o.description === playerName);

              if (yesOutcome && noOutcome) {
                (matchingGame.playerPropsByBookmaker[bookmakerName][playerName] as any)[statKey] = {
                  yes: String(yesOutcome.price),
                  no: String(noOutcome.price),
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

async function saveOddsSnapshots(games: GameOdds[]) {
  const snapshots: any[] = [];
  const movementSnapshots: MovementSnapshot[] = [];
  const now = new Date().toISOString();

  for (const game of games) {
    // Save player prop snapshots
    for (const [bookmakerName, playerProps] of Object.entries(game.playerPropsByBookmaker)) {
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
          if (!propData || typeof propData !== 'object') continue;
          
          const market = statToMarket[statKey];
          if (!market) continue;

          // Only save if we have line and odds data
          if ('line' in propData && 'over' in propData && 'under' in propData) {
            const line = parseFloat(String(propData.line));
            const overOdds = parseInt(String(propData.over));
            const underOdds = parseInt(String(propData.under));

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

    console.log(`💾 Saved ${snapshots.length} odds snapshots`);
  }

  if (movementSnapshots.length > 0) {
    await saveLineMovementState(movementSnapshots);
  }
}

async function saveLineMovementState(movementSnapshots: MovementSnapshot[]) {
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
  if (keys.length > 0) {
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

    if (hasChanged) {
      movementEvents.push({
        composite_key: snapshot.compositeKey,
        game_id: snapshot.gameId,
        player_name: snapshot.playerName,
        market: snapshot.market,
        bookmaker: snapshot.bookmaker,
        previous_line: previousLine,
        new_line: snapshot.line,
        change,
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
  }

  if (movementEvents.length > 0) {
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
  }
}
