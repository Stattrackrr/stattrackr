import { NextRequest, NextResponse } from 'next/server';
import { rosterTeamToInjuryTeam, getFootyWireTeamNameForPlayerUrl, footywireNicknameToOfficial } from '@/lib/aflTeamMapping';
import {
  buildAflPlayerLogsCacheKey,
  getAflPlayerLogsCache,
  setAflPlayerLogsCache,
  isAflPlayerLogsCacheEnabled,
  type AflPlayerLogsCachePayload,
} from '@/lib/cache/aflPlayerLogsCache';

const FOOTYWIRE_BASE = 'https://www.footywire.com';
const FOOTYWIRE_TTL_MS = 1000 * 60 * 60; // 1 hour
const FOOTYWIRE_SCHEMA_VERSION = 'v6';
let footyWireCache: Map<string, { expiresAt: number; games: GameLogRow[]; height: string | null; guernsey: number | null }> = new Map();
const footyWireMatchCache = new Map<string, { expiresAt: number; data: FootyWireMatchQuarterRows | null }>();

type FootyWireTableRow = { cells: string[]; matchId: number | null };

type FootyWireMatchQuarterRow = {
  final: number | null;
  cumulative: [number, number, number, number] | null;
  goalsCumulative: [number, number, number, number] | null;
  goalsFinal: number | null;
};

type FootyWireMatchQuarterRows = {
  rows: FootyWireMatchQuarterRow[];
};

type GameLogRow = {
  season: number;
  game_number: number;
  opponent: string;
  round: string;
  /** Game date YYYY-MM-DD when available (e.g. from FootyWire Date column); used for journal resolution. */
  date?: string;
  result: string;
  guernsey: number | null;
  kicks: number;
  marks: number;
  handballs: number;
  disposals: number;
  goals: number;
  behinds: number;
  hitouts: number;
  tackles: number;
  rebounds: number;
  inside_50s: number;
  clearances: number;
  intercepts: number;
  tackles_inside_50: number;
  score_involvements: number;
  meters_gained: number;
  clangers: number;
  free_kicks_for: number;
  free_kicks_against: number;
  brownlow_votes: number;
  contested_possessions: number;
  uncontested_possessions: number;
  contested_marks: number;
  marks_inside_50: number;
  one_percenters: number;
  bounces: number;
  goal_assists: number;
  percent_played: number | null;
  effective_disposals: number;
  disposal_efficiency: number; // percentage 0–100
  match_url: string | null;
  team_q1?: number;
  team_q2?: number;
  team_q3?: number;
  team_q4?: number;
  opponent_q1?: number;
  opponent_q2?: number;
  opponent_q3?: number;
  opponent_q4?: number;
  team_goals?: number;
  opponent_goals?: number;
  team_goal_q1?: number;
  team_goal_q2?: number;
  team_goal_q3?: number;
  team_goal_q4?: number;
  opponent_goal_q1?: number;
  opponent_goal_q2?: number;
  opponent_goal_q3?: number;
  opponent_goal_q4?: number;
};

function htmlToText(v: string): string {
  const decoded = v
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    // Decode numeric HTML entities like &#x2199; and &#8595;
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#([0-9]+);/g, (_, dec: string) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
  return decoded.replace(/\s+/g, ' ').trim();
}

function cleanResultLabel(raw: string): string {
  return String(raw || '')
    // Remove directional arrows and misc arrow symbols carried by some source rows.
    .replace(/[\u2190-\u21ff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- FootyWire (player game logs) ----------
function footyWireGameLogUrl(teamName: string, playerName: string, year: number, advanced = false): string {
  const teamSlug = teamName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const playerSlug = playerName.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const base = `${FOOTYWIRE_BASE}/afl/footy/pg-${teamSlug}--${playerSlug}?year=${year}`;
  return advanced ? `${base}&advv=Y` : base;
}

function descriptionToRound(description: string): string {
  const t = description.trim();
  const m = t.match(/Round\s*(\d+)/i);
  if (m) return 'R' + m[1];
  if (/Preliminary\s*Final/i.test(t)) return 'PF';
  if (/Qualifying\s*Final/i.test(t)) return 'QF';
  if (/Semi\s*Final/i.test(t)) return 'SF';
  if (/Grand\s*Final/i.test(t)) return 'GF';
  if (/Elimination\s*Final/i.test(t)) return 'EF';
  return t || '—';
}

function parseFootyWireGameLogTable(html: string): { headers: string[]; rows: FootyWireTableRow[] } {
  const result = { headers: [] as string[], rows: [] as FootyWireTableRow[] };
  if (!html || !html.includes('footywire')) return result;
  const gamesLogBlock = html.match(/Games Log for[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i);
  const tableContent = gamesLogBlock ? gamesLogBlock[1] : html;
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows: FootyWireTableRow[] = [];
  let trm: RegExpExecArray | null;
  while ((trm = trRegex.exec(tableContent)) !== null) {
    const cells: string[] = [];
    const rawCells: string[] = [];
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)(?=<t[dh]\b|$)/gi;
    let cm: RegExpExecArray | null;
    while ((cm = tdRegex.exec(trm[1])) !== null) {
      rawCells.push(cm[1]);
      cells.push(htmlToText(cm[1]).trim());
    }
    if (cells.length >= 5) {
      let matchId: number | null = null;
      for (const raw of rawCells) {
        const mid = raw.match(/ft_match_statistics\?mid=(\d+)/i);
        if (mid?.[1]) {
          const n = parseInt(mid[1], 10);
          if (Number.isFinite(n)) {
            matchId = n;
            break;
          }
        }
      }
      rows.push({ cells, matchId });
    }
  }
  const headerIdx = rows.findIndex(
    (r) =>
      r.cells.some((c) => /^Description$/i.test(c)) &&
      r.cells.some((c) => /^Opponent$/i.test(c)) &&
      r.cells.some((c) => /^Result$/i.test(c)) &&
      (r.cells.some((c) => /^K$/i.test(c)) || r.cells.some((c) => /^CP$/i.test(c)))
  );
  if (headerIdx < 0) return result;
  result.headers = rows[headerIdx].cells;
  result.rows = rows.slice(headerIdx + 1).filter((r) => {
    const first = (r.cells[0] || '').trim();
    if (!first) return false;
    const hasRound = /Round|Final|Semi|Qualifying|Preliminary|Grand|Description/i.test(first) || /^R\d+$/i.test(first);
    const hasNumbers = r.cells.some((c, i) => i >= 4 && /^\d+$/.test(String(c)));
    return hasRound && !/^Date$/i.test(first) && (hasNumbers || r.cells.length >= 10);
  });
  return result;
}

function colIndex(headers: string[], name: string): number {
  const i = headers.findIndex((h) => h.toUpperCase() === name.toUpperCase());
  return i >= 0 ? i : -1;
}

function footyWireRowToGameLogRow(row: string[], headers: string[], season: number): GameLogRow {
  const get = (key: string): string => {
    const i = colIndex(headers, key);
    return i >= 0 ? (row[i] ?? '').trim() : '';
  };
  const num = (key: string): number => parseIntSafe(get(key));
  const description = get('Description');
  const round = descriptionToRound(description);
  const opponent = get('Opponent') || '—';
  const result = cleanResultLabel(get('Result')) || '—';
  const dateRaw = get('Date').trim();
  let date: string | undefined;
  if (dateRaw) {
    let d = new Date(dateRaw);
    if (Number.isFinite(d.getTime())) {
      // If parsed year is way off from season (e.g. "27 Sept 01" -> 2001 instead of 2025), use season year
      const parsedYear = d.getFullYear();
      if (Math.abs(parsedYear - season) > 1) {
        d = new Date(season, d.getMonth(), d.getDate());
      }
      date = d.toISOString().slice(0, 10);
    }
  }
  return {
    season,
    game_number: 0, // FootyWire doesn't expose game number; chart uses index
    opponent,
    round,
    ...(date && { date }),
    result,
    guernsey: null,
    kicks: num('K'),
    marks: num('M'),
    handballs: num('HB'),
    disposals: num('D'),
    goals: num('G'),
    behinds: num('B'),
    hitouts: num('HO'),
    tackles: num('T'),
    rebounds: num('R50'),
    inside_50s: num('I50'),
    clearances: num('CL'),
    intercepts: 0,
    tackles_inside_50: 0,
    score_involvements: 0,
    meters_gained: 0,
    clangers: num('CG'),
    free_kicks_for: num('FF'),
    free_kicks_against: num('FA'),
    brownlow_votes: 0,
    contested_possessions: 0,
    uncontested_possessions: 0,
    contested_marks: 0,
    marks_inside_50: 0,
    one_percenters: 0,
    bounces: 0,
    goal_assists: num('GA'),
    percent_played: null,
    effective_disposals: 0,
    disposal_efficiency: 0,
    match_url: null,
  };
}

/** Get numeric value from advanced row; support "1%", "TOG%", "DE%", "MG", "ITC" and common alternate headers. */
function advNum(row: string[], headers: string[], name: string): number {
  let i = colIndex(headers, name);
  if (i < 0 && name === '1%') i = headers.findIndex((h) => /^1\s*%$|^1%$/i.test(h.trim()));
  if (i < 0 && name === 'TOG%') i = headers.findIndex((h) => /TOG\s*%|TOG%|Time\s*on\s*Ground\s*%?/i.test(h.trim()));
  if (i < 0 && (name === 'DE%' || name === 'DE')) i = headers.findIndex((h) => /^DE\s*%$|^DE%$|Disposal\s*Efficiency/i.test(h.trim()) || h.trim().toUpperCase() === 'DE');
  if (i < 0 && name === 'ITC') i = headers.findIndex((h) => /^ITC$|^INT$|^INTERCEPTS?$/i.test(h.trim()));
  if (i < 0 && name === 'TI5') i = headers.findIndex((h) => /^TI5$|^T5$|^TACKLES?\s*INSIDE\s*50$/i.test(h.trim()));
  if (i < 0 && name === 'MG') i = headers.findIndex((h) => /^MG$|Metres?\s*Gained|Meters?\s*Gained/i.test(h.trim()));
  if (i < 0 && name === 'SI') i = headers.findIndex((h) => /^SI$|Score\s*Involvements?/i.test(h.trim()));
  if (i < 0 && name === 'CP') i = headers.findIndex((h) => /^CP$|Contested\s*Possessions?/i.test(h.trim()));
  if (i < 0 && name === 'UP') i = headers.findIndex((h) => /^UP$|Uncontested\s*Possessions?/i.test(h.trim()));
  if (i < 0 && name === 'ED') i = headers.findIndex((h) => /^ED$|Effective\s*Disposals?/i.test(h.trim()));
  if (i < 0) return 0;
  const v = (row[i] ?? '').trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Extract advanced stats from one FootyWire advanced table row into partial GameLogRow. */
function footyWireAdvancedRowToPartial(row: string[], headers: string[], season: number): Partial<GameLogRow> {
  return {
    contested_possessions: advNum(row, headers, 'CP'),
    uncontested_possessions: advNum(row, headers, 'UP'),
    contested_marks: advNum(row, headers, 'CM'),
    marks_inside_50: advNum(row, headers, 'MI5'),
    one_percenters: advNum(row, headers, '1%'),
    bounces: advNum(row, headers, 'BO'),
    percent_played: advNum(row, headers, 'TOG%') || null,
    effective_disposals: advNum(row, headers, 'ED'),
    disposal_efficiency: advNum(row, headers, 'DE%'),
    meters_gained: advNum(row, headers, 'MG'),
    intercepts: advNum(row, headers, 'ITC'),
    tackles_inside_50: advNum(row, headers, 'TI5'),
    score_involvements: advNum(row, headers, 'SI'),
  };
}

/** Compute disposal_efficiency from effective_disposals / disposals when DE% column is missing (FootyWire advanced has ED but not DE%). Round up to nearest integer. */
function applyDisposalEfficiency(games: GameLogRow[]): void {
  for (const g of games) {
    if (g.disposal_efficiency === 0 && g.disposals > 0 && g.effective_disposals >= 0) {
      const pct = (g.effective_disposals / g.disposals) * 100;
      g.disposal_efficiency = Math.ceil(pct);
    }
  }
}

function parseResultScores(result: string): { teamFinal: number; opponentFinal: number } | null {
  const m = String(result || '').match(/(\d+)\s*-\s*(\d+)/);
  if (!m) return null;
  const teamFinal = parseInt(m[1], 10);
  const opponentFinal = parseInt(m[2], 10);
  if (!Number.isFinite(teamFinal) || !Number.isFinite(opponentFinal)) return null;
  return { teamFinal, opponentFinal };
}

function parseGoalsBehindsToPoints(cellText: string): number | null {
  const text = String(cellText || '').trim();
  if (!text) return null;
  const gb = text.match(/(\d+)\s*\.\s*(\d+)/);
  if (gb) {
    const goals = parseInt(gb[1], 10);
    const behinds = parseInt(gb[2], 10);
    if (Number.isFinite(goals) && Number.isFinite(behinds)) return goals * 6 + behinds;
  }
  const n = parseInt(text, 10);
  return Number.isFinite(n) ? n : null;
}

function parseGoalsFromGoalsBehinds(cellText: string): number | null {
  const m = String(cellText || '').trim().match(/(\d+)\s*\.\s*(\d+)/);
  if (!m) return null;
  const goals = parseInt(m[1], 10);
  return Number.isFinite(goals) ? goals : null;
}

function parseFootyWireMatchQuarterRows(html: string): FootyWireMatchQuarterRows | null {
  const tableMatch = html.match(/<table[^>]*id=["']matchscoretable["'][^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch?.[1]) return null;

  const tableBody = tableMatch[1];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows: string[][] = [];
  let tr: RegExpExecArray | null = trRegex.exec(tableBody);
  while (tr) {
    const rowCells: string[] = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)(?=<t[dh]\b|$)/gi;
    let cm: RegExpExecArray | null = cellRegex.exec(tr[1]);
    while (cm) {
      rowCells.push(htmlToText(cm[1]).trim());
      cm = cellRegex.exec(tr[1]);
    }
    if (rowCells.length > 0) rows.push(rowCells);
    tr = trRegex.exec(tableBody);
  }
  if (rows.length < 3) return null;

  const header = rows[0].map((c) => c.toUpperCase());
  const q1Idx = header.findIndex((c) => c === 'Q1');
  const q2Idx = header.findIndex((c) => c === 'Q2');
  const q3Idx = header.findIndex((c) => c === 'Q3');
  const q4Idx = header.findIndex((c) => c === 'Q4');
  const finalIdx = header.findIndex((c) => c === 'FINAL');
  if (q1Idx < 0 || q2Idx < 0 || q3Idx < 0 || q4Idx < 0 || finalIdx < 0) return null;

  const parsed: FootyWireMatchQuarterRow[] = [];
  for (const row of rows.slice(1)) {
    const c1 = parseGoalsBehindsToPoints(row[q1Idx] ?? '');
    const c2 = parseGoalsBehindsToPoints(row[q2Idx] ?? '');
    const c3 = parseGoalsBehindsToPoints(row[q3Idx] ?? '');
    const c4 = parseGoalsBehindsToPoints(row[q4Idx] ?? '');
    const g1 = parseGoalsFromGoalsBehinds(row[q1Idx] ?? '');
    const g2 = parseGoalsFromGoalsBehinds(row[q2Idx] ?? '');
    const g3 = parseGoalsFromGoalsBehinds(row[q3Idx] ?? '');
    const g4 = parseGoalsFromGoalsBehinds(row[q4Idx] ?? '');
    const final = parseGoalsBehindsToPoints(row[finalIdx] ?? '');
    const cumulative =
      c1 != null && c2 != null && c3 != null && c4 != null && c2 >= c1 && c3 >= c2 && c4 >= c3
        ? ([c1, c2, c3, c4] as [number, number, number, number])
        : null;
    const goalsCumulative =
      g1 != null && g2 != null && g3 != null && g4 != null && g2 >= g1 && g3 >= g2 && g4 >= g3
        ? ([g1, g2, g3, g4] as [number, number, number, number])
        : null;
    const goalsFinal = parseGoalsFromGoalsBehinds(row[q4Idx] ?? '');
    parsed.push({ final, cumulative, goalsCumulative, goalsFinal });
  }

  const valid = parsed.filter((r) => r.cumulative != null).slice(0, 2);
  if (valid.length < 2) return null;
  return { rows: valid };
}

async function fetchFootyWireMatchQuarterRows(matchId: number): Promise<FootyWireMatchQuarterRows | null> {
  const cacheKey = `${FOOTYWIRE_SCHEMA_VERSION}:${matchId}`;
  const cached = footyWireMatchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const url = `${FOOTYWIRE_BASE}/afl/footy/ft_match_statistics?mid=${matchId}`;
    const res = await fetch(url, { headers: FOOTYWIRE_HEADERS, next: { revalidate: 60 * 60 } });
    if (!res.ok) {
      footyWireMatchCache.set(cacheKey, { expiresAt: Date.now() + FOOTYWIRE_TTL_MS, data: null });
      return null;
    }
    const html = await res.text();
    const data = parseFootyWireMatchQuarterRows(html);
    footyWireMatchCache.set(cacheKey, { expiresAt: Date.now() + FOOTYWIRE_TTL_MS, data });
    return data;
  } catch {
    footyWireMatchCache.set(cacheKey, { expiresAt: Date.now() + FOOTYWIRE_TTL_MS, data: null });
    return null;
  }
}

function splitCumulativeToQuarter(c: [number, number, number, number]): [number, number, number, number] {
  return [c[0], c[1] - c[0], c[2] - c[1], c[3] - c[2]];
}

async function fetchFootyWireQuarterSplitForResult(
  matchId: number,
  resultLabel: string
): Promise<Pick<
  GameLogRow,
  'team_q1' | 'team_q2' | 'team_q3' | 'team_q4' | 'opponent_q1' | 'opponent_q2' | 'opponent_q3' | 'opponent_q4' | 'team_goals' | 'opponent_goals'
  | 'team_goal_q1' | 'team_goal_q2' | 'team_goal_q3' | 'team_goal_q4'
  | 'opponent_goal_q1' | 'opponent_goal_q2' | 'opponent_goal_q3' | 'opponent_goal_q4'
> | null> {
  const scores = parseResultScores(resultLabel);
  if (!scores) return null;
  const parsed = await fetchFootyWireMatchQuarterRows(matchId);
  if (!parsed || parsed.rows.length < 2) return null;

  const [a, b] = parsed.rows;
  const aFinal = a.final;
  const bFinal = b.final;
  if (a.cumulative == null || b.cumulative == null || aFinal == null || bFinal == null) return null;

  let teamRow = a;
  let oppRow = b;
  const directMatch = aFinal === scores.teamFinal && bFinal === scores.opponentFinal;
  const swappedMatch = bFinal === scores.teamFinal && aFinal === scores.opponentFinal;
  if (!directMatch && swappedMatch) {
    teamRow = b;
    oppRow = a;
  } else if (!directMatch && !swappedMatch) {
    const aDistance = Math.abs(aFinal - scores.teamFinal) + Math.abs(bFinal - scores.opponentFinal);
    const bDistance = Math.abs(bFinal - scores.teamFinal) + Math.abs(aFinal - scores.opponentFinal);
    if (bDistance < aDistance) {
      teamRow = b;
      oppRow = a;
    }
  }

  const teamCumulative = teamRow.cumulative;
  const oppCumulative = oppRow.cumulative;
  if (teamCumulative == null || oppCumulative == null) return null;

  const teamQ = splitCumulativeToQuarter(teamCumulative);
  const oppQ = splitCumulativeToQuarter(oppCumulative);
  const teamGoalQ = teamRow.goalsCumulative ? splitCumulativeToQuarter(teamRow.goalsCumulative) : null;
  const oppGoalQ = oppRow.goalsCumulative ? splitCumulativeToQuarter(oppRow.goalsCumulative) : null;
  return {
    team_q1: teamQ[0],
    team_q2: teamQ[1],
    team_q3: teamQ[2],
    team_q4: teamQ[3],
    opponent_q1: oppQ[0],
    opponent_q2: oppQ[1],
    opponent_q3: oppQ[2],
    opponent_q4: oppQ[3],
    team_goals: teamRow.goalsFinal ?? undefined,
    opponent_goals: oppRow.goalsFinal ?? undefined,
    team_goal_q1: teamGoalQ?.[0],
    team_goal_q2: teamGoalQ?.[1],
    team_goal_q3: teamGoalQ?.[2],
    team_goal_q4: teamGoalQ?.[3],
    opponent_goal_q1: oppGoalQ?.[0],
    opponent_goal_q2: oppGoalQ?.[1],
    opponent_goal_q3: oppGoalQ?.[2],
    opponent_goal_q4: oppGoalQ?.[3],
  };
}

function parseFootyWireProfile(html: string): { height: string | null; guernsey: number | null } {
  let height: string | null = null;
  let guernsey: number | null = null;
  const heightMatch = html.match(/Height:\s*(\d+)\s*cm/i);
  if (heightMatch?.[1]) height = `${heightMatch[1]} cm`;
  const guernseyMatch = html.match(/#(\d+)\s*<\/?b>/i) ?? html.match(/playerProfileTeamDiv[\s\S]*?#(\d+)/i);
  if (guernseyMatch?.[1]) {
    const n = parseInt(guernseyMatch[1], 10);
    if (Number.isFinite(n)) guernsey = n;
  }
  return { height, guernsey };
}

const FOOTYWIRE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
  Referer: 'https://www.footywire.com/',
};

async function fetchFootyWireGameLogs(
  teamName: string,
  playerName: string,
  season: number,
  includeQuarterEnrichment = false
): Promise<{ games: GameLogRow[]; height: string | null; guernsey: number | null; player_name: string } | null> {
  const cacheKey = `${FOOTYWIRE_SCHEMA_VERSION}|${teamName}|${playerName}|${season}|quarters:${includeQuarterEnrichment ? '1' : '0'}`;
  const cached = footyWireCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { games: cached.games, height: cached.height, guernsey: cached.guernsey, player_name: playerName.trim() };
  }
  const url = footyWireGameLogUrl(teamName, playerName, season);
  const advUrl = footyWireGameLogUrl(teamName, playerName, season, true);
  const fetchOpts = { headers: FOOTYWIRE_HEADERS, next: { revalidate: 60 * 60 } as RequestInit['next'] };
  const [res, advResInitial] = await Promise.all([
    fetch(url, fetchOpts),
    fetch(advUrl, fetchOpts),
  ]);
  if (!res.ok) return null;
  const html = await res.text();
  const { headers, rows } = parseFootyWireGameLogTable(html);
  if (headers.length === 0 || rows.length === 0) return null;
  const games: GameLogRow[] = rows.map((row, idx) => {
    const g = footyWireRowToGameLogRow(row.cells, headers, season);
    g.game_number = idx + 1;
    return g;
  });

  // Merge advanced stats (CP, UP, CM, MI5, 1%, BO, TOG%, ED). Retry advanced fetch once on failure (helps production where first request can timeout).
  let advRes = advResInitial;
  if (!advRes.ok) {
    advRes = await fetch(advUrl, fetchOpts);
  }
  if (advRes.ok) {
    const advHtml = await advRes.text();
    const adv = parseFootyWireGameLogTable(advHtml);
    if (adv.headers.length > 0 && adv.rows.length >= games.length) {
      for (let i = 0; i < games.length; i++) {
        const partial = footyWireAdvancedRowToPartial(adv.rows[i].cells, adv.headers, season);
        Object.assign(games[i], partial);
      }
    }
  }
  // FootyWire advanced has ED but no DE% column; derive disposal_efficiency from effective_disposals / disposals
  applyDisposalEfficiency(games);

  if (includeQuarterEnrichment) {
    // Enrich each game from FootyWire match page (ft_match_statistics) for quarter-by-quarter totals.
    await Promise.all(
      rows.map(async (row, idx) => {
        if (!row.matchId || !games[idx]) return;
        const quarters = await fetchFootyWireQuarterSplitForResult(row.matchId, games[idx].result);
        if (quarters) Object.assign(games[idx], quarters);
      })
    );
  }

  const { height, guernsey } = parseFootyWireProfile(html);
  // Only cache when we got advanced stats (advRes.ok). On production the advanced fetch can fail
  // (timeout, blocking, rate limit); caching that would serve incomplete data for all later requests.
  if (advRes.ok) {
    footyWireCache.set(cacheKey, {
      expiresAt: Date.now() + FOOTYWIRE_TTL_MS,
      games,
      height,
      guernsey,
    });
  }
  return { games, height, guernsey, player_name: playerName.trim() };
}

function parseIntSafe(v: string): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function parsePercent(v: string): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return null;
  return n;
}

export async function GET(request: NextRequest) {
  const seasonParam = request.nextUrl.searchParams.get('season');
  const playerNameParam = request.nextUrl.searchParams.get('player_name');
  const teamParam = request.nextUrl.searchParams.get('team');
  const includeQuartersParam = request.nextUrl.searchParams.get('include_quarters');
  const includeBoth = request.nextUrl.searchParams.get('include_both') === '1' || request.nextUrl.searchParams.get('include_both') === 'true';

  const season = seasonParam ? parseInt(seasonParam, 10) : null;
  if (!season || Number.isNaN(season)) {
    return NextResponse.json({ error: 'season query param is required (e.g. 2025)' }, { status: 400 });
  }
  if (!playerNameParam || !playerNameParam.trim()) {
    return NextResponse.json({ error: 'player_name query param is required' }, { status: 400 });
  }

  // Resolve team to full name so FootyWire URL and cache key are consistent (warm script sends nickname e.g. "Cats", frontend may send "Geelong Cats").
  const teamFull = teamParam?.trim()
    ? (rosterTeamToInjuryTeam(teamParam.trim()) || footywireNicknameToOfficial(teamParam.trim()) || teamParam.trim())
    : null;
  const teamForFootyWire = teamFull ? getFootyWireTeamNameForPlayerUrl(teamFull) : null;
  const includeQuarterEnrichment = includeQuartersParam === '1' || includeQuartersParam === 'true' || includeBoth;
  const responseCacheKey = buildAflPlayerLogsCacheKey({
    season,
    playerName: playerNameParam.trim(),
    teamForRequest: teamForFootyWire,
    includeQuarters: includeQuarterEnrichment,
  });

  const cacheEnabled = isAflPlayerLogsCacheEnabled();
  const cronSecret = process.env.CRON_SECRET ?? '';
  const authHeader = request.headers.get('authorization') ?? '';
  const xCron = request.headers.get('x-cron-secret') ?? '';
  const isWarmRequest = !!(cronSecret && (authHeader === `Bearer ${cronSecret}` || xCron === cronSecret));
  const cacheOnly = cacheEnabled && !isWarmRequest; // Cache-only: no FootyWire on miss. Warm job fills cache.
  const sourceHeaders = { 'X-AFL-Cache-Enabled': cacheEnabled ? 'true' : 'false' as string };

  // include_both=1: one request returns games + gamesWithQuarters (2 cache lookups in parallel). When cacheOnly we only serve from cache.
  if (includeBoth && teamForFootyWire) {
    const keyBase = buildAflPlayerLogsCacheKey({ season, playerName: playerNameParam.trim(), teamForRequest: teamForFootyWire, includeQuarters: false });
    const keyQuarters = buildAflPlayerLogsCacheKey({ season, playerName: playerNameParam.trim(), teamForRequest: teamForFootyWire, includeQuarters: true });
    const [cachedBase, cachedQuarters] = cacheEnabled
      ? await Promise.all([getAflPlayerLogsCache(keyBase), getAflPlayerLogsCache(keyQuarters)])
      : [null, null];
    const baseGames = cachedBase?.games;
    const hasBaseGames = Array.isArray(baseGames) && baseGames.length > 0;
    if (cachedBase && hasBaseGames) {
      const payload = { ...cachedBase, gamesWithQuarters: cachedQuarters?.games ?? cachedBase.games };
      return NextResponse.json(payload, { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'cache' } });
    }
    // Cache-only: prod only reads cache; warm job is allowed to fetch and fill.
    if (cacheOnly) {
      // 2026 often not warmed or empty; try 2025 from cache so UI can show last season.
      const keyBase2025 = season === 2026 && teamForFootyWire
        ? buildAflPlayerLogsCacheKey({ season: 2025, playerName: playerNameParam.trim(), teamForRequest: teamForFootyWire, includeQuarters: false })
        : null;
      const keyQuarters2025 = season === 2026 && teamForFootyWire
        ? buildAflPlayerLogsCacheKey({ season: 2025, playerName: playerNameParam.trim(), teamForRequest: teamForFootyWire, includeQuarters: true })
        : null;
      if (keyBase2025 && keyQuarters2025) {
        const [cachedBase2025, cachedQuarters2025] = await Promise.all([getAflPlayerLogsCache(keyBase2025), getAflPlayerLogsCache(keyQuarters2025)]);
        const base2025 = cachedBase2025?.games;
        if (cachedBase2025 && Array.isArray(base2025) && base2025.length > 0) {
          const payload = { ...cachedBase2025, gamesWithQuarters: cachedQuarters2025?.games ?? cachedBase2025.games };
          return NextResponse.json(payload, { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'cache' } });
        }
      }
      const empty = { season, source: 'cache-miss', player_name: playerNameParam.trim(), games: [], game_count: 0, gamesWithQuarters: [] as Record<string, unknown>[] };
      const missHeaders: Record<string, string> = {
        ...sourceHeaders,
        'X-AFL-Player-Logs-Source': 'cache-miss',
        'X-AFL-Cache-Key-Base': keyBase,
        'X-AFL-Cache-Key-Quarters': keyQuarters,
      };
      if (keyBase2025) missHeaders['X-AFL-Cache-Key-2025-Fallback'] = keyBase2025;
      return NextResponse.json(empty, { headers: missHeaders });
    }
    // Warm job or no cache: fetch from FootyWire
    const [fwBase, fwQuarters] = await Promise.all([
      fetchFootyWireGameLogs(teamForFootyWire, playerNameParam.trim(), season, false),
      fetchFootyWireGameLogs(teamForFootyWire, playerNameParam.trim(), season, true),
    ]);
    if (season === 2026 && (!fwBase || fwBase.games.length === 0)) {
      const [fw2025Base, fw2025Q] = await Promise.all([
        fetchFootyWireGameLogs(teamForFootyWire, playerNameParam.trim(), 2025, false),
        fetchFootyWireGameLogs(teamForFootyWire, playerNameParam.trim(), 2025, true),
      ]);
      if (fw2025Base?.games.length) {
        const actualSeason = fw2025Base.games[0]?.season ?? 2025;
        const quartersGames = fw2025Q?.games?.length ? fw2025Q.games : fw2025Base.games;
        const payload = {
          season: actualSeason,
          source: 'footywire.com',
          player_name: fw2025Base.player_name,
          games: fw2025Base.games,
          game_count: fw2025Base.games.length,
          gamesWithQuarters: quartersGames as unknown as Record<string, unknown>[],
          height: fw2025Base.height ?? undefined,
          guernsey: fw2025Base.guernsey ?? undefined,
        };
        if (cacheEnabled && fw2025Base.games.length > 0) {
          const baseCache: AflPlayerLogsCachePayload = { season: actualSeason, source: 'footywire.com', player_name: fw2025Base.player_name, games: fw2025Base.games as unknown as Record<string, unknown>[], game_count: fw2025Base.games.length, height: fw2025Base.height ?? undefined, guernsey: fw2025Base.guernsey ?? undefined };
          const quartersCache: AflPlayerLogsCachePayload = { season: actualSeason, source: 'footywire.com', player_name: fw2025Base.player_name, games: quartersGames as unknown as Record<string, unknown>[], game_count: quartersGames.length, height: fw2025Base.height ?? undefined, guernsey: fw2025Base.guernsey ?? undefined };
          await Promise.all([setAflPlayerLogsCache(keyBase, baseCache), setAflPlayerLogsCache(keyQuarters, quartersCache)]);
        }
        return NextResponse.json(payload, { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'footywire' } });
      }
    }
    const fw = fwBase ?? fwQuarters;
    if (fw?.games.length) {
      const actualSeason = fw.games[0]?.season ?? season;
      const gamesWithQuarters = (fwQuarters?.games?.length ? fwQuarters.games : fw.games) as unknown as Record<string, unknown>[];
      const payload = { season: actualSeason, source: 'footywire.com', player_name: fw.player_name, games: fw.games, game_count: fw.games.length, gamesWithQuarters, height: fw.height ?? undefined, guernsey: fw.guernsey ?? undefined };
      if (cacheEnabled && fw.games.length > 0) {
        const baseCache: AflPlayerLogsCachePayload = { season: payload.season, source: payload.source, player_name: payload.player_name, games: payload.games as unknown as Record<string, unknown>[], game_count: payload.game_count, height: payload.height, guernsey: payload.guernsey };
        const quartersCache: AflPlayerLogsCachePayload = { season: payload.season, source: payload.source, player_name: payload.player_name, games: gamesWithQuarters, game_count: gamesWithQuarters.length, height: payload.height, guernsey: payload.guernsey };
        await Promise.all([setAflPlayerLogsCache(keyBase, baseCache), setAflPlayerLogsCache(keyQuarters, quartersCache)]);
      }
      return NextResponse.json(payload, { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'footywire' } });
    }
  }

  const cachedResponse = cacheEnabled ? await getAflPlayerLogsCache(responseCacheKey) : null;
  const cachedGames = cachedResponse?.games;
  if (cachedResponse && Array.isArray(cachedGames) && cachedGames.length > 0) {
    return NextResponse.json(cachedResponse, {
      headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'cache' },
    });
  }

  // Cache-only: only read from cache. On 2026 miss, try 2025 so UI can show last season.
  if (cacheOnly) {
    if (season === 2026 && teamForFootyWire) {
      const key2025 = buildAflPlayerLogsCacheKey({
        season: 2025,
        playerName: playerNameParam.trim(),
        teamForRequest: teamForFootyWire,
        includeQuarters: includeQuarterEnrichment,
      });
      const cached2025 = await getAflPlayerLogsCache(key2025);
      const games2025 = cached2025?.games;
      if (cached2025 && Array.isArray(games2025) && games2025.length > 0) {
        return NextResponse.json(cached2025, {
          headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'cache' },
        });
      }
    }
    const empty = { season, source: 'cache-miss', player_name: playerNameParam.trim(), games: [], game_count: 0 };
    return NextResponse.json(empty, {
      headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'cache-miss', 'X-AFL-Cache-Key': responseCacheKey },
    });
  }

  // Warm job: FootyWire only to fill cache. No AFLTables. Users get data from cache only.
  if (!teamForFootyWire) {
    return NextResponse.json(
      { season, source: 'footywire.com', player_name: playerNameParam.trim(), games: [], game_count: 0 },
      { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'footywire' } }
    );
  }
  try {
    let fw = await fetchFootyWireGameLogs(teamForFootyWire, playerNameParam.trim(), season, includeQuarterEnrichment);
    if (season === 2026 && (!fw || fw.games.length === 0)) {
      const fw2025 = await fetchFootyWireGameLogs(teamForFootyWire, playerNameParam.trim(), 2025, includeQuarterEnrichment);
      if (fw2025 && fw2025.games.length > 0) fw = fw2025;
    }
    if (fw && fw.games.length > 0) {
      const actualSeason = fw.games[0]?.season ?? season;
      const payload = {
        season: actualSeason,
        source: 'footywire.com',
        player_name: fw.player_name,
        games: fw.games,
        game_count: fw.games.length,
        height: fw.height ?? undefined,
        guernsey: fw.guernsey ?? undefined,
      };
      if (cacheEnabled && fw.games.length > 0) await setAflPlayerLogsCache(responseCacheKey, payload as AflPlayerLogsCachePayload);
      return NextResponse.json(payload, { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'footywire' } });
    }
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch AFL game logs', details: err instanceof Error ? err.message : String(err) },
      { status: 502, headers: sourceHeaders }
    );
  }
  return NextResponse.json(
    { season, source: 'footywire.com', player_name: playerNameParam.trim(), games: [], game_count: 0 },
    { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'footywire' } }
  );
}

