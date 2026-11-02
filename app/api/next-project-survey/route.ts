import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdminRequest } from '@/lib/adminAuth';
import { NEXT_PROJECT_OPTIONS, type NextProjectOption } from '@/lib/nextProjectSurvey';
import { apiRateLimiter, checkRateLimit } from '@/lib/rateLimit';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TABLE = 'next_project_survey_votes';
const ADMIN_EMAIL = 'admin@stattrackr.co';
const OPTION_IDS = new Set<string>(NEXT_PROJECT_OPTIONS.map((o) => o.id));

async function bearerUser(request: NextRequest): Promise<{ id: string; email: string | null } | null> {
  const auth = request.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return error || !data.user ? null : { id: data.user.id, email: data.user.email ?? null };
}

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Save (or update) the signed-in user's answer. */
export async function POST(request: NextRequest) {
  const rate = checkRateLimit(request, apiRateLimiter);
  if (!rate.allowed && rate.response) return rate.response;
  const user = await bearerUser(request);
  if (!user) return NextResponse.json({ error: 'Please sign in again and try once more.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const choices = Array.isArray(body?.choices) ? [...new Set((body.choices as unknown[]).filter((c): c is NextProjectOption => typeof c === 'string' && OPTION_IDS.has(c)))] : [];
  if (!choices.length) return NextResponse.json({ error: 'Pick at least one option.' }, { status: 400 });
  const sportRequest = clean(body?.sportRequest, 80);
  if (choices.includes('another_sport') && sportRequest.length < 2) {
    return NextResponse.json({ error: 'Tell us which sport you want.' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from(TABLE).upsert(
    {
      user_id: user.id,
      user_email: user.email,
      choices,
      sport_request: choices.includes('another_sport') ? sportRequest : null,
      comment: clean(body?.comment, 500) || null,
      source_page: clean(body?.sourcePage, 40) || 'props',
      user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  if (error) {
    console.error('[NextProjectSurvey] save failed:', error.message);
    return NextResponse.json({ error: 'Could not save your answer. Please try again.' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

/**
 * ?view=status: whether the signed-in user has answered (the popup only opens when this succeeds).
 * Otherwise (admin only): totals per option, requested sports and every response.
 */
export async function GET(request: NextRequest) {
  const rate = checkRateLimit(request, apiRateLimiter);
  if (!rate.allowed && rate.response) return rate.response;
  const user = await bearerUser(request);

  if (request.nextUrl.searchParams.get('view') === 'status') {
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data, error } = await supabaseAdmin.from(TABLE).select('updated_at').eq('user_id', user.id).maybeSingle();
    if (error) return NextResponse.json({ error: 'Survey unavailable' }, { status: 503 });
    return NextResponse.json({ success: true, hasAnswered: Boolean(data), answeredAt: data?.updated_at ?? null });
  }

  const isAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL || (await authorizeAdminRequest(request)).authorized;
  if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('user_email, choices, sport_request, comment, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data ?? [];
  const totals = Object.fromEntries(NEXT_PROJECT_OPTIONS.map((o) => [o.id, rows.filter((r) => (r.choices as string[]).includes(o.id)).length]));
  const sports: Record<string, number> = {};
  for (const r of rows) {
    const s = String(r.sport_request || '').trim().toLowerCase();
    if (s) sports[s] = (sports[s] ?? 0) + 1;
  }
  return NextResponse.json({ success: true, totalResponses: rows.length, totals, sportRequests: sports, responses: rows });
}
