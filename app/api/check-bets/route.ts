export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const results = {
      trackedBets: { updated: 0, total: 0, error: null as string | null },
      journalBets: { updated: 0, total: 0, error: null as string | null },
    };

    // Use production domain to avoid preview deployment authentication issues
    const host = req.headers.get('host') || '';
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const productionDomain = process.env.NEXT_PUBLIC_BASE_URL || 'stattrackr.co';
    const useProductionDomain = host.includes('.vercel.app') || host.includes('localhost');
    const baseUrl = useProductionDomain 
      ? `${protocol}://${productionDomain}`
      : (process.env.NEXT_PUBLIC_APP_URL || `${protocol}://${host}`);

    // Check tracked bets
    try {
      const trackedResponse = await fetch(`${baseUrl}/api/check-tracked-bets`);
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
      const journalResponse = await fetch(`${baseUrl}/api/check-journal-bets`);
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
