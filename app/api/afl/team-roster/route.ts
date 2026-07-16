import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { footyinfoNameToOfficial } from '@/lib/afl/footyinfoTeamMapping';

type Player = { name?: string; team?: string; games?: number };
const cache = new Map<number, { expiresAt: number; players: Player[] }>();
const TTL_MS = 1000 * 60 * 30;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readSeasonPlayers(season: number): Player[] {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`), 'utf8');
    const data = JSON.parse(raw) as { players?: Player[] };
    return Array.isArray(data.players) ? data.players.filter((player) => player.name && player.team) : [];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const teamParam = request.nextUrl.searchParams.get('team')?.trim();
  const season = Number(request.nextUrl.searchParams.get('season') || new Date().getFullYear());
  if (!teamParam) return NextResponse.json({ error: 'team query param is required', players: [] }, { status: 400 });

  let players = cache.get(season)?.players || [];
  if (!players.length) {
    players = readSeasonPlayers(season);
    if (players.length) cache.set(season, { expiresAt: Date.now() + TTL_MS, players });
  }
  const requested = footyinfoNameToOfficial(teamParam) || teamParam;
  const wanted = normalize(requested);
  const result = players
    .filter((player) => {
      const mapped = footyinfoNameToOfficial(player.team) || player.team || '';
      const actual = normalize(mapped);
      return actual === wanted || actual.includes(wanted) || wanted.includes(actual);
    })
    .map((player) => ({ number: null, name: String(player.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    source: 'footyinfo.com',
    team: requested,
    season,
    players: result,
    totalResults: result.length,
  });
}
