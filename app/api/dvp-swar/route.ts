export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import cache, { CACHE_TTL } from "@/lib/cache";
import { normalizeAbbr } from "@/lib/nbaAbbr";

export const runtime = "nodejs";

// NBA Stats base and headers
const NBA_BASE = "https://stats.nba.com/stats";
const NBA_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.nba.com",
  Referer: "https://www.nba.com/stats/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
  // Extra headers to improve acceptance by stats.nba.com
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "sec-ch-ua": "\"Chromium\";v=124, \"Google Chrome\";v=124, \"Not=A?Brand\";v=99",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"Windows\"",
};

// NBA TeamID mapping
const ABBR_TO_TEAM_ID_NBA: Record<string, number> = {
  ATL: 1610612737, BOS: 1610612738, BKN: 1610612751, CHA: 1610612766, CHI: 1610612741,
  CLE: 1610612739, DAL: 1610612742, DEN: 1610612743, DET: 1610612765, GSW: 1610612744,
  HOU: 1610612745, IND: 1610612754, LAC: 1610612746, LAL: 1610612747, MEM: 1610612763,
  MIA: 1610612748, MIL: 1610612749, MIN: 1610612750, NOP: 1610612740, NYK: 1610612752,
  OKC: 1610612760, ORL: 1610612753, PHI: 1610612755, PHX: 1610612756, POR: 1610612757,
  SAC: 1610612758, SAS: 1610612759, TOR: 1610612761, UTA: 1610612762, WAS: 1610612764,
};
const TEAM_ID_TO_ABBR_NBA: Record<number, string> = Object.fromEntries(
  Object.entries(ABBR_TO_TEAM_ID_NBA).map(([abbr, id]) => [id as any, abbr])
) as any;

function currentSeasonYear(): number {
  const now = new Date();
  const m = now.getMonth();
  const d = now.getDate();
  if (m === 9 && d >= 15) return now.getFullYear();
  return m >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}
function seasonLabelFromYear(y: number) {
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

async function nbaFetch(pathAndQuery: string) {
  const res = await fetch(`${NBA_BASE}/${pathAndQuery}`, { headers: NBA_HEADERS, cache: "no-store", redirect: 'follow' as any });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`NBA ${res.status}: ${t || pathAndQuery}`);
  }
  return res.json();
}

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

function idx(headers: string[], ...names: string[]) {
  const lower = headers.map(h => String(h || '').toLowerCase());
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

export async function GET(req: NextRequest) {
  const debug: string[] = [];
  try {
    const { searchParams } = new URL(req.url);
    const rawTeam = searchParams.get('team') || '';
    const team = normalizeAbbr(rawTeam);
    const metric = (searchParams.get('metric') || 'pts').toLowerCase();
    const gamesWindow = Math.min(parseInt(searchParams.get('games') || '20', 10) || 20, 50);
    const seasonYear = searchParams.get('season') ? parseInt(String(searchParams.get('season')), 10) : currentSeasonYear();

    if (!team) return NextResponse.json({ success: false, error: 'Missing team' }, { status: 400 });
    const teamId = ABBR_TO_TEAM_ID_NBA[team];
    if (!teamId) return NextResponse.json({ success: false, error: `Unknown team: ${team}` }, { status: 400 });

    const seasonLabel = seasonLabelFromYear(seasonYear);

    const cacheKey = `node:dvp:${team}:${seasonLabel}:${metric}:${gamesWindow}`;
    const hit = cache.get<any>(cacheKey);
    if (hit) return NextResponse.json(hit);

    const wantDebug = searchParams.get('debug') === '1';

    // 1) Get team's game log
    const gl = await nbaFetch(`teamgamelog?TeamID=${teamId}&Season=${encodeURIComponent(seasonLabel)}&SeasonType=${encodeURIComponent('Regular Season')}`);
    const rs = (gl?.resultSets || gl?.resultSet || []).find((r: any) => (r?.name || '').toLowerCase().includes('teamgamelog')) || gl?.resultSets?.[0];
    if (wantDebug) debug.push(`teamgamelog fetched: ${!!gl}, sets:${(gl?.resultSets||[]).length}`);
    const headers: string[] = rs?.headers || rs?.resultSets?.[0]?.headers || [];
    const rows: any[] = rs?.rowSet || [];
    const idxGameId = idx(headers, 'GAME_ID', 'Game_ID');
    const gameIds: string[] = idxGameId >= 0 ? rows.map(r => String(r[idxGameId])).slice(0, gamesWindow) : [];
    if (wantDebug) debug.push(`gameIds: ${gameIds.length}`);

    const totals = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
    let processed = 0;

    const host = req.headers.get('host') || undefined;
    for (const gid of gameIds) {
      if (!gid) continue;
      const bs = await nbaFetch(`boxscoretraditionalv2?GameID=${gid}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`);
      const pset = (bs?.resultSets || []).find((r: any) => (r?.name || '').toLowerCase().includes('playerstats')) || bs?.resultSets?.[0];
      if (wantDebug) debug.push(`gid ${gid}: sets=${(bs?.resultSets||[]).length}`);
      const h = pset?.headers || [];
      const rsRows: any[] = pset?.rowSet || [];
      const iTeamId = idx(h, 'TEAM_ID');
      const iTeamAbbr = idx(h, 'TEAM_ABBREVIATION');
      const iPlayer = idx(h, 'PLAYER_NAME');
      const iStartPos = idx(h, 'START_POSITION');

      // Determine opponent teamId from rows
      const oppRow = rsRows.find(r => Number(r[iTeamId]) !== teamId);
      if (!oppRow) { if (wantDebug) debug.push(`gid ${gid}: no oppRow`); continue; }
      const oppId = Number(oppRow[iTeamId]);
      const oppAbbr = TEAM_ID_TO_ABBR_NBA[oppId] || String(oppRow[iTeamAbbr] || '');
      const depthMap: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'> = await fetchDepthChartBuckets(oppAbbr, host).catch(() => ({}));

      const buckets = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;

      for (const r of rsRows) {
        const rowTeamId = Number(r[iTeamId]);
        if (rowTeamId !== oppId) continue; // only opponent players
        const playerName = String(r[iPlayer] || '');
        const startPos = String(r[iStartPos] || '').toUpperCase();
        const get = (k: string) => r[idx(h, k)];
        const val = metricFromRow({
          PTS: get('PTS'), REB: get('REB'), AST: get('AST'), FG3M: get('FG3M'), STL: get('STL'), BLK: get('BLK')
        }, metric);
        if (!val) continue;

        const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ').replace(/\s+/g, ' ').trim();
        const key = (depthMap[norm(playerName)] as any) as ('PG'|'SG'|'SF'|'PF'|'C'|undefined);
        if (key) {
          buckets[key] += val;
        } else {
          // Heuristic fallback without splitting into 3 buckets
          if (startPos === 'PG' || startPos === 'SG' || startPos === 'SF' || startPos === 'PF' || startPos === 'C') {
            (buckets as any)[startPos] += val;
          } else if (startPos === 'G') {
            const ast = Number(get('AST') || 0);
            buckets[ast >= 5 ? 'PG' : 'SG'] += val;
          } else if (startPos === 'F') {
            const reb = Number(get('REB') || 0);
            const blk = Number(get('BLK') || 0);
            buckets[(reb >= 8 || blk >= 2) ? 'PF' : 'SF'] += val;
          } else if (startPos === 'C') {
            buckets.C += val;
          } else {
            const reb = Number(get('REB') || 0);
            buckets[reb >= 7 ? 'PF' : 'C'] += val;
          }
        }
      }

      (['PG','SG','SF','PF','C'] as const).forEach(k => { totals[k] += buckets[k]; });
      processed += 1;
      if (wantDebug) debug.push(`gid ${gid}: buckets ${JSON.stringify(buckets)}`);
    }

    // Fallback: try previous season if none processed
    if (processed === 0) {
      const prevSeasonYear = seasonYear - 1;
      const prevLabel = seasonLabelFromYear(prevSeasonYear);
      const glPrev = await nbaFetch(`teamgamelog?TeamID=${teamId}&Season=${encodeURIComponent(prevLabel)}&SeasonType=${encodeURIComponent('Regular Season')}`);
      if (wantDebug) debug.push(`prev teamgamelog fetched: ${!!glPrev}`);
      const rsPrev = (glPrev?.resultSets || glPrev?.resultSet || []).find((r: any) => (r?.name || '').toLowerCase().includes('teamgamelog')) || glPrev?.resultSets?.[0];
      const headersPrev: string[] = rsPrev?.headers || [];
      const rowsPrev: any[] = rsPrev?.rowSet || [];
      const idxGameIdPrev = idx(headersPrev, 'GAME_ID', 'Game_ID');
      const gameIdsPrev: string[] = idxGameIdPrev >= 0 ? rowsPrev.map(r => String(r[idxGameIdPrev])).slice(0, gamesWindow) : [];

      let processedPrev = 0;
      const totalsPrev = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;

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
        const depthMap: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'> = await fetchDepthChartBuckets(oppAbbr, host).catch(() => ({}));

        const buckets = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
        const get = (r: any, k: string) => r[idx(h, k)];

        for (const r of rsRows) {
          if (Number(r[iTeamId]) !== oppId) continue;
          const playerName = String(r[iPlayer] || '');
          const startPos = String(r[iStartPos] || '').toUpperCase();
          const val = metricFromRow({
            PTS: get(r,'PTS'), REB: get(r,'REB'), AST: get(r,'AST'), FG3M: get(r,'FG3M'), STL: get(r,'STL'), BLK: get(r,'BLK')
          }, metric);
          if (!val) continue;

          const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ').replace(/\s+/g, ' ').trim();
          const key = (depthMap[norm(playerName)] as any) as ('PG'|'SG'|'SF'|'PF'|'C'|undefined);
          if (key) {
            buckets[key] += val;
          } else {
            if (startPos === 'PG' || startPos === 'SG' || startPos === 'SF' || startPos === 'PF' || startPos === 'C') {
              (buckets as any)[startPos] += val;
            } else if (startPos === 'G') {
              const ast = Number(get(r,'AST') || 0);
              buckets[ast >= 5 ? 'PG' : 'SG'] += val;
            } else if (startPos === 'F') {
              const reb = Number(get(r,'REB') || 0);
              const blk = Number(get(r,'BLK') || 0);
              buckets[(reb >= 8 || blk >= 2) ? 'PF' : 'SF'] += val;
            } else if (startPos === 'C') {
              buckets.C += val;
            } else {
              const reb = Number(get(r,'REB') || 0);
              buckets[reb >= 7 ? 'PF' : 'C'] += val;
            }
          }
        }
        (['PG','SG','SF','PF','C'] as const).forEach(k => { totalsPrev[k] += buckets[k]; });
        processedPrev += 1;
      }

      if (processedPrev > 0) {
        if (wantDebug) debug.push(`prev processed: ${processedPrev}`);
        const perGamePrev = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
        (['PG','SG','SF','PF','C'] as const).forEach(k => perGamePrev[k] = totalsPrev[k] / processedPrev);
        const payloadPrev = { success: true, team, season: prevLabel, metric, sample_games: processedPrev, perGame: perGamePrev, totals: totalsPrev };
        cache.set(cacheKey, payloadPrev, Math.max(15, Math.min(CACHE_TTL.ADVANCED_STATS, 60)));
        return NextResponse.json(payloadPrev, { status: 200 });
      }
    }

    const perGame = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
    if (processed > 0) (['PG','SG','SF','PF','C'] as const).forEach(k => perGame[k] = totals[k] / processed);

    const payload: any = { success: true, team, season: seasonLabel, metric, sample_games: processed, perGame, totals };
    if (wantDebug) payload.debug = debug;
    cache.set(cacheKey, payload, Math.max(15, Math.min(CACHE_TTL.ADVANCED_STATS, 60)));
    return NextResponse.json(payload, { status: 200 });
  } catch (e: any) {
    // Surface error and optional debug trail
    const msg = e?.message || 'Failed to compute Node DvP';
    return NextResponse.json({ success: false, error: msg, debug }, { status: 200 });
  }
}
