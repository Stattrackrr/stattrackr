export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

export async function GET() {
  try {
    const authHeader = headers().get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      `${headers().get('x-forwarded-proto') || 'https'}://${headers().get('host')}`;
    const authConfig = process.env.CRON_SECRET
      ? { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }
      : {};

    const results = {
      trackedBets: { updated: 0, total: 0, error: null as string | null },
      journalBets: { updated: 0, total: 0, error: null as string | null },
    };

    // Check tracked bets
    try {
      const trackedResponse = await fetch(`${baseUrl}/api/check-tracked-bets`, authConfig);
      if (trackedResponse.ok) {
        const data = await trackedResponse.json();
        results.trackedBets = { updated: data.updated || 0, total: data.total || 0, error: null };
      } else {
        results.trackedBets.error = 'Failed to check tracked bets';
      }
    } catch (error: any) {
      results.trackedBets.error = error.message;
    }

    // Check journal bets
    try {
      const journalResponse = await fetch(`${baseUrl}/api/check-journal-bets`, authConfig);
      if (journalResponse.ok) {
        const data = await journalResponse.json();
        results.journalBets = { updated: data.updated || 0, total: data.total || 0, error: null };
      } else {
        results.journalBets.error = 'Failed to check journal bets';
      }
    } catch (error: any) {
      results.journalBets.error = error.message;
    }

    return NextResponse.json({
      message: 'Bet checks completed',
      results,
      totalUpdated: results.trackedBets.updated + results.journalBets.updated,
    });
  } catch (error: any) {
    console.error('Error checking bets:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to check bets' },
      { status: 500 }
    );
  }
}
