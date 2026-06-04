/**
 * Audit the cross-competition name matching that powers the World Cup
 * dashboard's combined stats (World Cup + Euros + Nations League).
 *
 * The dashboard (`loadInternationalStatsByPlayerName`) merges a selected World
 * Cup player's stats with Euros (statsbomb) and Nations League (api-football)
 * rows *by normalized name*: it pulls EVERY `international_players` row whose
 * `normalized_name` equals the selected player's name and sums their stats.
 *
 * That is risky when a normalized name maps to more than one real person
 * (e.g. two "Emiliano Martínez", a Portugal "Danilo" vs a Brazil "Danilo", or
 * cross-source name twins). This audit reconstructs that exact lookup and flags
 * every case where the merge could stitch in the wrong player's stats.
 *
 * Signals used to disambiguate, strongest first:
 *   1. `bdl_player_id` — the authoritative BDL link stored on international_players.
 *      If set and it doesn't match the World Cup player carrying that name, the
 *      name match is provably wrong.
 *   2. Nation — derived from the national team the player actually played for
 *      (international_player_match_stats -> international_teams), since these are
 *      national-team competitions. Compared against the BDL country_code.
 *   3. Distinct identities — >1 international player id per source under one name.
 *
 * Classification per current World Cup player name:
 *   - confident:       single, country-consistent international identity per source
 *   - countryMismatch: international identity exists but its nation differs
 *   - ambiguous:       name maps to multiple people, or bdl_player_id disagrees,
 *                      or multiple World Cup players share the name
 *   - unmatched:       no international data for this World Cup player
 */

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  fetchAllBdlWorldCupPlayers,
  fetchAllInternationalPlayers,
  normalizeWorldCupPlayerName,
  CURRENT_WORLD_CUP_SEASONS,
  type WorldCupIndexCompetition,
  type IntlPlayerRow,
} from '@/lib/worldCupPlayerIndex';
import {
  resolveWorldCupAliasName,
  OVERRIDDEN_WORLD_CUP_PLAYER_IDS,
} from '@/lib/worldCupPlayerAliases';

type IntlMatch = {
  competition: WorldCupIndexCompetition;
  source: string;
  id: string;
  name: string;
  /** Nation resolved from the national team the player played for. */
  nation: string | null;
  /** Authoritative BDL id stored on international_players (null when unmapped). */
  bdlPlayerId: string | null;
};

export type WorldCupMatchAuditEntry = {
  normalizedName: string;
  worldCup: { name: string; id: string; countryCode: string | null }[];
  international: IntlMatch[];
  status: 'confident' | 'countryMismatch' | 'ambiguous' | 'unmatched';
  reasons: string[];
};

export type WorldCupNearMiss = {
  worldCupName: string;
  worldCupId: string;
  worldCupNation: string | null;
  candidateName: string;
  candidateNormalized: string;
  competitions: WorldCupIndexCompetition[];
  candidateNation: string | null;
  relation: 'subset' | 'fuzzy';
  distance: number;
  /** True when WC + candidate resolve to the same nation (likely a real miss). */
  sameNation: boolean;
};

export type WorldCupMatchAuditReport = {
  generatedAt: string;
  seasons: string[];
  totals: {
    worldCupPlayers: number;
    internationalRows: number;
    matchedWorldCupPlayers: number;
    confident: number;
    countryMismatch: number;
    ambiguous: number;
    unmatched: number;
    worldCupNameCollisions: number;
    internationalWithBdlId: number;
    nearMissSameNation: number;
    nearMissDiffNation: number;
  };
  ambiguous: WorldCupMatchAuditEntry[];
  countryMismatch: WorldCupMatchAuditEntry[];
  worldCupNameCollisions: WorldCupMatchAuditEntry[];
  /** Likely missed combines: similar name + same nation, not currently merged. */
  nearMissSameNation: WorldCupNearMiss[];
  /** Similar name but different nation — name twins that must NOT be combined. */
  nearMissDiffNation: WorldCupNearMiss[];
  confidentSample: WorldCupMatchAuditEntry[];
  unmatchedSample: WorldCupMatchAuditEntry[];
};

function competitionForIntlSource(source: string): WorldCupIndexCompetition {
  return source === 'statsbomb' ? 'euros' : 'nations-league';
}

/**
 * Map full English nation names (normalized) to an ISO alpha-3 code so we can
 * compare BDL's alpha-3 country_code against international team names like
 * "Spain" / "Bosnia & Herzegovina". Only nations relevant to the World Cup /
 * Euros / Nations League are needed.
 */
const NAME_TO_CODE: Record<string, string> = {
  // Europe
  spain: 'esp', germany: 'deu', france: 'fra', england: 'eng', scotland: 'sco', wales: 'wal',
  'northern ireland': 'nir', portugal: 'prt', netherlands: 'nld', belgium: 'bel', italy: 'ita',
  croatia: 'hrv', switzerland: 'che', austria: 'aut', denmark: 'dnk', sweden: 'swe', norway: 'nor',
  poland: 'pol', ukraine: 'ukr', serbia: 'srb', czechia: 'cze', 'czech republic': 'cze',
  slovakia: 'svk', slovenia: 'svn', hungary: 'hun', romania: 'rou', turkey: 'tur', turkiye: 'tur',
  greece: 'grc', albania: 'alb', iceland: 'isl', finland: 'fin', russia: 'rus', georgia: 'geo',
  'north macedonia': 'mkd', macedonia: 'mkd', montenegro: 'mne', kosovo: 'xkx', bulgaria: 'bgr',
  israel: 'isr', ireland: 'irl', 'republic of ireland': 'irl', 'bosnia herzegovina': 'bih',
  'bosnia and herzegovina': 'bih', 'bosnia amp herzegovina': 'bih', luxembourg: 'lux',
  // Americas
  argentina: 'arg', brazil: 'bra', uruguay: 'ury', colombia: 'col', chile: 'chl', peru: 'per',
  ecuador: 'ecu', paraguay: 'pry', bolivia: 'bol', venezuela: 'ven', usa: 'usa',
  'united states': 'usa', 'united states of america': 'usa', mexico: 'mex', canada: 'can',
  'costa rica': 'cri', panama: 'pan', honduras: 'hnd', jamaica: 'jam',
  // Asia / Oceania
  japan: 'jpn', 'south korea': 'kor', 'korea republic': 'kor', 'republic of korea': 'kor',
  iran: 'irn', 'saudi arabia': 'sau', australia: 'aus', qatar: 'qat', iraq: 'irq',
  'united arab emirates': 'are', uae: 'are', uzbekistan: 'uzb', jordan: 'jor', china: 'chn',
  'china pr': 'chn', 'new zealand': 'nzl',
  // Africa
  morocco: 'mar', senegal: 'sen', tunisia: 'tun', algeria: 'dza', egypt: 'egy', nigeria: 'nga',
  ghana: 'gha', cameroon: 'cmr', 'ivory coast': 'civ', 'cote divoire': 'civ', mali: 'mli',
  'south africa': 'zaf', 'dr congo': 'cod', 'congo dr': 'cod', 'democratic republic of congo': 'cod',
  congo: 'cog', 'cape verde': 'cpv', 'burkina faso': 'bfa', angola: 'ago', gabon: 'gab',
  guinea: 'gin', 'guinea-bissau': 'gnb', 'guinea bissau': 'gnb', 'equatorial guinea': 'gnq',
  mauritania: 'mrt', mozambique: 'moz', zambia: 'zmb', zimbabwe: 'zwe', tanzania: 'tza',
  uganda: 'uga', sudan: 'sdn', gambia: 'gmb', comoros: 'com', namibia: 'nam', benin: 'ben',
  togo: 'tgo', madagascar: 'mdg', ethiopia: 'eth', botswana: 'bwa', libya: 'lby', kenya: 'ken',
  'sierra leone': 'sle', liberia: 'lbr', niger: 'ner', 'central african republic': 'caf',
  'south sudan': 'ssd', burundi: 'bdi', rwanda: 'rwa', malawi: 'mwi', eswatini: 'swz',
};

function normCountry(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Canonicalize a nation label (alpha-3 code OR full name) to an alpha-3 code. */
function canonicalCountry(value: string | null | undefined): string {
  const norm = normCountry(value);
  if (!norm) return '';
  if (NAME_TO_CODE[norm]) return NAME_TO_CODE[norm];
  if (norm.length === 3 && !norm.includes(' ')) return norm; // already alpha-3 (esp, deu, ...)
  return norm; // unknown — compared as-is
}

/** True when both nations resolve to the same country (or either is unknown). */
function countriesAgree(a: string | null, b: string | null): boolean {
  const x = canonicalCountry(a);
  const y = canonicalCountry(b);
  if (!x || !y) return true; // unknown on either side → don't penalize
  return x === y;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function tokensOf(norm: string): string[] {
  return norm.split(' ').filter(Boolean);
}

/** Levenshtein distance with early exit once it exceeds `max`. */
function levWithin(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    const cur = new Array(lb + 1);
    cur[0] = i;
    let best = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[lb];
}

/** One side's token set fully contains the other, with a meaningful overlap. */
function tokenSubset(aTokens: string[], bTokens: string[]): boolean {
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  const shorter = aTokens.length <= bTokens.length ? aTokens : bTokens;
  const longerSet = aTokens.length <= bTokens.length ? bSet : aSet;
  if (!shorter.length) return false;
  // Require every token of the shorter name to appear in the longer name, and
  // at least one of those tokens to be a real surname (len >= 4) to avoid
  // matching on generic fragments like "de" / "junior".
  const allContained = shorter.every((t) => longerSet.has(t));
  const hasSignificant = shorter.some((t) => t.length >= 4);
  return allContained && hasSignificant;
}

/**
 * Resolve each international player's nation from the national team they most
 * often played for. Keyed by `${source}::${source_player_id}`.
 */
async function resolveInternationalNations(
  players: IntlPlayerRow[],
  log?: (msg: string) => void
): Promise<Map<string, string | null>> {
  const nationByPlayer = new Map<string, string | null>();
  const idsBySource = new Map<string, string[]>();
  for (const p of players) {
    const list = idsBySource.get(p.source) ?? [];
    list.push(p.source_player_id);
    idsBySource.set(p.source, list);
  }

  for (const [source, ids] of idsBySource) {
    // player -> { teamId -> appearances }
    const teamCounts = new Map<string, Map<string, number>>();
    const teamIds = new Set<string>();

    for (const idChunk of chunk(ids, 300)) {
      const { data, error } = await supabaseAdmin
        .from('international_player_match_stats')
        .select('source_player_id, source_team_id')
        .eq('source', source)
        .in('source_player_id', idChunk);
      if (error) {
        log?.(`[match-audit] stats read failed (${source}): ${error.message}`);
        continue;
      }
      for (const r of (data ?? []) as Array<{ source_player_id: string; source_team_id: string }>) {
        teamIds.add(r.source_team_id);
        const counts = teamCounts.get(r.source_player_id) ?? new Map<string, number>();
        counts.set(r.source_team_id, (counts.get(r.source_team_id) ?? 0) + 1);
        teamCounts.set(r.source_player_id, counts);
      }
    }

    // Resolve team -> nation (alpha-3 country_code, else team name).
    const teamNation = new Map<string, string | null>();
    for (const teamChunk of chunk(Array.from(teamIds), 300)) {
      if (!teamChunk.length) continue;
      const { data } = await supabaseAdmin
        .from('international_teams')
        .select('source_team_id, country_code, team_name')
        .eq('source', source)
        .in('source_team_id', teamChunk);
      for (const t of (data ?? []) as Array<{
        source_team_id: string;
        country_code: string | null;
        team_name: string | null;
      }>) {
        teamNation.set(t.source_team_id, t.country_code || t.team_name || null);
      }
    }

    for (const [playerId, counts] of teamCounts) {
      let bestTeam: string | null = null;
      let best = -1;
      for (const [teamId, n] of counts) {
        if (n > best) {
          best = n;
          bestTeam = teamId;
        }
      }
      nationByPlayer.set(`${source}::${playerId}`, bestTeam ? teamNation.get(bestTeam) ?? null : null);
    }
  }

  return nationByPlayer;
}

export async function auditWorldCupPlayerMatches(
  opts: { log?: (msg: string) => void; seasons?: string[]; sampleSize?: number } = {}
): Promise<WorldCupMatchAuditReport> {
  const log = opts.log;
  const seasons = opts.seasons ?? CURRENT_WORLD_CUP_SEASONS;
  const sampleSize = opts.sampleSize ?? 50;

  const [bdlPlayers, intlPlayers] = await Promise.all([
    fetchAllBdlWorldCupPlayers({ seasons, log }),
    fetchAllInternationalPlayers({ log }),
  ]);

  log?.(`[match-audit] world-cup=${bdlPlayers.length} international=${intlPlayers.length}`);

  // Group World Cup players by normalized name.
  const wcByNorm = new Map<string, { name: string; id: string; countryCode: string | null }[]>();
  for (const p of bdlPlayers) {
    const name = String(p.name || p.short_name || '').trim();
    const norm = normalizeWorldCupPlayerName(name);
    if (!norm) continue;
    const list = wcByNorm.get(norm) ?? [];
    list.push({ name, id: String(p.id ?? ''), countryCode: (p.country_code as string | null) ?? null });
    wcByNorm.set(norm, list);
  }

  // Only international players whose name (or curated alias) collides with a
  // World Cup player are relevant to the dashboard merge — resolve nations for
  // just those.
  const relevantIntl = intlPlayers.filter((p) => {
    const norm = p.normalized_name?.trim() || normalizeWorldCupPlayerName(p.full_name || '');
    return Boolean(norm) && wcByNorm.has(resolveWorldCupAliasName(norm));
  });
  log?.(`[match-audit] resolving nations for ${relevantIntl.length} international rows that share a WC name...`);
  const nationByPlayer = await resolveInternationalNations(relevantIntl, log);

  // Group relevant international players by normalized name.
  const intlByNorm = new Map<string, IntlMatch[]>();
  let internationalWithBdlId = 0;
  for (const p of relevantIntl) {
    const name = String(p.full_name || '').trim();
    const rawNorm = p.normalized_name?.trim() || normalizeWorldCupPlayerName(name);
    if (!rawNorm) continue;
    // Group aliased rows under the World Cup name they belong to.
    const norm = resolveWorldCupAliasName(rawNorm);
    const bdlId = p.bdl_player_id != null ? String(p.bdl_player_id) : null;
    if (bdlId) internationalWithBdlId += 1;
    const list = intlByNorm.get(norm) ?? [];
    list.push({
      competition: competitionForIntlSource(p.source),
      source: p.source,
      id: String(p.source_player_id ?? ''),
      name,
      nation: nationByPlayer.get(`${p.source}::${p.source_player_id}`) ?? null,
      bdlPlayerId: bdlId,
    });
    intlByNorm.set(norm, list);
  }

  const ambiguous: WorldCupMatchAuditEntry[] = [];
  const countryMismatch: WorldCupMatchAuditEntry[] = [];
  const confident: WorldCupMatchAuditEntry[] = [];
  const unmatched: WorldCupMatchAuditEntry[] = [];
  const worldCupNameCollisions: WorldCupMatchAuditEntry[] = [];

  for (const [norm, wcList] of wcByNorm) {
    const intl = intlByNorm.get(norm) ?? [];
    const entry: WorldCupMatchAuditEntry = {
      normalizedName: norm,
      worldCup: wcList,
      international: intl,
      status: 'unmatched',
      reasons: [],
    };

    const wcCollision = wcList.length > 1;
    if (wcCollision) {
      entry.reasons.push(`${wcList.length} World Cup players share this name`);
      worldCupNameCollisions.push(entry);
    }

    // A curated per-player override resolves this collision (each World Cup
    // player is pinned to the correct international identity), so it is no
    // longer an ambiguous-merge risk.
    const overrideResolved = wcList.every((w) => OVERRIDDEN_WORLD_CUP_PLAYER_IDS.has(w.id));

    if (intl.length === 0) {
      entry.status = 'unmatched';
      unmatched.push(entry);
      continue;
    }

    if (overrideResolved) {
      entry.reasons.push('resolved via curated per-player override');
      entry.status = 'confident';
      confident.push(entry);
      continue;
    }

    // Distinct international identities per source.
    const idsBySource = new Map<string, Set<string>>();
    const intlNations = new Set<string>();
    for (const m of intl) {
      const set = idsBySource.get(m.source) ?? new Set<string>();
      set.add(m.id);
      idsBySource.set(m.source, set);
      const canon = canonicalCountry(m.nation);
      if (canon) intlNations.add(canon);
    }
    const anySourceMultiId = Array.from(idsBySource.values()).some((s) => s.size > 1);
    const multipleIntlNations = intlNations.size > 1;

    // Authoritative cross-check: does any attached bdl_player_id disagree with
    // every World Cup player carrying this name?
    const wcIds = new Set(wcList.map((w) => w.id));
    const bdlIdsPresent = intl.map((m) => m.bdlPlayerId).filter((x): x is string => Boolean(x));
    const bdlIdDisagrees = bdlIdsPresent.length > 0 && bdlIdsPresent.some((id) => !wcIds.has(id));

    // Country agreement using resolved nation vs BDL country_code.
    const wcCountries = wcList.map((w) => w.countryCode);
    const anyCountryAgree = intl.some((m) => wcCountries.some((c) => countriesAgree(c, m.nation)));

    if (anySourceMultiId || multipleIntlNations || wcCollision || bdlIdDisagrees) {
      if (anySourceMultiId) entry.reasons.push('multiple distinct international players for this name within a source');
      if (multipleIntlNations) entry.reasons.push(`international players span nations: ${Array.from(intlNations).join('/')}`);
      if (bdlIdDisagrees) entry.reasons.push('attached bdl_player_id does not match the World Cup player(s) with this name');
      entry.status = 'ambiguous';
      ambiguous.push(entry);
      continue;
    }

    if (!anyCountryAgree) {
      entry.reasons.push(
        `nation differs (WC: ${wcCountries.filter(Boolean).join('/') || 'unknown'} vs intl: ${
          Array.from(intlNations).join('/') || 'unknown'
        })`
      );
      entry.status = 'countryMismatch';
      countryMismatch.push(entry);
      continue;
    }

    entry.status = 'confident';
    confident.push(entry);
  }

  const matchedWorldCupPlayers = confident.length + countryMismatch.length + ambiguous.length;

  // ---- Near-miss detection: unmatched WC players whose name is *almost* an
  // international name (likely the same person, currently NOT combined). ----
  log?.(`[match-audit] scanning ${unmatched.length} unmatched World Cup players for near-misses...`);

  const intlRowsByNorm = new Map<string, IntlPlayerRow[]>();
  for (const p of intlPlayers) {
    const norm = p.normalized_name?.trim() || normalizeWorldCupPlayerName(p.full_name || '');
    if (!norm) continue;
    const list = intlRowsByNorm.get(norm) ?? [];
    list.push(p);
    intlRowsByNorm.set(norm, list);
  }
  const postings = new Map<string, Set<string>>();
  const prefixBuckets = new Map<string, string[]>();
  for (const norm of intlRowsByNorm.keys()) {
    for (const t of tokensOf(norm)) {
      const s = postings.get(t) ?? new Set<string>();
      s.add(norm);
      postings.set(t, s);
    }
    const key = norm.slice(0, 3);
    const arr = prefixBuckets.get(key) ?? [];
    arr.push(norm);
    prefixBuckets.set(key, arr);
  }

  type RawNearMiss = {
    wcName: string;
    wcId: string;
    wcCountry: string | null;
    candNorm: string;
    relation: 'subset' | 'fuzzy';
    distance: number;
  };
  const rawNearMisses: RawNearMiss[] = [];
  const candidateRowKey = new Map<string, IntlPlayerRow>();

  for (const entry of unmatched) {
    const wcNorm = entry.normalizedName;
    if (wcNorm.length < 4) continue;
    const wcTokens = tokensOf(wcNorm);
    const candidateNorms = new Set<string>();
    for (const t of wcTokens) {
      const s = postings.get(t);
      if (s) for (const n of s) candidateNorms.add(n);
    }
    const pre = prefixBuckets.get(wcNorm.slice(0, 3));
    if (pre) for (const n of pre) candidateNorms.add(n);
    candidateNorms.delete(wcNorm);

    const wc = entry.worldCup[0];
    const found: RawNearMiss[] = [];
    for (const cand of candidateNorms) {
      if (cand.length < 4) continue;
      const candTokens = tokensOf(cand);
      let relation: 'subset' | 'fuzzy' | null = null;
      let distance = 0;
      if (tokenSubset(wcTokens, candTokens)) {
        relation = 'subset';
      } else {
        const d = levWithin(wcNorm, cand, 2);
        if (d <= 2) {
          relation = 'fuzzy';
          distance = d;
        }
      }
      if (!relation) continue;
      found.push({ wcName: wc.name, wcId: wc.id, wcCountry: wc.countryCode, candNorm: cand, relation, distance });
      for (const row of intlRowsByNorm.get(cand) ?? []) {
        candidateRowKey.set(`${row.source}::${row.source_player_id}`, row);
      }
    }
    // Keep the strongest few candidates (subset first, then smallest distance).
    found.sort((a, b) => (a.relation === b.relation ? a.distance - b.distance : a.relation === 'subset' ? -1 : 1));
    rawNearMisses.push(...found.slice(0, 3));
  }

  // Resolve nations for the candidate international rows in one batch.
  const candidateRows = Array.from(candidateRowKey.values());
  const candidateNations = candidateRows.length
    ? await resolveInternationalNations(candidateRows, log)
    : new Map<string, string | null>();

  const nearMissSameNation: WorldCupNearMiss[] = [];
  const nearMissDiffNation: WorldCupNearMiss[] = [];
  for (const nm of rawNearMisses) {
    const rows = intlRowsByNorm.get(nm.candNorm) ?? [];
    const competitions = Array.from(new Set(rows.map((r) => competitionForIntlSource(r.source))));
    let candidateNation: string | null = null;
    for (const r of rows) {
      const n = candidateNations.get(`${r.source}::${r.source_player_id}`);
      if (n) {
        candidateNation = n;
        if (countriesAgree(nm.wcCountry, n)) break; // prefer a nation that matches WC
      }
    }
    const sameNation = countriesAgree(nm.wcCountry, candidateNation) && Boolean(candidateNation);
    const out: WorldCupNearMiss = {
      worldCupName: nm.wcName,
      worldCupId: nm.wcId,
      worldCupNation: nm.wcCountry,
      candidateName: rows[0]?.full_name ?? nm.candNorm,
      candidateNormalized: nm.candNorm,
      competitions,
      candidateNation,
      relation: nm.relation,
      distance: nm.distance,
      sameNation,
    };
    (sameNation ? nearMissSameNation : nearMissDiffNation).push(out);
  }
  const sortNearMiss = (a: WorldCupNearMiss, b: WorldCupNearMiss) =>
    a.relation === b.relation ? a.distance - b.distance || a.worldCupName.localeCompare(b.worldCupName) : a.relation === 'subset' ? -1 : 1;
  nearMissSameNation.sort(sortNearMiss);
  nearMissDiffNation.sort(sortNearMiss);

  const sortByName = (a: WorldCupMatchAuditEntry, b: WorldCupMatchAuditEntry) =>
    a.normalizedName.localeCompare(b.normalizedName);

  return {
    generatedAt: new Date().toISOString(),
    seasons,
    totals: {
      worldCupPlayers: wcByNorm.size,
      internationalRows: intlPlayers.length,
      matchedWorldCupPlayers,
      confident: confident.length,
      countryMismatch: countryMismatch.length,
      ambiguous: ambiguous.length,
      unmatched: unmatched.length,
      worldCupNameCollisions: worldCupNameCollisions.length,
      internationalWithBdlId,
      nearMissSameNation: nearMissSameNation.length,
      nearMissDiffNation: nearMissDiffNation.length,
    },
    ambiguous: ambiguous.sort(sortByName),
    countryMismatch: countryMismatch.sort(sortByName),
    worldCupNameCollisions: worldCupNameCollisions.sort(sortByName),
    nearMissSameNation,
    nearMissDiffNation,
    confidentSample: confident.slice(0, sampleSize),
    unmatchedSample: unmatched.slice(0, sampleSize),
  };
}
