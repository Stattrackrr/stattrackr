import { NextRequest, NextResponse } from 'next/server';
import { resolveTennisPickEvents } from '@/lib/aiPicks/tennisNames';
import { readTennisRosterCache } from '@/lib/tennis/dashboardCache';
import type { TennisTour } from '@/lib/tennis/types';

export const maxDuration = 30;

const MAP_TTL_MS = 10 * 60 * 1000;
const MAX_ITEMS = 200;
let tourMap: { at: number; byId: Map<string, TennisTour> } | null = null;

async function toursById(): Promise<Map<string, TennisTour>> {
  if (tourMap && Date.now() - tourMap.at < MAP_TTL_MS) return tourMap.byId;
  const roster = await readTennisRosterCache();
  const byId = new Map<string, TennisTour>();
  for (const p of roster?.players ?? []) if (p.playerId && p.tour) byId.set(String(p.playerId), p.tour);
  if (byId.size) tourMap = { at: Date.now(), byId };
  return byId;
}

const list = (raw: string | null) =>
  [...new Set((raw || '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_ITEMS);

/**
 * Display data for AI pick tennis legs: ATP/WTA per player id (cached roster) and, per match,
 * full player names. `events` is `eventKey@startsAt`.
 */
export async function GET(request: NextRequest) {
  const ids = list(request.nextUrl.searchParams.get('ids'));
  const targets = list(request.nextUrl.searchParams.get('events')).map((s) => {
    const [eventKey, startsAt = ''] = s.split('@');
    return { eventKey, startsAt };
  });
  const [byId, events] = await Promise.all([toursById(), resolveTennisPickEvents(targets)]);
  const tours: Record<string, TennisTour> = {};
  for (const id of ids) {
    const tour = byId.get(id);
    if (tour) tours[id] = tour;
  }
  return NextResponse.json({ tours, events }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
