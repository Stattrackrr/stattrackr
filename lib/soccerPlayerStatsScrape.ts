import type { Browser, Page } from 'puppeteer-core';
import { launchHeadlessBrowser } from '@/lib/puppeteerLaunch';
import { getSoccerTeamResultsCache, normalizeSoccerTeamHref } from '@/lib/soccerCache';
import { getPermanentSoccerTeamResults } from '@/lib/soccerPermanentStore';
import { fetchLiveSoccerwayTeamResultsMatches } from '@/lib/soccerwayLiveTeamResultsFetch';
import { fetchSoccerwayPlayerStatsHtml, pickLargestTableFromHtml } from '@/lib/soccerwayPlayerStatsHtmlFetch';
import {
  applyPositionsToPlayerMatches,
  extractSoccerwayRoleFromText,
  stripSoccerwayRoleFromPlayerCell,
} from '@/lib/soccerPlayerPosition';
import {
  filterMatchesToSeasonYear,
  getCurrentSoccerSeasonYear,
  getSoccerSeasonYearFromKickoffUnix,
} from '@/lib/soccerOpponentBreakdown';
import { canonicalSoccerStatKey, readCanonicalSoccerStatValue } from '@/lib/soccerStatKeyAliases';
import type { SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

export { getCurrentSoccerSeasonYear, getSoccerSeasonYearFromKickoffUnix, parseSoccerSeasonYearParam } from '@/lib/soccerOpponentBreakdown';

/** Load enough recent games before season filter so we can still fill `limit` for the current season. */
const SEASON_SCRAPE_PREFETCH_MATCHES = 120;

export { applyPositionsToPlayerMatches, derivePrimaryPositionFromMatches, enrichPlayerStatsWithPositions } from '@/lib/soccerPlayerPosition';

export const PLAYER_STAT_CATEGORIES = ['top', 'shots', 'attack', 'passes', 'defense', 'goalkeeping', 'general'] as const;
export type PlayerStatCategory = (typeof PLAYER_STAT_CATEGORIES)[number];
/** Default is the full Soccerway tab set; the UI then filters which keys to surface. */
export const DEFAULT_PLAYER_STAT_CATEGORIES: PlayerStatCategory[] = [...PLAYER_STAT_CATEGORIES];
const PLAYER_STAT_CATEGORY_SET = new Set<string>(PLAYER_STAT_CATEGORIES);

export const SOCCERWAY_ORIGIN = 'https://www.soccerway.com';
export const DEFAULT_MATCH_LIMIT = 100;
export const MAX_MATCH_LIMIT = 100;
/** No cap after season filter — include every match in the current season. */
export const FULL_SEASON_PLAYER_MATCH_LIMIT = 0;
/** Higher is faster when the fetch path works; cap avoids hammering Soccerway. */
export const DEFAULT_SCRAPE_MATCH_CONCURRENCY = 10;

export type PlayerStatRow = {
  player: string | null;
  rawCells: string[];
  stats: Record<string, string | null>;
  /** Short code: GK, CB, CDM, CAM, CM, FB, WB, W, ST, etc. */
  position?: string | null;
  /** Soccerway phrase, e.g. "centre back". */
  positionRaw?: string | null;
};

export type PlayerMatchStats = {
  matchId: string;
  summaryPath: string;
  kickoffUnix: number | null;
  opponent: string;
  opponentLogoUrl?: string | null;
  competitionName?: string | null;
  competitionCountry?: string | null;
  venue: 'HOME' | 'AWAY';
  scoreline: string;
  result: 'W' | 'D' | 'L';
  categories: Partial<Record<PlayerStatCategory, PlayerStatRow>>;
  /** Mode across categories for this match. */
  position?: string | null;
  positionRaw?: string | null;
};

export function normalizeText(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeader(value: string, fallback: string): string {
  let label = String(value || '').trim();
  if (label.length >= 4 && label.length % 2 === 0) {
    const half = label.length / 2;
    if (label.slice(0, half) === label.slice(half)) label = label.slice(0, half);
  }

  const slug =
    label
      .toLowerCase()
      .replace(/\(xg\)/g, ' xg')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || fallback;
  return canonicalSoccerStatKey(slug);
}

export { canonicalSoccerStatKey, readCanonicalSoccerStatValue };

function normalizePlayerCell(value: string | null | undefined): string {
  return normalizeText(value)
    .replace(/\b(goalkeeper|centre back|center back|fullback|wingback|midfielder|attacking midfielder|defensive midfielder|winger|forward|striker)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Aliases for matching a player's row on Soccerway player-stats tables. */
export function buildPlayerAliasesFromDisplayName(displayName: string): string[] {
  const base = normalizePlayerCell(displayName);
  if (!base) return [];
  const aliases = new Set<string>([base]);
  const parts = base.split(/\s+/).filter(Boolean);
  for (const p of parts) {
    if (p.length >= 4) aliases.add(p);
  }
  if (parts.length >= 2) {
    const lastFirst = `${parts[parts.length - 1]} ${parts[0]}`;
    const normalizedSwap = normalizePlayerCell(lastFirst);
    if (normalizedSwap) aliases.add(normalizedSwap);
    // Match summary tables that abbreviate given names: "N. Aké" / "N Aké" → "n ake" after normalize.
    for (let i = 0; i < parts.length; i++) {
      for (let j = 0; j < parts.length; j++) {
        if (i === j) continue;
        const initial = parts[i]?.charAt(0);
        if (!initial) continue;
        const cand = normalizePlayerCell(`${initial} ${parts[j]}`);
        if (cand.length >= 3) aliases.add(cand);
      }
    }
  }
  return [...aliases];
}

function cellMatchesPlayerAliases(cell: string | null | undefined, aliases: string[]): boolean {
  const normalized = normalizePlayerCell(cell);
  if (!normalized) return false;
  return aliases.some((alias) => {
    if (alias.length < 3) return false;
    if (normalized === alias) return true;
    if (normalized.includes(alias)) return true;
    if (alias.length >= 4 && normalized.length >= 4 && alias.includes(normalized)) return true;
    return false;
  });
}

function rowMatchesPlayerAliases(cells: string[], aliases: string[]): boolean {
  if (cells.some((cell) => cellMatchesPlayerAliases(cell, aliases))) return true;
  const joined = normalizePlayerCell(cells.join(' '));
  if (!joined) return false;
  return cellMatchesPlayerAliases(joined, aliases);
}

function playerStatRowFromParsedTable(
  tableData: { headers: string[]; rows: string[][] },
  aliases: string[]
): PlayerStatRow | null {
  const matchedRow = tableData.rows.find((row) => rowMatchesPlayerAliases(row, aliases));
  if (!matchedRow) return null;

  const stats: Record<string, string | null> = {};
  tableData.headers.forEach((header, index) => {
    if (index === 0) return;
    stats[normalizeHeader(header, `col_${index}`)] = matchedRow[index] ?? null;
  });

  const playerCell = matchedRow[0] || null;
  const role = extractSoccerwayRoleFromText(playerCell);

  return {
    player: playerCell ? stripSoccerwayRoleFromPlayerCell(playerCell) : null,
    rawCells: matchedRow,
    stats,
    position: role?.code ?? null,
    positionRaw: role?.raw ?? null,
  };
}

export function parseRequestedPlayerStatCategories(value: string | null): PlayerStatCategory[] {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return DEFAULT_PLAYER_STAT_CATEGORIES;
  if (normalized === 'all') return [...PLAYER_STAT_CATEGORIES];

  const requested = normalized
    .split(',')
    .map((category) => category.trim())
    .filter((category): category is PlayerStatCategory => PLAYER_STAT_CATEGORY_SET.has(category));
  return requested.length ? requested : DEFAULT_PLAYER_STAT_CATEGORIES;
}

function normalizeSummaryPath(value: string | null | undefined): string {
  const path = String(value || '').trim();
  if (!path) return '';
  return path.startsWith('/') ? path : `/${path}`;
}

function matchRowDedupeKey(match: Pick<SoccerwayRecentMatch, 'matchId' | 'summaryPath'>): string {
  const id = String(match.matchId ?? '').trim();
  if (id) return `id:${id}`;
  const path = normalizeSummaryPath(match.summaryPath);
  return path ? `path:${path.toLowerCase()}` : '';
}

function mergeLiveRowWithEnrichment(live: SoccerwayRecentMatch, other: SoccerwayRecentMatch): SoccerwayRecentMatch {
  return {
    ...other,
    ...live,
    homeLogoUrl: live.homeLogoUrl ?? other.homeLogoUrl,
    awayLogoUrl: live.awayLogoUrl ?? other.awayLogoUrl,
    competitionName: live.competitionName ?? other.competitionName,
    competitionCountry: live.competitionCountry ?? other.competitionCountry,
    stats: live.stats ?? other.stats,
  };
}

function getMatchBaseUrl(summaryPath: string): string {
  return `${SOCCERWAY_ORIGIN}${normalizeSummaryPath(summaryPath).replace(/\/summary\/?$/i, '/')}`;
}

/** Soccerway serves the real player-stats table when `?mid={matchId}` is present (same as the browser URL bar). */
export function buildSoccerwayPlayerStatsCategoryUrl(
  summaryPath: string,
  category: string,
  matchId?: string | null
): string {
  const base = getMatchBaseUrl(summaryPath);
  const mid = String(matchId ?? '').trim();
  const path = `${base}summary/player-stats/${category}/`;
  return mid ? `${path}?mid=${encodeURIComponent(mid)}` : path;
}

function getSelectedTeamSide(match: SoccerwayRecentMatch, teamHref: string): 'home' | 'away' {
  const participantId = normalizeSoccerTeamHref(teamHref).split('/').filter(Boolean).at(-1) || '';
  const summary = normalizeSummaryPath(match.summaryPath);
  const homeToken = summary.match(/\/match\/[^/]+-([^/]+)\//)?.[1] ?? '';
  const awayToken = summary.match(/\/match\/[^/]+\/[^/]+-([^/]+)\//)?.[1] ?? '';
  if (participantId && homeToken === participantId) return 'home';
  if (participantId && awayToken === participantId) return 'away';
  return normalizeText(match.homeTeam).includes('manchester city') ? 'home' : 'away';
}

function toMatchResult(match: SoccerwayRecentMatch, side: 'home' | 'away'): Pick<PlayerMatchStats, 'opponent' | 'venue' | 'scoreline' | 'result'> {
  const teamScore = side === 'home' ? match.homeScore : match.awayScore;
  const opponentScore = side === 'home' ? match.awayScore : match.homeScore;
  const result = teamScore > opponentScore ? 'W' : teamScore < opponentScore ? 'L' : 'D';
  return {
    opponent: side === 'home' ? match.awayTeam : match.homeTeam,
    venue: side === 'home' ? 'HOME' : 'AWAY',
    scoreline: `${teamScore}-${opponentScore}`,
    result,
  };
}

function addMatchMetadata(row: PlayerMatchStats, match: SoccerwayRecentMatch, side: 'home' | 'away'): PlayerMatchStats {
  return {
    ...row,
    opponentLogoUrl: side === 'home' ? match.awayLogoUrl ?? null : match.homeLogoUrl ?? null,
    competitionName: match.competitionName ?? null,
    competitionCountry: match.competitionCountry ?? null,
  };
}

const LIVE_TEAM_RESULTS_FEED_PAGES = 8;

export function filterPlayerMatchStatsToSeasonYear(
  matches: PlayerMatchStats[],
  seasonYear: number
): PlayerMatchStats[] {
  if (!Number.isFinite(seasonYear) || seasonYear <= 0) return [];
  return matches.filter((match) => getSoccerSeasonYearFromKickoffUnix(match.kickoffUnix) === seasonYear);
}

function resolveSeasonYearForScrape(seasonYear: number | null | undefined): number | null {
  if (seasonYear === null) return null;
  if (typeof seasonYear === 'number' && Number.isFinite(seasonYear) && seasonYear > 0) return Math.floor(seasonYear);
  return getCurrentSoccerSeasonYear();
}

export function parsePlayerStatsMatchLimit(
  raw: string | null | undefined,
  options: { seasonYear?: number | null } = {}
): number {
  const value = String(raw ?? '').trim().toLowerCase();
  const seasonScoped = options.seasonYear !== null && options.seasonYear !== undefined;
  if (!value || value === 'all' || value === '0' || value === 'season' || value === 'full') {
    return seasonScoped ? FULL_SEASON_PLAYER_MATCH_LIMIT : DEFAULT_MATCH_LIMIT;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return seasonScoped ? FULL_SEASON_PLAYER_MATCH_LIMIT : DEFAULT_MATCH_LIMIT;
  }
  return Math.min(MAX_MATCH_LIMIT, parsed);
}

export function applySeasonAndLimitToRecentMatches(
  matches: SoccerwayRecentMatch[],
  limit: number,
  seasonYear: number | null | undefined
): SoccerwayRecentMatch[] {
  const effectiveSeason = resolveSeasonYearForScrape(seasonYear);
  const sorted = [...matches]
    .filter((match) => normalizeSummaryPath(match.summaryPath))
    .sort((a, b) => (b.kickoffUnix ?? Number.MIN_SAFE_INTEGER) - (a.kickoffUnix ?? Number.MIN_SAFE_INTEGER));
  const seasonScoped =
    effectiveSeason != null ? filterMatchesToSeasonYear(sorted, effectiveSeason) : sorted;
  if (limit <= 0) {
    if (effectiveSeason != null) return seasonScoped;
    return seasonScoped.slice(0, DEFAULT_MATCH_LIMIT);
  }
  return seasonScoped.slice(0, limit);
}

export async function loadRecentMatchesForScrape(
  teamHref: string,
  limit: number,
  opts?: { mergeLiveSoccerway?: boolean; seasonYear?: number | null }
): Promise<SoccerwayRecentMatch[]> {
  const effectiveSeason = resolveSeasonYearForScrape(opts?.seasonYear);
  const prefetchLimit =
    limit <= 0 && effectiveSeason != null
      ? SEASON_SCRAPE_PREFETCH_MATCHES
      : effectiveSeason != null
        ? Math.max(limit, SEASON_SCRAPE_PREFETCH_MATCHES)
        : limit <= 0
          ? DEFAULT_MATCH_LIMIT
          : limit;

  const cached = await getSoccerTeamResultsCache(teamHref, { quiet: true, restTimeoutMs: 700, jsTimeoutMs: 700 });
  const cachedMatches = cached?.matches ?? [];
  const permanent = await getPermanentSoccerTeamResults(teamHref, { limitMatches: prefetchLimit });
  const byKey = new Map<string, SoccerwayRecentMatch>();
  const liveKeys = new Set<string>();

  if (opts?.mergeLiveSoccerway) {
    try {
      const live = await fetchLiveSoccerwayTeamResultsMatches(teamHref, LIVE_TEAM_RESULTS_FEED_PAGES);
      for (const match of live) {
        const key = matchRowDedupeKey(match);
        if (!key) continue;
        liveKeys.add(key);
        byKey.set(key, match);
      }
    } catch (error) {
      console.error('[soccerPlayerStatsScrape] live Soccerway team results fetch failed', error);
    }
  }

  for (const match of [...(permanent?.matches ?? []), ...cachedMatches]) {
    const key = matchRowDedupeKey(match);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, match);
      continue;
    }
    if (opts?.mergeLiveSoccerway && liveKeys.has(key)) {
      byKey.set(key, mergeLiveRowWithEnrichment(existing, match));
    } else {
      byKey.set(key, match);
    }
  }

  return applySeasonAndLimitToRecentMatches(Array.from(byKey.values()), limit, opts?.seasonYear);
}

async function createPlayerStatsPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const resourceType = request.resourceType();
    if (
      resourceType === 'image' ||
      resourceType === 'font' ||
      resourceType === 'media' ||
      resourceType === 'stylesheet' ||
      resourceType === 'manifest' ||
      resourceType === 'other'
    ) {
      void request.abort();
      return;
    }
    void request.continue();
  });
  return page;
}

type ParsedStatsTable = { headers: string[]; rows: string[][] };

async function readPlayerCategoryTablePuppeteer(page: Page, url: string): Promise<ParsedStatsTable> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Soccerway lazy-renders the player-stats table once the SPA hydrates. We wait for an actual
  // populated row that contains a player name (cell with letters) rather than just any <td>,
  // because "Loading…"/spinner rows can have non-empty text but never produce real data.
  const isLoadedInBrowser = () => {
    const tables = Array.from(document.querySelectorAll('table'));
    for (const t of tables) {
      const rows = t.querySelectorAll('tr');
      if (rows.length < 2) continue;
      for (const row of Array.from(rows).slice(1)) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) continue;
        const joined = Array.from(cells)
          .map((c) => (c.textContent || '').trim())
          .join(' ');
        if (/[A-Za-zÀ-ÿ]{3,}/.test(joined)) return true;
      }
    }
    return false;
  };

  let loaded = await page
    .waitForFunction(isLoadedInBrowser, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  // Some pages need a small nudge (scroll triggers IntersectionObserver-based loaders); try once more.
  if (!loaded) {
    await page.evaluate(() => window.scrollBy(0, 1000)).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 500));
    loaded = await page
      .waitForFunction(isLoadedInBrowser, { timeout: 7000 })
      .then(() => true)
      .catch(() => false);
  }

  return page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    // Prefer tables whose data rows contain alphabetic text (player names) over decorative tables.
    let table: Element | null = null;
    let bestScore = -1;
    for (const t of tables) {
      const rows = t.querySelectorAll('tr');
      if (rows.length < 2) continue;
      let alphaRows = 0;
      for (const row of Array.from(rows).slice(1)) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) continue;
        const joined = Array.from(cells)
          .map((c) => (c.textContent || '').trim())
          .join(' ');
        if (/[A-Za-zÀ-ÿ]{3,}/.test(joined)) alphaRows += 1;
      }
      const score = alphaRows * 1000 + rows.length;
      if (score > bestScore) {
        bestScore = score;
        table = t;
      }
    }
    if (!table) return { headers: [] as string[], rows: [] as string[][] };
    const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
      Array.from(row.querySelectorAll('th, td')).map((cell) => (cell.textContent || '').replace(/\s+/g, ' ').trim())
    );
    return {
      headers: rows[0] || [],
      rows: rows.slice(1).filter((row) => row.some((cell) => cell)),
    };
  });
}

async function readPlayerCategory(page: Page, url: string, aliases: string[]): Promise<PlayerStatRow | null> {
  const tableData = await readPlayerCategoryTablePuppeteer(page, url);
  return playerStatRowFromParsedTable(tableData, aliases);
}

async function readPlayerCategoryTableFetch(url: string): Promise<ParsedStatsTable | null> {
  try {
    const html = await fetchSoccerwayPlayerStatsHtml(url);
    return pickLargestTableFromHtml(html);
  } catch {
    return null;
  }
}

async function readPlayerCategoryFetch(url: string, aliases: string[]): Promise<PlayerStatRow | null> {
  const tableData = await readPlayerCategoryTableFetch(url);
  if (!tableData) return null;
  return playerStatRowFromParsedTable(tableData, aliases);
}

export type BuildPlayerStatsOptions = {
  matchConcurrency?: number;
  /** When set, skips loading matches (batch mode shares one list). */
  prefetchedMatches?: SoccerwayRecentMatch[];
  /**
   * Total in-flight HTTP fetches across all (match, category) pairs.
   * Defaults to `matchConcurrency * categories.length`. Use this to crank concurrency without
   * coupling it to match batching.
   */
  fetchConcurrency?: number;
  /**
   * If true, skip the Puppeteer fallback entirely when a fetch tab returned no parseable table.
   * Batch jobs default to skipping the fallback because each Puppeteer nav is orders of magnitude
   * slower than a plain HTTP fetch.
   */
  disablePuppeteerFallback?: boolean;
  /**
   * If true, skip the (often useless) plain-HTTP fetch step entirely and run **every** `(match, category)`
   * pair through the shared Puppeteer pool. Use this when Soccerway player-stats tables are
   * JS-rendered (our fetch returns the page shell with no parseable table).
   */
  puppeteerOnly?: boolean;
  /** Season start year (2025 = 2025/26). Omit for current season; pass `null` for no season filter. */
  seasonYear?: number | null;
  /** Seed per-player buckets before scraping (incremental refresh). */
  existingByPlayer?: Map<string, PlayerMatchStats[]>;
  /** Only scrape these matches; defaults to full season match list when omitted. */
  scrapeMatches?: SoccerwayRecentMatch[];
};

/** Promise pool that runs at most `limit` async tasks in flight at once. */
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  const total = items.length;
  if (!total) return;
  const concurrency = Math.max(1, Math.min(limit, total));
  let cursor = 0;
  const runners: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i += 1) {
    runners.push(
      (async () => {
        while (true) {
          const myIndex = cursor;
          cursor += 1;
          if (myIndex >= total) return;
          await worker(items[myIndex], myIndex);
        }
      })()
    );
  }
  await Promise.all(runners);
}

export async function buildPlayerStatsForAliases(
  teamHref: string,
  limit: number,
  playerStatCategories: PlayerStatCategory[],
  aliases: string[],
  options?: BuildPlayerStatsOptions
): Promise<PlayerMatchStats[]> {
  const matchConcurrency = Math.max(
    1,
    Math.min(16, options?.matchConcurrency ?? DEFAULT_SCRAPE_MATCH_CONCURRENCY)
  );
  const seasonYear = options?.seasonYear !== undefined ? options.seasonYear : getCurrentSoccerSeasonYear();
  const matches = applySeasonAndLimitToRecentMatches(
    options?.prefetchedMatches ??
      (await loadRecentMatchesForScrape(teamHref, limit, { mergeLiveSoccerway: true, seasonYear })),
    limit,
    seasonYear
  );
  if (!matches.length) return [];

  const browserHolder: { current: Browser | null } = { current: null };
  const puppeteerOnly = process.env.SOCCER_PLAYER_STATS_PUPPETEER_ONLY === '1';

  const ensureBrowser = async (): Promise<Browser> => {
    if (!browserHolder.current) {
      browserHolder.current = await launchHeadlessBrowser();
    }
    return browserHolder.current;
  };

  try {
    const scrapeMatch = async (match: SoccerwayRecentMatch): Promise<PlayerMatchStats | null> => {
      const categories: PlayerMatchStats['categories'] = {};

      if (!puppeteerOnly) {
        await Promise.all(
          playerStatCategories.map(async (category) => {
            try {
              const row = await readPlayerCategoryFetch(
                buildSoccerwayPlayerStatsCategoryUrl(match.summaryPath, category, match.matchId),
                aliases
              );
              if (row) categories[category] = row;
            } catch {
              /* best-effort per category */
            }
          })
        );
      }

      const missing = playerStatCategories.filter((category) => !categories[category]);
      if (missing.length) {
        const b = await ensureBrowser();
        const page = await createPlayerStatsPage(b);
        try {
          for (const category of missing) {
            try {
              const row = await readPlayerCategory(
                page,
                buildSoccerwayPlayerStatsCategoryUrl(match.summaryPath, category, match.matchId),
                aliases
              );
              if (row) categories[category] = row;
            } catch {
              /* best-effort per category */
            }
          }
        } finally {
          await page.close().catch(() => undefined);
        }
      }

      if (Object.keys(categories).length === 0) return null;
      const side = getSelectedTeamSide(match, teamHref);
      return addMatchMetadata(
        {
          matchId: match.matchId,
          summaryPath: match.summaryPath,
          kickoffUnix: match.kickoffUnix,
          ...toMatchResult(match, side),
          categories,
        },
        match,
        side
      );
    };

    const output: PlayerMatchStats[] = [];
    for (let index = 0; index < matches.length; index += matchConcurrency) {
      const batch = matches.slice(index, index + matchConcurrency);
      const rows = await Promise.all(batch.map((match) => scrapeMatch(match)));
      output.push(...rows.filter((row): row is PlayerMatchStats => row != null));
    }
    return applyPositionsToPlayerMatches(
      output.sort((a, b) => (b.kickoffUnix ?? Number.MIN_SAFE_INTEGER) - (a.kickoffUnix ?? Number.MIN_SAFE_INTEGER))
    );
  } finally {
    if (browserHolder.current) await browserHolder.current.close().catch(() => undefined);
  }
}

export type SquadPlayerInput = {
  playerKey: string;
  displayName: string;
  aliases: string[];
};

export type SquadPlayerStatsResult = {
  playerKey: string;
  displayName: string;
  matches: PlayerMatchStats[];
};

/**
 * Scrape player stats for an entire squad efficiently: fetch each (match, category) page **once**
 * and distribute the parsed rows to every player by alias. Uses a single global concurrency pool
 * over all `(match, category)` pairs so slow tabs don't block faster ones.
 *
 * Puppeteer fallback is **off by default** for batch runs (set `disablePuppeteerFallback: false`
 * or `SOCCER_PLAYER_STATS_PUPPETEER_FALLBACK=1` to opt in). Each fallback nav is orders of
 * magnitude slower than a plain fetch and tends to push full-squad runs from seconds into
 * many minutes.
 */
export async function buildSquadPlayerStats(
  teamHref: string,
  limit: number,
  playerStatCategories: PlayerStatCategory[],
  players: SquadPlayerInput[],
  options?: BuildPlayerStatsOptions
): Promise<SquadPlayerStatsResult[]> {
  if (!players.length) return [];

  const matchConcurrency = Math.max(
    1,
    Math.min(25, options?.matchConcurrency ?? DEFAULT_SCRAPE_MATCH_CONCURRENCY)
  );
  const fetchConcurrency = Math.max(
    1,
    Math.min(60, options?.fetchConcurrency ?? matchConcurrency * Math.max(1, playerStatCategories.length))
  );
  const seasonYear = options?.seasonYear !== undefined ? options.seasonYear : getCurrentSoccerSeasonYear();
  const seasonMatches = applySeasonAndLimitToRecentMatches(
    options?.prefetchedMatches ??
      (await loadRecentMatchesForScrape(teamHref, limit, { mergeLiveSoccerway: true, seasonYear })),
    limit,
    seasonYear
  );
  const matches =
    options?.scrapeMatches != null
      ? options.scrapeMatches
      : seasonMatches;
  if (!seasonMatches.length) {
    return players.map((p) => ({
      playerKey: p.playerKey,
      displayName: p.displayName,
      matches: applyPositionsToPlayerMatches(options?.existingByPlayer?.get(p.playerKey) ?? []),
    }));
  }

  const puppeteerOnly = options?.puppeteerOnly === true || process.env.SOCCER_PLAYER_STATS_PUPPETEER_ONLY === '1';
  const fallbackEnv = process.env.SOCCER_PLAYER_STATS_PUPPETEER_FALLBACK === '1';
  const fallbackEnabled = puppeteerOnly || fallbackEnv || options?.disablePuppeteerFallback === false;
  const browserHolder: { current: Browser | null } = { current: null };
  const ensureBrowser = async (): Promise<Browser> => {
    if (!browserHolder.current) {
      browserHolder.current = await launchHeadlessBrowser();
    }
    return browserHolder.current;
  };

  // playerKey -> matchId -> PlayerMatchStats
  const perPlayer = new Map<string, Map<string, PlayerMatchStats>>();
  for (const p of players) {
    const bucket = new Map<string, PlayerMatchStats>();
    for (const row of options?.existingByPlayer?.get(p.playerKey) ?? []) {
      const key = String(row.matchId || '').trim();
      if (key) bucket.set(key, row);
    }
    perPlayer.set(p.playerKey, bucket);
  }

  const distributeTable = (
    match: SoccerwayRecentMatch,
    category: PlayerStatCategory,
    table: ParsedStatsTable
  ) => {
    const side = getSelectedTeamSide(match, teamHref);
    const baseResult = toMatchResult(match, side);
    for (const p of players) {
      const row = playerStatRowFromParsedTable(table, p.aliases);
      if (!row) continue;
      const bucket = perPlayer.get(p.playerKey)!;
      let entry = bucket.get(match.matchId);
      if (!entry) {
        entry = addMatchMetadata(
          {
            matchId: match.matchId,
            summaryPath: match.summaryPath,
            kickoffUnix: match.kickoffUnix,
            ...baseResult,
            categories: {},
          },
          match,
          side
        );
        bucket.set(match.matchId, entry);
      }
      entry.categories[category] = row;
    }
  };

  type FetchTask = { match: SoccerwayRecentMatch; category: PlayerStatCategory };
  const fetchTasks: FetchTask[] = [];
  for (const match of matches) {
    for (const category of playerStatCategories) {
      fetchTasks.push({ match, category });
    }
  }

  let fetchOk = 0;
  let fetchEmpty = 0;
  let fetchErr = 0;
  const missingByMatch = new Map<string, PlayerStatCategory[]>();
  const matchById = new Map(matches.map((m) => [m.matchId, m] as const));

  const t0 = Date.now();
  try {
    if (!puppeteerOnly) {
      await runWithConcurrency(fetchTasks, fetchConcurrency, async ({ match, category }) => {
        const url = buildSoccerwayPlayerStatsCategoryUrl(match.summaryPath, category, match.matchId);
        try {
          const table = await readPlayerCategoryTableFetch(url);
          if (table && (table.rows.length > 0 || table.headers.length > 0)) {
            fetchOk += 1;
            distributeTable(match, category, table);
          } else {
            fetchEmpty += 1;
            if (!missingByMatch.has(match.matchId)) missingByMatch.set(match.matchId, []);
            missingByMatch.get(match.matchId)!.push(category);
          }
        } catch {
          fetchErr += 1;
          if (!missingByMatch.has(match.matchId)) missingByMatch.set(match.matchId, []);
          missingByMatch.get(match.matchId)!.push(category);
        }
      });
    } else {
      for (const match of matches) missingByMatch.set(match.matchId, [...playerStatCategories]);
    }

    const tFetch = Date.now();
    const missingMatches = Array.from(missingByMatch.entries()).filter(([, cats]) => cats.length > 0);
    let fallbackOk = 0;
    let fallbackEmpty = 0;
    let fallbackErr = 0;

    if (fallbackEnabled && missingMatches.length) {
      await runWithConcurrency(missingMatches, Math.max(1, Math.min(matchConcurrency, missingMatches.length)), async ([matchId, missingCats]) => {
        const match = matchById.get(matchId);
        if (!match) return;
        const b = await ensureBrowser();
        const page = await createPlayerStatsPage(b);
        try {
          for (const category of missingCats) {
            try {
              const table = await readPlayerCategoryTablePuppeteer(
                page,
                buildSoccerwayPlayerStatsCategoryUrl(match.summaryPath, category, match.matchId)
              );
              if (table.rows.length > 0 || table.headers.length > 0) {
                fallbackOk += 1;
                distributeTable(match, category, table);
              } else {
                fallbackEmpty += 1;
              }
            } catch {
              fallbackErr += 1;
            }
          }
        } finally {
          await page.close().catch(() => undefined);
        }
      });
    }

    const tDone = Date.now();
    const ms = (n: number) => `${(n / 1000).toFixed(1)}s`;
    const fetchPart = puppeteerOnly
      ? `fetch=skipped(puppeteerOnly)`
      : `fetch=${ms(tFetch - t0)} (ok=${fetchOk} empty=${fetchEmpty} err=${fetchErr})`;
    console.log(
      `[soccerPlayerStatsScrape] squad scrape: fetchMatches=${matches.length} seasonMatches=${seasonMatches.length} ` +
        `cats=${playerStatCategories.length} players=${players.length} ${fetchPart} ` +
        (fallbackEnabled
          ? `fallback=${ms(tDone - tFetch)} (ok=${fallbackOk} empty=${fallbackEmpty} err=${fallbackErr})`
          : `fallback=disabled missingTabs=${fetchEmpty + fetchErr}`)
    );

    return players.map((p) => {
      const bucket = perPlayer.get(p.playerKey)!;
      const sorted = applyPositionsToPlayerMatches(
        Array.from(bucket.values()).sort(
          (a, b) => (b.kickoffUnix ?? Number.MIN_SAFE_INTEGER) - (a.kickoffUnix ?? Number.MIN_SAFE_INTEGER)
        )
      );
      return { playerKey: p.playerKey, displayName: p.displayName, matches: sorted };
    });
  } finally {
    if (browserHolder.current) await browserHolder.current.close().catch(() => undefined);
  }
}

export async function enrichPlayerMatchesFromTeamCache(
  teamHref: string,
  matches: PlayerMatchStats[]
): Promise<PlayerMatchStats[]> {
  if (!matches.length) return matches;
  const cached = await getSoccerTeamResultsCache(teamHref, { quiet: true, restTimeoutMs: 700, jsTimeoutMs: 700 });
  const teamMatches = cached?.matches ?? [];
  if (!teamMatches.length) return matches;

  const byId = new Map(teamMatches.map((match) => [match.matchId, match]));
  return matches.map((row) => {
    const match = byId.get(row.matchId);
    if (!match) return row;
    const side = getSelectedTeamSide(match, teamHref);
    return addMatchMetadata(row, match, side);
  });
}
