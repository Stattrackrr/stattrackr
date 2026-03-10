import { NextResponse } from 'next/server';
import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const AFL_SPORT_KEY = 'aussierules_afl';

/**
 * GET /api/afl/odds/games-debug
 * Fetches games from The Odds API and returns both raw response and our transformed games.
 * So you can see exactly what the API returns and what we use.
 */
export async function GET() {
  const apiKey = process.env.ODDS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ODDS_API_KEY not set', raw: null, transformed: null },
      { status: 503 }
    );
  }

  const url = `${ODDS_API_BASE}/sports/${AFL_SPORT_KEY}/odds?regions=au&oddsFormat=american&markets=h2h,spreads,totals&apiKey=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    const remaining = res.headers.get('x-requests-remaining');
    const used = res.headers.get('x-requests-used');

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        {
          error: `Odds API ${res.status}: ${text.slice(0, 300)}`,
          raw: null,
          transformed: null,
        },
        { status: 502 }
      );
    }

    const rawEvents = (await res.json()) as Array<{
      id: string;
      sport_key: string;
      commence_time: string;
      home_team: string;
      away_team: string;
      bookmakers?: unknown[];
    }>;

    if (!Array.isArray(rawEvents)) {
      return NextResponse.json(
        { error: 'Invalid response: not an array', raw: rawEvents, transformed: null },
        { status: 502 }
      );
    }

    const raw = rawEvents.map((ev) => ({
      id: ev.id,
      home_team: ev.home_team,
      away_team: ev.away_team,
      commence_time: ev.commence_time,
    }));

    const transformed = rawEvents.map((ev) => ({
      gameId: ev.id,
      homeTeam: toOfficialAflTeamDisplayName(ev.home_team),
      awayTeam: toOfficialAflTeamDisplayName(ev.away_team),
      commenceTime: ev.commence_time,
    }));

    return NextResponse.json({
      ok: true,
      x_requests_remaining: remaining ?? undefined,
      x_requests_used: used ?? undefined,
      count: rawEvents.length,
      raw,
      transformed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, raw: null, transformed: null },
      { status: 500 }
    );
  }
}
