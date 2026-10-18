import { NextRequest, NextResponse } from 'next/server';
import { pushRequestUserId, validPushEndpoint } from '@/lib/push/auth';
import { sendTestPush } from '@/lib/push/send';

export const runtime = 'nodejs';

/** Send a test notification to the caller's own device. */
export async function POST(request: NextRequest) {
  const userId = await pushRequestUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (!validPushEndpoint(body?.endpoint)) return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });

  const result = await sendTestPush(body.endpoint, userId);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, sent: result.sent });
}
