/**
 * Add specific journal bets for a user by email.
 * Usage: node scripts/add-user-journal-bets.js mduartee316@gmail.com
 *
 * Bets added:
 * - Jarrett Allen over 8.5 rebounds, loss, 29/01/2026, -152
 * - Devin Vassell over 10.5 points, win, 30/01/2026, -115
 * - Deandre Ayton over 6.5 rebounds, loss, 01/02/2026, -122
 *
 * Odds stored as decimal (American -152 = 1.658, -115 = 1.870, -122 = 1.820).
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// American odds to decimal (e.g. -152 -> 1.658)
function americanToDecimal(american) {
  if (american < 0) return 1 + 100 / Math.abs(american);
  return 1 + american / 100;
}

async function addUserJournalBets(email) {
  try {
    console.log(`\n🔍 Looking up user: ${email}\n`);

    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
    if (authError) {
      console.error('❌ Error fetching users:', authError);
      process.exit(1);
    }

    const user = authUsers.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!user) {
      console.error(`❌ User with email ${email} not found`);
      process.exit(1);
    }

    console.log(`✅ Found user: ${user.email} (ID: ${user.id})\n`);
    console.log('📝 Adding bets...\n');

    const bets = [
      {
        user_id: user.id,
        date: '2026-01-29',
        sport: 'NBA',
        market: 'Player Props',
        selection: 'Jarrett Allen Rebounds Over 8.5',
        stake: 100,
        currency: 'USD',
        odds: americanToDecimal(-152),
        result: 'loss',
        status: 'completed',
        player_name: 'Jarrett Allen',
        team: 'CLE',
        opponent: 'DET',
        stat_type: 'reb',
        line: 8.5,
        over_under: 'over',
        actual_value: 6,
        game_date: '2026-01-29',
        bookmaker: 'DraftKings',
      },
      {
        user_id: user.id,
        date: '2026-01-30',
        sport: 'NBA',
        market: 'Player Props',
        selection: 'Devin Vassell Points Over 10.5',
        stake: 100,
        currency: 'USD',
        odds: americanToDecimal(-115),
        result: 'win',
        status: 'completed',
        player_name: 'Devin Vassell',
        team: 'SAS',
        opponent: 'HOU',
        stat_type: 'pts',
        line: 10.5,
        over_under: 'over',
        actual_value: 15,
        game_date: '2026-01-30',
        bookmaker: 'DraftKings',
      },
      {
        user_id: user.id,
        date: '2026-02-01',
        sport: 'NBA',
        market: 'Player Props',
        selection: 'Deandre Ayton Rebounds Over 6.5',
        stake: 100,
        currency: 'USD',
        odds: americanToDecimal(-122),
        result: 'loss',
        status: 'completed',
        player_name: 'Deandre Ayton',
        team: 'POR',
        opponent: 'DEN',
        stat_type: 'reb',
        line: 6.5,
        over_under: 'over',
        actual_value: 4,
        game_date: '2026-02-01',
        bookmaker: 'DraftKings',
      },
    ];

    const { data, error } = await supabase.from('bets').insert(bets).select('id');

    if (error) {
      console.error('❌ Error inserting bets:', error);
      process.exit(1);
    }

    console.log(`✅ Successfully added 3 bets to journal for ${email}\n`);
    bets.forEach((b, i) => {
      const americanOdds = [-152, -115, -122][i];
      console.log(`   ${i + 1}. ${b.player_name} ${b.over_under} ${b.line} ${b.stat_type} – ${b.result} (${b.game_date}) @ ${americanOdds}`);
    });
    console.log('');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

const email = process.argv[2] || 'mduartee316@gmail.com';
addUserJournalBets(email);
