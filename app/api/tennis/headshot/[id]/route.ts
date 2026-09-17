import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { isLocalTennisHeadshotPath } from '@/lib/tennis/headshotDisplay';
import { resolveTennisHeadshotUrl, tennisHeadshotLocalFile } from '@/lib/tennis/headshots';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const local = tennisHeadshotLocalFile(id);
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
  const url = resolveTennisHeadshotUrl(id, null);
  if (url && isLocalTennisHeadshotPath(url)) {
    return NextResponse.redirect(new URL(url, request.nextUrl.origin), {
      status: 302,
      headers: { 'Cache-Control': 'public, max-age=86400' },
    });
  }
  return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } });
}
