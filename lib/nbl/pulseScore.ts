/**
 * NBL player markets from odds-api.net (Sportsbet / TAB / Bet365 / Unibet).
 * Game moneyline/spread/total stay on The Odds API.
 */

import { decimalToAmerican } from '@/lib/currencyUtils';
import { officialNblClubName, resolveNblClubName } from '@/lib/nblTeamCanonical';
import sharedCache from '@/lib/sharedCache';
import { fetchOddsApiNetNblGames } from '@/lib/nbl/oddsApiNet';
import {
  NBL_PLAYER_PROP_STAT_TO_MARKET,
  nblPreferOuLines,
  type NblBookRow,
  type NblPropLine,
} from '@/lib/nbl/oddsTypes';

const CACHE_KEY = 'nbl_oan_board_v1';
const CACHE_TTL_SECONDS = 365 * 24 * 60 * 60 * 10;

const PREFERRED_THRESHOLD: Record<string, number> = {
  points: 20,
  rebounds: 6,
  assists: 4,
  threeMade: 1,
};

interface PulseMoreInfo {
  player?: string;
  participant?: string;
}

interface PulseSelection {
  canonicalOutcome?: string;
  rawName?: string;
  name?: string;
  odds?: number;
  line?: number;
  isActive?: boolean;
  moreInfo?: PulseMoreInfo;
}

interface PulseMarket {
  canonicalMarket?: string;
  rawName?: string;
  name?: string;
  period?: string;
  line?: number;
  isActive?: boolean;
  selections?: PulseSelection[];
  marketId?: string;
  moreInfo?: PulseMoreInfo;
}

export interface PulseNblGame {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmakers: Array<{ name: string; markets: PulseMarket[] }>;
}

interface PulseNblBoard {
  lastUpdated: string;
  games: PulseNblGame[];
}

let inflight: Promise<PulseNblBoard> | null = null;
let memoryBoard: PulseNblGame[] | null = null;

function oddsApiNetKey(): string {
  return String(process.env.ODDS_API_NET_KEY || process.env.ODDS_API_NET || '').trim();
}

function officialTeam(raw: string | undefined): string {
  const s = String(raw || '').trim();
  return resolveNblClubName(s) || s;
}

function teamKey(raw: string | undefined): string {
  return officialTeam(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function teamsMatch(a: string | undefined, b: string | undefined): boolean {
  const ka = teamKey(a);
  const kb = teamKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return ka.includes(kb) || kb.includes(ka);
}

async function refreshBoard(): Promise<PulseNblBoard> {
  const games = (await fetchOddsApiNetNblGames()) as PulseNblGame[];
  const board: PulseNblBoard = { lastUpdated: new Date().toISOString(), games };
  if (games.length) {
    memoryBoard = games;
    await sharedCache.setJSON(CACHE_KEY, board, CACHE_TTL_SECONDS);
    const { persistNblPlayerPropSnapshots } = await import('@/lib/nbl/playerPropSnapshots');
    void persistNblPlayerPropSnapshots(games).catch((err) => {
      console.warn(
        '[odds-api.net NBL] snapshot persist failed',
        err instanceof Error ? err.message : err
      );
    });
  }
  return board;
}

export async function getNblPulseScoreBoard(options?: { force?: boolean }): Promise<PulseNblGame[]> {
  const cached = await sharedCache.getJSON<PulseNblBoard>(CACHE_KEY);
  if (cached?.games?.length) {
    memoryBoard = cached.games;
    if (!options?.force) return cached.games;
  } else if (!options?.force) {
    return memoryBoard ?? [];
  }

  if (!oddsApiNetKey()) return cached?.games?.length ? cached.games : memoryBoard ?? [];
  if (!inflight) {
    inflight = refreshBoard().finally(() => {
      inflight = null;
    });
  }
  try {
    const fresh = await inflight;
    if (fresh.games.length) return fresh.games;
  } catch (err) {
    console.warn('[odds-api.net NBL] refresh failed', err instanceof Error ? err.message : err);
  }
  return cached?.games?.length ? cached.games : memoryBoard ?? [];
}

export function findPulseNblGame(
  games: PulseNblGame[],
  team: string | null | undefined,
  opponent?: string | null
): PulseNblGame | null {
  if (!games.length || !team) return null;
  let candidates = games.filter(
    (g) => teamsMatch(g.homeTeam, team) || teamsMatch(g.awayTeam, team)
  );
  if (opponent) {
    const withOpp = candidates.filter(
      (g) => teamsMatch(g.homeTeam, opponent) || teamsMatch(g.awayTeam, opponent)
    );
    if (withOpp.length) candidates = withOpp;
  }
  if (!candidates.length) return null;
  const now = Date.now();
  candidates.sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  return (
    candidates.find((g) => Date.parse(g.commenceTime) >= now - 3 * 60 * 60 * 1000) ??
    candidates[candidates.length - 1]
  );
}

function stripPlayerLabel(raw: string): string {
  return String(raw || '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s+(over|under)\b.*$/i, '')
    .trim();
}

function isOutcomeOnlyName(raw: string): boolean {
  return /^(yes|no|over|under|ou|u)$/i.test(String(raw || '').trim());
}

export function isPulsePlayerName(raw: string | null | undefined): boolean {
  const s = String(raw || '').trim();
  if (!s || isOutcomeOnlyName(s)) return false;
  if (/^(over|under)\s+\d/i.test(s)) return false;
  if (/\b(over|under)\s+\d/i.test(s)) return false;
  if (/\s\/\s*(over|under)\b/i.test(s)) return false;
  if (/[\/|]/.test(s)) return false;
  if (/\d/.test(s)) return false;
  if (
    /\b(win|double[-\s]?double|triple[-\s]?double|first basket|most points|player points|player rebounds|player assists|player threes)\b/i.test(
      s
    )
  ) {
    return false;
  }
  if (/\b(pts|reb|ast|points|rebounds|assists|threes?)\b/i.test(s)) return false;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(s)) return false;
  if (officialNblClubName(s)) return false;
  return true;
}

function playerFromMarketTitle(raw: string): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/\s*[-–:|]\s*(?:\d+\+\s*)?(?:points|rebounds|assists|threes?|3-?pointers?).*$/i, '');
  s = s.replace(/\s+\d+\+\s*(?:points|rebounds|assists|threes?|3-?pointers?).*$/i, '');
  s = s.replace(/\s+(?:over\/under|o\/u|total)\b.*$/i, '');
  s = s.replace(/^(?:player\s+)?(?:points|rebounds|assists|threes?|3-?pointers?)\b.*$/i, '');
  s = s.replace(/\s+(?:points|rebounds|assists|threes?|3-?pointers?)\s*$/i, '');
  return stripPlayerLabel(s);
}

export function pulseMarketPlayerName(
  market: PulseMarket,
  sel?: PulseSelection
): string {
  const fromInfo = String(
    sel?.moreInfo?.participant || sel?.moreInfo?.player || market.moreInfo?.player || ''
  ).trim();
  if (isPulsePlayerName(fromInfo)) return fromInfo;
  const fromSel = stripPlayerLabel(sel?.rawName || sel?.name || '');
  if (isPulsePlayerName(fromSel)) return fromSel;
  const fromMarket = playerFromMarketTitle(market.rawName || market.name || '');
  if (isPulsePlayerName(fromMarket)) return fromMarket;
  const tail = String(market.marketId || '')
    .split(':')
    .slice(2)
    .join(':')
    .trim();
  return isPulsePlayerName(tail) ? tail : '';
}

export function normalizePlayerName(s: string): string {
  return stripPlayerLabel(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function namesMatch(playerQuery: string, outcomeName: string): boolean {
  const a = normalizePlayerName(playerQuery);
  const b = normalizePlayerName(outcomeName);
  if (!a || !b) return false;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  if (/\b(win|pts|reb|ast|double[-\s]?double|triple[-\s]?double)\b/.test(a) || /\b(win|pts|reb|ast|double[-\s]?double|triple[-\s]?double)\b/.test(b)) return false;
  if (a === b) return true;
  const aParts = a.split(/\s+/).filter(Boolean);
  const bParts = b.split(/\s+/).filter(Boolean);
  const lastA = aParts[aParts.length - 1] ?? '';
  const lastB = bParts[bParts.length - 1] ?? '';
  const firstA = aParts[0] ?? '';
  const firstB = bParts[0] ?? '';
  if (lastA && lastB && lastA === lastB && firstA && firstB && (firstA === firstB || firstA[0] === firstB[0])) {
    return true;
  }
  const aTail = aParts.slice(-2).join(' ');
  const bTail = bParts.slice(-2).join(' ');
  if (aTail && aTail === bTail && aTail.includes(' ')) return true;
  return b.includes(a) || a.includes(b);
}

function canonicalPlayerStat(canonical: string | undefined): string | null {
  const c = String(canonical || '').toUpperCase();
  if (c === 'PLAYER_POINTS') return 'points';
  if (c === 'PLAYER_REBOUNDS') return 'rebounds';
  if (c === 'PLAYER_ASSISTS') return 'assists';
  if (c === 'PLAYER_THREES_MADE' || c === 'PLAYER_THREES') return 'threeMade';
  return null;
}

export function classifyPulseNblMarket(market: PulseMarket): {
  stat: string;
  kind: 'ou' | 'milestone';
  threshold?: number;
} | null {
  return marketStat(
    market.canonicalMarket,
    market.rawName || market.name || '',
    market.line,
    marketHasTwoWayOu(market),
    market.marketId
  );
}

function marketHasTwoWayOu(market: { selections?: PulseSelection[] } | undefined): boolean {
  let hasOver = false;
  let hasUnder = false;
  for (const sel of market?.selections || []) {
    const blob = `${sel.canonicalOutcome || ''} ${sel.rawName || ''} ${sel.name || ''}`.toLowerCase();
    if (/\bunder\b/.test(blob)) hasUnder = true;
    else if (/\bover\b/.test(blob)) hasOver = true;
  }
  return hasOver && hasUnder;
}

function statFromBlob(blob: string): string | null {
  const s = String(blob || '').toLowerCase();
  if (/\bthree|3-?point|3pm|threes\b/.test(s)) return 'threeMade';
  if (/\brebound|\breb\b/.test(s)) return 'rebounds';
  if (/\bassist|\bast\b/.test(s)) return 'assists';
  if (/\bpoints?\b|\bpts\b/.test(s)) return 'points';
  return null;
}

function marketStat(
  canonical: string | undefined,
  rawName: string,
  line?: number | null,
  twoWay = false,
  marketId?: string
): { stat: string; kind: 'ou' | 'milestone'; threshold?: number } | null {
  const n = String(rawName || '').trim();
  const blob = `${canonical || ''} ${n} ${marketId || ''}`.toLowerCase();
  if (/score and win|first basket|double[-\s]?double|triple[-\s]?double|most points|to win/i.test(blob)) {
    return null;
  }
  if (/\b(match|game|team)\s+total\b|\btotal points\b|\btotals?\b/i.test(blob) && !/player/i.test(blob)) {
    return null;
  }

  let m = n.match(/(?:to score\s+)?(\d+)\+\s*points\b/i);
  if (m) {
    return twoWay
      ? { stat: 'points', kind: 'ou' }
      : { stat: 'points', kind: 'milestone', threshold: Number(m[1]) };
  }
  m = n.match(/(\d+)\+\s*points?\s+scored/i);
  if (m) {
    return twoWay
      ? { stat: 'points', kind: 'ou' }
      : { stat: 'points', kind: 'milestone', threshold: Number(m[1]) };
  }
  m = n.match(/(?:to record\s+)?(\d+)\+\s*rebounds\b/i);
  if (m) {
    return twoWay
      ? { stat: 'rebounds', kind: 'ou' }
      : { stat: 'rebounds', kind: 'milestone', threshold: Number(m[1]) };
  }
  m = n.match(/(\d+)\+\s*rebounds?\s+by/i);
  if (m) {
    return twoWay
      ? { stat: 'rebounds', kind: 'ou' }
      : { stat: 'rebounds', kind: 'milestone', threshold: Number(m[1]) };
  }
  m = n.match(/(?:to record\s+)?(\d+)\+\s*assists\b/i);
  if (m) {
    return twoWay
      ? { stat: 'assists', kind: 'ou' }
      : { stat: 'assists', kind: 'milestone', threshold: Number(m[1]) };
  }
  m = n.match(/(\d+)\+\s*assists?\s+by/i);
  if (m) {
    return twoWay
      ? { stat: 'assists', kind: 'ou' }
      : { stat: 'assists', kind: 'milestone', threshold: Number(m[1]) };
  }
  m = n.match(/(?:to (?:make|record)\s+)?(\d+)\+\s*(?:made\s+)?threes\b/i);
  if (m) {
    return twoWay
      ? { stat: 'threeMade', kind: 'ou' }
      : { stat: 'threeMade', kind: 'milestone', threshold: Number(m[1]) };
  }
  m = n.match(/(\d+)\+\s*(?:three-point|three point)/i);
  if (m) {
    return twoWay
      ? { stat: 'threeMade', kind: 'ou' }
      : { stat: 'threeMade', kind: 'milestone', threshold: Number(m[1]) };
  }

  const fromCanon = canonicalPlayerStat(canonical);
  if (fromCanon) {
    if (twoWay) return { stat: fromCanon, kind: 'ou' };
    if (line != null && Number.isFinite(line) && Math.abs(line - Math.round(line)) < 1e-6) {
      return { stat: fromCanon, kind: 'milestone', threshold: Math.round(line) };
    }
    if (line != null && Number.isFinite(line)) return { stat: fromCanon, kind: 'ou' };
  }

  if (/\bplayer[_\s-]*points\b|\bpoints\b.*\b(o\/u|over\/under|total)\b|\b(o\/u|over\/under)\b.*\bpoints\b/.test(blob)) {
    return { stat: 'points', kind: 'ou' };
  }
  if (/\bplayer[_\s-]*rebounds\b|\brebounds\b.*\b(o\/u|over\/under)\b|\b(o\/u|over\/under)\b.*\brebounds\b/.test(blob)) {
    return { stat: 'rebounds', kind: 'ou' };
  }
  if (/\bplayer[_\s-]*assists\b|\bassists\b.*\b(o\/u|over\/under)\b|\b(o\/u|over\/under)\b.*\bassists\b/.test(blob)) {
    return { stat: 'assists', kind: 'ou' };
  }
  if (/player[_\s-]*threes(?:[_\s-]*made)?|\bthrees\b.*\b(o\/u|over\/under)\b|\b(o\/u|over\/under)\b.*\bthrees\b/.test(blob)) {
    return { stat: 'threeMade', kind: 'ou' };
  }
  if (twoWay) {
    const inferred = fromCanon || statFromBlob(blob);
    if (inferred) return { stat: inferred, kind: 'ou' };
  }
  return null;
}

function selectionSide(sel: PulseSelection): 'over' | 'under' {
  const blob = `${sel.canonicalOutcome || ''} ${sel.rawName || ''} ${sel.name || ''}`.toLowerCase();
  if (/\bunder\b/.test(blob)) return 'under';
  return 'over';
}

function americanFromDecimal(odds: number | undefined): string {
  if (odds == null || !Number.isFinite(odds) || odds <= 1) return 'N/A';
  return decimalToAmerican(odds);
}

function emptyBook(name: string): NblBookRow {
  return {
    name,
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
  };
}

function pickMainLine(lines: NblPropLine[], stat: string): NblPropLine {
  const twoWay = lines.find((l) => l.kind === 'ou' && l.under !== 'N/A');
  if (twoWay) return twoWay;
  const want = PREFERRED_THRESHOLD[stat];
  if (want != null) {
    const exact = lines.find((l) => l.label === `${want}+`);
    if (exact) return exact;
    return [...lines].sort((a, b) => {
      const da = Math.abs((parseFloat(a.label) || parseFloat(a.line) || 0) - want);
      const db = Math.abs((parseFloat(b.label) || parseFloat(b.line) || 0) - want);
      return da - db;
    })[0];
  }
  return lines[0];
}

export function pulseBooksByStat(game: PulseNblGame, player: string): Record<string, NblBookRow[]> {
  const out: Record<string, NblBookRow[]> = {};
  for (const stat of Object.keys(NBL_PLAYER_PROP_STAT_TO_MARKET)) {
    const rows = pulseBooksForPlayer(game, player, stat);
    if (rows.length) out[stat] = rows;
  }
  return out;
}

export function pulseBooksForPlayer(game: PulseNblGame, player: string, stat: string): NblBookRow[] {
  const rows: NblBookRow[] = [];
  for (const book of game.bookmakers) {
    const byLine = new Map<string, NblPropLine>();
    for (const market of book.markets || []) {
      if (market.isActive === false) continue;
      const twoWay = marketHasTwoWayOu(market);
      const parsed = marketStat(
        market.canonicalMarket,
        market.rawName || market.name || '',
        market.line,
        twoWay,
        market.marketId
      );
      if (!parsed || parsed.stat !== stat) continue;
      if (parsed.stat === 'points' && typeof market.line === 'number' && market.line > 80) continue;
      for (const sel of market.selections || []) {
        if (sel.isActive === false) continue;
        if (
          !twoWay &&
          /\bno\b/i.test(`${sel.canonicalOutcome || ''} ${sel.rawName || ''} ${sel.name || ''}`)
        ) {
          continue;
        }
        const selName = pulseMarketPlayerName(market, sel);
        if (!isPulsePlayerName(selName) || !namesMatch(player, selName)) continue;
        const price = americanFromDecimal(sel.odds);
        if (price === 'N/A') continue;

        if (parsed.kind === 'milestone' && parsed.threshold != null) {
          const chartLine = parsed.threshold - 0.5;
          const label = `${parsed.threshold}+`;
          byLine.set(`ms:${label}`, {
            line: String(chartLine),
            over: price,
            under: 'N/A',
            kind: 'milestone',
            label,
          });
          continue;
        }

        const rawLine =
          typeof sel.line === 'number' && Number.isFinite(sel.line)
            ? sel.line
            : typeof market.line === 'number' && Number.isFinite(market.line)
              ? market.line
              : null;
        if (rawLine == null) continue;
        if (parsed.stat === 'points' && rawLine > 80) continue;
        const key = `ou:${rawLine}`;
        const existing = byLine.get(key) ?? {
          line: String(rawLine),
          over: 'N/A',
          under: 'N/A',
          kind: 'ou' as const,
          label: String(rawLine),
        };
        if (selectionSide(sel) === 'under') existing.under = price;
        else existing.over = price;
        byLine.set(key, existing);
      }
    }
    const lines = nblPreferOuLines(
      [...byLine.values()].sort((a, b) => parseFloat(a.line) - parseFloat(b.line))
    );
    if (!lines.length) continue;
    const main = pickMainLine(lines, stat);
    rows.push({
      ...emptyBook(book.name),
      Total: { line: main.line, over: main.over, under: main.under },
      lines,
    });
  }
  return rows;
}
