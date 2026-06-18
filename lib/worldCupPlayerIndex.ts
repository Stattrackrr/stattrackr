/**
 * World Cup master player index.
 *
 * Combines every player across the three competitions we treat as one
 * ("World Cup" umbrella):
 *   - World Cup  -> BalldontLie FIFA API (`/players`, seasons 2018/2022/2026)
 *   - Euros      -> Supabase `international_players` (source = statsbomb)
 *   - Nations League -> Supabase `international_players` (source = api-football)
 *
 * Players are matched by a normalized name so the same person from different
 * sources collapses into a single entry. The built index is stored permanently
 * in `world_cup_cache` so player search can be served entirely from Supabase
 * without ever calling the BDL API.
 */

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getWorldCupCache, setWorldCupCache } from '@/lib/worldCupCache';
import { getWorldCupNameAliases, resolveWorldCupAliasName, formatWorldCupPlayerDisplayName } from '@/lib/worldCupPlayerAliases';
import { resolveWorldCupFlagCode, worldCupTeamsMatch } from '@/lib/worldCupFlags';

export type WorldCupIndexCompetition = 'world-cup' | 'euros' | 'nations-league';

/** A single source contribution to a merged player entry. */
export type WorldCupPlayerIndexSource = {
  competition: WorldCupIndexCompetition;
  /** 'bdl' | 'statsbomb' | 'api-football' */
  source: string;
  id: string;
  position: string | null;
  countryName: string | null;
  countryCode: string | null;
  jerseyNumber: number | null;
};

/** One unique player, merged across every competition they appear in. */
export type WorldCupPlayerIndexEntry = {
  name: string;
  normalizedName: string;
  shortName: string;
  sources: WorldCupPlayerIndexSource[];
};

/** Shape returned to the player-search endpoint (mirrors the legacy response). */
export type WorldCupPlayerSearchResult = {
  id: string;
  name: string;
  short_name: string;
  position: string | null;
  country_name: string;
  country_code: string | null;
  jersey_number: number | null;
  source: string;
  competition: WorldCupIndexCompetition;
};

export const WORLD_CUP_PLAYER_INDEX_CACHE_KEY = 'wc:player-index:v1';

const BDL_FIFA_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';
/** "This World Cup" — only the current tournament squad is searchable. */
export const CURRENT_WORLD_CUP_SEASONS = ['2026'];
/** Used only as a fallback if the current squad isn't published by BDL yet. */
export const ALL_WORLD_CUP_SEASONS = ['2018', '2022', '2026'];

const SPECIAL_LETTER_MAP: Record<string, string> = {
  '\u00f8': 'o',
  '\u0153': 'oe',
  '\u00e6': 'ae',
  '\u00e5': 'a',
  '\u00df': 'ss',
  '\u00fe': 'th',
  '\u00f0': 'd',
  '\u0111': 'd',
  '\u0142': 'l',
  '\u0131': 'i',
  '\u014b': 'n',
  '\u0138': 'k',
  '\u02bb': '',
  "'": '',
};

const SPECIAL_LETTER_PATTERN = new RegExp(
  '[\\u00f8\\u0153\\u00e6\\u00e5\\u00df\\u00fe\\u00f0\\u0111\\u0142\\u0131\\u014b\\u0138\\u02bb\']',
  'g'
);

export function normalizeWorldCupPlayerName(name: string): string {
  const folded = String(name || '')
    .toLowerCase()
    .replace(SPECIAL_LETTER_PATTERN, (ch) => SPECIAL_LETTER_MAP[ch] ?? ch);
  return folded
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function worldCupPlayerNameToSlug(name: string): string {
  const normalized = normalizeWorldCupPlayerName(name);
  return normalized ? normalized.replace(/\s+/g, '-') : '';
}

export function worldCupPlayerSlugToSearchHint(slug: string): string {
  return sanitizeLineupPlayerName(slug).replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

export function worldCupPlayerSlugMatchesName(slug: string, name: string): boolean {
  const target = worldCupPlayerNameToSlug(name);
  const raw = String(slug || '').trim().toLowerCase();
  if (!target || !raw) return false;
  if (target === raw) return true;
  return target.replace(/-/g, '') === raw.replace(/-/g, '');
}

function shortNameFromFull(full: string): string {
  const parts = String(full || '').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'WC';
  if (parts.length === 1) return parts[0]!.slice(0, 3).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

function toNumberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getBdlApiKey(): string {
  return (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
}

function getAuthCandidates(apiKey: string): string[] {
  if (!apiKey) return [];
  if (apiKey.toLowerCase().startsWith('bearer ')) {
    const raw = apiKey.replace(/^bearer\s+/i, '').trim();
    return [raw, apiKey].filter(Boolean);
  }
  return [apiKey, `Bearer ${apiKey}`];
}

export type BdlPlayer = {
  id: number | string;
  name?: string;
  short_name?: string;
  position?: string | null;
  country_name?: string | null;
  country_code?: string | null;
  jersey_number?: number | string | null;
};

type BdlPlayersEnvelope = {
  data?: BdlPlayer[];
  meta?: { next_cursor?: string | number | null };
};

/** Page through every BDL World Cup player for the given seasons. */
export async function fetchAllBdlWorldCupPlayers(
  opts: { seasons: string[]; log?: (msg: string) => void }
): Promise<BdlPlayer[]> {
  const apiKey = getBdlApiKey();
  if (!apiKey) {
    opts.log?.('[player-index] No BDL API key found; skipping World Cup players.');
    return [];
  }
  const authCandidates = getAuthCandidates(apiKey);
  const collected = new Map<string, BdlPlayer>();

  let cursor: string | number | null = null;
  let page = 0;
  const maxPages = 200; // safety bound

  while (page < maxPages) {
    const url = new URL(`${BDL_FIFA_BASE}/players`);
    url.searchParams.set('per_page', '100');
    for (const season of opts.seasons) url.searchParams.append('seasons[]', season);
    if (cursor != null) url.searchParams.set('cursor', String(cursor));

    let payload: BdlPlayersEnvelope | null = null;
    for (const auth of authCandidates) {
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(url.toString(), {
            headers: { Accept: 'application/json', 'User-Agent': 'StatTrackr/1.0', Authorization: auth },
            cache: 'no-store',
          });
          if (response.ok) {
            payload = (await response.json()) as BdlPlayersEnvelope;
            break;
          }
          if (response.status === 429 && attempt < 2) {
            await new Promise((r) => setTimeout(r, 400 + attempt * 600));
            continue;
          }
          // Non-retriable for this auth candidate; try the next one.
          lastErr = new Error(`BDL players HTTP ${response.status}`);
          break;
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      if (payload) break;
      if (lastErr) opts.log?.(`[player-index] BDL auth attempt failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
    }

    if (!payload) {
      opts.log?.('[player-index] BDL players request failed for all auth candidates; stopping pagination.');
      break;
    }

    const rows = Array.isArray(payload.data) ? payload.data : [];
    for (const row of rows) {
      const id = String(row.id ?? '');
      if (id) collected.set(id, row);
    }
    page += 1;
    cursor = payload.meta?.next_cursor ?? null;
    opts.log?.(`[player-index] BDL page ${page}: +${rows.length} (total ${collected.size})`);
    if (!cursor || rows.length === 0) break;
  }

  return Array.from(collected.values());
}

export type IntlPlayerRow = {
  source: string;
  source_player_id: string;
  full_name: string;
  normalized_name: string | null;
  primary_position: string | null;
  country_code: string | null;
  bdl_player_id: number | string | null;
};

/** Read every Euros (statsbomb) + Nations League (api-football) player. */
export async function fetchAllInternationalPlayers(opts: { log?: (msg: string) => void } = {}): Promise<IntlPlayerRow[]> {
  const rows: IntlPlayerRow[] = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('international_players')
      .select('source, source_player_id, full_name, normalized_name, primary_position, country_code, bdl_player_id')
      .in('source', ['statsbomb', 'api-football'])
      .order('source_player_id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      opts.log?.(`[player-index] international_players read failed: ${error.message}`);
      break;
    }
    const page = (data ?? []) as IntlPlayerRow[];
    if (page.length === 0) break;
    rows.push(...page);
    opts.log?.(`[player-index] international page: +${page.length} (total ${rows.length})`);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

function competitionForIntlSource(source: string): WorldCupIndexCompetition {
  return source === 'statsbomb' ? 'euros' : 'nations-league';
}

/** Upsert a source contribution into the merged map (keyed by normalized name). */
function mergeSource(
  byName: Map<string, WorldCupPlayerIndexEntry>,
  displayName: string,
  normalized: string,
  source: WorldCupPlayerIndexSource
): void {
  if (!normalized) return;
  const existing = byName.get(normalized);
  if (!existing) {
    byName.set(normalized, {
      name: displayName,
      normalizedName: normalized,
      shortName: shortNameFromFull(displayName),
      sources: [source],
    });
    return;
  }
  // Avoid duplicate (competition, id) entries.
  const dup = existing.sources.some((s) => s.competition === source.competition && s.id === source.id);
  if (!dup) existing.sources.push(source);
}

/**
 * Build the searchable player index. Only players active in the current World
 * Cup (BDL squad) become searchable entries; Euros (statsbomb) and Nations
 * League (api-football) rows are matched by name and *attached* to those WC
 * players so the dashboard can merge their stats — they never create their own
 * standalone searchable entry.
 *
 * Does NOT write to cache — callers (the script) persist the result.
 */
export async function buildWorldCupPlayerIndex(
  opts: { log?: (msg: string) => void; seasons?: string[] } = {}
): Promise<WorldCupPlayerIndexEntry[]> {
  const log = opts.log;
  const seasons = opts.seasons ?? CURRENT_WORLD_CUP_SEASONS;

  let [bdlPlayers, intlPlayers] = await Promise.all([
    fetchAllBdlWorldCupPlayers({ seasons, log }),
    fetchAllInternationalPlayers({ log }),
  ]);

  // Safety net: if the current squad isn't published yet, fall back to every
  // World Cup season so search isn't empty (only when caller didn't pin seasons).
  if (!bdlPlayers.length && !opts.seasons) {
    log?.('[player-index] No current (2026) World Cup players returned — falling back to all seasons.');
    bdlPlayers = await fetchAllBdlWorldCupPlayers({ seasons: ALL_WORLD_CUP_SEASONS, log });
  }

  log?.(
    `[player-index] fetched bdl=${bdlPlayers.length} (seasons=${seasons.join('/')}) international=${intlPlayers.length}`
  );

  const byName = new Map<string, WorldCupPlayerIndexEntry>();

  // 1. World Cup players are the ONLY searchable entries.
  for (const player of bdlPlayers) {
    const name = formatWorldCupPlayerDisplayName(String(player.name || player.short_name || '').trim());
    const normalized = normalizeWorldCupPlayerName(name);
    if (!normalized) continue;
    mergeSource(byName, name, normalized, {
      competition: 'world-cup',
      source: 'bdl',
      id: String(player.id ?? ''),
      position: player.position ?? null,
      countryName: (player.country_name as string | null) ?? (player.country_code as string | null) ?? null,
      countryCode: (player.country_code as string | null) ?? null,
      jerseyNumber: toNumberOrNull(player.jersey_number),
    });
  }

  // 2. Euros + Nations League rows only attach to an existing WC player
  //    (matched by normalized name). They never add a new searchable entry.
  let attached = 0;
  for (const player of intlPlayers) {
    const name = String(player.full_name || '').trim();
    const rawNormalized = player.normalized_name?.trim() || normalizeWorldCupPlayerName(name);
    if (!rawNormalized) continue;
    // Resolve curated same-person aliases (e.g. "erling braut haaland" →
    // "erling haaland") so differently-spelled rows attach to the WC player.
    const normalized = resolveWorldCupAliasName(rawNormalized);
    const existing = byName.get(normalized);
    if (!existing) continue; // not in this World Cup → not searchable
    const source: WorldCupPlayerIndexSource = {
      competition: competitionForIntlSource(player.source),
      source: player.source,
      id: String(player.source_player_id ?? ''),
      position: player.primary_position ?? null,
      countryName: player.country_code ?? null,
      countryCode: player.country_code ?? null,
      jerseyNumber: null,
    };
    const dup = existing.sources.some((s) => s.competition === source.competition && s.id === source.id);
    if (!dup) {
      existing.sources.push(source);
      attached += 1;
    }
  }

  const entries = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  const withIntl = entries.filter((e) => e.sources.some((s) => s.competition !== 'world-cup')).length;
  log?.(
    `[player-index] ${entries.length} World Cup players searchable; ${attached} Euros/Nations-League stat sources attached across ${withIntl} of them`
  );
  return entries;
}

/** Build + persist the index permanently. Returns the entry count. */
export async function rebuildAndPersistWorldCupPlayerIndex(
  opts: { log?: (msg: string) => void } = {}
): Promise<{ count: number; persisted: boolean }> {
  const entries = await buildWorldCupPlayerIndex(opts);
  if (!entries.length) return { count: 0, persisted: false };
  const persisted = await setWorldCupCache(WORLD_CUP_PLAYER_INDEX_CACHE_KEY, entries);
  return { count: entries.length, persisted };
}

/** Read the cached index (null if it hasn't been built yet). */
export async function getWorldCupPlayerIndex(): Promise<WorldCupPlayerIndexEntry[] | null> {
  return getWorldCupCache<WorldCupPlayerIndexEntry[]>(WORLD_CUP_PLAYER_INDEX_CACHE_KEY);
}

/** Preference order for which source's id/metadata to surface for a request. */
function pickSource(
  entry: WorldCupPlayerIndexEntry,
  competition: WorldCupIndexCompetition | 'all'
): WorldCupPlayerIndexSource | null {
  if (competition !== 'all') {
    return entry.sources.find((s) => s.competition === competition) ?? null;
  }
  // 'all' → prefer BDL (full position labels), then Euros, then Nations League.
  const order: WorldCupIndexCompetition[] = ['world-cup', 'euros', 'nations-league'];
  for (const comp of order) {
    const match = entry.sources.find((s) => s.competition === comp);
    if (match) return match;
  }
  return entry.sources[0] ?? null;
}

/** Search the in-memory index, returning legacy-shaped results. */
export function searchWorldCupPlayerIndex(
  index: WorldCupPlayerIndexEntry[],
  opts: { query: string; competition: WorldCupIndexCompetition | 'all'; limit?: number }
): WorldCupPlayerSearchResult[] {
  const normalizedQuery = normalizeWorldCupPlayerName(opts.query);
  if (!normalizedQuery) return [];
  const limit = Math.min(opts.limit ?? 25, 50);

  const results: WorldCupPlayerSearchResult[] = [];
  for (const entry of index) {
    if (!entry.normalizedName.includes(normalizedQuery)) continue;
    const source = pickSource(entry, opts.competition);
    if (!source) continue; // entry doesn't exist in the requested competition
    results.push({
      id: source.id || entry.normalizedName,
      name: entry.name,
      short_name: entry.shortName,
      position: source.position,
      country_name: source.countryName || source.countryCode || '',
      country_code: source.countryCode,
      jersey_number: source.jerseyNumber,
      source: source.source,
      competition: source.competition,
    });
    if (results.length >= limit) break;
  }
  return results;
}

// ── Lineup player photos (squad caches + multi-layer resolver) ──────────────

export type WorldCupSquadPhotoCache = {
  byNormalizedName: Record<string, string>;
  bySourcePlayerId: Record<string, string>;
  byJerseyNumber?: Record<string, string>;
};

const BDL_PLAYERS_CACHE_KEY = (bdlTeamId: number | string): string => `wc:raw:players:${bdlTeamId}:v1`;
const BDL_ROSTER_CACHE_KEY = (bdlTeamId: number | string): string => `wc:raw:roster:${bdlTeamId}:v1`;

export const worldCupSquadPhotoCacheKey = (bdlTeamId: number | string): string =>
  `wc:lineup-squad-photos:${bdlTeamId}:v1`;

export const worldCupLineupPhotoByBdlPlayerCacheKey = (bdlPlayerId: number | string): string =>
  `wc:lineup-photo:bdl:${bdlPlayerId}:v1`;

export function sanitizeLineupPlayerName(name: string): string {
  return String(name || '')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .trim();
}

export function apiFootballPlayerPhotoUrl(sourcePlayerId: string, photo?: string | null): string {
  const direct = String(photo ?? '').trim();
  if (direct.startsWith('http')) return direct;
  return `https://media.api-sports.io/football/players/${sourcePlayerId}.png`;
}

function lineupPhotoNameKeys(rawName: string): string[] {
  const sanitized = sanitizeLineupPlayerName(rawName);
  const normalized = normalizeWorldCupPlayerName(sanitized);
  const keys = new Set<string>();
  if (normalized) keys.add(normalized);

  const raw = sanitized;
  if (raw.includes('-')) {
    keys.add(normalized.replace(/ /g, '-'));
    keys.add(normalized.replace(/ /g, ''));
    for (const token of raw.split(/\s+/)) {
      if (!token.includes('-')) continue;
      keys.add(normalizeWorldCupPlayerName(token));
      keys.add(normalizeWorldCupPlayerName(token.replace(/-/g, ' ')));
      keys.add(
        token
          .toLowerCase()
          .replace(/[øœæåßþðđłıŋĸʻ']/g, (ch) => SPECIAL_LETTER_MAP[ch] ?? ch)
          .replace(/[^a-z0-9-]+/g, '')
          .replace(/-+/g, '-')
      );
    }
  } else if (normalized.includes(' ')) {
    keys.add(normalized.replace(/ /g, '-'));
    keys.add(normalized.replace(/ /g, ''));
  }

  const wcCanonical = resolveWorldCupAliasName(normalized);
  if (wcCanonical) keys.add(wcCanonical);
  for (const alias of getWorldCupNameAliases(wcCanonical)) keys.add(alias);
  return Array.from(keys).filter(Boolean);
}

function lastNameToken(rawName: string): string {
  const raw = sanitizeLineupPlayerName(rawName);
  if (!raw) return '';

  // Lineup badges often show only a hyphenated surname (e.g. "Okon-Engstler").
  if (!raw.includes(' ') && raw.includes('-')) {
    return normalizeWorldCupPlayerName(raw);
  }

  const parts = raw.split(/\s+/).filter(Boolean);
  const lastRaw = parts.at(-1) ?? '';
  if (lastRaw.includes('-')) {
    return normalizeWorldCupPlayerName(lastRaw);
  }

  return normalizeWorldCupPlayerName(raw).split(' ').filter(Boolean).at(-1) ?? '';
}

export function buildWorldCupPlayerNameById(rosters: Array<Record<string, unknown>>): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rosters) {
    const nested =
      row.player && typeof row.player === 'object' ? (row.player as Record<string, unknown>) : {};
    const id = String(row.player_id ?? nested.id ?? '').trim();
    const name = String(nested.name || nested.short_name || '').trim();
    if (id && name) map.set(id, name);
  }
  return map;
}

function lineupTeamIds(lineups: Array<Record<string, unknown>>): number[] {
  const ids = new Set<number>();
  for (const row of lineups) {
    const teamId = Number(row.team_id);
    if (Number.isFinite(teamId)) ids.add(teamId);
  }
  return Array.from(ids);
}

function addNamePhoto(
  target: Map<string, string>,
  rawName: string,
  url: string,
  lastNameCounts: Map<string, number>
): void {
  for (const key of lineupPhotoNameKeys(rawName)) {
    if (!target.has(key)) target.set(key, url);
  }
  const last = lastNameToken(rawName);
  if (last) lastNameCounts.set(last, (lastNameCounts.get(last) ?? 0) + 1);
}

function resolvePhotoFromMaps(
  rawName: string,
  byName: Map<string, string>,
  lastNameCounts: Map<string, number>
): string | null {
  for (const key of lineupPhotoNameKeys(rawName)) {
    const hit = byName.get(key);
    if (hit) return hit;
  }
  const last = lastNameToken(rawName);
  if (last && (lastNameCounts.get(last) ?? 0) === 1) {
    return byName.get(last) ?? null;
  }
  return null;
}

function resolvePhotoFromTeamSquadCache(
  rawName: string,
  shirtNumber: unknown,
  cache: WorldCupSquadPhotoCache | null | undefined
): string | null {
  if (!cache) return null;
  const jersey = String(shirtNumber ?? '').trim();
  if (jersey && cache.byJerseyNumber?.[jersey]) return cache.byJerseyNumber[jersey];

  const byName = new Map(Object.entries(cache.byNormalizedName ?? {}));
  const lastNameCounts = new Map<string, number>();
  for (const name of byName.keys()) {
    const last = lastNameToken(name);
    if (last) lastNameCounts.set(last, (lastNameCounts.get(last) ?? 0) + 1);
  }
  return resolvePhotoFromMaps(rawName, byName, lastNameCounts);
}

async function loadBdlCachedPlayerNamesByTeam(
  bdlTeamIds: number[]
): Promise<Map<number, Map<number, string>>> {
  const out = new Map<number, Map<number, string>>();
  await Promise.all(
    bdlTeamIds.map(async (teamId) => {
      const [players, roster] = await Promise.all([
        getWorldCupCache<Array<{ id?: number; name?: string; short_name?: string }>>(BDL_PLAYERS_CACHE_KEY(teamId)),
        getWorldCupCache<Array<Record<string, unknown>>>(BDL_ROSTER_CACHE_KEY(teamId)),
      ]);
      const byId = new Map<number, string>();
      for (const player of players ?? []) {
        const id = Number(player.id);
        const name = sanitizeLineupPlayerName(String(player.name || player.short_name || ''));
        if (Number.isFinite(id) && name) byId.set(id, name);
      }
      for (const row of roster ?? []) {
        const nested =
          row.player && typeof row.player === 'object' ? (row.player as Record<string, unknown>) : {};
        const id = Number(row.player_id ?? nested.id);
        const name = sanitizeLineupPlayerName(String(nested.name || nested.short_name || ''));
        if (Number.isFinite(id) && name) byId.set(id, name);
      }
      if (byId.size) out.set(teamId, byId);
    })
  );
  return out;
}

async function loadPlayerIndexNamesByBdlId(): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const index = await getWorldCupCache<WorldCupPlayerIndexEntry[]>(WORLD_CUP_PLAYER_INDEX_CACHE_KEY);
  if (!index?.length) return out;
  for (const entry of index) {
    const bdlSource = entry.sources.find((source) => source.source === 'bdl' && source.id);
    const bdlId = Number(bdlSource?.id);
    if (Number.isFinite(bdlId) && entry.name) out.set(bdlId, entry.name);
  }
  return out;
}

async function enrichLineupPlayerNames(
  lineups: Array<Record<string, unknown>>,
  idToRawName: Map<number, string>,
  idToNameKeys: Map<number, string[]>,
  opts?: { nameByPlayerId?: Map<string, string> }
): Promise<void> {
  const missing = new Set<number>();
  for (const row of lineups) {
    const player = (row.player && typeof row.player === 'object' ? row.player : {}) as Record<string, unknown>;
    const playerId = Number(row.player_id ?? player.id);
    if (!Number.isFinite(playerId) || idToRawName.has(playerId)) continue;
    missing.add(playerId);
  }
  if (!missing.size) return;

  const teamIds = lineupTeamIds(lineups);
  const [namesByTeam, indexNames] = await Promise.all([
    loadBdlCachedPlayerNamesByTeam(teamIds),
    loadPlayerIndexNamesByBdlId(),
  ]);

  for (const row of lineups) {
    const player = (row.player && typeof row.player === 'object' ? row.player : {}) as Record<string, unknown>;
    const playerId = Number(row.player_id ?? player.id);
    if (!Number.isFinite(playerId) || idToRawName.has(playerId)) continue;

    const rosterName = opts?.nameByPlayerId?.get(String(playerId))?.trim();
    if (rosterName) {
      idToRawName.set(playerId, rosterName);
      idToNameKeys.set(playerId, lineupPhotoNameKeys(rosterName));
      continue;
    }

    const teamId = Number(row.team_id);
    const fromBdl =
      Number.isFinite(teamId) && namesByTeam.get(teamId)?.get(playerId)
        ? namesByTeam.get(teamId)!.get(playerId)!
        : '';
    const fromIndex = indexNames.get(playerId) ?? '';
    const resolved = fromBdl || fromIndex;
    if (resolved) {
      const clean = sanitizeLineupPlayerName(resolved);
      idToRawName.set(playerId, clean);
      idToNameKeys.set(playerId, lineupPhotoNameKeys(clean));
    }
  }
}

function registerPhotoToSquadPayload(
  payload: WorldCupSquadPhotoCache,
  displayName: string,
  url: string,
  apiPlayerId: string,
  jersey?: number | string | null
): void {
  payload.bySourcePlayerId[apiPlayerId] = url;
  for (const key of lineupPhotoNameKeys(displayName)) payload.byNormalizedName[key] = url;
  const jerseyKey = jersey != null ? String(jersey).trim() : '';
  if (jerseyKey) payload.byJerseyNumber![jerseyKey] = url;
}

type ApiFootballSearchPlayer = {
  id: number;
  name: string;
  firstname?: string;
  lastname?: string;
  photo?: string;
  number?: number | null;
};

function apiSearchQueriesForName(name: string): string[] {
  const queries = new Set<string>();
  for (const key of lineupPhotoNameKeys(name)) {
    queries.add(key);
    queries.add(key.replace(/ /g, '-'));
    queries.add(key.replace(/-/g, ' '));
    queries.add(key.replace(/[- ]/g, ''));
  }
  const last = lastNameToken(name);
  if (last) {
    queries.add(last);
    queries.add(last.replace(/ /g, '-'));
    queries.add(last.replace(/-/g, ' '));
    for (const part of last.split(/[- ]/).filter((t) => t.length >= 4)) queries.add(part);
  }
  for (const token of sanitizeLineupPlayerName(name).split(/\s+/)) {
    if (token.includes('-')) {
      queries.add(token.toLowerCase());
      queries.add(token.replace(/-/g, '').toLowerCase());
    }
  }
  return [...queries].filter((q) => q.length >= 4);
}

function indexPlayersForBdlTeam(
  index: WorldCupPlayerIndexEntry[] | null | undefined,
  countryCode: string | null | undefined
): Array<{ id: number; name: string }> {
  if (!index?.length || !countryCode) return [];
  const cc = countryCode.toUpperCase();
  const out: Array<{ id: number; name: string }> = [];
  for (const entry of index) {
    const bdl = entry.sources.find((s) => s.source === 'bdl' && s.id);
    if (!bdl || (bdl.countryCode ?? '').toUpperCase() !== cc) continue;
    const id = Number(bdl.id);
    if (Number.isFinite(id) && entry.name) out.push({ id, name: entry.name });
  }
  return out;
}

async function loadAllBdlPlayersForTeamSupplement(
  bdlTeamId: number,
  countryCode?: string | null
): Promise<Array<{ id: number; name: string }>> {
  const byId = new Map<number, string>();

  const [players, roster, index] = await Promise.all([
    getWorldCupCache<Array<{ id?: number; name?: string; short_name?: string }>>(BDL_PLAYERS_CACHE_KEY(bdlTeamId)),
    getWorldCupCache<Array<Record<string, unknown>>>(BDL_ROSTER_CACHE_KEY(bdlTeamId)),
    getWorldCupCache<WorldCupPlayerIndexEntry[]>(WORLD_CUP_PLAYER_INDEX_CACHE_KEY),
  ]);

  for (const player of players ?? []) {
    const id = Number(player.id);
    const name = sanitizeLineupPlayerName(String(player.name || player.short_name || ''));
    if (Number.isFinite(id) && name) byId.set(id, name);
  }

  for (const row of roster ?? []) {
    const nested =
      row.player && typeof row.player === 'object' ? (row.player as Record<string, unknown>) : {};
    const id = Number(row.player_id ?? nested.id);
    const name = sanitizeLineupPlayerName(String(nested.name || nested.short_name || ''));
    if (Number.isFinite(id) && name) byId.set(id, name);
  }

  for (const player of indexPlayersForBdlTeam(index, countryCode)) {
    if (!byId.has(player.id)) byId.set(player.id, sanitizeLineupPlayerName(player.name));
  }

  return Array.from(byId, ([id, name]) => ({ id, name }));
}

function pickApiFootballPlayerMatch(
  targetName: string,
  hits: Array<{ player: ApiFootballSearchPlayer }>
): ApiFootballSearchPlayer | null {
  if (!hits?.length) return null;
  const targetKeys = new Set(lineupPhotoNameKeys(targetName));
  const targetLast = lastNameToken(targetName);
  const targetTokens = targetLast.split(' ').filter((t) => t.length >= 3);

  let best: ApiFootballSearchPlayer | null = null;
  let bestScore = 0;
  for (const row of hits) {
    const player = row.player;
    const full = squadDisplayName(player);
    const keys = lineupPhotoNameKeys(full);
    let score = 0;
    if (keys.some((k) => targetKeys.has(k))) score = 100;
    else if (targetLast && lastNameToken(full) === targetLast) score = 60;
    else if (targetTokens.length && targetTokens.every((t) => keys.some((k) => k.includes(t)))) score = 45;
    else if (targetLast && keys.some((k) => k.includes(targetLast.replace(/ /g, '')))) score = 35;
    if (score > bestScore) {
      bestScore = score;
      best = player;
    }
  }
  return bestScore >= 35 ? best : null;
}

async function supplementSquadCacheFromBdlPlayers(opts: {
  bdlTeamId: number;
  apiTeamId: string;
  countryCode?: string | null;
  payload: WorldCupSquadPhotoCache;
  log: (msg: string) => void;
}): Promise<number> {
  const { bdlTeamId, apiTeamId, countryCode, payload, log } = opts;
  const bdlPlayers = await loadAllBdlPlayersForTeamSupplement(bdlTeamId, countryCode);
  let added = 0;

  for (const bdlPlayer of bdlPlayers) {
    const bdlId = Number(bdlPlayer.id);
    const name = sanitizeLineupPlayerName(bdlPlayer.name);
    if (!Number.isFinite(bdlId) || !name) continue;
    if (lineupPhotoNameKeys(name).some((k) => payload.byNormalizedName[k])) continue;

    const cachedUrl = await getWorldCupCache<string>(worldCupLineupPhotoByBdlPlayerCacheKey(bdlId));
    if (cachedUrl) {
      registerPhotoToSquadPayload(payload, name, cachedUrl, `bdl:${bdlId}`);
      continue;
    }

    const { data: mapped } = await supabaseAdmin
      .from('international_players')
      .select('source_player_id, full_name')
      .eq('source', 'api-football')
      .eq('bdl_player_id', bdlId)
      .limit(1)
      .maybeSingle();
    if (mapped?.source_player_id) {
      const apiId = String(mapped.source_player_id);
      const url = apiFootballPlayerPhotoUrl(apiId);
      registerPhotoToSquadPayload(payload, name, url, apiId);
      await setWorldCupCache(worldCupLineupPhotoByBdlPlayerCacheKey(bdlId), url);
      added += 1;
      continue;
    }

    const searchTerms = apiSearchQueriesForName(name);

    let matched = false;
    for (const term of searchTerms) {
      if (matched) break;
      for (const withTeam of [true, false] as const) {
        try {
          const params: Record<string, string | number> = { search: term };
          if (withTeam) params.team = apiTeamId;
          const hits = await apiFootballFetchSquad<Array<{ player: ApiFootballSearchPlayer }>>('/players', params);
          const match = pickApiFootballPlayerMatch(name, hits ?? []);
          if (!match?.id) continue;
          const apiId = String(match.id);
          const url = apiFootballPlayerPhotoUrl(apiId, match.photo);
          registerPhotoToSquadPayload(payload, name, url, apiId, match.number);
          await setWorldCupCache(worldCupLineupPhotoByBdlPlayerCacheKey(bdlId), url);
          log(`[squad-photos] supplemented ${name} via API search (${term}${withTeam ? '' : ', no team'})`);
          added += 1;
          matched = true;
          break;
        } catch {
          // try next query
        }
      }
    }

    if (
      !matched &&
      !lineupPhotoNameKeys(name).some((k) => payload.byNormalizedName[k]) &&
      !(await getWorldCupCache<string>(worldCupLineupPhotoByBdlPlayerCacheKey(bdlId)))
    ) {
      log(`[squad-photos] unresolved ${name} (${bdlId}) — no API-Football photo`);
    }
  }

  return added;
}

async function loadPhotosByFuzzyInternationalName(
  playerIds: number[],
  idToRawName: Map<number, string>,
  assign: (playerId: number, url: string) => void
): Promise<void> {
  for (const playerId of playerIds) {
    const rawName = sanitizeLineupPlayerName(idToRawName.get(playerId) ?? '');
    const surname = lastNameToken(rawName);
    if (!surname || surname.length < 4) continue;

    const tokens = surname.split(' ').filter((t) => t.length >= 3);
    const patterns = [...new Set([surname, ...tokens, ...lineupPhotoNameKeys(rawName)])].filter(
      (p) => p.length >= 4
    );

    for (const pattern of patterns) {
      const { data, error } = await supabaseAdmin
        .from('international_players')
        .select('normalized_name, source_player_id, full_name')
        .eq('source', 'api-football')
        .ilike('normalized_name', `%${pattern}%`)
        .limit(8);
      if (error) continue;

      const rows = data ?? [];
      const best =
        rows.length === 1
          ? rows[0]
          : rows.find((row) => {
              const normalized = String((row as { normalized_name?: unknown }).normalized_name ?? '');
              return tokens.length ? tokens.every((t) => normalized.includes(t)) : normalized.includes(pattern);
            });
      const sourcePlayerId = String((best as { source_player_id?: unknown } | undefined)?.source_player_id ?? '').trim();
      if (!sourcePlayerId) continue;
      assign(playerId, apiFootballPlayerPhotoUrl(sourcePlayerId));
      break;
    }
  }
}

async function loadApiFootballTeamIdsForBdlTeams(bdlTeamIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (!bdlTeamIds.length) return out;

  const { data, error } = await supabaseAdmin
    .from('international_teams')
    .select('bdl_team_id, source_team_id, country_code, team_name')
    .eq('source', 'api-football')
    .in('bdl_team_id', bdlTeamIds);
  if (error) {
    console.warn('[world-cup/lineup-photos] international_teams lookup failed:', error.message);
    return out;
  }

  for (const row of data ?? []) {
    const bdlId = Number((row as { bdl_team_id?: unknown }).bdl_team_id);
    const sourceTeamId = String((row as { source_team_id?: unknown }).source_team_id ?? '').trim();
    if (!Number.isFinite(bdlId) || !sourceTeamId) continue;
    const list = out.get(bdlId) ?? [];
    if (!list.includes(sourceTeamId)) list.push(sourceTeamId);
    out.set(bdlId, list);
  }
  return out;
}

async function loadTeamRosterPhotosFromStats(apiFootballTeamIds: string[]): Promise<Map<string, string>> {
  const photoByName = new Map<string, string>();
  const lastNameCounts = new Map<string, number>();
  if (!apiFootballTeamIds.length) return photoByName;

  const { data: statRows, error: statError } = await supabaseAdmin
    .from('international_player_match_stats')
    .select('source_player_id')
    .eq('source', 'api-football')
    .in('source_team_id', apiFootballTeamIds);
  if (statError) {
    console.warn('[world-cup/lineup-photos] team stat roster lookup failed:', statError.message);
    return photoByName;
  }

  const playerIds = Array.from(
    new Set(
      (statRows ?? [])
        .map((row) => String((row as { source_player_id?: unknown }).source_player_id ?? '').trim())
        .filter(Boolean)
    )
  );
  if (!playerIds.length) return photoByName;

  for (let i = 0; i < playerIds.length; i += 200) {
    const chunk = playerIds.slice(i, i + 200);
    const { data, error } = await supabaseAdmin
      .from('international_players')
      .select('source_player_id, full_name, normalized_name')
      .eq('source', 'api-football')
      .in('source_player_id', chunk);
    if (error) {
      console.warn('[world-cup/lineup-photos] team roster players lookup failed:', error.message);
      continue;
    }
    for (const row of data ?? []) {
      const sourcePlayerId = String((row as { source_player_id?: unknown }).source_player_id ?? '').trim();
      const fullName = String((row as { full_name?: unknown }).full_name ?? '').trim();
      if (!sourcePlayerId || !fullName) continue;
      const url = apiFootballPlayerPhotoUrl(sourcePlayerId);
      addNamePhoto(photoByName, fullName, url, lastNameCounts);
      const normalized = String((row as { normalized_name?: unknown }).normalized_name ?? '').trim();
      if (normalized && !photoByName.has(normalized)) {
        photoByName.set(normalized, url);
        const last = lastNameToken(normalized);
        if (last) lastNameCounts.set(last, (lastNameCounts.get(last) ?? 0) + 1);
      }
    }
  }

  for (const [last, count] of lastNameCounts) {
    if (count === 1) {
      for (const [key, url] of photoByName) {
        if (lastNameToken(key) === last && !photoByName.has(last)) {
          photoByName.set(last, url);
          break;
        }
      }
    }
  }

  return photoByName;
}

export async function loadLineupPlayerPhotos(
  lineups: Array<Record<string, unknown>>,
  opts?: { nameByPlayerId?: Map<string, string>; bdlTeamIds?: number[] }
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const assign = (playerId: number, url: string) => {
    if (!Number.isFinite(playerId) || !url || out[String(playerId)]) return;
    out[String(playerId)] = url;
  };

  const idToNameKeys = new Map<number, string[]>();
  const idToRawName = new Map<number, string>();
  const playerIdToTeamId = new Map<number, number>();
  const playerIdToShirt = new Map<number, string>();
  for (const row of lineups) {
    const player = (row.player && typeof row.player === 'object' ? row.player : {}) as Record<string, unknown>;
    const playerId = Number(row.player_id ?? player.id);
    if (!Number.isFinite(playerId)) continue;
    const teamId = Number(row.team_id);
    if (Number.isFinite(teamId)) playerIdToTeamId.set(playerId, teamId);
    const shirt = String(row.shirt_number ?? player.jersey_number ?? '').trim();
    if (shirt) playerIdToShirt.set(playerId, shirt);
    const rawName = sanitizeLineupPlayerName(
      String(player.name || player.short_name || opts?.nameByPlayerId?.get(String(playerId)) || '')
    );
    idToNameKeys.set(playerId, rawName ? lineupPhotoNameKeys(rawName) : []);
    if (rawName) idToRawName.set(playerId, rawName);
  }

  await enrichLineupPlayerNames(lineups, idToRawName, idToNameKeys, opts);

  const uniqueIds = Array.from(idToNameKeys.keys());
  if (!uniqueIds.length) return out;

  await Promise.all(
    uniqueIds.map(async (playerId) => {
      const cachedUrl = await getWorldCupCache<string>(worldCupLineupPhotoByBdlPlayerCacheKey(playerId));
      if (cachedUrl) assign(playerId, cachedUrl);
    })
  );

  const missingIds = () => uniqueIds.filter((id) => !out[String(id)]);

  try {
    const { data, error } = await supabaseAdmin
      .from('international_players')
      .select('bdl_player_id, source, source_player_id')
      .in('bdl_player_id', uniqueIds)
      .not('bdl_player_id', 'is', null);
    if (error) {
      console.warn('[world-cup/lineup-photos] bdl mapping lookup failed:', error.message);
    } else {
      for (const row of data ?? []) {
        const bdlId = Number((row as { bdl_player_id?: unknown }).bdl_player_id);
        const source = String((row as { source?: unknown }).source ?? '');
        const sourcePlayerId = String((row as { source_player_id?: unknown }).source_player_id ?? '').trim();
        if (!Number.isFinite(bdlId) || source !== 'api-football' || !sourcePlayerId) continue;
        assign(bdlId, apiFootballPlayerPhotoUrl(sourcePlayerId));
      }
    }
  } catch (error) {
    console.warn('[world-cup/lineup-photos] bdl mapping lookup failed:', error);
  }

  try {
    const index = await getWorldCupCache<WorldCupPlayerIndexEntry[]>(WORLD_CUP_PLAYER_INDEX_CACHE_KEY);
    if (index?.length) {
      const byBdlId = new Map<string, WorldCupPlayerIndexEntry>();
      for (const entry of index) {
        const bdlSource = entry.sources.find((source) => source.source === 'bdl' && source.id);
        if (bdlSource?.id) byBdlId.set(String(bdlSource.id), entry);
      }
      for (const playerId of missingIds()) {
        const entry = byBdlId.get(String(playerId));
        const apiFootball = entry?.sources.find((source) => source.source === 'api-football' && source.id);
        if (apiFootball?.id) assign(playerId, apiFootballPlayerPhotoUrl(apiFootball.id));
      }
    }
  } catch (error) {
    console.warn('[world-cup/lineup-photos] index lookup failed:', error);
  }

  let stillMissing = missingIds();
  if (stillMissing.length) {
    const normalizedNames = Array.from(
      new Set(stillMissing.flatMap((id) => idToNameKeys.get(id) ?? []))
    );
    if (normalizedNames.length) {
      try {
        for (let i = 0; i < normalizedNames.length; i += 100) {
          const chunk = normalizedNames.slice(i, i + 100);
          const { data, error } = await supabaseAdmin
            .from('international_players')
            .select('normalized_name, source_player_id')
            .eq('source', 'api-football')
            .in('normalized_name', chunk);
          if (error) {
            console.warn('[world-cup/lineup-photos] name lookup failed:', error.message);
            continue;
          }
          const photoByName = new Map<string, string>();
          for (const row of data ?? []) {
            const normalized = String((row as { normalized_name?: unknown }).normalized_name ?? '').trim();
            const sourcePlayerId = String((row as { source_player_id?: unknown }).source_player_id ?? '').trim();
            if (!normalized || !sourcePlayerId || photoByName.has(normalized)) continue;
            photoByName.set(normalized, apiFootballPlayerPhotoUrl(sourcePlayerId));
          }
          for (const playerId of stillMissing) {
            const keys = idToNameKeys.get(playerId) ?? [];
            for (const key of keys) {
              const url = photoByName.get(key);
              if (url) {
                assign(playerId, url);
                break;
              }
            }
          }
        }
      } catch (error) {
        console.warn('[world-cup/lineup-photos] name lookup failed:', error);
      }
    }
  }

  stillMissing = missingIds();
  if (stillMissing.length) {
    const bdlTeamIds = opts?.bdlTeamIds?.length ? opts.bdlTeamIds : lineupTeamIds(lineups);
    const squadCaches = new Map<number, WorldCupSquadPhotoCache>();
    await Promise.all(
      bdlTeamIds.map(async (teamId) => {
        const cached = await getWorldCupCache<WorldCupSquadPhotoCache>(worldCupSquadPhotoCacheKey(teamId));
        if (cached) squadCaches.set(teamId, cached);
      })
    );

    const teamIdMap = await loadApiFootballTeamIdsForBdlTeams(bdlTeamIds);
    const apiTeamIds = Array.from(new Set(Array.from(teamIdMap.values()).flat()));
    const rosterPhotoByName = await loadTeamRosterPhotosFromStats(apiTeamIds);
    const rosterLastNameCounts = new Map<string, number>();
    for (const name of rosterPhotoByName.keys()) {
      const last = lastNameToken(name);
      if (last) rosterLastNameCounts.set(last, (rosterLastNameCounts.get(last) ?? 0) + 1);
    }

    for (const playerId of stillMissing) {
      const rawName = sanitizeLineupPlayerName(
        idToRawName.get(playerId) ?? opts?.nameByPlayerId?.get(String(playerId)) ?? ''
      );
      const teamId = playerIdToTeamId.get(playerId);
      const shirt = playerIdToShirt.get(playerId);

      if (teamId != null) {
        const fromSquad = resolvePhotoFromTeamSquadCache(rawName, shirt, squadCaches.get(teamId));
        if (fromSquad) {
          assign(playerId, fromSquad);
          continue;
        }
      }

      if (!rawName) continue;
      const url = resolvePhotoFromMaps(rawName, rosterPhotoByName, rosterLastNameCounts);
      if (url) assign(playerId, url);
    }
  }

  stillMissing = missingIds();
  if (stillMissing.length) {
    await loadPhotosByFuzzyInternationalName(stillMissing, idToRawName, assign);
  }

  return out;
}

export async function persistWorldCupSquadPhotoCache(
  bdlTeamId: number,
  payload: WorldCupSquadPhotoCache
): Promise<boolean> {
  return setWorldCupCache(worldCupSquadPhotoCacheKey(bdlTeamId), payload);
}

/** Resolve a player headshot URL from warmed squad photo caches. */
export async function getWorldCupPlayerPhotoUrl(
  playerName: string,
  bdlTeamId: number | null | undefined
): Promise<string | null> {
  if (!bdlTeamId || !Number.isFinite(bdlTeamId)) return null;
  const cache = await getWorldCupCache<WorldCupSquadPhotoCache>(worldCupSquadPhotoCacheKey(bdlTeamId));
  return resolvePhotoFromTeamSquadCache(playerName, null, cache);
}

/** Fast sync headshot lookup using preloaded squad caches + player index (props enrich). */
export function resolveWorldCupPropsPlayerPhotoFromCaches(opts: {
  playerName: string;
  bdlTeamIds?: Array<number | null | undefined>;
  indexEntry?: WorldCupPlayerIndexEntry | null;
  squadCachesByTeamId?: Map<number, WorldCupSquadPhotoCache>;
}): string | null {
  const teamIds = [
    ...new Set(
      (opts.bdlTeamIds ?? []).filter((id): id is number => id != null && Number.isFinite(id))
    ),
  ];
  for (const teamId of teamIds) {
    const fromSquad = resolvePhotoFromTeamSquadCache(
      opts.playerName,
      null,
      opts.squadCachesByTeamId?.get(teamId)
    );
    if (fromSquad) return fromSquad;
  }
  const entry = opts.indexEntry;
  if (entry) {
    const apiFootball = entry.sources.find((s) => s.source === 'api-football' && s.id);
    if (apiFootball?.id) return apiFootballPlayerPhotoUrl(apiFootball.id);
  }
  return null;
}

/** Props-page headshot resolver: squad caches, player index, BDL per-player cache, intl DB. */
export async function resolveWorldCupPropsPlayerPhotoUrl(opts: {
  playerName: string;
  bdlTeamIds?: Array<number | null | undefined>;
  indexEntry?: WorldCupPlayerIndexEntry | null;
}): Promise<string | null> {
  const { playerName, indexEntry } = opts;
  const teamIds = [
    ...new Set(
      (opts.bdlTeamIds ?? []).filter((id): id is number => id != null && Number.isFinite(id))
    ),
  ];

  for (const teamId of teamIds) {
    const fromSquad = await getWorldCupPlayerPhotoUrl(playerName, teamId);
    if (fromSquad) return fromSquad;
  }

  if (indexEntry) {
    const apiFootball = indexEntry.sources.find((s) => s.source === 'api-football' && s.id);
    if (apiFootball?.id) return apiFootballPlayerPhotoUrl(apiFootball.id);
    const bdl = indexEntry.sources.find((s) => s.source === 'bdl' && s.id);
    if (bdl?.id) {
      const bdlId = Number(bdl.id);
      if (Number.isFinite(bdlId)) {
        const cached = await getWorldCupCache<string>(worldCupLineupPhotoByBdlPlayerCacheKey(bdlId));
        if (cached) return cached;
      }
    }
  }

  const nameKeys = lineupPhotoNameKeys(sanitizeLineupPlayerName(playerName));
  if (!nameKeys.length) return null;

  try {
    const { data } = await supabaseAdmin
      .from('international_players')
      .select('source_player_id, normalized_name')
      .eq('source', 'api-football')
      .in('normalized_name', nameKeys.slice(0, 25))
      .limit(8);
    const keySet = new Set(nameKeys);
    for (const row of data ?? []) {
      const normalized = String((row as { normalized_name?: unknown }).normalized_name ?? '').trim();
      const sourcePlayerId = String((row as { source_player_id?: unknown }).source_player_id ?? '').trim();
      if (!normalized || !sourcePlayerId || !keySet.has(normalized)) continue;
      return apiFootballPlayerPhotoUrl(sourcePlayerId);
    }
  } catch {
    // ignore lookup errors
  }

  return null;
}

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const BDL_TEAMS_CACHE_KEY = 'wc:raw:teams:2026:v1';
const WC_AF_LEAGUE_ID = 1;
const WC_AF_SEASON = 2026;

const API_FOOTBALL_TEAM_SEARCH_ALIASES: Record<string, string[]> = {
  'cape verde': ['cape verde', 'cabo verde', 'cape verde islands'],
  'cabo verde': ['cape verde', 'cabo verde', 'cape verde islands'],
  'ivory coast': ['ivory coast', 'cote d ivoire', "cote d'ivoire", 'cote divoire'],
  czechia: ['czechia', 'czech republic'],
  'czech republic': ['czechia', 'czech republic'],
  'dr congo': ['dr congo', 'congo dr', 'democratic republic of the congo'],
  'new zealand': ['new zealand'],
  ghana: ['ghana'],
};

async function searchApiFootballNationalTeamId(
  teamName: string,
  countryCode?: string | null
): Promise<string | null> {
  const normalized = normalizeWorldCupPlayerName(teamName);
  const needles = new Set<string>([
    teamName,
    normalized,
    ...(API_FOOTBALL_TEAM_SEARCH_ALIASES[normalized] ?? []),
  ]);
  if (countryCode) {
    needles.add(String(countryCode).trim());
    const slug = resolveWorldCupFlagCode(countryCode);
    if (slug) needles.add(slug);
  }
  const slugFromName = resolveWorldCupFlagCode(teamName);
  if (slugFromName) needles.add(slugFromName);

  for (const needle of needles) {
    const search = String(needle ?? '').trim();
    if (search.length < 3) continue;
    try {
      const teams = await apiFootballFetchSquad<
        Array<{ team?: { id?: number; name?: string; national?: boolean } }>
      >('/teams', { search, league: WC_AF_LEAGUE_ID, season: WC_AF_SEASON });
      const nationalTeams = teams.filter((row) => row?.team?.national !== false);
      const pool = nationalTeams.length ? nationalTeams : teams;
      const hit = pool.find((row) => worldCupTeamsMatch(String(row?.team?.name ?? ''), teamName));
      const teamId = Number(hit?.team?.id);
      if (Number.isFinite(teamId)) return String(teamId);
    } catch {
      // try next needle
    }
  }

  const countryNeedles = new Set<string>([teamName, normalized]);
  if (countryCode) countryNeedles.add(String(countryCode));
  for (const country of countryNeedles) {
    const label = String(country ?? '').trim();
    if (label.length < 3) continue;
    try {
      const teams = await apiFootballFetchSquad<
        Array<{ team?: { id?: number; name?: string; national?: boolean } }>
      >('/teams', { country: label });
      const national = teams.find((row) => row?.team?.national);
      const teamId = Number(national?.team?.id ?? teams[0]?.team?.id);
      if (Number.isFinite(teamId)) return String(teamId);
    } catch {
      // try next country label
    }
  }

  return null;
}

type ApiSquadPlayer = {
  id: number;
  name: string;
  firstname?: string;
  lastname?: string;
  number?: number | null;
  photo?: string;
};

async function apiFootballFetchSquad<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY is not configured');
  const url = new URL(`${API_FOOTBALL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { 'x-apisports-key': key } });
  if (!res.ok) throw new Error(`API-Football ${path} failed: ${res.status}`);
  const json = (await res.json()) as { response?: T };
  return json.response as T;
}

function squadDisplayName(player: ApiSquadPlayer): string {
  const first = String(player.firstname ?? '').trim();
  const last = String(player.lastname ?? '').trim();
  if (first && last) return `${first} ${last}`;
  return String(player.name ?? '').trim();
}

export async function buildWorldCupSquadPhotoCaches(opts?: {
  log?: (msg: string) => void;
}): Promise<{ warmed: number; skipped: number }> {
  const log = opts?.log ?? (() => {});
  const bdlTeams =
    (await getWorldCupCache<Array<{ id: number; name: string; country_code?: string | null }>>(
      BDL_TEAMS_CACHE_KEY
    )) ?? [];
  if (!bdlTeams.length) {
    throw new Error('No BDL teams in cache - run build-world-cup bdl cache first');
  }

  const { data: intlTeams, error } = await supabaseAdmin
    .from('international_teams')
    .select('bdl_team_id, source_team_id, team_name, country_code')
    .eq('source', 'api-football')
    .not('source_team_id', 'is', null);
  if (error) throw error;

  const byBdlId = new Map<number, string>();
  const byCountry = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const row of intlTeams ?? []) {
    const bdlId = Number((row as { bdl_team_id?: unknown }).bdl_team_id);
    const sourceTeamId = String((row as { source_team_id?: unknown }).source_team_id ?? '').trim();
    const teamName = normalizeWorldCupPlayerName(String((row as { team_name?: unknown }).team_name ?? ''));
    const country = String((row as { country_code?: unknown }).country_code ?? '').trim().toUpperCase();
    if (!sourceTeamId) continue;
    if (Number.isFinite(bdlId)) byBdlId.set(bdlId, sourceTeamId);
    if (country) byCountry.set(country, sourceTeamId);
    if (teamName) byName.set(teamName, sourceTeamId);
  }

  let warmed = 0;
  let skipped = 0;

  for (const team of bdlTeams) {
    let apiTeamId =
      byBdlId.get(team.id) ||
      (team.country_code ? byCountry.get(String(team.country_code).toUpperCase()) : undefined) ||
      byName.get(normalizeWorldCupPlayerName(team.name));
    if (!apiTeamId) {
      const slug = resolveWorldCupFlagCode(team.country_code) ?? resolveWorldCupFlagCode(team.name);
      if (slug) apiTeamId = byCountry.get(slug.toUpperCase()) ?? byName.get(slug);
    }
    if (!apiTeamId) {
      apiTeamId = (await searchApiFootballNationalTeamId(team.name, team.country_code)) ?? undefined;
      if (apiTeamId) {
        log(`[squad-photos] resolved ${team.name} via API search (api team ${apiTeamId})`);
      }
    }
    if (!apiTeamId) {
      log(`[squad-photos] skip ${team.name} (${team.id}) - no API-Football team id`);
      skipped += 1;
      continue;
    }

    try {
      const squads = await apiFootballFetchSquad<
        Array<{ team: { id: number; name: string }; players: ApiSquadPlayer[] }>
      >('/players/squads', { team: apiTeamId });
      const players = Array.isArray(squads?.[0]?.players) ? squads[0]!.players : [];
      const payload: WorldCupSquadPhotoCache = {
        byNormalizedName: {},
        bySourcePlayerId: {},
        byJerseyNumber: {},
      };

      for (const player of players) {
        const id = String(player.id ?? '').trim();
        const name = squadDisplayName(player);
        if (!id || !name) continue;
        const url = apiFootballPlayerPhotoUrl(id, player.photo);
        payload.bySourcePlayerId[id] = url;
        for (const key of lineupPhotoNameKeys(name)) payload.byNormalizedName[key] = url;
        for (const key of lineupPhotoNameKeys(player.name || name)) {
          if (!payload.byNormalizedName[key]) payload.byNormalizedName[key] = url;
        }
        const jersey = player.number;
        if (jersey != null && String(jersey).trim()) {
          payload.byJerseyNumber![String(jersey).trim()] = url;
        }
      }

      const lastNameCounts = new Map<string, number>();
      for (const name of Object.keys(payload.byNormalizedName)) {
        const last = lastNameToken(name);
        if (last) lastNameCounts.set(last, (lastNameCounts.get(last) ?? 0) + 1);
      }
      for (const [last, count] of lastNameCounts) {
        if (count !== 1 || payload.byNormalizedName[last]) continue;
        for (const [name, url] of Object.entries(payload.byNormalizedName)) {
          if (lastNameToken(name) === last) {
            payload.byNormalizedName[last] = url;
            break;
          }
        }
      }

      if (!Object.keys(payload.byNormalizedName).length) {
        log(`[squad-photos] ${team.name}: empty squad from API team ${apiTeamId}`);
        skipped += 1;
        continue;
      }

      const supplemented = await supplementSquadCacheFromBdlPlayers({
        bdlTeamId: team.id,
        apiTeamId,
        countryCode: team.country_code,
        payload,
        log,
      });
      if (supplemented) {
        log(`[squad-photos] ${team.name}: supplemented ${supplemented} BDL-only players`);
      }

      await persistWorldCupSquadPhotoCache(team.id, payload);
      warmed += 1;
      log(
        `[squad-photos] ${team.name}: ${Object.keys(payload.byNormalizedName).length} photos (api team ${apiTeamId})`
      );
    } catch (err) {
      log(`[squad-photos] ${team.name} failed: ${err instanceof Error ? err.message : String(err)}`);
      skipped += 1;
    }
  }

  log(`[squad-photos] done - warmed ${warmed}, skipped ${skipped}`);
  return { warmed, skipped };
}
