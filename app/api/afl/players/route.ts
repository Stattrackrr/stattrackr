import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { listAflPlayerPropsFromCache } from '@/lib/aflPlayerPropsCache';
import { rosterTeamToInjuryTeam, leagueTeamToOfficial, footywireNicknameToOfficial } from '@/lib/aflTeamMapping';
import { normalizeAflPlayerName } from '@/lib/aflPlayerNameUtils';

/** Current AFL season year; override with AFL_CURRENT_SEASON. */
const CURRENT_SEASON = process.env.AFL_CURRENT_SEASON || String(new Date().getFullYear());

type PlayerListEntry = { name: string; team?: string; number?: number | null };

/** Normalize for search/key matching; keeps apostrophe and hyphen, normalizes unicode variants. */
function normalizeName(v: string): string {
  return normalizeAflPlayerName(v);
}

function nameMatchesQuery(name: string, normalizedQuery: string): boolean {
  const normalizedName = normalizeName(name);
  if (!normalizedQuery) return true;
  if (normalizedName.includes(normalizedQuery)) return true;
  const parts = normalizedQuery.split(' ').filter(Boolean);
  if (parts.length === 0) return true;
  return parts.every((p) => normalizedName.includes(p));
}

/** Exact normalized match for fast single-player lookup (e.g. from ?player= URL). */
function exactNameMatch(name: string, normalizedQuery: string): boolean {
  return normalizeName(name) === normalizedQuery;
}

/** Read from league player stats (FootyWire). Prefer this so search uses same data as warm script; no API call. Run scripts/fetch-footywire-league-player-stats.js to refresh. */
function readCachedLeaguePlayerList(): Array<PlayerListEntry> | null {
  const year = parseInt(CURRENT_SEASON, 10) || new Date().getFullYear();
  const seasonsToTry = [year, year - 1];
  for (const season of seasonsToTry) {
    try {
      const filePath = path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`);
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw) as { players?: Array<{ name?: string; team?: string; number?: number | null }> };
      const list = Array.isArray(data?.players) ? data.players : [];
      const players = list
        .map((p): PlayerListEntry | null => {
          const name = String(p?.name ?? '').trim();
          if (name.length === 0) return null;
          const num = typeof p?.number === 'number' && Number.isFinite(p.number) ? p.number : null;
          return { name, team: p?.team, number: num };
        })
        .filter((p): p is PlayerListEntry => p != null);
      if (players.length > 0) return players;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Build unique player list from the same cache as the props page — by player name only (all games).
 * Optionally attach team/number from league stats when available.
 */
async function playersFromPropsCache(): Promise<Array<PlayerListEntry> | null> {
  const result = await listAflPlayerPropsFromCache();
  if (!result?.props?.length) return null;

  const leagueList = readCachedLeaguePlayerList();
  const byNormalName = new Map<string, { name: string; team?: string; number?: number | null }>();
  for (const row of result.props) {
    const name = String(row.playerName ?? '').trim();
    if (!name) continue;
    const key = normalizeName(name);
    if (byNormalName.has(key)) continue;
    const fromLeague = leagueList?.find((p) => normalizeName(p.name) === key);
    byNormalName.set(key, {
      name,
      team: fromLeague?.team ?? undefined,
      number: fromLeague?.number ?? null,
    });
  }
  const list = Array.from(byNormalName.values()).map((p) => ({
    name: p.name,
    team: p.team,
    number: p.number ?? undefined,
  }));
  return list.length > 0 ? list : null;
}

/** Read roster from cached file. Tries current year then previous year (e.g. 2026 then 2025). Run scripts/fetch-afl-roster.js to refresh. */
function readCachedRoster(): Array<PlayerListEntry> | null {
  const year = parseInt(CURRENT_SEASON, 10) || new Date().getFullYear();
  const seasonsToTry = [year, year - 1];
  for (const season of seasonsToTry) {
    try {
      const filePath = path.join(process.cwd(), 'data', `afl-roster-${season}.json`);
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw) as { players?: Array<{ name?: string; team?: string }> };
      const list = Array.isArray(data?.players) ? data.players : [];
      const players = list
        .map((p): PlayerListEntry | null => {
          const name = String(p?.name ?? '').trim();
          return name.length > 0 ? { name, team: p?.team } : null;
        })
        .filter((p): p is PlayerListEntry => p != null);
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

/** Resolve player team string (league or roster format) to official full name for comparison. */
function resolveToOfficialTeam(teamRaw: string | undefined): string | null {
  if (!teamRaw || typeof teamRaw !== 'string') return null;
  const t = teamRaw.trim();
  if (!t) return null;
  return leagueTeamToOfficial(t) || footywireNicknameToOfficial(t) || rosterTeamToInjuryTeam(t) || t;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('query')?.trim() ?? '';
  const teamParam = request.nextUrl.searchParams.get('team')?.trim();
  const limitRaw = parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10);
  const limit = Math.max(1, Math.min(100, Number.isNaN(limitRaw) ? 20 : limitRaw));
  const exactParam = request.nextUrl.searchParams.get('exact');
  const exactLookup = exactParam === '1' || exactParam === 'true';
  const filterByOfficialTeam =
    teamParam && teamParam !== 'All' && teamParam.length > 0 ? teamParam : null;

  try {
    const q = normalizeName(query);
    const effectiveLimit = q && !q.includes(' ') ? Math.min(100, Math.max(limit, 60)) : limit;

    // Fast path: when resolving a single player by exact name (e.g. from ?player= link), use sync file reads only — avoids slow props-cache round-trip.
    if (exactLookup && query) {
      const leagueList = readCachedLeaguePlayerList();
      const roster = leagueList && leagueList.length > 0 ? leagueList : readCachedRoster();
      const pool = roster ?? [];
      const match = pool.find((p) => {
        if (!exactNameMatch(p.name, q)) return false;
        if (filterByOfficialTeam && resolveToOfficialTeam(p.team) !== filterByOfficialTeam) return false;
        return true;
      });
      if (match) {
        const players = [{
          name: match.name,
          team: match.team,
          ...(match.number != null ? { number: match.number } : {}),
        }];
        return NextResponse.json({
          source: leagueList && leagueList.length > 0 ? 'footywire.com' : 'roster',
          query,
          count: 1,
          players,
        });
      }
    }

    // Prefer players from props cache, merged with league/roster — but if that pool has 0 matches, fall through to full roster/index.
    const propsList = await playersFromPropsCache();
    const leagueList = readCachedLeaguePlayerList();
    const rosterOnly = leagueList && leagueList.length > 0 ? null : readCachedRoster();
    const fallbackList = leagueList && leagueList.length > 0 ? leagueList : rosterOnly;
    const byNormalName = new Map<string, PlayerListEntry>();
    if (fallbackList && fallbackList.length > 0) {
      for (const p of fallbackList) {
        const key = normalizeName(p.name);
        if (!byNormalName.has(key)) byNormalName.set(key, { name: p.name, team: p.team, number: p.number ?? undefined });
      }
    }
    if (propsList && propsList.length > 0) {
      for (const p of propsList) {
        const key = normalizeName(p.name);
        byNormalName.set(key, { name: p.name, team: p.team, number: p.number ?? undefined });
      }
    }
    if (byNormalName.size > 0) {
      let pool = Array.from(byNormalName.values());
      if (q) {
        pool = pool.filter((p) => nameMatchesQuery(p.name, q));
      }
      if (filterByOfficialTeam) {
        pool = pool.filter((p) => resolveToOfficialTeam(p.team) === filterByOfficialTeam);
      }
      pool = [...pool].sort((a, b) => a.name.localeCompare(b.name, 'en'));
      const players = pool.slice(0, effectiveLimit).map((p) => ({
        name: p.name,
        team: p.team,
        ...(p.number != null ? { number: p.number } : {}),
      }));
      if (players.length > 0) {
        return NextResponse.json({
          source: 'player-props-cache',
          query,
          count: players.length,
          players,
        });
      }
    }

    // Fallback: league player stats (FootyWire) then roster so search works when props cache is empty or had 0 matches.
    const fallbackLeague = readCachedLeaguePlayerList();
    const roster = fallbackLeague && fallbackLeague.length > 0 ? fallbackLeague : readCachedRoster();
    if (roster && roster.length > 0) {
      let pool = roster;
      if (q) {
        pool = pool.filter((p) => nameMatchesQuery(p.name, q));
      }
      if (filterByOfficialTeam) {
        pool = pool.filter((p) => resolveToOfficialTeam(p.team) === filterByOfficialTeam);
      }
      pool = [...pool].sort((a, b) => a.name.localeCompare(b.name, 'en'));
      const players = pool.slice(0, effectiveLimit).map((p) => ({
        name: p.name,
        team: p.team,
        ...(p.number != null ? { number: p.number } : {}),
      }));
      if (players.length > 0) {
        return NextResponse.json({
          source: fallbackLeague && fallbackLeague.length > 0 ? 'footywire.com' : 'roster',
          query,
          count: players.length,
          players,
        });
      }
    }

    // FootyWire only: no AFL Tables. Return empty when league/roster have no matches.
    return NextResponse.json({
      source: 'footywire.com',
      query,
      count: 0,
      players: [],
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Failed to fetch AFL players',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
