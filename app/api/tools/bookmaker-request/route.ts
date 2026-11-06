import { NextRequest, NextResponse } from 'next/server';
import { apiRateLimiter, checkRateLimit } from '@/lib/rateLimit';
import { allowToolsAccess, allowToolsInboxAdmin, toolsBearerUser } from '@/lib/tools/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TABLE = 'tools_bookmaker_requests';

/** Save a bookmaker add-request. */
export async function POST(request: NextRequest) {
  const rate = checkRateLimit(request, apiRateLimiter);
  if (!rate.allowed && rate.response) return rate.response;
  if (!(await allowToolsAccess(request))) {
    return NextResponse.json(
      { success: false, proRequired: true, error: 'Betting Tools is a Pro feature.' },
      { status: 403 }
    );
  }

  const user = await toolsBearerUser(request);
  const body = await request.json().catch(() => null);
  const bookmakerName = typeof body?.bookmaker === 'string' ? body.bookmaker.trim().slice(0, 80) : '';
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
  if (bookmakerName.length < 2) {
    return NextResponse.json({ success: false, error: 'Enter a bookmaker name.' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from(TABLE).insert({
    user_id: user?.id ?? null,
    user_email: user?.email ?? null,
    bookmaker_name: bookmakerName,
    note: note || null,
    status: 'open',
  });

  if (error) {
    console.error('[tools/bookmaker-request] insert failed:', error.message);
    return NextResponse.json({ success: false, error: 'Could not save the request.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

/** List recent bookmaker requests (Tools admin inbox). */
export async function GET(request: NextRequest) {
  const rate = checkRateLimit(request, apiRateLimiter);
  if (!rate.allowed && rate.response) return rate.response;
  if (!(await allowToolsInboxAdmin(request))) {
    return NextResponse.json(
      { success: false, adminRequired: true, error: 'Request inbox is admin-only.' },
      { status: 403 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('id, user_email, bookmaker_name, note, status, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[tools/bookmaker-request] list failed:', error.message);
    return NextResponse.json({ success: false, error: 'Could not load requests.' }, { status: 500 });
  }

  return NextResponse.json({ success: true, requests: data ?? [] });
}
