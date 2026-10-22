/** Predicted lineups card payload (client-safe). */

export type NbaPredictedPlayer = {
  name: string;
  /** PG, SG, SF, PF, C (bench rows may be G / F). */
  position: string;
  playerId: string | null;
  imageUrl: string | null;
  /** Injury status such as Out, Questionable, Doubtful, Probable, Game-time decision. */
  status: string | null;
  /** Chance to play: 100, 75, 50, 25 or 0. */
  playPct: number | null;
};

export type NbaPredictedTeam = {
  code: string;
  name: string;
  confirmed: boolean;
  starters: NbaPredictedPlayer[];
  mayNotPlay: NbaPredictedPlayer[];
};

export type NbaPredictedLineupsPayload = {
  tipAt: string | null;
  /** When this lineup last changed. */
  updatedAt: string | null;
  /** When the lineup was last checked. */
  checkedAt: string | null;
  away: NbaPredictedTeam;
  home: NbaPredictedTeam;
};
