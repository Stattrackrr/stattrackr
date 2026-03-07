/**
 * Shared DvP lookup for AFL props (list API and warm endpoint).
 * Maps opponent names to DvP file keys (afl-dvp-*.json uses short names).
 */

import path from 'path';
import fs from 'fs/promises';

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
  'north melbourne kangaroos': 'north melbourne', 'north melbourne': 'north melbourne',
  'port adelaide power': 'port adelaide', 'port adelaide': 'port adelaide',
  'richmond tigers': 'richmond', richmond: 'richmond',
  'st kilda saints': 'st kilda', 'st kilda': 'st kilda',
  'sydney swans': 'sydney', sydney: 'sydney',
  'west coast eagles': 'west coast', 'west coast': 'west coast',
  'western bulldogs': 'western bulldogs', footscray: 'western bulldogs',
};

export function normalizeOpponentForDvp(opponent: string): string {
  const s = (opponent || '').trim().toLowerCase();
  if (!s) return s;
  return OPPONENT_TO_DVP_KEY[s] ?? s.split(/\s+/)[0] ?? s;
}

export type DvpMaps = {
  /** Key: normalized "opponent|position" (e.g. "st kilda|def") for per-team, per-position rank. */
  disposals: Map<string, { rank: number; value: number }>;
  goals: Map<string, { rank: number; value: number }>;
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

type DvpFileRow = { opponent?: string; position?: string; perPlayerGame?: Record<string, number> };

/** Build DvP maps from file keyed by "opponent|position" so rank is per team and per position (DEF/MID/FWD/RUC). */
function buildFromFileRows(rows: DvpFileRow[], stat: 'disposals' | 'goals'): Map<string, { rank: number; value: number }> {
  const map = new Map<string, { rank: number; value: number }>();
  const byOpponentPosition = new Map<string, number>();
  for (const row of rows) {
    const opp = (row.opponent || '').trim().toLowerCase();
    const pos = (row.position || 'MID').trim().toUpperCase();
    if (!opp) continue;
    const val = Number(row.perPlayerGame?.[stat] ?? 0);
    const key = `${opp}|${pos}`;
    byOpponentPosition.set(key, val);
  }
  const positions = Array.from(new Set(byOpponentPosition.keys().map((k) => k.split('|')[1]).filter(Boolean)));
  for (const pos of positions) {
    const entries = Array.from(byOpponentPosition.entries())
      .filter(([k]) => k.endsWith(`|${pos}`))
      .map(([k, v]) => [k.replace(/\|[^|]+$/, ''), v] as [string, number]);
    const sorted = entries.sort((a, b) => b[1] - a[1]);
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

/** Load DvP maps by reading data/afl-dvp-{season}.json (avoids self-fetch in cron). */
export async function loadDvpMapsFromFiles(): Promise<DvpMaps> {
  const empty = { disposals: new Map(), goals: new Map() };
  const year = new Date().getFullYear();
  for (const season of [year, year - 1]) {
    if (season < 2020) continue;
    try {
      const filePath = path.join(process.cwd(), 'data', `afl-dvp-${season}.json`);
      const raw = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(raw) as { rows?: DvpFileRow[] };
      const rows = data?.rows ?? [];
      if (rows.length === 0) continue;
      const disposals = buildFromFileRows(rows, 'disposals');
      const goals = buildFromFileRows(rows, 'goals');
      if (disposals.size > 0 || goals.size > 0) {
        return { disposals, goals };
      }
    } catch {
      /* try next season */
    }
  }
  return empty;
}

/** Default position when unknown (MID is most common for disposals). */
const DEFAULT_DVP_POSITION = 'MID';

export function getDvpLookup(
  opponent: string,
  statType: string,
  maps: DvpMaps,
  position?: string | null
): { rank: number; value: number } | null {
  const opp = (opponent || '').trim().toLowerCase();
  const pos = (position || DEFAULT_DVP_POSITION).trim().toUpperCase();
  const m = statType === 'goals_over' ? maps.goals : maps.disposals;
  const normalized = normalizeOpponentForDvp(opponent);
  const tryKey = (o: string) => m.get(`${o}|${pos}`);
  let out = tryKey(opp) ?? (normalized ? tryKey(normalized) : null);
  if (out) return out;
  const prefix = `${opp}|`;
  const entry = Array.from(m.entries()).find(([k]) => k.startsWith(prefix) || (normalized && k.startsWith(`${normalized}|`)));
  if (entry) return entry[1];
  const legacyKey = m.get(opp) ?? (normalized ? m.get(normalized) : null);
  if (legacyKey) return legacyKey;
  const fallback = Array.from(m.entries()).find(([k]) => k.includes(opp) || (normalized && k.includes(normalized)));
  return fallback ? fallback[1] : null;
}
