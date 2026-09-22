import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import type { NblInjuryRow } from '@/lib/nbl/basketballComAuInjuries';
import { omitPlayersWhoPlayedLatestGame } from '@/lib/nbl/nblInjuryActiveFilter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type InjuriesPayload = {
  generatedAt: string;
  source: string;
  sourceUrl?: string;
  injuries: NblInjuryRow[];
};

/**
 * GET /api/nbl/injuries — snapshot only (`data/nbl-injuries.json`).
 * Live scrape happens in `scripts/fetch-nbl-injuries.ts`, not per request.
 */

function readSnapshot(): InjuriesPayload | null {
  const file = path.join(process.cwd(), 'data', 'nbl-injuries.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as InjuriesPayload;
  } catch {
    return null;
  }
}

export async function GET() {
  const snapshot = readSnapshot();
  if (!snapshot) {
    return NextResponse.json(
      { error: 'NBL injury list unavailable', injuries: [] },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ...snapshot,
    injuries: omitPlayersWhoPlayedLatestGame(snapshot.injuries || []),
  });
}
