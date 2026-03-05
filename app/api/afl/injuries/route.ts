import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

const FOOTYWIRE_INJURY_URL = 'https://www.footywire.com/afl/footy/injury_list';
const TTL_MS = 1000 * 60 * 30; // 30 min

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
};

type InjuryRow = { team: string; player: string; injury: string; returning: string };

let cached: { expiresAt: number; data: { generatedAt: string; injuries: InjuryRow[] } } | null = null;

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

const TEAM_FROM_SLUG: Record<string, string> = {
  'adelaide-crows': 'Adelaide Crows', 'brisbane-lions': 'Brisbane Lions', 'carlton-blues': 'Carlton Blues',
  'collingwood-magpies': 'Collingwood Magpies', 'essendon-bombers': 'Essendon Bombers',
  'fremantle-dockers': 'Fremantle Dockers', 'geelong-cats': 'Geelong Cats', 'gold-coast-suns': 'Gold Coast Suns',
  'greater-western-sydney-giants': 'GWS Giants', 'hawthorn-hawks': 'Hawthorn Hawks',
  'melbourne-demons': 'Melbourne Demons', 'north-melbourne-kangaroos': 'North Melbourne Kangaroos',
  'port-adelaide-power': 'Port Adelaide Power', 'richmond-tigers': 'Richmond Tigers',
  'st-kilda-saints': 'St Kilda Saints', 'sydney-swans': 'Sydney Swans',
  'west-coast-eagles': 'West Coast Eagles', 'western-bulldogs': 'Western Bulldogs',
};

function slugToTeam(href: string): string {
  const m = href.match(/pp-([a-z0-9-]+)--/i);
  if (!m) return '';
  const slug = m[1].toLowerCase();
  return TEAM_FROM_SLUG[slug] ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseInjuryList(html: string): InjuryRow[] {
  const injuries: InjuryRow[] = [];
  const rowRegex = /<tr[^>]*class="(?:dark|light)color"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html))) {
    const rowHtml = rowMatch[1];
    if (!rowHtml.includes('pp-') || !rowHtml.includes('/afl/footy/')) continue;
    const cells: string[] = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = cellRegex.exec(rowHtml))) cells.push(c[1]);
    if (cells.length < 3) continue;

    const playerCell = cells[0];
    const playerLink = playerCell.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const playerName = playerLink ? htmlToText(playerLink[2]).trim() : htmlToText(playerCell).trim();
    const href = playerLink ? playerLink[1] : '';
    const team = slugToTeam(href) || '';
    const injury = htmlToText(cells[1]).trim();
    const returning = htmlToText(cells[2]).trim();

    if (!playerName || playerName.length < 2) continue;
    if (/^(player|injury|returning)$/i.test(playerName)) continue;

    injuries.push({ team, player: playerName, injury, returning });
  }
  return injuries;
}

function readCachedInjuries(): { generatedAt: string; injuries: InjuryRow[] } | null {
  try {
    const filePath = path.join(process.cwd(), 'data', 'afl-injuries.json');
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw) as { generatedAt?: string; injuries?: InjuryRow[] };
    if (!data?.injuries?.length) return null;
    return { generatedAt: data.generatedAt ?? new Date().toISOString(), injuries: data.injuries };
  } catch {
    return null;
  }
}

async function fetchLiveInjuries(): Promise<{ generatedAt: string; injuries: InjuryRow[] } | null> {
  try {
    const res = await fetch(FOOTYWIRE_INJURY_URL, { headers: FETCH_HEADERS });
    if (!res.ok) return null;
    const html = await res.text();
    const injuries = parseInjuryList(html);
    if (injuries.length === 0) return null;
    return { generatedAt: new Date().toISOString(), injuries };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const now = Date.now();

  if (!refresh && cached && cached.expiresAt > now) {
    return NextResponse.json(cached.data);
  }

  const live = await fetchLiveInjuries();
  if (live) {
    cached = { expiresAt: now + TTL_MS, data: live };
    return NextResponse.json(live);
  }

  const file = readCachedInjuries();
  if (file) {
    if (!cached) cached = { expiresAt: now + TTL_MS, data: file };
    return NextResponse.json(file);
  }

  return NextResponse.json(
    { error: 'Injury list not found. Run: npm run fetch:footywire-injuries' },
    { status: 404 }
  );
}
