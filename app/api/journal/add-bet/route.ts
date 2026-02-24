import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.error('[journal/add-bet] Failed to get user:', userError.message);
      return NextResponse.json({ error: 'Failed to authenticate user' }, { status: 401 });
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

    // Always enforce user_id on the server for safety
    const insertPayload = {
      ...bet,
      user_id: user.id,
    };

    const { error: insertError } = await supabase.from('bets').insert(insertPayload);

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

