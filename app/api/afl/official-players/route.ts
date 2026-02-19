import { NextRequest, NextResponse } from 'next/server';

/**
 * Fetches player list (with positions) from the AFL official API.
 * Response shape: lists[].player (givenName, surname, jumper, playerPosition), lists[].team (teamId, teamAbbr, teamName).
 *
 * URL: AFL_OFFICIAL_PLAYERS_URL (full URL) or AFL_OFFICIAL_API_BASE (e.g. https://api.afl.com.au → /cfs/afl/players).
 *
 * Auth (fixes 401): Champion Data uses OAuth M2M. Set AFL_OFFICIAL_CLIENT_ID and AFL_OFFICIAL_CLIENT_SECRET;
 * we fetch a token from https://championdata-afl.au.auth0.com/oauth/token. Or set AFL_OFFICIAL_API_KEY for x-api-key.
 */

const TTL_MS = 1000 * 60 * 60; // 1 hour
const cache = new Map<string, { expiresAt: number; data: OfficialPlayerEntry[] }>();

const TOKEN_CACHE_MS = 23 * 60 * 60 * 1000; // 23h
let oauthToken: { access_token: string; expiresAt: number } | null = null;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const apiKey = process.env.AFL_OFFICIAL_API_KEY?.trim();
  if (apiKey) return { 'x-api-key': apiKey };

  const clientId = process.env.AFL_OFFICIAL_CLIENT_ID?.trim();
  const clientSecret = process.env.AFL_OFFICIAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return {};

  if (oauthToken && oauthToken.expiresAt > Date.now()) {
    return { Authorization: `Bearer ${oauthToken.access_token}` };
  }

  const tokenUrl = process.env.AFL_OFFICIAL_TOKEN_URL?.trim() || 'https://championdata-afl.au.auth0.com/oauth/token';
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const audience = process.env.AFL_OFFICIAL_AUDIENCE?.trim();
  if (audience) body.set('audience', audience);
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[AFL official-players] OAuth token failed', res.status, text);
    throw new Error(`OAuth token failed: ${res.status}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  const access_token = data?.access_token;
  if (!access_token) throw new Error('OAuth response missing access_token');
  oauthToken = {
    access_token,
    expiresAt: Date.now() + (typeof data.expires_in === 'number' ? Math.min(data.expires_in * 1000, TOKEN_CACHE_MS) : TOKEN_CACHE_MS),
  };
  return { Authorization: `Bearer ${oauthToken.access_token}` };
}

type OfficialPlayerEntry = {
  playerId: string;
  jumper: number;
  name: string;
  playerPosition: string;
  positionLabel: string;
  teamId: string;
  teamAbbr: string;
  teamName: string;
};

/** Map API playerPosition (e.g. MEDIUM_FORWARD) to short label for oval/list. */
function positionToLabel(pos: string): string {
  const p = (pos || '').toUpperCase();
  const map: Record<string, string> = {
    KEY_DEFENDER: 'KD',
    MEDIUM_DEFENDER: 'MD',
    KEY_FORWARD: 'KF',
    MEDIUM_FORWARD: 'MF',
    MIDFIELDER: 'MID',
    MIDFIELDER_FORWARD: 'M/F',
    RUCK: 'R',
  };
  return map[p] || p.replace(/_/g, ' ').slice(0, 4);
}

function parseResponse(json: unknown): OfficialPlayerEntry[] {
  const lists = Array.isArray((json as { lists?: unknown })?.lists)
    ? (json as { lists: unknown[] }).lists
    : [];
  const out: OfficialPlayerEntry[] = [];
  for (const item of lists) {
    const player = (item as { player?: unknown })?.player;
    const team = (item as { team?: unknown })?.team;
    if (!player || typeof player !== 'object') continue;
    const po = player as Record<string, unknown>;
    const givenName = String(po.givenName ?? '').trim();
    const surname = String(po.surname ?? '').trim();
    const name = [givenName, surname].filter(Boolean).join(' ');
    if (!name) continue;
    const jumper = po.jumper != null && Number.isFinite(Number(po.jumper)) ? Number(po.jumper) : 0;
    const playerPosition = String(po.playerPosition ?? '').trim();
    const teamId = team && typeof team === 'object' ? String((team as Record<string, unknown>).teamId ?? '') : '';
    const teamAbbr = team && typeof team === 'object' ? String((team as Record<string, unknown>).teamAbbr ?? '') : '';
    const teamName = team && typeof team === 'object' ? String((team as Record<string, unknown>).teamName ?? '') : '';
    out.push({
      playerId: String(po.playerId ?? ''),
      jumper,
      name,
      playerPosition,
      positionLabel: positionToLabel(playerPosition),
      teamId,
      teamAbbr,
      teamName,
    });
  }
  return out;
}

export async function GET(request: NextRequest) {
  const competitionId = request.nextUrl.searchParams.get('competitionId')?.trim();
  const teamAbbr = request.nextUrl.searchParams.get('teamAbbr')?.trim();
  const teamName = request.nextUrl.searchParams.get('teamName')?.trim();

  if (!competitionId) {
    return NextResponse.json(
      { error: 'competitionId is required (e.g. CD_S202501488 from afl.com.au network tab)' },
      { status: 400 }
    );
  }

  const cacheKey = [competitionId, teamAbbr ?? '', teamName ?? ''].join('|');
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ players: cached.data, source: 'cache' });
  }

  const baseUrl =
    process.env.AFL_OFFICIAL_PLAYERS_URL ||
    (process.env.AFL_OFFICIAL_API_BASE
      ? `${process.env.AFL_OFFICIAL_API_BASE.replace(/\/$/, '')}/cfs/afl/players`
      : '');
  if (!baseUrl) {
    return NextResponse.json(
      {
        error:
          'AFL official API not configured. Set AFL_OFFICIAL_API_BASE (e.g. https://api.afl.com.au) or AFL_OFFICIAL_PLAYERS_URL (full URL to players endpoint).',
        hint: 'Use the same origin/URL you see for "players?competitionId=..." in the afl.com.au network tab.',
      },
      { status: 503 }
    );
  }

  const url = new URL(baseUrl);
  url.searchParams.set('competitionId', competitionId);

  try {
    const authHeaders = await getAuthHeaders();
    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        Referer: 'https://www.afl.com.au/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...authHeaders,
      },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401) oauthToken = null;
    if (!res.ok) {
      const status = res.status >= 400 && res.status < 600 ? res.status : 502;
      const hint =
        res.status === 401
          ? 'Set AFL_OFFICIAL_CLIENT_ID and AFL_OFFICIAL_CLIENT_SECRET (Champion Data), or AFL_OFFICIAL_API_KEY. See docs.api.afl.championdata.com'
          : undefined;
      return NextResponse.json(
        { error: hint ? `AFL API returned ${res.status}. ${hint}` : `AFL API returned ${res.status}`, upstreamStatus: res.status },
        { status }
      );
    }
    const json = await res.json();
    let players = parseResponse(json);
    if (teamAbbr) {
      const abbr = teamAbbr.toUpperCase();
      players = players.filter((p) => p.teamAbbr.toUpperCase() === abbr);
    }
    if (teamName) {
      const norm = teamName.toLowerCase().replace(/\s+/g, ' ');
      players = players.filter((p) => p.teamName.toLowerCase().replace(/\s+/g, ' ').includes(norm));
    }
    cache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, data: players });
    return NextResponse.json({ players, source: 'afl', totalResults: players.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[AFL official-players]', message);
    const isTimeout = typeof message === 'string' && (message.includes('abort') || message.includes('timeout'));
    return NextResponse.json(
      {
        error: isTimeout ? 'AFL API request timed out' : 'Failed to fetch AFL official players',
        details: message,
      },
      { status: 502 }
    );
  }
}
