/**
 * AFL player portraits for the props page (and anywhere else we need them).
 *
 * Resolution order:
 * 1. Manual overrides in data/afl-player-headshots.json
 * 2. Season cache in data/afl-player-headshots-2026.json (bundled for sync client paint)
 *
 * The props API can still resolve missing players via club-site scrape.
 */

import manualRaw from '../data/afl-player-headshots.json';
import season2026Raw from '../data/afl-player-headshots-2026.json';
import { normalizeAflPlayerNameForMatch, toCanonicalAflPlayerName } from '@/lib/aflPlayerNameUtils';

type HeadshotsFile = {
  byName?: Record<string, string>;
  missing?: string[];
};

const FIRST_NAME_ALIAS_TO_CANON: Record<string, string> = {
  cam: 'cameron',
  lachie: 'lachlan',
  josh: 'joshua',
  matt: 'matthew',
  mitch: 'mitchell',
  nick: 'nicholas',
  ollie: 'oliver',
  sam: 'samuel',
  tom: 'thomas',
  zac: 'zachary',
};

function toLooseNameNorm(name: string): string {
  const base = normalizeAflPlayerNameForMatch(name);
  if (!base) return '';
  const words = base.split(' ').filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0]!;
  const canonicalFirst = FIRST_NAME_ALIAS_TO_CANON[first] ?? first;
  return [canonicalFirst, ...words.slice(1)]
    .join(' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function indexHeadshots(byName: Record<string, string>): {
  byNameRaw: Record<string, string>;
  byNameNorm: Map<string, string>;
  byNameLooseNorm: Map<string, string>;
} {
  const byNameRaw: Record<string, string> = {};
  const byNameNorm = new Map<string, string>();
  const byNameLooseNorm = new Map<string, string>();
  for (const [key, url] of Object.entries(byName)) {
    if (typeof url !== 'string') continue;
    const trimmedUrl = url.trim();
    if (!trimmedUrl) continue;
    const canonKey = toCanonicalAflPlayerName(key) || key.trim();
    if (!canonKey) continue;
    byNameRaw[canonKey] = trimmedUrl;
    const norm = normalizeAflPlayerNameForMatch(canonKey);
    if (norm) byNameNorm.set(norm, trimmedUrl);
    const loose = toLooseNameNorm(canonKey);
    if (loose) byNameLooseNorm.set(loose, trimmedUrl);
  }
  return { byNameRaw, byNameNorm, byNameLooseNorm };
}

function mergeIndexes(
  primary: ReturnType<typeof indexHeadshots>,
  secondary: ReturnType<typeof indexHeadshots>
): ReturnType<typeof indexHeadshots> {
  return {
    byNameRaw: { ...secondary.byNameRaw, ...primary.byNameRaw },
    byNameNorm: new Map([...secondary.byNameNorm, ...primary.byNameNorm]),
    byNameLooseNorm: new Map([...secondary.byNameLooseNorm, ...primary.byNameLooseNorm]),
  };
}

const manualData = manualRaw as HeadshotsFile;
const seasonData = season2026Raw as HeadshotsFile;

const manualByName =
  manualData.byName && typeof manualData.byName === 'object' && !Array.isArray(manualData.byName)
    ? manualData.byName
    : {};
const seasonByName =
  seasonData.byName && typeof seasonData.byName === 'object' && !Array.isArray(seasonData.byName)
    ? seasonData.byName
    : {};

const MANUAL_INDEX = indexHeadshots(manualByName);
const SEASON_INDEX = indexHeadshots(seasonByName);
const HEADSHOT_INDEX = mergeIndexes(MANUAL_INDEX, SEASON_INDEX);

function lookupInIndex(
  index: ReturnType<typeof indexHeadshots>,
  playerName: string
): string | null {
  if (playerName == null || typeof playerName !== 'string') return null;
  const trimmed = playerName.trim();
  if (!trimmed) return null;

  const canon = toCanonicalAflPlayerName(trimmed);
  const direct = index.byNameRaw[canon] ?? index.byNameRaw[trimmed];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const norm = normalizeAflPlayerNameForMatch(canon || trimmed);
  if (norm) {
    const strict = index.byNameNorm.get(norm);
    if (strict) return strict;
  }
  const loose = toLooseNameNorm(canon || trimmed);
  if (!loose) return null;
  return index.byNameLooseNorm.get(loose) ?? null;
}

/**
 * Manual overrides only (`data/afl-player-headshots.json`).
 * Used by the yearly prefetch script so season cache hits are not treated as overrides.
 */
export function getAflManualPlayerHeadshotUrl(playerName: string): string | null {
  return lookupInIndex(MANUAL_INDEX, playerName);
}

/**
 * Portrait URL for this player from bundled headshot caches; otherwise null.
 * Prefer this for sync first paint — season URLs no longer require an API round-trip.
 */
export function getAflPlayerHeadshotUrl(playerName: string): string | null {
  return lookupInIndex(HEADSHOT_INDEX, playerName);
}
