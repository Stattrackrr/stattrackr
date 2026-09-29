import { tennisIocToIso2 } from '@/lib/tennis/flags';
import { NEUTRAL_IOC_BY_ID, NEUTRAL_IOC_BY_NAME } from '@/lib/tennis/neutralIoc';

function cleanName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function cleanStored(stored: string | null | undefined): string | null {
  const code = String(stored || '').trim().toUpperCase();
  if (!code || !tennisIocToIso2(code)) return null;
  return code;
}

/**
 * Country for a player. Neutral athletes are Russia or Belarus from a checked list.
 * The displayed name wins, then a matching id. A stored code is kept when it belongs
 * to a different player than a stale id.
 */
export function canonicalTennisIoc(input: {
  playerId?: string | null;
  name?: string | null;
  stored?: string | null;
}): string | null {
  const id = String(input.playerId || '').trim();
  const name = cleanName(input.name);
  const byName = name ? NEUTRAL_IOC_BY_NAME[name] : undefined;
  if (byName) return byName;
  const byId = id ? NEUTRAL_IOC_BY_ID[id] : undefined;
  const stored = cleanStored(input.stored);
  if (byId) {
    // A stored country for a different person wins over a stale neutral id.
    if (name && stored && stored !== byId) return stored;
    return byId;
  }
  return stored;
}
