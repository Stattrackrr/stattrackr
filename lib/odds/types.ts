// Types for odds and line derivation logic

export type BookmakerId = 'fanduel' | 'draftkings' | 'betmgm' | 'fanatics' | string;

export type MarketKey = string; // e.g., 'player_points', 'player_rebounds'

export type AmericanOdds = number; // e.g., -110, +120

export interface OddsSnapshot {
  // Identifiers
  bookmaker: BookmakerId;
  market: MarketKey;

  // Line value at a specific time (e.g., 25.5)
  line: number;

  // Optional odds attached to this line at that time
  overOdds?: AmericanOdds;
  underOdds?: AmericanOdds;

  // Unix epoch milliseconds when this snapshot was observed
  timestamp: number;
}

export type MovementDirection = 'up' | 'down' | 'flat' | null;

export interface OpeningCurrentMovement {
  openingLine: number | null;
  openingAt: number | null; // epoch ms
  currentLine: number | null;
  currentAt: number | null; // epoch ms
  movement: number | null; // current - opening (positive => up)
  direction: MovementDirection;
}

export type BookmakerLines = Record<BookmakerId, OpeningCurrentMovement>;

export type MetricLines = Record<string, OpeningCurrentMovement>;