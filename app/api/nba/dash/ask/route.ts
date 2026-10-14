import { NextRequest, NextResponse } from 'next/server';
import { answerNbaAsk } from '@/lib/nba/dash/askAnswer';
import { nbaPunterQuestions } from '@/lib/nba/dash/askSuggestions';
import { proRequiredResponse, requestIsPro } from '@/lib/server/proRouteAuth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/nba/dash/ask?player=&opponent= — suggestion chips.
 * POST { question, playerId, player, opponent, stat, selectedLine, history } — AI write-up from stored stats and prices.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const player = String(sp.get('player') || '').trim();
  const opponent = String(sp.get('opponent') || '').trim();
  return NextResponse.json({ success: true, suggestions: player ? nbaPunterQuestions(player, opponent) : [] });
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  if (!(await requestIsPro(request))) return proRequiredResponse('The NBA model');
  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
    playerId?: unknown;
    player?: unknown;
    playerName?: unknown;
    opponent?: unknown;
    stat?: unknown;
    selectedLine?: unknown;
    history?: unknown;
  } | null;
  const playerId = String(body?.playerId || '').trim();
  const playerName = String(body?.player || body?.playerName || '').trim();
  const opponent = String(body?.opponent || '').trim();
  const question = String(body?.question || '').trim();
  const stat = String(body?.stat || 'points').trim();
  const selectedRaw = Number(body?.selectedLine);
  const selectedLine = body?.selectedLine != null && Number.isFinite(selectedRaw) ? selectedRaw : null;
  if (!playerId || !playerName) {
    return NextResponse.json({ success: false, error: 'Select a player first.' }, { status: 400 });
  }
  if (!opponent || opponent === 'All') {
    return NextResponse.json({ success: false, error: 'Select an opponent to run the model.' }, { status: 400 });
  }
  if (!question || question.length > 500) {
    return NextResponse.json({ success: false, error: 'Ask a short NBA question.' }, { status: 400 });
  }
  const history = Array.isArray(body?.history)
    ? body.history
        .map((row) => {
          const rec = row as { role?: unknown; content?: unknown };
          const role = rec?.role === 'assistant' ? 'assistant' : rec?.role === 'user' ? 'user' : null;
          const content = String(rec?.content || '').trim();
          return role && content ? { role, content } : null;
        })
        .filter((row): row is { role: 'user' | 'assistant'; content: string } => Boolean(row))
        .slice(-6)
    : [];

  try {
    const reply = await answerNbaAsk({ question, playerId, playerName, opponent, stat, selectedLine, history, startedAt });
    return NextResponse.json({
      success: true,
      answer: reply.answer,
      reasoning: reply.answer,
      breakdown: reply.breakdown,
      source: reply.source,
      suggestions: reply.suggestions,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ask failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
