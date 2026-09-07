/**
 * Local tennis headshot cache (ESPN first, API-Tennis fallback).
 * Downloaded by scripts/cache-tennis-headshots.ts.
 */

import fs from 'fs';
import path from 'path';

export type TennisHeadshotSource = 'espn' | 'api-tennis';

export type TennisHeadshotEntry = {
  name?: string;
  tour?: string | null;
  remoteUrl: string | null;
  file?: string | null;
  ok: boolean;
  source?: TennisHeadshotSource;
  espnId?: string;
};

export type TennisHeadshotsIndex = {
  generatedAt: string;
  source: 'espn' | 'api-tennis' | 'mixed';
  byPlayerId: Record<string, TennisHeadshotEntry>;
  missing: string[];
};

type HeadshotRuntime = {
  index: TennisHeadshotsIndex | null | undefined;
  localIds: Set<string> | null;
};

function headshotRuntime(): HeadshotRuntime {
  const g = globalThis as typeof globalThis & { __tennisHeadshots?: HeadshotRuntime };
  if (!g.__tennisHeadshots) g.__tennisHeadshots = { index: undefined, localIds: null };
  return g.__tennisHeadshots;
}

export function tennisHeadshotsPublicDir(): string {
  return path.join(process.cwd(), 'public', 'images', 'tennis', 'headshots');
}

export function tennisHeadshotsIndexPath(): string {
  return path.join(process.cwd(), 'data', 'tennis', 'api-tennis', 'headshots.json');
}

export function tennisHeadshotPublicPath(playerId: string): string {
  return `/images/tennis/headshots/${playerId}.jpg`;
}

export function tennisHeadshotFilePath(playerId: string): string {
  return path.join(tennisHeadshotsPublicDir(), `${playerId}.jpg`);
}

export function loadTennisHeadshotsIndex(): TennisHeadshotsIndex | null {
  const runtime = headshotRuntime();
  if (runtime.index !== undefined) return runtime.index;
  const file = tennisHeadshotsIndexPath();
  if (!fs.existsSync(file)) {
    runtime.index = null;
    return null;
  }
  try {
    runtime.index = JSON.parse(fs.readFileSync(file, 'utf8')) as TennisHeadshotsIndex;
    return runtime.index;
  } catch {
    runtime.index = null;
    return null;
  }
}

function localHeadshotIds(): Set<string> {
  const runtime = headshotRuntime();
  if (runtime.localIds) return runtime.localIds;
  const ids = new Set<string>();
  const index = loadTennisHeadshotsIndex();
  if (index) {
    for (const [id, entry] of Object.entries(index.byPlayerId)) {
      if (entry.ok) ids.add(id);
    }
  }
  runtime.localIds = ids;
  return ids;
}

export function resolveTennisHeadshotUrl(
  playerId: string | null | undefined,
  remote?: string | null
): string | null {
  const id = String(playerId || '').trim();
  if (!id) return String(remote || '').trim() || null;
  if (localHeadshotIds().has(id)) return tennisHeadshotPublicPath(id);
  const fromIndex = loadTennisHeadshotsIndex()?.byPlayerId?.[id];
  const url = String(fromIndex?.remoteUrl || remote || '').trim();
  return url || null;
}
