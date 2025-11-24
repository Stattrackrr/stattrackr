/**
 * Check database size and row counts
 * Usage: node scripts/check-db-size.js
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function checkDatabaseSize() {
  try {
    console.log('📊 Checking database size...\n');

    // Count rows in odds_snapshots
    const { count: snapshotsCount, error: snapshotsError } = await supabaseAdmin
      .from('odds_snapshots')
      .select('*', { count: 'exact', head: true });

    if (snapshotsError) {
      console.error('❌ Error counting snapshots:', snapshotsError);
    } else {
      console.log(`📸 odds_snapshots: ${snapshotsCount?.toLocaleString() || 0} rows`);
    }

    // Count rows in line_movement_latest
    const { count: latestCount, error: latestError } = await supabaseAdmin
      .from('line_movement_latest')
      .select('*', { count: 'exact', head: true });

    if (latestError) {
      console.error('❌ Error counting line_movement_latest:', latestError);
    } else {
      console.log(`📊 line_movement_latest: ${latestCount?.toLocaleString() || 0} rows`);
    }

    // Count rows in line_movement_events
    const { count: eventsCount, error: eventsError } = await supabaseAdmin
      .from('line_movement_events')
      .select('*', { count: 'exact', head: true });

    if (eventsError) {
      console.error('❌ Error counting line_movement_events:', eventsError);
    } else {
      console.log(`📈 line_movement_events: ${eventsCount?.toLocaleString() || 0} rows`);
    }

    // Check how many snapshots are older than 12 hours
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const { count: oldSnapshotsCount, error: oldSnapshotsError } = await supabaseAdmin
      .from('odds_snapshots')
      .select('*', { count: 'exact', head: true })
      .lt('snapshot_at', twelveHoursAgo);

    if (oldSnapshotsError) {
      console.error('❌ Error counting old snapshots:', oldSnapshotsError);
    } else {
      console.log(`\n⏰ Snapshots older than 12 hours: ${oldSnapshotsCount?.toLocaleString() || 0} rows`);
    }

    // Check how many snapshots are older than 6 hours
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { count: sixHourOldCount, error: sixHourError } = await supabaseAdmin
      .from('odds_snapshots')
      .select('*', { count: 'exact', head: true })
      .lt('snapshot_at', sixHoursAgo);

    if (sixHourError) {
      console.error('❌ Error counting 6-hour-old snapshots:', sixHourError);
    } else {
      console.log(`⏰ Snapshots older than 6 hours: ${sixHourOldCount?.toLocaleString() || 0} rows`);
    }

    console.log('\n✅ Database check complete!');
  } catch (error) {
    console.error('❌ Error checking database:', error);
    process.exit(1);
  }
}

checkDatabaseSize();






