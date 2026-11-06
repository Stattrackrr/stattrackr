/** Shared types for the Betting Tools board (arb / middles / EV / bonus flipper). */

export type ToolsSport = 'tennis' | 'nbl' | 'nba';
export type ToolsKind = 'arb' | 'middles' | 'ev' | 'bonus';

export type ToolsLeg = {
  book: string;
  bookKey: string;
  selection: string;
  odds: number;
  stake?: number;
  line?: string | null;
  /** Per-book EV fraction when several softs share one market card. */
  edge?: number;
};

export type ToolsOpportunity = {
  id: string;
  kind: Exclude<ToolsKind, 'bonus'>;
  sport: ToolsSport;
  league: string;
  match: string;
  home: string;
  away: string;
  homeImageUrl: string | null;
  awayImageUrl: string | null;
  /** Player prop subject — when set, UI shows this headshot instead of team logos. */
  subjectName?: string | null;
  subjectImageUrl?: string | null;
  market: string;
  startMs: number;
  edgeLabel: string;
  /** Fraction: 0.024 = +2.4%. Middles may be 0 when the edge is the window. */
  edge: number;
  note: string;
  legs: ToolsLeg[];
  /** EV only: raw sharp prices on this side (Pinnacle / Betfair). */
  sharp?: Array<{ book: string; bookKey: string; odds: number }>;
  /** EV only: de-vigged fair decimal for this side. */
  fairOdds?: number;
  /** Middles only: $100 total stake framing. */
  middleRisk?: number;
  middleCollect?: number;
  /** Middles only: window width in points/games. */
  middleWidth?: number;
  /** Middles only: crude hit probability from window vs miss mass. */
  middleHitProb?: number;
  /** Middles only: expected $ on $100 (hit% × profit − miss% × risk). */
  middleExpected?: number;
};

export type ToolsBonusFlip = {
  id: string;
  /** May be tennis/nba/nbl or a live bonus sport slug (nfl, soccer, ufc, …). */
  sport: string;
  league: string;
  match: string;
  home: string;
  away: string;
  homeImageUrl: string | null;
  awayImageUrl: string | null;
  subjectName?: string | null;
  subjectImageUrl?: string | null;
  market: string;
  startMs: number;
  convertLabel: string;
  /** Cash locked after hedge (bonus stake not returned). */
  cashOut: number;
  retention: number;
  bonusLeg: ToolsLeg;
  hedgeLeg: ToolsLeg;
};

export type ToolsScanMeta = {
  scannedEvents: number;
  scannedAt: string;
  sports: ToolsSport[];
  truncated?: boolean;
  /** Where game-line odds came from for this scan. */
  oddsSource?: { board: ToolsSport[]; live: ToolsSport[] };
  /** Human hint when the scan returned nothing useful (e.g. bonus book missing from board). */
  note?: string;
  /** Bonus Flip warm-board footprint — what we priced this Find (cache only). */
  bonusCoverage?: {
    sports: string[];
    liveEvents: number;
    listedEvents: number;
    leagues: number;
    flips: number;
    bestRetention: number | null;
    /** True when warm board missing or older than serve window — no live pull. */
    stale?: boolean;
    /** Warm board age at scan time (ms). */
    ageMs?: number;
    /** Warm board write timestamp — used to key flip cache. */
    warmAt?: number;
  };
};
