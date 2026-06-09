#!/usr/bin/env npx tsx
/**
 * Discover SofaScore unique-tournament IDs (and season IDs) for the World Cup
 * qualifier zones API-Football exposes no per-match stats for (AFC / CAF / OFC),
 * plus any other "proper" comps. For each it lists seasons and samples one
 * finished event to confirm lineups carry per-player statistics (which the
 * dashboard sums into team goals / shots / passes / cards).
 *
 * Fetches through the hosted scraper API (no browser). Configure in .env.local:
 *   SCRAPER_API_KEY=...   (see lib/sofascoreScraper.ts for provider options)
 *
 *   npx tsx scripts/probe-sofascore-tournaments.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sofascoreFetch } from '../lib/sofascoreScraper';

// SofaScore text search often misses men's football WCQ (returns FIBA etc.). These
// ids come from the tournament URL on sofascore.com — probe them directly first.
const KNOWN_TOURNAMENTS: Array<{ id: number; label: string; ingestSlug?: string }> = [
  { id: 308, label: 'World Cup Qual. AFC', ingestSlug: 'wcq-asia' },
  { id: 13, label: 'World Cup Qual. CAF', ingestSlug: 'wcq-africa' },
  { id: 309, label: 'World Cup Qual. OFC', ingestSlug: 'wcq-oceania' },
];

const SEARCH_TERMS = [
  'world-championship-qual-afc',
  'world-championship-qual-caf',
  'world-championship-qual-ofc',
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type SearchEntity = {
  type: string;
  entity: {
    id: number;
    name: string;
    slug?: string;
    category?: { name?: string; slug?: string; sport?: { name?: string; slug?: string } };
  };
};

/** Keep only senior men's football tournaments (drop FIBA, women's, youth, futsal). */
function isSeniorMensFootball(e: SearchEntity['entity']): boolean {
  const sportSlug = e.category?.sport?.slug?.toLowerCase() ?? '';
  if (sportSlug && sportSlug !== 'football') return false;
  const name = `${e.name} ${e.slug ?? ''}`.toLowerCase();
  if (/fiba|basketball|futsal|beach/.test(name)) return false;
  if (/women|u-?\d{2}|under-?\d{2}|youth|girls/.test(name)) return false;
  return true;
}
type SofaSeason = { id: number; year: string; name: string };
type SofaEvent = {
  id: number;
  status?: { type?: string };
  homeTeam?: { name: string };
  awayTeam?: { name: string };
};

async function probeSeasonCoverage(tournamentId: number, seasonId: number) {
  const data = await sofascoreFetch<{ events: SofaEvent[] }>(
    `/unique-tournament/${tournamentId}/season/${seasonId}/events/last/0`
  ).catch(() => ({ events: [] as SofaEvent[] }));
  const finished = (data.events ?? []).filter((e) => e.status?.type === 'finished');
  if (!finished.length) return { finished: 0, playerStats: 0 };
  // Sample up to 3 of the most recent matches — one match may legitimately lack
  // lineups (404), so take the best coverage seen.
  const samples = finished.slice(-3);
  let best = 0;
  for (const sample of samples) {
    try {
      const lineups = await sofascoreFetch<{
        home?: { players?: Array<{ statistics?: Record<string, unknown> }> };
        away?: { players?: Array<{ statistics?: Record<string, unknown> }> };
      }>(`/event/${sample.id}/lineups`);
      const count = (side?: { players?: Array<{ statistics?: Record<string, unknown> }> }) =>
        (side?.players ?? []).filter((p) => p.statistics && Object.keys(p.statistics).length > 0).length;
      best = Math.max(best, count(lineups.home) + count(lineups.away));
      if (best > 0) break;
    } catch {
      // 404 / no lineups for this match — try the next sample.
    }
    await sleep(200);
  }
  return { finished: finished.length, playerStats: best };
}

async function probeKnownTournament(entry: { id: number; label: string; ingestSlug?: string }) {
  console.log(`\n================ [${entry.id}] ${entry.label} ================`);
  if (entry.ingestSlug) console.log(`  ingest via: --competition=${entry.ingestSlug}`);
  type TournamentMeta = {
    name?: string;
    league?: { name?: string };
    category?: { name?: string; sport?: { name?: string } };
  };
  let meta: TournamentMeta | undefined;
  try {
    const data = await sofascoreFetch<{ uniqueTournament?: TournamentMeta } & TournamentMeta>(
      `/unique-tournament/${entry.id}`
    );
    meta = data.uniqueTournament ?? data;
  } catch {
    // metadata optional — id + label are enough to ingest.
  }
  const title = meta?.name ?? meta?.league?.name ?? entry.label;
  const sport = meta?.category?.sport?.name ?? '?';
  console.log(`  ${title} (${meta?.category?.name ?? '?'} / ${sport})`);
  const seasonsRes = await sofascoreFetch<{ seasons: SofaSeason[] }>(
    `/unique-tournament/${entry.id}/seasons`
  ).catch(() => ({ seasons: [] as SofaSeason[] }));
  const seasons = (seasonsRes.seasons ?? []).slice(0, 6);
  console.log(`  seasons: ${seasons.map((s) => `${s.year}(${s.id})`).join(', ') || 'none'}`);
  for (const s of seasons.slice(0, 3)) {
    try {
      const cov = await probeSeasonCoverage(entry.id, s.id);
      const flag = cov.playerStats > 0 ? '✅ player stats' : '❌ no player stats';
      console.log(`    ${s.year} (${s.id}): finished≈${cov.finished} | ${flag} (${cov.playerStats})`);
    } catch (e) {
      console.log(`    ${s.year} (${s.id}): probe failed — ${(e as Error).message}`);
    }
    await sleep(300);
  }
}

async function main() {
  if (!process.env.SCRAPER_API_KEY) {
    throw new Error('SCRAPER_API_KEY missing from .env.local — see lib/sofascoreScraper.ts');
  }
  console.log('================ Known WCQ tournaments (direct ids) ================');
  for (const entry of KNOWN_TOURNAMENTS) {
    await probeKnownTournament(entry);
  }

  const seen = new Set(KNOWN_TOURNAMENTS.map((k) => k.id));
  console.log('\n================ Text search (secondary) ================');
  for (const term of SEARCH_TERMS) {
    console.log(`\n================ search: "${term}" ================`);
    const res = await sofascoreFetch<{ results: SearchEntity[] }>(
      `/search/all?q=${encodeURIComponent(term)}&page=0`
    ).catch((e) => {
      console.warn(`  search failed: ${(e as Error).message}`);
      return { results: [] as SearchEntity[] };
    });
    const tournaments = (res.results ?? []).filter(
      (r) => r.type === 'uniqueTournament' && isSeniorMensFootball(r.entity)
    );
    if (!tournaments.length) {
      console.log('  no senior men\'s football unique tournaments found');
      continue;
    }
    for (const t of tournaments) {
      const id = t.entity.id;
      const sport = t.entity.category?.sport?.name ?? '?';
      console.log(
        `  • [${id}] ${t.entity.name} (${t.entity.category?.name ?? '?'} / ${sport}) — slug=${t.entity.slug ?? ''}`
      );
      if (seen.has(id)) continue;
      seen.add(id);
      const seasonsRes = await sofascoreFetch<{ seasons: SofaSeason[] }>(
        `/unique-tournament/${id}/seasons`
      ).catch(() => ({ seasons: [] as SofaSeason[] }));
      const seasons = (seasonsRes.seasons ?? []).slice(0, 6);
      console.log(`     seasons: ${seasons.map((s) => `${s.year}(${s.id})`).join(', ') || 'none'}`);
      for (const s of seasons.slice(0, 2)) {
        try {
          const cov = await probeSeasonCoverage(id, s.id);
          const flag = cov.playerStats > 0 ? '✅ player stats' : '❌ no player stats';
          console.log(`       ${s.year} (${s.id}): finished≈${cov.finished} | ${flag} (${cov.playerStats})`);
        } catch (e) {
          console.log(`       ${s.year} (${s.id}): probe failed — ${(e as Error).message}`);
        }
        await sleep(300);
      }
    }
  }
}

main().catch((err) => {
  console.error('[sofascore] probe failed:', err);
  process.exitCode = 1;
});
