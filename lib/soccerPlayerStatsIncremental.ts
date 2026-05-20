import { getSoccerPlayerStatsCacheWithFallback } from '@/lib/soccerCache';
import {
  applyPositionsToPlayerMatches,
  applySeasonAndLimitToRecentMatches,
  filterPlayerMatchStatsToSeasonYear,
  loadRecentMatchesForScrape,
  parseRequestedPlayerStatCategories,
  type BuildPlayerStatsOptions,
  type PlayerMatchStats,
  type PlayerStatCategory,
  type SquadPlayerInput,
} from '@/lib/soccerPlayerStatsScrape';
import type { SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

export type IncrementalSquadPlayerPlan = {
  playerKey: string;
  displayName: string;
  existingMatches: PlayerMatchStats[];
  matchesToScrape: SoccerwayRecentMatch[];
  mode: 'incremental' | 'full';
};

export type IncrementalSquadPlan = {
  seasonMatches: SoccerwayRecentMatch[];
  existingByPlayer: Map<string, PlayerMatchStats[]>;
  matchesToScrape: SoccerwayRecentMatch[];
  players: IncrementalSquadPlayerPlan[];
  playersIncremental: number;
  playersFull: number;
};

function matchIdKey(match: Pick<SoccerwayRecentMatch | PlayerMatchStats, 'matchId' | 'summaryPath'>): string {
  const id = String(match.matchId ?? '').trim();
  if (id) return id;
  const path = String(match.summaryPath ?? '').trim().toLowerCase();
  return path ? `path:${path}` : '';
}

export function mergePlayerMatchStats(
  existing: PlayerMatchStats[],
  incoming: PlayerMatchStats[]
): PlayerMatchStats[] {
  const byKey = new Map<string, PlayerMatchStats>();
  for (const row of existing) {
    const key = matchIdKey(row);
    if (key) byKey.set(key, row);
  }
  for (const row of incoming) {
    const key = matchIdKey(row);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    byKey.set(key, {
      ...prev,
      ...row,
      categories: { ...prev.categories, ...row.categories },
    });
  }
  return applyPositionsToPlayerMatches(
    Array.from(byKey.values()).sort(
      (a, b) => (b.kickoffUnix ?? Number.MIN_SAFE_INTEGER) - (a.kickoffUnix ?? Number.MIN_SAFE_INTEGER)
    )
  );
}

function normalizeCategorySet(categories: string[]): Set<string> {
  const parsed = parseRequestedPlayerStatCategories(categories.join(','));
  const out = new Set(parsed.map((c) => c.toLowerCase()));
  if (!out.size || categories.map((c) => c.toLowerCase()).includes('all')) {
    return new Set(parseRequestedPlayerStatCategories('all').map((c) => c.toLowerCase()));
  }
  return out;
}

function cacheCoversRequestedCategories(
  cachedCategories: string[] | undefined,
  requested: PlayerStatCategory[]
): boolean {
  const cachedSet = normalizeCategorySet(Array.isArray(cachedCategories) ? cachedCategories : []);
  const requestedSet = new Set(requested.map((c) => c.toLowerCase()));
  for (const cat of requestedSet) {
    if (!cachedSet.has(cat)) return false;
  }
  return true;
}

function trimCachedMatchesToSeason(
  matches: PlayerMatchStats[],
  seasonYear: number | null,
  limit: number
): PlayerMatchStats[] {
  let rows = matches;
  if (seasonYear != null) {
    rows = filterPlayerMatchStatsToSeasonYear(rows, seasonYear);
  }
  const sorted = [...rows].sort((a, b) => (b.kickoffUnix ?? 0) - (a.kickoffUnix ?? 0));
  if (limit > 0) return sorted.slice(0, limit);
  return sorted;
}

export function findMissingSeasonMatches(
  seasonMatches: SoccerwayRecentMatch[],
  existing: PlayerMatchStats[]
): SoccerwayRecentMatch[] {
  const have = new Set(existing.map((m) => matchIdKey(m)).filter(Boolean));
  return seasonMatches.filter((m) => {
    const key = matchIdKey(m);
    return key && !have.has(key);
  });
}

export async function planIncrementalSquadPlayerStats(
  teamHref: string,
  limit: number,
  seasonYear: number | null,
  categories: PlayerStatCategory[],
  players: SquadPlayerInput[]
): Promise<IncrementalSquadPlan> {
  const seasonMatches = applySeasonAndLimitToRecentMatches(
    await loadRecentMatchesForScrape(teamHref, limit, { mergeLiveSoccerway: true, seasonYear }),
    limit,
    seasonYear
  );

  const existingByPlayer = new Map<string, PlayerMatchStats[]>();
  const playerPlans: IncrementalSquadPlayerPlan[] = [];
  const scrapeByMatchId = new Map<string, SoccerwayRecentMatch>();

  for (const player of players) {
    const cached = await getSoccerPlayerStatsCacheWithFallback<PlayerMatchStats>(
      teamHref,
      player.playerKey,
      limit,
      categories,
      { seasonYear, quiet: true, restTimeoutMs: 8000, jsTimeoutMs: 8000 }
    );

    const rawExisting = Array.isArray(cached?.matches) ? cached!.matches : [];
    const existing = trimCachedMatchesToSeason(rawExisting, seasonYear, limit);
    existingByPlayer.set(player.playerKey, existing);

    const categoriesOk = cacheCoversRequestedCategories(cached?.categories, categories);
    const missing = categoriesOk ? findMissingSeasonMatches(seasonMatches, existing) : seasonMatches;
    const mode = !cached || !categoriesOk || existing.length === 0 ? 'full' : 'incremental';
    const matchesToScrape = mode === 'full' ? seasonMatches : missing;

    for (const match of matchesToScrape) {
      const id = String(match.matchId || '').trim();
      if (id) scrapeByMatchId.set(id, match);
    }

    playerPlans.push({
      playerKey: player.playerKey,
      displayName: player.displayName,
      existingMatches: existing,
      matchesToScrape,
      mode,
    });
  }

  return {
    seasonMatches,
    existingByPlayer,
    matchesToScrape: Array.from(scrapeByMatchId.values()).sort(
      (a, b) => (b.kickoffUnix ?? Number.MIN_SAFE_INTEGER) - (a.kickoffUnix ?? Number.MIN_SAFE_INTEGER)
    ),
    players: playerPlans,
    playersIncremental: playerPlans.filter((p) => p.mode === 'incremental' && p.matchesToScrape.length > 0).length,
    playersFull: playerPlans.filter((p) => p.mode === 'full').length,
  };
}

export function buildIncrementalSquadOptions(
  plan: IncrementalSquadPlan,
  base: BuildPlayerStatsOptions = {}
): BuildPlayerStatsOptions {
  return {
    ...base,
    prefetchedMatches: plan.seasonMatches,
    scrapeMatches: plan.matchesToScrape,
    existingByPlayer: plan.existingByPlayer,
  };
}
