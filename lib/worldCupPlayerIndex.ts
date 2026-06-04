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
import { resolveWorldCupAliasName } from '@/lib/worldCupPlayerAliases';

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

/** NFD-strip + lowercase + collapse non-alphanumerics. Used for matching. */
/**
 * Standalone letters that `normalize('NFD')` does NOT decompose (they aren't
 * accented base letters but distinct glyphs). Without folding these, names like
 * "Møller" collapse to "mller" and never match "Moller"/"Möller".
 */
const SPECIAL_LETTER_MAP: Record<string, string> = {
  ø: 'o', œ: 'oe', æ: 'ae', å: 'a', ß: 'ss', þ: 'th', ð: 'd', đ: 'd', ł: 'l',
  ı: 'i', ŋ: 'n', ĸ: 'k', ʻ: '', "'": '',
};

export function normalizeWorldCupPlayerName(name: string): string {
  const folded = String(name || '')
    .toLowerCase()
    .replace(/[øœæåßþðđłıŋĸʻ']/g, (ch) => SPECIAL_LETTER_MAP[ch] ?? ch);
  return folded
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
    const name = String(player.name || player.short_name || '').trim();
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
