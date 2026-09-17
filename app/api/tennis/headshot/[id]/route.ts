import { NextRequest, NextResponse } from 'next/server';
import { resolveTennisHeadshotUrl } from '@/lib/tennis/headshots';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = resolveTennisHeadshotUrl(id, null);
  if (!url) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } });
  }
  const target = url.startsWith('http') ? url : new URL(url, request.nextUrl.origin).toString();
  return NextResponse.redirect(target, {
    status: 302,
    headers: { 'Cache-Control': 'public, max-age=86400' },
  });
}
