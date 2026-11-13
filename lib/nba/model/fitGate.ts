/**
 * Day-10 unlock (MIN_FIT_DATES): once enough graded nights exist, the residual fit is judged
 * against the market. Positive out-of-fold lift at decision time is the only green light to put
 * fitted coefficients into shadow. Lift that vanishes by close is the latency signature (Part E).
 */

import type { ModelCoefs } from '@/lib/nba/propLog/shadowRules';
import type { LoggedFit } from './fitLines';
import type { Interval } from './residual';

export type FitGate =
  | {
      status: 'insufficient';
      promoteShadow: false;
      lines: number;
      dates: number;
      needLines: number;
      needDates: number;
      readings: string[];
    }
  | {
      status: 'fitted';
      /** True only when decision-time lift over the raw market excludes zero below. */
      promoteShadow: boolean;
      beatsMarket: boolean;
      beatsFittedMarket: boolean;
      /** Decision lift clear, close lift not: news/latency edge rather than a lasting misprice. */
      latencySignature: boolean | null;
      lines: number;
      games: number;
      dates: number;
      liftVsMarket: Interval;
      liftVsFittedMarket: Interval;
      liftAtClose: Interval | null;
      coefs: ModelCoefs;
      readings: string[];
    };

/** Pre-registered promote rule: residual must beat the raw market out of fold, game-clustered. */
export function fitGate(fit: LoggedFit): FitGate {
  if (fit.status === 'insufficient') {
    return {
      status: 'insufficient',
      promoteShadow: false,
      lines: fit.lines,
      dates: fit.dates,
      needLines: fit.needLines,
      needDates: fit.needDates,
      readings: [
        `Need ${fit.needDates} ET dates and ${fit.needLines} graded t2h lines before the residual can be compared to the market (have ${fit.dates} dates, ${fit.lines} lines).`,
      ],
    };
  }

  const beatsMarket = fit.liftVsMarket.lo > 0;
  const beatsFittedMarket = fit.liftVsFittedMarket.lo > 0;
  const close = fit.liftAtClose;
  const latencySignature = close == null ? null : beatsMarket && !(close.lo > 0);

  const readings: string[] = [];
  if (beatsMarket) {
    readings.push(
      `Out-of-fold residual beats the raw market (lift ${fmt(fit.liftVsMarket)}): eligible to put these coefficients into shadow under a new model_version.`
    );
  } else {
    readings.push(
      `Out-of-fold residual does not beat the raw market (lift ${fmt(fit.liftVsMarket)}): keep shadow on v0-market; do not promote.`
    );
  }
  if (beatsFittedMarket) {
    readings.push(`Also beats a fitted market-only baseline (lift ${fmt(fit.liftVsFittedMarket)}).`);
  } else {
    readings.push(`Does not beat a fitted market-only baseline (lift ${fmt(fit.liftVsFittedMarket)}).`);
  }
  if (close) {
    if (latencySignature) {
      readings.push(
        `Latency signature: lift at decision time, none by close (close lift ${fmt(close)}). Edge would have to be captured before tip.`
      );
    } else if (close.lo > 0) {
      readings.push(`Lift still present at close (${fmt(close)}): not a pure latency edge.`);
    } else {
      readings.push(`No lift at close either (${fmt(close)}).`);
    }
  }

  return {
    status: 'fitted',
    promoteShadow: beatsMarket,
    beatsMarket,
    beatsFittedMarket,
    latencySignature,
    lines: fit.lines,
    games: fit.games,
    dates: fit.dates,
    liftVsMarket: fit.liftVsMarket,
    liftVsFittedMarket: fit.liftVsFittedMarket,
    liftAtClose: fit.liftAtClose,
    coefs: fit.coefs,
    readings,
  };
}

function fmt(i: Interval): string {
  return `${i.mean.toFixed(4)} [${i.lo.toFixed(4)}, ${i.hi.toFixed(4)}] over ${i.games} games`;
}
