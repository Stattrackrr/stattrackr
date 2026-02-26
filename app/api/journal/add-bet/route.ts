import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    let user: { id: string } | null = null;

    const authHeader = req.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user: tokenUser }, error: tokenError } = await supabase.auth.getUser(token);
      if (!tokenError && tokenUser) user = tokenUser;
    }
    if (!user) {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (!sessionError && session?.user) user = session.user;
    }
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const bet = body?.bet;

    if (!bet || typeof bet !== 'object') {
      return NextResponse.json({ error: 'Missing bet payload' }, { status: 400 });
    }

    // Always enforce user_id on the server for safety. Use admin client so insert succeeds
    // regardless of cookie/session context (RLS would block when auth is via Bearer token only).
    const insertPayload = {
      ...bet,
      user_id: user.id,
    };

    const { error: insertError } = await supabaseAdmin.from('bets').insert(insertPayload);

    if (insertError) {
      console.error('[journal/add-bet] Insert error:', insertError.message);
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[journal/add-bet] Unexpected error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to add bet to journal' },
      { status: 500 }
    );
  }
}

