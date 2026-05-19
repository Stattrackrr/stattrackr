/** Stable identity for matching venue enrichment across base vs quarter-enriched rows. */
export function buildAflGameIdentityKey(game: Record<string, unknown>): string {
  const season = Number(game.season);
  const seasonPart = Number.isFinite(season) ? String(season) : '';
  const round = String(game.round ?? '').trim().toUpperCase();
  const opponent = String(game.opponent ?? '').trim().toLowerCase();
  const result = String(game.result ?? '').trim().toLowerCase();
  const date = String(game.date ?? game.game_date ?? '').trim().slice(0, 10);
  return [seasonPart, round, opponent, date, result].join('|');
}

/** Primary dedupe / venue lookup key: season + round + opponent (date can differ by a day across player logs). */
export function buildAflGameDedupeKey(game: Record<string, unknown>): string {
  const datePart = String(game.date ?? game.game_date ?? '').trim().slice(0, 10);
  const opponentPart = String(game.opponent ?? '').trim().toLowerCase();
  const roundPart = String(game.round ?? '').trim().toUpperCase();
  const gameNumberPart = String(game.game_number ?? '').trim();
  const seasonPart = String(game.season ?? '').trim();
  const roundOpponentKey = roundPart && opponentPart ? [seasonPart, roundPart, opponentPart].join('|') : '';
  const dateKey = datePart ? [seasonPart, datePart, opponentPart].join('|') : '';
  const identityKey = buildAflGameIdentityKey(game);
  const fallbackKey = [seasonPart, gameNumberPart, roundPart, opponentPart, datePart].join('|');
  return (
    roundOpponentKey ||
    dateKey ||
    (identityKey !== '||||' ? identityKey : '') ||
    fallbackKey
  );
}

export function scoreAflGameRowQuality(game: Record<string, unknown>): number {
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  let score = 0;
  const tog = num(game.percent_played);
  if (tog != null && tog > 0) score += 100;
  const advancedKeys = [
    'meters_gained',
    'intercepts',
    'contested_possessions',
    'effective_disposals',
    'disposal_efficiency',
    'one_percenters',
    'tackles_inside_50',
  ] as const;
  for (const k of advancedKeys) {
    const v = num(game[k]);
    if (v != null && v > 0) score += 20;
  }
  const coreKeys = ['disposals', 'kicks', 'handballs', 'marks', 'goals', 'tackles'] as const;
  for (const k of coreKeys) {
    const v = num(game[k]);
    if (v != null && v > 0) score += 5;
  }
  if (String(game.date ?? game.game_date ?? '').trim()) score += 2;
  if (String(game.round ?? '').trim()) score += 1;
  return score;
}

export function dedupeAflGames<T extends Record<string, unknown>>(games: T[]): T[] {
  if (!Array.isArray(games) || games.length <= 1) return games;
  const deduped: T[] = [];
  const indexByKey = new Map<string, number>();
  for (const game of games) {
    const key = buildAflGameDedupeKey(game);
    if (!key) {
      deduped.push(game);
      continue;
    }
    const existingIdx = indexByKey.get(key);
    if (existingIdx == null) {
      indexByKey.set(key, deduped.length);
      deduped.push(game);
      continue;
    }
    const existing = deduped[existingIdx];
    if (scoreAflGameRowQuality(game) > scoreAflGameRowQuality(existing)) {
      deduped[existingIdx] = game;
    }
  }
  return deduped;
}
