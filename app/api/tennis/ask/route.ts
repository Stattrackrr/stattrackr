import { NextRequest, NextResponse } from 'next/server';
import { tennisBestOf } from '@/lib/tennis/apiTennis';
import { answerTennisAsk } from '@/lib/tennis/askAnswer';
import { inferBestOfFromOdds, summarizeTennisAskOdds } from '@/lib/tennis/askOdds';
import { TENNIS_AI_UNDER_MAINTENANCE } from '@/lib/tennis/constants';
import { loadPlayerMatchesCached } from '@/lib/tennis/loadCached';
import { buildTennisMatchAnalysis } from '@/lib/tennis/matchAnalyst';
import { getTennisMatchOddsForPlayer } from '@/lib/tennis/odds';
import { runTennisAi } from '@/lib/tennisAi/live';
import type { TennisTour } from '@/lib/tennis/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

function parseHistory(raw: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const rec = row as { role?: unknown; content?: unknown };
      const role = rec?.role === 'assistant' ? 'assistant' : rec?.role === 'user' ? 'user' : null;
      const content = String(rec?.content || '').trim();
      return role && content ? { role, content } : null;
    })
    .filter((row): row is { role: 'user' | 'assistant'; content: string } => Boolean(row))
    .slice(-6);
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
    playerId?: unknown;
    opponent?: unknown;
    tour?: unknown;
    isGrandSlam?: unknown;
    tournamentName?: unknown;
    stat?: unknown;
    selectedLine?: unknown;
    history?: unknown;
  } | null;
  const player = String(body?.player || '').trim();
  const playerId = String(body?.playerId || '').trim();
  const opponent = String(body?.opponent || '').trim();
  const question = String(body?.question || '').trim();
  const viewingStat = String(body?.stat || '').trim() || null;
  const selectedRaw = Number(body?.selectedLine);
  const viewingLine = Number.isFinite(selectedRaw) ? selectedRaw : null;
  if (!player) return NextResponse.json({ success: false, error: 'Select a player first.' }, { status: 400 });
  if (!opponent) return NextResponse.json({ success: false, error: 'Select an opponent to run the match model.' }, { status: 400 });
  if (!question || question.length > 500) {
    return NextResponse.json({ success: false, error: 'Ask a short tennis question.' }, { status: 400 });
  }
  const tour = parseTour(body?.tour);
  const declaredBestOf = tennisBestOf(tour, body?.isGrandSlam === true);
  const tournament = String(body?.tournamentName || '');
  const history = parseHistory(body?.history);

  try {
    const [odds, playerRows, oppRows] = await Promise.all([
      Promise.race([
        getTennisMatchOddsForPlayer({
          playerId: playerId || null,
          playerName: player,
          opponentName: opponent,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
      ]),
      loadPlayerMatchesCached({
        playerId: playerId || null,
        playerName: player,
        tour,
        opponentName: opponent,
      }),
      loadPlayerMatchesCached({
        playerName: opponent,
        tour,
        opponentName: player,
      }),
    ]);
    const bestOf = inferBestOfFromOdds(declaredBestOf, odds);
    const marketOdds = summarizeTennisAskOdds(odds, bestOf);
    const analysis = buildTennisMatchAnalysis({
      playerName: player,
      opponentName: opponent,
      tour,
      isGrandSlam: bestOf === 5,
      tournamentName: tournament,
      listedTotalLine: marketOdds.listedTotalLine,
      marketOdds,
      playerRows,
      oppRows,
    });
    if (analysis) {
      const reply = await answerTennisAsk({
        question,
        analysis,
        history,
        viewingStat,
        viewingLine,
      });
      return NextResponse.json({
        success: true,
        answer: reply.answer,
        reasoning: reply.answer,
        breakdown: reply.breakdown,
        source: reply.source,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ask failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  const result = await runTennisAi({
    player,
    opponent,
    playerId: playerId || null,
    tour,
    bestOf: declaredBestOf,
    tournament,
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
