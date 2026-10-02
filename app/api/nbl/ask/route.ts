import { NextRequest, NextResponse } from 'next/server';
import { answerNblAsk, loadNblAskPanel, nblAskSuggestions } from '@/lib/nbl/askAnswer';
import { NBL_AI_UNDER_MAINTENANCE } from '@/lib/nbl/constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function maintenanceResponse() {
  return NextResponse.json(
    {
      success: false,
      maintenance: true,
      error: 'Model is under maintenance.',
      suggestions: [],
    },
    { status: 503 }
  );
}

/**
 * GET /api/nbl/ask?playerId=&player=&opponent=&stat=
 * Suggestion chips for the OpenAI NBL ask panel.
 *
 * POST { question, playerId, player, opponent, stat, history }
 * OpenAI write-up of the NBL props engine pack (same gpt-5.6-luna path as tennis).
 */
export async function GET(request: NextRequest) {
  if (NBL_AI_UNDER_MAINTENANCE) return maintenanceResponse();
  const sp = request.nextUrl.searchParams;
  const playerId = String(sp.get('playerId') || '').trim();
  const playerName = String(sp.get('player') || sp.get('playerName') || '').trim();
  const opponent = String(sp.get('opponent') || sp.get('team') || '').trim();
  const stat = String(sp.get('stat') || 'points').trim();
  if (!playerId && !playerName) {
    return NextResponse.json({ success: true, suggestions: [] });
  }
  const panel = loadNblAskPanel({
    playerId: playerId || null,
    playerName: playerName || null,
    opponent: opponent && opponent !== 'All' ? opponent : null,
    stat,
  });
  return NextResponse.json({
    success: true,
    suggestions: nblAskSuggestions(panel, playerName),
    reason: panel.reason,
    markets: panel.markets,
  });
}

export async function POST(request: NextRequest) {
  if (NBL_AI_UNDER_MAINTENANCE) return maintenanceResponse();
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
  const selectedLine = Number.isFinite(selectedRaw) ? selectedRaw : null;
  if (!playerId && !playerName) {
    return NextResponse.json({ success: false, error: 'Select a player first.' }, { status: 400 });
  }
  if (!opponent || opponent === 'All') {
    return NextResponse.json(
      { success: false, error: 'Select an opponent to run the model.' },
      { status: 400 }
    );
  }
  if (!question || question.length > 500) {
    return NextResponse.json({ success: false, error: 'Ask a short NBL question.' }, { status: 400 });
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
    const reply = await answerNblAsk({
      question,
      playerId: playerId || null,
      playerName: playerName || null,
      opponent,
      stat,
      selectedLine,
      history,
    });
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
