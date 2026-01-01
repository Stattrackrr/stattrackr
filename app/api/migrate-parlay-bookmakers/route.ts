import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { authorizeAdminRequest } from '@/lib/adminAuth';
import { checkRateLimit, strictRateLimiter } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Parse parlay selection text to extract individual legs
 * Format: "Parlay: Player1 over 25 Points + Player2 under 10 Rebounds + ..."
 */
function parseParlayLegs(selectionText: string): Array<{
  playerName: string;
  overUnder: 'over' | 'under';
  line: number;
  statType: string;
}> {
  if (!selectionText || !selectionText.startsWith('Parlay:')) {
    return [];
  }
  
  const legsText = selectionText.replace(/^Parlay:\s*/, '');
  const legs = legsText.split(' + ').map(leg => leg.trim()).filter(leg => leg);
  
  const statNameMap: Record<string, string> = {
    'points': 'player_points',
    'rebounds': 'player_rebounds',
    'assists': 'player_assists',
    'steals': 'player_steals',
    'blocks': 'player_blocks',
    '3-pointers made': 'player_threes',
    '3-pointers': 'player_threes',
    'threes': 'player_threes',
    'points + rebounds': 'player_points_rebounds',
    'points + rebounds + assists': 'player_points_rebounds_assists',
    'rebounds + assists': 'player_rebounds_assists',
  };
  
  const parsedLegs: Array<{
    playerName: string;
    overUnder: 'over' | 'under';
    line: number;
    statType: string;
  }> = [];
  
  for (const leg of legs) {
    const match = leg.match(/^(.+?)\s+(over|under)\s+([\d.]+)\s+(.+)$/i);
    if (match) {
      const [, playerName, overUnder, lineStr, statName] = match;
      const line = parseFloat(lineStr);
      if (!isNaN(line)) {
        const normalizedStatName = statName.trim().toLowerCase();
        const marketKey = statNameMap[normalizedStatName] || `player_${normalizedStatName.replace(/\s+/g, '_')}`;
        
        parsedLegs.push({
          playerName: playerName.trim(),
          overUnder: (overUnder.toLowerCase() as 'over' | 'under'),
          line,
          statType: marketKey,
        });
      }
    }
  }
  
  return parsedLegs;
}

/**
 * Try to infer bookmakers from odds snapshots for a parlay leg
 */
async function inferBookmakerForLeg(
  leg: { playerName: string; overUnder: 'over' | 'under'; line: number; statType: string },
  gameDate: string
): Promise<string[]> {
  // Convert date to a range (bet date ± 1 day to account for timezone differences)
  const betDate = new Date(gameDate);
  const startDate = new Date(betDate);
  startDate.setDate(startDate.getDate() - 1);
  const endDate = new Date(betDate);
  endDate.setDate(endDate.getDate() + 1);

  // Query odds_snapshots for matching player, stat, line, and date
  const { data: snapshots, error } = await supabaseAdmin
    .from('odds_snapshots')
    .select('bookmaker, line, snapshot_at')
    .eq('player_name', leg.playerName)
    .eq('market', leg.statType)
    .gte('snapshot_at', startDate.toISOString())
    .lte('snapshot_at', endDate.toISOString())
    .order('snapshot_at', { ascending: false })
    .limit(100);

  if (error || !snapshots || snapshots.length === 0) {
    return [];
  }

  // Find bookmakers that had this line (within 0.5 tolerance)
  const matchingBookmakers = new Set<string>();
  for (const snapshot of snapshots) {
    if (snapshot.line && Math.abs(snapshot.line - leg.line) <= 0.5) {
      matchingBookmakers.add(snapshot.bookmaker);
    }
  }

  return Array.from(matchingBookmakers);
}

/**
 * One-time migration endpoint to update old parlay bets with missing bookmaker data
 * 
 * This attempts to infer bookmakers from historical odds snapshots by:
 * 1. Parsing the parlay selection to extract legs
 * 2. Looking up odds_snapshots for each leg around the bet date
 * 3. Finding bookmakers that had matching lines
 * 4. Setting the union of all bookmakers found
 * 
 * If no bookmakers can be inferred, sets a default value.
 * 
 * Usage: Call this endpoint once to migrate existing data
 * GET /api/migrate-parlay-bookmakers
 */
export async function GET(request: Request) {
  try {
    // Find all parlay bets with null or empty bookmaker
    const { data: parlayBets, error: fetchError } = await supabaseAdmin
      .from('bets')
      .select('id, market, bookmaker, selection, date')
      .or('market.ilike.Parlay%,market.ilike.parlay%')
      .or('bookmaker.is.null,bookmaker.eq.,bookmaker.eq.Unknown');

    if (fetchError) {
      console.error('Error fetching parlay bets:', fetchError);
      const isProduction = process.env.NODE_ENV === 'production';
      return NextResponse.json(
        { 
          error: isProduction 
            ? 'An error occurred. Please try again later.' 
            : 'Failed to fetch parlay bets',
          ...(isProduction ? {} : { details: fetchError.message })
        },
        { status: 500 }
      );
    }

    if (!parlayBets || parlayBets.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No parlay bets found that need migration',
        updated: 0,
      });
    }

    // Filter to only bets that actually need updating (null, empty, or "Unknown")
    const betsToUpdate = parlayBets.filter(
      bet => !bet.bookmaker || bet.bookmaker.trim() === '' || bet.bookmaker === 'Unknown'
    );

    if (betsToUpdate.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All parlay bets already have bookmaker data',
        updated: 0,
      });
    }

    const results = [];
    let inferredCount = 0;
    let defaultCount = 0;

    // Process each bet
    for (const bet of betsToUpdate) {
      const legs = parseParlayLegs(bet.selection || '');
      
      if (legs.length === 0) {
        // Can't parse, use default
        const defaultBookmaker = JSON.stringify(['Multiple Bookmakers']);
        const { error } = await supabaseAdmin
          .from('bets')
          .update({ bookmaker: defaultBookmaker })
          .eq('id', bet.id);
        
        if (!error) {
          defaultCount++;
          results.push({ id: bet.id, status: 'default', bookmakers: ['Multiple Bookmakers'] });
        } else {
          results.push({ id: bet.id, status: 'error', error: error.message });
        }
        continue;
      }

      // Try to infer bookmakers for each leg
      const allBookmakers = new Set<string>();
      for (const leg of legs) {
        const legBookmakers = await inferBookmakerForLeg(leg, bet.date);
        legBookmakers.forEach(bm => allBookmakers.add(bm));
      }

      const bookmakerArray = Array.from(allBookmakers);
      
      if (bookmakerArray.length > 0) {
        // Found bookmakers from odds snapshots
        const { error } = await supabaseAdmin
          .from('bets')
          .update({ bookmaker: JSON.stringify(bookmakerArray) })
          .eq('id', bet.id);
        
        if (!error) {
          inferredCount++;
          results.push({ id: bet.id, status: 'inferred', bookmakers: bookmakerArray });
        } else {
          results.push({ id: bet.id, status: 'error', error: error.message });
        }
      } else {
        // No bookmakers found, use default
        const defaultBookmaker = JSON.stringify(['Multiple Bookmakers']);
        const { error } = await supabaseAdmin
          .from('bets')
          .update({ bookmaker: defaultBookmaker })
          .eq('id', bet.id);
        
        if (!error) {
          defaultCount++;
          results.push({ id: bet.id, status: 'default', bookmakers: ['Multiple Bookmakers'] });
        } else {
          results.push({ id: bet.id, status: 'error', error: error.message });
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully migrated ${betsToUpdate.length} parlay bet(s)`,
      updated: betsToUpdate.length,
      inferred: inferredCount,
      defaulted: defaultCount,
      results: results.slice(0, 10), // Show first 10 results
      note: inferredCount > 0 
        ? `${inferredCount} bet(s) had bookmakers inferred from odds snapshots. ${defaultCount} bet(s) were set to default.`
        : 'No bookmakers could be inferred from odds snapshots. All bets were set to default.',
    });
  } catch (error: any) {
    console.error('Migration error:', error);
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { 
        error: isProduction 
          ? 'An error occurred. Please try again later.' 
          : 'Migration failed',
        ...(isProduction ? {} : { details: error.message })
      },
      { status: 500 }
    );
  }
}

