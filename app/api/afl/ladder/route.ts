import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

const CURRENT_SEASON = process.env.AFL_CURRENT_SEASON || String(new Date().getFullYear());
const TTL_MS = 1000 * 60 * 30; // 30 min
const FOOTYWIRE_LADDER_URL = 'https://www.footywire.com/afl/json/json-sort-stats-ladder.json';
const SUPPORTED_SEASONS = [2026, 2025, 2024] as const;

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Content-Type': 'application/x-www-form-urlencoded',
  Accept: 'application/json, text/javascript',
};

export type LadderRow = {
  pos: number;
  team: string;
  played: number;
  win: number;
  loss: number;
  draw: number;
  points_for: number | null;
  points_against: number | null;
  percentage: number | null;
  premiership_points: number | null;
};

const ladderCache = new Map<number, { expiresAt: number; data: { season: number; teams: LadderRow[] } }>();

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

function toNum(s: string | null | undefined): number | null {
  if (s == null) return null;
  const t = htmlToText(s);
  const n = parseFloat(t.replace(/[,%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseLadder(html: string): LadderRow[] {
  const teams: LadderRow[] = [];
  let tableStart = html.indexOf('<td class="lbnorm">Team</td>');
  if (tableStart !== -1) tableStart = Math.max(0, tableStart - 800);
  else {
    tableStart = html.indexOf('ft_ladder');
    if (tableStart !== -1) {
      const tableOpen = html.lastIndexOf('<table', tableStart);
      if (tableOpen !== -1) tableStart = tableOpen;
    } else tableStart = html.indexOf('>Team<');
  }
  if (tableStart === -1) return [];

  const tableEnd = html.indexOf('</table>', tableStart);
  const tableSection = tableEnd > tableStart
    ? html.substring(tableStart, tableEnd + 100)
    : html.substring(tableStart, tableStart + 12000);

  const rowRegex = /<tr[^>]*(?:class="(?:dark|light)color")[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  const rows: string[] = [];
  while ((rowMatch = rowRegex.exec(tableSection))) {
    const row = rowMatch[1];
    const cellCount = (row.match(/<t[dh][^>]*>/gi) || []).length;
    if (row.includes('href="th-') || (cellCount >= 8 && row.includes('<td'))) rows.push(row);
  }
  if (rows.length === 0) {
    const altRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let altMatch;
    while ((altMatch = altRegex.exec(tableSection))) {
      const row = altMatch[1];
      const cellCount = (row.match(/<t[dh][^>]*>/gi) || []).length;
      if (cellCount >= 8 && row.includes('<td') && !row.includes('<th')) rows.push(row);
    }
  }

  for (const rowHtml of rows) {
    const cells: string[] = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = cellRegex.exec(rowHtml))) cells.push(c[1]);
    if (cells.length < 5) continue;

    const pos = parseInt(htmlToText(cells[0]), 10);
    const teamCell = cells[1];
    const teamLink = teamCell.match(/<a[^>]+href="[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    let teamName = teamLink ? htmlToText(teamLink[1]) : htmlToText(teamCell);
    teamName = (teamName || '').trim();
    if (!teamName || teamName.length < 2) continue;
    if (/^(team|pos|#|rank|played|win|loss|draw|for|against|%|pts?)$/i.test(teamName)) continue;

    const nums = cells.slice(2).map((cell) => toNum(cell));
    let played: number | null = null;
    let win: number | null = null;
    let loss: number | null = null;
    let draw: number | null = null;
    let premiership_points: number | null = null;
    let points_for: number | null = null;
    let points_against: number | null = null;
    let percentage: number | null = null;

    for (let i = 0; i < nums.length; i++) {
      const v = nums[i];
      if (v == null) continue;
      if (v >= 0 && v <= 25 && Number.isInteger(v) && played == null) played = v;
      else if (v >= 0 && v <= 25 && Number.isInteger(v) && win == null && played != null) win = v;
      else if (v >= 0 && v <= 25 && Number.isInteger(v) && loss == null) loss = v;
      else if (v >= 0 && v <= 5 && Number.isInteger(v) && draw == null) draw = v;
      else if (v >= 50 && v <= 150) percentage = v;
      else if (v >= 0 && v <= 88 && Number.isInteger(v)) premiership_points = v;
      else if (v > 100 && v < 4000 && points_for == null) points_for = v;
      else if (v > 100 && v < 4000 && points_against == null) points_against = v;
    }

    const computedPts = (win ?? 0) * 4 + (draw ?? 0) * 2;
    teams.push({
      pos: Number.isFinite(pos) ? pos : teams.length + 1,
      team: teamName,
      played: played ?? 0,
      win: win ?? 0,
      loss: loss ?? 0,
      draw: draw ?? 0,
      points_for: points_for ?? null,
      points_against: points_against ?? null,
      percentage: percentage ?? null,
      premiership_points: computedPts > 0 ? computedPts : (premiership_points != null && premiership_points <= 88 ? premiership_points : null),
    });
  }
  return teams;
}

function readCachedLadder(season: number): { season: number; teams: LadderRow[] } | null {
  const readOne = (raw: string | null) => {
    if (!raw) return null;
    const data = JSON.parse(raw) as { season?: number; teams?: LadderRow[] };
    if (!data?.teams?.length) return null;
    return { season: data.season ?? season, teams: data.teams };
  };
  try {
    const currentRaw =
      season === 2026
        ? fs.readFileSync(path.join(process.cwd(), 'data', 'afl-ladder-2026.json'), 'utf8')
        : season === 2025
          ? fs.readFileSync(path.join(process.cwd(), 'data', 'afl-ladder-2025.json'), 'utf8')
          : season === 2024
            ? fs.readFileSync(path.join(process.cwd(), 'data', 'afl-ladder-2024.json'), 'utf8')
            : null;
    const parsed = readOne(currentRaw);
    if (parsed) return parsed;
  } catch {
    /* try previous season file */
  }
  try {
    const prevRaw =
      season - 1 === 2026
        ? fs.readFileSync(path.join(process.cwd(), 'data', 'afl-ladder-2026.json'), 'utf8')
        : season - 1 === 2025
          ? fs.readFileSync(path.join(process.cwd(), 'data', 'afl-ladder-2025.json'), 'utf8')
          : season - 1 === 2024
            ? fs.readFileSync(path.join(process.cwd(), 'data', 'afl-ladder-2024.json'), 'utf8')
            : null;
    const parsedPrev = readOne(prevRaw);
    if (parsedPrev) return parsedPrev;
  } catch {
    /* no previous file */
  }
  return null;
}

async function fetchLiveLadder(season: number): Promise<{ season: number; teams: LadderRow[] } | null> {
  try {
    const body = new URLSearchParams({
      sby: '8',
      template: 'ladder',
      advv: 'N',
      skipImg: 'Y',
      year: String(season),
    });
    const res = await fetch(FOOTYWIRE_LADDER_URL, {
      method: 'POST',
      headers: {
        ...FETCH_HEADERS,
        Referer: `https://www.footywire.com/afl/footy/ft_ladder?year=${season}`,
      },
      body: body.toString(),
    });
    const text = await res.text();
    let html = text;
    try {
      const json = JSON.parse(text) as { sortBy?: string };
      if (json.sortBy) html = json.sortBy;
    } catch {
      /* use raw text */
    }
    const parsed = parseLadder(html);
    if (parsed.length === 0) return null;
    const sorted = [...parsed].sort((a, b) => {
      const ptsA = a.premiership_points ?? 0;
      const ptsB = b.premiership_points ?? 0;
      if (ptsB !== ptsA) return ptsB - ptsA;
      return (b.percentage ?? 0) - (a.percentage ?? 0);
    });
    sorted.forEach((t, i) => { t.pos = i + 1; });
    return { season, teams: sorted };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const seasonParam = request.nextUrl.searchParams.get('season');
  const requestedSeason = seasonParam ? parseInt(seasonParam, 10) : parseInt(CURRENT_SEASON, 10) || new Date().getFullYear();
  const season = SUPPORTED_SEASONS.includes(requestedSeason as (typeof SUPPORTED_SEASONS)[number])
    ? requestedSeason
    : 2026;
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const now = Date.now();

  if (!refresh) {
    const mem = ladderCache.get(season);
    if (mem && mem.expiresAt > now) return NextResponse.json(mem.data);
  }

  const live = await fetchLiveLadder(season);
  if (live) {
    ladderCache.set(season, { expiresAt: now + TTL_MS, data: live });
    return NextResponse.json(live);
  }

  if (season !== new Date().getFullYear()) {
    const liveCurrent = await fetchLiveLadder(new Date().getFullYear());
    if (liveCurrent) {
      ladderCache.set(season, { expiresAt: now + TTL_MS, data: liveCurrent });
      return NextResponse.json(liveCurrent);
    }
  }

  const cached = readCachedLadder(season);
  if (cached) {
    if (!ladderCache.has(season)) ladderCache.set(season, { expiresAt: now + TTL_MS, data: cached });
    return NextResponse.json(cached);
  }

  const prev = readCachedLadder(season - 1);
  if (prev) {
    return NextResponse.json({ ...prev, _note: `No ladder for ${season}; returning ${season - 1}` });
  }

  return NextResponse.json(
    { error: 'Ladder not found. Run: npm run fetch:footywire-ladder' },
    { status: 404 }
  );
}
