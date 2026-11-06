import { NextRequest, NextResponse } from 'next/server';
import { TOOLS_SOFT_BOOKS, canonBook, isSoftBook } from '@/lib/tools/books';
import { apiRateLimiter, checkRateLimit } from '@/lib/rateLimit';
import { allowToolsAccess } from '@/lib/tools/auth';
import { resolveSports, runBonusScan } from '@/lib/tools/runScan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(request, apiRateLimiter);
  if (!rate.allowed && rate.response) return rate.response;
  if (!(await allowToolsAccess(request))) {
    return NextResponse.json(
      { success: false, proRequired: true, error: 'Betting Tools is a Pro feature.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const bonus = Number(body?.bonus ?? body?.amount);
  const bonusBook = canonBook(body?.bonusBook);
  const heldRaw: unknown[] = Array.isArray(body?.heldBooks) ? body.heldBooks : [];
  const heldBooks: string[] = [];
  const heldSeen = new Set<string>();
  for (const raw of heldRaw) {
    const book = canonBook(String(raw || ''));
    if (!book || !isSoftBook(book) || heldSeen.has(book)) continue;
    heldSeen.add(book);
    heldBooks.push(book);
  }
  const sports = resolveSports(body?.sport);

  if (!(bonus > 0 && bonus <= 10_000)) {
    return NextResponse.json({ success: false, error: 'Enter a bonus amount between $1 and $10,000.' }, { status: 400 });
  }
  if (!bonusBook || !TOOLS_SOFT_BOOKS.includes(bonusBook as (typeof TOOLS_SOFT_BOOKS)[number])) {
    return NextResponse.json({ success: false, error: 'Pick a valid bonus book.' }, { status: 400 });
  }
  if (!heldBooks.length) {
    return NextResponse.json({ success: false, error: 'Select at least one hedge book you can use.' }, { status: 400 });
  }

  try {
    const payload = await runBonusScan(sports, { bonus, bonusBook, heldBooks });
    return NextResponse.json({ success: true, flips: payload.flips, meta: payload.meta, sports });
  } catch (err) {
    console.error('[tools/bonus]', err);
    return NextResponse.json({ success: false, error: 'Bonus scan failed. Try again shortly.' }, { status: 500 });
  }
}
