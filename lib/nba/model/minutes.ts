/**
 * Expected minutes with and without tonight's information (agreed build spec, Part D feature 1).
 *
 *   without: his recent minutes (current season first, the same 3-game memory the projection uses);
 *   with:    that, moved by what is known about tonight: starting when he has been coming off the bench
 *            (or the reverse), games since a return from a layoff, a back to back, blowout risk from the
 *            spread, and the minutes of rotation teammates who are out.
 *
 * The difference is "minutes_new_info"; in stat units over the stat's spread it is the model feature.
 * Coefficients come from scripts/_fit-minutes.ts on last season's box scores and lineups.
 */

export type MinutesGame = { date: string; minutes: number; started: boolean | null };

export type MinutesTonight = {
  /** Starting tonight (RotoWire predicted or confirmed); null when unknown. */
  startsTonight: boolean | null;
  /** Games played since coming back from 3+ missed team games (0 = tonight is the first game back); null = none. */
  gamesSinceReturn: number | null;
  backToBack: boolean;
  /** |spread| from the market (or the ratings margin in history); null when unknown. */
  absSpread: number | null;
  /** Average minutes of rotation teammates who are out tonight but played recently. */
  teammateMinutesOut: number;
};

export type MinutesCoefs = {
  /** Multipliers on his recent minutes. */
  promoted: number;
  demoted: number;
  /** First, second and third game back from a layoff. */
  returnGame: [number, number, number];
  backToBack: number;
  /** Share of minutes lost per point of spread beyond BLOWOUT_FROM, for heavy-minute players. */
  blowoutPerPoint: number;
  /** Extra minutes per minute of absent rotation teammates, scaled by his share of team minutes. */
  teammate: number;
};

/**
 * Fitted on 2025-26 regular-season games, Nov to Jan (22.9k player-games with lineups), each game seen
 * only through earlier games; tested Feb to Apr: minutes error 6.45 -> 6.11 overall, 10.30 -> 8.13 for
 * players promoted to the starting five, 7.04 -> 5.72 for those moved to the bench. Starting tonight was
 * the confirmed lineup there; live it is RotoWire's predicted or confirmed lineup. Back to backs barely
 * matter once minutes are recent-weighted.
 */
export const FITTED_MINUTES_COEFS: MinutesCoefs = {
  promoted: 1.238,
  demoted: 0.843,
  returnGame: [0.925, 1.019, 1.085],
  backToBack: 1.006,
  blowoutPerPoint: 0.006,
  teammate: 0.212,
};

/** No adjustment at all: the "without tonight's information" estimate, and the start point for fitting. */
export const NEUTRAL_MINUTES_COEFS: MinutesCoefs = {
  promoted: 1,
  demoted: 1,
  returnGame: [1, 1, 1],
  backToBack: 1,
  blowoutPerPoint: 0,
  teammate: 0,
};

export const BLOWOUT_FROM = 6;
export const HEAVY_MINUTES = 28;
const HALF_LIFE = 3;
const TEAM_MINUTES = 240;

/** His recent minutes: last 10 games played (newest last), weight halving every 3 games. */
export function baseMinutes(games: MinutesGame[]): number | null {
  const recent = games.filter((g) => g.minutes > 0).slice(-10);
  if (!recent.length) return null;
  let w = 0;
  let s = 0;
  for (let i = recent.length - 1, back = 0; i >= 0; i -= 1, back += 1) {
    const k = Math.pow(0.5, back / HALF_LIFE);
    w += k;
    s += k * recent[i]!.minutes;
  }
  return s / w;
}

/** Share of his last `n` games he started (null when no starter data). */
export function startedShare(games: MinutesGame[], n = 5): number | null {
  const known = games.filter((g) => g.minutes > 0 && g.started != null).slice(-n);
  return known.length ? known.filter((g) => g.started).length / known.length : null;
}

export type MinutesEstimate = { base: number; tonight: number; parts: Record<string, number> };

export function tonightMinutes(games: MinutesGame[], t: MinutesTonight, c: MinutesCoefs): MinutesEstimate | null {
  const base = baseMinutes(games);
  if (base == null) return null;
  const parts: Record<string, number> = {};
  let m = base;
  const share = startedShare(games);
  if (t.startsTonight === true && share != null && share < 0.5) parts.starter = c.promoted;
  if (t.startsTonight === false && share != null && share >= 0.5) parts.starter = c.demoted;
  if (t.gamesSinceReturn != null && t.gamesSinceReturn >= 0 && t.gamesSinceReturn <= 2) parts.return = c.returnGame[t.gamesSinceReturn]!;
  if (t.backToBack) parts.backToBack = c.backToBack;
  if (t.absSpread != null && base >= HEAVY_MINUTES && t.absSpread > BLOWOUT_FROM) parts.blowout = Math.max(0.7, 1 - c.blowoutPerPoint * (t.absSpread - BLOWOUT_FROM));
  for (const f of Object.values(parts)) m *= f;
  if (t.teammateMinutesOut > 0) {
    const add = c.teammate * t.teammateMinutesOut * (base / TEAM_MINUTES);
    parts.teammatesOut = add;
    m += add;
  }
  return { base, tonight: Math.min(44, Math.max(0, m)), parts };
}

/**
 * The model feature: the expected change in the stat from tonight's minutes, over the stat's spread.
 * `rate` is his stat per minute and `sd` the spread of the stat at his usual minutes.
 */
export function minutesNewInfoZ(est: MinutesEstimate, rate: number, sd: number): number {
  return sd > 0 ? ((est.tonight - est.base) * rate) / sd : 0;
}
