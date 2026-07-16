import { NextRequest, NextResponse } from 'next/server';
import { fetchFootyinfoMatchBoxScore } from '@/lib/afl/footyinfoMatch';

export type MatchLineupPlayer = {
  number: number | null;
  name: string;
  role?: 'starter' | 'interchange';
};

export type MatchLineupResponse = {
  match_url: string;
  home_team: string;
  away_team: string;
  home_players: MatchLineupPlayer[];
  away_players: MatchLineupPlayer[];
  error?: string;
};

const cache = new Map<string, { expiresAt: number; data: MatchLineupResponse }>();
const CACHE_TTL_MS = 1000 * 60 * 30;

function matchIdFromInput(value: string): number | null {
  const id = value.match(/(?:^|[-/])(\d+)(?:\/)?$/)?.[1] || value.match(/^\d+$/)?.[0];
  const parsed = Number(id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get('match_url') ?? request.nextUrl.searchParams.get('url') ?? request.nextUrl.searchParams.get('match_id');
  if (!input) {
    return NextResponse.json({ error: 'Provide a FootyInfo match_url or match_id', home_players: [], away_players: [] }, { status: 400 });
  }
  const matchId = matchIdFromInput(input);
  if (!matchId) {
    return NextResponse.json({ error: 'Could not determine FootyInfo match ID', home_players: [], away_players: [] }, { status: 400 });
  }
  const cacheKey = String(matchId);
  const existing = cache.get(cacheKey);
  if (existing && existing.expiresAt > Date.now()) return NextResponse.json(existing.data);

  const score = await fetchFootyinfoMatchBoxScore(matchId);
  if (!score) return NextResponse.json({ error: 'FootyInfo match lineup unavailable', home_players: [], away_players: [] }, { status: 502 });
  const matchUrl = score.meta?.slug
    ? `https://www.footyinfo.com/match/${score.meta.slug}`
    : `https://www.footyinfo.com/match/${matchId}`;
  const toPlayers = (players: typeof score.home): MatchLineupPlayer[] =>
    players.map((player, index) => ({
      number: player.guernsey,
      name: player.playerName,
      role: index < 18 ? 'starter' : 'interchange',
    }));
  const data: MatchLineupResponse = {
    match_url: matchUrl,
    home_team: score.meta?.h_name || score.home[0]?.teamOfficial || '',
    away_team: score.meta?.a_name || score.away[0]?.teamOfficial || '',
    home_players: toPlayers(score.home),
    away_players: toPlayers(score.away),
  };
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  return NextResponse.json(data);
}
