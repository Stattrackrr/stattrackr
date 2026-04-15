import { NextRequest, NextResponse } from 'next/server';
import { parseSoccerwayTeamResultsHtml } from '@/lib/soccerwayTeamResults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Only allow Soccerway team profile paths (blocks open redirects / SSRF). */
const TEAM_HREF_RE = /^\/team\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?$/;

export async function GET(request: NextRequest) {
  const href = request.nextUrl.searchParams.get('href')?.trim() || '';
  const normalized = href.startsWith('/') ? href : `/${href}`;
  if (!TEAM_HREF_RE.test(normalized)) {
    return NextResponse.json({ error: 'Invalid or missing href (expected /team/{slug}/{id}/).' }, { status: 400 });
  }

  const base = normalized.replace(/\/+$/, '');
  const resultsUrl = `https://www.soccerway.com${base}/results/`;

  try {
    const response = await fetch(resultsUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Soccerway returned ${response.status}`, resultsUrl },
        { status: 502 }
      );
    }

    const html = await response.text();
    const matches = parseSoccerwayTeamResultsHtml(html, 24);

    return NextResponse.json({
      resultsUrl,
      matches,
      count: matches.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch team results';
    return NextResponse.json({ error: message, resultsUrl }, { status: 500 });
  }
}
