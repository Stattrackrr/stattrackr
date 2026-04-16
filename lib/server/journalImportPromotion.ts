import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { buildBetInsertPayload } from '@/lib/journalImport';

type ImportedBetRow = {
  id: string;
  user_id: string;
  source: string | null;
  source_book: string | null;
  source_external_id: string | null;
  import_batch_id: string | null;
  captured_at: string | null;
  normalized_bet: Record<string, unknown>;
  promoted_bet_id: string | null;
};

export async function promoteImportedBetRows(userId: string, importedBetIds: string[]) {
  if (importedBetIds.length === 0) {
    return { promoted: [], duplicates: [], failed: [] as Array<{ id: string; error: string }> };
  }

  const { data: importedRows, error: importedError } = await supabaseAdmin
    .from('imported_bets')
    .select(
      'id, user_id, source, source_book, source_external_id, import_batch_id, captured_at, normalized_bet, promoted_bet_id'
    )
    .eq('user_id', userId)
    .in('id', importedBetIds);

  if (importedError) {
    throw new Error(importedError.message);
  }

  const promoted: string[] = [];
  const duplicates: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const row of (importedRows ?? []) as ImportedBetRow[]) {
    if (row.promoted_bet_id) {
      duplicates.push(row.id);
      continue;
    }

    try {
      if (row.source_external_id && row.source_book) {
        const { data: existingBet } = await supabaseAdmin
          .from('bets')
          .select('id')
          .eq('user_id', userId)
          .eq('source_book', row.source_book)
          .eq('source_external_id', row.source_external_id)
          .maybeSingle();

        if (existingBet?.id) {
          await supabaseAdmin
            .from('imported_bets')
            .update({
              review_status: 'duplicate',
              reviewed_at: new Date().toISOString(),
              promoted_bet_id: existingBet.id,
              error_message: null,
            })
            .eq('id', row.id)
            .eq('user_id', userId);
          duplicates.push(row.id);
          continue;
        }
      }

      const insertPayload = buildBetInsertPayload(row.normalized_bet, userId, {
        source: row.source ?? 'extension',
        sourceBook: row.source_book,
        sourceExternalId: row.source_external_id,
        importBatchId: row.import_batch_id,
        capturedAt: row.captured_at,
      });

      const { data: insertedBet, error: insertError } = await supabaseAdmin
        .from('bets')
        .insert(insertPayload)
        .select('id')
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      await supabaseAdmin
        .from('imported_bets')
        .update({
          review_status: 'approved',
          reviewed_at: new Date().toISOString(),
          promoted_bet_id: insertedBet.id,
          error_message: null,
        })
        .eq('id', row.id)
        .eq('user_id', userId);

      promoted.push(row.id);
    } catch (error: any) {
      const message = error?.message || 'Failed to promote imported bet';
      await supabaseAdmin
        .from('imported_bets')
        .update({
          review_status: 'failed',
          error_message: message,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('user_id', userId);

      failed.push({ id: row.id, error: message });
    }
  }

  return { promoted, duplicates, failed };
}
