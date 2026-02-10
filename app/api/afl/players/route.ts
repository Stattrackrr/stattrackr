import { NextRequest, NextResponse } from 'next/server';

const AFL_TABLES_BASE = 'https://afltables.com';
const PLAYERS_INDEX_URL = `${AFL_TABLES_BASE}/afl/stats/players.html`;
const AFL_API_BASE = 'https://v1.afl.api-sports.io';
const TTL_MS = 1000 * 60 * 60; // 1 hour

type PlayerIndexEntry = {
  name: string;
  href: string;
};

let playersIndexCache: { expiresAt: number; data: PlayerIndexEntry[] } | null = null;

function normalizeName(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameMatchesQuery(name: string, normalizedQuery: string): boolean {
  const normalizedName = normalizeName(name);
  if (!normalizedQuery) return true;
  if (normalizedName.includes(normalizedQuery)) return true;
  const parts = normalizedQuery.split(' ').filter(Boolean);
  if (parts.length === 0) return true;
  return parts.every((p) => normalizedName.includes(p));
}

function getApiResponseArray(data: Record<string, unknown>): unknown[] {
  const raw = data?.response ?? data?.data ?? data?.results ?? data?.players;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return [raw];
  return [];
}

function extractApiPlayerName(raw: unknown): string {
  const obj = raw as Record<string, unknown>;
  const player = (obj?.player ?? obj) as Record<string, unknown>;
  const directName = player?.name;
  if (typeof directName === 'string' && directName.trim()) return directName.trim();
  const first = player?.firstName ?? player?.firstname;
  const last = player?.lastName ?? player?.lastname;
  const combined = [first, last].filter((x) => typeof x === 'string' && String(x).trim()).join(' ').trim();
  return combined || '';
}

async function fetchApiSportsFallbackPlayers(query: string, limit: number): Promise<PlayerIndexEntry[]> {
  const apiKey = process.env.AFL_API_KEY;
  if (!apiKey || !query.trim()) return [];

  const paramsToTry: Array<Record<string, string>> = [
    { search: query, season: '2025' },
    { name: query, season: '2025' },
    { search: query },
    { name: query },
  ];

  const out: PlayerIndexEntry[] = [];
  const seen = new Set<string>();
  const normalizedQuery = normalizeName(query);

  for (const params of paramsToTry) {
    try {
      const qs = new URLSearchParams(params).toString();
      const url = `${AFL_API_BASE}/players${qs ? `?${qs}` : ''}`;
      const res = await fetch(url, {
        headers: { 'x-apisports-key': apiKey },
        next: { revalidate: 60 },
      });
      if (!res.ok) continue;

      const data = (await res.json()) as Record<string, unknown>;
      const rows = getApiResponseArray(data);
      for (const row of rows) {
        const name = extractApiPlayerName(row);
        if (!name) continue;
        const normalized = normalizeName(name);
        if (!normalized || seen.has(normalized)) continue;
        if (!nameMatchesQuery(name, normalizedQuery)) continue;
        seen.add(normalized);
        out.push({ name, href: '' });
        if (out.length >= limit) return out;
      }
    } catch {
      // Ignore fallback errors; primary AFLTables source still works.
    }
  }

  return out;
}

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

async function fetchPlayersIndex(): Promise<PlayerIndexEntry[]> {
  if (playersIndexCache && playersIndexCache.expiresAt > Date.now()) {
    return playersIndexCache.data;
  }

  const res = await fetch(PLAYERS_INDEX_URL, { next: { revalidate: 60 * 60 } });
  if (!res.ok) throw new Error(`Failed to fetch AFL players index (${res.status})`);
  const html = await res.text();

  const out: PlayerIndexEntry[] = [];
  const linkRegex = /<a[^>]+href=['"]([^'"]*players\/[A-Z]\/[^'"]+\.html)['"][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null = linkRegex.exec(html);
  while (m) {
    const rawHref = m[1];
    let href = rawHref;
    if (!rawHref.startsWith('http')) {
      if (rawHref.startsWith('/')) {
        href = `${AFL_TABLES_BASE}${rawHref}`;
      } else if (rawHref.startsWith('../')) {
        href = `${AFL_TABLES_BASE}/afl/${rawHref.slice(3)}`;
      } else {
        href = `${AFL_TABLES_BASE}/afl/stats/${rawHref}`;
      }
    }
    const name = htmlToText(m[2]);
    if (name && href) out.push({ name, href });
    m = linkRegex.exec(html);
  }

  // AFLTables repeats the same player links across multiple stat sections.
  // Keep only one entry per player page URL.
  const dedupByHref = new Map<string, PlayerIndexEntry>();
  for (const entry of out) {
    if (!dedupByHref.has(entry.href)) dedupByHref.set(entry.href, entry);
  }
  const deduped = Array.from(dedupByHref.values());

  playersIndexCache = { expiresAt: Date.now() + TTL_MS, data: deduped };
  return deduped;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('query')?.trim() ?? '';
  const limitRaw = parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10);
  const limit = Math.max(1, Math.min(100, Number.isNaN(limitRaw) ? 20 : limitRaw));

  try {
    const allPlayers = await fetchPlayersIndex();
    const q = normalizeName(query);
    let filtered = allPlayers;
    if (q) {
      filtered = allPlayers.filter((p) => nameMatchesQuery(p.name, q));
    }
    // Also dedupe by normalized display name for search dropdown UX.
    const seenNames = new Set<string>();
    const players = filtered
      .filter((p) => {
        const n = normalizeName(p.name);
        if (seenNames.has(n)) return false;
        seenNames.add(n);
        return true;
      })
      .slice(0, limit)
      .map((p) => ({ name: p.name }));

    if (q && players.length < limit) {
      const fallback = await fetchApiSportsFallbackPlayers(query, limit - players.length);
      for (const p of fallback) {
        const n = normalizeName(p.name);
        if (seenNames.has(n)) continue;
        seenNames.add(n);
        players.push({ name: p.name });
        if (players.length >= limit) break;
      }
    }

    return NextResponse.json({
      source: 'afltables.com',
      query,
      count: players.length,
      players,
    });
  } catch (err) {
    console.error('[AFL players]', err);
    return NextResponse.json(
      {
        error: 'Failed to fetch AFL players',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}

