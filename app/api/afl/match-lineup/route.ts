import { NextRequest, NextResponse } from 'next/server';

const AFL_TABLES_BASE = 'https://afltables.com';
const TTL_MS = 1000 * 60 * 5; // 5 min (so parser fixes show up without long wait)
const SEASON_CACHE_TTL = 1000 * 60 * 60; // 1 hour
const cache = new Map<string, { expiresAt: number; data: MatchLineupResponse }>();
const seasonMatchesCache = new Map<number, { expiresAt: number; matches: SeasonMatch[] }>();

export type SeasonMatch = { round: string; home: string; away: string; match_url: string };

export type MatchLineupPlayer = {
  number: number | null;
  name: string;
  /** True if this player was subbed on during the match (↑ on AFLTables). */
  subbedOn?: boolean;
  /** True if this player was subbed off during the match (↓ on AFLTables). */
  subbedOff?: boolean;
  /** Heuristic: first 18 in list = starter, rest = interchange. Emergencies are not in match stats. */
  role?: 'starter' | 'interchange';
  /** Optional position label (e.g. "MF") when merged from AFL official API; not set by this route. */
  position?: string;
};

export type MatchLineupResponse = {
  match_url: string;
  home_team: string;
  away_team: string;
  home_players: MatchLineupPlayer[];
  away_players: MatchLineupPlayer[];
  error?: string;
};

function normalizeTeamForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamMatches(pageTeam: string, requestedTeam: string): boolean {
  if (!requestedTeam) return true;
  const a = normalizeTeamForMatch(pageTeam);
  const b = normalizeTeamForMatch(requestedTeam);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // "brisbane lions" vs "brisbane"
  const aWords = a.split(' ').filter(Boolean);
  const bWords = b.split(' ').filter(Boolean);
  return aWords.some((w) => b.includes(w)) || bWords.some((w) => a.includes(w));
}

function htmlToText(v: string): string {
  return v
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseIntSafe(v: string): number | null {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** AFLTables uses "41 ↓" or "38 ↑" in the # column; accept any cell that starts with digits. */
function jumperFromFirstCol(first: string): number | null {
  const m = first.trim().match(/^\d+/);
  return m ? parseIntSafe(m[0]) : null;
}
function isJumperRow(first: string): boolean {
  return /^\s*\d+/.test(first.trim());
}

/** Detect subbed off (↓) and subbed on (↑) from first cell text or raw HTML. */
function subIndicatorsFromFirstCell(firstText: string, rawCell: string): { subbedOn: boolean; subbedOff: boolean } {
  const raw = (rawCell || '').toLowerCase();
  const text = firstText || '';
  return {
    subbedOff: /↓|\u2193|&darr;|&#8595;/i.test(text) || /&darr;|&#8595;/.test(raw),
    subbedOn: /↑|\u2191|&uarr;|&#8593;/i.test(text) || /&uarr;|&#8593;/.test(raw),
  };
}

/** Extract top-level table inner HTML, handling nested <table>...</table>. */
function extractTopLevelTables(html: string): string[] {
  const results: string[] = [];
  const lower = html.toLowerCase();
  let i = 0;
  while (i < html.length) {
    const tableStart = lower.indexOf('<table', i);
    if (tableStart < 0) break;
    const afterOpen = lower.indexOf('>', tableStart) + 1;
    if (afterOpen <= 0) break;
    let depth = 1;
    let pos = afterOpen;
    while (depth > 0 && pos < html.length) {
      const nextOpen = lower.indexOf('<table', pos);
      const nextClose = lower.indexOf('</table>', pos);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 6;
      } else {
        depth--;
        if (depth === 0) {
          results.push(html.slice(afterOpen, nextClose));
          i = nextClose + 8;
          break;
        }
        pos = nextClose + 8;
      }
    }
    if (depth !== 0) i = afterOpen + 1;
  }
  return results;
}

/** Extract every <table>...</table> at any depth; recurse into wrapper tables so we get leaf tables (both team stat tables). */
function extractAllTables(html: string): string[] {
  const results: string[] = [];
  const lower = html.toLowerCase();
  let i = 0;
  while (i < html.length) {
    const tableStart = lower.indexOf('<table', i);
    if (tableStart < 0) break;
    const afterOpen = lower.indexOf('>', tableStart) + 1;
    if (afterOpen <= 0) break;
    let depth = 1;
    let pos = afterOpen;
    while (depth > 0 && pos < html.length) {
      const nextOpen = lower.indexOf('<table', pos);
      const nextClose = lower.indexOf('</table>', pos);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 6;
      } else {
        depth--;
        if (depth === 0) {
          const inner = html.slice(afterOpen, nextClose);
          const nested = extractAllTables(inner);
          if (nested.length > 0) {
            results.push(...nested);
          } else {
            results.push(inner);
          }
          i = nextClose + 8;
          break;
        }
        pos = nextClose + 8;
      }
    }
    if (depth !== 0) i = afterOpen + 1;
  }
  return results;
}

/**
 * Parse AFLTables match stats page for team lineups.
 *
 * Scrape source: https://afltables.com — individual match stats page (e.g. .../games/2025/030520250821.html).
 * Page has two main player tables (one per team) with rows: #, Player, KI, MK, ...
 *
 * Home/away assignment:
 * - Team names: from <title> "TeamA v TeamB - ..." → first = home_team, second = away_team.
 * - Table order: we assume first player table = home, second = away. If AFLTables ever
 *   orders tables differently (e.g. away first), home/away would be swapped; we don’t
 *   currently read any "home"/"away" label from the page.
 */
export type MatchLineupDebug = {
  tableCount: number;
  homeCount: number;
  awayCount: number;
  perTable: Array<{ rows: number; isPlayerTable: boolean; assigned: 'home' | 'away' | 'none' }>;
};

function parseMatchPage(html: string, matchUrl: string, debugOut?: MatchLineupDebug): MatchLineupResponse | null {
  const homePlayers: MatchLineupPlayer[] = [];
  const awayPlayers: MatchLineupPlayer[] = [];
  let homeTeam = '';
  let awayTeam = '';

  // Team names from title: "Melbourne v Collingwood - Mon, 9-Jun-2025..." → home = first, away = second
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const title = htmlToText(titleMatch[1]);
    const vMatch = title.match(/^(.+?)\s+v\s+(.+?)(?:\s+-|$)/i);
    if (vMatch) {
      homeTeam = vMatch[1].trim();
      awayTeam = vMatch[2].trim();
    }
  }

  // Find all tables at any depth (so we get both team tables even when nested inside a wrapper layout table)
  const tableBodies = extractAllTables(html);
  if (debugOut) {
    debugOut.tableCount = tableBodies.length;
    debugOut.perTable = [];
  }
  for (let tableIndex = 0; tableIndex < tableBodies.length; tableIndex++) {
    const tableHtml = tableBodies[tableIndex];
    const rows: string[] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) rows.push(rowMatch[1]);

    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    // AFLTables uses a caption row (e.g. "Essendon Match Statistics") with colspan, then # / Player header
    const headerRowIndex = (() => {
      if (rows.length < 2) return 0;
      let c: RegExpExecArray | null = cellRegex.exec(rows[0]);
      const row0Cells: string[] = [];
      while (c) {
        row0Cells.push(htmlToText(c[1]));
        c = cellRegex.exec(rows[0]);
      }
      if (row0Cells.length >= 2) return 0;
      return 1;
    })();
    const headerRowCells: string[] = [];
    if (rows.length > headerRowIndex) {
      cellRegex.lastIndex = 0;
      let c: RegExpExecArray | null = cellRegex.exec(rows[headerRowIndex]);
      while (c) {
        headerRowCells.push(htmlToText(c[1]));
        c = cellRegex.exec(rows[headerRowIndex]);
      }
    }
    const firstCol = (headerRowCells[0] || '').trim().toLowerCase().replace(/\.$/, '');
    const secondCol = (headerRowCells[1] || '').trim().toLowerCase();
    const looksLikeHeader =
      (firstCol === '#' || firstCol === 'gm' || firstCol === 'no' || firstCol === 'no.' || firstCol === 'jumper' || /^\d+$/.test(firstCol)) &&
      (secondCol === 'player' || secondCol === 'opponent' || secondCol === 'name' || secondCol.length > 2);
    const enoughCols = headerRowCells.length >= 2;

    // Accept table if we find 6+ player-like rows (number in col0, name/link in col1)
    let isPlayerTable = looksLikeHeader;
    if (!isPlayerTable && rows.length > 4 && (enoughCols || rows.length > 15)) {
      let playerLikeRows = 0;
      const countStart = headerRowIndex === 0 ? 1 : headerRowIndex + 1;
      for (let i = countStart; i < Math.min(rows.length, 30); i++) {
        cellRegex.lastIndex = 0;
        const cells: string[] = [];
        let ci: RegExpExecArray | null = cellRegex.exec(rows[i]);
        while (ci) {
          cells.push(ci[1]);
          ci = cellRegex.exec(rows[i]);
        }
        const t0 = htmlToText(cells[0] ?? '').trim();
        const t1 = (cells[1] && (htmlToText(cells[1]).trim() || /<a[^>]*>[\s\S]*?<\/a>/i.test(cells[1])));
        if (isJumperRow(t0) && t1) playerLikeRows++;
      }
      if (playerLikeRows >= 6) isPlayerTable = true;
    }
    if (debugOut) {
      debugOut.perTable.push({ rows: rows.length, isPlayerTable, assigned: 'none' });
    }

    if (isPlayerTable && rows.length > 1) {
      const startRow = looksLikeHeader ? headerRowIndex + 1 : headerRowIndex;
      let currentBlock: MatchLineupPlayer[] = [];
      // Second (and later) tables go to away; only the first table's first block is home.
      let assignedFirst = homePlayers.length > 0;
      for (let i = startRow; i < rows.length; i++) {
        cellRegex.lastIndex = 0;
        const cells: string[] = [];
        let c: RegExpExecArray | null = cellRegex.exec(rows[i]);
        while (c) {
          cells.push(c[1]);
          c = cellRegex.exec(rows[i]);
        }
        const texts = cells.map((raw) => htmlToText(raw));
        if (texts.length < 2) continue;
        const first = texts[0].trim();
        const firstLower = first.toLowerCase();
        const isBlockEnd =
          firstLower === 'totals' || firstLower === 'averages' || firstLower === 'opposition' || firstLower === 'rushed' ||
          firstLower.startsWith('total') || firstLower.startsWith('rushed');
        if (isBlockEnd) {
          if (currentBlock.length >= 4) {
            if (!assignedFirst) {
              homePlayers.push(...currentBlock);
              if (!homeTeam && tableIndex === 0) homeTeam = 'Team A';
              assignedFirst = true;
              if (debugOut && debugOut.perTable[tableIndex]) debugOut.perTable[tableIndex].assigned = 'home';
            } else {
              awayPlayers.push(...currentBlock);
              if (!awayTeam) awayTeam = 'Team B';
              if (debugOut && debugOut.perTable[tableIndex]) debugOut.perTable[tableIndex].assigned = 'away';
            }
          }
          currentBlock = [];
          continue;
        }
        const num = jumperFromFirstCol(first);
        let name = texts[1].trim();
        if (!name && cells[1]) {
          const anchorMatch = cells[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i);
          if (anchorMatch) name = htmlToText(anchorMatch[1]).trim();
        }
        if (num !== null && name && name.length < 80) {
          const { subbedOn, subbedOff } = subIndicatorsFromFirstCell(first, cells[0] ?? '');
          const role = currentBlock.length < 18 ? 'starter' : 'interchange';
          currentBlock.push({ number: num, name, subbedOn, subbedOff, role });
        }
      }
      if (currentBlock.length >= 4) {
        if (!assignedFirst) {
          homePlayers.push(...currentBlock);
          if (!homeTeam && tableIndex === 0) homeTeam = 'Team A';
          if (debugOut && debugOut.perTable[tableIndex]) debugOut.perTable[tableIndex].assigned = 'home';
        } else {
          awayPlayers.push(...currentBlock);
          if (!awayTeam) awayTeam = 'Team B';
          if (debugOut && debugOut.perTable[tableIndex]) debugOut.perTable[tableIndex].assigned = 'away';
        }
      }
    } else if (homePlayers.length > 0 && awayPlayers.length === 0 && rows.length > 2) {
      // Second table may have a caption row ("Team Name Match Statistics") or different header — parse anyway
      const players: MatchLineupPlayer[] = [];
      for (let i = 1; i < rows.length; i++) {
        cellRegex.lastIndex = 0;
        const cells: string[] = [];
        let c: RegExpExecArray | null = cellRegex.exec(rows[i]);
        while (c) {
          cells.push(c[1]);
          c = cellRegex.exec(rows[i]);
        }
        const texts = cells.map((raw) => htmlToText(raw));
        if (texts.length < 2) continue;
        const first = texts[0].trim();
        const firstLower = first.toLowerCase();
        if (firstLower === 'totals' || firstLower === 'averages' || firstLower === 'opposition' || firstLower === 'rushed' || firstLower.startsWith('total') || firstLower.startsWith('rushed')) break;
        const num = jumperFromFirstCol(first);
        let name = texts[1].trim();
        if (!name && cells[1]) {
          const anchorMatch = cells[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i);
          if (anchorMatch) name = htmlToText(anchorMatch[1]).trim();
        }
        if (num !== null && name && name.length < 80) {
          const { subbedOn, subbedOff } = subIndicatorsFromFirstCell(first, cells[0] ?? '');
          const role = players.length < 18 ? 'starter' : 'interchange';
          players.push({ number: num, name, subbedOn, subbedOff, role });
        }
      }
      if (players.length >= 4) {
        awayPlayers.push(...players);
        if (!awayTeam) awayTeam = 'Team B';
        if (debugOut && debugOut.perTable[tableIndex]) debugOut.perTable[tableIndex].assigned = 'away';
      }
    }
  }
  if (debugOut) {
    debugOut.homeCount = homePlayers.length;
    debugOut.awayCount = awayPlayers.length;
  }

  // Fallback: if no player tables found, try any table with 4+ rows of (number, name)
  if (homePlayers.length === 0 && awayPlayers.length === 0) {
    for (const tableHtml of tableBodies) {
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      const rows: string[] = [];
      let rm: RegExpExecArray | null;
      while ((rm = rowRegex.exec(tableHtml)) !== null) rows.push(rm[1]);
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let count = 0;
      const collected: MatchLineupPlayer[] = [];
      for (let i = 1; i < Math.min(rows.length, 25); i++) {
        cellRegex.lastIndex = 0;
        const cells: string[] = [];
        let ci: RegExpExecArray | null = cellRegex.exec(rows[i]);
        while (ci) {
          cells.push(ci[1]);
          ci = cellRegex.exec(rows[i]);
        }
        if (cells.length < 2) continue;
        const t0 = htmlToText(cells[0] ?? '').trim();
        let name = htmlToText(cells[1] ?? '').trim();
        if (!name && cells[1]) {
          const anchorMatch = cells[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i);
          if (anchorMatch) name = htmlToText(anchorMatch[1]).trim();
        }
        const num = jumperFromFirstCol(t0);
        if (num !== null && name && name.length < 80) {
          const role = collected.length < 18 ? 'starter' : 'interchange';
          collected.push({ number: num, name, role });
          count++;
        }
      }
      if (count >= 4) {
        homePlayers.push(...collected);
        if (!homeTeam) homeTeam = 'Team';
        break;
      }
    }
  }

  // If we only found one table, put all in home
  if (awayPlayers.length === 0 && homePlayers.length > 0 && !awayTeam) {
    awayTeam = '';
  }
  if (homePlayers.length === 0 && awayPlayers.length > 0) {
    homePlayers.push(...awayPlayers);
    awayPlayers.length = 0;
    if (!homeTeam) homeTeam = awayTeam || 'Team';
    awayTeam = '';
  }

  return {
    match_url: matchUrl,
    home_team: homeTeam,
    away_team: awayTeam,
    home_players: homePlayers,
    away_players: awayPlayers,
  };
}

// Match links: /afl/stats/games/YEAR/xxx.html, stats/games/YEAR/xxx.html, ../games/YEAR/xxx.html, or games/YEAR/xxx.html
const SEASON_GAME_LINK = /href\s*=\s*['"]([^'"]*(?:\/afl\/)?stats\/games\/\d+\/[^'"]+\.html)['"][^>]*>([\s\S]*?)<\/a>/gi;
const SEASON_GAME_LINK_ALT = /href\s*=\s*['"]([^'"]*\/games\/\d+\/[^'"]+\.html)['"][^>]*>([\s\S]*?)<\/a>/gi;
const ROUND_HEADING = /<(?:h[2-4]|b|td)[^>]*>([^<]*(?:Round\s*\d+|R\d+|PF|GF|QF|EF|SF|Grand\s*Final|Preliminary|Qualifying|Elimination|Semi)[^<]*)<\/\w+/gi;

function normalizeRoundLabel(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim().toUpperCase();
  if (/^R\d+$/.test(t)) return t;
  if (/^\d+$/.test(t)) return 'R' + t; // plain "23" -> "R23"
  if (t.includes('GRAND') || t === 'GF') return 'GF';
  if (t.includes('PRELIMINARY') || t === 'PF') return 'PF';
  if (t.includes('SEMI') || t === 'SF') return 'SF';
  if (t.includes('QUALIFYING') || t === 'QF') return 'QF';
  if (t.includes('ELIMINATION') || t === 'EF') return 'EF';
  if (t.includes('ROUND') && /\d+/.test(t)) return 'R' + (t.match(/\d+/)?.[0] ?? '');
  return t;
}

/** AFL finals: round 25 = QF/EF, 26 = SF, 27 = PF, 28 = GF. Season pages use QF/PF/GF etc. */
function roundLabelsToTry(roundParam: string): string[] {
  const norm = normalizeRoundLabel(roundParam);
  const labels = [norm];
  const n = parseInt(roundParam.trim(), 10);
  if (Number.isFinite(n) && n >= 25 && n <= 28) {
    if (n === 25) labels.push('QF', 'EF');
    else if (n === 26) labels.push('SF');
    else if (n === 27) labels.push('PF');
    else if (n === 28) labels.push('GF');
  }
  return [...new Set(labels)];
}

function teamNameFromLinkText(text: string): { home: string; away: string } | null {
  const cleaned = htmlToText(text).trim();
  const vIdx = cleaned.toLowerCase().indexOf(' v ');
  if (vIdx < 0) return null;
  const left = cleaned.slice(0, vIdx).replace(/\d[\d.\s]*$/, '').trim();
  const right = cleaned.slice(vIdx + 3).replace(/\d[\d.\s]*$/, '').trim();
  if (!left || !right) return null;
  return { home: left, away: right };
}

/** Get the table row HTML that contains the given character index. */
function getRowContainingIndex(html: string, index: number): string {
  const before = html.slice(0, index);
  const trStart = before.lastIndexOf('<tr');
  if (trStart < 0) return '';
  const after = html.slice(trStart);
  const trEnd = after.indexOf('</tr>');
  if (trEnd < 0) return '';
  return after.slice(0, trEnd + 5);
}

/** First word or known short form for AFLTables (e.g. "Collingwood Magpies" -> "Collingwood"). */
function shortTeamName(full: string): string {
  const t = full.trim();
  if (!t) return t;
  const first = t.split(/\s+/)[0];
  if (first && first.length >= 2) return first;
  return t;
}

async function fetchSeasonMatches(season: number): Promise<SeasonMatch[]> {
  const cached = seasonMatchesCache.get(season);
  if (cached && cached.expiresAt > Date.now()) return cached.matches;

  const url = `${AFL_TABLES_BASE}/afl/seas/${season}.html`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-AU,en;q=0.9',
    },
    next: { revalidate: 60 * 60 },
  });
  if (!res.ok) {
    console.warn('[AFL match-lineup] Season page fetch failed', season, res.status, url);
    return [];
  }
  const html = await res.text();

  const matches: SeasonMatch[] = [];
  let currentRound = '';

  const roundHeadings: { index: number; label: string }[] = [];
  let roundMatch: RegExpExecArray | null = null;
  const roundRegex = new RegExp(ROUND_HEADING.source, 'gi');
  while ((roundMatch = roundRegex.exec(html)) !== null) {
    const label = normalizeRoundLabel(htmlToText(roundMatch[1]));
    if (label) roundHeadings.push({ index: roundMatch.index, label });
  }

  const extractLinks = (regex: RegExp) => {
    let m: RegExpExecArray | null = null;
    while ((m = regex.exec(html)) !== null) {
      const rawHref = m[1].trim();
      let fullUrl: string;
      if (rawHref.startsWith('http')) {
        fullUrl = rawHref;
      } else if (rawHref.startsWith('/')) {
        fullUrl = `${AFL_TABLES_BASE}${rawHref}`;
      } else {
        const path = rawHref.replace(/^\.\.\//, '');
        fullUrl = path.startsWith('afl/') ? `${AFL_TABLES_BASE}/${path}` : path.includes('stats/') ? `${AFL_TABLES_BASE}/afl/${path}` : `${AFL_TABLES_BASE}/afl/stats/${path}`;
      }
      let teams = teamNameFromLinkText(m[2]);
      if (!teams) {
        const rowHtml = getRowContainingIndex(html, m.index);
        teams = rowHtml ? teamNameFromLinkText(rowHtml) : null;
      }
      if (!teams) continue;
      const roundBefore = roundHeadings.filter((r) => r.index < m!.index).pop();
      const roundLabel = roundBefore?.label;
      const round = roundLabel !== undefined && roundLabel !== '' ? roundLabel : (currentRound ? currentRound : 'R?');
      if (roundBefore) currentRound = roundBefore.label;
      if (!matches.some((x) => x.match_url === fullUrl)) {
        matches.push({ round, home: teams.home, away: teams.away, match_url: fullUrl });
      }
    }
  };
  extractLinks(new RegExp(SEASON_GAME_LINK.source, 'gi'));
  if (matches.length === 0) extractLinks(new RegExp(SEASON_GAME_LINK_ALT.source, 'gi'));

  // AFLTables sometimes uses 2025a.html for the premiership season fixture.
  if (matches.length === 0 && season >= 2020) {
    const urlAlt = `${AFL_TABLES_BASE}/afl/seas/${season}a.html`;
    const resAlt = await fetch(urlAlt, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
      next: { revalidate: 60 * 60 },
    });
    if (resAlt.ok) {
      const htmlAlt = await resAlt.text();
      roundHeadings.length = 0;
      currentRound = '';
      let roundMatchAlt: RegExpExecArray | null = null;
      const roundRegexAlt = new RegExp(ROUND_HEADING.source, 'gi');
      while ((roundMatchAlt = roundRegexAlt.exec(htmlAlt)) !== null) {
        const label = normalizeRoundLabel(htmlToText(roundMatchAlt[1]));
        if (label) roundHeadings.push({ index: roundMatchAlt.index, label });
      }
      const extractLinksAlt = (regex: RegExp) => {
        let m: RegExpExecArray | null = null;
        while ((m = regex.exec(htmlAlt)) !== null) {
          const rawHref = m[1].trim();
          let fullUrl: string;
          if (rawHref.startsWith('http')) {
            fullUrl = rawHref;
          } else if (rawHref.startsWith('/')) {
            fullUrl = `${AFL_TABLES_BASE}${rawHref}`;
          } else {
            const path = rawHref.replace(/^\.\.\//, '');
            fullUrl = path.startsWith('afl/') ? `${AFL_TABLES_BASE}/${path}` : path.includes('stats/') ? `${AFL_TABLES_BASE}/afl/${path}` : `${AFL_TABLES_BASE}/afl/stats/${path}`;
          }
          let teams = teamNameFromLinkText(m[2]);
          if (!teams) {
            const rowHtml = getRowContainingIndex(htmlAlt, m.index);
            teams = rowHtml ? teamNameFromLinkText(rowHtml) : null;
          }
          if (!teams) continue;
          const roundBefore = roundHeadings.filter((r) => r.index < m!.index).pop();
          const roundLabel = roundBefore?.label;
          const round = roundLabel !== undefined && roundLabel !== '' ? roundLabel : (currentRound ? currentRound : 'R?');
          if (roundBefore) currentRound = roundBefore.label;
          if (!matches.some((x) => x.match_url === fullUrl)) {
            matches.push({ round, home: teams.home, away: teams.away, match_url: fullUrl });
          }
        }
      };
      extractLinksAlt(new RegExp(SEASON_GAME_LINK.source, 'gi'));
      if (matches.length === 0) extractLinksAlt(new RegExp(SEASON_GAME_LINK_ALT.source, 'gi'));
    }
  }
  if (matches.length === 0) {
    console.warn('[AFL match-lineup] No match links found on season page', season, 'htmlLength=', html.length);
  }
  seasonMatchesCache.set(season, { expiresAt: Date.now() + SEASON_CACHE_TTL, matches });
  return matches;
}

export { fetchSeasonMatches };

function resolveMatchUrlFromSeason(
  season: number,
  round: string,
  team: string,
  opponent: string | null
): Promise<{ url: string | null; debug?: { matchCount: number; rounds: string[] } }> {
  return fetchSeasonMatches(season).then((matches) => {
    const roundLabels = roundLabelsToTry(round);
    const teamAlts = [team, shortTeamName(team)].filter(Boolean);
    const opponentAlts = opponent ? [opponent, shortTeamName(opponent)].filter(Boolean) : [];
    const tryMatch = (m: SeasonMatch, t: string, o: string) =>
      (teamMatches(m.home, t) && teamMatches(m.away, o)) || (teamMatches(m.away, t) && teamMatches(m.home, o));
    const teamInMatch = (m: SeasonMatch, t: string) => teamMatches(m.home, t) || teamMatches(m.away, t);
    const roundOk = (m: SeasonMatch) =>
      roundLabels.some(
        (rl) => m.round === rl || m.round.includes(rl) || rl.includes(m.round)
      );

    for (const t of teamAlts) {
      if (opponentAlts.length > 0) {
        for (const o of opponentAlts) {
          const byRoundAndTeams = matches.find((m) => roundOk(m) && tryMatch(m, t, o));
          if (byRoundAndTeams) return { url: byRoundAndTeams.match_url };
          const byTeamsOnly = matches.filter((m) => tryMatch(m, t, o));
          if (byTeamsOnly.length > 0) return { url: byTeamsOnly[byTeamsOnly.length - 1].match_url };
        }
      }
      // No opponent: use any match in this round where team played
      const byRoundAndTeam = matches.find((m) => roundOk(m) && teamInMatch(m, t));
      if (byRoundAndTeam) return { url: byRoundAndTeam.match_url };
      const anyForTeam = matches.filter((m) => teamInMatch(m, t));
      if (anyForTeam.length > 0) return { url: anyForTeam[anyForTeam.length - 1].match_url };
    }
    const rounds = [...new Set(matches.map((m) => m.round))];
    return { url: null, debug: { matchCount: matches.length, rounds } };
  });
}

/** Normalize AFLTables match URL: resolve ../ and ensure path is /afl/stats/games/YEAR/xxx.html */
function normalizeMatchUrlForFetch(url: string): string {
  let u = url.trim();
  try {
    const parsed = new URL(u);
    if (parsed.hostname?.toLowerCase().includes('afltables.com')) {
      let path = parsed.pathname.replace(/\/+/g, '/');
      // Resolve /stats/../games/ -> /stats/games/ (or /afl/games/ -> /afl/stats/games/)
      if (path.includes('/games/') && !path.includes('/stats/games/')) {
        const gamesMatch = path.match(/\/games\/(\d{4})\/([^/]+\.html?)$/i);
        if (gamesMatch) {
          path = `/afl/stats/games/${gamesMatch[1]}/${gamesMatch[2]}`;
        }
      }
      path = path.replace(/\/stats\/\.\.\/games\//, '/stats/games/');
      return `${parsed.protocol}//${parsed.host}${path}${parsed.search || ''}`;
    }
  } catch {
    // fall through
  }
  return u;
}

export async function GET(request: NextRequest) {
  const matchUrlParam = request.nextUrl.searchParams.get('match_url') ?? request.nextUrl.searchParams.get('url');
  const teamParam = request.nextUrl.searchParams.get('team');
  const seasonParam = request.nextUrl.searchParams.get('season');
  const roundParam = request.nextUrl.searchParams.get('round');
  const opponentParam = request.nextUrl.searchParams.get('opponent');
  const debugParam = request.nextUrl.searchParams.get('debug');
  const withDebug = debugParam === '1' || debugParam === 'true';

  let matchUrl: string | null = matchUrlParam?.trim() ?? null;
  if (matchUrl && !matchUrl.startsWith('http')) {
    matchUrl = matchUrl.startsWith('/') ? `${AFL_TABLES_BASE}${matchUrl}` : `${AFL_TABLES_BASE}/afl/stats/games/${matchUrl}`;
  }
  if (matchUrl) {
    matchUrl = normalizeMatchUrlForFetch(matchUrl);
  }

  const useFallback =
    (!matchUrl || !matchUrl.length) &&
    teamParam?.trim() &&
    seasonParam &&
    roundParam;

  if (!matchUrl && !useFallback) {
    return NextResponse.json(
      { error: 'Provide match_url or (season, round, team) to resolve match', players: [], home_players: [], away_players: [] },
      { status: 400 }
    );
  }

  if (useFallback) {
    const season = parseInt(seasonParam!, 10);
    if (!Number.isFinite(season)) {
      return NextResponse.json({ error: 'Invalid season' }, { status: 400 });
    }
    const opponentNorm = (opponentParam ?? '').replace(/^vs\.?\s*/i, '').trim() || null;
    try {
      const result = await resolveMatchUrlFromSeason(
        season,
        roundParam!,
        teamParam!,
        opponentNorm
      );
      if (result.url) matchUrl = result.url;
      if (!matchUrl && result.debug) {
        return NextResponse.json(
          { error: 'Could not resolve match URL from season page', debug: result.debug },
          { status: 404 }
        );
      }
    } catch (e) {
      console.error('[AFL match-lineup] resolve from season', e);
    }
  }

  if (!matchUrl) {
    return NextResponse.json(
      { error: 'Could not resolve match URL from season page' },
      { status: 404 }
    );
  }

  const cacheKey = `${matchUrl}|${teamParam ?? ''}`;
  const cached = !withDebug && cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data);
  }

  try {
    const res = await fetch(matchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
      next: { revalidate: 60 * 30 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch match page (${res.status})`, match_url: matchUrl },
        { status: 502 }
      );
    }
    const html = await res.text();
    const lineupDebug: MatchLineupDebug | undefined = withDebug
      ? { tableCount: 0, homeCount: 0, awayCount: 0, perTable: [] }
      : undefined;
    const data = parseMatchPage(html, matchUrl, lineupDebug);
    if (!data) {
      const debug = { match_url: matchUrl, htmlLength: html.length, homeCount: 0, awayCount: 0, ...lineupDebug };
      return NextResponse.json(
        { error: 'Could not parse lineup from match page', match_url: matchUrl, debug, players: [], home_players: [], away_players: [] },
        { status: 422 }
      );
    }
    if (!withDebug) cache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, data });

    return NextResponse.json(withDebug && lineupDebug ? { ...data, debug: lineupDebug } : data);
  } catch (err) {
    console.error('[AFL match-lineup]', err);
    return NextResponse.json(
      {
        error: 'Failed to fetch match lineup',
        details: err instanceof Error ? err.message : String(err),
        match_url: matchUrl,
      },
      { status: 502 }
    );
  }
}

function filterTeamLineup(
  data: MatchLineupResponse,
  team: string
): MatchLineupResponse & { team_label?: string; players?: Array<{ number: number | null; name: string }> } {
  // Normalise requested team for matching (e.g. "Carlton Blues" matches page "Carlton")
  const homeMatch = teamMatches(data.home_team, team);
  const awayMatch = teamMatches(data.away_team, team);
  if (homeMatch && !awayMatch) {
    return {
      ...data,
      away_team: '',
      away_players: [],
      team_label: data.home_team,
      players: data.home_players,
    };
  }
  if (awayMatch && !homeMatch) {
    return {
      ...data,
      home_team: '',
      home_players: [],
      team_label: data.away_team,
      players: data.away_players,
    };
  }
  if (homeMatch && awayMatch) {
    const players = data.home_players.length >= data.away_players.length ? data.home_players : data.away_players;
    return { ...data, team_label: data.home_team || data.away_team, players };
  }
  // Neither team name matched (e.g. page has "Carlton" but we only got "Team A" / "Team B")
  // Prefer the list that matches requested team's short name (e.g. "Carlton" from "Carlton Blues")
  const shortReq = shortTeamName(team);
  const homeShortMatch = shortReq && teamMatches(data.home_team, shortReq);
  const awayShortMatch = shortReq && teamMatches(data.away_team, shortReq);
  if (homeShortMatch && !awayShortMatch && data.home_players.length) {
    return { ...data, team_label: data.home_team, players: data.home_players };
  }
  if (awayShortMatch && !homeShortMatch && data.away_players.length) {
    return { ...data, team_label: data.away_team, players: data.away_players };
  }
  // Last resort: ensure `players` is set so UI can show something (first non-empty list)
  const fallbackPlayers = data.home_players.length ? data.home_players : data.away_players.length ? data.away_players : undefined;
  if (fallbackPlayers?.length) {
    return { ...data, team_label: data.home_team || data.away_team || team, players: fallbackPlayers };
  }
  return data;
}
