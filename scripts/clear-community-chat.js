/**
 * Delete every message in the community (general) chat room.
 * Usage: node scripts/clear-community-chat.js
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
  auth: { autoRefreshToken: false, persistSession: false },
});

async function clearCommunityChat() {
  const { data: rooms, error: roomError } = await supabase.from('chat_rooms').select('id, slug');
  if (roomError) {
    throw roomError;
  }

  const general = (rooms ?? []).find((room) => room.slug === 'general');
  if (!general) {
    throw new Error('Chat room "general" not found.');
  }

  const { count: before, error: countError } = await supabase
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', general.id);

  if (countError) {
    throw countError;
  }

  const { error: deleteError, count: deleted } = await supabase
    .from('chat_messages')
    .delete({ count: 'exact' })
    .eq('room_id', general.id);

  if (deleteError) {
    throw deleteError;
  }

  const { count: after, error: afterError } = await supabase
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', general.id);

  if (afterError) {
    throw afterError;
  }

  console.log(
    JSON.stringify(
      {
        roomId: general.id,
        before: before ?? 0,
        deleted: deleted ?? 0,
        remaining: after ?? 0,
      },
      null,
      2
    )
  );
}

clearCommunityChat().catch((error) => {
  console.error(error);
  process.exit(1);
});
