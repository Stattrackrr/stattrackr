/**
 * Normalize AFL player names for consistent matching and cache keys.
 * Handles apostrophes (e.g. O'Brien), hyphens (Smith-Jones), "Surname, First" format,
 * and optional mapping from data/afl-player-name-fixes.json so stats resolve on the dashboard.
 *
 * Uses a bundled JSON import (no fs) so this module is safe in Client Components.
 */

import nameFixesFile from '../data/afl-player-name-fixes.json';

/** Apostrophe-like characters (ASCII, Unicode right single quote, etc.) → ASCII ' */
const APOSTROPHE_LIKE = /[\u0027\u2018\u2019\u201B\u2032\u0060]/g;
/** Hyphen/dash-like characters → ASCII - */
const HYPHEN_LIKE = /[\u002D\u2010\u2011\u2012\u2013\u2014\u2212]/g;

type FixesFile = { mapping?: Record<string, string> };
const NAME_FIXES: Record<string, string> = (nameFixesFile as FixesFile).mapping ?? {};

/**
 * Resolve a player name to a canonical form for lookups (league stats, game logs, cache).
 * - Applies mapping from data/afl-player-name-fixes.json if present
 * - Converts "Surname, First" to "First Surname"
 * - Otherwise returns name trimmed
 */
export function toCanonicalAflPlayerName(name: string): string {
  if (name == null || typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const mapped = NAME_FIXES[trimmed];
  if (mapped && typeof mapped === 'string') return mapped.trim();
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((p) => p.trim());
    if (parts.length === 2 && parts[0] && parts[1]) return `${parts[1]} ${parts[0]}`.trim();
  }
  return trimmed;
}

/**
 * Normalize a player name for matching and cache keys.
 * - Trim and lowercase
 * - Collapse whitespace to single space
 * - Normalize apostrophe variants to ASCII '
 * - Normalize hyphen/dash variants to ASCII -
 */
export function normalizeAflPlayerName(name: string): string {
  if (name == null || typeof name !== 'string') return '';
  let s = name
    .trim()
    .toLowerCase()
    .replace(APOSTROPHE_LIKE, "'")
    .replace(HYPHEN_LIKE, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

/**
 * Use for lookups (league stats, game logs cache, team resolver).
 * Canonicalizes then normalizes so "Wanganeen-Milera, Nasiah" and "Nasiah Wanganeen-Milera" hit the same key.
 */
export function normalizeAflPlayerNameForLookup(name: string): string {
  return normalizeAflPlayerName(toCanonicalAflPlayerName(name));
}

/**
 * Like normalizeAflPlayerNameForLookup but also collapses hyphens to spaces so
 * "Nasiah Wanganeen-Milera" and "Nasiah Wanganeen Milera" match (e.g. for cache key and league stats).
 */
export function normalizeAflPlayerNameForMatch(name: string): string {
  const normalized = normalizeAflPlayerNameForLookup(name);
  return normalized.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}
