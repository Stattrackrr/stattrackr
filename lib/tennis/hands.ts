/**
 * Opponent/player handedness for vs Righties / vs Lefties.
 * API-Tennis profiles do not include hand; overlay comes from ESPN athlete bios
 * cached in data/tennis/espn-hands.json (scripts/cache-tennis-hands.ts).
 *
 * Name joins: exact fold, compacted letters (O'Connell / Oconnell, Xin Yu Wang),
 * then order-insensitive token match (Martin Etcheverry Tomas / Tomas Martin Etcheverry).
 */

import fs from 'fs';
import path from 'path';

export type TennisHand = 'R' | 'L';

export type EspnHandsCache = {
  fetchedAt: string;
  hits: Record<string, { hand: TennisHand; espnId: string; espnName: string }>;
  misses: string[];
};

type HandIndex = {
  byName: Map<string, TennisHand>;
  byCompact: Map<string, TennisHand | 'conflict'>;
  byTokens: Map<string, TennisHand | 'conflict'>;
};

type HandRuntime = {
  index: HandIndex | null;
  byRawName: Map<string, TennisHand | null>;
};

function handRuntime(): HandRuntime {
  const g = globalThis as typeof globalThis & { __tennisHands?: HandRuntime };
  if (!g.__tennisHands) g.__tennisHands = { index: null, byRawName: new Map() };
  return g.__tennisHands;
}

export function espnHandsPath(): string {
  return path.join(process.cwd(), 'data', 'tennis', 'espn-hands.json');
}

export function foldTennisName(name: string): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function compactTennisName(name: string): string {
  return foldTennisName(name).replace(/ /g, '');
}

export function tennisNameTokenKey(name: string): string | null {
  const parts = foldTennisName(name).split(' ').filter(Boolean);
  if (parts.length < 2) return null;
  return [...parts].sort().join(' ');
}

export function normalizeTennisHand(hand: string | null | undefined): TennisHand | null {
  const key = String(hand || '').trim().toUpperCase();
  if (key === 'R' || key.startsWith('RIGHT')) return 'R';
  if (key === 'L' || key.startsWith('LEFT')) return 'L';
  return null;
}

function setOrConflict(
  map: Map<string, TennisHand | 'conflict'>,
  key: string | null,
  hand: TennisHand
) {
  if (!key) return;
  const existing = map.get(key);
  if (!existing) map.set(key, hand);
  else if (existing !== hand) map.set(key, 'conflict');
}

function addHand(index: HandIndex, name: string, hand: TennisHand) {
  const full = foldTennisName(name);
  if (full) {
    const existing = index.byName.get(full);
    if (existing && existing !== hand) index.byName.delete(full);
    else index.byName.set(full, hand);
  }
  setOrConflict(index.byCompact, compactTennisName(name) || null, hand);
  setOrConflict(index.byTokens, tennisNameTokenKey(name), hand);
}

export function loadEspnHandsCache(): EspnHandsCache {
  const file = espnHandsPath();
  if (!fs.existsSync(file)) return { fetchedAt: '', hits: {}, misses: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as EspnHandsCache;
    return {
      fetchedAt: parsed.fetchedAt || '',
      hits: parsed.hits || {},
      misses: parsed.misses || [],
    };
  } catch {
    return { fetchedAt: '', hits: {}, misses: [] };
  }
}

function loadHandIndex(): HandIndex {
  const runtime = handRuntime();
  if (runtime.index) return runtime.index;
  const index: HandIndex = { byName: new Map(), byCompact: new Map(), byTokens: new Map() };
  const cache = loadEspnHandsCache();
  for (const [queryName, hit] of Object.entries(cache.hits)) {
    const hand = normalizeTennisHand(hit.hand);
    if (!hand) continue;
    addHand(index, queryName, hand);
    if (hit.espnName) addHand(index, hit.espnName, hand);
  }
  runtime.index = index;
  return index;
}

function pick(map: Map<string, TennisHand | 'conflict'>, key: string | null): TennisHand | null {
  if (!key) return null;
  const value = map.get(key);
  return value === 'R' || value === 'L' ? value : null;
}

export function tennisHandForName(name: string | null | undefined): TennisHand | null {
  const raw = String(name || '');
  if (!raw) return null;
  const runtime = handRuntime();
  if (runtime.byRawName.has(raw)) return runtime.byRawName.get(raw) ?? null;
  const key = foldTennisName(raw);
  if (!key) {
    runtime.byRawName.set(raw, null);
    return null;
  }
  const index = loadHandIndex();
  const hand =
    index.byName.get(key) ||
    pick(index.byCompact, compactTennisName(raw)) ||
    pick(index.byTokens, tennisNameTokenKey(raw)) ||
    null;
  runtime.byRawName.set(raw, hand);
  return hand;
}

export function withTennisHands<T extends {
  playerName?: string | null;
  opponent?: string | null;
  hand?: string | null;
  opponentHand?: string | null;
}>(row: T): T {
  return {
    ...row,
    hand: normalizeTennisHand(row.hand) || tennisHandForName(row.playerName) || row.hand || null,
    opponentHand:
      normalizeTennisHand(row.opponentHand) || tennisHandForName(row.opponent) || row.opponentHand || null,
  };
}
