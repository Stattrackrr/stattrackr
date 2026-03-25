/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';

// Use service role for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const DEFAULT_RETENTION_HOURS = 24;

/**
 * Clean up odds snapshots for finished games
 * Deletes all snapshots older than retention window (default 24 hours)
 * This keeps recent data for analysis while preventing storage bloat
 */
export async function cleanupFinishedGameSnapshots() {
  try {
    console.log('🧹 Starting cleanup of old odds snapshots...');
    const startTime = Date.now();

    const retentionHours = parseInt(
      process.env.ODDS_RETENTION_HOURS || String(DEFAULT_RETENTION_HOURS),
      10
    );
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - retentionHours * 60 * 60 * 1000);
    const cutoffISO = cutoffTime.toISOString();

    console.log(`⏰ Retention window: ${retentionHours} hours`);
    console.log(`⏰ Deleting all snapshots older than: ${cutoffISO}`);
    console.log(`⏰ Current time: ${now.toISOString()}`);

    // First, check how many snapshots exist older than cutoff for debugging
    const { count: oldSnapshotCount, error: countError } = await supabaseAdmin
      .from('odds_snapshots')
      .select('*', { count: 'exact', head: true })
      .lt('snapshot_at', cutoffISO);

    if (countError) {
      console.error('❌ Error counting old snapshots:', countError);
    } else {
      console.log(`📊 Found ${oldSnapshotCount || 0} snapshots older than cutoff`);
    }

    // Also check the oldest snapshot for reference
    const { data: oldestSnapshot, error: oldestError } = await supabaseAdmin
      .from('odds_snapshots')
      .select('snapshot_at, id')
      .order('snapshot_at', { ascending: true })
      .limit(1);

    if (oldestError) {
      console.error('❌ Error getting oldest snapshot:', oldestError);
    } else if (oldestSnapshot && oldestSnapshot.length > 0) {
      console.log(`📊 Oldest snapshot in database: ${oldestSnapshot[0].snapshot_at} (ID: ${oldestSnapshot[0].id})`);
    }

    // Delete all snapshots older than cutoff in batches to avoid timeouts
    // PostgREST doesn't support limit() on delete, so we select IDs first, then delete
    console.log('📊 Deleting old snapshots...');
    let totalDeleted = 0;
    const batchSize = 5000; // Process 5000 at a time
    
    while (true) {
      // First, get a batch of IDs to delete
      const { data: idsToDelete, error: selectError } = await supabaseAdmin
        .from('odds_snapshots')
        .select('id')
        .lt('snapshot_at', cutoffISO)
        .limit(batchSize);

      if (selectError) {
        console.error('❌ Error selecting snapshots to delete:', selectError);
        throw selectError;
      }

      // If no more rows to delete, we're done
      if (!idsToDelete || idsToDelete.length === 0) {
        console.log('📊 No more snapshots to delete');
        break;
      }

      console.log(`📊 Found ${idsToDelete.length} snapshots to delete in this batch`);

      const idArray = idsToDelete.map(row => row.id);

      // Delete this batch by IDs
      const { error: deleteError, count: deletedCount } = await supabaseAdmin
        .from('odds_snapshots')
        .delete({ count: 'exact' })
        .in('id', idArray);

      if (deleteError) {
        console.error('❌ Error deleting snapshots:', deleteError);
        throw deleteError;
      }

      const deleted = deletedCount || 0;
      totalDeleted += deleted;
      
      console.log(`  ✅ Deleted ${deleted} snapshots (total: ${totalDeleted})`);
      
      // If we got less than batchSize, we're done
      if (idsToDelete.length < batchSize) {
        break;
      }
      
      // Small delay between batches to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    const elapsed = Date.now() - startTime;
    console.log(`✅ Cleanup complete! Deleted ${totalDeleted} snapshots in ${elapsed}ms`);

    return {
      deleted: totalDeleted,
      gamesCleaned: 0, // We don't track individual games with this approach
      elapsed: `${elapsed}ms`
    };
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    throw error;
  }
}


