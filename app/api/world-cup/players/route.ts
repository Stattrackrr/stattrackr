import { NextRequest, NextResponse } from 'next/server';
import {
  InternationalCompetition,
  searchInternationalPlayers,
} from '@/lib/internationalDashboard';
import { getWorldCupCache, setWorldCupCache } from '@/lib/worldCupCache';
import {
  getWorldCupPlayerIndex,
  searchWorldCupPlayerIndex,
} from '@/lib/worldCupPlayerIndex';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BDL_FIFA_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';

// Persist BDL World Cup player searches in Supabase so the same query never
// re-hits the API. Stored permanently (no expiry).
const WC_PLAYER_SEARCH_CACHE_PREFIX = 'wc:player-search:v1';

function buildPlayerSearchCacheKey(opts: {
  competition: CompetitionParam;
  search: string;
  teamId: string;
  season: string;
}): string {
  const normalizedSearch = opts.search.toLowerCase().replace(/\s+/g, ' ').trim();
  const teamPart = /^\d+$/.test(opts.teamId) ? opts.teamId : 'any';
  const seasonPart = ['2018', '2022', '2026'].includes(opts.season) ? opts.season : 'any';
  return `${WC_PLAYER_SEARCH_CACHE_PREFIX}:${opts.competition}:${seasonPart}:${teamPart}:${normalizedSearch}`;
}

type CompetitionParam = 'all' | 'world-cup' | InternationalCompetition;

function parseCompetition(value: string | null): CompetitionParam {
  const v = (value || '').toLowerCase();
  if (v === 'euros' || v === 'nations-league' || v === 'all') return v;
  return 'world-cup';
}

function getBdlApiKey(): string {
  return (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
}

function getAuthCandidates(apiKey: string): string[] {
  if (!apiKey) return [];
  if (apiKey.startsWith('Bearer ')) {
    const raw = apiKey.replace(/^Bearer\s+/i, '').trim();
    return [raw, apiKey].filter(Boolean);
  }
  return [apiKey, `Bearer ${apiKey}`];
}

async function fetchBdlPlayers(opts: {
  search: string;
  teamId?: string;
  season?: string;
}): Promise<Array<Record<string, unknown>>> {
  const apiKey = getBdlApiKey();
  if (!apiKey) return [];
  const url = new URL(`${BDL_FIFA_BASE}/players`);
  url.searchParams.set('per_page', '25');
  if (opts.search) url.searchParams.set('search', opts.search);
  if (opts.teamId && /^\d+$/.test(opts.teamId)) url.searchParams.append('team_ids[]', opts.teamId);
  if (opts.season && ['2018', '2022', '2026'].includes(opts.season)) {
    url.searchParams.append('seasons[]', opts.season);
  }
  for (const auth of getAuthCandidates(apiKey)) {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'StatTrackr/1.0',
        Authorization: auth,
      },
      cache: 'no-store',
    });
    if (response.ok) {
      const text = await response.text();
      try {
        const json = JSON.parse(text) as { data?: Array<Record<string, unknown>> };
        return (json.data ?? []).map((row) => ({ ...row, source: 'bdl', competition: 'world-cup' }));
      } catch {
        return [];
      }
    }
    if (response.status !== 401) break;
  }
  return [];
}

function normalizeForDedupe(name: string): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Collapse duplicates of the same player coming from BDL + international
 * sources. Prefer BDL rows because their position labels are full names
 * ("Center Forward") rather than single letters ("F").
 */
function dedupePlayers(
  rows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const byName = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const name = String((row as { name?: unknown }).name ?? '');
    const key = normalizeForDedupe(name);
    if (!key) continue;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, row);
      continue;
    }
    // Prefer BDL over international when names match.
    const existingSource = String((existing as { source?: unknown }).source ?? '');
    const incomingSource = String((row as { source?: unknown }).source ?? '');
    if (existingSource !== 'bdl' && incomingSource === 'bdl') {
      byName.set(key, row);
    }
  }
  return Array.from(byName.values());
}

export async function GET(request: NextRequest) {
  const competition = parseCompetition(request.nextUrl.searchParams.get('competition'));
  const search = request.nextUrl.searchParams.get('search')?.trim() ?? '';
  const teamId = request.nextUrl.searchParams.get('teamId')?.trim() ?? '';
  const season = request.nextUrl.searchParams.get('season')?.trim() ?? '';

  if (!search) {
    return NextResponse.json({ data: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const cacheKey = buildPlayerSearchCacheKey({ competition, search, teamId, season });

  try {
    // Preferred path: serve entirely from the pre-built master player index in
    // Supabase (no BDL API). Built by `npm run build:world-cup:player-index`.
    //
    // Only players active in the current World Cup are searchable — regardless
    // of the selected competition tab — so we always query the index as
    // 'world-cup'. The attached Euros/Nations-League sources are used purely so
    // the dashboard can merge those stats by player name.
    const index = await getWorldCupPlayerIndex();
    if (index && index.length) {
      const data = searchWorldCupPlayerIndex(index, {
        query: search,
        competition: 'world-cup',
        limit: 25,
      });
      return NextResponse.json(
        { data, source: 'index' },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Fallback (index not built yet): per-query cache + live lookups.
    const cached = await getWorldCupCache<Array<Record<string, unknown>>>(cacheKey);
    if (cached) {
      return NextResponse.json(
        { data: cached, cached: true },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    let data: Array<Record<string, unknown>>;
    if (competition === 'world-cup') {
      data = dedupePlayers(await fetchBdlPlayers({ search, teamId, season }));
    } else if (competition === 'euros' || competition === 'nations-league') {
      data = dedupePlayers(
        await searchInternationalPlayers({ competition, query: search, limit: 25 })
      );
    } else {
      // competition === 'all'
      const [bdl, intl] = await Promise.all([
        fetchBdlPlayers({ search, teamId, season }),
        searchInternationalPlayers({ competition: 'all', query: search, limit: 25 }),
      ]);
      data = dedupePlayers([...bdl, ...intl]);
    }

    // Only cache non-empty results so a transient API hiccup (empty array)
    // doesn't get pinned permanently.
    if (data.length) {
      await setWorldCupCache(cacheKey, data);
    }

    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to search players' },
      { status: 500 }
    );
  }
}
