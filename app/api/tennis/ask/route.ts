import { NextRequest, NextResponse } from 'next/server';
import { TENNIS_AI_UNDER_MAINTENANCE } from '@/lib/tennis/constants';
import { tennisBestOf } from '@/lib/tennis/apiTennis';
import { runTennisAi } from '@/lib/tennisAi/live';
import type { TennisTour } from '@/lib/tennis/types';

function maintenanceResponse() {
  return NextResponse.json(
    {
      success: false,
      maintenance: true,
      error: 'AI Overview is under maintenance.',
      suggestions: [],
    },
    { status: 503 }
  );
}

function parseTour(value: unknown): TennisTour {
  return String(value || '').toUpperCase() === 'WTA' ? 'WTA' : 'ATP';
}

export async function GET(request: NextRequest) {
  if (TENNIS_AI_UNDER_MAINTENANCE) return maintenanceResponse();
  const player = String(request.nextUrl.searchParams.get('player') || '').trim();
  const opponent = String(request.nextUrl.searchParams.get('opponent') || '').trim();
  if (!player || !opponent) {
    return NextResponse.json({ success: true, suggestions: [], questions: [] });
  }
  const tour = parseTour(request.nextUrl.searchParams.get('tour'));
  const isGrandSlam = request.nextUrl.searchParams.get('isGrandSlam') === '1';
  const result = await runTennisAi({
    player,
    opponent,
    tour,
    bestOf: tennisBestOf(tour, isGrandSlam),
    tournament: request.nextUrl.searchParams.get('tournament'),
    surface: null,
  });
  return NextResponse.json({
    success: true,
    suggestions: result.questions.map((row) => row.text),
    questions: result.questions,
    markets: result.markets.filter((market) => market.priceable && !market.stale).map((market) => ({
      key: market.key,
      selection: market.selection,
      line: market.line,
      book: market.best?.book ?? null,
      odds: market.best?.decimalOdds ?? null,
    })),
  });
}

export async function POST(request: NextRequest) {
  if (TENNIS_AI_UNDER_MAINTENANCE) return maintenanceResponse();
  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
    player?: unknown;
    opponent?: unknown;
    tour?: unknown;
    isGrandSlam?: unknown;
    tournamentName?: unknown;
  } | null;
  const player = String(body?.player || '').trim();
  const opponent = String(body?.opponent || '').trim();
  const question = String(body?.question || '').trim();
  if (!player) return NextResponse.json({ success: false, error: 'Select a player first.' }, { status: 400 });
  if (!opponent) return NextResponse.json({ success: false, error: 'Select an opponent to run the match model.' }, { status: 400 });
  if (!question || question.length > 500) {
    return NextResponse.json({ success: false, error: 'Ask a short tennis question.' }, { status: 400 });
  }
  const tour = parseTour(body?.tour);
  const result = await runTennisAi({
    player,
    opponent,
    tour,
    bestOf: tennisBestOf(tour, body?.isGrandSlam === true),
    tournament: String(body?.tournamentName || ''),
    question,
  });
  if (result.missing === 'doubles') {
    return NextResponse.json({ success: false, error: 'Doubles and exhibitions are not in this model.' }, { status: 400 });
  }
  const answer = result.answer?.answer || 'Honestly, not really. We do not have a priced market for that.';
  return NextResponse.json({
    success: true,
    answer,
    reasoning: answer,
    breakdown: [],
    source: result.answer?.source || 'template',
    missing: result.missing,
    tier: result.pack?.priced.find((row) => row.market.key)?.tier ?? null,
  });
}
