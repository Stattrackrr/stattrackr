import { NextRequest, NextResponse } from 'next/server';

const AFL_TABLES_BASE = 'https://afltables.com';
const PLAYERS_INDEX_URL = `${AFL_TABLES_BASE}/afl/stats/players.html`;

type PlayerIndexEntry = {
  name: string;
  href: string;
};

type GameLogRow = {
  season: number;
  game_number: number;
  opponent: string;
  round: string;
  result: string;
  guernsey: number | null;
  kicks: number;
  marks: number;
  handballs: number;
  disposals: number;
  goals: number;
  behinds: number;
  hitouts: number;
  tackles: number;
  rebounds: number;
  inside_50s: number;
  clearances: number;
  clangers: number;
  free_kicks_for: number;
  free_kicks_against: number;
  brownlow_votes: number;
  contested_possessions: number;
  uncontested_possessions: number;
  contested_marks: number;
  marks_inside_50: number;
  one_percenters: number;
  bounces: number;
  goal_assists: number;
  percent_played: number | null;
  match_url: string | null;
};

const TTL_MS = 1000 * 60 * 60; // 1 hour
let playersIndexCache: { expiresAt: number; data: PlayerIndexEntry[] } | null = null;
const playerPageCache = new Map<string, { expiresAt: number; data: GameLogRow[]; titleNorm: string }>();

function normalizeName(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTokenForCompare(token: string): string {
  return token
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/\d+$/g, '');
}

function nameMatchesQuery(name: string, normalizedQuery: string): boolean {
  const normalizedName = normalizeName(name);
  if (!normalizedQuery) return true;
  if (normalizedName.includes(normalizedQuery)) return true;
  const parts = normalizedQuery.split(' ').filter(Boolean);
  if (parts.length === 0) return true;
  return parts.every((p) => normalizedName.includes(p));
}

function normalizeHrefSlugName(href: string): string {
  if (!href) return '';
  const cleanHref = href.split('?')[0].split('#')[0];
  const lastSegment = cleanHref.split('/').pop() || '';
  const withoutExt = lastSegment.replace(/\.html?$/i, '');
  const rough = normalizeName(withoutExt.replace(/[_-]+/g, ' '));
  const parts = rough.split(' ').filter(Boolean).map(normalizeTokenForCompare).filter(Boolean);
  return parts.join(' ');
}

function entryMatchesQuery(entry: PlayerIndexEntry, normalizedQuery: string): boolean {
  const normalizedName = normalizeName(entry.name);
  const normalizedSlug = normalizeHrefSlugName(entry.href);
  if (!normalizedQuery) return true;

  if (normalizedName === normalizedQuery || normalizedSlug === normalizedQuery) return true;
  if (normalizedName.includes(normalizedQuery) || normalizedSlug.includes(normalizedQuery)) return true;

  const parts = normalizedQuery.split(' ').filter(Boolean);
  if (parts.length === 0) return true;
  const allPartsInName = parts.every((p) => normalizedName.includes(p));
  const allPartsInSlug = parts.every((p) => normalizedSlug.includes(p));
  if (allPartsInName || allPartsInSlug) return true;

  return false;
}

function htmlToText(v: string): string {
  return v
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseIntSafe(v: string): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function parsePercent(v: string): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return null;
  return n;
}

async function fetchPlayersIndex(): Promise<PlayerIndexEntry[]> {
  if (playersIndexCache && playersIndexCache.expiresAt > Date.now()) {
    return playersIndexCache.data;
  }

  const res = await fetch(PLAYERS_INDEX_URL, { next: { revalidate: 60 * 60 } });
  if (!res.ok) {
    throw new Error(`Failed to fetch players index (${res.status})`);
  }
  const html = await res.text();

  const out: PlayerIndexEntry[] = [];
  const linkRegex = /<a[^>]+href=['"]([^'"]*players\/[A-Z]\/[^'"]+\.html)['"][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null = linkRegex.exec(html);
  while (m) {
    const rawHref = m[1];
    let href = rawHref;
    if (!rawHref.startsWith('http')) {
      if (rawHref.startsWith('/')) {
        href = `${AFL_TABLES_BASE}${rawHref}`;
      } else if (rawHref.startsWith('../')) {
        href = `${AFL_TABLES_BASE}/afl/${rawHref.slice(3)}`;
      } else {
        href = `${AFL_TABLES_BASE}/afl/stats/${rawHref}`;
      }
    }
    const name = htmlToText(m[2]);
    if (name && href) out.push({ name, href });
    m = linkRegex.exec(html);
  }

  // AFLTables repeats player links many times in players.html.
  // Keep one entry per profile URL for stable matching.
  const dedupByHref = new Map<string, PlayerIndexEntry>();
  for (const entry of out) {
    if (!dedupByHref.has(entry.href)) dedupByHref.set(entry.href, entry);
  }
  const deduped = Array.from(dedupByHref.values());

  playersIndexCache = { expiresAt: Date.now() + TTL_MS, data: deduped };
  return deduped;
}

function splitNameParts(name: string): string[] {
  return normalizeName(name).split(' ').filter(Boolean);
}

function initialSurnameMatches(queryName: string, candidateName: string): boolean {
  const qParts = splitNameParts(queryName);
  const cParts = splitNameParts(candidateName);
  if (qParts.length < 2 || cParts.length < 2) return false;

  const qFirst = qParts[0];
  const qLast = normalizeTokenForCompare(qParts[qParts.length - 1]);
  const cFirst = cParts[0];
  const cLast = normalizeTokenForCompare(cParts[cParts.length - 1]);

  if (!qLast || !cLast) return false;
  if (qLast !== cLast && !cLast.startsWith(qLast) && !qLast.startsWith(cLast)) return false;

  // Handles AFLTables shorthand names like "B McCreery" vs "Beau McCreery".
  return qFirst.charAt(0) === cFirst.charAt(0);
}

function queryInitialAndSurname(queryName: string): { firstInitial: string; surname: string } | null {
  const parts = splitNameParts(queryName);
  if (parts.length < 2) return null;
  const firstInitial = normalizeTokenForCompare(parts[0]).charAt(0);
  const surname = normalizeTokenForCompare(parts[parts.length - 1]);
  if (!firstInitial || !surname) return null;
  return { firstInitial, surname };
}

function candidateScoreForQuery(queryName: string, entry: PlayerIndexEntry): number {
  const q = normalizeName(queryName);
  const n = normalizeName(entry.name);
  const s = normalizeHrefSlugName(entry.href);
  let score = 0;

  if (n === q || s === q) score += 100;
  if (n.includes(q) || s.includes(q)) score += 40;
  if (entryMatchesQuery(entry, q)) score += 25;
  if (initialSurnameMatches(queryName, entry.name) || initialSurnameMatches(queryName, s)) score += 20;

  const qMeta = queryInitialAndSurname(queryName);
  if (qMeta) {
    const sParts = s.split(' ').filter(Boolean);
    const cInitial = sParts[0]?.charAt(0) || '';
    const cSurname = normalizeTokenForCompare(sParts[sParts.length - 1] || '');
    if (cInitial === qMeta.firstInitial) score += 10;
    if (cSurname === qMeta.surname) score += 15;
  }

  return score;
}

function pickBestPlayerMatch(queryName: string, entries: PlayerIndexEntry[]): PlayerIndexEntry | null {
  const q = normalizeName(queryName);
  if (!q) return null;

  const exact = entries.find((e) => normalizeName(e.name) === q || normalizeHrefSlugName(e.href) === q);
  if (exact) return exact;

  const contains = entries.find((e) => (
    entryMatchesQuery(e, q)
    || q.includes(normalizeName(e.name))
    || q.includes(normalizeHrefSlugName(e.href))
  ));
  if (contains) return contains;

  const qParts = q.split(' ').filter(Boolean);
  if (qParts.length >= 2) {
    const loose = entries.find((e) => {
      const n = normalizeName(e.name);
      const s = normalizeHrefSlugName(e.href);
      return qParts.every((p) => n.includes(p) || s.includes(p));
    });
    if (loose) return loose;
  }

  // AFLTables sometimes stores first names as initials; match on initial + surname.
  const initialSurname = entries.find((e) => (
    initialSurnameMatches(queryName, e.name) || initialSurnameMatches(queryName, normalizeHrefSlugName(e.href))
  ));
  if (initialSurname) return initialSurname;

  return null;
}

function toTitleToken(token: string): string {
  if (!token) return '';
  const lower = token.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function buildDirectPlayerPageCandidates(queryName: string): string[] {
  const rawTokens = queryName
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Za-z-]/g, ''))
    .filter(Boolean);

  if (rawTokens.length < 2) return [];

  const fullNameCandidates = new Set<string>();
  const maxCombos = 120;
  const tokenSets: string[][] = [rawTokens];

  // Handle names like "Bailey J Williams" by dropping middle initials.
  if (rawTokens.length >= 3) {
    const withoutInitials = rawTokens.filter((t, idx) => (
      idx === 0 || idx === rawTokens.length - 1 || t.replace(/[^A-Za-z]/g, '').length > 1
    ));
    if (withoutInitials.length >= 2 && withoutInitials.length !== rawTokens.length) {
      tokenSets.push(withoutInitials);
    }
  }

  const buildFromTokenSet = (tokens: string[]) => {
    const tokenVariants = tokens.map((token, idx) => {
      const variants = new Set<string>();
      const cleaned = token.replace(/[^A-Za-z-]/g, '');
      if (!cleaned) return [] as string[];

      // Keep original token as typed (important for surnames like McCreery).
      variants.add(cleaned);
      variants.add(toTitleToken(cleaned));

      // Handle small spelling variants like Connor -> Conor.
      const collapsedDoubles = cleaned.replace(/([A-Za-z])\1/g, '$1');
      if (collapsedDoubles && collapsedDoubles !== cleaned) {
        variants.add(collapsedDoubles);
        variants.add(toTitleToken(collapsedDoubles));
      }

      if (cleaned.includes('-')) {
        const parts = cleaned.split('-').filter(Boolean);
        variants.add(parts.join('-'));
        variants.add(parts.map(toTitleToken).join('-'));
        variants.add(parts.join(''));
        variants.add(parts.map(toTitleToken).join(''));
        variants.add(parts.join('_'));
        variants.add(parts.map(toTitleToken).join('_'));
      }

      // First token may appear as initial on AFLTables.
      if (idx === 0 && cleaned.length > 0) {
        variants.add(cleaned.charAt(0).toUpperCase());
      }

      return Array.from(variants).filter(Boolean);
    });

    const build = (i: number, acc: string[]) => {
      if (fullNameCandidates.size >= maxCombos) return;
      if (i >= tokenVariants.length) {
        if (acc.length >= 2) fullNameCandidates.add(acc.join('_'));
        return;
      }
      for (const v of tokenVariants[i]) {
        build(i + 1, [...acc, v]);
        if (fullNameCandidates.size >= maxCombos) return;
      }
    };

    build(0, []);
  };

  for (const tokenSet of tokenSets) {
    buildFromTokenSet(tokenSet);
    if (fullNameCandidates.size >= maxCombos) break;
  }

  const urls: string[] = [];
  for (const name of fullNameCandidates) {
    const first = name.charAt(0).toUpperCase();
    if (!first) continue;
    urls.push(`${AFL_TABLES_BASE}/afl/stats/players/${first}/${name}.html`);
    // AFLTables may suffix duplicate names with numbers (e.g. _0, _1, _2).
    for (let i = 0; i <= 5; i++) {
      urls.push(`${AFL_TABLES_BASE}/afl/stats/players/${first}/${name}${i}.html`);
    }
  }
  return Array.from(new Set(urls));
}

async function resolveDirectPlayerPage(queryName: string): Promise<PlayerIndexEntry | null> {
  const candidates = buildDirectPlayerPageCandidates(queryName);
  for (const url of candidates) {
    try {
      const res = await fetch(url, { next: { revalidate: 60 * 60 } });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html || !html.includes('AFL Tables')) continue;
      return { name: queryName.trim(), href: url };
    } catch {
      // Try next candidate URL.
    }
  }
  return null;
}

async function findBestSeasonCandidate(
  queryName: string,
  season: number,
  entries: PlayerIndexEntry[]
): Promise<{ match: PlayerIndexEntry; allGames: GameLogRow[] } | null> {
  const qMeta = queryInitialAndSurname(queryName);
  const surnameMatchesUrl = (url: string): boolean => {
    if (!qMeta) return true;
    const slugParts = normalizeHrefSlugName(url).split(' ').filter(Boolean);
    const last = normalizeTokenForCompare(slugParts[slugParts.length - 1] || '');
    return !!last && (last === qMeta.surname || last.startsWith(qMeta.surname) || qMeta.surname.startsWith(last));
  };

  const scoredEntries = entries
    .map((e) => ({ entry: e, score: candidateScoreForQuery(queryName, e) }))
    .filter((x) => x.score >= 20)
    .filter((x) => surnameMatchesUrl(x.entry.href))
    .sort((a, b) => b.score - a.score)
    .slice(0, 35)
    .map((x) => x.entry);

  const directCandidates = buildDirectPlayerPageCandidates(queryName)
    .filter((url) => surnameMatchesUrl(url))
    .slice(0, 35);

  const urlToName = new Map<string, string>();
  for (const entry of scoredEntries) {
    urlToName.set(entry.href, entry.name || queryName.trim());
  }
  for (const url of directCandidates) {
    if (!urlToName.has(url)) urlToName.set(url, queryName.trim());
  }

  let best: { match: PlayerIndexEntry; allGames: GameLogRow[]; seasonCount: number; totalCount: number } | null = null;

  for (const [url, name] of urlToName.entries()) {
    try {
      const expectedSurname = qMeta?.surname;
      const logs = await fetchPlayerGameLogs(url, expectedSurname);
      if (!logs.length) continue;
      const seasonCount = logs.filter((g) => g.season === season).length;
      const totalCount = logs.length;
      if (!best) {
        best = { match: { name, href: url }, allGames: logs, seasonCount, totalCount };
        continue;
      }
      if (seasonCount > best.seasonCount) {
        best = { match: { name, href: url }, allGames: logs, seasonCount, totalCount };
        continue;
      }
      if (seasonCount === best.seasonCount && totalCount > best.totalCount) {
        best = { match: { name, href: url }, allGames: logs, seasonCount, totalCount };
      }
    } catch {
      // Ignore bad candidates and continue.
    }
  }

  if (!best) return null;
  return { match: best.match, allGames: best.allGames };
}

function toGameLogRow(cells: { text: string; raw: string }[], season: number): GameLogRow | null {
  if (cells.length < 28) return null;
  if (!/^\d+$/.test(cells[0].text)) return null;

  const opponentHrefMatch = cells[1].raw.match(/href=['"]([^'"]+)['"]/i);
  const matchUrl = opponentHrefMatch
    ? opponentHrefMatch[1].startsWith('http')
      ? opponentHrefMatch[1]
      : `${AFL_TABLES_BASE}${opponentHrefMatch[1]}`
    : null;

  return {
    season,
    game_number: parseIntSafe(cells[0].text),
    opponent: cells[1].text,
    round: cells[2].text,
    result: cells[3].text,
    guernsey: cells[4].text ? parseIntSafe(cells[4].text) : null,
    kicks: parseIntSafe(cells[5].text),
    marks: parseIntSafe(cells[6].text),
    handballs: parseIntSafe(cells[7].text),
    disposals: parseIntSafe(cells[8].text),
    goals: parseIntSafe(cells[9].text),
    behinds: parseIntSafe(cells[10].text),
    hitouts: parseIntSafe(cells[11].text),
    tackles: parseIntSafe(cells[12].text),
    rebounds: parseIntSafe(cells[13].text),
    inside_50s: parseIntSafe(cells[14].text),
    clearances: parseIntSafe(cells[15].text),
    clangers: parseIntSafe(cells[16].text),
    free_kicks_for: parseIntSafe(cells[17].text),
    free_kicks_against: parseIntSafe(cells[18].text),
    brownlow_votes: parseIntSafe(cells[19].text),
    contested_possessions: parseIntSafe(cells[20].text),
    uncontested_possessions: parseIntSafe(cells[21].text),
    contested_marks: parseIntSafe(cells[22].text),
    marks_inside_50: parseIntSafe(cells[23].text),
    one_percenters: parseIntSafe(cells[24].text),
    bounces: parseIntSafe(cells[25].text),
    goal_assists: parseIntSafe(cells[26].text),
    percent_played: parsePercent(cells[27].text),
    match_url: matchUrl,
  };
}

async function fetchPlayerGameLogs(playerPageUrl: string): Promise<GameLogRow[]> {
  return fetchPlayerGameLogsWithValidation(playerPageUrl);
}

async function fetchPlayerGameLogsWithValidation(
  playerPageUrl: string,
  expectedSurname?: string
): Promise<GameLogRow[]> {
  const cached = playerPageCache.get(playerPageUrl);
  if (cached && cached.expiresAt > Date.now()) {
    if (expectedSurname && cached.titleNorm && !cached.titleNorm.includes(expectedSurname)) return [];
    return cached.data;
  }

  const res = await fetch(playerPageUrl, { next: { revalidate: 60 * 60 } });
  if (!res.ok) {
    throw new Error(`Failed to fetch player page (${res.status})`);
  }
  const html = await res.text();
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const titleNorm = titleMatch ? normalizeName(htmlToText(titleMatch[1])) : '';
  if (expectedSurname && titleNorm && !titleNorm.includes(expectedSurname)) {
    playerPageCache.set(playerPageUrl, { expiresAt: Date.now() + TTL_MS, data: [], titleNorm });
    return [];
  }

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const allRows: string[] = [];
  let rowMatch: RegExpExecArray | null = rowRegex.exec(html);
  while (rowMatch) {
    allRows.push(rowMatch[1]);
    rowMatch = rowRegex.exec(html);
  }

  const logs: GameLogRow[] = [];
  let currentSeason: number | null = null;
  let inGameTable = false;

  for (const rowHtml of allRows) {
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: { text: string; raw: string }[] = [];
    let c: RegExpExecArray | null = cellRegex.exec(rowHtml);
    while (c) {
      cells.push({ raw: c[1], text: htmlToText(c[1]) });
      c = cellRegex.exec(rowHtml);
    }
    if (cells.length === 0) continue;

    // Season marker row pattern like "Richmond - 2007"
    const fullRowText = htmlToText(rowHtml);
    const seasonMarker = fullRowText.match(/-\s*(19|20)\d{2}$/);
    if (seasonMarker) {
      const year = parseInt(fullRowText.slice(-4), 10);
      if (Number.isFinite(year)) currentSeason = year;
      inGameTable = false;
      continue;
    }

    // Header row for game logs.
    if (cells[0].text === 'Gm' && cells[1]?.text === 'Opponent') {
      inGameTable = true;
      continue;
    }

    if (!inGameTable || !currentSeason) continue;
    if (cells[0].text === 'Totals' || cells[0].text === 'Averages') continue;

    const row = toGameLogRow(cells, currentSeason);
    if (row) logs.push(row);
  }

  playerPageCache.set(playerPageUrl, { expiresAt: Date.now() + TTL_MS, data: logs, titleNorm });
  return logs;
}

export async function GET(request: NextRequest) {
  const seasonParam = request.nextUrl.searchParams.get('season');
  const playerNameParam = request.nextUrl.searchParams.get('player_name');

  const season = seasonParam ? parseInt(seasonParam, 10) : null;
  if (!season || Number.isNaN(season)) {
    return NextResponse.json({ error: 'season query param is required (e.g. 2025)' }, { status: 400 });
  }
  if (!playerNameParam || !playerNameParam.trim()) {
    return NextResponse.json({ error: 'player_name query param is required' }, { status: 400 });
  }

  try {
    const playersIndex = await fetchPlayersIndex();
    let matched = pickBestPlayerMatch(playerNameParam, playersIndex);
    if (!matched) {
      matched = await resolveDirectPlayerPage(playerNameParam);
    }
    if (!matched) {
      return NextResponse.json(
        { error: `No AFLTables player page found for '${playerNameParam}'`, season, games: [] },
        { status: 404 }
      );
    }

    const expectedSurname = queryInitialAndSurname(playerNameParam)?.surname;
    let allGames = await fetchPlayerGameLogsWithValidation(matched.href, expectedSurname);
    let games = allGames.filter((g) => g.season === season);

    // If matched profile has no games for requested season, try alternate candidates.
    if (games.length === 0) {
      const bestAlt = await findBestSeasonCandidate(playerNameParam, season, playersIndex);
      if (bestAlt) {
        matched = bestAlt.match;
        allGames = bestAlt.allGames;
        games = allGames.filter((g) => g.season === season);
      }
    }

    return NextResponse.json({
      season,
      source: 'afltables.com',
      player_name: matched.name,
      player_page: matched.href,
      games,
      game_count: games.length,
    });
  } catch (err) {
    console.error('[AFL player-game-logs]', err);
    return NextResponse.json(
      {
        error: 'Failed to fetch AFL game logs',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}

