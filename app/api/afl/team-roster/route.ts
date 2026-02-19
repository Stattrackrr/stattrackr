import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { ROSTER_TEAM_TO_INJURY_TEAM } from '@/lib/aflTeamMapping';

type RosterRow = { name?: string; team?: string };

function normalize(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveTeamCodes(teamInput: string): string[] {
  const t = teamInput.trim();
  const out = new Set<string>();
  const upper = t.toUpperCase();
  if (ROSTER_TEAM_TO_INJURY_TEAM[upper]) out.add(upper);

  const n = normalize(t);
  for (const [code, full] of Object.entries(ROSTER_TEAM_TO_INJURY_TEAM)) {
    const fullNorm = normalize(full);
    const firstWordNorm = normalize(full.split(/\s+/)[0] || '');
    if (n === fullNorm || n === firstWordNorm || fullNorm.includes(n) || n.includes(firstWordNorm)) {
      out.add(code);
    }
  }
  return [...out];
}

function readRosterFile(season: number): RosterRow[] {
  const dataDir = path.join(process.cwd(), 'data');
  const candidates = [
    path.join(dataDir, `afl-roster-${season}.json`),
    path.join(dataDir, 'afl-roster-2025.json'),
  ];
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const json = JSON.parse(raw) as { players?: RosterRow[] };
      if (Array.isArray(json?.players) && json.players.length > 0) return json.players;
    } catch {
      // try next file
    }
  }
  return [];
}

export async function GET(request: NextRequest) {
  const team = request.nextUrl.searchParams.get('team')?.trim();
  const seasonRaw = request.nextUrl.searchParams.get('season')?.trim();
  const season = seasonRaw && Number.isFinite(Number(seasonRaw)) ? parseInt(seasonRaw, 10) : 2025;

  if (!team) {
    return NextResponse.json({ error: 'team query param is required', players: [] }, { status: 400 });
  }

  const roster = readRosterFile(season);
  if (roster.length === 0) {
    return NextResponse.json({ error: 'Roster data unavailable', players: [] }, { status: 404 });
  }

  const teamCodes = resolveTeamCodes(team);
  if (teamCodes.length === 0) {
    return NextResponse.json({ error: 'Could not map team to roster code', players: [] }, { status: 404 });
  }

  const players = roster
    .filter((p) => p?.name && p?.team && teamCodes.includes(String(p.team).toUpperCase()))
    .map((p) => ({ number: null, name: String(p.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    source: 'afltables.com/roster',
    team,
    season,
    players,
    totalResults: players.length,
  });
}

