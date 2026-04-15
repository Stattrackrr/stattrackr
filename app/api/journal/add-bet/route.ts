import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_RESULTS = new Set(['pending', 'win', 'loss', 'void']);
const VALID_STATUSES = new Set(['pending', 'live', 'completed']);
const VALID_OVER_UNDER = new Set(['over', 'under']);

function asOptionalTrimmedString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asRequiredTrimmedString(value: unknown, field: string): string {
  const normalized = asOptionalTrimmedString(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function asFiniteNumber(value: unknown, field: string): number {
  const normalized =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isFinite(normalized)) {
    throw new Error(`${field} must be a valid number`);
  }
  return normalized;
}

function sanitizeParlayLegs(value: unknown) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new Error('parlay_legs must be an array');
  }

  return value.map((leg, index) => {
    if (!leg || typeof leg !== 'object') {
      throw new Error(`parlay_legs[${index}] must be an object`);
    }

    const record = leg as Record<string, unknown>;
    const overUnder = asOptionalTrimmedString(record.overUnder);
    if (overUnder && !VALID_OVER_UNDER.has(overUnder)) {
      throw new Error(`parlay_legs[${index}].overUnder must be over or under`);
    }

    const lineValue = record.line;
    const normalizedLine =
      lineValue === null || lineValue === undefined || lineValue === ''
        ? null
        : asFiniteNumber(lineValue, `parlay_legs[${index}].line`);

    const wonValue = record.won;
    const normalizedWon =
      wonValue === null || wonValue === undefined ? null : Boolean(wonValue);

    const voidValue = record.void;
    const normalizedVoid =
      voidValue === null || voidValue === undefined ? null : Boolean(voidValue);

    return {
      playerName: asOptionalTrimmedString(record.playerName),
      playerId: asOptionalTrimmedString(record.playerId),
      team: asOptionalTrimmedString(record.team),
      opponent: asOptionalTrimmedString(record.opponent),
      gameDate: asOptionalTrimmedString(record.gameDate),
      overUnder: overUnder as 'over' | 'under' | null,
      line: normalizedLine,
      statType: asOptionalTrimmedString(record.statType),
      isGameProp: typeof record.isGameProp === 'boolean' ? record.isGameProp : null,
      won: normalizedWon,
      void: normalizedVoid,
    };
  });
}

function buildInsertPayload(bet: Record<string, unknown>, userId: string) {
  const result = asOptionalTrimmedString(bet.result) ?? 'pending';
  if (!VALID_RESULTS.has(result)) {
    throw new Error('result must be pending, win, loss, or void');
  }

  const status = asOptionalTrimmedString(bet.status) ?? 'pending';
  if (!VALID_STATUSES.has(status)) {
    throw new Error('status must be pending, live, or completed');
  }

  const overUnder = asOptionalTrimmedString(bet.over_under);
  if (overUnder && !VALID_OVER_UNDER.has(overUnder)) {
    throw new Error('over_under must be over or under');
  }

  const lineValue = bet.line;
  const line =
    lineValue === null || lineValue === undefined || lineValue === ''
      ? null
      : asFiniteNumber(lineValue, 'line');

  return {
    user_id: userId,
    date: asRequiredTrimmedString(bet.date, 'date'),
    sport: asRequiredTrimmedString(bet.sport, 'sport').toUpperCase(),
    market: asOptionalTrimmedString(bet.market),
    selection: asRequiredTrimmedString(bet.selection, 'selection'),
    stake: asFiniteNumber(bet.stake, 'stake'),
    currency: asRequiredTrimmedString(bet.currency, 'currency').toUpperCase(),
    odds: asFiniteNumber(bet.odds, 'odds'),
    result,
    status,
    bookmaker: asOptionalTrimmedString(bet.bookmaker),
    player_id: asOptionalTrimmedString(bet.player_id),
    player_name: asOptionalTrimmedString(bet.player_name),
    team: asOptionalTrimmedString(bet.team),
    opponent: asOptionalTrimmedString(bet.opponent),
    stat_type: asOptionalTrimmedString(bet.stat_type),
    line,
    over_under: overUnder as 'over' | 'under' | null,
    game_date: asOptionalTrimmedString(bet.game_date),
    parlay_legs: sanitizeParlayLegs(bet.parlay_legs),
  };
}

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
    let insertPayload;
    try {
      insertPayload = buildInsertPayload(bet as Record<string, unknown>, user.id);
    } catch (validationError: any) {
      return NextResponse.json(
        { error: validationError?.message || 'Invalid bet payload' },
        { status: 400 }
      );
    }

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

