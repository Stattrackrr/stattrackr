export type TennisPaintBookmakerLine = {
  bookmaker: string;
  line: number;
  overOdds: string;
  underOdds: string;
};

type TennisPaintRow = {
  playerName?: string | null;
  playerId?: string | null;
  gameId?: string | null;
  statType?: string | null;
  line?: number | null;
  opponent?: string | null;
  team?: string | null;
  playerTeam?: string | null;
  homeTeamCode?: string | null;
  bookmaker?: string | null;
  overOdds?: string | null;
  underOdds?: string | null;
  gameDate?: string | null;
  commenceTime?: string | null;
  bookmakerLines?: Array<{
    bookmaker?: string | null;
    line?: number | null;
    overOdds?: string | null;
    underOdds?: string | null;
  }> | null;
};

function tennisPaintTipoff(value?: string | null): string {
  const raw = String(value || '').trim();
  if (!raw || raw === 'N/A') return '';
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return '';
  const date = new Date(parsed);
  const dateOnly =
    !raw.includes('T') && date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0;
  return dateOnly ? '' : raw;
}

export function tennisPaintRowKey(row: {
  playerName?: string | null;
  gameId?: string | null;
  statType?: string | null;
  line?: number | null;
}): string {
  return `${row.playerName || ''}|${row.gameId || ''}|${row.statType || ''}|${row.line ?? ''}`;
}

function normalizeBookmakerLine(
  line: {
    bookmaker?: string | null;
    line?: number | null;
    overOdds?: string | null;
    underOdds?: string | null;
  },
  fallback: { bookmaker?: string | null; line?: number | null; overOdds?: string | null; underOdds?: string | null }
): TennisPaintBookmakerLine | null {
  const bookmaker = String(line.bookmaker || fallback.bookmaker || '').trim();
  const n = Number(line.line ?? fallback.line);
  if (!bookmaker && !Number.isFinite(n)) return null;
  return {
    bookmaker,
    line: Number.isFinite(n) ? n : Number(fallback.line) || 0,
    overOdds: String(line.overOdds || fallback.overOdds || 'N/A'),
    underOdds: String(line.underOdds || fallback.underOdds || 'N/A'),
  };
}

export function bookmakerLinesFromTennisRow(row: TennisPaintRow): TennisPaintBookmakerLine[] {
  const fallback = {
    bookmaker: row.bookmaker,
    line: row.line,
    overOdds: row.overOdds,
    underOdds: row.underOdds,
  };
  if (Array.isArray(row.bookmakerLines) && row.bookmakerLines.length > 0) {
    return row.bookmakerLines
      .map((line) => normalizeBookmakerLine(line, fallback))
      .filter((line): line is TennisPaintBookmakerLine => Boolean(line));
  }
  const single = normalizeBookmakerLine(fallback, fallback);
  return single && (single.bookmaker || (single.overOdds && single.overOdds !== 'N/A')) ? [single] : [];
}

function mergeBookmakerLines(
  current: TennisPaintBookmakerLine[],
  incoming: TennisPaintBookmakerLine[]
): TennisPaintBookmakerLine[] {
  const out = [...current];
  for (const line of incoming) {
    const duplicate = out.some((row) => row.bookmaker === line.bookmaker && row.line === line.line);
    if (!duplicate) out.push(line);
  }
  return out;
}

/**
 * Tennis list cache is one row per bookmaker. The props page paints one row per
 * market with `bookmakerLines`. Always run this before attach/hydrate so a raw
 * list slice cannot render as American Over/Under with a missing tipoff.
 */
export function aggregateTennisPropsForPaint<T extends TennisPaintRow>(rows: T[]): T[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const grouped = new Map<string, T & { bookmakerLines: TennisPaintBookmakerLine[] }>();
  for (const row of rows) {
    const key = tennisPaintRowKey(row);
    const incoming = bookmakerLinesFromTennisRow(row);
    const tipoff =
      tennisPaintTipoff(String(row.gameDate || '')) || tennisPaintTipoff(String(row.commenceTime || ''));
    const team = String(row.team || row.playerTeam || row.homeTeamCode || '').trim();
    const opponent = String(row.opponent || '').trim();
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...row,
        team: team || row.team,
        opponent: opponent || row.opponent,
        playerId: row.playerId != null ? String(row.playerId) : row.playerId,
        gameDate: tipoff || row.gameDate || row.commenceTime || '',
        bookmakerLines: incoming,
        bookmaker: incoming[0]?.bookmaker || row.bookmaker || '',
        overOdds: incoming[0]?.overOdds || row.overOdds || 'N/A',
        underOdds: incoming[0]?.underOdds || row.underOdds || 'N/A',
        line: incoming[0]?.line ?? row.line ?? 0,
      } as T & { bookmakerLines: TennisPaintBookmakerLine[] });
      continue;
    }
    existing.bookmakerLines = mergeBookmakerLines(existing.bookmakerLines, incoming);
    const existingTip = tennisPaintTipoff(String(existing.gameDate || ''));
    if (!existingTip && tipoff) existing.gameDate = tipoff;
    if (!existing.team && team) existing.team = team;
    if (!existing.opponent && opponent) existing.opponent = opponent;
    if (!existing.bookmaker && incoming[0]?.bookmaker) existing.bookmaker = incoming[0].bookmaker;
  }
  return Array.from(grouped.values());
}

export function tennisPropsNeedPaintAggregation(rows: TennisPaintRow[] | null | undefined): boolean {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.some((row) => {
    const hasLines = Array.isArray(row.bookmakerLines) && row.bookmakerLines.length > 0;
    const hasTipoff = Boolean(tennisPaintTipoff(String(row.gameDate || '')) || tennisPaintTipoff(String(row.commenceTime || '')));
    return !hasLines || !hasTipoff;
  });
}
