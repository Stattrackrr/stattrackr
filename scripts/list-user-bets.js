/**
 * Script to list all bets for a user by email
 * Usage: node scripts/list-user-bets.js christian.sansone863@gmail.com
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

async function listUserBets(email) {
  try {
    console.log(`\n🔍 Looking up user: ${email}\n`);
    
    // Find user by email using auth admin API
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
    
    if (authError) {
      console.error('❌ Error fetching users:', authError);
      return;
    }

    const user = authUsers.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    
    if (!user) {
      console.error(`❌ User with email ${email} not found`);
      return;
    }

    console.log(`✅ Found user: ${user.email} (ID: ${user.id})\n`);
    console.log('📊 Fetching bets...\n');

    // Fetch all bets for this user
    const { data: bets, error: betsError } = await supabase
      .from('bets')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (betsError) {
      console.error('❌ Error fetching bets:', betsError);
      return;
    }

    if (!bets || bets.length === 0) {
      console.log('📭 No bets found for this user.\n');
      return;
    }

    console.log(`\n📋 Total bets: ${bets.length}\n`);
    console.log('='.repeat(100));
    
    bets.forEach((bet, index) => {
      console.log(`\n${index + 1}. Bet ID: ${bet.id}`);
      console.log(`   Date: ${bet.date || bet.game_date || 'N/A'}`);
      console.log(`   Sport: ${bet.sport || 'N/A'}`);
      
      if (bet.player_name) {
        console.log(`   Player: ${bet.player_name} (${bet.player_id || 'N/A'})`);
      }
      
      if (bet.team) {
        console.log(`   Teams: ${bet.team} vs ${bet.opponent || 'N/A'}`);
      }
      
      if (bet.stat_type) {
        const line = bet.line !== null && bet.line !== undefined ? bet.line : 'N/A';
        const overUnder = bet.over_under || '';
        console.log(`   Bet: ${bet.stat_type} ${overUnder} ${line}`);
      }
      
      if (bet.market) {
        console.log(`   Market: ${bet.market}`);
      }
      
      if (bet.selection) {
        console.log(`   Selection: ${bet.selection}`);
      }
      
      console.log(`   Stake: ${bet.currency || 'USD'} ${bet.stake || 'N/A'}`);
      console.log(`   Odds: ${bet.odds || 'N/A'}`);
      console.log(`   Result: ${bet.result || 'pending'} ${bet.result === 'loss' ? '❌' : bet.result === 'win' ? '✅' : bet.result === 'void' ? '⚪' : '⏳'}`);
      console.log(`   Status: ${bet.status || 'pending'}`);
      
      if (bet.actual_value !== null && bet.actual_value !== undefined) {
        console.log(`   Actual Value: ${bet.actual_value}`);
      }
      
      console.log(`   Created: ${bet.created_at || 'N/A'}`);
      console.log(`   Updated: ${bet.updated_at || 'N/A'}`);
      console.log('-'.repeat(100));
    });

    // Summary by result
    const summary = bets.reduce((acc, bet) => {
      acc[bet.result || 'pending'] = (acc[bet.result || 'pending'] || 0) + 1;
      return acc;
    }, {});

    console.log('\n📊 Summary by Result:');
    Object.entries(summary).forEach(([result, count]) => {
      const emoji = result === 'win' ? '✅' : result === 'loss' ? '❌' : result === 'void' ? '⚪' : '⏳';
      console.log(`   ${emoji} ${result}: ${count}`);
    });
    
    console.log('\n');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

const email = process.argv[2] || 'christian.sansone863@gmail.com';
listUserBets(email);

