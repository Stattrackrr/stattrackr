/**
 * FootyInfo match metadata + box-score player stats.
 */

import { fetchFootyinfoJson } from '@/lib/afl/footyinfoHttp';
import {
  footyinfoAbbrevToOfficial,
  footyinfoNameToOfficial,
} from '@/lib/afl/footyinfoTeamMapping';

export type FootyinfoMatchMeta = {
  match_date?: string;
  match_time?: string;
  utc?: number;
  date?: number;
  rd?: string;
  venue?: string;
  slug?: string;
  h_name?: string;
  a_name?: string;
  h_abbrev?: string;
  a_abbrev?: string;
  hsc?: number;
  asc?: number;
  hs?: number;
  as?: number;
  sts?: string;
  st?: string;
  home_stats?: { player_stats?: FootyinfoLineupPlayer[]; player_ins?: FootyinfoLineupChange[]; player_outs?: FootyinfoLineupChange[] };
  away_stats?: { player_stats?: FootyinfoLineupPlayer[]; player_ins?: FootyinfoLineupChange[]; player_outs?: FootyinfoLineupChange[] };
};

export type FootyinfoLineupPlayer = {
  n?: string;
  no?: number;
  pos?: number;
  pi?: number;
};

export type FootyinfoLineupChange = { n?: string; pi?: number; new?: boolean; rea?: string | null };

export async function fetchFootyinfoMatchMeta(
  matchId: number
): Promise<FootyinfoMatchMeta | null> {
  if (!Number.isFinite(matchId) || matchId <= 0) return null;
  const res = await fetchFootyinfoJson<FootyinfoMatchMeta & { gda?: string; gdn?: string }>(
    `/match/${matchId}`
  );
  if (!res.ok) return null;
  return {
    ...res.data,
    venue: res.data.gda || res.data.gdn || res.data.venue,
  };
}

export type FootyinfoBoxScorePlayer = {
  playerName: string;
  playerSlug: string | null;
  guernsey: number | null;
  disposals: number;
  kicks: number;
  handballs: number;
  marks: number;
  tackles: number;
  goals: number;
  behinds: number;
  hitouts: number;
  percent_played: number | null;
  teamOfficial: string;
  positionSlot: number | null;
};

type Cell = { value?: unknown; linkSlug?: string; linkId?: number };

function cellVal(row: Record<string, Cell>, key: string): unknown {
  const c = row?.[key];
  if (c && typeof c === 'object' && 'value' in c) return c.value;
  return null;
}

function parseBoxSide(
  side: { rows?: Array<Record<string, Cell>> } | undefined,
  teamOfficial: string
): FootyinfoBoxScorePlayer[] {
  const out: FootyinfoBoxScorePlayer[] = [];
  for (const row of side?.rows ?? []) {
    const name = String(cellVal(row, 'player') || cellVal(row, 'player_short') || '').trim();
    if (!name) continue;
    const goalsRaw = String(cellVal(row, 'goals') ?? '');
    const gm = goalsRaw.match(/^(\d+)\.(\d+)$/);
    out.push({
      playerName: name,
      playerSlug: (row.player as Cell)?.linkSlug || (row.player_short as Cell)?.linkSlug || null,
      guernsey: (() => {
        const g = cellVal(row, 'guernsey');
        const n = Number(g);
        return Number.isFinite(n) ? n : null;
      })(),
      disposals: Number(cellVal(row, 'disposals')) || 0,
      kicks: Number(cellVal(row, 'kicks')) || 0,
      handballs: Number(cellVal(row, 'handballs')) || 0,
      marks: Number(cellVal(row, 'marks')) || 0,
      tackles: Number(cellVal(row, 'tackles')) || 0,
      goals: gm ? Number(gm[1]) : Number(cellVal(row, 'goals_num')) || 0,
      behinds: gm ? Number(gm[2]) : Number(cellVal(row, 'behinds')) || 0,
      hitouts: Number(cellVal(row, 'hitouts')) || 0,
      percent_played: (() => {
        const t = cellVal(row, 'time_on_ground');
        if (t == null) return null;
        const n = Number.parseFloat(String(t).replace('%', ''));
        return Number.isFinite(n) ? n : null;
      })(),
      teamOfficial,
      positionSlot: null,
    });
  }
  return out;
}

function parsePublishedLineup(
  players: FootyinfoLineupPlayer[] | undefined,
  teamOfficial: string
): FootyinfoBoxScorePlayer[] {
  return (players ?? [])
    .map((player) => ({
      playerName: String(player.n || '').trim(),
      playerSlug: null,
      guernsey: Number.isFinite(Number(player.no)) ? Number(player.no) : null,
      disposals: 0,
      kicks: 0,
      handballs: 0,
      marks: 0,
      tackles: 0,
      goals: 0,
      behinds: 0,
      hitouts: 0,
      percent_played: null,
      teamOfficial,
      positionSlot: Number.isFinite(Number(player.pos)) ? Number(player.pos) : null,
    }))
    .filter((player) => player.playerName);
}

export async function fetchFootyinfoMatchBoxScore(matchId: number): Promise<{
  meta: FootyinfoMatchMeta | null;
  home: FootyinfoBoxScorePlayer[];
  away: FootyinfoBoxScorePlayer[];
} | null> {
  const meta = await fetchFootyinfoMatchMeta(matchId);
  const stats = await fetchFootyinfoJson<{
    home?: { rows?: Array<Record<string, Cell>> };
    away?: { rows?: Array<Record<string, Cell>> };
  }>(`/match/${matchId}/player_stats`);
  if (!stats.ok) return null;
  const homeOfficial =
    footyinfoAbbrevToOfficial(meta?.h_abbrev) ||
    footyinfoNameToOfficial(meta?.h_name) ||
    meta?.h_name ||
    'Home';
  const awayOfficial =
    footyinfoAbbrevToOfficial(meta?.a_abbrev) ||
    footyinfoNameToOfficial(meta?.a_name) ||
    meta?.a_name ||
    'Away';
  return {
    meta,
    home: (() => {
      const published = parsePublishedLineup(meta?.home_stats?.player_stats, homeOfficial);
      return published.length ? published : parseBoxSide(stats.data.home, homeOfficial);
    })(),
    away: (() => {
      const published = parsePublishedLineup(meta?.away_stats?.player_stats, awayOfficial);
      return published.length ? published : parseBoxSide(stats.data.away, awayOfficial);
    })(),
  };
}
