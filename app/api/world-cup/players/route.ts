import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BDL_FIFA_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';

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

export async function GET(request: NextRequest) {
  const apiKey = getBdlApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'BALLDONTLIE_API_KEY is not configured' }, { status: 500 });
  }

  const search = request.nextUrl.searchParams.get('search')?.trim() ?? '';
  const teamId = request.nextUrl.searchParams.get('teamId')?.trim() ?? '';
  const season = request.nextUrl.searchParams.get('season')?.trim() ?? '';
  const url = new URL(`${BDL_FIFA_BASE}/players`);
  url.searchParams.set('per_page', '25');
  if (search) url.searchParams.set('search', search);
  if (teamId && /^\d+$/.test(teamId)) url.searchParams.append('team_ids[]', teamId);
  if (season && ['2018', '2022', '2026'].includes(season)) url.searchParams.append('seasons[]', season);

  let lastStatus = 0;
  let lastText = '';

  for (const auth of getAuthCandidates(apiKey)) {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'StatTrackr/1.0',
        Authorization: auth,
      },
      cache: 'no-store',
    });

    const text = await response.text();
    if (response.ok) {
      return new NextResponse(text, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }

    lastStatus = response.status;
    lastText = text;
    if (response.status !== 401) break;
  }

  return NextResponse.json(
    { error: lastText || `BDL players request failed with ${lastStatus}` },
    { status: lastStatus || 500 }
  );
}
