import { NextResponse } from 'next/server';
import { getAflPlayerHeadshotUrl } from '@/lib/aflPlayerHeadshots';
import { fetchClubSitePortraitUrl } from '@/lib/aflClubPlayerPortrait';
import { normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';
import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';

export const runtime = 'nodejs';

const MAX_PLAYERS = 48;

const clubCache = new Map<string, { url: string | null; expiresAt: number }>();
const CLUB_HIT_TTL_MS = 24 * 60 * 60 * 1000;
const CLUB_MISS_TTL_MS = 25 * 60 * 1000;

/** Bump when club URL shape changes (e.g. prefer ChampID over photo-resources) so stale CDN URLs are not reused. */
const CLUB_PORTRAIT_CACHE_SCHEMA = 2;

function clubCacheKey(playerName: string, teamCandidate: string) {
  const team = toOfficialAflTeamDisplayName(teamCandidate.trim());
  return `${CLUB_PORTRAIT_CACHE_SCHEMA}|${normalizeAflPlayerNameForMatch(playerName)}|${team.toLowerCase()}`;
}

/** Deduped official team names to try on club sites (player team often wrong when resolver used home-only). */
function teamCandidates(team?: string, homeTeam?: string, awayTeam?: string): string[] {
  const raw = [team, homeTeam, awayTeam].filter(
    (x): x is string => typeof x === 'string' && x.trim() !== ''
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const o = toOfficialAflTeamDisplayName(r.trim());
    if (!o || seen.has(o)) continue;
    seen.add(o);
    out.push(o);
  }
  return out;
}

async function clubPortraitCached(name: string, teamCandidate: string): Promise<string | null> {
  const ck = clubCacheKey(name, teamCandidate);
  const hit = clubCache.get(ck);
  if (hit && hit.expiresAt > Date.now()) return hit.url;

  const url = await fetchClubSitePortraitUrl(name, teamCandidate);
  const ttl = url ? CLUB_HIT_TTL_MS : CLUB_MISS_TTL_MS;
  clubCache.set(ck, { url, expiresAt: Date.now() + ttl });
  return url;
}

/**
 * POST /api/afl/player-portraits
 * Body: { players: { name: string; team?: string; homeTeam?: string; awayTeam?: string }[] }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      players?: Array<{ name?: string; team?: string; homeTeam?: string; awayTeam?: string }>;
    };
    const raw = Array.isArray(body?.players) ? body.players : [];
    if (raw.length === 0) {
      return NextResponse.json({ portraits: {} });
    }
    if (raw.length > MAX_PLAYERS) {
      return NextResponse.json({ error: `Too many players (max ${MAX_PLAYERS})` }, { status: 400 });
    }

    const dedup = new Map<string, { name: string; team?: string; homeTeam?: string; awayTeam?: string }>();
    for (const p of raw) {
      const name = typeof p?.name === 'string' ? p.name.trim() : '';
      if (!name || dedup.has(name)) continue;
      dedup.set(name, {
        name,
        team: typeof p?.team === 'string' ? p.team.trim() : undefined,
        homeTeam: typeof p?.homeTeam === 'string' ? p.homeTeam.trim() : undefined,
        awayTeam: typeof p?.awayTeam === 'string' ? p.awayTeam.trim() : undefined,
      });
    }

    const portraits: Record<string, string | null> = {};
    const list = [...dedup.values()];
    const chunk = 4;

    const resolveOne = async (p: {
      name: string;
      team?: string;
      homeTeam?: string;
      awayTeam?: string;
    }) => {
      const { name, team, homeTeam, awayTeam } = p;
      const manual = getAflPlayerHeadshotUrl(name);
      if (manual) {
        portraits[name] = manual;
        return;
      }

      const candidates = teamCandidates(team, homeTeam, awayTeam);
      for (const t of candidates) {
        const u = await clubPortraitCached(name, t);
        if (u) {
          portraits[name] = u;
          return;
        }
      }

      portraits[name] = null;
    };

    for (let i = 0; i < list.length; i += chunk) {
      await Promise.all(list.slice(i, i + chunk).map((p) => resolveOne(p)));
    }

    return NextResponse.json({ portraits });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Bad request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
