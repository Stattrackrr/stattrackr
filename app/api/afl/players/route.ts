import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

const AFL_TABLES_BASE = 'https://afltables.com';
const PLAYERS_INDEX_URL = `${AFL_TABLES_BASE}/afl/stats/players.html`;
const TTL_MS = 1000 * 60 * 60; // 1 hour
/** Current AFL season year (AFLTables uses e.g. 2025a.html). Use calendar year; override with AFL_CURRENT_SEASON. */
const CURRENT_SEASON = process.env.AFL_CURRENT_SEASON || String(new Date().getFullYear());

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

/** Read roster from cached file. Tries current year then previous year (e.g. 2026 then 2025). Run scripts/fetch-afl-roster.js to refresh. */
function readCachedRoster(): Array<{ name: string }> | null {
  const year = parseInt(CURRENT_SEASON, 10) || new Date().getFullYear();
  const seasonsToTry = [year, year - 1];
  for (const season of seasonsToTry) {
    try {
      const filePath = path.join(process.cwd(), 'data', `afl-roster-${season}.json`);
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw) as { players?: Array<{ name?: string }> };
      const list = Array.isArray(data?.players) ? data.players : [];
      const players = list
        .map((p) => String(p?.name ?? '').trim())
        .filter((n) => n.length > 0)
        .map((name) => ({ name }));
      if (players.length > 0) return players;
    } catch {
      continue;
    }
  }
  return null;
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

/** Fetch full players index from AFLTables (scrape). Includes retired. */
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
    const q = normalizeName(query);
    const effectiveLimit = q && !q.includes(' ') ? Math.min(100, Math.max(limit, 60)) : limit;

    // Prefer cached roster (players with stats from AFLTables scrape). Run scripts/fetch-afl-roster.js to refresh.
    const roster = readCachedRoster();
    if (roster && roster.length > 0) {
      let pool = roster;
      if (q) {
        pool = pool.filter((p) => nameMatchesQuery(p.name, q));
      }
      pool = [...pool].sort((a, b) => a.name.localeCompare(b.name, 'en'));
      const players = pool.slice(0, effectiveLimit).map((p) => ({ name: p.name }));

      return NextResponse.json({
        source: 'afltables.com',
        query,
        count: players.length,
        players,
      });
    }

    // Fallback: full AFLTables index (includes retired). Run fetch-afl-roster.js for filtered list.
    const allPlayers = await fetchPlayersIndex();
    let pool = allPlayers;
    if (q) {
      pool = pool.filter((p) => nameMatchesQuery(p.name, q));
    }
    pool = [...pool].sort((a, b) => a.name.localeCompare(b.name, 'en'));
    const seenNames = new Set<string>();
    const players = pool
      .filter((p) => {
        const n = normalizeName(p.name);
        if (seenNames.has(n)) return false;
        seenNames.add(n);
        return true;
      })
      .slice(0, effectiveLimit)
      .map((p) => ({ name: p.name }));

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
