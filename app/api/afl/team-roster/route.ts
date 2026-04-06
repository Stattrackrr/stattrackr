import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { ROSTER_TEAM_TO_INJURY_TEAM } from '@/lib/aflTeamMapping';

const AFL_TABLES_BASE = 'https://afltables.com';
const STATS_BASE = `${AFL_TABLES_BASE}/afl/stats`;
const TTL_MS = 1000 * 60 * 30; // 30 min
const SUPPORTED_SEASONS = [2026, 2025, 2024] as const;
const ROSTER_FILES: Record<number, string> = {
  2026: 'afl-roster-2026.json',
  2025: 'afl-roster-2025.json',
  2024: 'afl-roster-2024.json',
};

type RosterRow = { name?: string; team?: string };

const rosterCache = new Map<number, { expiresAt: number; players: RosterRow[] }>();

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
    if (n === fullNorm || n === firstWordNorm || fullNorm.includes(n) || n.includes(fullNorm)) {
      out.add(code);
    }
  }
  return [...out];
}

function htmlToText(v: string): string {
  return String(v || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function toDisplayName(lastFirst: string): string {
  const s = String(lastFirst || '').trim();
  const comma = s.indexOf(',');
  if (comma <= 0) return s;
  const last = s.slice(0, comma).trim();
  const first = s.slice(comma + 1).trim();
  return first && last ? `${first} ${last}` : s;
}

function parseSeasonTotalsPage(html: string, baseUrl: string): RosterRow[] {
  const out: { name: string; team: string }[] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html))) {
    const rowHtml = rowMatch[1];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let c;
    while ((c = cellRegex.exec(rowHtml))) cells.push(c[1]);
    if (cells.length < 2) continue;
    const firstCell = cells[0];
    const linkMatch = firstCell.match(/<a[^>]+href=['"]([^'"]*players\/[A-Za-z0-9]\/[^'"]+\.html)['"][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const linkText = htmlToText(linkMatch[2]);
    if (!linkText) continue;
    const team = htmlToText(cells[1]) || '';
    const displayName = toDisplayName(linkText);
    out.push({ name: displayName, team });
  }
  const seen = new Map<string, RosterRow>();
  for (const e of out) {
    const key = e.name.toLowerCase().replace(/\s+/g, ' ');
    if (!seen.has(key)) seen.set(key, { name: e.name, team: e.team });
  }
  return Array.from(seen.values()).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'en'));
}

function readRosterFile(season: number): RosterRow[] {
  const dataDir = path.join(process.cwd(), 'data');
  const seasonFile = ROSTER_FILES[season];
  const candidates = [
    ...(seasonFile ? [path.join(dataDir, seasonFile)] : []),
    path.join(dataDir, 'afl-roster-2025.json'),
  ];
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const json = JSON.parse(raw) as { players?: RosterRow[] };
      if (Array.isArray(json?.players) && json.players.length > 0) return json.players;
    } catch {
      /* try next */
    }
  }
  return [];
}

async function fetchLiveRoster(season: number): Promise<RosterRow[] | null> {
  const year = new Date().getFullYear();
  let useSeason = season;
  let res = await fetch(`${STATS_BASE}/${season}a.html`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok && season === year) {
    res = await fetch(`${STATS_BASE}/${year - 1}a.html`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (res.ok) useSeason = year - 1;
  }
  if (!res.ok) return null;
  try {
    const html = await res.text();
    const entries = parseSeasonTotalsPage(html, STATS_BASE);
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const team = request.nextUrl.searchParams.get('team')?.trim();
  const seasonRaw = request.nextUrl.searchParams.get('season')?.trim();
  const requestedSeason = seasonRaw && Number.isFinite(Number(seasonRaw)) ? parseInt(seasonRaw, 10) : new Date().getFullYear();
  const season = SUPPORTED_SEASONS.includes(requestedSeason as (typeof SUPPORTED_SEASONS)[number])
    ? requestedSeason
    : 2026;
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const now = Date.now();

  if (!team) {
    return NextResponse.json({ error: 'team query param is required', players: [] }, { status: 400 });
  }

  let roster: RosterRow[];

  if (!refresh) {
    const mem = rosterCache.get(season);
    if (mem && mem.expiresAt > now) roster = mem.players;
    else roster = [];
  } else {
    roster = [];
  }

  if (roster.length === 0) {
    const live = await fetchLiveRoster(season);
    if (live) {
      roster = live;
      rosterCache.set(season, { expiresAt: now + TTL_MS, players: roster });
    }
  }

  if (roster.length === 0) {
    roster = readRosterFile(season);
    if (roster.length > 0 && !rosterCache.has(season)) {
      rosterCache.set(season, { expiresAt: now + TTL_MS, players: roster });
    }
  }

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
