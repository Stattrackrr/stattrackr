/**
 * Script to reset bets that were prematurely resolved
 * 
 * This script resets bets back to pending status so they can be re-checked
 * with the fixed logic that only resolves bets when games are actually final.
 * 
 * Usage:
 *   node scripts/reset-prematurely-resolved-bets.js [date]
 * 
 * Examples:
 *   node scripts/reset-prematurely-resolved-bets.js 2025-12-09
 *   node scripts/reset-prematurely-resolved-bets.js 2025-12-09 2025-12-10
 */

// Load environment variables
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✓' : '✗');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function resetPrematurelyResolvedBets(startDate, endDate = null) {
  try {
    console.log('🔄 Resetting prematurely resolved bets...');
    console.log(`   Date range: ${startDate}${endDate ? ` to ${endDate}` : ''}`);
    
    // First, let's check what bets exist on this date for debugging
    console.log('\n🔍 Checking for bets on this date...');
    
    // Fetch all NBA bets and filter in memory to check both date fields
    const { data: allBets, error: debugError } = await supabase
      .from('bets')
      .select('id, player_name, market, selection, game_date, date, result, status, actual_value, sport')
      .eq('sport', 'NBA');
    
    if (debugError) {
      console.error('❌ Error fetching bets for debugging:', debugError);
    } else if (allBets && allBets.length > 0) {
      // Filter by date in memory
      const filteredBets = allBets.filter(bet => {
        const gameDate = bet.game_date ? bet.game_date.split('T')[0] : null;
        const betDate = bet.date ? bet.date.split('T')[0] : null;
        
        if (endDate) {
          return (gameDate >= startDate && gameDate <= endDate) || 
                 (betDate >= startDate && betDate <= endDate);
        } else {
          return gameDate === startDate || betDate === startDate;
        }
      });
      
      if (filteredBets.length > 0) {
        console.log(`   Found ${filteredBets.length} total NBA bets on this date:`);
        filteredBets.forEach((bet, idx) => {
          const desc = bet.market?.startsWith('Parlay') ? bet.market : `${bet.player_name || 'Game prop'} ${bet.selection || ''}`;
          console.log(`   ${idx + 1}. ${desc} - result: ${bet.result}, status: ${bet.status}, game_date: ${bet.game_date}, date: ${bet.date}`);
        });
      } else {
        console.log('   No NBA bets found on this date at all');
      }
    } else {
      console.log('   No NBA bets found in database');
    }
    
    // Build query to find bets that were resolved but might have been premature
    // We'll reset bets that:
    // 1. Are NBA bets
    // 2. Have a result of 'win' or 'loss' (not void or pending)
    // 3. Are on the specified date(s) (check both date and game_date fields)
    // 4. Have status 'completed' (indicating they were resolved)
    
    console.log('\n🔍 Searching for resolved bets to reset...');
    
    // Fetch all resolved NBA bets and filter in memory
    const { data: allResolvedBets, error: fetchError } = await supabase
      .from('bets')
      .select('id, player_name, market, selection, game_date, date, result, status, actual_value')
      .eq('sport', 'NBA')
      .in('result', ['win', 'loss'])
      .eq('status', 'completed');
    
    if (fetchError) {
      console.error('❌ Error fetching bets:', fetchError);
      throw fetchError;
    }
    
    // Filter by date in memory (check both game_date and date fields)
    const bets = (allResolvedBets || []).filter(bet => {
      const gameDate = bet.game_date ? bet.game_date.split('T')[0] : null;
      const betDate = bet.date ? bet.date.split('T')[0] : null;
      
      if (endDate) {
        return (gameDate >= startDate && gameDate <= endDate) || 
               (betDate >= startDate && betDate <= endDate);
      } else {
        return gameDate === startDate || betDate === startDate;
      }
    });
    
    if (fetchError) {
      console.error('❌ Error fetching bets:', fetchError);
      throw fetchError;
    }
    
    if (!bets || bets.length === 0) {
      console.log('\n✅ No resolved bets found to reset for the specified date(s)');
      console.log('   This could mean:');
      console.log('   - All bets are still pending');
      console.log('   - Bets are stored with a different date format');
      console.log('   - No bets exist on this date');
      return;
    }
    
    console.log(`\n📊 Found ${bets.length} bets to reset:`);
    bets.forEach((bet, index) => {
      const description = bet.market?.startsWith('Parlay') 
        ? bet.market 
        : `${bet.player_name || 'Game prop'} ${bet.selection || ''}`;
      console.log(`   ${index + 1}. ${description}`);
      console.log(`      - Result: ${bet.result}, Status: ${bet.status}`);
      console.log(`      - Game date: ${bet.game_date}, Bet date: ${bet.date}`);
      console.log(`      - Actual value: ${bet.actual_value}`);
    });
    
    // Reset bets back to pending
    const betIds = bets.map(b => b.id);
    
    const { data: updated, error: updateError } = await supabase
      .from('bets')
      .update({
        result: 'pending',
        status: 'pending',
        actual_value: null,
      })
      .in('id', betIds);
    
    if (updateError) {
      console.error('❌ Error resetting bets:', updateError);
      throw updateError;
    }
    
    console.log(`\n✅ Successfully reset ${bets.length} bets back to pending status`);
    console.log('\n📝 Next steps:');
    console.log('   1. Wait a few minutes for games to finish (if they\'re still in progress)');
    console.log('   2. Call the check-journal-bets endpoint with recalculate=true:');
    console.log('      GET /api/check-journal-bets?recalculate=true');
    console.log('   3. The fixed logic will now only resolve bets when games are actually final');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Get date from command line arguments
const args = process.argv.slice(2);
const startDate = args[0];
const endDate = args[1] || null;

if (!startDate) {
  console.error('❌ Please provide a date (YYYY-MM-DD)');
  console.error('   Usage: node scripts/reset-prematurely-resolved-bets.js [startDate] [endDate]');
  console.error('   Example: node scripts/reset-prematurely-resolved-bets.js 2024-12-09');
  console.error('   Example: node scripts/reset-prematurely-resolved-bets.js 2024-12-09 2024-12-10');
  process.exit(1);
}

// Validate date format
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
if (!dateRegex.test(startDate)) {
  console.error('❌ Invalid date format. Please use YYYY-MM-DD');
  process.exit(1);
}

if (endDate && !dateRegex.test(endDate)) {
  console.error('❌ Invalid end date format. Please use YYYY-MM-DD');
  process.exit(1);
}

resetPrematurelyResolvedBets(startDate, endDate);

