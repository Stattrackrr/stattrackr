import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

/** FootyWire AFL Team Selections page - actual lineup (positions, interchange, emergencies) + URL. */
const FOOTYWIRE_TEAM_SELECTIONS_URL = 'https://www.footywire.com/afl/footy/afl_team_selections';
const TTL_MS = 1000 * 60 * 30; // 30 min
/** Cache full round (all matches). Response may be filtered by ?team= when returning. */
let cached: { expiresAt: number; data: TeamSelectionsRoundResponse } | null = null;

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
  Referer: 'https://www.footywire.com/',
};

export type PlayerEntry = { name: string; number?: string };

export type PositionRow = {
  position: string;
  home_players: PlayerEntry[];
  away_players: PlayerEntry[];
};

export type TeamSelectionsResponse = {
  url: string;
  title: string | null;
  round_label: string | null;
  match: string | null;
  home_team: string | null;
  away_team: string | null;
  positions: PositionRow[];
  interchange: { home: string[]; away: string[] };
  emergencies: { home: string[]; away: string[] };
  average_attributes: {
    home: { height?: string; age?: string; games?: string };
    away: { height?: string; age?: string; games?: string };
  } | null;
  total_players_by_games: Array<{ category: string; home: string; away: string }> | null;
  error?: string;
};

/** Full round: all matches with lineups (page has one section per game). */
export type TeamSelectionsRoundResponse = {
  url: string;
  title: string | null;
  round_label: string | null;
  matches: TeamSelectionsResponse[];
  error?: string;
};

/** League stats team keys (data/afl-league-player-stats-*.json). */
const LEAGUE_TEAM_KEYS = [
  'Adelaide', 'Brisbane', 'Carlton', 'Collingwood', 'Essendon', 'Fremantle', 'Geelong', 'Gold Coast',
  'GWS', 'Hawthorn', 'Melbourne', 'North Melbourne', 'Port Adelaide', 'Richmond', 'St Kilda',
  'Sydney', 'West Coast', 'Western Bulldogs',
] as const;

let cached2026Lookup: Map<string, number> | null = null;

function normalizeNameForLookup(name: string): string {
  return (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Match team string from lineup (e.g. "Geelong Cats", "Gold Coast") to league stats team key. */
function matchTeamToLeagueKey(team: string | null): string | null {
  if (!team || !team.trim()) return null;
  const t = team.trim().toLowerCase();
  // GWS vs Sydney: "Greater Western Sydney" / "GWS Giants" must map to GWS, not Sydney (substring)
  if (t.includes('greater western') || t === 'gws' || /^gws\s/.test(t) || t.startsWith('gws ')) return 'GWS';
  const byLength = [...LEAGUE_TEAM_KEYS].sort((a, b) => b.length - a.length);
  for (const key of byLength) {
    if (key === 'GWS') continue; // already handled above
    if (t.includes(key.toLowerCase()) || key.toLowerCase().includes(t)) return key;
  }
  return null;
}

/** Build lookup from data/afl-player-jumper-numbers-2026.json (run scripts/fetch-afl-2026-jumper-numbers.js to generate). */
function get2026PlayerNumberLookup(): Map<string, number> {
  if (cached2026Lookup) return cached2026Lookup;
  try {
    const dataPath = path.join(process.cwd(), 'data', 'afl-player-jumper-numbers-2026.json');
    const raw = fs.readFileSync(dataPath, 'utf-8');
    const data = JSON.parse(raw) as { players?: Array<{ name?: string; team?: string; number?: number | null }> };
    const map = new Map<string, number>();
    const list = data?.players ?? [];
    for (const p of list) {
      const name = (p?.name ?? '').trim();
      const team = (p?.team ?? '').trim();
      const num = typeof p?.number === 'number' && Number.isFinite(p.number) ? p.number : null;
      if (!name || !team || num == null) continue;
      const key = `${team}|${normalizeNameForLookup(name)}`;
      map.set(key, num);
    }
    cached2026Lookup = map;
    return map;
  } catch {
    return new Map();
  }
}

/** Enrich position and interchange/emergency players with 2026 jumper numbers from league stats. */
function enrichWith2026Numbers(match: TeamSelectionsResponse): void {
  const lookup = get2026PlayerNumberLookup();
  if (lookup.size === 0) return;
  const homeKey = matchTeamToLeagueKey(match.home_team ?? null);
  const awayKey = matchTeamToLeagueKey(match.away_team ?? null);

  for (const row of match.positions ?? []) {
    for (const entry of row.home_players ?? []) {
      if (homeKey && !entry.number) {
        const n = lookup.get(`${homeKey}|${normalizeNameForLookup(entry.name)}`);
        if (n != null) entry.number = String(n);
      }
    }
    for (const entry of row.away_players ?? []) {
      if (awayKey && !entry.number) {
        const n = lookup.get(`${awayKey}|${normalizeNameForLookup(entry.name)}`);
        if (n != null) entry.number = String(n);
      }
    }
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract text from first <a> in a cell if present, else plain text. */
function cellToPlayerName(cellHtml: string): string {
  const anchor = cellHtml.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
  const inner = anchor ? anchor[1] : cellHtml;
  return htmlToText(inner).trim();
}

/** Find all table rows, return array of cell contents (raw HTML per cell). */
function getTableRows(tableHtml: string): string[][] {
  const rows: string[][] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null = null;
  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const row = rowMatch[1];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let c: RegExpExecArray | null = null;
    while ((c = cellRegex.exec(row)) !== null) cells.push(c[1]);
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/** Get all link text from table cells (any <a> inside <td>/<th>) that looks like a name - no href filter. */
function extractNamesFromTableCells(html: string): string[] {
  const names: string[] = [];
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let cellMatch: RegExpExecArray | null = null;
  while ((cellMatch = cellRegex.exec(html)) !== null) {
    const inner = cellMatch[1];
    const a = inner.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    const text = htmlToText((a ? a[1] : inner)).trim();
    const isPos = /^(FB|FF|HB|HF|C|Fol)$/i.test(text);
    if (text.length >= 2 && text.length <= 45 && !isPos && !SIDEBAR_LIKE.test(text) && /[A-Za-z]{2,}/.test(text)) {
      names.push(text);
    }
  }
  return names;
}

/** Max 3 players per position per team (AFL lineup). */
const MAX_PLAYERS_PER_POSITION = 3;

/** Fallback: get all player links from main content (before Interchange), build positions by order. Cap 3 per team per position. */
function parsePositionsFromPlayerLinks(html: string): PositionRow[] {
  const lower = html.toLowerCase();
  const interIdx = lower.indexOf('interchange');
  const attrIdx = lower.indexOf('average attribute');
  const end = interIdx >= 0 ? interIdx : attrIdx >= 0 ? attrIdx : html.length;
  const main = html.slice(0, end);
  let names = extractPlayerNamesFromHtml(main);
  if (names.length < 18) {
    names = extractNamesFromTableCells(main);
  }
  if (names.length < 18) {
    names = extractAllPlayerLinksInOrder(main);
  }
  if (names.length < 18) return [];
  const perTeam = Math.min(18, Math.floor(names.length / 2));
  const home = names.slice(0, perTeam).map((n) => ({ name: n }));
  const away = names.slice(perTeam, perTeam + perTeam).map((n) => ({ name: n }));
  const posOrder = ['FB', 'HB', 'C', 'HF', 'FF', 'Fol'];
  const positions: PositionRow[] = [];
  const three = MAX_PLAYERS_PER_POSITION;
  for (let i = 0; i < posOrder.length; i++) {
    const start = i * three;
    positions.push({
      position: posOrder[i],
      home_players: home.slice(start, start + three).filter((e) => e.name),
      away_players: away.slice(start, start + three).filter((e) => e.name),
    });
  }
  return positions;
}

/** Parse title e.g. "AFL 2026 Round 0 Team Selections". */
function parseTitle(html: string): { title: string | null; round_label: string | null } {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h2 = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const raw = (h1?.[1] ?? h2?.[1] ?? '').trim();
  const text = htmlToText(raw);
  if (!text) return { title: null, round_label: null };
  const roundMatch = text.match(/(\d{4}\s*Round\s*\d+|Round\s*\d+)/i);
  return {
    title: text || null,
    round_label: roundMatch ? roundMatch[1].trim() : null,
  };
}

/** Known AFL team names for match line parsing. */
const TEAM_NAMES =
  'Sydney|Carlton|Collingwood|Melbourne|Geelong|Richmond|Essendon|Hawthorn|Brisbane|Port Adelaide|Western Bulldogs|St Kilda|Fremantle|Adelaide|West Coast|North Melbourne|GWS|Gold Coast';

/** Parse match line e.g. "Sydney v Carlton (SCG)". */
function parseMatch(html: string): { match: string | null; home_team: string | null; away_team: string | null } {
  const normalised = html
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const teamRe = new RegExp(`(${TEAM_NAMES})\\s+v\\s+(${TEAM_NAMES})\\s*(\\([^)]*\\))?`, 'gi');
  const m = normalised.match(teamRe);
  if (m && m.length > 0) {
    const first = m[0];
    const parts = new RegExp(`(${TEAM_NAMES})\\s+v\\s+(${TEAM_NAMES})\\s*(\\([^)]*\\))?`, 'i').exec(first);
    if (parts) {
      const home = parts[1].trim();
      const away = parts[2].trim();
      const venue = (parts[3] ?? '').trim();
      const matchStr = venue ? `${home} v ${away} ${venue}` : `${home} v ${away}`;
      return { match: matchStr, home_team: home, away_team: away };
    }
  }
  const fallback = /([A-Za-z][A-Za-z\s]+?)\s+v\s+([A-Za-z][A-Za-z\s]*?)\s*(\([^)]*\))?/i.exec(normalised);
  if (fallback && !/Team Selections|Fixture|Statistics|Print|PDF|Theme/i.test(fallback[1])) {
    const home = fallback[1].trim();
    const away = fallback[2].trim();
    if (home.length >= 2 && away.length >= 2) {
      const venue = (fallback[3] ?? '').trim();
      const matchStr = venue ? `${home} v ${away} ${venue}` : `${home} v ${away}`;
      return { match: matchStr, home_team: home, away_team: away };
    }
  }
  return { match: null, home_team: null, away_team: null };
}

const MATCH_HEADER_REGEX = new RegExp(`(${TEAM_NAMES})\\s+v\\s+(${TEAM_NAMES})(?:\\s*\\([^)]*\\))?`, 'gi');

/** Find start indices of every "Team v Team (Venue)" match header in HTML. */
function findMatchOffsets(html: string): number[] {
  const offsets: number[] = [];
  const re = new RegExp(`(${TEAM_NAMES})\\s+v\\s+(${TEAM_NAMES})(?:\\s*\\([^)]*\\))?`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (offsets.length === 0 || m.index >= offsets[offsets.length - 1] + 15) {
      offsets.push(m.index);
    }
  }
  return offsets;
}

const POSITION_LABELS = ['FB', 'FF', 'HB', 'HF', 'C', 'Fol'];
const POSITION_SET = new Set(POSITION_LABELS);
function isPositionLabel(s: string): boolean {
  const t = (s || '').trim();
  return POSITION_SET.has(t) || /^(FB|FF|HB|HF|C|Fol)$/i.test(t);
}
function normalizePos(s: string): string {
  const t = (s || '').trim();
  const m = t.match(/(FB|FF|HB|HF|C|Fol)/i);
  return m ? m[1] : t;
}

/** Parse "14. Sam Collins" or "14 Sam Collins" -> { number: "14", name: "Sam Collins" }; else { name: text }. */
function parsePlayerEntry(text: string): PlayerEntry {
  const trimmed = text.trim();
  const withNum = trimmed.match(/^(\d{1,2})[.\s]+(.+)$/);
  if (withNum) {
    return { number: withNum[1], name: withNum[2].trim() };
  }
  return { name: trimmed };
}

/** Extract all player entries (name + optional number) from a cell. */
function cellToPlayerEntries(cellHtml: string): PlayerEntry[] {
  const entries: PlayerEntry[] = [];
  const linkRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null = null;
  while ((m = linkRegex.exec(cellHtml)) !== null) {
    const t = htmlToText(m[1]).trim();
    if (t && t.length >= 2 && t.length <= 45 && !isPositionLabel(t)) entries.push(parsePlayerEntry(t));
  }
  if (entries.length === 0) {
    const one = cellToPlayerName(cellHtml).trim();
    if (one) entries.push(parsePlayerEntry(one));
  }
  if (entries.length === 0) {
    const text = htmlToText(cellHtml).trim();
    const parts = text.split(/[,&]|\band\b/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 45 && !isPositionLabel(s));
    for (const p of parts) entries.push(parsePlayerEntry(p));
  }
  return entries;
}

/** Legacy: names only (for interchange/emergencies). */
function cellToPlayerNames(cellHtml: string): string[] {
  return cellToPlayerEntries(cellHtml).map((e) => e.name);
}

/** Collect up to max player entries from cells. */
function entriesFromCells(cells: string[], max: number): PlayerEntry[] {
  const out: PlayerEntry[] = [];
  for (const cell of cells) {
    if (out.length >= max) break;
    const entries = cellToPlayerEntries(cell);
    for (const e of entries) {
      if (out.length >= max) break;
      if (e.name?.trim()) out.push({ name: e.name.trim(), number: e.number });
    }
  }
  return out.slice(0, max);
}

/** Extract top-level tables plus tables nested one level deep (FootyWire puts lineup table inside a TD). */
function extractTopLevelAndNestedTables(html: string): string[] {
  const out: string[] = [];
  const top = extractTopLevelTables(html);
  for (const t of top) {
    out.push(t);
    const nested = extractTopLevelTables(t);
    for (const n of nested) out.push(n);
  }
  return out;
}

/** FootyWire layout: 4 cells per row [pos, p1, p2, p3], rows alternate home then away. Pair consecutive rows. */
function parsePositionTableAlternatingRows(html: string): PositionRow[] {
  const positions: PositionRow[] = [];
  const tables = extractTopLevelAndNestedTables(html);
  for (const table of tables) {
    const rows = getTableRows(table);
    let i = 0;
    while (i + 1 < rows.length) {
      const rowA = rows[i];
      const rowB = rows[i + 1];
      if (rowA.length < 4 || rowB.length < 4) {
        i++;
        continue;
      }
      const firstA = htmlToText(rowA[0]).trim();
      if (!isPositionLabel(firstA)) {
        i++;
        continue;
      }
      const posA = normalizePos(firstA);
      const home3 = entriesFromCells(rowA.slice(1, 4), MAX_PLAYERS_PER_POSITION);
      const away3 = entriesFromCells(rowB.slice(1, 4), MAX_PLAYERS_PER_POSITION);
      if (home3.length > 0 || away3.length > 0) {
        positions.push({ position: posA, home_players: home3, away_players: away3 });
      }
      i += 2;
    }
    if (positions.length >= 6) return positions;
  }
  return positions;
}

/** Parse main lineup table: position rows with home/away player columns.
 * FootyWire can use: 4 cells [pos, p1, p2, p3] with alternating home/away rows; 3 cells [pos, homeCell, awayCell]; 7 cells; etc. */
function parsePositionTable(html: string): PositionRow[] {
  const alternating = parsePositionTableAlternatingRows(html);
  if (alternating.length >= 6) return alternating;

  const positions: PositionRow[] = [];
  const tables = extractTopLevelTables(html);
  const seen = new Set<string>();
  for (const table of tables) {
    const rows = getTableRows(table);
    let pendingPos: string | null = null;
    let pendingHome: PlayerEntry[] = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const texts = row.map((c) => htmlToText(c).trim());
      const first = texts[0] || '';
      const isPosRow = isPositionLabel(first);
      const homePos: string | null = isPosRow ? normalizePos(first) : pendingPos;

      // 7+ cells: [pos, h1, h2, h3, a1, a2, a3] – one player per cell
      if (row.length >= 7 && homePos && isPosRow) {
        const homePl = entriesFromCells(row.slice(1, 4), MAX_PLAYERS_PER_POSITION);
        const awayPl = entriesFromCells(row.slice(4, 7), MAX_PLAYERS_PER_POSITION);
        if ((homePl.length > 0 || awayPl.length > 0) && !seen.has(homePos)) {
          seen.add(homePos);
          positions.push({ position: homePos, home_players: homePl, away_players: awayPl });
        }
        pendingPos = null;
        pendingHome = [];
        continue;
      }

      // 6 player cells in one row
      if (row.length >= 6 && homePos && isPosRow) {
        const homePl = entriesFromCells(row.slice(1, 4), MAX_PLAYERS_PER_POSITION);
        const awayPl = entriesFromCells(row.slice(4, 7), MAX_PLAYERS_PER_POSITION);
        if ((homePl.length > 0 || awayPl.length > 0) && !seen.has(homePos)) {
          seen.add(homePos);
          positions.push({ position: homePos, home_players: homePl, away_players: awayPl });
        }
        pendingPos = null;
        pendingHome = [];
        continue;
      }

      // 4 cells: [pos, p1, p2, p3] – one team only; next row is the other team (alternating layout handled above)
      if (row.length >= 4 && homePos && isPosRow) {
        const three = entriesFromCells(row.slice(1, 4), MAX_PLAYERS_PER_POSITION);
        if (three.length > 0 && r + 1 < rows.length) {
          const nextRow = rows[r + 1];
          if (nextRow.length >= 4 && isPositionLabel(htmlToText(nextRow[0]).trim())) {
            const away3 = entriesFromCells(nextRow.slice(1, 4), MAX_PLAYERS_PER_POSITION);
            if (!seen.has(homePos)) {
              seen.add(homePos);
              positions.push({ position: homePos, home_players: three, away_players: away3 });
            }
            r++;
            continue;
          }
        }
      }

      // 3 cells: [position, homePlayersCell, awayPlayersCell] – each cell can have 1 or more names
      // If only 1 per cell, FootyWire may use 3 rows per position – merge following rows until we have 3 each
      if (row.length >= 3) {
        const homeFromCell = entriesFromCells([row[1]], MAX_PLAYERS_PER_POSITION);
        const awayFromCell = entriesFromCells([row[2]], MAX_PLAYERS_PER_POSITION);
        if (homeFromCell.length > 0 || awayFromCell.length > 0) {
          if (isPosRow && homePos && !seen.has(homePos)) {
            const homeAcc = [...homeFromCell];
            const awayAcc = [...awayFromCell];
            let lastMerged = r;
            if (homeAcc.length < MAX_PLAYERS_PER_POSITION || awayAcc.length < MAX_PLAYERS_PER_POSITION) {
              for (let nr = r + 1; nr < rows.length && (homeAcc.length < MAX_PLAYERS_PER_POSITION || awayAcc.length < MAX_PLAYERS_PER_POSITION); nr++) {
                const nextRow = rows[nr];
                const nextFirst = htmlToText(nextRow[0]).trim();
                if (nextRow.length >= 3 && isPositionLabel(nextFirst)) break;
                if (nextRow.length >= 3) {
                  const h = entriesFromCells([nextRow[1]], 1);
                  const a = entriesFromCells([nextRow[2]], 1);
                  if (h.length) homeAcc.push(h[0]);
                  if (a.length) awayAcc.push(a[0]);
                  lastMerged = nr;
                } else if (nextRow.length >= 2) {
                  const h = entriesFromCells([nextRow[0]], 1);
                  const a = entriesFromCells([nextRow[1]], 1);
                  if (h.length) homeAcc.push(h[0]);
                  if (a.length) awayAcc.push(a[0]);
                  lastMerged = nr;
                }
              }
            }
            const homePl = homeAcc.slice(0, MAX_PLAYERS_PER_POSITION);
            const awayPl = awayAcc.slice(0, MAX_PLAYERS_PER_POSITION);
            seen.add(homePos);
            positions.push({ position: homePos, home_players: homePl, away_players: awayPl });
            pendingPos = null;
            pendingHome = [];
            if (lastMerged > r) r = lastMerged;
          } else if (!isPosRow && pendingPos && (awayFromCell.length > 0 || homeFromCell.length > 0) && pendingHome.length > 0) {
            const awayPl = awayFromCell.length > 0 ? awayFromCell : entriesFromCells(row.slice(0, 3), MAX_PLAYERS_PER_POSITION);
            if (!seen.has(pendingPos)) {
              seen.add(pendingPos);
              positions.push({
                position: pendingPos,
                home_players: pendingHome.slice(0, MAX_PLAYERS_PER_POSITION),
                away_players: awayPl,
              });
            }
            pendingPos = null;
            pendingHome = [];
          }
          continue;
        }
      }

      // 4 cells: [pos, h1, h2, h3] – home only; next row is away
      if (row.length >= 4 && isPosRow && homePos) {
        const homePl = entriesFromCells(row.slice(1, 4), MAX_PLAYERS_PER_POSITION);
        if (homePl.length > 0) {
          pendingPos = homePos;
          pendingHome = homePl;
        }
        continue;
      }

      // Next row after pending: 3 cells = away players
      if (!isPosRow && pendingPos && pendingHome.length > 0 && row.length >= 3) {
        const awayPl = entriesFromCells(row.slice(0, 3), MAX_PLAYERS_PER_POSITION);
        if (awayPl.length > 0 && !seen.has(pendingPos)) {
          seen.add(pendingPos);
          positions.push({
            position: pendingPos,
            home_players: pendingHome.slice(0, MAX_PLAYERS_PER_POSITION),
            away_players: awayPl,
          });
        }
        pendingPos = null;
        pendingHome = [];
        continue;
      }

      const cells = row.map((c) => cellToPlayerName(c).trim());
      const playerCells = cells.filter((s) => s && s.length < 50 && !isPositionLabel(s));
      const toEntries = (names: string[]): PlayerEntry[] => names.map((n) => ({ name: n }));
      if (playerCells.length >= 2) {
        if (cells.length >= 8 && isPositionLabel(texts[4] ?? '')) {
          const awayPos = normalizePos(texts[4] ?? '');
          const homePl = toEntries(playerCells.slice(0, MAX_PLAYERS_PER_POSITION));
          const awayPl = toEntries(playerCells.slice(MAX_PLAYERS_PER_POSITION, MAX_PLAYERS_PER_POSITION * 2));
          if (homePos && !seen.has(`${homePos}-${awayPos}`)) {
            seen.add(`${homePos}-${awayPos}`);
            positions.push({ position: homePos, home_players: homePl, away_players: awayPl });
          }
          pendingPos = null;
          pendingHome = [];
        } else if (playerCells.length >= 6) {
          const mid = 3;
          const homePl = toEntries(playerCells.slice(0, mid));
          const awayPl = toEntries(playerCells.slice(mid, mid + MAX_PLAYERS_PER_POSITION));
          if (homePos && !seen.has(homePos)) {
            seen.add(homePos);
            positions.push({ position: homePos, home_players: homePl, away_players: awayPl });
          }
          pendingPos = null;
          pendingHome = [];
        } else if (isPosRow && homePos && playerCells.length >= 1 && playerCells.length <= 3) {
          pendingPos = homePos;
          pendingHome = toEntries(playerCells.slice(0, MAX_PLAYERS_PER_POSITION));
        }
      }
    }
    if (positions.length >= 4) break;
  }
  return positions;
}

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

/** Nav/section labels we must not treat as player names. */
const SIDEBAR_LIKE = /^(AFL\s+)?(Statistics\s+Home|Fixture|Players|Teams|Player\s+Rankings|Team\s+Rankings|Rising\s+Stars|Draft|Brownlow|All-Australian|Ladder|Coaches|Attendances|Supercoach|Fantasy|Highlights|Team\s+Selections|Past\s+Players|Contracts|Injury\s+List|Records|Printable|PDF|My\s+)/i;

/** Extract player names from HTML: <a> with href containing footy, player, or pp- (player page), text looks like a name (not nav). */
function extractPlayerNamesFromHtml(html: string): string[] {
  const names: string[] = [];
  const linkRegex = /<a\s+[^>]*href=["']?[^"']*(?:footy|player|pp-)[^"']*["']?[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null = null;
  while ((m = linkRegex.exec(html)) !== null) {
    const name = htmlToText(m[1]).trim();
    if (!name || name.length < 2 || name.length > 45) continue;
    if (/^(FB|FF|HB|HF|C|Fol|Interchange|Emergency|Emergencies|Ins|Outs|Player|Name|Print|PDF|View|More)$/i.test(name)) continue;
    if (SIDEBAR_LIKE.test(name)) continue;
    if (!/[A-Za-z]{2,}/.test(name)) continue;
    names.push(name);
  }
  return names;
}

/** Extract every <a> text that looks like a player name (no href filter). Use when strict extract misses players. */
function extractAllPlayerLinksInOrder(html: string): string[] {
  const names: string[] = [];
  const linkRegex = /<a\s+[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null = null;
  while ((m = linkRegex.exec(html)) !== null) {
    const name = htmlToText(m[1]).trim();
    if (!name || name.length < 2 || name.length > 45) continue;
    if (/^(FB|FF|HB|HF|C|Fol|Interchange|Emergency|Emergencies|Ins|Outs|Player|Name|Print|PDF|View|More)$/i.test(name)) continue;
    if (SIDEBAR_LIKE.test(name)) continue;
    if (!/[A-Za-z]{2,}/.test(name)) continue;
    if (/^\d+$/.test(name)) continue;
    names.push(name);
  }
  return names;
}

/** Parse interchange/emergencies by table columns: column 0 = home, column 1 = away (not "split list in half"). */
function parseInterchangeEmergencies(html: string): {
  interchange: { home: string[]; away: string[] };
  emergencies: { home: string[]; away: string[] };
} {
  const interchange = { home: [] as string[], away: [] as string[] };
  const emergencies = { home: [] as string[], away: [] as string[] };
  const lower = html.toLowerCase();
  const interIdx = lower.indexOf('interchange');
  const emergIdx = lower.indexOf('emergenc');
  const sliceInter = interIdx >= 0 ? html.slice(interIdx, interIdx + 2500) : '';
  const sliceEmerg = emergIdx >= 0 ? html.slice(emergIdx, emergIdx + 1500) : '';

  function parseTwoColumnTable(slice: string): { home: string[]; away: string[] } {
    const home: string[] = [];
    const away: string[] = [];
    const tables = extractTopLevelTables('<div>' + slice + '</div>');
    for (const table of tables) {
      const rows = getTableRows(table);
      for (const row of rows) {
        if (row.length >= 2) {
          const homeNames = cellToPlayerNames(row[0]);
          const awayNames = cellToPlayerNames(row[1]);
          home.push(...homeNames);
          away.push(...awayNames);
        }
      }
      if (home.length > 0 || away.length > 0) break;
    }
    if (home.length === 0 && away.length === 0) {
      const topTables = extractTopLevelTables('<div>' + slice + '</div>');
      for (const outer of topTables) {
        const outerRows = getTableRows(outer);
        for (const row of outerRows) {
          if (row.length >= 3 && (row[0].toLowerCase().includes('interchange') || row[1].toLowerCase().includes('interchange'))) {
            home.push(...extractAllPlayerLinksInOrder(row[0]));
            away.push(...extractAllPlayerLinksInOrder(row[2]));
            break;
          }
        }
        if (home.length > 0 || away.length > 0) break;
      }
    }
    if (home.length === 0 && away.length === 0) {
      const names = extractPlayerNamesFromHtml(slice);
      if (names.length === 0) names.push(...extractAllPlayerLinksInOrder(slice));
      const mid = Math.ceil(names.length / 2);
      return { home: names.slice(0, mid), away: names.slice(mid) };
    }
    return { home: [...new Set(home)], away: [...new Set(away)] };
  }

  if (sliceInter) {
    const beforeEmerg = sliceInter.split(/emergenc/i)[0] || '';
    let parsed = parseTwoColumnTable(beforeEmerg);
    if (parsed.home.length + parsed.away.length < 6) {
      const tables = extractTopLevelTables('<div>' + html + '</div>');
      for (const tbl of tables) {
        const rows = getTableRows(tbl);
        for (const row of rows) {
          if (row.length >= 3 && row[0].toLowerCase().includes('interchange') && row[2].toLowerCase().includes('interchange')) {
            const leftHtml = row[0].split(/emergenc/i)[0] || row[0];
            const rightHtml = row[2].split(/emergenc/i)[0] || row[2];
            interchange.home = [...new Set(extractAllPlayerLinksInOrder(leftHtml))];
            interchange.away = [...new Set(extractAllPlayerLinksInOrder(rightHtml))];
            parsed = { home: interchange.home, away: interchange.away };
            break;
          }
        }
        if (interchange.home.length + interchange.away.length >= 6) break;
      }
    }
    if (parsed.home.length + parsed.away.length < 6) {
      const allTables = extractTopLevelAndNestedTables(html);
      const interTables: string[] = [];
      for (const tbl of allTables) {
        const lower = tbl.toLowerCase();
        if (lower.includes('interchange') && !lower.includes('average attribute')) {
          const links = extractAllPlayerLinksInOrder(tbl);
          if (links.length >= 3 && links.length <= 10) interTables.push(tbl);
        }
      }
      if (interTables.length >= 2) {
        const homeLinks = extractAllPlayerLinksInOrder(interTables[0].split(/emergenc/i)[0] || interTables[0]);
        const awayLinks = extractAllPlayerLinksInOrder(interTables[1].split(/emergenc/i)[0] || interTables[1]);
        if (homeLinks.length > 0 || awayLinks.length > 0) {
          parsed = { home: homeLinks, away: awayLinks };
        }
        const afterEmerg0 = interTables[0].split(/emergenc/i).slice(1).join('emergenc') || '';
        const afterEmerg1 = interTables[1].split(/emergenc/i).slice(1).join('emergenc') || '';
        if (emergencies.home.length === 0 && emergencies.away.length === 0) {
          emergencies.home = [...new Set(extractAllPlayerLinksInOrder(afterEmerg0))];
          emergencies.away = [...new Set(extractAllPlayerLinksInOrder(afterEmerg1))];
        }
      }
    }
    if (parsed.home.length > 0 || parsed.away.length > 0) {
      interchange.home = parsed.home;
      interchange.away = parsed.away;
    }
  }
  if (sliceEmerg && emergencies.home.length === 0 && emergencies.away.length === 0) {
    let parsedEmerg = parseTwoColumnTable(sliceEmerg);
    if (parsedEmerg.home.length + parsedEmerg.away.length < 3) {
      const tables = extractTopLevelTables('<div>' + html + '</div>');
      for (const tbl of tables) {
        const rows = getTableRows(tbl);
        for (const row of rows) {
          if (row.length >= 3 && row[0].toLowerCase().includes('emergenc') && row[2].toLowerCase().includes('emergenc')) {
            const leftHtml = (row[0].split(/interchange/i)[1] ?? row[0]).split(/<\/table/i)[0] ?? row[0];
            const rightHtml = (row[2].split(/interchange/i)[1] ?? row[2]).split(/<\/table/i)[0] ?? row[2];
            emergencies.home = [...new Set(extractAllPlayerLinksInOrder(leftHtml))];
            emergencies.away = [...new Set(extractAllPlayerLinksInOrder(rightHtml))];
            parsedEmerg = { home: emergencies.home, away: emergencies.away };
            break;
          }
        }
        if (emergencies.home.length + emergencies.away.length >= 2) break;
      }
    }
    if (parsedEmerg.home.length + parsedEmerg.away.length < 3) {
      const allTables = extractTopLevelAndNestedTables(html);
      const emergTables: string[] = [];
      for (const tbl of allTables) {
        const lower = tbl.toLowerCase();
        if (lower.includes('emergenc') && !lower.includes('average attribute')) {
          const afterInterchange = tbl.split(/interchange/i)[1] ?? tbl;
          const links = extractAllPlayerLinksInOrder(afterInterchange.split(/<\/table/i)[0] ?? afterInterchange);
          if (links.length >= 1 && links.length <= 5) emergTables.push(afterInterchange.split(/<\/table/i)[0] ?? afterInterchange);
        }
      }
      if (emergTables.length >= 2) {
        parsedEmerg = {
          home: [...new Set(extractAllPlayerLinksInOrder(emergTables[0]))],
          away: [...new Set(extractAllPlayerLinksInOrder(emergTables[1]))],
        };
      }
    }
    if (parsedEmerg.home.length > 0 || parsedEmerg.away.length > 0) {
      emergencies.home = parsedEmerg.home;
      emergencies.away = parsedEmerg.away;
    }
  }
  return { interchange, emergencies };
}

/** Parse "Average Attributes (Extended Interchange)" table. */
function parseAverageAttributes(html: string): TeamSelectionsResponse['average_attributes'] {
  const idx = html.toLowerCase().indexOf('average attribute');
  if (idx < 0) return null;
  const slice = html.slice(idx, idx + 2000);
  const tables = extractTopLevelTables('<div>' + slice + '</div>');
  for (const table of tables) {
    const rows = getTableRows(table);
    const home: { height?: string; age?: string; games?: string } = {};
    const away: { height?: string; age?: string; games?: string } = {};
    for (let i = 0; i < rows.length; i++) {
      const texts = rows[i].map((c) => htmlToText(c).trim());
      if (texts.length < 3) continue;
      const label = (texts[0] ?? '').toLowerCase();
      if (label.includes('height')) {
        home.height = texts[1] ?? '';
        away.height = texts[2] ?? '';
      } else if (label.includes('age')) {
        home.age = texts[1] ?? '';
        away.age = texts[2] ?? '';
      } else if (label.includes('games')) {
        home.games = texts[1] ?? '';
        away.games = texts[2] ?? '';
      }
    }
    if (home.height ?? home.age ?? home.games ?? away.height ?? away.age ?? away.games) {
      return { home, away };
    }
  }
  return null;
}

/** Parse "Total Players By Games" table. */
function parseTotalPlayersByGames(html: string): TeamSelectionsResponse['total_players_by_games'] {
  const idx = html.toLowerCase().indexOf('total players by games');
  if (idx < 0) return null;
  const slice = html.slice(idx, idx + 1500);
  const tables = extractTopLevelTables('<div>' + slice + '</div>');
  const out: Array<{ category: string; home: string; away: string }> = [];
  for (const table of tables) {
    const rows = getTableRows(table);
    const header = rows[0]?.map((c) => htmlToText(c).trim()) ?? [];
    const homeCol = header.findIndex((h) => /sydney|collingwood|team|home/i.test(h)) >= 0 ? header.findIndex((h) => /sydney|collingwood|team|home/i.test(h)) : 1;
    const awayCol = homeCol === 1 ? 2 : 1;
    for (let i = 1; i < rows.length; i++) {
      const texts = rows[i].map((c) => htmlToText(c).trim());
      if (texts.length >= 3 && (texts[0]?.match(/\d+/) || /less|than|to|more/i.test(texts[0] ?? ''))) {
        out.push({
          category: texts[0] ?? '',
          home: texts[homeCol] ?? '',
          away: texts[awayCol] ?? '',
        });
      }
    }
    if (out.length > 0) return out;
  }
  return null;
}

/** Strip left sidebar nav so we only parse the main lineup content (match + tables). */
function extractMainContent(html: string): string {
  // Position labels include C (Centre); use word boundary so "C" doesn't match every letter C.
  const hasPosRe = /\b(?:FB|FF|HB|HF|C|Fol)\b/i;
  const hasPlayerLinkRe = /<a\s[^>]*href=["']?[^"']*(?:footy|pp-)[^"']*["']?[^>]*>[\s\S]{2,50}<\/a>/i;

  // Strategy 1: Use top-level tables so we don't match a tiny nested table; find lineup table.
  const tables = extractTopLevelTables(html);
  for (let i = 0; i < tables.length; i++) {
    const tableHtml = tables[i];
    if (hasPosRe.test(tableHtml) && hasPlayerLinkRe.test(tableHtml)) {
      return html;
    }
  }

  // Strategy 2: Find "Interchange" and take content from well before it.
  const interIdx = html.toLowerCase().indexOf('interchange');
  if (interIdx > 500) {
    return html.slice(Math.max(0, interIdx - 6000));
  }
  // Strategy 3: Skip to first "2026 Round 0" or " v " (match line).
  const roundMatch = html.match(/\d{4}\s*Round\s*\d+/i);
  const roundIdx = roundMatch ? html.indexOf(roundMatch[0]) : -1;
  const normalised = html.replace(/&nbsp;/gi, ' ');
  const vIdx = normalised.search(/\s+v\s+[A-Za-z]/);
  const start = roundIdx >= 0 ? Math.max(0, roundIdx - 1000) : vIdx >= 0 ? Math.max(0, vIdx - 800) : 0;
  return start > 0 ? html.slice(start) : html;
}

/** Parse a single match segment (from one "Team v Team" header to the next). */
function parseOneMatch(segmentHtml: string): TeamSelectionsResponse {
  const mainHtml = segmentHtml.length > 6000 ? extractMainContent(segmentHtml) : segmentHtml;
  const { match, home_team, away_team } = parseMatch(segmentHtml);
  let positions = parsePositionTable(mainHtml);
  if (positions.length === 0) {
    positions = parsePositionsFromPlayerLinks(mainHtml);
  }
  if (positions.length === 0) {
    positions = parsePositionTable(segmentHtml);
    if (positions.length === 0) positions = parsePositionsFromPlayerLinks(segmentHtml);
  }
  const totalFromTable = positions.reduce((s, row) => s + (row.home_players?.length ?? 0) + (row.away_players?.length ?? 0), 0);
  if (positions.length >= 6 && totalFromTable < 24) {
    const fromLinks = parsePositionsFromPlayerLinks(mainHtml);
    if (fromLinks.length >= 6) {
      const totalFromLinks = fromLinks.reduce((s, row) => s + (row.home_players?.length ?? 0) + (row.away_players?.length ?? 0), 0);
      if (totalFromLinks > totalFromTable) positions = fromLinks;
    }
    if (positions.reduce((s, row) => s + (row.home_players?.length ?? 0) + (row.away_players?.length ?? 0), 0) < 24) {
      const fromLinksSeg = parsePositionsFromPlayerLinks(segmentHtml);
      if (fromLinksSeg.length >= 6) {
        const totalSeg = fromLinksSeg.reduce((s, row) => s + (row.home_players?.length ?? 0) + (row.away_players?.length ?? 0), 0);
        if (totalSeg > totalFromTable) positions = fromLinksSeg;
      }
    }
  }
  const { interchange, emergencies } = parseInterchangeEmergencies(mainHtml);
  if (interchange.home.length === 0 && interchange.away.length === 0) {
    const fallback = parseInterchangeEmergencies(segmentHtml);
    interchange.home = fallback.interchange.home;
    interchange.away = fallback.interchange.away;
  }
  const average_attributes = parseAverageAttributes(mainHtml);
  const total_players_by_games = parseTotalPlayersByGames(mainHtml);

  return {
    url: FOOTYWIRE_TEAM_SELECTIONS_URL,
    title: null,
    round_label: null,
    match,
    home_team,
    away_team,
    positions,
    interchange,
    emergencies,
    average_attributes,
    total_players_by_games,
  };
}

/** Parse full page into all round matches (one lineup per game). */
function parseFullPage(html: string): TeamSelectionsRoundResponse {
  const { title, round_label } = parseTitle(html);
  const offsets = findMatchOffsets(html);
  const matches: TeamSelectionsResponse[] = [];

  if (offsets.length === 0) {
    const single = parseOneMatch(html);
    if (single.match || single.positions.length > 0) enrichWith2026Numbers(single);
    return {
      url: FOOTYWIRE_TEAM_SELECTIONS_URL,
      title,
      round_label,
      matches: single.match ? [single] : [],
    };
  }

  for (let i = 0; i < offsets.length; i++) {
    const start = offsets[i];
    const end = i + 1 < offsets.length ? offsets[i + 1] : html.length;
    const segment = html.slice(start, end);
    const one = parseOneMatch(segment);
    if (one.match || one.positions.length > 0 || one.interchange.home.length > 0 || one.interchange.away.length > 0) {
      one.round_label = round_label;
      one.title = title;
      enrichWith2026Numbers(one);
      matches.push(one);
    }
  }

  return {
    url: FOOTYWIRE_TEAM_SELECTIONS_URL,
    title,
    round_label,
    matches,
  };
}

/** Single-match parse (legacy): first match only. */
function parsePage(html: string): TeamSelectionsResponse {
  const round = parseFullPage(html);
  const first = round.matches[0];
  if (first) {
    return { ...first, title: round.title, round_label: round.round_label };
  }
  const { title, round_label } = parseTitle(html);
  return {
    url: FOOTYWIRE_TEAM_SELECTIONS_URL,
    title,
    round_label,
    match: null,
    home_team: null,
    away_team: null,
    positions: [],
    interchange: { home: [], away: [] },
    emergencies: { home: [], away: [] },
    average_attributes: null,
    total_players_by_games: null,
  };
}

/** Canonical team key for lineup match (one of LEAGUE_TEAM_KEYS). Avoids "Greater Western Sydney" matching "Sydney". */
function getCanonicalTeamKeyForMatch(team: string | null): string | null {
  return matchTeamToLeagueKey(team);
}

/** True if the match (home/away) involves the given team (e.g. player's team). Uses canonical keys so GWS ≠ Sydney. */
function matchIncludesTeam(m: TeamSelectionsResponse, team: string): boolean {
  if (!team || !m.home_team || !m.away_team) return false;
  const teamKey = getCanonicalTeamKeyForMatch(team);
  const homeKey = getCanonicalTeamKeyForMatch(m.home_team);
  const awayKey = getCanonicalTeamKeyForMatch(m.away_team);
  if (!teamKey || !homeKey || !awayKey) return false;
  return teamKey === homeKey || teamKey === awayKey;
}

export async function GET(request: Request) {
  const url = request.url ? new URL(request.url) : null;
  const skipCache = url?.searchParams.get('refresh') === '1' || url?.searchParams.get('refresh') === 'true';
  const teamParam = url?.searchParams.get('team')?.trim() || null;

  if (!skipCache && cached && cached.expiresAt > Date.now()) {
    const data = cached.data;
    if (teamParam && data.matches?.length) {
      const found = data.matches.find((m) => matchIncludesTeam(m, teamParam));
      if (found) {
        return NextResponse.json({
          ...data,
          match: found.match,
          home_team: found.home_team,
          away_team: found.away_team,
          positions: found.positions,
          interchange: found.interchange,
          emergencies: found.emergencies,
          average_attributes: found.average_attributes,
          total_players_by_games: found.total_players_by_games,
          source: 'footywire.com',
        });
      }
    }
    return NextResponse.json({ ...data, source: 'footywire.com' });
  }

  try {
    const res = await fetch(FOOTYWIRE_TEAM_SELECTIONS_URL, {
      headers: FETCH_HEADERS,
      next: { revalidate: 60 * 30 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `FootyWire returned ${res.status}`, url: FOOTYWIRE_TEAM_SELECTIONS_URL },
        { status: 502 }
      );
    }
    const html = await res.text();
    const roundData = parseFullPage(html);
    const hasAnyLineup = roundData.matches.some(
      (m) => m.positions.length > 0 || m.interchange.home.length > 0 || m.interchange.away.length > 0
    );
    if (hasAnyLineup) {
      cached = { expiresAt: Date.now() + TTL_MS, data: roundData };
    }

    if (teamParam && roundData.matches.length > 0) {
      const found = roundData.matches.find((m) => matchIncludesTeam(m, teamParam));
      if (found) {
        return NextResponse.json({
          ...roundData,
          match: found.match,
          home_team: found.home_team,
          away_team: found.away_team,
          positions: found.positions,
          interchange: found.interchange,
          emergencies: found.emergencies,
          average_attributes: found.average_attributes,
          total_players_by_games: found.total_players_by_games,
          source: 'footywire.com',
        });
      }
    }

    return NextResponse.json({ ...roundData, source: 'footywire.com' });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Failed to fetch FootyWire team selections',
        url: FOOTYWIRE_TEAM_SELECTIONS_URL,
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
