export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import cache, { CACHE_TTL } from "@/lib/cache";
import { normalizeAbbr } from "@/lib/nbaAbbr";

export const runtime = "nodejs";

// NBA Stats base
const NBA_BASE = "https://stats.nba.com/stats";

// Required headers for stats.nba.com
const NBA_HEADERS: Record<string, string> = {
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://www.nba.com",
  "Referer": "https://www.nba.com/stats/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

// NBA TeamID mapping
const ABBR_TO_TEAM_ID_NBA: Record<string, number> = {
  ATL: 1610612737,
  BOS: 1610612738,
  BKN: 1610612751,
  CHA: 1610612766,
  CHI: 1610612741,
  CLE: 1610612739,
  DAL: 1610612742,
  DEN: 1610612743,
  DET: 1610612765,
  GSW: 1610612744,
  HOU: 1610612745,
  IND: 1610612754,
  LAC: 1610612746,
  LAL: 1610612747,
  MEM: 1610612763,
  MIA: 1610612748,
  MIL: 1610612749,
  MIN: 1610612750,
  NOP: 1610612740,
  NYK: 1610612752,
  OKC: 1610612760,
  ORL: 1610612753,
  PHI: 1610612755,
  PHX: 1610612756,
  POR: 1610612757,
  SAC: 1610612758,
  SAS: 1610612759,
  TOR: 1610612761,
  UTA: 1610612762,
  WAS: 1610612764,
};

const TEAM_ID_TO_ABBR_NBA: Record<number, string> = Object.fromEntries(
  Object.entries(ABBR_TO_TEAM_ID_NBA).map(([abbr, id]) => [id as any, abbr])
) as any;

function currentNbaSeason(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  // NBA season label like "2024-25"
  if (m >= 9) return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  return `${y - 1}-${String(y % 100).padStart(2, '0')}`;
}

async function nbaFetch(pathAndQuery: string) {
  const res = await fetch(`${NBA_BASE}/${pathAndQuery}`, { headers: NBA_HEADERS, cache: "no-store" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`NBA ${res.status}: ${t || pathAndQuery}`);
  }
  return res.json();
}

// Use ESPN depth chart mapping to refine PG/SG/SF/PF/C by name
async function fetchDepthChartBuckets(teamAbbr: string, host?: string): Promise<Record<string, 'PG'|'SG'|'SF'|'PF'|'C'>> {
  try {
    const t = normalizeAbbr(teamAbbr);
    const base = host ? `http://${host}` : (process.env.NEXT_PUBLIC_BASE_URL || '');
    const url = base ? `${base}/api/depth-chart?team=${encodeURIComponent(t)}` : `/api/depth-chart?team=${encodeURIComponent(t)}`;
    const res = await fetch(url);
    if (!res.ok) return {} as any;
    const js = await res.json().catch(() => ({}));
    const dc = js?.depthChart || {};
    const map: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'> = {};
    const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ').replace(/\s+/g, ' ').trim();
    (['PG','SG','SF','PF','C'] as const).forEach((k) => {
      const arr = Array.isArray(dc[k]) ? dc[k] : [];
      arr.forEach((p: any) => { const name = typeof p === 'string' ? p : p?.name; if (name) map[norm(name)] = k; });
    });
    return map;
  } catch {
    return {} as any;
  }
}

function metricFromRow(row: any, metric: string): number {
  const m = metric.toLowerCase();
  switch (m) {
    case 'pts': return Number(row?.PTS) || 0;
    case 'reb': return Number(row?.REB) || 0;
    case 'ast': return Number(row?.AST) || 0;
    case 'fg3m': return Number(row?.FG3M) || 0;
    case 'stl': return Number(row?.STL) || 0;
    case 'blk': return Number(row?.BLK) || 0;
    default: return Number(row?.PTS) || 0;
  }
}

function splitToBuckets(pos: string, value: number, buckets: Record<'PG'|'SG'|'SF'|'PF'|'C', number>) {
  const p = (pos || '').toUpperCase();
  if (p === 'PG') buckets.PG += value;
  else if (p === 'SG') buckets.SG += value;
  else if (p === 'SF') buckets.SF += value;
  else if (p === 'PF') buckets.PF += value;
  else if (p === 'C') buckets.C += value;
  else if (p.includes('G')) { buckets.PG += value / 2; buckets.SG += value / 2; }
  else if (p.includes('F')) { buckets.SF += value / 2; buckets.PF += value / 2; }
  else { buckets.C += value; }
}

function idx(headers: string[], ...names: string[]) {
  const lower = headers.map(h => String(h || '').toLowerCase());
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

export async function GET(req: NextRequest) {
  // This route is currently disabled - the NBA stats API requires different authentication
  return NextResponse.json({ success: false, error: 'This endpoint is disabled. Use /api/dvp instead.' }, { status: 410 });
  
  /* Original implementation commented out - structural issues need fixing
  try {
    const { searchParams } = new URL(req.url);
    const rawTeam = searchParams.get('team') || '';
    const team = normalizeAbbr(rawTeam);
    const metric = (searchParams.get('metric') || 'pts').toLowerCase();
    const gamesWindow = Math.min(parseInt(searchParams.get('games') || '20', 10) || 20, 50);
    const seasonLabel = searchParams.get('season') || currentNbaSeason();

    if (!team) return NextResponse.json({ success: false, error: 'Missing team' }, { status: 400 });
    const teamId = ABBR_TO_TEAM_ID_NBA[team];
    if (!teamId) return NextResponse.json({ success: false, error: `Unknown team: ${team}` }, { status: 400 });

const cacheKey = `nba:dvp:v2:${team}:${seasonLabel}:${metric}:${gamesWindow}`;
    const hit = cache.get<any>(cacheKey);
    if (hit) return NextResponse.json(hit);

    // 1) Get team's game log (Regular Season)
    const gl = await nbaFetch(`teamgamelog?TeamID=${teamId}&Season=${encodeURIComponent(seasonLabel)}&SeasonType=Regular+Season`);
    const rs = (gl?.resultSets || gl?.resultSet || []).find((r: any) => (r?.name || '').toLowerCase().includes('teamgamelog')) || gl?.resultSets?.[0];
    const headers: string[] = rs?.headers || rs?.resultSets?.[0]?.headers || [];
    const rows: any[] = rs?.rowSet || [];
    const idxGameId = idx(headers, 'GAME_ID', 'Game_ID');
    const gameIds: string[] = idxGameId >= 0 ? rows.map(r => String(r[idxGameId])).slice(0, gamesWindow) : [];

    // Preload depth charts per opponent abbr we’ll discover from boxscores
    const totals = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
    let processed = 0;

    const nameNorm = (s: string) => (s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ').replace(/\s+/g, ' ').trim();

    const host = req.headers.get('host') || undefined;

    for (const gid of gameIds) {
      if (!gid) continue;
      const bs = await nbaFetch(`boxscoretraditionalv2?GameID=${gid}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`);
      const pset = (bs?.resultSets || []).find((r: any) => (r?.name || '').toLowerCase().includes('playerstats')) || bs?.resultSets?.[0];
      const h = pset?.headers || [];
      const rsRows: any[] = pset?.rowSet || [];
      const iTeamId = idx(h, 'TEAM_ID');
      const iTeamAbbr = idx(h, 'TEAM_ABBREVIATION');
      const iPlayer = idx(h, 'PLAYER_NAME');
      const iStartPos = idx(h, 'START_POSITION');

      // Determine opponent teamId from rows
      const oppRow = rsRows.find(r => Number(r[iTeamId]) !== teamId);
      if (!oppRow) continue;
      const oppId = Number(oppRow[iTeamId]);
      const oppAbbr = TEAM_ID_TO_ABBR_NBA[oppId] || String(oppRow[iTeamAbbr] || '');
      const depthMap = await fetchDepthChartBuckets(oppAbbr, host).catch(() => ({}));

      const buckets = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;

      for (const r of rsRows) {
        const rowTeamId = Number(r[iTeamId]);
        if (rowTeamId !== oppId) continue; // only opponent players
        const playerName = String(r[iPlayer] || '');
        const startPos = String(r[iStartPos] || '').toUpperCase();
        const get = (k: string) => r[idx(h, k)];
        const val = metricFromRow({
          PTS: get('PTS'),
          REB: get('REB'),
          AST: get('AST'),
          FG3M: get('FG3M'),
          STL: get('STL'),
          BLK: get('BLK'),
        }, metric);
        if (!val) continue;

        const key = (depthMap[nameNorm(playerName)] as any) as ('PG'|'SG'|'SF'|'PF'|'C'|undefined);
        if (key) {
          buckets[key] += val;
        } else {
          splitToBuckets(startPos, val, buckets);
        }
      }

      (['PG','SG','SF','PF','C'] as const).forEach(k => { totals[k] += buckets[k]; });
      processed += 1;
    }

    // Fallback: if no processed games this season, try last season
    if (processed === 0) {
      const [y1, y2] = seasonLabel.split('-');
      const prevLabel = (() => {
        const sy = parseInt(y1, 10) - 1; const ey = parseInt(y1, 10);
        return `${sy}-${String(ey % 100).padStart(2,'0')}`;
      })();
      const glPrev = await nbaFetch(`teamgamelog?TeamID=${teamId}&Season=${encodeURIComponent(prevLabel)}&SeasonType=Regular+Season`);
      const rsPrev = (glPrev?.resultSets || glPrev?.resultSet || []).find((r: any) => (r?.name || '').toLowerCase().includes('teamgamelog')) || glPrev?.resultSets?.[0];
      const headersPrev: string[] = rsPrev?.headers || [];
      const rowsPrev: any[] = rsPrev?.rowSet || [];
      const idxGameIdPrev = idx(headersPrev, 'GAME_ID', 'Game_ID');
      const gameIdsPrev: string[] = idxGameIdPrev >= 0 ? rowsPrev.map(r => String(r[idxGameIdPrev])).slice(0, gamesWindow) : [];

      const totalsPrev = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
      let processedPrev = 0;

      for (const gid of gameIdsPrev) {
        if (!gid) continue;
        const bs = await nbaFetch(`boxscoretraditionalv2?GameID=${gid}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`);
        const pset = (bs?.resultSets || []).find((r: any) => (r?.name || '').toLowerCase().includes('playerstats')) || bs?.resultSets?.[0];
        const h = pset?.headers || [];
        const rsRows: any[] = pset?.rowSet || [];
        const iTeamId = idx(h, 'TEAM_ID');
        const iTeamAbbr = idx(h, 'TEAM_ABBREVIATION');
        const iPlayer = idx(h, 'PLAYER_NAME');
        const iStartPos = idx(h, 'START_POSITION');

        const oppRow = rsRows.find(r => Number(r[iTeamId]) !== teamId);
        if (!oppRow) continue;
        const oppId = Number(oppRow[iTeamId]);
        const oppAbbr = TEAM_ID_TO_ABBR_NBA[oppId] || String(oppRow[iTeamAbbr] || '');
        const depthMap = await fetchDepthChartBuckets(oppAbbr, host).catch(() => ({}));

        const buckets = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;

        for (const r of rsRows) {
          const rowTeamId = Number(r[iTeamId]);
          if (rowTeamId !== oppId) continue;
          const playerName = String(r[iPlayer] || '');
          const startPos = String(r[iStartPos] || '').toUpperCase();
          const get = (k: string) => r[idx(h, k)];
          const val = metricFromRow({
            PTS: get('PTS'),
            REB: get('REB'),
            AST: get('AST'),
            FG3M: get('FG3M'),
            STL: get('STL'),
            BLK: get('BLK'),
          }, metric);
          if (!val) continue;

          const key = (depthMap[nameNorm(playerName)] as any) as ('PG'|'SG'|'SF'|'PF'|'C'|undefined);
          if (key) {
            buckets[key] += val;
          } else {
            splitToBuckets(startPos, val, buckets);
          }
        }

        (['PG','SG','SF','PF','C'] as const).forEach(k => { totalsPrev[k] += buckets[k]; });
        processedPrev += 1;
      }

      if (processedPrev > 0) {
        const perGamePrev = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
        (['PG','SG','SF','PF','C'] as const).forEach(k => perGamePrev[k] = totalsPrev[k] / processedPrev);
        const payloadPrev = { success: true, team, season: prevLabel, metric, sample_games: processedPrev, perGame: perGamePrev, totals: totalsPrev };
        cache.set(cacheKey, payloadPrev, Math.max(15, Math.min(CACHE_TTL.ADVANCED_STATS, 60)));
        return NextResponse.json(payloadPrev, { status: 200 });
      }
    }

    const perGame = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
    if (processed > 0) (['PG','SG','SF','PF','C'] as const).forEach(k => perGame[k] = totals[k] / processed);

    const payload = { success: true, team, season: seasonLabel, metric, sample_games: processed, perGame, totals };
    cache.set(cacheKey, payload, Math.max(15, Math.min(CACHE_TTL.ADVANCED_STATS, 60))); // 15-60 min
    return NextResponse.json(payload, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Failed to compute NBA DvP' }, { status: 200 });
  }
  */
}
