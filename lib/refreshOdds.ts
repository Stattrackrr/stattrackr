/* eslint-disable @typescript-eslint/no-explicit-any */
import cache, { CACHE_TTL } from './cache';
import type { GameOdds, OddsCache } from '@/app/api/odds/refresh/route';
import { supabase } from './supabaseClient';

// Store all odds data in a single cache entry
const ODDS_CACHE_KEY = 'all_nba_odds';

/**
 * Fetch all NBA odds from The Odds API
 * This function is called by the scheduler and the API route
 */
export async function refreshOddsData() {
  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  
  if (!ODDS_API_KEY) {
    throw new Error('Odds API key not configured');
  }

  console.log('🔄 Starting bulk odds refresh...');
  const startTime = Date.now();
  
  try {
    // Fetch all NBA games with game odds (H2H, spreads, totals)
    const gamesUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds`;
    const gamesParams = new URLSearchParams({
      apiKey: ODDS_API_KEY,
      regions: 'us',
      markets: 'h2h,spreads,totals',
      oddsFormat: 'american',
      dateFormat: 'iso',
    });

    const gamesResponse = await fetch(`${gamesUrl}?${gamesParams}`);
    const gamesData = await gamesResponse.json();

    if (!gamesResponse.ok) {
      throw new Error(`Odds API error: ${gamesData.message || 'Unknown error'}`);
    }

    // Fetch player props for each game (requires separate call per game)
    // Player props use /events/{eventId}/odds endpoint
    // OPTIMIZATION: Only fetch props for games happening in the next 20 hours to save API calls
    const now = new Date();
    const cutoffTime = new Date(now.getTime() + 20 * 60 * 60 * 1000);
    
    const upcomingGames = gamesData.filter((game: any) => {
      const gameTime = new Date(game.commence_time);
      return gameTime >= now && gameTime <= cutoffTime;
    });
    
    console.log(`📊 Fetching player props for ${upcomingGames.length}/${gamesData.length} games (next 20h)`);
    console.log(`⏰ Cutoff: ${cutoffTime.toLocaleString()}`);
    if (upcomingGames.length > 0) {
      console.log(`🏀 Sample games: ${upcomingGames.slice(0, 3).map((g: any) => `${g.home_team} vs ${g.away_team} at ${new Date(g.commence_time).toLocaleString()}`).join(', ')}`);
    }
    
    const playerPropsMarkets = 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists,player_points_rebounds,player_points_assists,player_rebounds_assists';
    const playerPropsPromises = upcomingGames.map(async (game: any) => {
      try {
        const eventUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${game.id}/odds`;
        const eventParams = new URLSearchParams({
          apiKey: ODDS_API_KEY,
          regions: 'us',
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
async function saveOddsSnapshots(games: GameOdds[]) {
  const snapshots: any[] = [];
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
            }
          }
        }
      }
    }
  }

  // Batch insert snapshots
  if (snapshots.length > 0) {
    const { error } = await supabase
      .from('odds_snapshots')
      .insert(snapshots);

    if (error) {
      console.error('Supabase insert error:', error);
      throw error;
    }

    console.log(`💾 Saved ${snapshots.length} odds snapshots`);
  }
}
