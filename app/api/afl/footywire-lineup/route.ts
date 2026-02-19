import { NextRequest, NextResponse } from 'next/server';
import { AFL_TEAM_TO_FOOTYWIRE } from '@/lib/aflTeamMapping';

const FOOTYWIRE_TEAM_SELECTIONS_URL = 'https://www.footywire.com/afl/footy/afl_team_selections';
const TTL_MS = 1000 * 60 * 30; // 30 min
const cache = new Map<string, { expiresAt: number; players: Array<{ number: number | null; name: string }> }>();

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
  Referer: 'https://www.footywire.com/',
};

function teamToFootywireNames(team: string): string[] {
  const t = team.replace(/^vs\.?\s*/i, '').trim();
  const out = new Set<string>();
  const lower = t.toLowerCase();
  for (const [key, nickname] of Object.entries(AFL_TEAM_TO_FOOTYWIRE)) {
    if (key.toLowerCase() === lower || nickname.toLowerCase() === lower) {
      out.add(nickname);
      out.add(key.split(/\s+/)[0] || key);
    }
    if (lower.includes(key.toLowerCase()) || lower.includes(nickname.toLowerCase())) {
      out.add(nickname);
    }
  }
  if (t) out.add(t.split(/\s+/)[0] || t);
  return [...out];
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse FootyWire team selections page for a team's lineup (number + name rows). */
function parseLineup(html: string, teamNameAliases: string[]): Array<{ number: number | null; name: string }> | null {
  const players: Array<{ number: number | null; name: string }> = [];
  const lowerHtml = html.toLowerCase();

  // Try to find a section that mentions the team (e.g. "Geelong" or "Cats")
  const teamMention = teamNameAliases.some((a) => lowerHtml.includes(a.toLowerCase()));
  if (!teamMention && teamNameAliases.length > 0) return null;

  // Find all table rows - FootyWire often has tables with # and Player name
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null = null;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let c: RegExpExecArray | null = null;
    while ((c = cellRegex.exec(row)) !== null) cells.push(htmlToText(c[1]));
    if (cells.length < 2) continue;
    const first = cells[0].trim();
    const second = (cells[1] || '').trim();
    if (!second || second.length > 60) continue;
    const num = /^\d+$/.test(first) ? parseInt(first, 10) : null;
    if (num !== null && num >= 1 && num <= 99) {
      if (second !== 'Player' && second !== 'Name' && !/^(Totals?|Averages?|Emergency|Interchange|Substitute)$/i.test(second)) {
        players.push({ number: num, name: second });
      }
    }
  }

  // Also try div/list structures: e.g. "12. Player Name" or "12 - Player Name"
  if (players.length < 10) {
    const numberNameRegex = /(?:^|>)\s*(\d{1,2})\s*[.\-\s]\s*([A-Za-z][A-Za-z\s\-']{2,40})/g;
    let m: RegExpExecArray | null = null;
    const seen = new Set<string>();
    while ((m = numberNameRegex.exec(html)) !== null) {
      const num = parseInt(m[1], 10);
      const name = m[2].trim();
      if (num >= 1 && num <= 99 && name.length >= 2 && !seen.has(name)) {
        seen.add(name);
        players.push({ number: num, name });
      }
    }
  }

  return players.length >= 10 ? players : null;
}

export async function GET(request: NextRequest) {
  const teamParam = request.nextUrl.searchParams.get('team');
  if (!teamParam?.trim()) {
    return NextResponse.json({ error: 'team query param is required', players: [] }, { status: 400 });
  }
  const team = teamParam.trim();
  const cacheKey = `footywire|${team}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ players: cached.players, source: 'footywire.com' });
  }

  try {
    const res = await fetch(FOOTYWIRE_TEAM_SELECTIONS_URL, {
      headers: FETCH_HEADERS,
      next: { revalidate: 60 * 30 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `FootyWire returned ${res.status}`, players: [] },
        { status: 502 }
      );
    }
    const html = await res.text();
    const aliases = teamToFootywireNames(team);
    const players = parseLineup(html, aliases);
    if (players && players.length >= 10) {
      cache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, players });
      return NextResponse.json({ players, source: 'footywire.com' });
    }
    return NextResponse.json(
      { error: 'Could not parse lineup from FootyWire', players: [], debug: { htmlLength: html.length, aliases } },
      { status: 422 }
    );
  } catch (err) {
    console.error('[AFL footywire-lineup]', err);
    return NextResponse.json(
      { error: 'Failed to fetch FootyWire lineup', players: [], details: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
