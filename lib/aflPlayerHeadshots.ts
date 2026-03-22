/**
 * AFL player portraits for the props page (and anywhere else we need them).
 *
 * Edit data/afl-player-headshots.json: keys are display names as they appear in props
 * (usually "First Last", matching FootyWire / odds). Values are absolute https URLs or
 * site-relative paths such as /images/afl-portraits/player.webp
 *
 * The props API also resolves portraits from official club sites (see aflClubPlayerPortrait).
 * Prefer this JSON to override or for players not on a roster page.
 */

import raw from '../data/afl-player-headshots.json';
import { normalizeAflPlayerNameForMatch, toCanonicalAflPlayerName } from '@/lib/aflPlayerNameUtils';

type HeadshotsFile = { byName?: Record<string, string> };

const data = raw as HeadshotsFile;
const byNameRaw = data.byName && typeof data.byName === 'object' ? data.byName : {};

const normalizedToUrl = new Map<string, string>();

for (const [key, url] of Object.entries(byNameRaw)) {
  if (typeof url !== 'string') continue;
  const trimmedUrl = url.trim();
  if (!trimmedUrl) continue;
  const canonKey = toCanonicalAflPlayerName(key);
  const norm = normalizeAflPlayerNameForMatch(canonKey);
  if (norm) normalizedToUrl.set(norm, trimmedUrl);
}

/**
 * Portrait URL for this player if listed in afl-player-headshots.json; otherwise null.
 */
export function getAflPlayerHeadshotUrl(playerName: string): string | null {
  if (playerName == null || typeof playerName !== 'string') return null;
  const trimmed = playerName.trim();
  if (!trimmed) return null;
  const canon = toCanonicalAflPlayerName(trimmed);
  const direct = byNameRaw[canon] ?? byNameRaw[trimmed];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const norm = normalizeAflPlayerNameForMatch(trimmed);
  return normalizedToUrl.get(norm) ?? null;
}
