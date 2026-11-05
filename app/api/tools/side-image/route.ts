import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { nbaTeamLogoUrl } from '@/lib/nba/dash/teams';
import { nblTeamLogoUrl } from '@/lib/nblTeamCanonical';
import { tennisHeadshotLocalFile, resolveTennisHeadshotUrlByName } from '@/lib/tennis/headshots';
import type { ToolsSport } from '@/lib/tools/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SPORTS = new Set<ToolsSport>(['tennis', 'nba', 'nbl']);

function tennisIdFromResolved(resolved: string | null): string | null {
  if (!resolved) return null;
  const api = resolved.match(/\/api\/tennis\/headshot\/([^/?#]+)/i);
  if (api?.[1]) return decodeURIComponent(api[1]);
  const file = resolved.match(/\/images\/tennis\/headshots\/([^/?#]+)\.(?:jpg|jpeg|png|webp)/i);
  if (file?.[1]) return decodeURIComponent(file[1]);
  return null;
}

/**
 * Serves a side image for tools cards.
 * Tennis: raw bytes (same files as /props) — no redirect, safe for <img src>.
 * NBA/NBL: 302 to logo asset.
 */
export async function GET(request: NextRequest) {
  const sport = String(request.nextUrl.searchParams.get('sport') || '').toLowerCase() as ToolsSport;
  const name = String(request.nextUrl.searchParams.get('name') || '').trim();
  if (!SPORTS.has(sport) || name.length < 2) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } });
  }

  if (sport === 'tennis') {
    const resolved = resolveTennisHeadshotUrlByName(name);
    const id = tennisIdFromResolved(resolved);
    const local = id ? tennisHeadshotLocalFile(id) : null;
    if (local) {
      const body = fs.readFileSync(local.absPath);
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': local.contentType,
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        },
      });
    }
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } });
  }

  if (sport === 'nba') {
    const logo = nbaTeamLogoUrl(name);
    if (!logo) {
      return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } });
    }
    return NextResponse.redirect(logo, {
      status: 302,
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  }

  const nblLogo = nblTeamLogoUrl(name);
  if (!nblLogo) {
    return NextResponse.redirect(new URL('/images/nbl-logo.png', request.nextUrl.origin), {
      status: 302,
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  }
  return NextResponse.redirect(nblLogo, {
    status: 302,
    headers: { 'Cache-Control': 'public, max-age=86400' },
  });
}
