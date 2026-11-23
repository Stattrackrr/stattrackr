/**
 * Ensure every odds-api.net singles match with AU prices in the next 48h is either:
 * - paired to an API-Tennis refresh target, or
 * - ingested as an oddsnet orphan on the board.
 *
 * Usage: npx tsx scripts/audit-tennis-oddsnet-coverage.ts
 * Exit 1 when any priced singles match would still be missing from the board.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import fs from 'fs';
import {
  fetchTennisOddsApiNetBoard,
  fetchTennisOddsNetSnapshot,
  listTennisOddsNetEvents,
  tennisOddsNetEventCoveredByGames,
  tennisOddsNetMatchId,
} from '@/lib/tennis/oddsApiNet';
import { pickRefreshTargets } from '@/lib/tennis/odds';
import {
  listUniqueUpcomingTennisGames,
  warmTennisUpcomingFixtures,
} from '@/lib/tennis/nextGame';
import { tennisDisplayName } from '@/lib/tennis/extraBooks/shared';

const ORPHAN_AHEAD_MS = 48 * 60 * 60 * 1000;
const LOOKBACK_MS = 60 * 60 * 1000;

function isSingles(ev: { home_team?: string; away_team?: string }): boolean {
  const home = String(ev.home_team || '');
  const away = String(ev.away_team || '');
  return Boolean(home && away && !/\//.test(home) && !/\//.test(away));
}

function inWindow(ev: { start_time?: number; event_state?: string }, now: number): boolean {
  if (String(ev.event_state || '').toLowerCase() === 'finished') return false;
  const startMs = typeof ev.start_time === 'number' ? ev.start_time * 1000 : NaN;
  if (!Number.isFinite(startMs)) return false;
  return startMs >= now - LOOKBACK_MS && startMs <= now + ORPHAN_AHEAD_MS;
}

async function gamesFromProdProps(): Promise<import('@/lib/tennis/nextGame').TennisNextGame[]> {
  try {
    const res = await fetch('https://www.stattrackr.co/api/tennis/player-props/list', {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      games?: Array<{
        gameId?: string;
        homeTeam?: string;
        awayTeam?: string;
        commenceTime?: string;
        tournamentName?: string | null;
        homeTeamCode?: string;
      }>;
    };
    return (j.games || []).map((g) => ({
      opponent: String(g.awayTeam || ''),
      opponentId: null,
      opponentIoc: null,
      opponentRank: null,
      opponentLogo: null,
      tipoff: g.commenceTime || null,
      live: false,
      isGrandSlam: false,
      tour: String(g.homeTeamCode || '').toUpperCase() === 'WTA' ? 'WTA' : 'ATP',
      tournamentName: g.tournamentName || null,
      tournamentKey: null,
      surface: null,
      round: null,
      matchId: String(g.gameId || ''),
      status: null,
      playerIsHome: true,
      homeName: String(g.homeTeam || ''),
      awayName: String(g.awayTeam || ''),
      playerSeed: null,
      opponentSeed: null,
      topSeedName: null,
      topSeedId: null,
      eventType: /challenger/i.test(String(g.tournamentName || ''))
        ? 'Challenger Men Singles'
        : 'Atp Singles',
    }));
  } catch {
    return [];
  }
}

async function main() {
  console.log('Warming API-Tennis upcoming…');
  await warmTennisUpcomingFixtures({ force: true });
  let upcoming = await listUniqueUpcomingTennisGames({ waitForFresh: false });
  if (!upcoming.length) {
    console.log('Local upcoming empty — seeding slate from production props games…');
    upcoming = await gamesFromProdProps();
  }
  const targets = pickRefreshTargets(upcoming);
  console.log(`Upcoming ${upcoming.length}, refresh targets ${targets.length}`);

  const stats = { matches: 0, rowCapHits: [] as string[] };
  console.log('Building odds-api.net board (matched + orphans)…');
  const board = await fetchTennisOddsApiNetBoard(targets, stats);

  const coveredMatchIds = new Set(board.rows.keys());
  const orphanIds = new Set(board.orphans.map((o) => o.eventId));
  const orphanPairings = board.orphans.map((o) => ({
    eventId: o.eventId,
    matchId: o.game.matchId,
    home: o.game.homeName,
    away: o.game.awayName,
    tip: o.game.tipoff,
    books: o.books.length,
  }));

  console.log('Listing all odds-api.net tennis events…');
  const allEvents = await listTennisOddsNetEvents();
  const now = Date.now();
  const windowSingles = allEvents.filter((ev) => isSingles(ev) && inWindow(ev, now));

  const gaps: Array<{
    eventId: string;
    home: string;
    away: string;
    start: string | null;
    reason: string;
  }> = [];

  // Candidate gaps: in window, not covered by upcoming pairing, not already an orphan.
  const candidates = windowSingles.filter((ev) => {
    const eventId = String(ev.event_id ?? '').trim();
    if (!eventId) return false;
    if (orphanIds.has(eventId)) return false;
    if (coveredMatchIds.has(tennisOddsNetMatchId(eventId))) return false;
    if (tennisOddsNetEventCoveredByGames(ev, targets)) return false;
    if (tennisOddsNetEventCoveredByGames(ev, upcoming)) return false;
    return true;
  });

  console.log(
    `Window singles ${windowSingles.length}, board rows ${coveredMatchIds.size}, orphans ${board.orphans.length}, unchecked candidates ${candidates.length}`
  );

  // Price-check candidates (only those not already covered) — empty books = not a real gap.
  for (let i = 0; i < candidates.length; i += 1) {
    const ev = candidates[i]!;
    const eventId = String(ev.event_id);
    process.stdout.write(`\rPricing candidates ${i + 1}/${candidates.length}…`);
    const snap = await fetchTennisOddsNetSnapshot(ev);
    const hasAu = snap.sources.some((s) =>
      /sportsbet|tab|ladbrokes|pointsbet|dabble|bet365|neds|betright|unibet|playup|palmerbet/.test(
        s.book.toLowerCase()
      )
    );
    const hasLines = snap.sources.some(
      (s) =>
        s.source.totals.length > 0 ||
        s.source.handicaps.length > 0 ||
        Boolean(s.source.h2h?.home && s.source.h2h?.away)
    );
    if (!hasAu || !hasLines) continue;
    gaps.push({
      eventId,
      home: tennisDisplayName(String(ev.home_team || '')),
      away: tennisDisplayName(String(ev.away_team || '')),
      start:
        typeof ev.start_time === 'number' ? new Date(ev.start_time * 1000).toISOString() : null,
      reason: 'priced on odds-api.net but not matched and not orphaned',
    });
  }
  process.stdout.write('\n');

  const della = [...orphanPairings, ...gaps].filter((row) =>
    /della|dellavedova|jesse delaney/i.test(`${(row as any).home} ${(row as any).away}`)
  );

  const out = {
    ok: gaps.length === 0,
    upcoming: upcoming.length,
    targets: targets.length,
    boardRows: coveredMatchIds.size,
    orphans: orphanPairings.length,
    windowSingles: windowSingles.length,
    gaps,
    orphanSample: orphanPairings.slice(0, 20),
    dellaCheck: {
      onOrphans: orphanPairings.filter((o) =>
        /dellavedova|jesse delaney/i.test(`${o.home} ${o.away}`)
      ),
      inGaps: gaps.filter((g) => /dellavedova|jesse delaney/i.test(`${g.home} ${g.away}`)),
    },
    stats,
  };
  fs.writeFileSync('tmp-tennis-oddsnet-coverage.json', JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: out.ok,
        upcoming: out.upcoming,
        targets: out.targets,
        boardRows: out.boardRows,
        orphans: out.orphans,
        windowSingles: out.windowSingles,
        gapCount: gaps.length,
        gaps: gaps.slice(0, 30),
        dellaCheck: out.dellaCheck,
      },
      null,
      2
    )
  );
  if (gaps.length) {
    console.error(`\nFAIL: ${gaps.length} priced singles still missing from the board path.`);
    process.exit(1);
  }
  console.log('\nPASS: every priced odds-api.net singles match in-window is matched or orphaned.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
