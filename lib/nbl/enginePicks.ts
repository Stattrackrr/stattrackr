/**
 * Server-side reader for the committed NBL props engine output
 * (data/nbl-model/cache/engine-picks/<date>.json, written by nbl-engine/run.py --publish-dir).
 *
 * Vercel's filesystem is read-only, so these files only change via CI commits + redeploy;
 * we cache parsed files per process keyed on mtime.
 */

import fs from 'fs';
import path from 'path';
import type {
  NblEngineMarketSummary,
  NblEnginePanelPayload,
  NblEnginePick,
  NblEnginePublishFile,
} from '@/lib/nbl/engineShared';
import { nblStoredLineQuotes } from '@/lib/nbl/engineShared';
import { getNblClubByCode, NBL_CLUBS, normalizeTeamKey, resolveNblClubName } from '@/lib/nblTeamCanonical';

export const NBL_ENGINE_PICKS_DIR = path.join(
  process.cwd(),
  'data',
  'nbl-model',
  'cache',
  'engine-picks'
);

/** Treat a game as "live / just finished" for this long after tip before falling through to the next one. */
const GAME_WINDOW_AFTER_TIP_MS = 4 * 60 * 60 * 1000;

type CachedFile = { mtimeMs: number; data: NblEnginePublishFile };
const fileCache = new Map<string, CachedFile>();

function listDayFiles(dir = NBL_ENGINE_PICKS_DIR): string[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()
    .map((n) => path.join(dir, n));
}

function readDayFile(file: string): NblEnginePublishFile | null {
  try {
    const stat = fs.statSync(file);
    const hit = fileCache.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit.data;
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw) as NblEnginePublishFile;
    if (!data || !Array.isArray(data.picks)) return null;
    fileCache.set(file, { mtimeMs: stat.mtimeMs, data });
    return data;
  } catch {
    return null;
  }
}

export function loadNblEngineDays(dir = NBL_ENGINE_PICKS_DIR): NblEnginePublishFile[] {
  const out: NblEnginePublishFile[] = [];
  for (const file of listDayFiles(dir)) {
    const data = readDayFile(file);
    if (data) out.push(data);
  }
  return out;
}

function clubCodeFor(input: string | null | undefined): string | null {
  if (!input) return null;
  const direct = getNblClubByCode(input);
  if (direct) return direct.code;
  const name = resolveNblClubName(input);
  if (!name) return null;
  const key = normalizeTeamKey(name);
  const club = NBL_CLUBS.find((c) => normalizeTeamKey(c.name) === key);
  return club ? club.code : null;
}

function normPlayerName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function marketSummary(p: NblEnginePick): NblEngineMarketSummary {
  const quotes = nblStoredLineQuotes(p);
  return {
    stat: p.stat,
    stat_label: p.stat_label,
    line: p.line,
    side: p.side,
    tier: p.tier,
    kind: p.line_summary?.kind ?? null,
    bestOver: quotes.bestOver,
    bestUnder: quotes.bestUnder,
  };
}

const TIER_RANK: Record<string, number> = { STRONG: 4, LEAN: 3, 'NO EDGE': 2, AVOID: 1 };
const STAT_TIE = ['points', 'pra', 'pr', 'rebounds', 'assists', 'threeMade'];

/** Stat key that picks the strongest bettable market on this player, not points by default. */
export const NBL_ASK_BEST_PLAY_STAT = '__best_play__';

function playSide(p: NblEnginePick): 'over' | 'under' {
  if (p.side === 'over' || p.side === 'under') return p.side;
  return p.score_over >= p.score_under ? 'over' : 'under';
}

type ScoredPlay = {
  pick: NblEnginePick;
  tier: number;
  edge: number;
  books: number;
  price: number;
  statTie: number;
};

function scorePlay(pick: NblEnginePick): ScoredPlay | null {
  const quotes = nblStoredLineQuotes(pick);
  const side = playSide(pick);
  const quote = side === 'over' ? quotes.bestOver : quotes.bestUnder;
  if (!quote) return null;
  const edge = side === 'over' ? pick.score_over - pick.score_under : pick.score_under - pick.score_over;
  return {
    pick,
    tier: TIER_RANK[pick.tier] ?? 0,
    edge,
    books: quote.books.length,
    price: quote.price,
    statTie: STAT_TIE.includes(pick.stat) ? STAT_TIE.length - STAT_TIE.indexOf(pick.stat) : 0,
  };
}

function byPlayScore(a: ScoredPlay, b: ScoredPlay): number {
  return b.tier - a.tier || b.edge - a.edge || b.books - a.books || b.price - a.price || b.statTie - a.statTie;
}

/** Ranked bettable markets on this player (engine side must have a stored price). */
export function rankNblPlayPicks(picks: NblEnginePick[]): NblEnginePick[] {
  return picks
    .map(scorePlay)
    .filter((row): row is ScoredPlay => Boolean(row))
    .sort(byPlayScore)
    .map((row) => row.pick);
}

/**
 * If you had to bet this player, take the market with a real price on the engine side:
 * STRONG > LEAN > NO EDGE > AVOID, then bigger score gap, then more books.
 */
export function selectNblPlayPick(picks: NblEnginePick[]): NblEnginePick | null {
  return rankNblPlayPicks(picks)[0] ?? null;
}

function leanEdge(pick: NblEnginePick): number {
  const side = playSide(pick);
  return side === 'over' ? pick.score_over - pick.score_under : pick.score_under - pick.score_over;
}

/** Strongest engine lean even when that side has no stored price. */
export function selectNblLeanPick(picks: NblEnginePick[]): NblEnginePick | null {
  if (!picks.length) return null;
  return [...picks].sort(
    (a, b) =>
      (TIER_RANK[b.tier] ?? 0) - (TIER_RANK[a.tier] ?? 0) ||
      leanEdge(b) - leanEdge(a) ||
      (STAT_TIE.includes(b.stat) ? STAT_TIE.length - STAT_TIE.indexOf(b.stat) : 0) -
        (STAT_TIE.includes(a.stat) ? STAT_TIE.length - STAT_TIE.indexOf(a.stat) : 0)
  )[0];
}

export function selectNblAskPick(picks: NblEnginePick[]): NblEnginePick | null {
  return selectNblPlayPick(picks) ?? selectNblLeanPick(picks);
}

const EMPTY: NblEnginePanelPayload = {
  pick: null,
  markets: [],
  game: null,
  generated_at: null,
  engine_version: null,
  data_as_of: {},
  reason: null,
};

export type NblEngineLookup = {
  playerId?: string | null;
  playerName?: string | null;
  /** Club name, code or alias; when omitted the next game for the player is used. */
  opponent?: string | null;
  stat: string;
  now?: Date;
  dir?: string;
};

type GameGroup = { day: NblEnginePublishFile; picks: NblEnginePick[]; tipMs: number };

function resolveNblEngineGame(lookup: NblEngineLookup): {
  chosen: GameGroup;
  base: { generated_at: string | null; engine_version: string | null; data_as_of: Record<string, string> };
} | { empty: NblEnginePanelPayload } {
  const days = loadNblEngineDays(lookup.dir);
  if (days.length === 0) return { empty: { ...EMPTY, reason: 'No engine output has been published yet.' } };

  const wantId = String(lookup.playerId || '').trim();
  const wantName = lookup.playerName ? normPlayerName(lookup.playerName) : '';
  const wantOpp = clubCodeFor(lookup.opponent);
  const nowMs = (lookup.now ?? new Date()).getTime();

  const latest = days[days.length - 1];
  const base = {
    generated_at: latest.generated_at ?? null,
    engine_version: latest.engine_version ?? null,
    data_as_of: latest.data_as_of ?? {},
  };

  if (!wantId && !wantName) return { empty: { ...EMPTY, ...base, reason: 'Select a player.' } };

  const groups = new Map<string, GameGroup>();
  let sawPlayer = false;
  for (const day of days) {
    for (const p of day.picks) {
      const idMatch = wantId && p.player_id === wantId;
      const nameMatch = !wantId && wantName && normPlayerName(p.player_name) === wantName;
      if (!idMatch && !nameMatch) continue;
      sawPlayer = true;
      if (wantOpp && p.opponent_code !== wantOpp) continue;
      const key = `${day.run_date}|${p.game_key}`;
      const tipMs = p.tipoff_utc ? Date.parse(p.tipoff_utc) : Date.parse(`${p.run_date}T00:00:00Z`);
      const g = groups.get(key) ?? { day, picks: [], tipMs: Number.isFinite(tipMs) ? tipMs : 0 };
      g.picks.push(p);
      groups.set(key, g);
    }
  }

  if (groups.size === 0) {
    const reason = !sawPlayer
      ? 'No sportsbook lines were on the board for this player when the engine last ran.'
      : wantOpp
        ? `The engine has not analysed this player against ${getNblClubByCode(wantOpp)?.name ?? wantOpp} yet.`
        : 'No upcoming market found for this player.';
    return { empty: { ...EMPTY, ...base, reason } };
  }

  const ordered = [...groups.values()].sort((a, b) => a.tipMs - b.tipMs);
  const upcoming = ordered.find((g) => g.tipMs + GAME_WINDOW_AFTER_TIP_MS >= nowMs);
  return { chosen: upcoming ?? ordered[ordered.length - 1], base };
}

/** Every priced market the engine has for this player in the next (or last) game. */
export function findNblEnginePlayerPicks(lookup: Omit<NblEngineLookup, 'stat'> & { stat?: string }): NblEnginePick[] {
  const resolved = resolveNblEngineGame({ ...lookup, stat: lookup.stat || 'points' });
  if ('empty' in resolved) return [];
  return resolved.chosen.picks;
}

/**
 * Find the engine's analysis for one player/stat.
 * Picks the earliest game that has not clearly finished (tip < now - 4h); if every
 * candidate game is in the past, the most recent one is returned so the panel can
 * still show what the model said pre-tip.
 */
export function findNblEnginePanel(lookup: NblEngineLookup): NblEnginePanelPayload {
  const resolved = resolveNblEngineGame(lookup);
  if ('empty' in resolved) return resolved.empty;

  const { chosen } = resolved;
  const statKey = String(lookup.stat || 'points');
  const pick =
    statKey === NBL_ASK_BEST_PLAY_STAT
      ? selectNblAskPick(chosen.picks)
      : chosen.picks.find((p) => p.stat === statKey) ?? null;
  const markets = chosen.picks
    .map(marketSummary)
    .sort((a, b) => a.stat_label.localeCompare(b.stat_label));
  const first = chosen.picks[0];

  return {
    pick,
    markets,
    game: {
      run_date: chosen.day.run_date,
      game_key: first.game_key,
      game_label: first.game_label,
      tipoff_utc: first.tipoff_utc,
      opponent_code: first.opponent_code,
      is_home: first.is_home,
    },
    generated_at: chosen.day.generated_at ?? null,
    engine_version: chosen.day.engine_version ?? null,
    data_as_of: chosen.day.data_as_of ?? {},
    reason: pick
      ? null
      : statKey === NBL_ASK_BEST_PLAY_STAT
        ? 'No sportsbook line was on the board for this player when the engine last ran.'
        : `No ${statKey} market was on the board for this player when the engine ran.`,
  };
}
