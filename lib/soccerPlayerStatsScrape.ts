import puppeteer, { type Browser, type Page } from 'puppeteer';
import { getSoccerTeamResultsCache, normalizeSoccerTeamHref } from '@/lib/soccerCache';
import { getPermanentSoccerTeamResults } from '@/lib/soccerPermanentStore';
import { fetchLiveSoccerwayTeamResultsMatches } from '@/lib/soccerwayLiveTeamResultsFetch';
import type { SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

export const PLAYER_STAT_CATEGORIES = ['top', 'shots', 'attack', 'passes', 'defense', 'goalkeeping', 'general'] as const;
export type PlayerStatCategory = (typeof PLAYER_STAT_CATEGORIES)[number];
export const DEFAULT_PLAYER_STAT_CATEGORIES: PlayerStatCategory[] = ['top'];
const PLAYER_STAT_CATEGORY_SET = new Set<string>(PLAYER_STAT_CATEGORIES);

export const SOCCERWAY_ORIGIN = 'https://www.soccerway.com';
export const DEFAULT_MATCH_LIMIT = 100;
export const MAX_MATCH_LIMIT = 100;
export const DEFAULT_SCRAPE_MATCH_CONCURRENCY = 5;

export type PlayerStatRow = {
  player: string | null;
  rawCells: string[];
  stats: Record<string, string | null>;
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

  return (
    label
      .toLowerCase()
      .replace(/\(xg\)/g, ' xg')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || fallback
  );
}

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

export async function loadRecentMatchesForScrape(
  teamHref: string,
  limit: number,
  opts?: { mergeLiveSoccerway?: boolean }
): Promise<SoccerwayRecentMatch[]> {
  const cached = await getSoccerTeamResultsCache(teamHref, { quiet: true, restTimeoutMs: 700, jsTimeoutMs: 700 });
  const cachedMatches = cached?.matches ?? [];
  const permanent = await getPermanentSoccerTeamResults(teamHref, { limitMatches: limit });
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

  const sorted = Array.from(byKey.values())
    .filter((match) => normalizeSummaryPath(match.summaryPath))
    .sort((a, b) => (b.kickoffUnix ?? Number.MIN_SAFE_INTEGER) - (a.kickoffUnix ?? Number.MIN_SAFE_INTEGER));
  return sorted.slice(0, limit);
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
    if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
      void request.abort();
      return;
    }
    void request.continue();
  });
  return page;
}

async function readPlayerCategory(page: Page, url: string, aliases: string[]): Promise<PlayerStatRow | null> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('table', { timeout: 10000 }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 600));

  const tableData = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    let table: Element | null = null;
    let best = 0;
    for (const t of tables) {
      const n = t.querySelectorAll('tr').length;
      if (n > best) {
        best = n;
        table = t;
      }
    }
    if (!table) {
      table = document.querySelector('table');
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

  const matchedRow = tableData.rows.find((row) => rowMatchesPlayerAliases(row, aliases));
  if (!matchedRow) return null;

  const stats: Record<string, string | null> = {};
  tableData.headers.forEach((header, index) => {
    if (index === 0) return;
    stats[normalizeHeader(header, `col_${index}`)] = matchedRow[index] ?? null;
  });

  return {
    player: matchedRow[0] || null,
    rawCells: matchedRow,
    stats,
  };
}

export type BuildPlayerStatsOptions = {
  matchConcurrency?: number;
  /** When set, skips loading matches (batch mode shares one list). */
  prefetchedMatches?: SoccerwayRecentMatch[];
};

export async function buildPlayerStatsForAliases(
  teamHref: string,
  limit: number,
  playerStatCategories: PlayerStatCategory[],
  aliases: string[],
  options?: BuildPlayerStatsOptions
): Promise<PlayerMatchStats[]> {
  const matchConcurrency = Math.max(
    1,
    Math.min(12, options?.matchConcurrency ?? DEFAULT_SCRAPE_MATCH_CONCURRENCY)
  );
  const matches =
    options?.prefetchedMatches ??
    (await loadRecentMatchesForScrape(teamHref, limit, { mergeLiveSoccerway: true }));
  if (!matches.length) return [];

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const scrapeMatch = async (match: SoccerwayRecentMatch): Promise<PlayerMatchStats | null> => {
      const page = await createPlayerStatsPage(browser!);
      const baseUrl = getMatchBaseUrl(match.summaryPath);
      const categories: PlayerMatchStats['categories'] = {};

      try {
        for (const category of playerStatCategories) {
          try {
            const row = await readPlayerCategory(page, `${baseUrl}summary/player-stats/${category}/`, aliases);
            if (row) categories[category] = row;
          } catch {
            /* best-effort per category */
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
      } finally {
        await page.close().catch(() => undefined);
      }
    };

    const output: PlayerMatchStats[] = [];
    for (let index = 0; index < matches.length; index += matchConcurrency) {
      const batch = matches.slice(index, index + matchConcurrency);
      const rows = await Promise.all(batch.map((match) => scrapeMatch(match)));
      output.push(...rows.filter((row): row is PlayerMatchStats => row != null));
    }
    return output.sort((a, b) => (b.kickoffUnix ?? Number.MIN_SAFE_INTEGER) - (a.kickoffUnix ?? Number.MIN_SAFE_INTEGER));
  } finally {
    await browser?.close();
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
