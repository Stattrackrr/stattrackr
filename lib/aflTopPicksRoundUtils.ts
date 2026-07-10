/**
 * Client-safe AFL top-picks round helpers (no Node fs).
 * Keep in sync with calendar windows used by snapshot / history scripts.
 */

export type AflTopPicksRoundPickLike = {
  playerName?: string | null;
  recommendedSide?: string | null;
};

export type AflTopPicksRoundRecordLike = {
  roundKey?: string | null;
  picks?: AflTopPicksRoundPickLike[] | null;
};

const AFL_2026_ROUND_WINDOWS: Array<{ key: string; start: string; end: string }> = [
  { key: '2026-R14', start: '2026-06-11', end: '2026-06-15' },
  { key: '2026-R15', start: '2026-06-18', end: '2026-06-22' },
  { key: '2026-R16', start: '2026-06-25', end: '2026-06-29' },
  { key: '2026-R17', start: '2026-07-02', end: '2026-07-06' },
  { key: '2026-R18', start: '2026-07-09', end: '2026-07-13' },
  { key: '2026-R19', start: '2026-07-16', end: '2026-07-20' },
  { key: '2026-R20', start: '2026-07-23', end: '2026-07-27' },
  { key: '2026-R21', start: '2026-07-30', end: '2026-08-03' },
  { key: '2026-R22', start: '2026-08-06', end: '2026-08-10' },
  { key: '2026-R23', start: '2026-08-13', end: '2026-08-17' },
];

function normalizeTopPicksPlayerName(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

export function calendarAflTopPicksRoundKey(commenceTime: string | null | undefined): string | null {
  const date = String(commenceTime || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  for (const window of AFL_2026_ROUND_WINDOWS) {
    if (date >= window.start && date <= window.end) return window.key;
  }
  return null;
}

/** Current AFL premiership round key for a calendar date (YYYY-MM-DD). */
export function calendarAflTopPicksRoundKeyForDate(isoDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  return calendarAflTopPicksRoundKey(`${isoDate}T12:00:00Z`);
}

export function parseAflTopPicksRoundKey(roundKey: string | null | undefined): { season: number; round: number } | null {
  const match = String(roundKey ?? '').trim().match(/^(\d{4})-R(\d{1,2})$/i);
  if (!match) return null;
  const season = Number.parseInt(match[1], 10);
  const round = Number.parseInt(match[2], 10);
  if (!Number.isFinite(season) || !Number.isFinite(round)) return null;
  return { season, round };
}

export function sortAflTopPicksRoundKeys(roundKeys: string[]): string[] {
  return [...roundKeys].sort((a, b) => {
    const ar = parseAflTopPicksRoundKey(a);
    const br = parseAflTopPicksRoundKey(b);
    if (!ar && !br) return a.localeCompare(b);
    if (!ar) return 1;
    if (!br) return -1;
    if (ar.season !== br.season) return ar.season - br.season;
    return ar.round - br.round;
  });
}

export function listAflTopPicksRoundKeysFromRecords(records: AflTopPicksRoundRecordLike[]): string[] {
  return sortAflTopPicksRoundKeys(
    Array.from(
      new Set(records.map((record) => record.roundKey).filter((roundKey): roundKey is string => Boolean(roundKey)))
    )
  );
}

/** `player|OVER` / `player|UNDER` key used to ban same-side Top 3 repeats across consecutive rounds. */
export function aflTopPicksPlayerSideKey(playerName: string, side: string | null | undefined): string | null {
  const playerKey = normalizeTopPicksPlayerName(playerName);
  const sideKey = String(side ?? '')
    .trim()
    .toUpperCase();
  if (!playerKey || (sideKey !== 'OVER' && sideKey !== 'UNDER')) return null;
  return `${playerKey}|${sideKey}`;
}

export function priorAflTopPicksRoundKey(
  currentRoundKey: string | null | undefined,
  historyRoundKeys: string[]
): string | null {
  const current = parseAflTopPicksRoundKey(currentRoundKey);
  if (!current) return null;
  const priorCandidates = sortAflTopPicksRoundKeys(historyRoundKeys).filter((key) => {
    const parsed = parseAflTopPicksRoundKey(key);
    if (!parsed) return false;
    if (parsed.season !== current.season) return parsed.season < current.season;
    return parsed.round < current.round;
  });
  return priorCandidates[priorCandidates.length - 1] ?? null;
}

/**
 * Player+side pairs that were Top 3 in the immediately prior AFL round relative to `currentRoundKey`.
 * Opposite side next round is allowed.
 */
export function getPriorRoundBlockedPlayerSidesFromRecords(
  records: AflTopPicksRoundRecordLike[],
  currentRoundKey: string | null | undefined
): {
  blocked: Set<string>;
  priorRoundKey: string | null;
} {
  const historyRoundKeys = listAflTopPicksRoundKeysFromRecords(records);
  let prior = priorAflTopPicksRoundKey(currentRoundKey, historyRoundKeys);
  if (!prior) {
    if (!currentRoundKey && historyRoundKeys.length > 0) {
      prior = historyRoundKeys[historyRoundKeys.length - 1] ?? null;
    } else {
      return { blocked: new Set(), priorRoundKey: null };
    }
  }
  const blocked = new Set<string>();
  for (const record of records) {
    if (record.roundKey !== prior) continue;
    for (const pick of record.picks ?? []) {
      const key = aflTopPicksPlayerSideKey(String(pick.playerName ?? ''), pick.recommendedSide);
      if (key) blocked.add(key);
    }
  }
  return { blocked, priorRoundKey: prior };
}

/** Infer the dominant calendar round for a projection slate from commence times. */
export function inferCurrentRoundKeyFromCommenceTimes(commenceTimes: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const commenceTime of commenceTimes) {
    const key = calendarAflTopPicksRoundKey(commenceTime);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const ordered = sortAflTopPicksRoundKeys([...counts.keys()]);
  return ordered.reduce((best, key) => {
    const bestCount = counts.get(best) ?? 0;
    const nextCount = counts.get(key) ?? 0;
    if (nextCount > bestCount) return key;
    if (nextCount < bestCount) return best;
    const bestParsed = parseAflTopPicksRoundKey(best);
    const nextParsed = parseAflTopPicksRoundKey(key);
    if (!bestParsed) return key;
    if (!nextParsed) return best;
    if (nextParsed.season !== bestParsed.season) return nextParsed.season > bestParsed.season ? key : best;
    return nextParsed.round > bestParsed.round ? key : best;
  });
}
