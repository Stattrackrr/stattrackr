import { tennisIdentityMatch } from '@/lib/tennis/oddsApi';

/** Drop finished tennis matches once they are this far past listed start. */
export const TENNIS_PROPS_LIVE_GRACE_MS = 6 * 60 * 60 * 1000;
/** API-Tennis "Set 1" can appear well before first ball. */
export const TENNIS_ON_COURT_MAX_FUTURE_MS = 2 * 60 * 60 * 1000;
/** Elapsed not-before is not live. Kept as an export so leftover imports compile. */
export const TENNIS_LIVE_AFTER_TIPOFF_MS = Number.POSITIVE_INFINITY;

function tennisTipoffInPlayWindow(
  tipoffMs: number | null | undefined,
  nowMs: number
): boolean {
  if (tipoffMs == null || !Number.isFinite(tipoffMs)) return true;
  if (tipoffMs - nowMs > TENNIS_ON_COURT_MAX_FUTURE_MS) return false;
  if (nowMs - tipoffMs > TENNIS_PROPS_LIVE_GRACE_MS) return false;
  return true;
}

export function tennisStatusLooksOnCourt(status: string): boolean {
  const s = String(status || '').trim().toLowerCase();
  return (
    /^(set\s*)?[1-5]$/.test(s) ||
    s.includes('live') ||
    s.includes('progress') ||
    s.includes('playing')
  );
}

/** Walkovers / retirements / cancellations are done, even when the label has spaces. */
export function tennisFixtureStatusIsTerminal(status: string): boolean {
  const s = String(status || '').trim().toLowerCase();
  const compact = s.replace(/[\s./_-]/g, '');
  if (
    compact === 'cancelled' ||
    compact === 'canceled' ||
    compact === 'walkover' ||
    compact === 'wo' ||
    compact === 'abandoned' ||
    compact === 'abd'
  ) {
    return true;
  }
  return s === 'finished' || s.includes('retir');
}

/** Scheduled not-before times that elapsed this far are not the player's next match. */
export function tennisScheduledTipoffStillCurrent(
  tipoffMs: number | null | undefined,
  nowMs = Date.now()
): boolean {
  if (tipoffMs == null || !Number.isFinite(tipoffMs)) return true;
  return nowMs - tipoffMs <= TENNIS_PROPS_LIVE_GRACE_MS;
}

/** True when API-Tennis says the fixture is on court, inside the play window. */
export function tennisFixtureIsOnCourt(
  status: string,
  tipoffMs: number | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!tennisStatusLooksOnCourt(status)) return false;
  return tennisTipoffInPlayWindow(tipoffMs, nowMs);
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

export type TennisStartColumnKind = 'live' | 'countdown' | 'clock' | 'none';

export type TennisStartColumnState = {
  kind: TennisStartColumnKind;
  tipoffMs: number | null;
};

/** Start column: Not before + clock until on-court live is confirmed. */
export function tennisStartColumnState(opts: {
  tipoffMs?: number | null;
  live?: boolean;
  nowMs?: number;
}): TennisStartColumnState {
  const now = opts.nowMs ?? Date.now();
  const tip = opts.tipoffMs;
  const hasTip = tip != null && Number.isFinite(tip);
  if (opts.live && tennisTipoffInPlayWindow(hasTip ? tip : null, now)) {
    return { kind: 'live', tipoffMs: hasTip ? tip : null };
  }
  if (!hasTip) return { kind: 'none', tipoffMs: null };
  return { kind: 'clock', tipoffMs: tip };
}

export function tennisMatchConfirmedLive(opts: {
  live?: boolean;
  tipoffMs?: number | null;
  nowMs?: number;
}): boolean {
  return tennisStartColumnState(opts).kind === 'live';
}

export function formatTennisStartClock(at: Date, nowMs = Date.now(), locale?: string): string {
  const d = new Date(at.getTime());
  const now = new Date(nowMs);
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString(locale, timeOpts);
  return d.toLocaleString(locale, { weekday: 'short', ...timeOpts });
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
  live?: boolean;
  playerNextGame?: TennisBoardMatch | null;
  nowMs?: number;
  /** Props page: drop matches once they are actually on court. Odds index keeps them. */
  dropConfirmedLive?: boolean;
}): boolean {
  const now = opts.nowMs ?? Date.now();
  const next = opts.playerNextGame || null;
  if (next && !tennisListedMatchupIsPlayersNextGame(opts, next)) return false;
  const tip = next?.tipoff || next?.commenceTime || opts.commenceTime;
  const tipMs = Date.parse(String(tip || ''));
  if (
    opts.dropConfirmedLive &&
    tennisMatchConfirmedLive({
      live: Boolean(opts.live || next?.live),
      tipoffMs: Number.isFinite(tipMs) ? tipMs : null,
      nowMs: now,
    })
  ) {
    return false;
  }
  if (next?.live && !opts.dropConfirmedLive) {
    if (!Number.isFinite(tipMs)) return true;
    return tipMs > now || now - tipMs <= TENNIS_PROPS_LIVE_GRACE_MS;
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
    live?: boolean;
  },
  G extends {
    gameId: string;
    commenceTime?: string | null;
    homeTeam?: string;
    awayTeam?: string;
    live?: boolean;
  },
>(props: T[], games: G[], nowMs = Date.now()) {
  const stillOnPropsPage = (live: boolean | undefined, commenceTime: string | null | undefined) => {
    const tipMs = Date.parse(String(commenceTime || ''));
    if (
      tennisMatchConfirmedLive({
        live: Boolean(live),
        tipoffMs: Number.isFinite(tipMs) ? tipMs : null,
        nowMs,
      })
    ) {
      return false;
    }
    if (!commenceTime) return true;
    return tennisCommenceTimeStillOnBoard(commenceTime, nowMs);
  };
  const gamesFiltered = games.filter((game) => stillOnPropsPage(game.live, game.commenceTime));
  const gameIds = new Set(gamesFiltered.map((game) => game.gameId).filter(Boolean));
  const propsFiltered = props.filter((row) => {
    const tip = row.commenceTime || row.gameDate;
    if (!stillOnPropsPage(row.live, tip)) return false;
    if (row.gameId && gameIds.has(row.gameId)) return true;
    if (!tip) return Boolean(row.gameId && gameIds.size === 0);
    return tennisCommenceTimeStillOnBoard(tip, nowMs);
  });
  return { props: propsFiltered, games: gamesFiltered };
}
