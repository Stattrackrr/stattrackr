import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { rosterTeamToInjuryTeam, getFootyWireTeamNameForPlayerUrl, getAflTablesTeamSlug, footywireNicknameToOfficial, leagueTeamToOfficial } from '@/lib/aflTeamMapping';
import { normalizeAflPlayerName, normalizeAflPlayerNameForLookup, normalizeAflPlayerNameForMatch, toCanonicalAflPlayerName } from '@/lib/aflPlayerNameUtils';
import {
  buildAflPlayerLogsCacheKey,
  getAflPlayerLogsCache,
  setAflPlayerLogsCache,
  isAflPlayerLogsCacheEnabled,
  type AflPlayerLogsCachePayload,
} from '@/lib/cache/aflPlayerLogsCache';

/** Resolve player's team for a given season from league stats (for players who changed teams). */
function getPlayerTeamForSeason(season: number, playerName: string): string | null {
  const filePath = path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw) as { players?: { name: string; team: string }[] };
    if (!Array.isArray(data?.players)) return null;
    const normalized = normalizeAflPlayerNameForMatch(playerName);
    const row = data.players.find((p) => normalizeAflPlayerNameForMatch(p.name ?? '') === normalized);
    if (!row?.team) return null;
    const official = leagueTeamToOfficial(row.team.trim()) ?? footywireNicknameToOfficial(row.team.trim());
    return official ?? null;
  } catch {
    return null;
  }
}

/** Teams to try for FootyWire fetch (current season + previous season) so players who moved teams still get data. */
function getTeamsToTryForSeason(
  season: number,
  playerName: string,
  teamParam: string | null
): string[] {
  const fromSeason = getPlayerTeamForSeason(season, playerName);
  const fromPrev = season - 1 >= 2020 ? getPlayerTeamForSeason(season - 1, playerName) : null;
  const fallback = teamParam?.trim()
    ? (rosterTeamToInjuryTeam(teamParam.trim()) || footywireNicknameToOfficial(teamParam.trim()) || teamParam.trim())
    : null;
  const seen = new Set<string>();
  const out: string[] = [];
  // Try previous season's team first when different (player moved) so we hit the FootyWire URL that has their page + advanced stats.
  const order = fromPrev && fromPrev !== fromSeason ? [fromPrev, fromSeason, fallback] : [fromSeason, fromPrev, fallback];
  for (const t of order) {
    if (!t) continue;
    const official = t.trim();
    if (seen.has(official)) continue;
    seen.add(official);
    out.push(official);
  }
  return out;
}

/** Prefer result that has advanced stats (TOG, etc.) so players who moved still get full data. */
function hasAdvancedStats(games: GameLogRow[]): boolean {
  return games.some((g) => g.percent_played != null || g.contested_possessions != null || g.meters_gained != null);
}

/** Fetch from FootyWire trying each team in order; prefer result that has advanced stats (TOG, meters gained, etc.). */
async function fetchFootyWireGameLogsWithTeamFallback(
  teamsToTry: string[],
  playerName: string,
  season: number,
  includeQuarterEnrichment: boolean
): Promise<{ games: GameLogRow[]; height: string | null; guernsey: number | null; player_name: string } | null> {
  let best: Awaited<ReturnType<typeof fetchFootyWireGameLogs>> = null;
  for (const teamOfficial of teamsToTry) {
    const teamSlug = getFootyWireTeamNameForPlayerUrl(teamOfficial);
    if (!teamSlug) continue;
    const result = await fetchFootyWireGameLogs(teamSlug, playerName, season, includeQuarterEnrichment);
    if (!result?.games?.length) continue;
    const resultHasAdv = hasAdvancedStats(result.games);
    if (!best) {
      best = result;
      if (resultHasAdv) return best;
      continue;
    }
    const bestHasAdv = hasAdvancedStats(best.games);
    if (resultHasAdv && !bestHasAdv) {
      best = result;
      return best;
    }
    if (result.games.length > best.games.length) best = result;
  }
  return best;
}

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

// ---------- AFL Tables (team game-by-game scrape) ----------
const AFL_TABLES_BASE = 'https://afltables.com';

/** Normalize for AFL Tables name match: "D'Ambrosio, Massimo" or "DAmbrosio, Massimo" (no apostrophe on site) -> "massimo dambrosio". Strip apostrophes so we match AFL Tables' "DAmbrosio". */
function normalizeNameForAflTablesMatch(name: string): string {
  const t = (name ?? '').trim();
  let lower = t.toLowerCase().replace(/\s+/g, ' ');
  lower = lower.replace(/['\u2018\u2019\u201B\u2032\u02BC`]/g, ''); // strip apostrophes so "D'Ambrosio" matches "DAmbrosio"
  // "Last, First" -> "first last"
  const comma = lower.indexOf(',');
  if (comma > 0) {
    const first = lower.slice(comma + 1).trim();
    const last = lower.slice(0, comma).trim();
    return `${first} ${last}`.replace(/\s+/g, ' ');
  }
  return lower;
}

/** Return true if AFL Tables row name (e.g. "D'Ambrosio, Massimo" or "D'Ambrosio, M.") matches our player name. */
function aflTablesPlayerNameMatches(rowName: string, playerName: string): boolean {
  const a = normalizeNameForAflTablesMatch(rowName);
  const b = normalizeNameForAflTablesMatch(playerName);
  if (a === b) return true;
  // Strip to last name + first initial for "D'Ambrosio, M." vs "Massimo D'Ambrosio"
  const aNorm = a.replace(/\s+/g, ' ').replace(/['\u2018\u2019]/g, "'");
  const bNorm = b.replace(/\s+/g, ' ').replace(/['\u2018\u2019]/g, "'");
  if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return true;
  const aParts = aNorm.split(' ').filter(Boolean);
  const bParts = bNorm.split(' ').filter(Boolean);
  if (aParts.length >= 2 && bParts.length >= 2) {
    const aKey = [...aParts].sort().join(' ');
    const bKey = [...bParts].sort().join(' ');
    if (aKey === bKey) return true;
    // Last name + first initial: "d'ambrosio m" vs "massimo d'ambrosio" -> same last name, first initial m
    const aLast = aParts[aParts.length - 1];
    const bLast = bParts[bParts.length - 1];
    const aFirst = aParts[0].slice(0, 1);
    const bFirst = bParts[0].slice(0, 1);
    if (aLast === bLast && (aFirst === bFirst || aParts[0] === bParts[0])) return true;
    if (bLast === aLast && bParts[0].startsWith(aFirst)) return true;
  }
  return false;
}

/** Parse round label from header cell: "R1", "1", "R 1", "R.1" -> "R1". */
function parseRoundHeader(h: string): string | null {
  const t = (h ?? '').trim();
  const m = t.match(/^R\.?\s*(\d+)$/i) || t.match(/^(\d+)$/);
  return m ? `R${m[1]}` : null;
}

/**
 * Parse one table from AFL Tables gbg page: first column = player name, then R1, R2, ... (disposals), then Tot.
 * Returns one GameLogRow per round that has a number for this player.
 */
function parseOneAflTablesGbgTable(tableBody: string, playerName: string, season: number): GameLogRow[] {
  const games: GameLogRow[] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows: string[][] = [];
  let tr: RegExpExecArray | null = trRegex.exec(tableBody);
  while (tr) {
    const cells: string[] = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cm: RegExpExecArray | null = cellRegex.exec(tr[1]);
    while (cm) {
      cells.push(htmlToText(cm[1]).trim());
      cm = cellRegex.exec(tr[1]);
    }
    if (cells.length > 0) rows.push(cells);
    tr = trRegex.exec(tableBody);
  }

  if (rows.length < 2) return games;

  // Find header row: first row that has multiple round-like columns (R1, 1, R 1, etc.)
  let headerRowIndex = 0;
  let roundColIndexes: { index: number; label: string }[] = [];
  for (let hi = 0; hi < Math.min(3, rows.length); hi++) {
    const headerRow = rows[hi];
    const roundCols: { index: number; label: string }[] = [];
    for (let i = 1; i < headerRow.length; i++) {
      const h = (headerRow[i] ?? '').trim();
      const label = parseRoundHeader(h);
      if (label) roundCols.push({ index: i, label });
      else if (/^tot$/i.test(h)) break;
    }
    if (roundCols.length >= 5) {
      headerRowIndex = hi;
      roundColIndexes = roundCols;
      break;
    }
  }
  if (roundColIndexes.length === 0) return games;

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const nameCell = (row[0] ?? '').trim();
    if (!nameCell) continue;
    if (!aflTablesPlayerNameMatches(nameCell, playerName)) continue;

    for (const { index, label } of roundColIndexes) {
      const val = (row[index] ?? '').trim();
      const num = parseInt(val, 10);
      if (!Number.isFinite(num) || num < 0) continue;
      games.push({
        season,
        game_number: games.length + 1,
        opponent: '—',
        round: label,
        result: '—',
        guernsey: null,
        kicks: 0,
        marks: 0,
        handballs: 0,
        disposals: num,
        goals: 0,
        behinds: 0,
        hitouts: 0,
        tackles: 0,
        rebounds: 0,
        inside_50s: 0,
        clearances: 0,
        intercepts: 0,
        tackles_inside_50: 0,
        score_involvements: 0,
        meters_gained: 0,
        clangers: 0,
        free_kicks_for: 0,
        free_kicks_against: 0,
        brownlow_votes: 0,
        contested_possessions: 0,
        uncontested_possessions: 0,
        contested_marks: 0,
        marks_inside_50: 0,
        one_percenters: 0,
        bounces: 0,
        goal_assists: 0,
        percent_played: null,
        effective_disposals: 0,
        disposal_efficiency: 0,
        match_url: null,
      });
    }
    return games;
  }
  return games;
}

/**
 * Parse AFL Tables team game-by-game page (e.g. .../teams/hawthorn/2025_gbg.html).
 * Tries each table until one yields games for this player (default view = disposals per round).
 */
function parseAflTablesGbgHtml(html: string, playerName: string, season: number): GameLogRow[] {
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null = null;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const games = parseOneAflTablesGbgTable(tableMatch[1], playerName, season);
    if (games.length > 0) return games;
  }
  return [];
}

/** Fetch game-by-game disposals from AFL Tables team gbg page. Tries each team in order; returns first non-empty result. */
async function fetchAflTablesGameLogs(
  teamsToTry: string[],
  playerName: string,
  season: number
): Promise<{ games: GameLogRow[]; source: 'afltables.com' } | null> {
  const fetchOpts = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-AU,en;q=0.9',
    },
    next: { revalidate: 60 * 60 } as RequestInit['next'],
  };

  for (const teamOfficial of teamsToTry) {
    const slug = getAflTablesTeamSlug(teamOfficial);
    if (!slug) continue;
    const url = `${AFL_TABLES_BASE}/afl/stats/teams/${slug}/${season}_gbg.html`;
    try {
      const res = await fetch(url, fetchOpts);
      if (!res.ok) continue;
      const html = await res.text();
      const games = parseAflTablesGbgHtml(html, playerName, season);
      if (games.length > 0) return { games, source: 'afltables.com' };
    } catch {
      continue;
    }
  }
  return null;
}

// ---------- FootyWire (player game logs) ----------
const APOSTROPHE_LIKE = /[\u0027\u2018\u2019\u201B\u2032\u02BC\u02B9`]/g;

/** Build player slug for FootyWire URL: apostrophe → hyphen (e.g. O'Meara → o-meara) so we match FootyWire. */
function footyWirePlayerSlug(playerName: string): string {
  let s = (playerName ?? '')
    .trim()
    .toLowerCase();
  // Explicit O' / D' → o- / d- so we match FootyWire even with odd Unicode apostrophes
  s = s.replace(/\bo['\u2018\u2019\u201B\u2032\u02BC\u02B9`]\s*/g, 'o-').replace(/\bd['\u2018\u2019\u201B\u2032\u02BC\u02B9`]\s*/g, 'd-');
  s = s
    .replace(APOSTROPHE_LIKE, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
  return s.replace(/^-|-$/g, '') || s;
}

/** Alternate slug with apostrophe removed (e.g. omeara) for fallback when hyphen form returns no data. */
function footyWirePlayerSlugNoApostrophe(playerName: string): string {
  let s = (playerName ?? '').trim().toLowerCase();
  s = s.replace(/\bo['\u2018\u2019\u201B\u2032\u02BC\u02B9`]\s*/g, 'o-').replace(/\bd['\u2018\u2019\u201B\u2032\u02BC\u02B9`]\s*/g, 'd-');
  s = s
    .replace(APOSTROPHE_LIKE, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
  return s.replace(/^-|-$/g, '') || s;
}

/** Slug with middle initial dropped (e.g. "Bailey J. Williams" → "bailey-williams") for FootyWire pages that omit it. */
function footyWirePlayerSlugNoMiddleInitial(playerName: string): string | null {
  const trimmed = (playerName ?? '').trim();
  const match = trimmed.match(/^(\S+)\s+[a-zA-Z]\.?\s+(\S+)$/);
  if (!match) return null;
  const first = match[1].toLowerCase().replace(/[^a-z0-9]/g, '');
  const last = match[2].toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!first || !last) return null;
  return `${first}-${last}`;
}

/** Known FootyWire slug overrides (they use different first name or spelling than our data). */
const FOOTYWIRE_SLUG_OVERRIDES: Record<string, string[]> = {
  'tom lynch': ['thomas-lynch'],
  'bobby hill': ['ian-hill'],
  'wil dawson': ['will-dawson'],
  'michael frederick': ['michael-fredrick'],
};

function getFootyWireSlugOverrides(playerName: string): string[] {
  const key = (playerName ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return FOOTYWIRE_SLUG_OVERRIDES[key] ?? [];
}

/** Normalize "D Ambrosio" / "O Meara" (no apostrophe from UI) to "D'Ambrosio" / "O'Meara" so cache and league lookups match. */
function normalizeIrishNameForLookup(name: string): string {
  if (!name || typeof name !== 'string') return name;
  return name.trim().replace(/\b([OD]) ([A-Z])/g, "$1'$2");
}

/** True if name has apostrophe or O'/D' pattern (players whose FootyWire page can yield wrong table). */
/** True if name has apostrophe (D'Ambrosio, O'Meara) or hyphen (Wanganeen-Milera) — these use AFL Tables only. */
function nameHasSymbol(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  return /['\u2018\u2019]/.test(name) || /\b[OD]'/i.test(name) || /\b[OD] [A-Z]/.test(name.trim()) || /-/.test(name);
}

/** True if cached game list has disposals that look wrong (e.g. we cached the wrong table for symbol-name players). */
function cachedDisposalsLookWrong(games: { disposals?: number }[]): boolean {
  if (!Array.isArray(games) || games.length === 0) return false;
  const total = games.reduce((s, g) => s + (g.disposals ?? 0), 0);
  const avg = total / games.length;
  return avg < 3;
}

function footyWireGameLogUrl(teamName: string, playerName: string, year: number, advanced = false): string {
  const teamSlug = teamName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const playerSlug = footyWirePlayerSlug(playerName);
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

/** Extract each <table>...</table> content with correct nesting (so we get full table, not truncated by inner tables). */
function extractTableContents(html: string): string[] {
  const contents: string[] = [];
  const lower = html.toLowerCase();
  let pos = 0;
  while (pos < html.length) {
    const openIdx = lower.indexOf('<table', pos);
    if (openIdx < 0) break;
    const tagEnd = html.indexOf('>', openIdx);
    if (tagEnd < 0) {
      pos = openIdx + 1;
      continue;
    }
    const contentStart = tagEnd + 1;
    let depth = 1;
    let searchStart = contentStart;
    while (depth > 0) {
      const nextOpen = lower.indexOf('<table', searchStart);
      const nextClose = lower.indexOf('</table>', searchStart);
      if (nextClose < 0) break;
      const useOpen = nextOpen >= 0 && nextOpen < nextClose;
      if (useOpen) {
        depth++;
        searchStart = nextOpen + 6;
      } else {
        depth--;
        if (depth === 0) {
          contents.push(html.substring(contentStart, nextClose));
          pos = nextClose + 8;
          break;
        }
        searchStart = nextClose + 8;
      }
    }
    if (depth !== 0) break;
  }
  return contents;
}

function trimLeadingEmptyHeaderColumns(
  headers: string[],
  rows: FootyWireTableRow[]
): { headers: string[]; rows: FootyWireTableRow[] } {
  if (rows.length === 0) return { headers, rows };
  const leadingEmpty = headers.findIndex((h) => (h || '').trim() !== '');
  if (leadingEmpty <= 0) return { headers, rows };
  const minCells = Math.min(...rows.map((r) => r.cells.length));
  const trimLen = Math.min(headers.length - leadingEmpty, minCells);
  return {
    headers: headers.slice(leadingEmpty, leadingEmpty + trimLen),
    rows: rows.map((r) => ({ ...r, cells: r.cells.slice(0, trimLen) })),
  };
}

function parseFootyWireGameLogTable(html: string): { headers: string[]; rows: FootyWireTableRow[] } {
  const result = { headers: [] as string[], rows: [] as FootyWireTableRow[] };
  if (!html || !html.includes('footywire')) return result;
  const lower = html.toLowerCase();
  // Extract each table with correct nesting, then pick the one with game log header and most data rows.
  const tableContents = extractTableContents(html);
  let best: { headers: string[]; rows: FootyWireTableRow[] } | null = null;
  for (const tableContent of tableContents) {
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
        (r.cells.some((c) => /^Description$/i.test(c)) || r.cells.some((c) => /^Round$/i.test(c)) || r.cells.some((c) => /^Rnd$/i.test(c))) &&
        r.cells.some((c) => /^Opponent$/i.test(c)) &&
        r.cells.some((c) => /^Result$/i.test(c)) &&
        (r.cells.some((c) => /^K$/i.test(c)) || r.cells.some((c) => /^D$/i.test(c)) || r.cells.some((c) => /^CP$/i.test(c)) || r.cells.some((c) => /^Kicks$/i.test(c)) || r.cells.some((c) => /^Disposals$/i.test(c)))
    );
    if (headerIdx >= 0) {
      const dataRows = rows.slice(headerIdx + 1).filter((r) => {
        const first = (r.cells[0] || '').trim();
        if (!first) return false;
        const hasRound = /Round|Final|Semi|Qualifying|Preliminary|Grand|Description/i.test(first) || /^R\d+$/i.test(first);
        const hasNumbers = r.cells.some((c, i) => i >= 4 && /^\d+$/.test(String(c)));
        return hasRound && !/^Date$/i.test(first) && (hasNumbers || r.cells.length >= 10);
      });
      const headers = rows[headerIdx].cells;
      const candidate = { headers, rows: dataRows };
      if (dataRows.length > 0) {
        const thisSensible = tableHasSensibleDisposals(headers, dataRows);
        const bestSensible = best ? tableHasSensibleDisposals(best.headers, best.rows) : false;
        const moreRows = !best || dataRows.length > best.rows.length;
        const sameRows = best && dataRows.length === best.rows.length;
        // Prefer table with sensible disposals. Never replace a sensible best with a non-sensible candidate (e.g. 26-row wrong table replacing 25-row correct table).
        const preferThis = moreRows
          ? (thisSensible || !bestSensible)
          : (sameRows && thisSensible && !bestSensible) || (thisSensible && !bestSensible);
        if (preferThis) {
          best = candidate;
        }
      }
    }
  }
  if (best) {
    const trimmed = trimLeadingEmptyHeaderColumns(best.headers, best.rows);
    result.headers = trimmed.headers;
    result.rows = trimmed.rows;
    return result;
  }
  // Fallback: FootyWire may put the game log in a table right after "Games Log for" / "Game Log for"
  const gamesLogMarker = /Games?\s*Log\s+for/i;
  const markerMatch = html.match(gamesLogMarker);
  if (markerMatch && markerMatch.index != null) {
    const afterMarker = html.slice(markerMatch.index + markerMatch[0].length);
    const tableOpenIdx = lower.slice(markerMatch.index + markerMatch[0].length).indexOf('<table');
    if (tableOpenIdx >= 0) {
      const tableStart = (markerMatch.index + markerMatch[0].length) + tableOpenIdx;
      const tagEnd = html.indexOf('>', tableStart);
      if (tagEnd >= 0) {
        const contentStart = tagEnd + 1;
        let depth = 1;
        let searchStart = contentStart;
        const lowerFrom = lower.slice(tableStart);
        while (depth > 0) {
          const nextOpen = lowerFrom.indexOf('<table', searchStart - tableStart);
          const nextClose = lowerFrom.indexOf('</table>', searchStart - tableStart);
          const nextOpenAbs = nextOpen >= 0 ? tableStart + nextOpen : -1;
          const nextCloseAbs = nextClose >= 0 ? tableStart + nextClose : -1;
          if (nextCloseAbs < 0) break;
          const useOpen = nextOpenAbs >= 0 && nextOpenAbs < nextCloseAbs;
          if (useOpen) {
            depth++;
            searchStart = nextOpenAbs + 6;
          } else {
            depth--;
            if (depth === 0) {
              const tableContent = html.substring(contentStart, nextCloseAbs);
              const parsed = parseOneTableToRows(tableContent);
              if (parsed.headerIdx >= 0 && parsed.dataRows.length > 0) {
                const trimmed = trimLeadingEmptyHeaderColumns(parsed.rows[parsed.headerIdx].cells, parsed.dataRows);
                result.headers = trimmed.headers;
                result.rows = trimmed.rows;
                return result;
              }
              break;
            }
            searchStart = nextCloseAbs + 8;
          }
        }
      }
    }
  }
  return result;
}

function parseOneTableToRows(tableContent: string): { rows: FootyWireTableRow[]; headerIdx: number; dataRows: FootyWireTableRow[] } {
  const rows: FootyWireTableRow[] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
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
      (r.cells.some((c) => /^Description$/i.test(c)) || r.cells.some((c) => /^Round$/i.test(c)) || r.cells.some((c) => /^Rnd$/i.test(c))) &&
      r.cells.some((c) => /^Opponent$/i.test(c)) &&
      r.cells.some((c) => /^Result$/i.test(c)) &&
      (r.cells.some((c) => /^K$/i.test(c)) || r.cells.some((c) => /^D$/i.test(c)) || r.cells.some((c) => /^CP$/i.test(c)) || r.cells.some((c) => /^Kicks$/i.test(c)) || r.cells.some((c) => /^Disposals$/i.test(c)))
  );
  const dataRows =
    headerIdx >= 0
      ? rows.slice(headerIdx + 1).filter((r) => {
          const first = (r.cells[0] || '').trim();
          if (!first) return false;
          const hasRound = /Round|Final|Semi|Qualifying|Preliminary|Grand|Description/i.test(first) || /^R\d+$/i.test(first);
          const hasNumbers = r.cells.some((c, i) => i >= 4 && /^\d+$/.test(String(c)));
          return hasRound && !/^Date$/i.test(first) && (hasNumbers || r.cells.length >= 10);
        })
      : [];
  return { rows, headerIdx, dataRows };
}

const COL_ALIASES: Record<string, string[]> = {
  Description: ['Round', 'Rnd', 'Desc'],
  Opponent: ['Vs', 'VS', 'Opp'],
  Result: ['Res', 'W/L'],
  K: ['Kicks'],
  D: ['Disposals'],
  M: ['Marks'],
  HB: ['Handballs'],
  G: ['Goals'],
  B: ['Behinds'],
  HO: ['Hit Outs', 'Hitouts'],
  T: ['Tackles'],
  R50: ['Rebound 50s', 'Rebounds'],
  I50: ['Inside 50s', 'Inside 50'],
  CL: ['Clearances'],
  CG: ['Clangers'],
  FF: ['Free Kicks For', 'Frees For'],
  FA: ['Free Kicks Against', 'Frees Against'],
  GA: ['Goal Assists'],
  Date: ['Date Played'],
};

function colIndex(headers: string[], name: string): number {
  let i = headers.findIndex((h) => h.toUpperCase() === name.toUpperCase());
  if (i >= 0) return i;
  const aliases = COL_ALIASES[name];
  if (aliases) {
    for (const alt of aliases) {
      i = headers.findIndex((h) => h.toUpperCase() === alt.toUpperCase());
      if (i >= 0) return i;
    }
  }
  return -1;
}

/** True if this table looks like the main game log (has K and D, and D column has sensible disposals values). */
function tableHasSensibleDisposals(headers: string[], dataRows: FootyWireTableRow[]): boolean {
  if (colIndex(headers, 'K') < 0 || colIndex(headers, 'D') < 0) return false;
  const dIdx = colIndex(headers, 'D');
  const sample = dataRows.slice(0, Math.min(5, dataRows.length));
  return sample.some((r) => {
    const val = parseIntSafe((r.cells[dIdx] ?? '').trim());
    return val >= 5 && val <= 60;
  });
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

/** True if name might have an apostrophe that affects slug (O'X, D'X, etc.). */
function nameLikelyHasApostrophe(name: string): boolean {
  return /[\u0027\u2018\u2019\u201B\u2032\u02BC\u02B9`]/.test(name ?? '') || /[od]['\u2018\u2019][a-z]/i.test((name ?? '').trim());
}

async function fetchFootyWireGameLogs(
  teamName: string,
  playerName: string,
  season: number,
  includeQuarterEnrichment = false
): Promise<{ games: GameLogRow[]; height: string | null; guernsey: number | null; player_name: string } | null> {
  const cacheKey = `${FOOTYWIRE_SCHEMA_VERSION}|${teamName}|${playerName}|${season}|quarters:${includeQuarterEnrichment ? '1' : '0'}`;
  const cached = footyWireCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (nameHasSymbol(playerName) && cachedDisposalsLookWrong(cached.games)) {
      footyWireCache.delete(cacheKey);
    } else {
      return { games: cached.games, height: cached.height, guernsey: cached.guernsey, player_name: playerName.trim() };
    }
  }
  const fetchOpts = { headers: FOOTYWIRE_HEADERS, next: { revalidate: 60 * 60 } as RequestInit['next'] };
  const teamSlug = teamName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const primarySlug = footyWirePlayerSlug(playerName);
  const altSlug = nameLikelyHasApostrophe(playerName) ? footyWirePlayerSlugNoApostrophe(playerName) : null;
  // Also try hyphen form (jaeger-o-meara) when slug is like jaeger-omeara — covers names stored without apostrophe.
  const insertHyphenAfterOOrD = (s: string) => s.replace(/-o([a-z]{2,})/g, '-o-$1').replace(/-d([a-z]{2,})/g, '-d-$1');
  const altSlugWithHyphen = insertHyphenAfterOOrD(primarySlug) !== primarySlug ? insertHyphenAfterOOrD(primarySlug) : (altSlug && altSlug !== primarySlug ? insertHyphenAfterOOrD(altSlug) : null);
  const slugNoMiddle = footyWirePlayerSlugNoMiddleInitial(playerName);
  const overrides = getFootyWireSlugOverrides(playerName);
  const slugSet = new Set<string>([primarySlug, altSlug, altSlugWithHyphen, slugNoMiddle, ...overrides].filter(Boolean));
  const slugsToTry = Array.from(slugSet);

  for (const playerSlug of slugsToTry) {
    const url = `${FOOTYWIRE_BASE}/afl/footy/pg-${teamSlug}--${playerSlug}?year=${season}`;
    const advUrl = `${url}&advv=Y`;
    let res = await fetch(url, fetchOpts);
    let advResInitial = await fetch(advUrl, fetchOpts);
    if (!res.ok) continue;
    let html = await res.text();
    let { headers, rows } = parseFootyWireGameLogTable(html);
    // Retry once after delay when table is empty (rate limit or transient failure)
    if ((headers.length === 0 || rows.length === 0) && res.ok) {
      await new Promise((r) => setTimeout(r, 1500));
      res = await fetch(url, fetchOpts);
      if (res.ok) {
        html = await res.text();
        const parsed = parseFootyWireGameLogTable(html);
        if (parsed.headers.length > 0 && parsed.rows.length > 0) {
          headers = parsed.headers;
          rows = parsed.rows;
        }
      }
    }
    // Fallback: if year filter returns empty table, try URL without year (FootyWire may serve full log only without ?year=)
    if ((headers.length === 0 || rows.length === 0) && teamSlug && playerSlug) {
      const urlNoYear = `${FOOTYWIRE_BASE}/afl/footy/pg-${teamSlug}--${playerSlug}`;
      const resNoYear = await fetch(urlNoYear, fetchOpts);
      if (resNoYear.ok) {
        const htmlNoYear = await resNoYear.text();
        const parsed = parseFootyWireGameLogTable(htmlNoYear);
        if (parsed.headers.length > 0 && parsed.rows.length > 0) {
          html = htmlNoYear;
          headers = parsed.headers;
          rows = parsed.rows.filter((r) => {
            const seasonCol = parsed.headers.findIndex((h) => /^Season$/i.test(h));
            const dateCol = parsed.headers.findIndex((h) => /^Date$/i.test(h.trim()) || /^Date\s+Played$/i.test(h.trim()));
            if (seasonCol >= 0 && r.cells[seasonCol] !== undefined) {
              const y = parseInt(String(r.cells[seasonCol]).trim(), 10);
              return Number.isFinite(y) && y === season;
            }
            if (dateCol >= 0 && r.cells[dateCol] !== undefined) {
              const dateStr = String(r.cells[dateCol]).trim();
              const year = dateStr.length >= 4 ? parseInt(dateStr.slice(-4), 10) : NaN;
              return Number.isFinite(year) && year === season;
            }
            return true;
          });
        }
      }
    }
    if (headers.length === 0 || rows.length === 0) continue;
    const games: GameLogRow[] = rows.map((row, idx) => {
      const g = footyWireRowToGameLogRow(row.cells, headers, season);
      g.game_number = idx + 1;
      return g;
    });
    // Skip this slug's result only if disposals look wrong and we might get a better result from another slug (same page can't be re-parsed).
    if (nameHasSymbol(playerName) && cachedDisposalsLookWrong(games)) continue;
    let advRes = advResInitial;
    if (!advRes.ok) {
      advRes = await fetch(advUrl, fetchOpts);
    }
    if (!advRes.ok) {
      await new Promise((r) => setTimeout(r, 2000));
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
    applyDisposalEfficiency(games);
    if (includeQuarterEnrichment) {
      await Promise.all(
        rows.map(async (row, idx) => {
          if (!row.matchId || !games[idx]) return;
          const quarters = await fetchFootyWireQuarterSplitForResult(row.matchId, games[idx].result);
          if (quarters) Object.assign(games[idx], quarters);
        })
      );
    }
    const { height, guernsey } = parseFootyWireProfile(html);
    if (advRes.ok && !(nameHasSymbol(playerName) && cachedDisposalsLookWrong(games))) {
      footyWireCache.set(cacheKey, {
        expiresAt: Date.now() + FOOTYWIRE_TTL_MS,
        games,
        height,
        guernsey,
      });
    }
    return { games, height, guernsey, player_name: playerName.trim() };
  }
  return null;
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
  const forceFetch = request.nextUrl.searchParams.get('force_fetch') === '1' || request.nextUrl.searchParams.get('force_fetch') === 'true';

  const season = seasonParam ? parseInt(seasonParam, 10) : null;
  if (!season || Number.isNaN(season)) {
    return NextResponse.json({ error: 'season query param is required (e.g. 2025)' }, { status: 400 });
  }
  if (!playerNameParam || !playerNameParam.trim()) {
    return NextResponse.json({ error: 'player_name query param is required' }, { status: 400 });
  }

  const canonicalName = toCanonicalAflPlayerName(playerNameParam.trim());
  const effectivePlayerName = normalizeIrishNameForLookup(canonicalName);

  // For the requested season, use the team the player actually played for (from league stats) so players who changed teams get correct game logs.
  const teamForRequestedSeason = getPlayerTeamForSeason(season, effectivePlayerName);
  const teamFull = teamForRequestedSeason ?? (teamParam?.trim()
    ? (rosterTeamToInjuryTeam(teamParam.trim()) || footywireNicknameToOfficial(teamParam.trim()) || teamParam.trim())
    : null);
  const teamForFootyWire = teamFull ? getFootyWireTeamNameForPlayerUrl(teamFull) : null;
  // Try current + previous season's team so players who moved (e.g. Christian Petracca) still get game logs and advanced stats.
  const teamsToTry = getTeamsToTryForSeason(season, effectivePlayerName, teamParam);
  const includeQuarterEnrichment = includeQuartersParam === '1' || includeQuartersParam === 'true' || includeBoth;
  const responseCacheKey = buildAflPlayerLogsCacheKey({
    season,
    playerName: effectivePlayerName,
    teamForRequest: teamForFootyWire,
    includeQuarters: includeQuarterEnrichment,
  });

  const cacheEnabled = isAflPlayerLogsCacheEnabled();
  const cronSecret = process.env.CRON_SECRET ?? '';
  const authHeader = request.headers.get('authorization') ?? '';
  const xCron = request.headers.get('x-cron-secret') ?? '';
  const isWarmRequest = !!(cronSecret && (authHeader === `Bearer ${cronSecret}` || xCron === cronSecret));
  const cacheOnly = cacheEnabled && !isWarmRequest && !forceFetch; // Cache-only: no FootyWire on miss. force_fetch=1 allows test scripts to hit FootyWire.
  const sourceHeaders = { 'X-AFL-Cache-Enabled': cacheEnabled ? 'true' : 'false' as string };

  const debugParse = request.nextUrl.searchParams.get('debug') === '1' || request.nextUrl.searchParams.get('debug') === 'true';
  if (debugParse && (teamForFootyWire || teamsToTry.length > 0)) {
    const teamForUrl = teamForFootyWire ?? (teamsToTry[0] ? getFootyWireTeamNameForPlayerUrl(teamsToTry[0]) : null);
    const teamSlug = teamForUrl ? teamForUrl.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : '';
    const playerSlug = footyWirePlayerSlug(effectivePlayerName);
    const fwUrl = `${FOOTYWIRE_BASE}/afl/footy/pg-${teamSlug}--${playerSlug}?year=${season}`;
    try {
      const fwRes = await fetch(fwUrl, { headers: FOOTYWIRE_HEADERS });
      const html = await fwRes.text();
      const parsed = parseFootyWireGameLogTable(html);
      const tableContents = extractTableContents(html);
      const dIdx = colIndex(parsed.headers, 'D');
      const firstRowD = parsed.rows[0] && dIdx >= 0 ? parsed.rows[0].cells[dIdx] : null;
      return NextResponse.json({
        _debug: {
          url: fwUrl,
          status: fwRes.status,
          htmlLength: html.length,
          hasFootyWire: html.includes('footywire'),
          tableCount: tableContents.length,
          parsedHeaderCount: parsed.headers.length,
          parsedRowCount: parsed.rows.length,
          headers: parsed.headers,
          firstRowCells: parsed.rows[0]?.cells ?? null,
          dColIndex: dIdx,
          firstRowD,
        },
      });
    } catch (e) {
      return NextResponse.json({ _debug: { error: String(e instanceof Error ? e.message : e), url: fwUrl } });
    }
  }

  // include_both=1: one request returns games + gamesWithQuarters (2 cache lookups in parallel). When cacheOnly we only serve from cache.
  if (includeBoth && (teamForFootyWire || teamsToTry.length > 0)) {
    const cacheTeamSlug = teamForFootyWire ?? (teamsToTry[0] ? getFootyWireTeamNameForPlayerUrl(teamsToTry[0]) : null);
    const keyBase = buildAflPlayerLogsCacheKey({ season, playerName: effectivePlayerName, teamForRequest: cacheTeamSlug, includeQuarters: false });
    const keyQuarters = buildAflPlayerLogsCacheKey({ season, playerName: effectivePlayerName, teamForRequest: cacheTeamSlug, includeQuarters: true });
    const [cachedBase, cachedQuarters] = cacheEnabled
      ? await Promise.all([getAflPlayerLogsCache(keyBase), getAflPlayerLogsCache(keyQuarters)])
      : [null, null];
    const baseGames = cachedBase?.games as { disposals?: number }[] | undefined;
    const cachedCount = cachedBase?.game_count ?? (Array.isArray(baseGames) ? baseGames.length : 0);
    const hasBaseGames = Array.isArray(baseGames) && baseGames.length > 0 && cachedCount > 0;
    const skipCacheWrongData =
      hasBaseGames &&
      nameHasSymbol(effectivePlayerName) &&
      cachedDisposalsLookWrong(baseGames as { disposals?: number }[]);
    // Symbol-name players: never use cache; always fetch from AFL Tables.
    const skipCacheForSymbol = nameHasSymbol(effectivePlayerName);
    if (cachedBase && hasBaseGames && !skipCacheWrongData && !skipCacheForSymbol) {
      const payload = { ...cachedBase, gamesWithQuarters: cachedQuarters?.games ?? cachedBase.games };
      return NextResponse.json(payload, { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'cache' } });
    }
    // Cache-only: prod only reads cache; warm job is allowed to fetch. Symbol-name players bypass cache-only and always fetch from AFL Tables.
    if (cacheOnly && !skipCacheWrongData && !skipCacheForSymbol) {
      // 2026 often not warmed or empty; try 2025 from cache so UI can show last season (use 2025 team for players who changed teams).
      const teamFor2025 = season === 2026 ? getPlayerTeamForSeason(2025, effectivePlayerName) : null;
      const teamForFootyWire2025 = teamFor2025 ? getFootyWireTeamNameForPlayerUrl(teamFor2025) : teamForFootyWire;
      const keyBase2025 = season === 2026 && teamForFootyWire2025
        ? buildAflPlayerLogsCacheKey({ season: 2025, playerName: effectivePlayerName, teamForRequest: teamForFootyWire2025, includeQuarters: false })
        : null;
      const keyQuarters2025 = season === 2026 && teamForFootyWire2025
        ? buildAflPlayerLogsCacheKey({ season: 2025, playerName: effectivePlayerName, teamForRequest: teamForFootyWire2025, includeQuarters: true })
        : null;
      if (keyBase2025 && keyQuarters2025) {
        const [cachedBase2025, cachedQuarters2025] = await Promise.all([getAflPlayerLogsCache(keyBase2025), getAflPlayerLogsCache(keyQuarters2025)]);
        const base2025 = cachedBase2025?.games;
        if (cachedBase2025 && Array.isArray(base2025) && base2025.length > 0) {
          const payload = { ...cachedBase2025, gamesWithQuarters: cachedQuarters2025?.games ?? cachedBase2025.games };
          return NextResponse.json(payload, { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'cache' } });
        }
      }
      const empty = { season, source: 'cache-miss', player_name: effectivePlayerName, games: [], game_count: 0, gamesWithQuarters: [] as Record<string, unknown>[] };
      const missHeaders: Record<string, string> = {
        ...sourceHeaders,
        'X-AFL-Player-Logs-Source': 'cache-miss',
        'X-AFL-Cache-Key-Base': keyBase,
        'X-AFL-Cache-Key-Quarters': keyQuarters,
      };
      if (keyBase2025) missHeaders['X-AFL-Cache-Key-2025-Fallback'] = keyBase2025;
      return NextResponse.json(empty, { headers: missHeaders });
    }
    // Warm job or no cache: for players with a symbol in their name (e.g. D'Ambrosio), try AFL Tables first; else FootyWire only.
    const teamsForSeason = teamsToTry.length > 0 ? teamsToTry : (teamFull ? [teamFull] : []);
    if (nameHasSymbol(effectivePlayerName) && teamsForSeason.length > 0) {
      let aflTablesResult = await fetchAflTablesGameLogs(teamsForSeason, effectivePlayerName, season);
      // When 2026 has no games yet, try AFL Tables 2025 so symbol players still see data (AFL Tables only, no FootyWire).
      if (season === 2026 && (!aflTablesResult || aflTablesResult.games.length === 0)) {
        const teams2025 = getTeamsToTryForSeason(2025, effectivePlayerName, teamParam);
        aflTablesResult = teams2025.length > 0 ? await fetchAflTablesGameLogs(teams2025, effectivePlayerName, 2025) : null;
        if (aflTablesResult?.games.length) {
          const actualSeason = aflTablesResult.games[0]?.season ?? 2025;
          const payload = {
            season: actualSeason,
            source: 'afltables.com',
            player_name: effectivePlayerName,
            games: aflTablesResult.games,
            game_count: aflTablesResult.games.length,
            gamesWithQuarters: aflTablesResult.games as unknown as Record<string, unknown>[],
          };
          return NextResponse.json(payload, {
            headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'afltables', 'X-AFL-Season-Fallback': '2025' },
          });
        }
      }
      if (aflTablesResult?.games.length) {
        const payload = {
          season: aflTablesResult.games[0]?.season ?? season,
          source: 'afltables.com',
          player_name: effectivePlayerName,
          games: aflTablesResult.games,
          game_count: aflTablesResult.games.length,
          gamesWithQuarters: aflTablesResult.games as unknown as Record<string, unknown>[],
        };
        return NextResponse.json(payload, { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'afltables' } });
      }
      return NextResponse.json(
        { season, source: 'afltables.com', player_name: effectivePlayerName, games: [], game_count: 0, gamesWithQuarters: [] as Record<string, unknown>[] },
        { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'afltables' } }
      );
    }

    const [fwBase, fwQuarters] = await Promise.all([
      teamsForSeason.length > 0
        ? fetchFootyWireGameLogsWithTeamFallback(teamsForSeason, effectivePlayerName, season, false)
        : null,
      teamsForSeason.length > 0
        ? fetchFootyWireGameLogsWithTeamFallback(teamsForSeason, effectivePlayerName, season, true)
        : null,
    ]);
    // 2026 often has no games until the season starts; FootyWire returns empty for ?year=2026. Serve 2025 data so UI still shows stats.
    if (season === 2026 && (!fwBase || fwBase.games.length === 0)) {
      const teams2025 = getTeamsToTryForSeason(2025, effectivePlayerName, teamParam);
      const teamsFor2025 = teams2025.length > 0 ? teams2025 : (teamFull ? [teamFull] : []);
      const [fw2025Base, fw2025Q] = await Promise.all([
        teamsFor2025.length > 0 ? fetchFootyWireGameLogsWithTeamFallback(teamsFor2025, effectivePlayerName, 2025, false) : null,
        teamsFor2025.length > 0 ? fetchFootyWireGameLogsWithTeamFallback(teamsFor2025, effectivePlayerName, 2025, true) : null,
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
        if (cacheEnabled && fw2025Base.games.length > 0 && hasAdvancedStats(fw2025Base.games)) {
          const baseCache: AflPlayerLogsCachePayload = { season: actualSeason, source: 'footywire.com', player_name: fw2025Base.player_name, games: fw2025Base.games as unknown as Record<string, unknown>[], game_count: fw2025Base.games.length, height: fw2025Base.height ?? undefined, guernsey: fw2025Base.guernsey ?? undefined };
          const quartersCache: AflPlayerLogsCachePayload = { season: actualSeason, source: 'footywire.com', player_name: fw2025Base.player_name, games: quartersGames as unknown as Record<string, unknown>[], game_count: quartersGames.length, height: fw2025Base.height ?? undefined, guernsey: fw2025Base.guernsey ?? undefined };
          await Promise.all([setAflPlayerLogsCache(keyBase, baseCache), setAflPlayerLogsCache(keyQuarters, quartersCache)]);
        }
        return NextResponse.json(payload, {
          headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'footywire', 'X-AFL-Season-Fallback': '2025' },
        });
      }
    }
    const fw = fwBase ?? fwQuarters;
    if (fw?.games.length) {
      const actualSeason = fw.games[0]?.season ?? season;
      const gamesWithQuarters = (fwQuarters?.games?.length ? fwQuarters.games : fw.games) as unknown as Record<string, unknown>[];
      const payload = { season: actualSeason, source: 'footywire.com', player_name: fw.player_name, games: fw.games, game_count: fw.games.length, gamesWithQuarters, height: fw.height ?? undefined, guernsey: fw.guernsey ?? undefined };
      if (cacheEnabled && fw.games.length > 0 && hasAdvancedStats(fw.games)) {
        const baseCache: AflPlayerLogsCachePayload = { season: payload.season, source: payload.source, player_name: payload.player_name, games: payload.games as unknown as Record<string, unknown>[], game_count: payload.game_count, height: payload.height, guernsey: payload.guernsey };
        const quartersCache: AflPlayerLogsCachePayload = { season: payload.season, source: payload.source, player_name: payload.player_name, games: gamesWithQuarters, game_count: gamesWithQuarters.length, height: payload.height, guernsey: payload.guernsey };
        await Promise.all([setAflPlayerLogsCache(keyBase, baseCache), setAflPlayerLogsCache(keyQuarters, quartersCache)]);
      }
      return NextResponse.json(payload, { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'footywire' } });
    }
  }

  const cachedResponse = cacheEnabled ? await getAflPlayerLogsCache(responseCacheKey) : null;
  const cachedGames = cachedResponse?.games;
  const cachedGameCount = cachedResponse?.game_count ?? (Array.isArray(cachedGames) ? cachedGames.length : 0);
  const cachedGamesTyped = cachedGames as { disposals?: number }[] | undefined;
  const skipCacheWrongDataSingle =
    nameHasSymbol(effectivePlayerName) &&
    Array.isArray(cachedGamesTyped) &&
    cachedGamesTyped.length > 0 &&
    cachedDisposalsLookWrong(cachedGamesTyped);
  const skipCacheForSymbolSingle = nameHasSymbol(effectivePlayerName);
  if (
    cachedResponse &&
    Array.isArray(cachedGames) &&
    cachedGames.length > 0 &&
    cachedGameCount > 0 &&
    !skipCacheWrongDataSingle &&
    !skipCacheForSymbolSingle
  ) {
    return NextResponse.json(cachedResponse, {
      headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'cache' },
    });
  }

  // Cache-only: only read from cache. Symbol-name players bypass and always fetch from AFL Tables.
  if (cacheOnly && !skipCacheWrongDataSingle && !skipCacheForSymbolSingle) {
    const teamFor2025Fallback = season === 2026 ? getPlayerTeamForSeason(2025, effectivePlayerName) : null;
    const teamFw2025Fallback = teamFor2025Fallback ? getFootyWireTeamNameForPlayerUrl(teamFor2025Fallback) : teamForFootyWire;
    if (season === 2026 && teamFw2025Fallback) {
      const key2025 = buildAflPlayerLogsCacheKey({
        season: 2025,
        playerName: effectivePlayerName,
        teamForRequest: teamFw2025Fallback,
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
    const empty = { season, source: 'cache-miss', player_name: effectivePlayerName, games: [], game_count: 0 };
    return NextResponse.json(empty, {
      headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'cache-miss', 'X-AFL-Cache-Key': responseCacheKey },
    });
  }

  // Warm job: for symbol-in-name players use AFL Tables; everyone else FootyWire.
  const teamsForSeason = teamsToTry.length > 0 ? teamsToTry : (teamFull ? [teamFull] : []);
  if (nameHasSymbol(effectivePlayerName) && teamsForSeason.length > 0) {
    let aflTablesResult = await fetchAflTablesGameLogs(teamsForSeason, effectivePlayerName, season);
    if (season === 2026 && (!aflTablesResult || aflTablesResult.games.length === 0)) {
      const teams2025 = getTeamsToTryForSeason(2025, effectivePlayerName, teamParam);
      aflTablesResult = teams2025.length > 0 ? await fetchAflTablesGameLogs(teams2025, effectivePlayerName, 2025) : null;
      if (aflTablesResult?.games.length) {
        const actualSeason = aflTablesResult.games[0]?.season ?? 2025;
        const payload = {
          season: actualSeason,
          source: 'afltables.com',
          player_name: effectivePlayerName,
          games: aflTablesResult.games,
          game_count: aflTablesResult.games.length,
        };
        return NextResponse.json(payload, {
          headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'afltables', 'X-AFL-Season-Fallback': '2025' },
        });
      }
    }
    if (aflTablesResult?.games.length) {
      const payload = {
        season: aflTablesResult.games[0]?.season ?? season,
        source: 'afltables.com',
        player_name: effectivePlayerName,
        games: aflTablesResult.games,
        game_count: aflTablesResult.games.length,
      };
      return NextResponse.json(payload, { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'afltables' } });
    }
    return NextResponse.json(
      { season, source: 'afltables.com', player_name: effectivePlayerName, games: [], game_count: 0 },
      { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'afltables' } }
    );
  }

  if (!teamForFootyWire) {
    return NextResponse.json(
      { season, source: 'footywire.com', player_name: effectivePlayerName, games: [], game_count: 0 },
      { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'footywire' } }
    );
  }
  try {
    let fw = teamsForSeason.length > 0
      ? await fetchFootyWireGameLogsWithTeamFallback(teamsForSeason, effectivePlayerName, season, includeQuarterEnrichment)
      : await (teamForFootyWire ? fetchFootyWireGameLogs(teamForFootyWire, effectivePlayerName, season, includeQuarterEnrichment) : Promise.resolve(null));
    // 2026 often has no games yet; serve 2025 data so UI shows stats (same as include_both path).
    if (season === 2026 && (!fw || fw.games.length === 0)) {
      const teams2025 = getTeamsToTryForSeason(2025, effectivePlayerName, teamParam);
      const teamsFor2025 = teams2025.length > 0 ? teams2025 : (teamFull ? [teamFull] : []);
      const fw2025 = teamsFor2025.length > 0
        ? await fetchFootyWireGameLogsWithTeamFallback(teamsFor2025, effectivePlayerName, 2025, includeQuarterEnrichment)
        : null;
      if (fw2025 && fw2025.games.length > 0) {
        fw = fw2025;
      }
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
      if (cacheEnabled && fw.games.length > 0 && hasAdvancedStats(fw.games)) await setAflPlayerLogsCache(responseCacheKey, payload as AflPlayerLogsCachePayload);
      const resHeaders = { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'footywire' as string };
      if (season === 2026 && actualSeason === 2025) (resHeaders as Record<string, string>)['X-AFL-Season-Fallback'] = '2025';
      return NextResponse.json(payload, { headers: resHeaders });
    }
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch AFL game logs', details: err instanceof Error ? err.message : String(err) },
      { status: 502, headers: sourceHeaders }
    );
  }
  return NextResponse.json(
    { season, source: 'footywire.com', player_name: effectivePlayerName, games: [], game_count: 0 },
    { headers: { ...sourceHeaders, 'X-AFL-Player-Logs-Source': 'footywire' } }
  );
}

