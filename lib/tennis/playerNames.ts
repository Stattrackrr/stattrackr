/**
 * Full tennis display names and fallback world ranks by API-Tennis player id.
 * Production Redis / odds feeds often keep "A. Michelsen"; this map is the committed
 * full-name source (data/tennis/player-names.json). Ranks in the file are a fallback when
 * Redis standings do not list the player — live Redis standings always win when present.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tennisIdentityIndex, tennisSamePersonRecords } from '@/lib/tennis/oddsApi';

type PlayerNamesFile = {
  fetchedAt?: string;
  names?: Record<string, string>;
  ranks?: Record<string, number>;
};

let cachedNames: Map<string, string> | null = null;
let cachedRanks: Map<string, number> | null = null;
let expandLookup: ((name: string) => Array<{ name: string }>) | null = null;

function loadFile(): PlayerNamesFile {
  try {
    const file = path.join(process.cwd(), 'data', 'tennis', 'player-names.json');
    return JSON.parse(readFileSync(file, 'utf8')) as PlayerNamesFile;
  } catch {
    return {};
  }
}

function tennisNameLooksAbbreviated(name: string): boolean {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return false;
  const first = parts[0]!;
  return first.length <= 2 || /^[A-Za-z]\.$/.test(first);
}

function fullNameExpandLookup(): (name: string) => Array<{ name: string }> {
  if (expandLookup) return expandLookup;
  const rows: Array<{ name: string }> = [];
  const seen = new Set<string>();
  for (const full of loadTennisDisplayNames().values()) {
    const name = String(full || '').trim();
    if (!name || tennisNameLooksAbbreviated(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ name });
  }
  expandLookup = tennisIdentityIndex(rows);
  return expandLookup;
}

/**
 * Odds boards store "H. Mayot"; Tools / UI want "Harold Mayot".
 * Uses committed player-names.json via identity match. Ambiguous → leave as-is.
 */
export function expandTennisDisplayName(name: string | null | undefined): string {
  const cur = String(name || '').trim();
  if (!cur || !tennisNameLooksAbbreviated(cur)) return cur;
  const same = tennisSamePersonRecords(fullNameExpandLookup()(cur));
  if (!same?.length) return cur;
  const best = same
    .map((row) => row.name)
    .filter((n) => n && !tennisNameLooksAbbreviated(n))
    .sort((a, b) => b.length - a.length)[0];
  return best ? preferFullTennisName(cur, best) : cur;
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
  if (cachedNames) return cachedNames;
  const parsed = loadFile();
  cachedNames = new Map(
    Object.entries(parsed.names || {})
      .map(([id, name]) => [String(id).trim(), String(name || '').trim()] as const)
      .filter(([id, name]) => id && name)
  );
  return cachedNames;
}

export function loadTennisDisplayRanks(): Map<string, number> {
  if (cachedRanks) return cachedRanks;
  const parsed = loadFile();
  cachedRanks = new Map(
    Object.entries(parsed.ranks || {})
      .map(([id, rank]) => [String(id).trim(), Number(rank)] as const)
      .filter(([id, rank]) => id && Number.isFinite(rank) && rank > 0)
  );
  return cachedRanks;
}

/** Prefer the committed full name when we know the player id. */
export function tennisDisplayNameFor(playerId: string | null | undefined, currentName: string): string {
  const id = String(playerId || '').trim();
  const current = String(currentName || '').trim();
  if (!id) return current;
  const full = loadTennisDisplayNames().get(id);
  return full ? preferFullTennisName(current, full) : current;
}

/** Committed fallback world rank (used when Redis standings do not list the player). */
export function tennisDisplayRankFor(playerId: string | null | undefined): number | null {
  const id = String(playerId || '').trim();
  if (!id) return null;
  return loadTennisDisplayRanks().get(id) ?? null;
}
