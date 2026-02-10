/**
 * Fix bet stats for a specific bet ID
 * Usage: node scripts/fix-bet-stats.js <bet-id>
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials. Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;

if (!BALLDONTLIE_API_KEY) {
  console.error('Missing BALLDONTLIE_API_KEY in .env.local');
  process.exit(1);
}

async function fixBetStats(betId) {
  console.log(`\n🔍 Inspecting bet: ${betId}\n`);
  console.log('='.repeat(80));

  // 1. Get bet details
  const { data: bet, error: betError } = await supabase
    .from('bets')
    .select('*')
    .eq('id', betId)
    .single();

  if (betError || !bet) {
    console.error('❌ Error fetching bet:', betError);
    return;
  }

  console.log('\n📋 Bet Details:');
  console.log(`   Player: ${bet.player_name}`);
  console.log(`   Stat Type: ${bet.stat_type}`);
  console.log(`   Line: ${bet.line}`);
  console.log(`   Over/Under: ${bet.over_under}`);
  console.log(`   Game Date: ${bet.game_date}`);
  console.log(`   Team: ${bet.team}`);
  console.log(`   Opponent: ${bet.opponent}`);
  console.log(`   Current Actual Value: ${bet.actual_value}`);
  console.log(`   Current Result: ${bet.result}`);
  console.log(`   Player ID: ${bet.player_id}`);

  if (!bet.player_id || !bet.game_date) {
    console.error('\n❌ Bet is missing player_id or game_date. Cannot proceed.');
    return;
  }

  // 2. Find the game for this bet
  const gameDate = bet.game_date.split('T')[0];
  console.log(`\n🎮 Fetching game for date: ${gameDate}`);

  const gamesResponse = await fetch(
    `https://api.balldontlie.io/v1/games?dates[]=${gameDate}`,
    {
      headers: {
        'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
      },
    }
  );

  if (!gamesResponse.ok) {
    console.error('❌ Failed to fetch games');
    return;
  }

  const gamesData = await gamesResponse.json();
  const games = gamesData.data || [];

  // Find matching game
  const game = games.find((g) => {
    const homeMatch = g.home_team?.full_name === bet.team || g.home_team?.abbreviation === bet.team;
    const visitorMatch = g.visitor_team?.full_name === bet.team || g.visitor_team?.abbreviation === bet.team;
    const homeOppMatch = g.home_team?.full_name === bet.opponent || g.home_team?.abbreviation === bet.opponent;
    const visitorOppMatch = g.visitor_team?.full_name === bet.opponent || g.visitor_team?.abbreviation === bet.opponent;
    return (homeMatch || visitorMatch) && (homeOppMatch || visitorOppMatch);
  });

  if (!game) {
    console.error('\n❌ Could not find matching game');
    return;
  }

  console.log(`   ✅ Found game: ${game.id} - ${game.home_team?.abbreviation} vs ${game.visitor_team?.abbreviation}`);
  console.log(`   Game Status: ${game.status}`);

  // 3. Check cached stats
  console.log(`\n💾 Checking cached stats...`);
  const { data: cachedStats } = await supabase
    .from('player_game_stats')
    .select('*')
    .eq('game_id', game.id)
    .eq('player_id', bet.player_id)
    .single();

  if (cachedStats) {
    console.log('   📦 Found cached stats:');
    console.log(`      Points: ${cachedStats.pts}`);
    console.log(`      Rebounds: ${cachedStats.reb}`);
    console.log(`      Assists: ${cachedStats.ast}`);
    console.log(`      Steals: ${cachedStats.stl}`);
    console.log(`      Blocks: ${cachedStats.blk}`);
    console.log(`      3PM: ${cachedStats.fg3m}`);
    console.log(`      Minutes: ${cachedStats.min}`);
  } else {
    console.log('   ⚠️  No cached stats found');
  }

  // 4. Fetch fresh stats from API
  console.log(`\n🔄 Fetching fresh stats from API...`);
  const statsResponse = await fetch(
    `https://api.balldontlie.io/v1/stats?game_ids[]=${game.id}&player_ids[]=${bet.player_id}`,
    {
      headers: {
        'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
      },
    }
  );

  if (!statsResponse.ok) {
    console.error('❌ Failed to fetch stats from API');
    return;
  }

  const statsData = await statsResponse.json();
  if (!statsData.data || statsData.data.length === 0) {
    console.error('❌ No stats found in API response');
    return;
  }

  const playerStat = statsData.data[0];
  console.log('   ✅ Fresh stats from API:');
  console.log(`      Points: ${playerStat.pts}`);
  console.log(`      Rebounds: ${playerStat.reb}`);
  console.log(`      Assists: ${playerStat.ast}`);
  console.log(`      Steals: ${playerStat.stl || 0}`);
  console.log(`      Blocks: ${playerStat.blk || 0}`);
  console.log(`      3PM: ${playerStat.fg3m || 0}`);
  console.log(`      Minutes: ${playerStat.min}`);

  // 5. Calculate correct actual value
  const statTypeNorm = (bet.stat_type || '').toLowerCase() === 'points' ? 'pts' : (bet.stat_type || '').toLowerCase();
  let actualValue = 0;

  switch (statTypeNorm) {
    case 'pts':
      actualValue = playerStat.pts || 0;
      break;
    case 'reb':
      actualValue = playerStat.reb || 0;
      break;
    case 'ast':
      actualValue = playerStat.ast || 0;
      break;
    case 'pa':
      actualValue = (playerStat.pts || 0) + (playerStat.ast || 0);
      break;
    case 'pr':
      actualValue = (playerStat.pts || 0) + (playerStat.reb || 0);
      break;
    case 'pra':
      actualValue = (playerStat.pts || 0) + (playerStat.reb || 0) + (playerStat.ast || 0);
      break;
    case 'ra':
      actualValue = (playerStat.reb || 0) + (playerStat.ast || 0);
      break;
    case 'stl':
      actualValue = playerStat.stl || 0;
      break;
    case 'blk':
      actualValue = playerStat.blk || 0;
      break;
    case 'fg3m':
      actualValue = playerStat.fg3m || 0;
      break;
    default:
      console.error(`❌ Unknown stat type: ${bet.stat_type}`);
      return;
  }

  console.log(`\n📊 Calculated Actual Value: ${actualValue} (for stat type: ${statTypeNorm})`);
  console.log(`   Current stored value: ${bet.actual_value}`);

  if (actualValue === bet.actual_value) {
    console.log('\n✅ Actual value is already correct!');
    return;
  }

  // 6. Update cached stats
  console.log(`\n💾 Updating cached stats...`);
  // Calculate composite stats
  const pra = (playerStat.pts || 0) + (playerStat.reb || 0) + (playerStat.ast || 0);
  const pr = (playerStat.pts || 0) + (playerStat.reb || 0);
  const pa = (playerStat.pts || 0) + (playerStat.ast || 0);
  const ra = (playerStat.reb || 0) + (playerStat.ast || 0);
  
  const normalizedStats = {
    game_id: game.id,
    player_id: bet.player_id,
    pts: playerStat.pts || 0,
    reb: playerStat.reb || 0,
    ast: playerStat.ast || 0,
    stl: playerStat.stl || 0,
    blk: playerStat.blk || 0,
    fg3m: playerStat.fg3m || 0,
    pra: pra,
    pr: pr,
    pa: pa,
    ra: ra,
    min: playerStat.min || '0:00',
    team_id: playerStat.team?.id,
    team_abbreviation: playerStat.team?.abbreviation,
    opponent_id: game.home_team?.id === playerStat.team?.id 
      ? game.visitor_team?.id 
      : game.home_team?.id,
    opponent_abbreviation: game.home_team?.abbreviation === playerStat.team?.abbreviation
      ? game.visitor_team?.abbreviation
      : game.home_team?.abbreviation,
    game_date: gameDate,
    updated_at: new Date().toISOString(),
  };

  const { error: cacheError } = await supabase
    .from('player_game_stats')
    .upsert(normalizedStats, {
      onConflict: 'game_id,player_id'
    });

  if (cacheError) {
    console.error('❌ Error updating cache:', cacheError);
  } else {
    console.log('   ✅ Cache updated');
  }

  // 7. Calculate result
  const line = Number(bet.line);
  const isWholeNumber = line % 1 === 0;
  let result = 'loss';

  if (bet.over_under === 'over') {
    result = isWholeNumber ? (actualValue >= line ? 'win' : 'loss') : (actualValue > line ? 'win' : 'loss');
  } else {
    result = isWholeNumber ? (actualValue <= line ? 'win' : 'loss') : (actualValue < line ? 'win' : 'loss');
  }

  console.log(`\n🎯 Calculated Result: ${result}`);
  console.log(`   Current result: ${bet.result}`);
  console.log(`   Line: ${line}, Actual: ${actualValue}, Over/Under: ${bet.over_under}`);

  // 8. Update bet
  console.log(`\n✏️  Updating bet...`);
  const { error: updateError } = await supabase
    .from('bets')
    .update({
      actual_value: actualValue,
      result: result,
      status: 'completed',
    })
    .eq('id', betId);

  if (updateError) {
    console.error('❌ Error updating bet:', updateError);
  } else {
    console.log('   ✅ Bet updated successfully!');
    console.log(`\n📝 Summary:`);
    console.log(`   Old actual_value: ${bet.actual_value} → New: ${actualValue}`);
    console.log(`   Old result: ${bet.result} → New: ${result}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Done!\n');
}

// Get bet ID from command line
const betId = process.argv[2];

if (!betId) {
  console.error('Usage: node scripts/fix-bet-stats.js <bet-id>');
  process.exit(1);
}

fixBetStats(betId).catch(console.error);
