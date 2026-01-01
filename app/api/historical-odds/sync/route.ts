import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { currentNbaSeason } from '@/lib/nbaUtils';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { TEAM_ID_TO_ABBR } from '@/lib/nbaConstants';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const BDL_BASE = "https://api.balldontlie.io/v1";
const BDL_API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY;

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const ODDS_API_KEY = process.env.ODDS_API_KEY;

function bdlAuthHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (BDL_API_KEY) h["Authorization"] = BDL_API_KEY.startsWith('Bearer ') ? BDL_API_KEY : `Bearer ${BDL_API_KEY}`;
  return h;
}

// Map market names to stat types (same as refreshOdds.ts)
const MARKET_TO_STAT: Record<string, string> = {
  'player_points': 'PTS',
  'player_rebounds': 'REB',
  'player_assists': 'AST',
  'player_threes': 'THREES',
  'player_blocks': 'BLK',
  'player_steals': 'STL',
  'player_turnovers': 'TO',
  'player_points_rebounds_assists': 'PRA',
  'player_points_rebounds': 'PR',
  'player_points_assists': 'PA',
  'player_rebounds_assists': 'RA',
};

// Bookmaker codes (same as refreshOdds.ts)
const ODDS_API_BOOKMAKER_CODES = process.env.ODDS_API_BOOKMAKER_CODES || 
  'draftkings,fanduel,betmgm,caesars,pointsbet,barstool,wynnbet,unibet,betrivers,espnbet,hardrockbet,superbook,circasports,bet365,bovada,mybookie,lowvig,action247,pinnacle,gtbets,intertops,youwager,bookmaker,heritage,5dimes';

/**
 * Get player ID from name (using Supabase players cache or BDL API)
 */
async function getPlayerId(playerName: string): Promise<number | null> {
  // Try Supabase players cache first
  const { data: players } = await supabaseAdmin
    .from('players')
    .select('id, first_name, last_name')
    .or(`first_name.ilike.%${playerName}%,last_name.ilike.%${playerName}%`)
    .limit(10);

  if (players && players.length > 0) {
    // Try exact match first
    const exactMatch = players.find(p => {
      const full = `${p.first_name} ${p.last_name}`.toLowerCase();
      return full === playerName.toLowerCase();
    });
    if (exactMatch) return exactMatch.id;

    // Try partial match
    const partialMatch = players.find(p => {
      const full = `${p.first_name} ${p.last_name}`.toLowerCase();
      return full.includes(playerName.toLowerCase()) || playerName.toLowerCase().includes(full);
    });
    if (partialMatch) return partialMatch.id;

    // Return first match if no exact match
    return players[0].id;
  }

  // Fallback to BDL API search
  try {
    const response = await fetch(
      `${BDL_BASE}/players?search=${encodeURIComponent(playerName)}&per_page=5`,
      { headers: bdlAuthHeaders(), cache: 'no-store' }
    );
    if (response.ok) {
      const data = await response.json();
      const players = data.data || [];
      if (players.length > 0) {
        return players[0].id;
      }
    }
  } catch (error) {
    console.error(`Error fetching player ID for ${playerName}:`, error);
  }

  return null;
}

/**
 * Get all games from BDL for this season and create a lookup map
 */
async function getGamesMap(): Promise<Map<string, { date: string; homeTeam: string; visitorTeam: string; homeAbbr: string; visitorAbbr: string }>> {
  const gamesMap = new Map<string, { date: string; homeTeam: string; visitorTeam: string; homeAbbr: string; visitorAbbr: string }>();
  
  try {
    const season = currentNbaSeason();
    // Current season: October 2025 - April 2026
    const startDate = '2025-10-01'; // NBA season starts in October
    const endDate = '2026-04-30'; // Regular season ends in April
    
    console.log(`🎮 Fetching games from BDL for season ${season} (${startDate} to ${endDate})...`);
    
    // Fetch games in batches
    let page = 1;
    const perPage = 100;
    let hasMore = true;
    
    while (hasMore && page <= 50) { // Safety limit
      const url = new URL(`${BDL_BASE}/games`);
      url.searchParams.set('seasons[]', String(season));
      url.searchParams.set('start_date', startDate);
      url.searchParams.set('end_date', endDate);
      url.searchParams.set('per_page', String(perPage));
      url.searchParams.set('page', String(page));
      
      const response = await fetch(url.toString(), {
        headers: bdlAuthHeaders(),
        cache: 'no-store'
      });
      
      if (!response.ok) break;
      
      const data = await response.json();
      const games = data.data || [];
      
      if (games.length === 0) {
        hasMore = false;
        break;
      }
      
      for (const game of games) {
        const gameDate = game.date ? game.date.split('T')[0] : null;
        if (!gameDate) continue;
        
        const homeAbbr = normalizeAbbr(game.home_team?.abbreviation || '');
        const visitorAbbr = normalizeAbbr(game.visitor_team?.abbreviation || '');
        
        if (homeAbbr && visitorAbbr) {
          // Create a key from date and teams (for matching with odds snapshots)
          const key = `${gameDate}_${homeAbbr}_${visitorAbbr}`;
          gamesMap.set(key, {
            date: gameDate,
            homeTeam: game.home_team?.full_name || '',
            visitorTeam: game.visitor_team?.full_name || '',
            homeAbbr,
            visitorAbbr
          });
        }
      }
      
      console.log(`📥 Fetched page ${page}: ${games.length} games (total in map: ${gamesMap.size})`);
      
      if (games.length < perPage) {
        hasMore = false;
      } else {
        page++;
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`✅ Created games map with ${gamesMap.size} games`);
  } catch (error) {
    console.error('Error fetching games from BDL:', error);
  }
  
  return gamesMap;
}

/**
 * Fetch historical odds from The Odds API for a specific game
 * Uses the historical odds endpoint which requires a date parameter
 * Cost: 10 credits per region per market (more expensive than regular calls)
 */
async function fetchHistoricalOddsFromAPI(gameId: string, gameDate: string): Promise<any> {
  if (!ODDS_API_KEY) {
    throw new Error('ODDS_API_KEY not configured');
  }

  const baseRegions = process.env.ODDS_REGIONS || 'us,us_dfs';
  const playerPropsMarkets = [
    'player_points',
    'player_rebounds',
    'player_assists',
    'player_threes',
    'player_points_rebounds_assists',
    'player_points_rebounds',
    'player_points_assists',
    'player_rebounds_assists',
  ].join(',');

  // Historical odds endpoint requires a date parameter (ISO 8601 format)
  // Use game date at noon UTC to get odds from before the game started
  // Format: YYYY-MM-DDTHH:mm:ssZ (ISO 8601)
  const historicalDate = new Date(`${gameDate}T12:00:00Z`).toISOString();

  // Historical odds endpoint format: /sports/{sport}/odds-history/{eventId}
  // Note: The date parameter should be the timestamp of the snapshot we want
  const eventUrl = `${ODDS_API_BASE}/sports/basketball_nba/odds-history/${gameId}`;
  const eventParams = new URLSearchParams({
    apiKey: ODDS_API_KEY,
    regions: baseRegions,
    markets: playerPropsMarkets,
    oddsFormat: 'american',
    dateFormat: 'iso',
    date: historicalDate, // ISO 8601 timestamp for the snapshot
    bookmakers: ODDS_API_BOOKMAKER_CODES,
  });
  
  // Debug: log the URL being called
  console.log(`[Historical Odds] Fetching for game ${gameId} on ${gameDate}, date param: ${historicalDate}`);

  try {
    const response = await fetch(`${eventUrl}?${eventParams}`, { cache: 'no-store' });
    if (!response.ok) {
      if (response.status === 404) {
        return null; // Game not found or no historical data available
      }
      if (response.status === 400) {
        console.warn(`⚠️ Bad request for game ${gameId} on ${gameDate} - might be too old (historical data available from May 3, 2023 for player props)`);
        return null;
      }
      throw new Error(`Odds API error: ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching historical odds for game ${gameId} on ${gameDate}:`, error);
    return null;
  }
}

/**
 * Extract player props from odds API response
 */
function extractPlayerProps(oddsData: any): Array<{
  playerName: string;
  market: string;
  bookmaker: string;
  line: number;
  overOdds: number;
  underOdds: number;
}> {
  const props: Array<{
    playerName: string;
    market: string;
    bookmaker: string;
    line: number;
    overOdds: number;
    underOdds: number;
  }> = [];

  if (!oddsData || !oddsData.bookmakers) return props;

  for (const bookmaker of oddsData.bookmakers) {
    if (!bookmaker.markets) continue;

    for (const market of bookmaker.markets) {
      const marketName = market.key;
      if (!marketName.startsWith('player_')) continue;

      if (!market.outcomes) continue;

      // Group outcomes by player name (outcomes come in pairs: over/under)
      const playerOutcomes = new Map<string, { over?: any; under?: any }>();

      for (const outcome of market.outcomes) {
        const playerName = outcome.description || outcome.name;
        if (!playerName) continue;

        if (!playerOutcomes.has(playerName)) {
          playerOutcomes.set(playerName, {});
        }

        const playerData = playerOutcomes.get(playerName)!;
        if (outcome.name?.toLowerCase().includes('over') || outcome.point !== undefined) {
          playerData.over = outcome;
        } else if (outcome.name?.toLowerCase().includes('under')) {
          playerData.under = outcome;
        }
      }

      // Extract props for each player
      for (const [playerName, outcomes] of playerOutcomes.entries()) {
        const over = outcomes.over;
        const under = outcomes.under;

        // Handle both standard and alternate markets
        // Standard markets have point on over outcome
        // Alternate markets might have different structure
        const lineValue = over?.point ?? over?.spread ?? under?.point ?? under?.spread;
        
        if (lineValue !== undefined && over && under) {
          const line = parseFloat(String(lineValue));
          const overOdds = parseInt(String(over.price || over.odds || 0));
          const underOdds = parseInt(String(under.price || under.odds || 0));

          if (!isNaN(line) && !isNaN(overOdds) && !isNaN(underOdds)) {
            // Map alternate markets to standard market names
            let marketKey = marketName;
            if (marketName.includes('_alternate')) {
              marketKey = marketName.replace('_alternate', '');
            }
            
            props.push({
              playerName,
              market: marketKey, // Use standard market name
              bookmaker: bookmaker.key || bookmaker.title || 'Unknown',
              line,
              overOdds,
              underOdds,
            });
          }
        }
      }
    }
  }

  return props;
}

/**
 * Sync all historical odds directly from The Odds API
 * Fetches odds for all games from this season
 */
export async function GET(req: NextRequest) {
  try {
    // Authentication check - admin or cron only
    const { authorizeAdminRequest } = await import('@/lib/adminAuth');
    const { authorizeCronRequest } = await import('@/lib/cronAuth');
    
    const adminAuth = await authorizeAdminRequest(req);
    const cronAuth = authorizeCronRequest(req);
    
    if (!adminAuth.authorized && !cronAuth.authorized) {
      return adminAuth.response || NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Rate limiting
    const { checkRateLimit, strictRateLimiter } = await import('@/lib/rateLimit');
    const rateResult = checkRateLimit(req, strictRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }

    if (!ODDS_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'ODDS_API_KEY not configured' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('start_date'); // Optional: YYYY-MM-DD
    const endDate = searchParams.get('end_date'); // Optional: YYYY-MM-DD
    const limit = searchParams.get('limit'); // Optional limit
    const fullSeason = searchParams.get('full_season') === 'true'; // Sync entire season

    console.log('🔄 Starting historical odds sync from The Odds API...');

    // Get all games from BDL for this season
    const gamesMap = await getGamesMap();
    let games = Array.from(gamesMap.values());

    // Default to current season: October 2025 - April 2026
    const seasonStart = startDate || '2025-10-01';
    const seasonEnd = endDate || '2026-04-30';
    
    // Filter to current season only
    games = games.filter(g => g.date >= seasonStart && g.date <= seasonEnd);

    // Filter out games before May 3, 2023 (historical player props start date)
    // But since we're in 2025, this shouldn't be an issue
    const minDate = '2023-05-03';
    games = games.filter(g => g.date >= minDate);
    
    console.log(`📅 Filtering games from ${seasonStart} to ${seasonEnd} (current NBA season)`);

    // Apply limit only if not doing full season
    let gamesToProcess = games;
    if (!fullSeason && limit) {
      gamesToProcess = gamesToProcess.slice(0, parseInt(limit, 10));
    }

    if (fullSeason) {
      console.log(`📅 Full season sync: Processing ALL ${gamesToProcess.length} games from October 2025 - April 2026`);
    } else {
      console.log(`📅 Processing ${gamesToProcess.length} games from October 2025 - April 2026${limit ? ` (limited to ${limit})` : ''}`);
    }

    console.log(`📥 Processing ${gamesToProcess.length} games...`);
    const estimatedCredits = gamesToProcess.length * 10;
    console.log(`💰 Estimated API credits: ~${estimatedCredits.toLocaleString()} credits (10 credits per game)`);
    console.log(`📊 Stats being synced: PTS, REB, AST, THREES, PRA, PR, PA, RA (all player props)`);
    console.log(`📅 Historical odds available from: May 3, 2023 for player props`);
    console.log(`⚠️  Note: Historical odds cost 10 credits per region per market`);
    
    if (estimatedCredits > 100000) {
      console.log(`⏱️  This will take a while... Estimated time: ~${Math.ceil(estimatedCredits / 10000)} minutes`);
    }

    // Create player lookup cache
    const playerIdCache = new Map<string, number | null>();

    const historicalOddsToInsert: any[] = [];
    let processedGames = 0;
    let skippedGames = 0;
    let errorGames = 0;
    let apiCallsMade = 0;

    // Process games in batches with delays to avoid rate limiting
    // For full season sync, use larger batches but longer delays
    const BATCH_SIZE = fullSeason ? 10 : 5;
    const DELAY_MS = fullSeason ? 1000 : 500; // Longer delay for full season to avoid rate limits

    for (let i = 0; i < gamesToProcess.length; i += BATCH_SIZE) {
      const batch = gamesToProcess.slice(i, i + BATCH_SIZE);

      // Add delay between batches
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }

      const batchPromises = batch.map(async (gameInfo) => {
        try {
          // The Odds API uses event IDs - we need to find the event ID for this game
          // Try to fetch games from odds API for this date
          const gameDate = new Date(gameInfo.date);
          const dateStr = gameDate.toISOString().split('T')[0];
          
          // For historical games, use the historical odds endpoint to get events by date
          // Try multiple time points to find the closest snapshot (historical data has snapshots at intervals)
          const timePoints = ['12:00:00Z', '00:00:00Z', '18:00:00Z', '06:00:00Z'];
          let gamesData: any[] | null = null;
          
          for (const timePoint of timePoints) {
            const historicalDate = new Date(`${gameInfo.date}T${timePoint}`).toISOString();
            const historicalGamesUrl = `${ODDS_API_BASE}/sports/basketball_nba/odds-history`;
            const historicalParams = new URLSearchParams({
              apiKey: ODDS_API_KEY,
              regions: process.env.ODDS_REGIONS || 'us,us_dfs',
              markets: 'h2h', // Just to get the game list
              oddsFormat: 'american',
              dateFormat: 'iso',
              date: historicalDate,
            });

            const gamesResponse = await fetch(`${historicalGamesUrl}?${historicalParams}`, { cache: 'no-store' });
            apiCallsMade += 10; // Historical calls cost 10 credits
            
            // Check for rate limiting
            const remainingRequests = gamesResponse.headers.get('x-requests-remaining');
            if (gamesResponse.status === 429) {
              console.error(`❌ Rate limit hit! Remaining: ${remainingRequests || 'unknown'}`);
              throw new Error('Rate limit exceeded. Please wait before syncing more games.');
            }
            
            if (gamesResponse.ok) {
              const data = await gamesResponse.json();
              if (Array.isArray(data) && data.length > 0) {
                gamesData = data;
                break; // Found games, stop trying other time points
              }
            } else if (gamesResponse.status !== 422) {
              // If it's not 422, log and continue to next time point
              console.warn(`⚠️ Historical API returned ${gamesResponse.status} for ${dateStr} at ${timePoint}`);
            }
            // If 422, try next time point silently
          }
          
          if (!gamesData || gamesData.length === 0) {
            // Only log if we tried all time points
            if (timePoints.length > 0) {
              console.warn(`⚠️ No historical games found for ${dateStr} after trying ${timePoints.length} time points`);
            }
            skippedGames++;
            return null;
          }

          // Find matching game by teams
          const matchingGame = gamesData.find((g: any) => {
            const homeMatch = normalizeAbbr(g.home_team || '') === gameInfo.homeAbbr ||
                             normalizeAbbr(g.home_team || '').includes(gameInfo.homeAbbr) ||
                             gameInfo.homeAbbr.includes(normalizeAbbr(g.home_team || ''));
            const awayMatch = normalizeAbbr(g.away_team || '') === gameInfo.visitorAbbr ||
                             normalizeAbbr(g.away_team || '').includes(gameInfo.visitorAbbr) ||
                             gameInfo.visitorAbbr.includes(normalizeAbbr(g.away_team || ''));
            return homeMatch && awayMatch;
          });

          if (!matchingGame || !matchingGame.id) {
            skippedGames++;
            return null;
          }

          // Fetch player props for this game using regular odds endpoint
          // (works for both upcoming and recent past games)
          const eventUrl = `${ODDS_API_BASE}/sports/basketball_nba/events/${matchingGame.id}/odds`;
          const eventParams = new URLSearchParams({
            apiKey: ODDS_API_KEY,
            regions: process.env.ODDS_REGIONS || 'us,us_dfs',
            markets: 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists,player_points_rebounds,player_points_assists,player_rebounds_assists',
            oddsFormat: 'american',
            dateFormat: 'iso',
            bookmakers: ODDS_API_BOOKMAKER_CODES,
          });
          
          const oddsResponse = await fetch(`${eventUrl}?${eventParams}`, { cache: 'no-store' });
          apiCallsMade += 1; // Regular call = 1 credit
          
          let oddsData = null;
          if (oddsResponse.ok) {
            oddsData = await oddsResponse.json();
          } else if (oddsResponse.status === 404) {
            // Game not found - might be too old, try historical endpoint as fallback
            const gameDateTime = new Date(`${gameInfo.date}T12:00:00Z`);
            const isPastGame = gameDateTime < new Date();
            if (isPastGame) {
              oddsData = await fetchHistoricalOddsFromAPI(matchingGame.id, gameInfo.date);
              apiCallsMade += 10; // Historical odds cost 10 credits per call
            }
          }
          
          if (!oddsData) {
            skippedGames++;
            return null;
          }

          const playerProps = extractPlayerProps(oddsData);
          if (playerProps.length === 0) {
            skippedGames++;
            return null;
          }

          // Log progress every 10 games or for important milestones
          if (processedGames % 10 === 0 || processedGames === 0) {
            console.log(`✅ Game ${processedGames + 1}/${gamesToProcess.length}: Found ${playerProps.length} player props for ${gameInfo.date} (${gameInfo.homeAbbr} vs ${gameInfo.visitorAbbr})`);
          }

          // Process each player prop
          for (const prop of playerProps) {
            const statType = MARKET_TO_STAT[prop.market];
            if (!statType) continue;

            // Get player ID (with caching)
            let playerId = playerIdCache.get(prop.playerName);
            if (playerId === undefined) {
              playerId = await getPlayerId(prop.playerName);
              playerIdCache.set(prop.playerName, playerId);
            }
            if (!playerId) continue;

            // Determine opponent
            const { data: playerData } = await supabaseAdmin
              .from('players')
              .select('team_abbreviation')
              .eq('id', playerId)
              .single();

            const playerTeam = playerData?.team_abbreviation ? normalizeAbbr(playerData.team_abbreviation) : null;
            let opponent = 'UNKNOWN';

            if (playerTeam) {
              if (normalizeAbbr(gameInfo.homeAbbr) === playerTeam) {
                opponent = gameInfo.visitorAbbr;
              } else if (normalizeAbbr(gameInfo.visitorAbbr) === playerTeam) {
                opponent = gameInfo.homeAbbr;
              } else {
                // Player might have been on a different team - skip for now
                continue;
              }
            } else {
              opponent = gameInfo.visitorAbbr; // Default
            }

            historicalOddsToInsert.push({
              player_id: playerId,
              player_name: prop.playerName,
              game_date: gameInfo.date,
              opponent: opponent,
              stat_type: statType,
              line: prop.line,
              over_odds: String(prop.overOdds),
              under_odds: String(prop.underOdds),
              bookmaker: prop.bookmaker,
            });
          }

          processedGames++;
          return true;
        } catch (error: any) {
          console.error(`❌ Error processing game ${gameInfo.date}:`, error);
          errorGames++;
          return null;
        }
      });

      await Promise.all(batchPromises);
      console.log(`📊 Progress: ${Math.min(i + BATCH_SIZE, gamesToProcess.length)}/${gamesToProcess.length} games processed`);
    }

    console.log(`💾 Inserting ${historicalOddsToInsert.length} historical odds records...`);

    // Insert in batches
    const INSERT_BATCH_SIZE = 500;
    let inserted = 0;
    let errors = 0;

    for (let i = 0; i < historicalOddsToInsert.length; i += INSERT_BATCH_SIZE) {
      const batch = historicalOddsToInsert.slice(i, i + INSERT_BATCH_SIZE);
      const { error } = await supabaseAdmin
        .from('historical_odds')
        .upsert(batch, {
          onConflict: 'player_id,game_date,opponent,stat_type,bookmaker',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`❌ Error inserting batch ${i / INSERT_BATCH_SIZE + 1}:`, error);
        errors++;
      } else {
        inserted += batch.length;
        console.log(`✅ Inserted batch ${i / INSERT_BATCH_SIZE + 1}: ${batch.length} records (total: ${inserted})`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${inserted} historical odds records from The Odds API`,
      stats: {
        gamesProcessed: processedGames,
        gamesSkipped: skippedGames,
        gamesWithErrors: errorGames,
        oddsInserted: inserted,
        oddsErrors: errors,
        totalGames: gamesToProcess.length,
        apiCallsMade: apiCallsMade,
        estimatedCreditsUsed: apiCallsMade, // Historical odds cost 10 credits per call
        note: 'Historical odds cost 10 credits per region per market. Player props available from May 3, 2023.'
      }
    });

  } catch (error: any) {
    console.error('❌ Error in historical odds sync:', error);
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { 
        success: false, 
        error: isProduction 
          ? 'An error occurred. Please try again later.' 
          : (error.message || 'Unknown error')
      },
      { status: 500 }
    );
  }
}

