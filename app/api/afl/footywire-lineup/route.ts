import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { footyinfoNameToOfficial } from '@/lib/afl/footyinfoTeamMapping';

/**
 * Compatibility route retained for existing clients. Its data is sourced from
 * the FootyInfo-generated league player file; it never contacts FootyWire.
 */
export async function GET(request: NextRequest) {
  const team = request.nextUrl.searchParams.get('team')?.trim();
  const season = Number(request.nextUrl.searchParams.get('season') || new Date().getFullYear());
  if (!team) return NextResponse.json({ error: 'team query param is required', players: [] }, { status: 400 });
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`), 'utf8');
    const data = JSON.parse(raw) as { players?: Array<{ name?: string; team?: string }> };
    const target = (footyinfoNameToOfficial(team) || team).replace(/[^a-z]/gi, '').toLowerCase();
    const players = (data.players || [])
      .filter((row) => {
        const rowTeam = footyinfoNameToOfficial(row.team) || row.team || '';
        const key = rowTeam.replace(/[^a-z]/gi, '').toLowerCase();
        return key === target || key.includes(target) || target.includes(key);
      })
      .map((row) => ({ number: null, name: String(row.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ players, source: 'footyinfo.com' });
  } catch {
    return NextResponse.json({ error: 'FootyInfo roster data unavailable', players: [] }, { status: 503 });
  }
}
