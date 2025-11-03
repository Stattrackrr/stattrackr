export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import sharedCache from '@/lib/sharedCache';
import cache from '@/lib/cache';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get('key');
    if (!key) return NextResponse.json({ ok: false, error: 'key is required' }, { status: 400 });

    // Try shared first
    let source: 'shared' | 'memory' | null = null;
    let value: any = await sharedCache.getJSON<any>(key);
    if (value) {
      source = 'shared';
    } else {
      // Fallback to memory cache (best-effort; internal map not exported, so we check by hitting shared first)
      const memHit = cache.get<any>(key);
      if (memHit) {
        source = 'memory';
        value = memHit;
      }
    }

    const jsonStr = value ? JSON.stringify(value) : '';
    let lastGameDate: string | null = null;
    try {
      const arr = Array.isArray(value?.data) ? value.data : [];
      if (arr.length > 0) {
        const dates = arr.map((g: any) => new Date(g.datetime || g.date || 0).getTime()).filter((n: number) => Number.isFinite(n));
        if (dates.length > 0) lastGameDate = new Date(Math.max(...dates)).toISOString();
      }
    } catch {}

    return NextResponse.json({
      ok: true,
      key,
      exists: !!value,
      source,
      sizeBytes: jsonStr.length,
      lastGameDate,
      preview: value && Array.isArray(value?.data) ? value.data.slice(-2) : null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'debug failed' }, { status: 500 });
  }
}
