/**
 * Props-page NBA DvP: the dashboard's Defense vs Position (BettingPros, same ranking as
 * /api/dvp/rank) at the player's depth-chart slot, falling back to the roster position.
 */

import { NextRequest } from 'next/server';
import { GET as depthChartGET } from '@/app/api/depth-chart/route';
import { calculateSelectedPosition } from '@/app/nba/research/dashboard/utils/positionUtils';
import { fetchBettingProsData, OUR_TO_BP_ABBR, OUR_TO_BP_METRIC } from '@/lib/bettingpros-dvp';
import { NBA_TEAMS, normalizeAbbr } from '@/lib/nbaAbbr';

export type NbaDvpPosition = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

export type NbaPropDvp = {
  dvpRating: number | null;
  dvpStatValue: number | null;
  dvpFieldSize: number | null;
};

const EMPTY: NbaPropDvp = { dvpRating: null, dvpStatValue: null, dvpFieldSize: null };

const STAT_METRICS: Record<string, string[]> = {
  points: ['pts'],
  rebounds: ['reb'],
  assists: ['ast'],
  threeMade: ['fg3m'],
  pra: ['pts', 'reb', 'ast'],
  pr: ['pts', 'reb'],
  pa: ['pts', 'ast'],
  ra: ['reb', 'ast'],
};

/** BDL lists G / F / C (and hybrids); same fallback as the dashboard. */
export function nbaDvpPositionFromRoster(position: string | null | undefined): NbaDvpPosition | null {
  const p = String(position || '').toUpperCase().replace(/[^A-Z-]/g, '');
  if (!p) return null;
  if (p === 'PG' || p === 'SG' || p === 'SF' || p === 'PF' || p === 'C') return p;
  const first = p.split('-')[0];
  if (first === 'G') return 'SG';
  if (first === 'F') return p.includes('C') ? 'PF' : 'SF';
  if (first === 'C') return 'C';
  return null;
}

type RankTable = Map<string, { rank: number; value: number }>;

export type NbaPropDvpIndex = {
  positionFor: (player: { playerId?: string | null; name: string; teamCode?: string | null; position?: string | null }) => NbaDvpPosition | null;
  lookup: (opts: { opponentCode: string | null | undefined; position: NbaDvpPosition | null; stat: string }) => NbaPropDvp;
};

async function loadDepthChart(teamCode: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await depthChartGET(
      new NextRequest(`http://localhost/api/depth-chart?team=${encodeURIComponent(teamCode)}`, {
        headers: { 'user-agent': 'StatTrackr-Internal' },
      })
    );
    const json = (await res.json()) as { success?: boolean; depthChart?: Record<string, unknown> };
    return json?.success && json.depthChart ? json.depthChart : null;
  } catch {
    return null;
  }
}

export async function buildNbaPropDvpIndex(teamCodes: string[]): Promise<NbaPropDvpIndex> {
  const [bp, depthEntries] = await Promise.all([
    fetchBettingProsData().catch(() => null),
    Promise.all([...new Set(teamCodes.filter(Boolean))].map(async (code) => [code, await loadDepthChart(code)] as const)),
  ]);
  const depth = new Map(depthEntries.filter(([, chart]) => chart != null));
  const teamStats = (bp as { teamStats?: Record<string, Record<string, Record<string, unknown>>> } | null)?.teamStats;

  const tables = new Map<string, RankTable>();
  const rankTable = (position: NbaDvpPosition, stat: string): RankTable | null => {
    const metrics = STAT_METRICS[stat];
    if (!teamStats || !metrics) return null;
    const key = `${position}|${stat}`;
    const hit = tables.get(key);
    if (hit) return hit;
    const values: Array<{ team: string; value: number }> = [];
    for (const team of Object.keys(NBA_TEAMS)) {
      const abbr = normalizeAbbr(team);
      const row = teamStats[OUR_TO_BP_ABBR[abbr] || abbr];
      const posData = row?.[position] || row?.ALL;
      if (!posData) continue;
      let total = 0;
      let complete = true;
      for (const metric of metrics) {
        const v = Number(posData[OUR_TO_BP_METRIC[metric] || metric]);
        if (posData[OUR_TO_BP_METRIC[metric] || metric] == null || !Number.isFinite(v)) {
          complete = false;
          break;
        }
        total += v;
      }
      if (complete) values.push({ team: abbr, value: total });
    }
    values.sort((a, b) => a.value - b.value);
    const table: RankTable = new Map(values.map((row, i) => [row.team, { rank: i + 1, value: row.value }]));
    tables.set(key, table);
    return table;
  };

  return {
    positionFor: (player) => {
      const chart = player.teamCode ? depth.get(player.teamCode) : null;
      if (chart) {
        const slot = calculateSelectedPosition({
          propsMode: 'player',
          selectedPlayer: { id: player.playerId || player.name, full: player.name },
          playerTeamRoster: chart as never,
          allTeamRosters: {},
          originalPlayerTeam: '',
        });
        if (slot) return slot;
      }
      return nbaDvpPositionFromRoster(player.position);
    },
    lookup: ({ opponentCode, position, stat }) => {
      if (!opponentCode || !position) return EMPTY;
      const table = rankTable(position, stat);
      const hit = table?.get(normalizeAbbr(opponentCode));
      if (!table || !hit) return EMPTY;
      return {
        dvpRating: hit.rank,
        dvpStatValue: Math.round(hit.value * 10) / 10,
        dvpFieldSize: table.size,
      };
    },
  };
}
