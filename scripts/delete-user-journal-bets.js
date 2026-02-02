/**
 * Delete all journal bets for a user by email.
 * Usage: node scripts/delete-user-journal-bets.js mduartee316@gmail.com
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (bypasses RLS).
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

async function deleteUserJournalBets(email) {
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

    console.log(`✅ Found user: ${user.email} (ID: ${user.id})`);

    // Count before delete
    const { count, error: countError } = await supabase
      .from('bets')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (countError) {
      console.error('❌ Error counting bets:', countError);
      process.exit(1);
    }

    const betCount = count ?? 0;
    if (betCount === 0) {
      console.log('\n📭 No bets found for this user. Nothing to delete.\n');
      return;
    }

    console.log(`\n🗑️  Deleting ${betCount} bet(s)...\n`);

    const { error: deleteError } = await supabase
      .from('bets')
      .delete()
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('❌ Error deleting bets:', deleteError);
      process.exit(1);
    }

    console.log(`✅ Successfully deleted ${betCount} bet(s) from journal for ${email}\n`);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

const email = process.argv[2] || 'mduartee316@gmail.com';
deleteUserJournalBets(email);
