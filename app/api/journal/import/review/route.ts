import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getJournalRouteUser } from '@/lib/server/journalRouteAuth';
import { promoteImportedBetRows } from '@/lib/server/journalImportPromotion';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

    const action = typeof body?.action === 'string' ? body.action : '';
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((value: unknown): value is string => typeof value === 'string' && value.trim() !== '')
      : [];

    if (ids.length === 0) {
      return NextResponse.json({ error: 'Missing import ids' }, { status: 400 });
    }

    if (action === 'approve') {
      const result = await promoteImportedBetRows(user.id, ids);
      return NextResponse.json({ success: true, ...result });
    }

    if (action === 'reject') {
      const { error } = await supabaseAdmin
        .from('imported_bets')
        .update({
          review_status: 'rejected',
          reviewed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('user_id', user.id)
        .in('id', ids);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({ success: true, rejected: ids });
    }

    return NextResponse.json({ error: 'Unsupported review action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to review imported bets' },
      { status: 500 }
    );
  }
}
