require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('   Required: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Create admin client that bypasses RLS
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
 * Recalculate journal bets
 */
async function recalculateJournalBets() {
  console.log('\n📊 Recalculating journal bets...\n');
  
  // Get all completed bets with actual_value set (meaning they were checked)
  // Focus on losses first, as those are most likely to be incorrectly marked
  const { data: bets, error } = await supabase
    .from('bets')
    .select('*')
    .eq('status', 'completed')
    .not('actual_value', 'is', null)
    .not('line', 'is', null)
    .not('over_under', 'is', null)
    .in('result', ['win', 'loss']); // Include both wins and losses to check
  
  if (error) {
    console.error('❌ Error fetching journal bets:', error);
    return;
  }
  
  if (!bets || bets.length === 0) {
    console.log('✅ No journal bets to recalculate');
    return;
  }
  
  console.log(`Found ${bets.length} completed journal bets to check\n`);
  
  let updatedCount = 0;
  let winCount = 0;
  let lossCount = 0;
  let wholeNumberCount = 0;
  let skippedCount = 0;
  
  for (const bet of bets) {
    // Skip if no line or over_under
    if (!bet.line || !bet.over_under) {
      skippedCount++;
      continue;
    }
    
    // Only recalculate whole number lines (these were affected)
    if (!isWholeNumber(bet.line)) {
      continue;
    }
    
    wholeNumberCount++;
    
    // Skip if already void
    if (bet.result === 'void') {
      skippedCount++;
      continue;
    }
    
    const actualValue = bet.actual_value;
    if (actualValue === null || actualValue === undefined) {
      skippedCount++;
      continue;
    }
    
    // Check if it should be a win with new logic
    const shouldBeWin = shouldWin(actualValue, bet.line, bet.over_under);
    const currentIsWin = bet.result === 'win';
    
    // Only update if the result would change
    // This happens when:
    // - "over 4" with actual 4 was marked as loss (should be win)
    // - "under 4" with actual 4 was marked as loss (should be win)
    if (shouldBeWin !== currentIsWin) {
      const newResult = shouldBeWin ? 'win' : 'loss';
      
      console.log(`📝 Bet ID ${bet.id}:`);
      console.log(`   Player: ${bet.player_name || 'N/A'}`);
      console.log(`   Line: ${bet.over_under} ${bet.line} ${bet.stat_type || ''}`);
      console.log(`   Actual: ${actualValue}`);
      console.log(`   Old result: ${bet.result}`);
      console.log(`   New result: ${newResult}`);
      
      const { error: updateError } = await supabase
        .from('bets')
        .update({ result: newResult })
        .eq('id', bet.id);
      
      if (updateError) {
        console.error(`   ❌ Failed to update: ${updateError.message}`);
      } else {
        console.log(`   ✅ Updated to ${newResult}\n`);
        updatedCount++;
        if (newResult === 'win') winCount++;
        else lossCount++;
      }
    }
  }
  
  console.log(`\n✅ Journal bets recalculation complete:`);
  console.log(`   Total checked: ${bets.length}`);
  console.log(`   Whole number lines: ${wholeNumberCount}`);
  console.log(`   Skipped: ${skippedCount}`);
  console.log(`   Updated: ${updatedCount}`);
  console.log(`   Now wins: ${winCount}`);
  console.log(`   Now losses: ${lossCount}`);
  
  if (updatedCount === 0 && wholeNumberCount > 0) {
    console.log(`\n   ℹ️  No bets needed updating. This could mean:`);
    console.log(`      - All bets were already correctly calculated`);
    console.log(`      - No bets had actualValue === line for whole number lines`);
    console.log(`      - Affected bets may have been manually corrected`);
  }
}

/**
 * Recalculate tracked props
 */
async function recalculateTrackedProps() {
  console.log('\n📊 Recalculating tracked props...\n');
  
  // Get all completed tracked props with actual_value set
  // Focus on losses first, as those are most likely to be incorrectly marked
  const { data: props, error } = await supabase
    .from('tracked_props')
    .select('*')
    .eq('status', 'completed')
    .not('actual_value', 'is', null)
    .not('line', 'is', null)
    .not('over_under', 'is', null)
    .in('result', ['win', 'loss']); // Include both wins and losses to check
  
  if (error) {
    console.error('❌ Error fetching tracked props:', error);
    return;
  }
  
  if (!props || props.length === 0) {
    console.log('✅ No tracked props to recalculate');
    return;
  }
  
  console.log(`Found ${props.length} completed tracked props to check\n`);
  
  let updatedCount = 0;
  let winCount = 0;
  let lossCount = 0;
  let wholeNumberCount = 0;
  let skippedCount = 0;
  
  for (const prop of props) {
    // Skip if no line or over_under
    if (!prop.line || !prop.over_under) {
      skippedCount++;
      continue;
    }
    
    // Only recalculate whole number lines (these were affected)
    if (!isWholeNumber(prop.line)) {
      continue;
    }
    
    wholeNumberCount++;
    
    // Skip if already void
    if (prop.result === 'void') {
      skippedCount++;
      continue;
    }
    
    const actualValue = prop.actual_value;
    if (actualValue === null || actualValue === undefined) {
      skippedCount++;
      continue;
    }
    
    // Check if it should be a win with new logic
    const shouldBeWin = shouldWin(actualValue, prop.line, prop.over_under);
    const currentIsWin = prop.result === 'win';
    
    // Only update if the result would change
    // This happens when:
    // - "over 4" with actual 4 was marked as loss (should be win)
    // - "under 4" with actual 4 was marked as loss (should be win)
    if (shouldBeWin !== currentIsWin) {
      const newResult = shouldBeWin ? 'win' : 'loss';
      
      console.log(`📝 Prop ID ${prop.id}:`);
      console.log(`   Player: ${prop.player_name || 'N/A'}`);
      console.log(`   Line: ${prop.over_under} ${prop.line} ${prop.stat_type || ''}`);
      console.log(`   Actual: ${actualValue}`);
      console.log(`   Old result: ${prop.result}`);
      console.log(`   New result: ${newResult}`);
      
      const { error: updateError } = await supabase
        .from('tracked_props')
        .update({ result: newResult })
        .eq('id', prop.id);
      
      if (updateError) {
        console.error(`   ❌ Failed to update: ${updateError.message}`);
      } else {
        console.log(`   ✅ Updated to ${newResult}\n`);
        updatedCount++;
        if (newResult === 'win') winCount++;
        else lossCount++;
      }
    }
  }
  
  console.log(`\n✅ Tracked props recalculation complete:`);
  console.log(`   Total checked: ${props.length}`);
  console.log(`   Whole number lines: ${wholeNumberCount}`);
  console.log(`   Skipped: ${skippedCount}`);
  console.log(`   Updated: ${updatedCount}`);
  console.log(`   Now wins: ${winCount}`);
  console.log(`   Now losses: ${lossCount}`);
  
  if (updatedCount === 0 && wholeNumberCount > 0) {
    console.log(`\n   ℹ️  No props needed updating. This could mean:`);
    console.log(`      - All props were already correctly calculated`);
    console.log(`      - No props had actualValue === line for whole number lines`);
    console.log(`      - Affected props may have been manually corrected`);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🔄 Recalculating bets with new whole number line logic...\n');
  console.log('This will fix bets that were incorrectly marked as losses');
  console.log('when they should have been wins (e.g., "4+" requiring 5+ instead of 4+)\n');
  
  await recalculateJournalBets();
  await recalculateTrackedProps();
  
  console.log('\n✅ All recalculations complete!\n');
}

main().catch(console.error);

