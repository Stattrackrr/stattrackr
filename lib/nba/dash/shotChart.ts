/**
 * NBA shot chart API data: player zones + heat points + assists by zone, and team
 * defense by zone, ranked league-wide from the stored shot summary.
 */
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { resolveNbaClub } from './teams';
import { getNbaPlayersInfo, getNbaSeasonDataset, selectAllParallel, type NbaPlayerInfo } from './season';
import { nbaShotSummaryJob, type NbaShotSummary, type NbaShotSummaryEntry } from './shotSummary';
import {
  NBA_SHOT_ZONE_IDS,
  emptyZoneStats,
  nbaShotCourtFeet,
  nbaZoneFromDb,
  nbaZoneIsThree,
  zoneStatsFromCounts,
  type NbaShotZoneId,
  type NbaZoneStat,
} from './shotZonesShared';

/** [across ft, depth ft from baseline, made 1/0, three 1/0] */
export type NbaShotPoint = [number, number, 0 | 1, 0 | 1];

const SUMMARY_TTL_MS = 30 * 60 * 1000;
const MIN_ZONE_FGA_FOR_PLAYER_RANK = 20;
const MIN_ZONE_FGA_FOR_TEAM_RANK = 20;
const MIN_FTA_FOR_RANK = 20;

const summaryCache = new Map<number, { at: number; promise: Promise<NbaShotSummary | null> }>();

export function loadNbaShotSummary(season: number): Promise<NbaShotSummary | null> {
  const hit = summaryCache.get(season);
  if (hit && Date.now() - hit.at < SUMMARY_TTL_MS) return hit.promise;
  const promise = (async () => {
    const { data, error } = await supabaseAdmin
      .from('nba_sync_state')
      .select('state')
      .eq('job', nbaShotSummaryJob(season))
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.state as NbaShotSummary | undefined) ?? null;
  })();
  summaryCache.set(season, { at: Date.now(), promise });
  promise.catch(() => summaryCache.delete(season));
  return promise;
}

async function summariesFor(years: number[]): Promise<NbaShotSummary[]> {
  const all = await Promise.all(years.map((y) => loadNbaShotSummary(y)));
  return all.filter((s): s is NbaShotSummary => !!s && s.shots > 0);
}

function mergeEntries(entries: Array<NbaShotSummaryEntry | undefined>): NbaShotSummaryEntry {
  const out: NbaShotSummaryEntry = { g: 0, z: {}, a: {} };
  for (const e of entries) {
    if (!e) continue;
    out.g += e.g;
    for (const id of NBA_SHOT_ZONE_IDS) {
      const z = e.z[id];
      if (z) {
        const t = (out.z[id] ??= [0, 0]);
        t[0] += z[0];
        t[1] += z[1];
      }
      if (e.a[id]) out.a[id] = (out.a[id] ?? 0) + e.a[id]!;
    }
  }
  return out;
}

function mergedMap(summaries: NbaShotSummary[], side: 'players' | 'defense'): Map<string, NbaShotSummaryEntry> {
  const keys = new Set(summaries.flatMap((s) => Object.keys(s[side])));
  return new Map([...keys].map((k) => [k, mergeEntries(summaries.map((s) => s[side][k]))]));
}

const zonePoints = (zone: NbaShotZoneId) => (nbaZoneIsThree(zone) ? 3 : 2);

function assistZoneStats(a: NbaShotSummaryEntry['a']): NbaZoneStat[] {
  return zoneStatsFromCounts(
    Object.fromEntries(NBA_SHOT_ZONE_IDS.map((id) => [id, [a[id] ?? 0, a[id] ?? 0] as [number, number]]))
  );
}

const normName = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export async function resolveNbaPlayer(name: string, team?: string | null): Promise<NbaPlayerInfo | null> {
  const players = await getNbaPlayersInfo();
  const want = normName(name);
  if (!want) return null;
  const club = team ? resolveNbaClub(team) : null;
  const hits = [...players.values()].filter((p) => normName(p.name) === want);
  if (!hits.length) return null;
  return (
    (club && hits.find((p) => String(p.currentTeamId) === club.id)) ||
    hits.find((p) => p.active) ||
    hits[0]!
  );
}

async function playerShotPoints(playerId: string, years: number[]): Promise<NbaShotPoint[]> {
  const rows = await selectAllParallel(() =>
    supabaseAdmin
      .from('nba_shots')
      .select('x, y, made, is_three, zone, game_id, play_order')
      .eq('shooter_id', Number(playerId))
      .in('season', years)
      .order('game_id')
      .order('play_order')
  );
  const out: NbaShotPoint[] = [];
  for (const r of rows) {
    if (r.x == null || r.y == null || !nbaZoneFromDb(r.zone)) continue;
    const { across, depth } = nbaShotCourtFeet(Number(r.x), Number(r.y));
    out.push([Math.round(across * 10) / 10, Math.round(depth * 10) / 10, r.made ? 1 : 0, r.is_three ? 1 : 0]);
  }
  return out;
}

async function ftTotals(years: number[]) {
  const sets = await Promise.all(years.map((y) => getNbaSeasonDataset(y)));
  const byPlayer = new Map<string, { ftm: number; fta: number; games: number }>();
  const byTeamAllowed = new Map<string, { ftm: number; fta: number; games: number; ptsAllowed: number }>();
  for (const data of sets) {
    for (const [id, logs] of data.logsByPlayer) {
      const b = byPlayer.get(id) ?? { ftm: 0, fta: 0, games: 0 };
      for (const g of logs) {
        b.ftm += Number(g.ftMade) || 0;
        b.fta += Number(g.ftAttempted) || 0;
        b.games += 1;
      }
      byPlayer.set(id, b);
    }
    for (const g of data.teamGames.values()) {
      const opp = data.teamGames.get(`${g.matchId}|${g.opponentCode}`);
      if (!opp) continue;
      const b = byTeamAllowed.get(g.teamCode) ?? { ftm: 0, fta: 0, games: 0, ptsAllowed: 0 };
      b.ftm += opp.ftm;
      b.fta += opp.fta;
      b.games += 1;
      b.ptsAllowed += opp.pts;
      byTeamAllowed.set(g.teamCode, b);
    }
  }
  return { byPlayer, byTeamAllowed };
}

export async function loadNbaPlayerShotChart(playerName: string, team: string | null, years: number[]) {
  const player = await resolveNbaPlayer(playerName, team);
  const summaries = await summariesFor(years);
  const usedYears = summaries.map((s) => s.season);
  if (!player || !summaries.length) return null;

  const all = mergedMap(summaries, 'players');
  const own = all.get(player.playerId) ?? { g: 0, z: {}, a: {} };
  const zones = zoneStatsFromCounts(own.z);
  const shotCount = zones.reduce((s, z) => s + z.fga, 0);

  const ranks = zones.map((zoneRow) => {
    const scored: Array<{ id: string; ptsPerGame: number; fgPct: number }> = [];
    for (const [id, e] of all) {
      const z = e.z[zoneRow.zone];
      if (!z || z[0] < MIN_ZONE_FGA_FOR_PLAYER_RANK || e.g <= 0) continue;
      scored.push({ id, ptsPerGame: (z[1] * zonePoints(zoneRow.zone)) / e.g, fgPct: z[1] / z[0] });
    }
    scored.sort((a, b) => b.ptsPerGame - a.ptsPerGame || b.fgPct - a.fgPct);
    const idx = scored.findIndex((s) => s.id === player.playerId);
    return {
      ...zoneRow,
      pts: zoneRow.fgm * zonePoints(zoneRow.zone),
      rank: idx >= 0 ? idx + 1 : null,
      playersCompared: scored.length,
    };
  });

  const [points, ft] = await Promise.all([playerShotPoints(player.playerId, usedYears), ftTotals(usedYears)]);
  const ownFt = ft.byPlayer.get(player.playerId) ?? { ftm: 0, fta: 0, games: 0 };
  const ftScored = [...ft.byPlayer]
    .filter(([, b]) => b.fta >= MIN_FTA_FOR_RANK && b.games > 0)
    .map(([id, b]) => ({ id, perGame: b.ftm / b.games }))
    .sort((a, b) => b.perGame - a.perGame);
  const ftIdx = ftScored.findIndex((s) => s.id === player.playerId);
  const assistZones = assistZoneStats(own.a);

  return {
    mode: 'player' as const,
    playerName: player.name,
    playerId: player.playerId,
    team,
    years: usedYears,
    gamesUsed: own.g,
    shotCount,
    zones,
    ranks,
    ftScoring: {
      ftm: ownFt.ftm,
      fta: ownFt.fta,
      ftPct: ownFt.fta > 0 ? (ownFt.ftm / ownFt.fta) * 100 : 0,
      games: ownFt.games,
      rank: ftIdx >= 0 ? ftIdx + 1 : null,
      playersCompared: ftScored.length,
    },
    points,
    assistCount: assistZones.reduce((s, z) => s + z.fga, 0),
    assistGamesUsed: own.g,
    assistZones,
  };
}

export async function loadNbaDefenseShotChart(teamInput: string, years: number[]) {
  const club = resolveNbaClub(teamInput);
  const summaries = await summariesFor(years);
  if (!club || !summaries.length) return null;
  const usedYears = summaries.map((s) => s.season);
  const all = mergedMap(summaries, 'defense');
  const own = all.get(club.code) ?? { g: 0, z: {}, a: {} };
  const zones = zoneStatsFromCounts(own.z);

  const ranks = zones.map((zoneRow) => {
    const scored: Array<{ code: string; fgPct: number }> = [];
    for (const [code, e] of all) {
      const z = e.z[zoneRow.zone];
      if (!z || z[0] < MIN_ZONE_FGA_FOR_TEAM_RANK) continue;
      scored.push({ code, fgPct: z[1] / z[0] });
    }
    scored.sort((a, b) => a.fgPct - b.fgPct);
    const idx = scored.findIndex((s) => s.code === club.code);
    return { ...zoneRow, rank: idx >= 0 ? idx + 1 : null, teamsCompared: scored.length };
  });

  const assistZones = assistZoneStats(own.a);
  const assistRanks = assistZones.map((zoneRow) => {
    const scored = [...all]
      .filter(([, e]) => e.g > 0)
      .map(([code, e]) => ({ code, rate: (e.a[zoneRow.zone] ?? 0) / e.g, count: e.a[zoneRow.zone] ?? 0 }))
      .sort((a, b) => a.rate - b.rate || a.count - b.count || a.code.localeCompare(b.code));
    const idx = scored.findIndex((s) => s.code === club.code);
    return {
      ...zoneRow,
      rank: idx >= 0 ? idx + 1 : null,
      teamsCompared: scored.length,
      astPerGame: own.g > 0 ? zoneRow.fga / own.g : 0,
    };
  });

  const ft = await ftTotals(usedYears);
  const ownFt = ft.byTeamAllowed.get(club.code) ?? { ftm: 0, fta: 0, games: 0, ptsAllowed: 0 };
  const ftScored = [...ft.byTeamAllowed]
    .filter(([, b]) => b.fta >= MIN_FTA_FOR_RANK)
    .map(([code, b]) => ({ code, ftPct: (b.ftm / b.fta) * 100 }))
    .sort((a, b) => a.ftPct - b.ftPct);
  const ftIdx = ftScored.findIndex((s) => s.code === club.code);

  return {
    mode: 'defense' as const,
    team: club.name,
    years: usedYears,
    gamesUsed: own.g,
    shotCount: zones.reduce((s, z) => s + z.fga, 0),
    zones,
    ranks,
    pointsAllowed: ownFt.ptsAllowed,
    ftDefense: {
      ftm: ownFt.ftm,
      fta: ownFt.fta,
      ftPct: ownFt.fta > 0 ? (ownFt.ftm / ownFt.fta) * 100 : 0,
      games: ownFt.games,
      rank: ftIdx >= 0 ? ftIdx + 1 : null,
      teamsCompared: ftScored.length,
    },
    assistRanks,
    assistDefenseGames: own.g,
    assistAllowed: assistZones.reduce((s, z) => s + z.fga, 0),
  };
}

/** Zone shares (0–1) per player for play-type tagging. */
export async function nbaPlayerZoneShares(season: number) {
  const summary = await loadNbaShotSummary(season);
  const out = new Map<string, { shots: number; games: number; restricted: number; paint: number; mid: number; three: number }>();
  if (!summary) return out;
  for (const [id, e] of Object.entries(summary.players)) {
    const fga = (zone: NbaShotZoneId) => e.z[zone]?.[0] ?? 0;
    const total = NBA_SHOT_ZONE_IDS.reduce((s, z) => s + fga(z), 0);
    if (total <= 0) continue;
    out.set(id, {
      shots: total,
      games: e.g,
      restricted: fga('restricted') / total,
      paint: fga('paint') / total,
      mid: fga('midRange') / total,
      three: (fga('leftCorner3') + fga('rightCorner3') + fga('aboveBreak3')) / total,
    });
  }
  return out;
}

export { emptyZoneStats };
