/**
 * Shared DvP lookup for AFL props (list API and warm endpoint).
 * All team names are normalized via aflTeamMapping so we never get wrong matches.
 */

import path from 'path';
import fs from 'fs/promises';
import { getAflDvpPayloadFromCache } from '@/lib/aflDvpCache';
import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';

/** Official name (lowercase) or common variant -> canonical DvP key used in file/cache. */
const OPPONENT_TO_DVP_KEY: Record<string, string> = {
  'adelaide crows': 'adelaide', adelaide: 'adelaide',
  'brisbane lions': 'brisbane', brisbane: 'brisbane',
  'carlton blues': 'carlton', carlton: 'carlton',
  'collingwood magpies': 'collingwood', collingwood: 'collingwood',
  'essendon bombers': 'essendon', essendon: 'essendon',
  'fremantle dockers': 'fremantle', fremantle: 'fremantle',
  'geelong cats': 'geelong', geelong: 'geelong',
  'gold coast suns': 'gold coast', 'gold coast': 'gold coast',
  'gws giants': 'gws', 'greater western sydney giants': 'gws', gws: 'gws',
  'hawthorn hawks': 'hawthorn', hawthorn: 'hawthorn',
  'melbourne demons': 'melbourne', melbourne: 'melbourne',
  'north melbourne kangaroos': 'north melbourne', 'north melbourne': 'north melbourne', north: 'north melbourne', kangaroos: 'north melbourne',
  'port adelaide power': 'port adelaide', 'port adelaide': 'port adelaide', port: 'port adelaide', power: 'port adelaide',
  'richmond tigers': 'richmond', richmond: 'richmond', tigers: 'richmond',
  'st kilda saints': 'st kilda', 'st kilda': 'st kilda', saints: 'st kilda',
  'sydney swans': 'sydney', sydney: 'sydney', swans: 'sydney',
  'west coast eagles': 'west coast', 'west coast': 'west coast', eagles: 'west coast',
  'western bulldogs': 'western bulldogs', footscray: 'western bulldogs', bulldogs: 'western bulldogs',
  crows: 'adelaide', lions: 'brisbane', blues: 'carlton', magpies: 'collingwood', bombers: 'essendon',
  dockers: 'fremantle', cats: 'geelong', suns: 'gold coast', giants: 'gws', hawks: 'hawthorn', demons: 'melbourne',
};

/** Normalize any team/opponent string to canonical DvP key (official name first, then map). */
export function normalizeOpponentForDvp(opponent: string): string {
  const s = (opponent || '').trim();
  if (!s) return '';
  const official = toOfficialAflTeamDisplayName(s).trim().toLowerCase();
  if (!official) return s.toLowerCase();
  return OPPONENT_TO_DVP_KEY[official] ?? OPPONENT_TO_DVP_KEY[s.toLowerCase()] ?? official;
}

export type DvpMaps = {
  /** Key: normalized "opponent|position". Per-team vs position (avg stat allowed per team game); rank 1 = easiest (highest value). */
  disposals: Map<string, { rank: number; value: number }>;
  goals: Map<string, { rank: number; value: number }>;
  /** Team-total rank/value: rank 1 = hardest (lowest allowed). Matches dashboard DVP batch API. Optional when loaded from HTTP API. */
  disposalsTeamTotal?: Map<string, { rank: number; value: number }>;
  goalsTeamTotal?: Map<string, { rank: number; value: number }>;
};

export const DVP_POSITIONS = ['DEF', 'MID', 'FWD', 'RUC'] as const;
export type DvpPosition = (typeof DVP_POSITIONS)[number];

export async function loadDvpMaps(origin: string): Promise<DvpMaps> {
  const currentYear = new Date().getFullYear();
  const build = (data: { rows?: Array<{ opponent?: string; rank?: number; value?: number }> } | null) => {
    const map = new Map<string, { rank: number; value: number }>();
    if (!data?.rows) return map;
    for (const row of data.rows) {
      const key = (row.opponent || '').trim().toLowerCase();
      if (!key) continue;
      const rank = typeof row.rank === 'number' ? row.rank : 0;
      const value = typeof row.value === 'number' ? row.value : 0;
      const existing = map.get(key);
      if (!existing || rank < existing.rank) {
        const entry = { rank, value };
        map.set(key, entry);
        for (const [full, short] of Object.entries(OPPONENT_TO_DVP_KEY))
          if (short === key) map.set(full, entry);
      }
    }
    return map;
  };
  const trySeason = async (season: number) => {
    const [disp, goals] = await Promise.all([
      fetch(`${origin}/api/afl/dvp?season=${season}&stat=disposals&order=desc&top=100`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${origin}/api/afl/dvp?season=${season}&stat=goals&order=desc&top=100`).then((r) => (r.ok ? r.json() : null)),
    ]);
    const d = build(disp);
    const g = build(goals);
    return { disposals: d, goals: g, hasData: d.size > 0 || g.size > 0 };
  };
  let result = await trySeason(currentYear);
  if (!result.hasData && currentYear > 2020) {
    const fallback = await trySeason(currentYear - 1);
    if (fallback.hasData) result = fallback;
  }
  return { disposals: result.disposals, goals: result.goals };
}

type DvpFileRow = { opponent?: string; position?: string; perPlayerGame?: Record<string, number>; perTeamGame?: Record<string, number | null> };

/** Build DvP maps from file keyed by "opponent|position". Prefers perTeamGame (per team vs position), rank 1 = easiest (desc). Normalises all team names so file variants match lookups. */
function buildFromFileRows(rows: DvpFileRow[], stat: 'disposals' | 'goals'): Map<string, { rank: number; value: number }> {
  const map = new Map<string, { rank: number; value: number }>();
  const byOpponentPosition = new Map<string, number>();
  for (const row of rows) {
    const oppKey = normalizeOpponentForDvp((row.opponent || '').trim());
    const pos = (row.position || 'MID').trim().toUpperCase();
    if (!oppKey) continue;
    const val = Number(row.perTeamGame?.[stat] ?? row.perPlayerGame?.[stat] ?? 0);
    const key = `${oppKey}|${pos}`;
    byOpponentPosition.set(key, val);
  }
  const positions = Array.from(new Set(byOpponentPosition.keys().map((k) => k.split('|')[1]).filter(Boolean)));
  for (const pos of positions) {
    const entries = Array.from(byOpponentPosition.entries())
      .filter(([k]) => k.endsWith(`|${pos}`))
      .map(([k, v]) => [k.replace(/\|[^|]+$/, ''), v] as [string, number]);
    const sorted = entries.sort((a, b) => b[1] - a[1]); // high->low so rank 1 = easiest (highest value), matches dashboard
    sorted.forEach(([opp, value], i) => {
      const rank = i + 1;
      const key = `${opp}|${pos}`;
      map.set(key, { rank, value });
      const shortKey = normalizeOpponentForDvp(opp) || opp;
      map.set(`${shortKey}|${pos}`, { rank, value });
      for (const [full, short] of Object.entries(OPPONENT_TO_DVP_KEY))
        if (short === shortKey || short === opp) map.set(`${full}|${pos}`, { rank, value });
    });
  }
  return map;
}

/** Build team-total DvP maps: rank 1 = hardest (lowest value), matches dashboard /api/afl/dvp/batch. */
function buildTeamTotalFromFileRows(rows: DvpFileRow[], stat: 'disposals' | 'goals'): Map<string, { rank: number; value: number }> {
  const map = new Map<string, { rank: number; value: number }>();
  const byOpponentPosition = new Map<string, number>();
  for (const row of rows) {
    const oppKey = normalizeOpponentForDvp((row.opponent || '').trim());
    const pos = (row.position || 'MID').trim().toUpperCase();
    if (!oppKey) continue;
    const val = Number(row.perTeamGame?.[stat] ?? row.perPlayerGame?.[stat] ?? 0);
    const key = `${oppKey}|${pos}`;
    byOpponentPosition.set(key, val);
  }
  const positions = Array.from(new Set(byOpponentPosition.keys().map((k) => k.split('|')[1]).filter(Boolean)));
  for (const pos of positions) {
    const entries = Array.from(byOpponentPosition.entries())
      .filter(([k]) => k.endsWith(`|${pos}`))
      .map(([k, v]) => [k.replace(/\|[^|]+$/, ''), v] as [string, number]);
    const sorted = entries.sort((a, b) => a[1] - b[1]); // low->high so rank 1 = hardest (lowest value)
    sorted.forEach(([opp, value], i) => {
      const rank = i + 1;
      const key = `${opp}|${pos}`;
      map.set(key, { rank, value });
      const shortKey = normalizeOpponentForDvp(opp) || opp;
      map.set(`${shortKey}|${pos}`, { rank, value });
      for (const [full, short] of Object.entries(OPPONENT_TO_DVP_KEY))
        if (short === shortKey || short === opp) map.set(`${full}|${pos}`, { rank, value });
    });
  }
  return map;
}

/** Load DvP maps: cache first (cron on Vercel), then data/afl-dvp-{season}.json. */
export async function loadDvpMapsFromFiles(): Promise<DvpMaps> {
  const empty: DvpMaps = {
    disposals: new Map(),
    goals: new Map(),
    disposalsTeamTotal: new Map(),
    goalsTeamTotal: new Map(),
  };
  const year = new Date().getFullYear();
  for (const season of [year, year - 1]) {
    if (season < 2020) continue;
    try {
      const cached = await getAflDvpPayloadFromCache(season);
      const rows = cached?.rows ?? [];
      if (rows.length > 0) {
        const disposals = buildFromFileRows(rows as DvpFileRow[], 'disposals');
        const goals = buildFromFileRows(rows as DvpFileRow[], 'goals');
        const disposalsTeamTotal = buildTeamTotalFromFileRows(rows as DvpFileRow[], 'disposals');
        const goalsTeamTotal = buildTeamTotalFromFileRows(rows as DvpFileRow[], 'goals');
        if (disposals.size > 0 || goals.size > 0) return { disposals, goals, disposalsTeamTotal, goalsTeamTotal };
      }
      const filePath = path.join(process.cwd(), 'data', `afl-dvp-${season}.json`);
      const raw = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(raw) as { rows?: DvpFileRow[] };
      const fileRows = data?.rows ?? [];
      if (fileRows.length === 0) continue;
      const disposals = buildFromFileRows(fileRows, 'disposals');
      const goals = buildFromFileRows(fileRows, 'goals');
      const disposalsTeamTotal = buildTeamTotalFromFileRows(fileRows, 'disposals');
      const goalsTeamTotal = buildTeamTotalFromFileRows(fileRows, 'goals');
      if (disposals.size > 0 || goals.size > 0) return { disposals, goals, disposalsTeamTotal, goalsTeamTotal };
    } catch {
      /* try next season */
    }
  }
  return empty;
}

/** Default position when unknown (MID is most common for disposals). */
const DEFAULT_DVP_POSITION = 'MID';

/** Lookup per-player DvP (rank 1 = easiest). Do not fall back to another position. */
export function getDvpLookup(
  opponent: string,
  statType: string,
  maps: DvpMaps,
  position?: string | null
): { rank: number; value: number } | null {
  const pos = (position || DEFAULT_DVP_POSITION).trim().toUpperCase();
  const m = statType === 'goals_over' ? maps.goals : maps.disposals;
  const key = `${normalizeOpponentForDvp((opponent || '').trim())}|${pos}`;
  return m.get(key) ?? null;
}

/** Lookup team-total DvP (rank 1 = hardest). Matches dashboard /api/afl/dvp/batch. Use for props list so ranks match dashboard. */
export function getDvpLookupTeamTotal(
  opponent: string,
  statType: string,
  maps: DvpMaps,
  position?: string | null
): { rank: number; value: number } | null {
  const pos = (position || DEFAULT_DVP_POSITION).trim().toUpperCase();
  const m = statType === 'goals_over' ? maps.goalsTeamTotal : maps.disposalsTeamTotal;
  if (!m?.size) return null;
  const key = `${normalizeOpponentForDvp((opponent || '').trim())}|${pos}`;
  return m.get(key) ?? null;
}
