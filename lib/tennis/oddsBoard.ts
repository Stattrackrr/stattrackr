import { tennisIdentityMatch } from '@/lib/tennis/oddsApi';

/** Drop finished tennis matches once they are this far past listed start. */
export const TENNIS_PROPS_LIVE_GRACE_MS = 6 * 60 * 60 * 1000;
/** API-Tennis "Set 1" can appear well before first ball. */
export const TENNIS_ON_COURT_MAX_FUTURE_MS = 2 * 60 * 60 * 1000;

export function tennisStatusLooksOnCourt(status: string): boolean {
  const s = String(status || '').trim().toLowerCase();
  return (
    /^(set\s*)?[1-5]$/.test(s) ||
    s.includes('live') ||
    s.includes('progress') ||
    s.includes('playing')
  );
}

/** True only when the fixture is actually being played, not when a not-before time has elapsed. */
export function tennisFixtureIsOnCourt(
  status: string,
  tipoffMs: number | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!tennisStatusLooksOnCourt(status)) return false;
  if (tipoffMs == null || !Number.isFinite(tipoffMs)) return true;
  if (tipoffMs - nowMs > TENNIS_ON_COURT_MAX_FUTURE_MS) return false;
  if (nowMs - tipoffMs > TENNIS_PROPS_LIVE_GRACE_MS) return false;
  return true;
}

export type TennisBoardMatch = {
  matchId?: string | null;
  homeName: string;
  awayName: string;
  tipoff?: string | null;
  commenceTime?: string | null;
  live?: boolean;
};

export function tennisPairingMatches(
  aHome: string,
  aAway: string,
  bHome: string,
  bAway: string
): boolean {
  const ah = String(aHome || '').trim();
  const aa = String(aAway || '').trim();
  const bh = String(bHome || '').trim();
  const ba = String(bAway || '').trim();
  if (!ah || !aa || !bh || !ba) return false;
  return (
    (tennisIdentityMatch(ah, bh) && tennisIdentityMatch(aa, ba)) ||
    (tennisIdentityMatch(ah, ba) && tennisIdentityMatch(aa, bh))
  );
}

export function tennisCommenceTimeStillOnBoard(
  commenceTime: string | null | undefined,
  nowMs = Date.now()
): boolean {
  const t = Date.parse(String(commenceTime || ''));
  if (!Number.isFinite(t)) return false;
  return t >= nowMs - TENNIS_PROPS_LIVE_GRACE_MS;
}

export function tennisFindUpcomingForListedMatch<T extends TennisBoardMatch>(
  upcoming: T[],
  listed: { matchId?: string | null; homeName?: string | null; awayName?: string | null }
): T | null {
  const matchId = String(listed.matchId || '').trim();
  const home = String(listed.homeName || '').trim();
  const away = String(listed.awayName || '').trim();
  if (matchId) {
    const byId = upcoming.find((game) => String(game.matchId || '').trim() === matchId);
    if (byId) return byId;
  }
  if (home && away) {
    const same = upcoming.find((game) => tennisPairingMatches(game.homeName, game.awayName, home, away));
    if (same) return same;
    const involving = upcoming.find((game) => {
      const names = [game.homeName, game.awayName];
      return names.some((name) => tennisIdentityMatch(name, home) || tennisIdentityMatch(name, away));
    });
    if (involving) return involving;
  }
  return null;
}

export function tennisListedMatchupIsPlayersNextGame(
  listed: { matchId?: string | null; homeName?: string | null; awayName?: string | null },
  next: TennisBoardMatch | null | undefined
): boolean {
  if (!next) return false;
  const listedId = String(listed.matchId || '').trim();
  const nextId = String(next.matchId || '').trim();
  if (listedId && nextId && listedId === nextId) return true;
  const home = String(listed.homeName || '').trim();
  const away = String(listed.awayName || '').trim();
  if (!home || !away) return false;
  return tennisPairingMatches(home, away, next.homeName, next.awayName);
}

/** Keep a snapshot only if it is this player's current match, or it has not finished. */
export function tennisOddsMatchStillOnBoard(opts: {
  homeName?: string | null;
  awayName?: string | null;
  matchId?: string | null;
  commenceTime?: string | null;
  playerNextGame?: TennisBoardMatch | null;
  nowMs?: number;
}): boolean {
  const now = opts.nowMs ?? Date.now();
  const next = opts.playerNextGame || null;
  if (next && !tennisListedMatchupIsPlayersNextGame(opts, next)) return false;
  const tip = next?.tipoff || next?.commenceTime || opts.commenceTime;
  if (next?.live) {
    const t = Date.parse(String(tip || ''));
    if (!Number.isFinite(t)) return true;
    return t > now || now - t <= TENNIS_PROPS_LIVE_GRACE_MS;
  }
  return tennisCommenceTimeStillOnBoard(tip, now);
}

export function applyLiveTennisPropsCutoff<
  T extends {
    gameId?: string | null;
    homeTeam?: string | null;
    awayTeam?: string | null;
    commenceTime?: string | null;
    gameDate?: string | null;
  },
  G extends { gameId: string; commenceTime?: string | null; homeTeam?: string; awayTeam?: string },
>(props: T[], games: G[], nowMs = Date.now()) {
  const gamesFiltered = games.filter((game) => {
    if (!game.commenceTime) return true;
    return tennisCommenceTimeStillOnBoard(game.commenceTime, nowMs);
  });
  const gameIds = new Set(gamesFiltered.map((game) => game.gameId).filter(Boolean));
  const propsFiltered = props.filter((row) => {
    if (row.gameId && gameIds.has(row.gameId)) return true;
    const tip = row.commenceTime || row.gameDate;
    if (!tip) return Boolean(row.gameId && gameIds.size === 0);
    return tennisCommenceTimeStillOnBoard(tip, nowMs);
  });
  return { props: propsFiltered, games: gamesFiltered };
}
