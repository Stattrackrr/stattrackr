import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { pushRequestUserId, validPushEndpoint } from '@/lib/push/auth';

export const runtime = 'nodejs';

// push_subscriptions is not in the generated Supabase schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabaseAdmin as any;

function validKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

/** Save this device's push subscription for the signed-in user. */
export async function POST(request: NextRequest) {
  const userId = await pushRequestUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  } | null;
  const sub = body?.subscription;
  if (!validPushEndpoint(sub?.endpoint) || !validKey(sub?.keys?.p256dh) || !validKey(sub?.keys?.auth)) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  }

  const { error } = await db()
    .from('push_subscriptions')
    .upsert(
      {
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys!.p256dh,
        auth: sub.keys!.auth,
        picks: true,
        user_agent: (request.headers.get('user-agent') || '').slice(0, 300) || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
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
