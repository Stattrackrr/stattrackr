import { NextResponse } from 'next/server';
import { normalizeSportsbookImportPayload, type NormalizedImportRecord } from '@/lib/journalImport';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getJournalRouteUser } from '@/lib/server/journalRouteAuth';
import { promoteImportedBetRows } from '@/lib/server/journalImportPromotion';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const user = await getJournalRouteUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const limit = Math.min(Number(url.searchParams.get('limit') || '25'), 100);

    let query = supabaseAdmin
      .from('imported_bets')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(Number.isFinite(limit) ? limit : 25);

    if (status && status !== 'all') {
      query = query.eq('review_status', status);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ imports: data ?? [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load imported bets' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await getJournalRouteUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const inputs = Array.isArray(body?.imports)
      ? body.imports
      : body?.import
        ? [body.import]
        : [];

    if (inputs.length === 0) {
      return NextResponse.json({ error: 'Missing import payload' }, { status: 400 });
    }

    const sharedBatchId =
      typeof body?.import_batch_id === 'string' && body.import_batch_id.trim()
        ? body.import_batch_id.trim()
        : crypto.randomUUID();
    const autoAddAll = body?.auto_add === true;

    const normalizedInputs: NormalizedImportRecord[] = inputs.map((value: unknown) => {
      if (!value || typeof value !== 'object') {
        throw new Error('Each import must be an object');
      }
      const normalized = normalizeSportsbookImportPayload(value as Record<string, unknown>);
      return {
        ...normalized,
        autoAdd: autoAddAll || normalized.autoAdd,
      };
    });

    const dedupeKeys = normalizedInputs.map((item) => item.dedupeKey);
    const { data: existingImports, error: existingError } = await supabaseAdmin
      .from('imported_bets')
      .select('id, dedupe_key, review_status')
      .eq('user_id', user.id)
      .in('dedupe_key', dedupeKeys);

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 400 });
    }

    const existingByKey = new Map(
      (existingImports ?? []).map((row) => [row.dedupe_key as string, row])
    );

    const rowsToInsert = normalizedInputs
      .filter((item) => !existingByKey.has(item.dedupeKey))
      .map((item) => ({
        user_id: user.id,
        source: item.source,
        source_book: item.sourceBook,
        source_external_id: item.sourceExternalId,
        source_page_url: item.sourcePageUrl,
        import_batch_id: sharedBatchId,
        dedupe_key: item.dedupeKey,
        review_status: 'pending_review',
        normalized_bet: item.normalizedBet,
        raw_payload: item.rawPayload,
        parse_notes: item.parseNotes,
        captured_at: item.capturedAt,
      }));

    let insertedRows: Array<{ id: string; dedupe_key: string }> = [];
    if (rowsToInsert.length > 0) {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('imported_bets')
        .insert(rowsToInsert)
        .select('id, dedupe_key');

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 400 });
      }

      insertedRows = inserted ?? [];
    }

    const duplicateRows = normalizedInputs
      .filter((item) => existingByKey.has(item.dedupeKey))
      .map((item) => {
        const existing = existingByKey.get(item.dedupeKey)!;
        return {
          id: existing.id as string,
          dedupe_key: item.dedupeKey,
          review_status: existing.review_status as string,
        };
      });

    const autoApproveIds = insertedRows
      .filter((row) =>
        normalizedInputs.some((item) => item.dedupeKey === row.dedupe_key && item.autoAdd)
      )
      .map((row) => row.id);

    let promotionResult = { promoted: [] as string[], duplicates: [] as string[], failed: [] as Array<{ id: string; error: string }> };
    if (autoApproveIds.length > 0) {
      promotionResult = await promoteImportedBetRows(user.id, autoApproveIds);
    }

    return NextResponse.json({
      success: true,
      import_batch_id: sharedBatchId,
      inserted_count: insertedRows.length,
      duplicate_count: duplicateRows.length + promotionResult.duplicates.length,
      promoted_count: promotionResult.promoted.length,
      failed: promotionResult.failed,
      inserted_ids: insertedRows.map((row) => row.id),
      duplicate_rows: duplicateRows,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to import sportsbook bets' },
      { status: 500 }
    );
  }
}
