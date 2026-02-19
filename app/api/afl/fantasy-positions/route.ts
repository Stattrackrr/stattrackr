import { NextRequest, NextResponse } from 'next/server';

type FantasyPositionRow = {
  name: string;
  team: string;
  position: string;
};

const TTL_MS = 1000 * 60 * 60; // 1 hour
const cache = new Map<string, { expiresAt: number; data: FantasyPositionRow[]; articleUrl: string }>();
const DEFAULT_FANTASY_SEASON = 2025;

const KNOWN_ARTICLE_BY_SEASON: Record<number, string[]> = {
  2026: ['https://www.afl.com.au/news/1456989/fantasy-2026-every-player-every-position'],
  2025: ['https://www.afl.com.au/news/1259787/fantasy-2025-every-player-every-position-for-the-2025-season'],
};

function htmlToText(v: string): string {
  return v
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizePosition(pos: string): string {
  return pos
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z/]/g, '');
}

function splitPositions(pos: string): string[] {
  const clean = normalizePosition(pos);
  return clean.split('/').map((p) => p.trim()).filter((p) => p === 'DEF' || p === 'MID' || p === 'FWD' || p === 'RUC');
}

function parseFantasyTables(html: string): FantasyPositionRow[] {
  const out: FantasyPositionRow[] = [];
  const seen = new Set<string>();
  const tableRegex = /<table[\s\S]*?>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null = null;

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const table = tableMatch[1];
    const rowRegex = /<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi;
    const rows: string[] = [];
    let rowMatch: RegExpExecArray | null = null;
    while ((rowMatch = rowRegex.exec(table)) !== null) rows.push(rowMatch[1]);
    if (rows.length < 2) continue;

    const headerCells = [...rows[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => htmlToText(m[1]).toUpperCase());
    const hasPlayerHeader = headerCells.some((c) => c.includes('PLAYER'));
    const hasTeamHeader = headerCells.some((c) => c.includes('TEAM'));
    const hasPositionHeader = headerCells.some((c) => c.includes('POSITION'));
    if (!hasPlayerHeader || !hasTeamHeader || !hasPositionHeader) continue;

    for (let i = 1; i < rows.length; i++) {
      const cells = [...rows[i].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => htmlToText(m[1]));
      if (cells.length < 3) continue;
      const name = String(cells[0] ?? '').trim();
      const team = String(cells[1] ?? '').trim();
      const positionRaw = String(cells[2] ?? '').trim();
      const positions = splitPositions(positionRaw);
      if (!name || !team || positions.length === 0) continue;

      const position = positions[0];
      const key = `${normalizeName(name)}|${team.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, team, position });
    }
  }

  return out;
}

async function fetchAndParse(url: string): Promise<FantasyPositionRow[]> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-AU,en;q=0.9',
    },
    next: { revalidate: 60 * 60 },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const html = await res.text();
  return parseFantasyTables(html);
}

export async function GET(request: NextRequest) {
  const seasonParam = request.nextUrl.searchParams.get('season')?.trim();
  const teamParam = request.nextUrl.searchParams.get('team')?.trim();
  const playerParam = request.nextUrl.searchParams.get('player')?.trim();
  const articleUrlParam = request.nextUrl.searchParams.get('url')?.trim();

  const season = seasonParam && Number.isFinite(Number(seasonParam))
    ? parseInt(seasonParam, 10)
    : DEFAULT_FANTASY_SEASON;

  const candidates = articleUrlParam
    ? [articleUrlParam]
    : (KNOWN_ARTICLE_BY_SEASON[season] ?? []);

  if (candidates.length === 0) {
    return NextResponse.json(
      {
        error: `No AFL Fantasy positions article configured for season ${season}`,
        hint: 'Pass ?url=https://www.afl.com.au/news/.../fantasy-YYYY-every-player-every-position',
      },
      { status: 404 }
    );
  }

  const cacheKey = `${season}|${candidates.join('|')}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    let players = cached.data;
    if (teamParam) players = players.filter((p) => p.team.toLowerCase().includes(teamParam.toLowerCase()));
    if (playerParam) players = players.filter((p) => p.name.toLowerCase().includes(playerParam.toLowerCase()));
    return NextResponse.json({ season, source: 'afl.com.au/fantasy', article_url: cached.articleUrl, players, totalResults: players.length, cached: true });
  }

  let parsed: FantasyPositionRow[] = [];
  let usedUrl = '';
  for (const url of candidates) {
    const rows = await fetchAndParse(url);
    if (rows.length > parsed.length) {
      parsed = rows;
      usedUrl = url;
    }
    if (rows.length >= 100) break;
  }

  if (parsed.length === 0) {
    return NextResponse.json(
      {
        error: 'Failed to parse AFL Fantasy positions table',
        tried: candidates,
      },
      { status: 502 }
    );
  }

  cache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, data: parsed, articleUrl: usedUrl || candidates[0] });

  let players = parsed;
  if (teamParam) players = players.filter((p) => p.team.toLowerCase().includes(teamParam.toLowerCase()));
  if (playerParam) players = players.filter((p) => p.name.toLowerCase().includes(playerParam.toLowerCase()));

  return NextResponse.json({
    season,
    source: 'afl.com.au/fantasy',
    article_url: usedUrl || candidates[0],
    players,
    totalResults: players.length,
    cached: false,
  });
}

