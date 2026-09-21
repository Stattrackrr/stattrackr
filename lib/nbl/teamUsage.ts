import fs from 'fs';
import path from 'path';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import { enrichNblGamesAdvancedRates } from '@/lib/nbl/teamBoxScores';
import { nblAssistsPerPossession, nblPointsPerPossession, nblPossessionsUsed, round1, round2 } from '@/lib/nbl/advancedRates';
import { resolveNblClubName } from '@/lib/nblTeamCanonical';

export type NblTeamUsagePlayer = {
  playerId: string;
  name: string;
  usgPct: number;
  minutes: number;
  games: number;
  stats: Record<string, number>;
};

type RosterRow = {
  playerId?: string | null;
  name?: string | null;
  team?: string | null;
};

const MIN_GAME_MINUTES = 5;
const MIN_AVG_MINUTES = 8;

const RATE_STATS = new Set([
  'usgPct',
  'tsPct',
  'trebPct',
  'orebPct',
  'drebPct',
  'pace',
  'fgPct',
  'threePct',
  'twoPct',
  'ftPct',
]);

const PCT_AS_FRACTION = new Set(['fgPct', 'threePct', 'twoPct', 'ftPct']);
const RATIO_FROM_TOTALS = new Set(['ptsPerPoss', 'astPerPoss']);

export const TEAM_PIE_STAT_KEYS = [
  'usgPct',
  'possUsed',
  'ptsPerPoss',
  'astPerPoss',
  'tsPct',
  'trebPct',
  'orebPct',
  'drebPct',
  'pace',
  'points',
  'rebounds',
  'assists',
  'pra',
  'pr',
  'pa',
  'ra',
  'minutes',
  'threeMade',
  'threeAttempted',
  'threePct',
  'fgMade',
  'fgAttempted',
  'fgPct',
  'twoMade',
  'twoAttempted',
  'twoPct',
  'ftMade',
  'ftAttempted',
  'ftPct',
  'steals',
  'blocks',
  'offensiveRebounds',
  'defensiveRebounds',
  'turnovers',
  'fouls',
  'efficiency',
] as const;

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function loadRoster(year: number): RosterRow[] {
  const roster = readJson<{ players?: RosterRow[] }>(
    path.join(process.cwd(), 'data', `nbl-roster-${year}.json`)
  );
  const stats = readJson<{ players?: RosterRow[] }>(
    path.join(process.cwd(), 'data', `nbl-league-player-stats-${year}.json`)
  );
  return [...(roster?.players ?? []), ...(stats?.players ?? [])];
}

function loadPlayerGames(playerId: string, year: number): NblGameLogRow[] {
  const file = path.join(
    process.cwd(),
    'data',
    'nbl-model',
    'cache',
    'player-logs',
    `${playerId}-${year}.json`
  );
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { games?: NblGameLogRow[] };
    const games = Array.isArray(data.games) ? data.games : [];
    return enrichNblGamesAdvancedRates(games, year).filter((g) => {
      const season = typeof g.season === 'number' ? g.season : year;
      if (season !== year) return false;
      return (Number(g.minutes) || 0) > 0;
    });
  } catch {
    return [];
  }
}

function applyLastN(games: NblGameLogRow[], lastN: number | null): NblGameLogRow[] {
  const sorted = games.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (lastN != null && lastN > 0) return sorted.slice(-lastN);
  return sorted;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function readStat(game: NblGameLogRow, key: string): number | null {
  const pts = num(game.points);
  const reb = num(game.rebounds);
  const ast = num(game.assists);
  if (key === 'possUsed') {
    const used = nblPossessionsUsed(num(game.fgAttempted), num(game.ftAttempted), num(game.turnovers));
    return used == null ? null : used;
  }
  if (key === 'pra') return pts + reb + ast;
  if (key === 'pr') return pts + reb;
  if (key === 'pa') return pts + ast;
  if (key === 'ra') return reb + ast;
  if (key === 'efficiency') {
    const existing = typeof game.efficiency === 'number' && Number.isFinite(game.efficiency) ? game.efficiency : null;
    if (existing != null) return existing;
    const fgm = num(game.fgMade);
    const fga = num(game.fgAttempted);
    const ftm = num(game.ftMade);
    const fta = num(game.ftAttempted);
    return (
      pts +
      reb +
      ast +
      num(game.steals) +
      num(game.blocks) -
      (fga - fgm) -
      (fta - ftm) -
      num(game.turnovers)
    );
  }
  const raw = (game as unknown as Record<string, unknown>)[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (PCT_AS_FRACTION.has(key) && raw <= 1) return raw * 100;
  return raw;
}

function aggregatePlayerStats(games: NblGameLogRow[]): {
  minutes: number;
  games: number;
  stats: Record<string, number>;
} | null {
  const sum: Record<string, number> = {};
  const weight: Record<string, number> = {};
  const count: Record<string, number> = {};
  let minuteSum = 0;
  let n = 0;

  for (const g of games) {
    const mp = Number(g.minutes) || 0;
    if (mp < MIN_GAME_MINUTES) continue;
    minuteSum += mp;
    n += 1;
    for (const key of TEAM_PIE_STAT_KEYS) {
      if (RATIO_FROM_TOTALS.has(key)) continue;
      const val = readStat(g, key);
      if (val == null) continue;
      if (RATE_STATS.has(key)) {
        sum[key] = (sum[key] || 0) + val * mp;
        weight[key] = (weight[key] || 0) + mp;
      } else {
        sum[key] = (sum[key] || 0) + val;
        count[key] = (count[key] || 0) + 1;
      }
    }
  }

  if (n <= 0 || minuteSum <= 0) return null;
  const stats: Record<string, number> = {};
  for (const key of TEAM_PIE_STAT_KEYS) {
    if (RATIO_FROM_TOTALS.has(key)) continue;
    if (RATE_STATS.has(key)) {
      const w = weight[key] || 0;
      if (w > 0) stats[key] = round1((sum[key] || 0) / w);
    } else {
      const c = count[key] || 0;
      if (c > 0) stats[key] = round1((sum[key] || 0) / c);
    }
  }
  const possSum = sum.possUsed || 0;
  const ppp = nblPointsPerPossession(sum.points || 0, possSum);
  const app = nblAssistsPerPossession(sum.assists || 0, possSum);
  if (ppp != null) stats.ptsPerPoss = round2(ppp);
  if (app != null) stats.astPerPoss = round2(app);
  return { minutes: round1(minuteSum / n), games: n, stats };
}

export function loadNblTeamUsage(opts: {
  team: string;
  year: number;
  lastN?: number | null;
  includePlayerId?: string | null;
}): NblTeamUsagePlayer[] {
  const teamOfficial = resolveNblClubName(opts.team) || opts.team.trim();
  if (!teamOfficial) return [];

  const seen = new Set<string>();
  const roster = loadRoster(opts.year).filter((p) => {
    const id = String(p.playerId || '').trim();
    const name = String(p.name || '').trim();
    if (!id || !name) return false;
    if (seen.has(id)) return false;
    const club = p.team ? resolveNblClubName(p.team) || p.team.trim() : '';
    if (club !== teamOfficial && p.team?.trim() !== opts.team.trim()) return false;
    seen.add(id);
    return true;
  });

  const out: NblTeamUsagePlayer[] = [];
  for (const p of roster) {
    const playerId = String(p.playerId);
    const games = applyLastN(loadPlayerGames(playerId, opts.year), opts.lastN ?? null);
    const agg = aggregatePlayerStats(games);
    if (!agg) continue;
    const keep =
      String(opts.includePlayerId || '') === playerId ||
      (agg.games >= 1 && agg.minutes >= MIN_AVG_MINUTES);
    if (!keep) continue;
    out.push({
      playerId,
      name: String(p.name),
      usgPct: agg.stats.usgPct ?? 0,
      minutes: agg.minutes,
      games: agg.games,
      stats: agg.stats,
    });
  }

  return out.sort((a, b) => (b.stats.usgPct ?? 0) - (a.stats.usgPct ?? 0));
}
