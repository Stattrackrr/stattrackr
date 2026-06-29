export type WorldCupPlayerShotMatchStats = {
  total: number;
  onTarget: number;
};

function parsePositiveStat(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** BDL marks on_target inconsistently — infer from shot_type/result. */
export function isWorldCupShotOnTarget(shot: Record<string, unknown>): boolean {
  if (shot.on_target === true) return true;
  const type = String(shot.shot_type ?? '').trim().toLowerCase();
  if (type === 'goal' || type === 'save') return true;
  const result = String(shot.result ?? '').trim().toLowerCase();
  if (result === 'goal' || result.includes('goal')) return true;
  return false;
}

export function buildWorldCupPlayerShotsByMatch(
  playerShots: Array<Record<string, unknown>> | undefined | null,
  playerId?: string | null
): Map<number, number> {
  return buildWorldCupPlayerShotStatsByMatch(playerShots, playerId).totals;
}

export function buildWorldCupPlayerShotStatsByMatch(
  playerShots: Array<Record<string, unknown>> | undefined | null,
  playerId?: string | null
): { totals: Map<number, number>; onTarget: Map<number, number> } {
  const totals = new Map<number, number>();
  const onTarget = new Map<number, number>();
  if (!playerShots?.length) return { totals, onTarget };

  const pid = playerId ? String(playerId) : '';
  for (const shot of playerShots) {
    const matchId = Number(shot.match_id);
    const shotPlayerId = String(shot.player_id ?? '');
    if (!Number.isFinite(matchId)) continue;
    if (pid && shotPlayerId && shotPlayerId !== pid) continue;
    totals.set(matchId, (totals.get(matchId) ?? 0) + 1);
    if (isWorldCupShotOnTarget(shot)) {
      onTarget.set(matchId, (onTarget.get(matchId) ?? 0) + 1);
    }
  }
  return { totals, onTarget };
}

export function statRowMatchIds(row: Record<string, unknown>): number[] {
  const ids = new Set<number>();
  for (const key of ['match_id', 'source_match_id'] as const) {
    const id = Number(row[key]);
    if (Number.isFinite(id)) ids.add(id);
  }
  return [...ids];
}

function resolveShotStatsForRow(
  row: Record<string, unknown>,
  totalsByMatch: Map<number, number>,
  onTargetByMatch: Map<number, number>
): WorldCupPlayerShotMatchStats | null {
  const matchIds = statRowMatchIds(row);
  let total = 0;
  let onTarget = 0;
  for (const matchId of matchIds) {
    total = Math.max(total, totalsByMatch.get(matchId) ?? 0);
    onTarget = Math.max(onTarget, onTargetByMatch.get(matchId) ?? 0);
  }
  if (total <= 0 && onTarget <= 0) return null;
  return { total, onTarget };
}

/** Apply /match_shots onto stat rows — source of truth for total shots and SOT. */
export function applyWorldCupPlayerShotsToStatRows<T extends Record<string, unknown>>(
  rows: T[],
  playerShots: Array<Record<string, unknown>> | undefined | null,
  playerId?: string | null
): T[];
export function applyWorldCupPlayerShotsToStatRows<T extends Record<string, unknown>>(
  rows: T[],
  totalsByMatch: Map<number, number>,
  onTargetByMatch?: Map<number, number>
): T[];
export function applyWorldCupPlayerShotsToStatRows<T extends Record<string, unknown>>(
  rows: T[],
  shotsOrTotals: Array<Record<string, unknown>> | Map<number, number> | undefined | null,
  playerIdOrOnTarget?: string | Map<number, number> | null
): T[] {
  if (!rows.length) return rows;

  let totalsByMatch: Map<number, number>;
  let onTargetByMatch: Map<number, number>;

  if (shotsOrTotals instanceof Map) {
    totalsByMatch = shotsOrTotals;
    onTargetByMatch =
      playerIdOrOnTarget instanceof Map ? playerIdOrOnTarget : new Map<number, number>();
  } else {
    const stats = buildWorldCupPlayerShotStatsByMatch(
      shotsOrTotals,
      typeof playerIdOrOnTarget === 'string' ? playerIdOrOnTarget : null
    );
    totalsByMatch = stats.totals;
    onTargetByMatch = stats.onTarget;
  }

  if (!totalsByMatch.size && !onTargetByMatch.size) return rows;

  return rows.map((row) => {
    const resolved = resolveShotStatsForRow(row, totalsByMatch, onTargetByMatch);
    if (!resolved) return row;
    const out: Record<string, unknown> = { ...row };
    if (resolved.total > 0) {
      out.derived_shots_total = resolved.total;
      out.shots_total = resolved.total;
    }
    out.shots_on_target = resolved.onTarget;
    return out as T;
  });
}

export function readWorldCupPlayerShotCountFromFields(row: Record<string, unknown>): number | null {
  const positive = [row.shots_total, row.shots, row.derived_shots_total, row.total_shots]
    .map(parsePositiveStat)
    .filter((value): value is number => value != null);
  return positive.length ? Math.max(...positive) : null;
}

export function resolveWorldCupPlayerShotsTotalFromRow(row: Record<string, unknown>): number | null {
  return readWorldCupPlayerShotCountFromFields(row);
}

/** WC rows that should use /match_shots (optionally limited to a season's match id set). */
export function worldCupMatchIdsNeedingPlayerShotEvents(
  rows: Array<Record<string, unknown>>,
  seasonMatchIds?: Set<number>
): number[] {
  const ids = new Set<number>();
  for (const row of rows) {
    const minutes = parsePositiveStat(row.minutes_played);
    if (minutes == null) continue;
    const slug = String(row.tournament_slug ?? '').toLowerCase();
    const isWc =
      slug === 'worldcup' ||
      slug === 'world-cup' ||
      slug === 'fifa-world-cup' ||
      String(row.source ?? '').toLowerCase() === 'bdl';
    if (!isWc) continue;
    for (const matchId of statRowMatchIds(row)) {
      if (!Number.isFinite(matchId)) continue;
      if (seasonMatchIds && !seasonMatchIds.has(matchId)) continue;
      ids.add(matchId);
    }
  }
  return [...ids];
}

export function playerDashboardNeedsShotEventRefresh(
  data: { playerMatchStats?: Array<Record<string, unknown>>; playerShots?: Array<Record<string, unknown>> } | null | undefined,
  playerId: string | null
): boolean {
  if (!playerId || !/^\d+$/.test(playerId)) return false;
  if ((data?.playerShots?.length ?? 0) > 0) return false;
  const rows = (data?.playerMatchStats ?? []).filter(
    (row) => String(row.player_id ?? '') === playerId || !row.player_id
  );
  return rows.some((row) => {
    const minutes = parsePositiveStat(row.minutes_played);
    if (minutes == null) return false;
    const slug = String(row.tournament_slug ?? '').toLowerCase();
    const isWc =
      slug === 'worldcup' ||
      slug === 'world-cup' ||
      slug === 'fifa-world-cup' ||
      String(row.source ?? '').toLowerCase() === 'bdl';
    return isWc;
  });
}
