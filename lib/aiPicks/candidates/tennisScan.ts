import { DEFAULT_AI_PICKS_PARAMS, type AiTennisParams } from '@/lib/aiPicks/params';
import { buildTennisCandidates, type TennisMatchRef } from '@/lib/aiPicks/candidates/tennis';
import type { AiCandidate } from '@/lib/aiPicks/candidates/types';
import { tennisContext, tennisPlayerEvidence } from '@/lib/aiPicks/model/tennisContext';
import { inferBestOfFromOdds } from '@/lib/tennis/askOdds';
import { readTennisPlayerLogsCacheMany } from '@/lib/tennis/dashboardCache';
import { readUpcomingTennisByPlayerCache, type TennisNextGame } from '@/lib/tennis/nextGame';
import { listTennisOddsIndex, readTennisOddsSnapshot, type TennisOddsSnapshot } from '@/lib/tennis/odds';
import { tennisNamesMatch } from '@/lib/tennis/oddsApi';
import { tennisBooksWithBet365Au } from '@/lib/tennis/oddsApiNet';
import { tennisFixtureStatusIsTerminal } from '@/lib/tennis/oddsBoard';
import type { TennisTour } from '@/lib/tennis/types';
import { historyFromRows } from '@/lib/tennisAi/live';
import { buildMatchPack } from '@/lib/tennisAi/pack';

export type TennisScanResult = {
  candidates: AiCandidate[];
  matches: Array<{ eventLabel: string; startsAt: string; books: number; candidates: number; skipped?: string }>;
};

type Fixture = { next: TennisNextGame; homeId: string | null; awayId: string | null };

/** One row per match from the per-player upcoming map. */
function fixturesByMatch(byPlayer: Map<string, TennisNextGame>): Fixture[] {
  const out = new Map<string, Fixture>();
  for (const [playerId, next] of byPlayer) {
    // The map also indexes each player under a `name:` alias.
    if (!next.matchId || playerId.startsWith('name:')) continue;
    const row = out.get(next.matchId) ?? { next, homeId: null, awayId: null };
    if (next.playerIsHome) row.homeId = playerId;
    else row.awayId = playerId;
    if (!row.homeId && next.opponentId && !next.playerIsHome) row.homeId = next.opponentId;
    if (!row.awayId && next.opponentId && next.playerIsHome) row.awayId = next.opponentId;
    out.set(next.matchId, row);
  }
  return [...out.values()];
}

async function snapshotFor(fx: Fixture, indexCache: { list: Awaited<ReturnType<typeof listTennisOddsIndex>> | null }): Promise<TennisOddsSnapshot | null> {
  const direct = await readTennisOddsSnapshot(String(fx.next.matchId));
  if (direct) return direct;
  indexCache.list ??= await listTennisOddsIndex();
  const tip = Date.parse(String(fx.next.tipoff || ''));
  const hit = indexCache.list.find((m) => {
    const names =
      (tennisNamesMatch(m.homeName, fx.next.homeName) && tennisNamesMatch(m.awayName, fx.next.awayName)) ||
      (tennisNamesMatch(m.homeName, fx.next.awayName) && tennisNamesMatch(m.awayName, fx.next.homeName));
    const t = Date.parse(String(m.commenceTime || ''));
    return names && (!Number.isFinite(tip) || !Number.isFinite(t) || Math.abs(t - tip) <= 3 * 60 * 60 * 1000);
  });
  return hit ? readTennisOddsSnapshot(hit.matchId) : null;
}

export async function scanTennisCandidates(opts: { nowMs?: number; horizonMs?: number; params?: AiTennisParams }): Promise<TennisScanResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const horizonMs = opts.horizonMs ?? 24 * 60 * 60 * 1000;
  const params = opts.params ?? DEFAULT_AI_PICKS_PARAMS.tennis;
  const result: TennisScanResult = { candidates: [], matches: [] };

  const { byPlayerId: byPlayer } = await readUpcomingTennisByPlayerCache();
  const fixtures = fixturesByMatch(byPlayer).filter((fx) => {
    const t = Date.parse(String(fx.next.tipoff || ''));
    if (!Number.isFinite(t) || t <= nowMs + 5 * 60_000 || t > nowMs + horizonMs) return false;
    if (fx.next.live || tennisFixtureStatusIsTerminal(fx.next.status || '')) return false;
    return !fx.next.homeName.includes('/') && !fx.next.awayName.includes('/');
  });

  const indexCache: { list: Awaited<ReturnType<typeof listTennisOddsIndex>> | null } = { list: null };
  for (const fx of fixtures) {
    const label = `${fx.next.homeName} vs ${fx.next.awayName}`;
    const startsAt = new Date(Date.parse(String(fx.next.tipoff))).toISOString();
    if (!fx.homeId || !fx.awayId) {
      result.matches.push({ eventLabel: label, startsAt, books: 0, candidates: 0, skipped: 'Missing a player id' });
      continue;
    }
    const snap = await snapshotFor(fx, indexCache);
    if (!snap?.bookmakers?.length) {
      result.matches.push({ eventLabel: label, startsAt, books: 0, candidates: 0, skipped: 'No odds stored' });
      continue;
    }
    // Snapshot books are oriented to the snapshot's home name; align ids with it.
    const flipped = tennisNamesMatch(snap.homeName, fx.next.awayName) && !tennisNamesMatch(snap.homeName, fx.next.homeName);
    const homeId = flipped ? fx.awayId : fx.homeId;
    const awayId = flipped ? fx.homeId : fx.awayId;
    const homeName = flipped ? fx.next.awayName : fx.next.homeName;
    const awayName = flipped ? fx.next.homeName : fx.next.awayName;

    const logs = await readTennisPlayerLogsCacheMany([homeId, awayId]);
    const homeLogs = logs.get(homeId) ?? [];
    const awayLogs = logs.get(awayId) ?? [];
    const tour = (fx.next.tour || homeLogs.at(-1)?.tour || 'ATP') as TennisTour;
    const surface = fx.next.surface || homeLogs.at(-1)?.surface || 'Hard';
    const bestOf = inferBestOfFromOdds(fx.next.isGrandSlam && tour === 'ATP' ? 5 : 3, {
      matchId: snap.matchId,
      homeTeam: homeName,
      awayTeam: awayName,
      bookmakers: snap.bookmakers,
    });
    const asOf = new Date(nowMs).toISOString();
    const history = historyFromRows([...homeLogs, ...awayLogs], tour);
    const pack = buildMatchPack({
      asOf,
      tour,
      surface,
      bestOf,
      playerId: homeId,
      opponentId: awayId,
      history,
      markets: [],
      sims: 8000,
      seed: 7,
    });
    const context = tennisContext({
      history,
      features: pack.features,
      homeId,
      awayId,
      baseSim: pack.sim,
      strength: params.contextStrength,
      sims: 8000,
      seed: 7,
    });
    const evidence = {
      home: tennisPlayerEvidence(homeLogs.filter((r) => r.playerId === homeId), { surface, asOf, opponentHand: pack.features.opponent.hand }),
      away: tennisPlayerEvidence(awayLogs.filter((r) => r.playerId === awayId), { surface, asOf, opponentHand: pack.features.player.hand }),
    };
    const match: TennisMatchRef = {
      matchId: String(fx.next.matchId),
      homeId,
      awayId,
      homeName,
      awayName,
      startsAt,
      surface,
      bestOf,
      tournament: fx.next.tournamentName,
    };
    const books = tennisBooksWithBet365Au(snap.bookmakers, snap.bet365Au);
    const built = buildTennisCandidates({
      match,
      books,
      sim: pack.sim,
      features: pack.features,
      logs: { home: homeLogs, away: awayLogs },
      params,
      anchor: { sims: 8000, seed: 7 },
      context,
      evidence,
    });
    result.candidates.push(...built);
    result.matches.push({ eventLabel: label, startsAt, books: books.length, candidates: built.length });
  }
  return result;
}
