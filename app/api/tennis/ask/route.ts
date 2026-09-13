import { NextRequest, NextResponse } from 'next/server';
import { answerTennisAsk, tennisAskConfigured, type TennisAskMessage } from '@/lib/tennis/askAnswer';
import { hydrateTennisMatchOverlay } from '@/lib/tennis/ingest';
import { buildTennisMatchAnalysis } from '@/lib/tennis/matchAnalyst';
import type { TennisTour } from '@/lib/tennis/types';

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

export async function GET() {
  return NextResponse.json({ success: true, configured: tennisAskConfigured() });
}

export async function POST(request: NextRequest) {
  await hydrateTennisMatchOverlay();
  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
    player?: unknown;
    opponent?: unknown;
    tour?: unknown;
    isGrandSlam?: unknown;
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
  const analysis = buildTennisMatchAnalysis({
    playerName: player,
    opponentName: opponent,
    tour: parseTour(body?.tour),
    isGrandSlam: body?.isGrandSlam === true,
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
