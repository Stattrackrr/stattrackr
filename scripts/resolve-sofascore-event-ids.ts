#!/usr/bin/env npx tsx
/**
 * Resolve SofaScore event ids to home/away team names (1 scraper credit each).
 * Also list the last N fixtures in a season by processing order (fixture list
 * only — no /statistics calls).
 *
 *   npx tsx scripts/resolve-sofascore-event-ids.ts 11797997 11797980
 *   npx tsx scripts/resolve-sofascore-event-ids.ts --season=56249 --tournament=13 --tail=15
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sofascoreFetch } from '../lib/sofascoreScraper';

type SofaEvent = {
  id: number;
  status?: { type?: string };
  homeTeam?: { name: string };
  awayTeam?: { name: string };
};

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

async function loadAllEvents(tournamentId: number, seasonId: number): Promise<SofaEvent[]> {
  const all: SofaEvent[] = [];
  let pageNum = 0;
  for (;;) {
    const data = await sofascoreFetch<{ events: SofaEvent[]; hasNextPage?: boolean }>(
      `/unique-tournament/${tournamentId}/season/${seasonId}/events/last/${pageNum}`
    ).catch(() => ({ events: [] as SofaEvent[], hasNextPage: false }));
    all.push(...(data.events ?? []));
    if (!data.hasNextPage) break;
    pageNum += 1;
  }
  return all;
}

async function main() {
  const ids = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
  const tail = Number.parseInt(getArg('tail') ?? '0', 10);
  const seasonId = getArg('season');
  const tournamentId = getArg('tournament');

  if (ids.length) {
    for (const id of ids) {
      try {
        const data = await sofascoreFetch<{ event: SofaEvent }>(`/event/${id}`);
        const e = data.event;
        console.log(
          `[${id}] ${e?.homeTeam?.name ?? '?'} vs ${e?.awayTeam?.name ?? '?'} (${e?.status?.type ?? '?'})`
        );
      } catch (err) {
        console.log(`[${id}] lookup failed — ${(err as Error).message}`);
      }
    }
  }

  if (seasonId && tournamentId) {
    const events = await loadAllEvents(Number.parseInt(tournamentId, 10), Number.parseInt(seasonId, 10));
    const finished = events.filter((e) => e.status?.type === 'finished');
    const slice = tail > 0 ? finished.slice(-tail) : finished;
    console.log(`\nSeason ${seasonId}: ${finished.length} finished fixtures${tail ? ` (showing last ${slice.length})` : ''}`);
    slice.forEach((e, i) => {
      const idx = tail > 0 ? finished.length - slice.length + i + 1 : i + 1;
      console.log(`  ${String(idx).padStart(3)}/${finished.length} [${e.id}] ${e.homeTeam?.name} vs ${e.awayTeam?.name}`);
    });
  }

  if (!ids.length && !(seasonId && tournamentId)) {
    console.log('Usage: npx tsx scripts/resolve-sofascore-event-ids.ts <eventId> [...]');
    console.log('   or: npx tsx scripts/resolve-sofascore-event-ids.ts --tournament=13 --season=56249 --tail=15');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
