import type { PlayerMatchStats, PlayerStatRow } from '@/lib/soccerPlayerStatsScrape';

/** Soccerway role phrases in player-stats cells (longest first for matching). */
const SOCCERWAY_ROLE_PHRASES = [
  'attacking midfielder',
  'defensive midfielder',
  'centre back',
  'center back',
  'goalkeeper',
  'wingback',
  'fullback',
  'midfielder',
  'forward',
  'striker',
  'winger',
] as const;

const SOCCERWAY_ROLE_TO_CODE: Record<(typeof SOCCERWAY_ROLE_PHRASES)[number], string> = {
  goalkeeper: 'GK',
  'centre back': 'CB',
  'center back': 'CB',
  fullback: 'FB',
  wingback: 'WB',
  'defensive midfielder': 'CDM',
  midfielder: 'CM',
  'attacking midfielder': 'CAM',
  winger: 'W',
  forward: 'ST',
  striker: 'ST',
};

const ROLE_STRIP_RE =
  /\b(goalkeeper|centre back|center back|fullback|wingback|midfielder|attacking midfielder|defensive midfielder|winger|forward|striker)\b/gi;

export type SoccerwayExtractedRole = {
  raw: string;
  code: string;
};

export function extractSoccerwayRoleFromText(value: string | null | undefined): SoccerwayExtractedRole | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const phrase of SOCCERWAY_ROLE_PHRASES) {
    if (!lower.includes(phrase)) continue;
    const code = SOCCERWAY_ROLE_TO_CODE[phrase];
    if (!code) continue;
    return { raw: phrase, code };
  }
  return null;
}

/** Player cell with role suffix removed (e.g. "Guehi M. Centre back" → "Guehi M."). */
export function stripSoccerwayRoleFromPlayerCell(value: string | null | undefined): string {
  return String(value || '')
    .replace(ROLE_STRIP_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function modeString(values: string[]): string | null {
  if (!values.length) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function positionFromStatRow(row: PlayerStatRow | null | undefined): string | null {
  if (!row) return null;
  if (row.position) return row.position;
  const extracted = extractSoccerwayRoleFromText(row.player);
  return extracted?.code ?? null;
}

/** Attach per-match + primary position codes from category rows. */
export function applyPositionsToPlayerMatches(matches: PlayerMatchStats[]): PlayerMatchStats[] {
  return matches.map((match) => {
    const codes: string[] = [];
    const raws: string[] = [];
    for (const row of Object.values(match.categories ?? {})) {
      const code = positionFromStatRow(row);
      if (code) codes.push(code);
      const raw = row?.positionRaw ?? extractSoccerwayRoleFromText(row?.player)?.raw;
      if (raw) raws.push(raw);
    }
    const position = modeString(codes);
    const positionRaw = modeString(raws);
    if (!position && !positionRaw) return match;
    return {
      ...match,
      position: position ?? match.position ?? null,
      positionRaw: positionRaw ?? match.positionRaw ?? null,
    };
  });
}

export function derivePrimaryPositionFromMatches(matches: PlayerMatchStats[]): string | null {
  const codes = matches.map((m) => m.position).filter((p): p is string => Boolean(p));
  return modeString(codes);
}

export type SoccerPlayerStatsWithPosition = {
  matches: PlayerMatchStats[];
  primaryPosition?: string | null;
  primaryPositionRaw?: string | null;
};

export function enrichPlayerStatsWithPositions<T extends SoccerPlayerStatsWithPosition>(payload: T): T {
  const matches = applyPositionsToPlayerMatches(payload.matches ?? []);
  const primaryPosition = derivePrimaryPositionFromMatches(matches);
  const rawCounts = new Map<string, number>();
  for (const m of matches) {
    const raw = m.positionRaw;
    if (!raw) continue;
    rawCounts.set(raw, (rawCounts.get(raw) ?? 0) + 1);
  }
  let primaryPositionRaw: string | null = null;
  let bestRaw = 0;
  for (const [raw, count] of rawCounts) {
    if (count > bestRaw) {
      primaryPositionRaw = raw;
      bestRaw = count;
    }
  }
  return {
    ...payload,
    matches,
    primaryPosition: primaryPosition ?? payload.primaryPosition ?? null,
    primaryPositionRaw: primaryPositionRaw ?? payload.primaryPositionRaw ?? null,
  };
}
