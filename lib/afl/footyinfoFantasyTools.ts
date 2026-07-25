/**
 * FootyInfo fantasy-tools endpoints (CBA / kick-in trackers).
 */

import { fetchFootyinfoJson } from '@/lib/afl/footyinfoHttp';
import { footyinfoNameToOfficial } from '@/lib/afl/footyinfoTeamMapping';

export type FootyinfoFantasyTeam = {
  slug: string;
  name: string;
  abbrev: string;
};

export type RoleLeaderRow = {
  player: string;
  total: number;
  rate: number | null;
};

export type RoleLeadersResult = {
  leaders: RoleLeaderRow[];
  /** Full-season team total from the same tracker (all players, not top N). */
  teamTotal: number;
};

type Cell = { value?: unknown } | null | undefined;

function cellValue(row: Record<string, Cell>, key: string): unknown {
  const c = row?.[key];
  if (c == null) return null;
  if (typeof c === 'object' && 'value' in c) return c.value;
  return c;
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/%/g, '').replace(/,/g, '').trim();
    if (!cleaned || cleaned === '-' || cleaned === '—') return 0;
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function percent(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v <= 1 ? Math.round(v * 100) : v;
  const s = String(v).replace(/%/g, '').trim();
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Official / nickname / short name → fantasy-tools team slug. */
const OFFICIAL_TO_FANTASY_SLUG: Record<string, string> = {
  'Adelaide Crows': 'adelaide',
  'Brisbane Lions': 'brisbane',
  'Carlton Blues': 'carlton',
  'Collingwood Magpies': 'collingwood',
  'Essendon Bombers': 'essendon',
  'Fremantle Dockers': 'fremantle',
  'Geelong Cats': 'geelong',
  'Gold Coast Suns': 'gold-coast',
  'GWS Giants': 'gws',
  'Hawthorn Hawks': 'hawthorn',
  'Melbourne Demons': 'melbourne',
  'North Melbourne Kangaroos': 'north-melbourne',
  'Port Adelaide Power': 'port-adelaide',
  'Richmond Tigers': 'richmond',
  'St Kilda Saints': 'st-kilda',
  'Sydney Swans': 'sydney',
  'West Coast Eagles': 'west-coast',
  'Western Bulldogs': 'western-bulldogs',
};

const EXTRA_TEAM_SLUGS: Record<string, string> = {
  adelaide: 'adelaide',
  crows: 'adelaide',
  brisbane: 'brisbane',
  lions: 'brisbane',
  carlton: 'carlton',
  blues: 'carlton',
  collingwood: 'collingwood',
  magpies: 'collingwood',
  essendon: 'essendon',
  bombers: 'essendon',
  fremantle: 'fremantle',
  dockers: 'fremantle',
  geelong: 'geelong',
  cats: 'geelong',
  'gold coast': 'gold-coast',
  'gold-coast': 'gold-coast',
  suns: 'gold-coast',
  gws: 'gws',
  giants: 'gws',
  'greater western sydney': 'gws',
  hawthorn: 'hawthorn',
  hawks: 'hawthorn',
  melbourne: 'melbourne',
  demons: 'melbourne',
  'north melbourne': 'north-melbourne',
  'north-melbourne': 'north-melbourne',
  kangaroos: 'north-melbourne',
  'port adelaide': 'port-adelaide',
  'port-adelaide': 'port-adelaide',
  power: 'port-adelaide',
  richmond: 'richmond',
  tigers: 'richmond',
  'st kilda': 'st-kilda',
  'st-kilda': 'st-kilda',
  saints: 'st-kilda',
  sydney: 'sydney',
  swans: 'sydney',
  'west coast': 'west-coast',
  'west-coast': 'west-coast',
  eagles: 'west-coast',
  'western bulldogs': 'western-bulldogs',
  'western-bulldogs': 'western-bulldogs',
  bulldogs: 'western-bulldogs',
  footscray: 'western-bulldogs',
};

export function teamToFantasyToolsSlug(team: string | null | undefined): string | null {
  if (!team?.trim()) return null;
  const raw = team.trim();
  const official = footyinfoNameToOfficial(raw) || raw;
  if (OFFICIAL_TO_FANTASY_SLUG[official]) return OFFICIAL_TO_FANTASY_SLUG[official];
  const key = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (EXTRA_TEAM_SLUGS[key]) return EXTRA_TEAM_SLUGS[key];
  const dashed = key.replace(/\s+/g, '-');
  if (EXTRA_TEAM_SLUGS[dashed]) return EXTRA_TEAM_SLUGS[dashed];
  return dashed || null;
}

export async function fetchFootyinfoFantasyTeams(): Promise<FootyinfoFantasyTeam[]> {
  const res = await fetchFootyinfoJson<{ teams?: FootyinfoFantasyTeam[] }>('/fantasy-tools/teams');
  if (!res.ok || !Array.isArray(res.data.teams)) return [];
  return res.data.teams.filter((t) => t?.slug && t?.name);
}

type TrackerPayload = {
  rows?: Array<Record<string, Cell>>;
};

export async function fetchFootyinfoCbaLeaders(
  teamSlug: string,
  season: number,
  limit = 5
): Promise<RoleLeadersResult> {
  const res = await fetchFootyinfoJson<TrackerPayload>(
    `/fantasy-tools/cbas?team=${encodeURIComponent(teamSlug)}&season=${season}`
  );
  if (!res.ok) return { leaders: [], teamTotal: 0 };
  const rows = (res.data.rows ?? [])
    .map((row) => ({
      player: String(cellValue(row, 'player') ?? '').trim(),
      total: num(cellValue(row, 'total')),
      rate: percent(cellValue(row, 'avg_pct')),
    }))
    .filter((r) => r.player && r.total > 0)
    .sort((a, b) => b.total - a.total || (b.rate ?? 0) - (a.rate ?? 0));
  // CBA attendances overlap (multiple players at the same bounce), so this is
  // only useful as a ranking total — not a true "team centre bounces" count.
  const teamTotal = rows.reduce((sum, row) => sum + row.total, 0);
  return {
    leaders: rows.slice(0, Math.max(1, limit)),
    teamTotal,
  };
}

export async function fetchFootyinfoKickinLeaders(
  teamSlug: string,
  season: number,
  limit = 5
): Promise<RoleLeadersResult> {
  const res = await fetchFootyinfoJson<TrackerPayload>(
    `/fantasy-tools/kickins?team=${encodeURIComponent(teamSlug)}&season=${season}`
  );
  if (!res.ok) return { leaders: [], teamTotal: 0 };
  const parsed = (res.data.rows ?? [])
    .map((row) => ({
      player: String(cellValue(row, 'player') ?? '').trim(),
      total: num(cellValue(row, 'total_ki')),
    }))
    .filter((r) => r.player && r.total > 0)
    .sort((a, b) => b.total - a.total);
  // Each kick-in has one taker — sum of all players = true season team total.
  const teamTotal = parsed.reduce((sum, row) => sum + row.total, 0);
  const rows: RoleLeaderRow[] = parsed.map((row) => ({
    player: row.player,
    total: row.total,
    rate: teamTotal > 0 ? Math.round((row.total / teamTotal) * 100) : null,
  }));
  return {
    leaders: rows.slice(0, Math.max(1, limit)),
    teamTotal,
  };
}
