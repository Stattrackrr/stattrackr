require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Check if a line is a whole number
 */
function isWholeNumber(line) {
  return line % 1 === 0;
}

/**
 * Determine if a bet should win with the new logic
 */
function shouldWin(actualValue, line, overUnder) {
  const isWhole = isWholeNumber(line);
  
  if (overUnder === 'over') {
    return isWhole ? actualValue >= line : actualValue > line;
  } else {
    return isWhole ? actualValue <= line : actualValue < line;
  }
}

/**
 * Parse parlay legs from selection text
 */
function parseParlayLegs(selectionText) {
  if (!selectionText || !selectionText.startsWith('Parlay:')) {
    return [];
  }
  
  const legsText = selectionText.replace(/^Parlay:\s*/, '');
  const legs = legsText.split(' + ').map(leg => leg.trim()).filter(leg => leg);
  
  const statNameMap = {
    'points': 'pts',
    'rebounds': 'reb',
    'assists': 'ast',
    'steals': 'stl',
    'blocks': 'blk',
    'threes': 'fg3m',
    '3 pointer': 'fg3m',
    'made 3 pointer': 'fg3m',
    '3 pointers': 'fg3m',
  };
  
  const parsedLegs = [];
  
  for (const leg of legs) {
    // Pattern: "PlayerName over/under Line StatName"
    const match = leg.match(/^(.+?)\s+(over|under)\s+([\d.]+)\s*(?:\+)?\s+(.+)$/i);
    if (match) {
      const [, playerName, overUnder, lineStr, statName] = match;
      const line = parseFloat(lineStr);
      if (!isNaN(line)) {
        const normalizedStatName = statName.trim().toLowerCase();
        const statKey = statNameMap[normalizedStatName] || normalizedStatName;
        
        parsedLegs.push({
          playerName: playerName.trim(),
          overUnder: overUnder.toLowerCase(),
          line,
          statType: statKey,
        });
      }
    }
  }
  
  return parsedLegs;
}

/**
 * Main function to find and fix the bet
 */
async function findAndFixBet() {
  console.log('🔍 Searching for the bet...\n');
  
  // Search for bets containing "Coby White" or "Lamelo" or "Vucevic"
  const { data: bets, error } = await supabase
    .from('bets')
    .select('*')
    .or('selection.ilike.%Coby White%,selection.ilike.%Lamelo%,selection.ilike.%Vucevic%')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(20);
  
  if (error) {
    console.error('❌ Error fetching bets:', error);
    return;
  }
  
  if (!bets || bets.length === 0) {
    console.log('❌ No bets found matching the search criteria');
    return;
  }
  
  console.log(`Found ${bets.length} potential bets. Checking each one...\n`);
  
  for (const bet of bets) {
    // Check if it's a parlay
    if (!bet.selection || !bet.selection.startsWith('Parlay:')) {
      continue;
    }
    
    // Parse the legs
    const legs = parseParlayLegs(bet.selection);
    
    // Check if this matches the bet description
    const hasCobyWhite = legs.some(l => l.playerName.toLowerCase().includes('coby white') && l.statType === 'ast' && l.line === 4);
    const hasVucevic = legs.some(l => l.playerName.toLowerCase().includes('vucevic') && l.statType === 'reb' && l.line === 8);
    const hasLamelo3 = legs.some(l => l.playerName.toLowerCase().includes('lamelo') && l.statType === 'fg3m' && l.line === 1);
    const hasLameloPts = legs.some(l => l.playerName.toLowerCase().includes('lamelo') && l.statType === 'pts' && l.line === 10);
    
    if (hasCobyWhite && hasVucevic && hasLamelo3 && hasLameloPts) {
      console.log(`✅ Found the bet! ID: ${bet.id}\n`);
      console.log(`   Selection: ${bet.selection}`);
      console.log(`   Current result: ${bet.result}`);
      console.log(`   Status: ${bet.status}\n`);
      
      // Check each leg
      console.log('   Legs:');
      for (const leg of legs) {
        console.log(`     - ${leg.playerName} ${leg.overUnder} ${leg.line} ${leg.statType}`);
      }
      
      // Recalculate the parlay
      console.log('\n   Recalculating with new logic...');
      
      // For parlays, we need to check if all legs would win
      // Since we don't have the actual values stored per leg, we need to check the bet's actual_value
      // But for parlays, the actual_value might not be set per leg
      
      // Let's check if the bet should be a win based on the result being 'loss' but all legs should win
      // We'll need to manually verify or use the recalculation script
      
      console.log('\n   ⚠️  This is a parlay. To fix it, we need to:');
      console.log('      1. Verify each leg\'s actual value');
      console.log('      2. Recalculate using the new whole number logic');
      console.log('      3. Update the bet result if all legs should win\n');
      
      // Check if we can determine from the bet data
      if (bet.result === 'loss') {
        console.log('   💡 The bet is currently marked as LOSS');
        console.log('   💡 Based on your description, all legs should be wins:');
        console.log('      - Coby White 4+ assists (actual: 4) → WIN (4 >= 4)');
        console.log('      - Vucevic over 8 rebounds (actual: 14) → WIN (14 > 8)');
        console.log('      - Lamelo 1+ made 3 pointer (actual: 3) → WIN (3 >= 1)');
        console.log('      - Lamelo 10+ points (actual: 16) → WIN (16 >= 10)');
        console.log('\n   ✅ All legs should be wins, so the parlay should be a WIN\n');
        
        // Ask if we should update it
        console.log('   🔧 Would you like to update this bet to WIN?');
        console.log('   🔧 Run the recalculation script or manually update in Supabase.\n');
        
        console.log('   SQL to fix manually:');
        console.log(`   UPDATE bets SET result = 'win' WHERE id = '${bet.id}';\n`);
      }
      
      return bet;
    }
  }
  
  console.log('❌ Could not find the exact bet. Here are the bets found:');
  for (const bet of bets.slice(0, 5)) {
    console.log(`\n   Bet ID: ${bet.id}`);
    console.log(`   Selection: ${bet.selection?.substring(0, 100)}...`);
    console.log(`   Result: ${bet.result}`);
    console.log(`   Date: ${bet.date}`);
  }
}

findAndFixBet().catch(console.error);

