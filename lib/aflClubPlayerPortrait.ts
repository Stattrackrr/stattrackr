/**
 * Fetch official AFL club (Telstra tenant) player headshots by scraping public squad + profile pages.
 * Same pages users see on club sites, e.g. westcoasteagles.com.au/teams/afl → /players/956/liam-duggan
 */

import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';
import { normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';

const FETCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 StatTrackr/1';
const FETCH_TIMEOUT_MS = 8000;

/** NMFC lists players under `/teams/afl/players`; `/teams/afl/squad` 404s on some tenants. */
/** Richmond (and potentially others) expose roster at `/players` instead of `/teams/afl/*`. */
const SQUAD_PATHS = ['/teams/afl', '/teams/afl/squad', '/teams/afl/players', '/players', '/players/'] as const;

/** Official roster display name → club site origin (AFL tenant squad pages). */
export const OFFICIAL_TEAM_TO_CLUB_ORIGIN: Record<string, string> = {
  'Adelaide Crows': 'https://www.afc.com.au',
  'Brisbane Lions': 'https://www.lions.com.au',
  'Carlton Blues': 'https://www.carltonfc.com.au',
  'Collingwood Magpies': 'https://www.collingwoodfc.com.au',
  'Essendon Bombers': 'https://www.essendonfc.com.au',
  'Fremantle Dockers': 'https://www.fremantlefc.com.au',
  'Geelong Cats': 'https://www.geelongcats.com.au',
  'Gold Coast Suns': 'https://www.goldcoastfc.com.au',
  'GWS Giants': 'https://www.gwsgiants.com.au',
  'Hawthorn Hawks': 'https://www.hawthornfc.com.au',
  'Melbourne Demons': 'https://www.melbournefc.com.au',
  'North Melbourne Kangaroos': 'https://www.nmfc.com.au',
  'Port Adelaide Power': 'https://www.portadelaidefc.com.au',
  'Richmond Tigers': 'https://www.richmondfc.com.au',
  'St Kilda Saints': 'https://www.saints.com.au',
  'Sydney Swans': 'https://www.sydneyswans.com.au',
  'West Coast Eagles': 'https://www.westcoasteagles.com.au',
  'Western Bulldogs': 'https://www.westernbulldogs.com.au',
};

type SquadRow = { href: string; displayName: string; slug: string };
type ClubApiEnv = { apiBase: string; playerImageBase: string; seasonYear: string };

const squadHtmlCache = new Map<string, { html: string; expiresAt: number }>();
const SQUAD_TTL_MS = 60 * 60 * 1000;
const CLUB_API_PLAYER_MAP_TTL_MS = 6 * 60 * 60 * 1000;
const CLUB_API_WARM_PAGES = 20;
const CLUB_API_PAGE_SIZE = 100;
const CLUB_API_SEARCH_PAGE_BATCH = 8;
const clubApiPlayerMapCache = new Map<string, { expiresAt: number; byName: Map<string, string> }>();
const clubApiNameCandidatesCache = new Map<string, { expiresAt: number; ids: string[] }>();
const IMAGE_URL_OK_TTL_MS = 24 * 60 * 60 * 1000;
const IMAGE_URL_MISS_TTL_MS = 30 * 60 * 1000;
const imageUrlStatusCache = new Map<string, { ok: boolean; expiresAt: number }>();

function clubOriginForTeam(teamInput: string | null | undefined): string | null {
  if (!teamInput?.trim()) return null;
  const official = toOfficialAflTeamDisplayName(teamInput.trim());
  return OFFICIAL_TEAM_TO_CLUB_ORIGIN[official] ?? null;
}

function parseSquadPlayers(html: string): SquadRow[] {
  const out: SquadRow[] = [];
  const re =
    /<a class="player-item[^"]*" href="(\/players\/\d+\/[^"]+)">[\s\S]*?<h1 class="player-item__name">\s*([^<]*?)\s*<span class="player-item__last-name">\s*([^<]+?)\s*<\/span>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const first = m[2].replace(/\s+/g, ' ').trim();
    const last = m[3].replace(/\s+/g, ' ').trim();
    const displayName = `${first} ${last}`.trim();
    const slug = href.split('/').pop() ?? '';
    if (href && displayName) out.push({ href, displayName, slug });
  }
  if (out.length > 0) return out;

  // Fallback for club templates that no longer use `player-item` markup (e.g. some Richmond pages).
  // We only need href + slug for matching; displayName can be derived from slug when not present.
  const byHref = new Map<string, SquadRow>();
  const genericRe = /<a\b[^>]*\bhref="(\/players\/\d+\/[^"]+)"[^>]*>/gi;
  let gm: RegExpExecArray | null;
  while ((gm = genericRe.exec(html)) !== null) {
    const href = gm[1];
    const slug = href.split('/').pop() ?? '';
    const displayName = slug.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    if (!href || !slug) continue;
    if (!byHref.has(href)) byHref.set(href, { href, displayName, slug });
  }
  return [...byHref.values()];
}

function slugToNorm(slug: string): string {
  return normalizeAflPlayerNameForMatch(slug.replace(/-/g, ' '));
}

function findPlayerHref(rows: SquadRow[], playerName: string): string | null {
  const target = normalizeAflPlayerNameForMatch(playerName);
  if (!target) return null;

  for (const r of rows) {
    if (normalizeAflPlayerNameForMatch(r.displayName) === target) return r.href;
  }
  for (const r of rows) {
    if (slugToNorm(r.slug) === target) return r.href;
  }
  return null;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': FETCH_UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': FETCH_UA, Accept: 'application/json,text/plain,*/*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

async function isReachableImageUrl(url: string): Promise<boolean> {
  const hit = imageUrlStatusCache.get(url);
  if (hit && hit.expiresAt > Date.now()) return hit.ok;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': FETCH_UA, Accept: 'image/*,*/*;q=0.8' },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    const ok = res.ok && ct.startsWith('image/');
    imageUrlStatusCache.set(url, {
      ok,
      expiresAt: Date.now() + (ok ? IMAGE_URL_OK_TTL_MS : IMAGE_URL_MISS_TTL_MS),
    });
    return ok;
  } catch {
    imageUrlStatusCache.set(url, { ok: false, expiresAt: Date.now() + IMAGE_URL_MISS_TTL_MS });
    return false;
  }
}

function parseClubApiEnv(html: string): ClubApiEnv | null {
  const apiM = html.match(/"api"\s*:\s*"(\/\/[^"]*\/afl\/v2\/)"/i);
  const pathM = html.match(/"playerImagePath"\s*:\s*"(\/\/[^"]+)"/i);
  const seasonM = html.match(/CD_S(\d{4})\d+/);
  if (!apiM?.[1] || !pathM?.[1]) return null;
  const apiBase = `https:${apiM[1]}`.replace(/([^:]\/)\/+/g, '$1');
  const playerImageBase = `https:${pathM[1]}`.replace(/([^:]\/)\/+/g, '$1').replace(/\/+$/, '');
  const seasonYear = seasonM?.[1] ?? String(new Date().getFullYear());
  return { apiBase, playerImageBase, seasonYear };
}

function canUseClubApiFallback(html: string): boolean {
  return parseClubApiEnv(html) != null;
}

function addPlayersToMap(byName: Map<string, string>, json: unknown): void {
  const players = Array.isArray((json as { players?: unknown })?.players)
    ? ((json as { players: unknown[] }).players)
    : [];
  for (const p of players) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const first = String(o.firstName ?? '').trim();
    const last = String(o.surname ?? '').trim();
    const idRaw = o.id;
    const id = idRaw != null ? String(idRaw).trim() : '';
    if (!first || !last || !id) continue;
    const norm = normalizeAflPlayerNameForMatch(`${first} ${last}`);
    if (!norm) continue;
    if (!byName.has(norm)) byName.set(norm, id);
  }
}

async function loadClubApiRecentPlayerMap(apiBase: string): Promise<Map<string, string>> {
  const hit = clubApiPlayerMapCache.get(apiBase);
  if (hit && hit.expiresAt > Date.now()) return hit.byName;

  const byName = new Map<string, string>();
  const first = await fetchJson(`${apiBase}players?page=0&pageSize=${CLUB_API_PAGE_SIZE}`);
  if (!first) return byName;
  addPlayersToMap(byName, first);

  const numPagesRaw = (first as { meta?: { pagination?: { numPages?: unknown } } })?.meta?.pagination?.numPages;
  const numPages = Number.isFinite(Number(numPagesRaw)) ? Number(numPagesRaw) : 1;
  const endPage = Math.min(Math.max(0, numPages - 1), CLUB_API_WARM_PAGES - 1);
  for (let page = 1; page <= endPage; page++) {
    if (page === 0) continue;
    const json = await fetchJson(`${apiBase}players?page=${page}&pageSize=${CLUB_API_PAGE_SIZE}`);
    if (!json) continue;
    addPlayersToMap(byName, json);
  }

  clubApiPlayerMapCache.set(apiBase, {
    byName,
    expiresAt: Date.now() + CLUB_API_PLAYER_MAP_TTL_MS,
  });
  return byName;
}

async function findPlayerIdInClubApi(apiBase: string, targetNameNorm: string): Promise<string | null> {
  const first = await fetchJson(`${apiBase}players?page=0&pageSize=${CLUB_API_PAGE_SIZE}`);
  if (!first) return null;

  const cacheHit = clubApiPlayerMapCache.get(apiBase);
  const byName = cacheHit?.byName ?? new Map<string, string>();
  addPlayersToMap(byName, first);
  if (byName.has(targetNameNorm)) {
    const found = byName.get(targetNameNorm) ?? null;
    clubApiPlayerMapCache.set(apiBase, { byName, expiresAt: Date.now() + CLUB_API_PLAYER_MAP_TTL_MS });
    return found;
  }

  const numPagesRaw = (first as { meta?: { pagination?: { numPages?: unknown } } })?.meta?.pagination?.numPages;
  const numPages = Number.isFinite(Number(numPagesRaw)) ? Number(numPagesRaw) : 1;
  const lastPage = Math.max(0, numPages - 1);
  const startPage = Math.min(CLUB_API_WARM_PAGES, lastPage);
  const pages: number[] = [];
  for (let page = startPage; page <= lastPage; page++) pages.push(page);
  for (let i = 0; i < pages.length; i += CLUB_API_SEARCH_PAGE_BATCH) {
    const batch = pages.slice(i, i + CLUB_API_SEARCH_PAGE_BATCH);
    const payloads = await Promise.all(
      batch.map(async (page) => fetchJson(`${apiBase}players?page=${page}&pageSize=${CLUB_API_PAGE_SIZE}`))
    );
    for (const json of payloads) {
      if (!json) continue;
      addPlayersToMap(byName, json);
    }
    if (byName.has(targetNameNorm)) {
      const found = byName.get(targetNameNorm) ?? null;
      clubApiPlayerMapCache.set(apiBase, { byName, expiresAt: Date.now() + CLUB_API_PLAYER_MAP_TTL_MS });
      return found;
    }
  }

  clubApiPlayerMapCache.set(apiBase, { byName, expiresAt: Date.now() + CLUB_API_PLAYER_MAP_TTL_MS });
  return null;
}

function collectCandidateIds(json: unknown, targetNameNorm: string, ids: Set<string>): void {
  const players = Array.isArray((json as { players?: unknown })?.players)
    ? ((json as { players: unknown[] }).players)
    : [];
  for (const p of players) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const first = String(o.firstName ?? '').trim();
    const last = String(o.surname ?? '').trim();
    const idRaw = o.id;
    const id = idRaw != null ? String(idRaw).trim() : '';
    if (!first || !last || !id) continue;
    const norm = normalizeAflPlayerNameForMatch(`${first} ${last}`);
    if (!norm) continue;
    if (norm === targetNameNorm) ids.add(id);
  }
}

async function findCandidatePlayerIdsInClubApi(apiBase: string, targetNameNorm: string): Promise<string[]> {
  const ck = `${apiBase}|${targetNameNorm}`;
  const hit = clubApiNameCandidatesCache.get(ck);
  if (hit && hit.expiresAt > Date.now()) return hit.ids;

  const first = await fetchJson(`${apiBase}players?page=0&pageSize=${CLUB_API_PAGE_SIZE}`);
  if (!first) return [];
  const ids = new Set<string>();
  collectCandidateIds(first, targetNameNorm, ids);

  const numPagesRaw = (first as { meta?: { pagination?: { numPages?: unknown } } })?.meta?.pagination?.numPages;
  const numPages = Number.isFinite(Number(numPagesRaw)) ? Number(numPagesRaw) : 1;
  const lastPage = Math.max(0, numPages - 1);
  const pages: number[] = [];
  for (let page = 1; page <= lastPage; page++) pages.push(page);
  for (let i = 0; i < pages.length; i += CLUB_API_SEARCH_PAGE_BATCH) {
    const batch = pages.slice(i, i + CLUB_API_SEARCH_PAGE_BATCH);
    const payloads = await Promise.all(
      batch.map(async (page) => fetchJson(`${apiBase}players?page=${page}&pageSize=${CLUB_API_PAGE_SIZE}`))
    );
    for (const json of payloads) {
      if (!json) continue;
      collectCandidateIds(json, targetNameNorm, ids);
    }
  }
  const out = [...ids];
  clubApiNameCandidatesCache.set(ck, { ids: out, expiresAt: Date.now() + CLUB_API_PLAYER_MAP_TTL_MS });
  return out;
}

async function resolveClubApiPlayerId(playerName: string, squadHtml: string): Promise<{ env: ClubApiEnv; playerId: string } | null> {
  const env = parseClubApiEnv(squadHtml);
  if (!env) return null;
  const target = normalizeAflPlayerNameForMatch(playerName);
  if (!target) return null;

  const byName = await loadClubApiRecentPlayerMap(env.apiBase);
  let playerId = byName.get(target) ?? null;
  if (!playerId) {
    const [firstTarget = '', lastTarget = ''] = target.split(/\s+/);
    if (!firstTarget || !lastTarget) return null;
    for (const [nameNorm, id] of byName.entries()) {
      const [first = '', last = ''] = nameNorm.split(/\s+/);
      if (!first || !last) continue;
      if (last === lastTarget && first[0] === firstTarget[0]) {
        playerId = id;
        break;
      }
    }
  }
  if (!playerId) {
    playerId = await findPlayerIdInClubApi(env.apiBase, target);
  }
  if (!playerId) return null;

  return { env, playerId };
}

async function resolveHeadshotViaClubApi(
  playerName: string,
  squadHtml: string,
  origin?: string
): Promise<string | null> {
  const resolved = await resolveClubApiPlayerId(playerName, squadHtml);
  if (!resolved) return null;
  const { env, playerId } = resolved;

  const targetNorm = normalizeAflPlayerNameForMatch(playerName);

  if (origin && targetNorm) {
    const tryProfileId = async (id: string): Promise<string | null> => {
      const slug = targetNorm.replace(/\s+/g, '-');
      const profileUrl = `${origin.replace(/\/$/, '')}/players/${id}/${slug}`;
      const profileHtml = await fetchText(profileUrl);
      if (!profileHtml) return null;
      return extractHeadshotFromProfileHtml(profileHtml);
    };

    const tried = new Set<string>();
    const firstTry = await tryProfileId(playerId);
    tried.add(playerId);
    if (firstTry) return firstTry;

    const candidates = await findCandidatePlayerIdsInClubApi(env.apiBase, targetNorm);
    for (const id of candidates) {
      if (!id || tried.has(id)) continue;
      const hit = await tryProfileId(id);
      if (hit) return hit;
      tried.add(id);
    }
  }

  const champUrl = `${env.playerImageBase}/AFL/${env.seasonYear}/${playerId}.png?im=Scale,width=708,height=708`;
  if (await isReachableImageUrl(champUrl)) return champUrl;

  return null;
}

/**
 * Telstra club sites inject `playerImagePath` + `js-player-image` + squad season id; the hero PNG is
 * served from s.afl.com.au ChampIDImages (see PULSE.common PlayerHeadshot → getCompetitionPlayerImage).
 */
function extractTelstraChampIdHeadshotUrl(html: string): string | null {
  const pathM = html.match(/"playerImagePath"\s*:\s*"(\/\/[^"]+)"/);
  const basePath = pathM?.[1];
  if (!basePath) return null;

  let seasonRaw: string | null = null;
  const scriptSeason = html.match(
    /\.js-player-squad-compseason-pid'\)\s*\.\s*value\s*=\s*"(CD_S\d+)"/
  );
  if (scriptSeason?.[1]) seasonRaw = scriptSeason[1];
  if (!seasonRaw) {
    const inputSeason = html.match(
      /class="[^"]*js-player-squad-compseason-pid[^"]*"[^>]*\svalue="(CD_S\d+)"/i
    );
    if (inputSeason?.[1]) seasonRaw = inputSeason[1];
  }
  if (!seasonRaw?.startsWith('CD_S')) return null;
  const seasonDigits = seasonRaw.replace(/^CD_S/, '');

  const headIdx = html.indexOf('player__headshot');
  const headBlock = headIdx !== -1 ? html.slice(headIdx, headIdx + 2000) : html;
  const playerM =
    headBlock.match(/class="js-player-image"[^>]*\sdata-player="(\d+)"/) ??
    headBlock.match(/data-player="(\d+)"[^>]*\sclass="js-player-image"/) ??
    html.match(/class="js-player-image"[^>]*\sdata-player="(\d+)"/) ??
    html.match(/data-player="(\d+)"[^>]*\sclass="js-player-image"/);
  const playerId = playerM?.[1];
  if (!playerId) return null;

  const compAbbr = 'AFL';
  const q = '?im=Scale,width=708,height=708';
  return `https:${basePath}/${compAbbr}/${seasonDigits}/${playerId}.png${q}`;
}

async function extractHeadshotFromProfileHtml(html: string): Promise<string | null> {
  // Prefer AFL ChampID static URLs (s.afl.com.au) for every Telstra tenant. Club `resources.*.com.au`
  // photo-resources URLs often 403 or fail in-browser when used as <img src> on another origin; NMFC
  // only “worked” first because the hero has no SSR img and we already fell through to ChampID.
  const champ = extractTelstraChampIdHeadshotUrl(html);
  if (champ && await isReachableImageUrl(champ)) return champ;

  const marker = 'player__headshot';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const sliceEnd = Math.min(idx + 4500, html.length);
  const slice = html.slice(idx, sliceEnd);
  const imgTags = slice.match(/<img\b[^>]*>/gi) ?? [];
  for (const tag of imgTags) {
    if (!tag.includes('object-fit-cover-picture__img')) continue;
    const sm = tag.match(/\ssrc="([^"]+)"/i);
    if (sm?.[1]?.includes('photo-resources')) {
      const photo = sm[1].replace(/&amp;/g, '&');
      if (await isReachableImageUrl(photo)) return photo;
    }
  }
  const loose = slice.match(
    /src="(https:\/\/resources\.[^"]+photo-resources[^"]+\.(?:jpe?g|png|webp|gif)[^"]*)"/i
  );
  const looseUrl = loose?.[1]?.replace(/&amp;/g, '&') ?? null;
  if (looseUrl && await isReachableImageUrl(looseUrl)) return looseUrl;
  return null;
}

async function getSquadHtml(origin: string): Promise<string | null> {
  const base = origin.replace(/\/$/, '');
  for (const path of SQUAD_PATHS) {
    const squadUrl = `${base}${path}`;
    const ck = squadUrl;
    const hit = squadHtmlCache.get(ck);
    if (hit && hit.expiresAt > Date.now()) {
      if (parseSquadPlayers(hit.html).length > 0 || canUseClubApiFallback(hit.html)) return hit.html;
      continue;
    }

    const html = await fetchText(squadUrl);
    if (!html) continue;
    squadHtmlCache.set(ck, { html, expiresAt: Date.now() + SQUAD_TTL_MS });
    if (parseSquadPlayers(html).length > 0 || canUseClubApiFallback(html)) return html;
  }
  return null;
}

/**
 * Headshot image URL from the player’s AFL club site, or null if not found.
 */
export async function fetchClubSitePortraitUrl(
  playerName: string,
  team?: string | null
): Promise<string | null> {
  const origin = clubOriginForTeam(team ?? '');
  if (!origin) return null;

  const squadHtml = await getSquadHtml(origin);
  if (!squadHtml) return null;

  const rows = parseSquadPlayers(squadHtml);
  if (rows.length === 0) {
    return resolveHeadshotViaClubApi(playerName, squadHtml, origin);
  }

  const href = findPlayerHref(rows, playerName);
  if (!href) {
    return resolveHeadshotViaClubApi(playerName, squadHtml, origin);
  }

  const profileUrl = `${origin.replace(/\/$/, '')}${href}`;
  const profileHtml = await fetchText(profileUrl);
  if (profileHtml) {
    const fromProfile = await extractHeadshotFromProfileHtml(profileHtml);
    if (fromProfile) return fromProfile;
  }

  return resolveHeadshotViaClubApi(playerName, squadHtml, origin);
}
