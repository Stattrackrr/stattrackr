/**
 * Fetch AFL fantasy positions from afl.com.au (no self-API call).
 * Used by props-stats warm so DvP lookup uses correct position (DEF/MID/FWD/RUC).
 */

import { normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';
import sharedCache from '@/lib/sharedCache';

const FANTASY_PLAYERS_CACHE_KEY_PREFIX = 'afl_fantasy_players:';
const FANTASY_PLAYERS_TTL_SECONDS = 60 * 60; // 1 hour

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
  return clean
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p === 'DEF' || p === 'MID' || p === 'FWD' || p === 'RUC');
}

function parseFantasyTables(html: string): Array<{ name: string; team: string; position: string }> {
  const out: Array<{ name: string; team: string; position: string }> = [];
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

    const headerCells = [...rows[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) =>
      htmlToText(m[1]).toUpperCase()
    );
    const hasPlayer = headerCells.some((c) => c.includes('PLAYER'));
    const hasTeam = headerCells.some((c) => c.includes('TEAM'));
    const hasPosition = headerCells.some((c) => c.includes('POSITION'));
    if (!hasPlayer || !hasTeam || !hasPosition) continue;

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

async function fetchAndParse(url: string): Promise<Array<{ name: string; team: string; position: string }>> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-AU,en;q=0.9',
    },
    next: { revalidate: 60 * 60 },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const html = await res.text();
  return parseFantasyTables(html);
}

export type PlayerPositionMap = Map<string, string>;
export type PlayerTeamMap = Map<string, string>;

type CachedFantasyPlayers = { position: Record<string, string>; team: Record<string, string> };

async function fetchAndCacheFantasyPlayers(season: number): Promise<CachedFantasyPlayers> {
  const cacheKey = `${FANTASY_PLAYERS_CACHE_KEY_PREFIX}${season}`;
  const cached = await sharedCache.getJSON<CachedFantasyPlayers>(cacheKey);
  if (cached?.position && typeof cached.position === 'object' && Object.keys(cached.position).length > 0) {
    return cached;
  }
  const position: Record<string, string> = {};
  const team: Record<string, string> = {};
  const candidates = KNOWN_ARTICLE_BY_SEASON[season] ?? [];
  if (candidates.length === 0) return { position, team };
  let parsed: Array<{ name: string; team: string; position: string }> = [];
  for (const url of candidates) {
    const rows = await fetchAndParse(url);
    if (rows.length > parsed.length) parsed = rows;
    if (rows.length >= 100) break;
  }
  for (const p of parsed) {
    const key = normalizeAflPlayerNameForMatch(p.name);
    if (key) {
      position[key] = p.position;
      team[key] = (p.team || '').trim();
    }
  }
  if (Object.keys(position).length > 0) {
    await sharedCache.setJSON(cacheKey, { position, team }, FANTASY_PLAYERS_TTL_SECONDS);
  }
  return { position, team };
}

/**
 * Fetch fantasy positions from afl.com.au and return map: normalized player name -> position (DEF|MID|FWD|RUC).
 * Used by warm and list API so DvP rank is per-position. Cached 1h in sharedCache.
 */
export async function getAflPlayerPositionMap(season: number): Promise<PlayerPositionMap> {
  const { position } = await fetchAndCacheFantasyPlayers(season);
  return new Map(Object.entries(position));
}

/**
 * Fetch fantasy data and return map: normalized player name -> team name (as in article, e.g. "St Kilda").
 * Use as fallback when league player stats don't have the player, so we still resolve opponent correctly.
 */
export async function getAflPlayerTeamMapFromFantasy(season: number): Promise<PlayerTeamMap> {
  const { team } = await fetchAndCacheFantasyPlayers(season);
  return new Map(Object.entries(team).filter(([, t]) => t != null && t !== ''));
}
