/**
 * Full tennis display names by API-Tennis player id.
 * Production Redis / odds feeds often keep "A. Michelsen"; this map is the committed
 * full-name source (data/tennis/player-names.json) so the props board can show "Alex Michelsen".
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

type PlayerNamesFile = { fetchedAt?: string; names?: Record<string, string> };

let cached: Map<string, string> | null = null;

function tennisNameLooksAbbreviated(name: string): boolean {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return false;
  const first = parts[0]!;
  return first.length <= 2 || /^[A-Za-z]\.$/.test(first);
}

export function preferFullTennisName(current: string, rosterName: string): string {
  const cur = String(current || '').trim();
  const next = String(rosterName || '').trim();
  if (!next) return cur;
  if (!cur) return next;
  if (tennisNameLooksAbbreviated(cur) && !tennisNameLooksAbbreviated(next)) return next;
  if (!tennisNameLooksAbbreviated(cur) && tennisNameLooksAbbreviated(next)) return cur;
  return next.length >= cur.length ? next : cur;
}

export function loadTennisDisplayNames(): Map<string, string> {
  if (cached) return cached;
  try {
    const file = path.join(process.cwd(), 'data', 'tennis', 'player-names.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as PlayerNamesFile;
    cached = new Map(
      Object.entries(parsed.names || {})
        .map(([id, name]) => [String(id).trim(), String(name || '').trim()] as const)
        .filter(([id, name]) => id && name)
    );
  } catch {
    cached = new Map();
  }
  return cached;
}

/** Prefer the committed full name when we know the player id. */
export function tennisDisplayNameFor(playerId: string | null | undefined, currentName: string): string {
  const id = String(playerId || '').trim();
  const current = String(currentName || '').trim();
  if (!id) return current;
  const full = loadTennisDisplayNames().get(id);
  return full ? preferFullTennisName(current, full) : current;
}
