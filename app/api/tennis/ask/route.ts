import { NextRequest, NextResponse } from 'next/server';
import { TENNIS_AI_UNDER_MAINTENANCE } from '@/lib/tennis/constants';
import { answerTennisAsk, tennisAskConfigured, type TennisAskMessage } from '@/lib/tennis/askAnswer';
import { buildTennisAskBrief, buildTennisAskSuggestions } from '@/lib/tennis/askBrief';
import { inferBestOfFromOdds, summarizeTennisAskOdds } from '@/lib/tennis/askOdds';
import { tennisBestOf } from '@/lib/tennis/apiTennis';
import { hydrateTennisOverlayLocal } from '@/lib/tennis/ingest';
import { buildTennisMatchAnalysis } from '@/lib/tennis/matchAnalyst';
import { getTennisMatchOddsForPlayer } from '@/lib/tennis/odds';
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

function parseTour(value: unknown): TennisTour | null {
  const tourParam = String(value || '').toUpperCase();
  return tourParam === 'WTA' || tourParam === 'ATP' ? tourParam : null;
}

function parseHistory(raw: unknown): TennisAskMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (msg): msg is TennisAskMessage =>
        Boolean(msg) &&
        (msg.role === 'user' || msg.role === 'assistant') &&
        typeof msg.content === 'string'
    )
    .slice(-8)
    .map((msg) => ({ role: msg.role, content: msg.content.slice(0, 2000) }));
}

function analysisResponse(
  analysis: NonNullable<ReturnType<typeof buildTennisMatchAnalysis>>,
  reply: { answer: string; breakdown: string[]; source: 'model' | 'stats' }
) {
  return NextResponse.json({
    success: true,
    analysis,
    reasoning: reply.answer,
    answer: reply.answer,
    breakdown: reply.breakdown,
    source: reply.source,
    configured: tennisAskConfigured(),
    player: analysis.player.name,
    opponent: analysis.opponent.name,
  });
}

export async function GET(request: NextRequest) {
  if (TENNIS_AI_UNDER_MAINTENANCE) return maintenanceResponse();
  const player = String(request.nextUrl.searchParams.get('player') || '').trim();
  const opponent = String(request.nextUrl.searchParams.get('opponent') || '').trim();
  if (!player || !opponent) {
    return NextResponse.json({ success: true, configured: tennisAskConfigured(), suggestions: [] });
  }
  await hydrateTennisOverlayLocal();
  const tour = parseTour(request.nextUrl.searchParams.get('tour'));
  const isGrandSlam = request.nextUrl.searchParams.get('isGrandSlam') === '1';
  const tournamentName = String(request.nextUrl.searchParams.get('tournament') || '').trim() || null;
  const declared = tennisBestOf(tour, isGrandSlam);
  const odds = await getTennisMatchOddsForPlayer({ playerName: player });
  const bestOf = inferBestOfFromOdds(declared, odds);
  const market = summarizeTennisAskOdds(odds, bestOf);
  const brief = buildTennisAskBrief({
    playerName: player,
    opponentName: opponent,
    tour,
    isGrandSlam: isGrandSlam || bestOf === 5,
    tournamentName,
  });
  return NextResponse.json({
    success: true,
    configured: tennisAskConfigured(),
    suggestions: buildTennisAskSuggestions(brief, {
      isGrandSlam: isGrandSlam || bestOf === 5,
      listedTotalLine: market.listedTotalLine,
    }),
  });
}

export async function POST(request: NextRequest) {
  if (TENNIS_AI_UNDER_MAINTENANCE) return maintenanceResponse();
  await hydrateTennisOverlayLocal();
  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
    player?: unknown;
    opponent?: unknown;
    tour?: unknown;
    isGrandSlam?: unknown;
    tournamentName?: unknown;
    history?: TennisAskMessage[];
  } | null;
  const question = String(body?.question || '').trim() || 'Where is the biggest edge in this match?';
  const player = String(body?.player || '').trim();
  const opponent = String(body?.opponent || '').trim();
  if (!player) {
    return NextResponse.json({ success: false, error: 'Select a player first.' }, { status: 400 });
  }
  if (!opponent) {
    return NextResponse.json({ success: false, error: 'Select an opponent to run the match model.' }, { status: 400 });
  }
  if (question.length > 500) {
    return NextResponse.json({ success: false, error: 'Ask a short tennis question.' }, { status: 400 });
  }
  const tour = parseTour(body?.tour);
  const isGrandSlam = body?.isGrandSlam === true;
  const tournamentName = String(body?.tournamentName || '').trim() || null;
  const declared = tennisBestOf(tour, isGrandSlam);
  const odds = await getTennisMatchOddsForPlayer({ playerName: player });
  const bestOf = inferBestOfFromOdds(declared, odds);
  const market = summarizeTennisAskOdds(odds, bestOf);
  const analysis = buildTennisMatchAnalysis({
    playerName: player,
    opponentName: opponent,
    tour,
    isGrandSlam: isGrandSlam || bestOf === 5,
    tournamentName,
    listedTotalLine: market.listedTotalLine,
    marketOdds: market,
  });
  if (!analysis) {
    return NextResponse.json({ success: false, error: 'Not enough match logs for this matchup.' }, { status: 404 });
  }
  const result = await answerTennisAsk({
    question,
    analysis,
    history: parseHistory(body?.history),
  });
  return analysisResponse(analysis, result);
}
