import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { pushRequestUserId, validPushEndpoint } from '@/lib/push/auth';

export const runtime = 'nodejs';

// push_subscriptions is not in the generated Supabase schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabaseAdmin as any;

const MIN_PCT = 0.5;
const MAX_PCT = 20;
const DEFAULT_PCT = 2;

function validKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function clampMinPct(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_PCT, Math.max(MIN_PCT, Math.round(n * 10) / 10));
}

/** Save this device's push subscription for the signed-in user. */
export async function POST(request: NextRequest) {
  const userId = await pushRequestUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    picks?: unknown;
    toolsArb?: unknown;
    toolsArbMinPct?: unknown;
  } | null;
  const sub = body?.subscription;
  if (!validPushEndpoint(sub?.endpoint) || !validKey(sub?.keys?.p256dh) || !validKey(sub?.keys?.auth)) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  }

  const { data: existing } = await db()
    .from('push_subscriptions')
    .select('picks, tools_arb, tools_arb_min_pct')
    .eq('endpoint', sub.endpoint)
    .maybeSingle();

  const picksSpecified = body != null && Object.prototype.hasOwnProperty.call(body, 'picks');
  const toolsSpecified = body != null && Object.prototype.hasOwnProperty.call(body, 'toolsArb');
  const minPct = clampMinPct(body?.toolsArbMinPct);

  // Picks enable path historically sent only { subscription } → keep picks true.
  const picks = picksSpecified
    ? Boolean(body!.picks)
    : toolsSpecified
      ? Boolean(existing?.picks)
      : true;
  const toolsArb = toolsSpecified ? Boolean(body!.toolsArb) : Boolean(existing?.tools_arb);
  const toolsArbMinPct =
    minPct ??
    (typeof existing?.tools_arb_min_pct === 'number' ? Number(existing.tools_arb_min_pct) : DEFAULT_PCT);

  const { error } = await db()
    .from('push_subscriptions')
    .upsert(
      {
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys!.p256dh,
        auth: sub.keys!.auth,
        picks,
        tools_arb: toolsArb,
        tools_arb_min_pct: toolsArbMinPct,
        user_agent: (request.headers.get('user-agent') || '').slice(0, 300) || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    ok: true,
    picks,
    toolsArb,
    toolsArbMinPct,
  });
}

/** Current channel flags for this device (used by Tools arb alerts UI). */
export async function GET(request: NextRequest) {
  const userId = await pushRequestUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const endpoint = request.nextUrl.searchParams.get('endpoint');
  if (!validPushEndpoint(endpoint)) return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });

  const { data, error } = await db()
    .from('push_subscriptions')
    .select('picks, tools_arb, tools_arb_min_pct')
    .eq('endpoint', endpoint)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json({
      picks: false,
      toolsArb: false,
      toolsArbMinPct: DEFAULT_PCT,
    });
  }
  return NextResponse.json({
    picks: Boolean(data.picks),
    toolsArb: Boolean(data.tools_arb),
    toolsArbMinPct:
      typeof data.tools_arb_min_pct === 'number' ? Number(data.tools_arb_min_pct) : DEFAULT_PCT,
  });
}

/** Turn alerts off for this device. */
export async function DELETE(request: NextRequest) {
  const userId = await pushRequestUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (!validPushEndpoint(body?.endpoint)) return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });

  const { error } = await db().from('push_subscriptions').delete().eq('endpoint', body.endpoint).eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
