import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  fetchNblInjuriesFromBasketballComAu,
  type NblInjuryRow,
} from '@/lib/nbl/basketballComAuInjuries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type InjuriesPayload = {
  generatedAt: string;
  source: string;
  sourceUrl?: string;
  injuries: NblInjuryRow[];
};

const TTL_MS = 1000 * 60 * 30;
let cached: { expiresAt: number; data: InjuriesPayload } | null = null;

function readSnapshot(): InjuriesPayload | null {
  const file = path.join(process.cwd(), 'data', 'nbl-injuries.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as InjuriesPayload;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const now = Date.now();

  if (!refresh && cached && cached.expiresAt > now) {
    return NextResponse.json(cached.data);
  }

  try {
    const { injuries, sourceUrl } = await fetchNblInjuriesFromBasketballComAu();
    if (!injuries.length) {
      const snapshot = readSnapshot();
      if (snapshot?.injuries?.length) {
        cached = { expiresAt: now + TTL_MS, data: snapshot };
        return NextResponse.json(snapshot);
      }
      return NextResponse.json(
        { error: 'NBL injury list unavailable', injuries: [] },
        { status: 502 }
      );
    }

    const data: InjuriesPayload = {
      generatedAt: new Date().toISOString(),
      source: 'basketball.com.au',
      sourceUrl,
      injuries,
    };
    cached = { expiresAt: now + TTL_MS, data };
    return NextResponse.json(data);
  } catch (e) {
    const snapshot = readSnapshot();
    if (snapshot?.injuries?.length) {
      cached = { expiresAt: now + TTL_MS, data: snapshot };
      return NextResponse.json(snapshot);
    }
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Failed to load NBL injuries',
        injuries: [],
      },
      { status: 502 }
    );
  }
}
