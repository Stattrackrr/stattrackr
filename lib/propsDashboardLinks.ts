import type { MouseEvent as ReactMouseEvent } from 'react';

export type PropsDashboardSport = 'nba' | 'afl' | 'nbl' | 'atp' | 'wta';

function normalizeTennisStat(stat: string): string {
  const value = String(stat || '').trim();
  if (
    value === 'moneyline' ||
    value === 'spread' ||
    value === 'totalGames' ||
    value === 'gamesWon' ||
    value === 'gamesLost' ||
    value === 'totalSets'
  ) {
    return value;
  }
  const n = value.toLowerCase().replace(/\s+/g, '');
  if (n === 'totalgames') return 'totalGames';
  if (n === 'gameswon') return 'gamesWon';
  if (n === 'gameslost' || n === 'oppgameswon') return 'gamesLost';
  if (n === 'totalsets') return 'totalSets';
  return 'moneyline';
}

function normalizeAflStat(stat: string): string {
  const value = String(stat || '').trim().toLowerCase();
  if (!value) return 'disposals';
  if (value === 'disposals' || value === 'disposals_over') return 'disposals';
  if (value === 'goals_over' || value === 'anytime_goal_scorer') return 'goals';
  if (value === 'marks') return 'marks';
  if (value === 'tackles') return 'tackles';
  if (value === 'kicks') return 'kicks';
  if (value === 'handballs') return 'handballs';
  if (value === 'tog') return 'tog';
  if (value === 'inside_50s') return 'inside_50s';
  if (value === 'uncontested' || value === 'uncontested_possessions') return 'uncontested_possessions';
  if (value === 'meters_gained') return 'meters_gained';
  if (value === 'free_kicks_against') return 'free_kicks_against';
  return 'disposals';
}

function normalizeNbaStat(stat: string): string {
  const upper = String(stat || '').toUpperCase().trim();
  if (upper === 'THREES' || upper === '3PM' || upper === '3PM/A' || upper === 'FG3M') return 'fg3m';
  if (upper === 'PTS' || upper === 'POINTS') return 'pts';
  if (upper === 'REB' || upper === 'REBOUNDS') return 'reb';
  if (upper === 'AST' || upper === 'ASSISTS') return 'ast';
  if (upper === 'PRA') return 'pra';
  if (upper === 'PR') return 'pr';
  if (upper === 'PA') return 'pa';
  if (upper === 'RA') return 'ra';
  if (upper === 'STL' || upper === 'STEALS') return 'stl';
  if (upper === 'BLK' || upper === 'BLOCKS') return 'blk';
  return upper.toLowerCase();
}

export function tennisDashboardHref(opts: {
  playerName: string;
  playerId?: string | null;
  team?: string | null;
  opponent?: string | null;
  opponentIoc?: string | null;
  opponentId?: string | null;
  statType?: string | null;
  line?: number | null;
  bookmaker?: string | null;
}): string {
  const q = new URLSearchParams();
  q.set('mode', 'player');
  q.set('name', opts.playerName);
  const tour = String(opts.team || '').trim();
  if (tour) q.set('team', tour);
  if (opts.opponent) q.set('opponent', opts.opponent);
  const oppIoc = String(opts.opponentIoc || '').trim().toUpperCase();
  if (oppIoc) q.set('oioc', oppIoc);
  const oppId = String(opts.opponentId || '').trim();
  if (oppId) q.set('oid', oppId);
  q.set('stat', normalizeTennisStat(String(opts.statType || '')));
  if (opts.line != null && Number.isFinite(opts.line)) q.set('line', String(opts.line));
  if (opts.playerId) q.set('pid', String(opts.playerId));
  const book = String(opts.bookmaker || '').trim();
  if (book) q.set('bookmaker', book);
  return `/tennis?${q.toString()}`;
}

export function aflDashboardHref(opts: {
  playerName: string;
  team?: string | null;
  opponent?: string | null;
  statType?: string | null;
  line?: number | null;
  bookmaker?: string | null;
}): string {
  const q = new URLSearchParams();
  q.set('mode', 'player');
  q.set('name', opts.playerName);
  if (opts.team) q.set('team', opts.team);
  if (opts.opponent) q.set('opponent', opts.opponent);
  q.set('stat', normalizeAflStat(String(opts.statType || '')));
  if (opts.line != null && Number.isFinite(opts.line)) q.set('line', String(opts.line));
  const book = String(opts.bookmaker || '').trim();
  if (book) q.set('bookmaker', book);
  return `/afl?${q.toString()}`;
}

export function nbaDashboardHref(opts: {
  playerName: string;
  statType?: string | null;
  line?: number | null;
}): string {
  const q = new URLSearchParams();
  q.set('player', opts.playerName);
  q.set('stat', normalizeNbaStat(String(opts.statType || '')));
  if (opts.line != null && Number.isFinite(opts.line)) q.set('line', String(opts.line));
  q.set('tf', 'last10');
  return `/nba/research/dashboard?${q.toString()}`;
}

export function nblDashboardHref(opts: {
  playerName: string;
  team?: string | null;
  opponent?: string | null;
  statType?: string | null;
  line?: number | null;
  bookmaker?: string | null;
}): string {
  const q = new URLSearchParams();
  q.set('mode', 'player');
  q.set('name', opts.playerName);
  if (opts.team) q.set('team', opts.team);
  if (opts.opponent) q.set('opponent', opts.opponent);
  const stat = String(opts.statType || 'points').trim() || 'points';
  q.set('stat', stat);
  if (opts.line != null && Number.isFinite(opts.line)) q.set('line', String(opts.line));
  const book = String(opts.bookmaker || '').trim();
  if (book) q.set('bookmaker', book);
  return `/nbl?${q.toString()}`;
}

export function propsDashboardHref(opts: {
  sport: PropsDashboardSport;
  playerName: string;
  playerId?: string | null;
  team?: string | null;
  opponent?: string | null;
  opponentIoc?: string | null;
  opponentId?: string | null;
  statType?: string | null;
  line?: number | null;
  bookmaker?: string | null;
}): string {
  if (opts.sport === 'atp' || opts.sport === 'wta') return tennisDashboardHref(opts);
  if (opts.sport === 'afl') return aflDashboardHref(opts);
  if (opts.sport === 'nbl') return nblDashboardHref(opts);
  return nbaDashboardHref(opts);
}

/** Left click without modifier keys — client-route; otherwise let the browser open a new tab. */
export function isUnmodifiedLeftClick(event: ReactMouseEvent | MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function eventTargetIsInteractive(event: ReactMouseEvent | MouseEvent): boolean {
  const el = event.target;
  if (!(el instanceof Element)) return false;
  return Boolean(el.closest('a, button, input, textarea, select, label'));
}
