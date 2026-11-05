/**
 * Turn odds-api.net snapshot items into two-way market maps for tools scans.
 * Keys are stable across books; outcomes are home/away or over/under.
 */

import { canonBook, TOOLS_BOOK_SET } from './books';
import { isHalfLine } from './math';
import type { ToolsSport } from './types';

export type OddsNetItem = {
  bookmaker?: string;
  bet_type?: string;
  metric?: string;
  period?: string;
  side?: string;
  line?: string | number;
  odds?: number;
  is_available?: boolean;
  player_name?: string;
  market_key?: string;
};

/** outcome -> book -> best decimal odds */
export type OutcomeBooks = Map<string, Map<string, number>>;
/** marketKey -> OutcomeBooks */
export type MarketMap = Map<string, OutcomeBooks>;

export type ParsedMarketMeta = {
  label: string;
  family: 'moneyline' | 'handicap' | 'total' | 'team_total' | 'player_prop';
  /** For handicap: home-oriented line. For totals: the total line. */
  line: number | null;
  period: string;
  /** Full player name for player_prop / tennis player-total markets. */
  playerName?: string | null;
  metric?: string;
  /** home/away for team / player totals. */
  side?: 'home' | 'away' | null;
  /** Over 0.5 sets won → Yes/No on the card instead of Over/Under. */
  winASet?: boolean;
};

function metricKind(metric: string): 'games' | 'sets' | 'points' | 'other' {
  const m = String(metric || '').toLowerCase();
  if (!m || m === 'points') return 'points';
  if (m === 'games' || /\bgames?\b/.test(m)) return 'games';
  if (m === 'sets' || /\bsets?\b/.test(m)) return 'sets';
  return 'other';
}

function totalMarketLabel(metric: string, line: number): string {
  const kind = metricKind(metric);
  if (kind === 'games') return `Total games ${line}`;
  if (kind === 'sets') return `Total sets ${line}`;
  if (kind === 'points') return `Total ${line}`;
  const pretty = String(metric || 'Total')
    .replace(/[_/]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return `${pretty} ${line}`;
}

function handicapMarketLabel(metric: string, homeLine: number): string {
  const signed = homeLine > 0 ? `+${homeLine}` : String(homeLine);
  const kind = metricKind(metric);
  if (kind === 'games') return `Game handicap ${signed}`;
  if (kind === 'sets') return `Set handicap ${signed}`;
  return `Handicap ${signed}`;
}

function teamTotalMarketLabel(
  metric: string,
  line: number,
  side: 'home' | 'away',
  home: string,
  away: string
): { label: string; playerName: string | null; winASet: boolean } {
  const who = (side === 'home' ? home : away).trim() || (side === 'home' ? 'Home' : 'Away');
  const kind = metricKind(metric);
  if (kind === 'sets' && line === 0.5) {
    return { label: `${who} to win a set`, playerName: who, winASet: true };
  }
  if (kind === 'sets') return { label: `${who} sets won ${line}`, playerName: who, winASet: false };
  if (kind === 'games') return { label: `${who} games won ${line}`, playerName: who, winASet: false };
  // Basketball team totals stay on the match card (not a player subject).
  return { label: `${who} total ${line}`, playerName: null, winASet: false };
}

const PROP_METRIC_LABEL: Record<string, string> = {
  points: 'Points',
  rebounds: 'Rebounds',
  assists: 'Assists',
  threes: 'Threes',
  threemade: 'Threes',
  'three made': 'Threes',
  steals: 'Steals',
  blocks: 'Blocks',
  turnovers: 'Turnovers',
  pra: 'PRA',
  pr: 'PR',
  pa: 'PA',
  ra: 'RA',
  dd: 'Double-double',
  td: 'Triple-double',
};

function prettyPlayerName(raw: string): string {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length === 1 ? `${w.toUpperCase()}.` : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');
}

function playerPropLabel(playerName: string, metric: string, line: number): string {
  const who = prettyPlayerName(playerName) || 'Player';
  const what = PROP_METRIC_LABEL[metric.toLowerCase()] || metric || 'Prop';
  return `${who} ${what} ${line}`;
}

const DRAW_SPORTS = new Set(['soccer', 'aussie rules', 'rugby league', 'rugby union', 'cricket']);

function halfOk(line: number): boolean {
  return isHalfLine(line);
}

/**
 * Build two-way markets from a snapshot. Skips three-ways and non-half lines (push risk).
 * Game lines only by default (player props off — noisier names / more credits).
 */
export function buildMarketMap(
  items: OddsNetItem[],
  opts: {
    sportApi: string;
    includePlayerProps?: boolean;
    home?: string;
    away?: string;
  } = { sportApi: 'basketball' }
): { markets: MarketMap; meta: Map<string, ParsedMarketMeta>; threeWay: Set<string> } {
  const markets: MarketMap = new Map();
  const meta = new Map<string, ParsedMarketMeta>();
  const threeWay = new Set<string>();
  const includeProps = opts.includePlayerProps === true;
  const homeName = String(opts.home || '').trim();
  const awayName = String(opts.away || '').trim();

  const put = (key: string, outcome: string, book: string, odds: number, m: ParsedMarketMeta) => {
    if (!TOOLS_BOOK_SET.has(book)) return;
    const byOutcome = markets.get(key) ?? new Map<string, Map<string, number>>();
    const byBook = byOutcome.get(outcome) ?? new Map<string, number>();
    byBook.set(book, Math.max(byBook.get(book) ?? 0, odds));
    byOutcome.set(outcome, byBook);
    markets.set(key, byOutcome);
    if (!meta.has(key)) meta.set(key, m);
  };

  for (const it of items) {
    if (it.is_available === false) continue;
    const odds = Number(it.odds);
    if (!(odds > 1)) continue;
    const book = canonBook(it.bookmaker);
    if (!book) continue;
    const side = String(it.side || '').toLowerCase();
    const period = String(it.period || 'full time').toLowerCase();
    const rawLine = String(it.line ?? '')
      .toLowerCase()
      .trim();
    const ouMatch = rawLine.match(/^(over|under)\s+([+-]?\d+(?:\.\d+)?)$/);
    const bet = String(it.bet_type || '').toLowerCase();
    const metric = String(it.metric || '').toLowerCase();
    const fullPlayerName = String(it.player_name ?? '').trim();
    const words = fullPlayerName
      .toLowerCase()
      .replace(/[^a-z\s'-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    // Compact key so "Bam Adebayo" / "B Adebayo" collide; label keeps the fuller name.
    const playerKey = words.length >= 2 ? `${words[0]![0]} ${words.slice(1).join(' ')}` : words.join(' ');
    const base = `${bet}|${metric}|${period}|${playerKey}`;

    if (bet === 'moneyline') {
      if (side === 'draw') threeWay.add(base);
      if ((side !== 'home' && side !== 'away') || period !== 'full time') continue;
      if (DRAW_SPORTS.has(opts.sportApi)) continue;
      put(base, side, book, odds, {
        label: 'Match Winner',
        family: 'moneyline',
        line: null,
        period,
        metric,
      });
      continue;
    }

    if (bet === 'handicap' && (side === 'home' || side === 'away')) {
      const line = Number.parseFloat(rawLine);
      if (!Number.isFinite(line) || !halfOk(line)) continue;
      const homeLine = side === 'home' ? line : -line;
      const key = `${base}|${homeLine}`;
      put(key, side, book, odds, {
        label: handicapMarketLabel(metric, homeLine),
        family: 'handicap',
        line: homeLine,
        period,
        metric,
      });
      continue;
    }

    if ((bet === 'total' || (includeProps && bet === 'player prop')) && ouMatch) {
      const line = Number.parseFloat(ouMatch[2]!);
      if (!Number.isFinite(line) || !halfOk(line)) continue;
      const key = `${base}|${line}`;
      const isProp = bet === 'player prop';
      const label = isProp
        ? playerPropLabel(fullPlayerName || playerKey, metric, line)
        : totalMarketLabel(metric, line);
      put(key, ouMatch[1]!, book, odds, {
        label,
        family: isProp ? 'player_prop' : 'total',
        line,
        period,
        metric,
        playerName: isProp ? fullPlayerName || prettyPlayerName(playerKey) : null,
      });
      continue;
    }

    if (bet === 'team total' && ouMatch && (side === 'home' || side === 'away')) {
      const line = Number.parseFloat(ouMatch[2]!);
      if (!Number.isFinite(line) || !halfOk(line)) continue;
      const key = `${base}|${side}|${line}`;
      const named = teamTotalMarketLabel(metric, line, side as 'home' | 'away', homeName, awayName);
      put(key, ouMatch[1]!, book, odds, {
        label: named.label,
        family: 'team_total',
        line,
        period,
        metric,
        side: side as 'home' | 'away',
        playerName: named.playerName,
        winASet: named.winASet,
      });
    }
  }

  // Drop markets that grew a third outcome after the fact.
  for (const key of threeWay) {
    for (const mKey of [...markets.keys()]) {
      if (mKey === key || mKey.startsWith(`${key}|`)) markets.delete(mKey);
    }
  }

  return { markets, meta, threeWay };
}

export function sportFromTools(sport: ToolsSport): { apiSport: string; league: string } {
  if (sport === 'nba') return { apiSport: 'basketball', league: 'NBA' };
  if (sport === 'nbl') return { apiSport: 'basketball', league: 'NBL' };
  return { apiSport: 'tennis', league: '' };
}

export function toolsSportFromApi(apiSport: string, league: string): ToolsSport | null {
  const s = apiSport.toLowerCase();
  const l = league.toLowerCase();
  if (s === 'tennis') return 'tennis';
  if (s === 'basketball' && l === 'nba') return 'nba';
  if (s === 'basketball' && l === 'nbl') return 'nbl';
  return null;
}

export function outcomeLabel(outcome: string, home: string, away: string): string {
  const o = outcome.toLowerCase();
  if (o === 'home') return home || 'Home';
  if (o === 'away') return away || 'Away';
  if (o === 'over') return 'Over';
  if (o === 'under') return 'Under';
  return outcome;
}
