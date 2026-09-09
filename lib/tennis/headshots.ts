/**
 * Local tennis headshot cache (ATP/WTA official first, then ESPN, then API-Tennis).
 * Downloaded by scripts/cache-tennis-headshots.ts.
 */

import fs from 'fs';
import path from 'path';

export type TennisHeadshotSource = 'atp' | 'wta' | 'espn' | 'api-tennis' | 'wikipedia';

export type TennisHeadshotEntry = {
  name?: string;
  tour?: string | null;
  remoteUrl: string | null;
  file?: string | null;
  ok: boolean;
  source?: TennisHeadshotSource;
  espnId?: string;
  atpId?: string;
  wtaId?: string;
};

export type TennisHeadshotsIndex = {
  generatedAt: string;
  source: 'atp' | 'wta' | 'espn' | 'api-tennis' | 'wikipedia' | 'mixed';
  byPlayerId: Record<string, TennisHeadshotEntry>;
  missing: string[];
};

type HeadshotRuntime = {
  index: TennisHeadshotsIndex | null | undefined;
  localIds: Set<string> | null;
  mtime: number;
};

function headshotRuntime(): HeadshotRuntime {
  const g = globalThis as typeof globalThis & { __tennisHeadshots?: HeadshotRuntime };
  if (!g.__tennisHeadshots) g.__tennisHeadshots = { index: undefined, localIds: null, mtime: 0 };
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
  const file = tennisHeadshotsIndexPath();
  const mtime = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
  if (runtime.index !== undefined && runtime.mtime === mtime) return runtime.index;
  runtime.localIds = null;
  runtime.mtime = mtime;
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
  if (localHeadshotIds().has(id)) {
    const stamp = loadTennisHeadshotsIndex()?.generatedAt || '1';
    return `${tennisHeadshotPublicPath(id)}?v=${encodeURIComponent(stamp).slice(0, 24)}`;
  }
  const fromIndex = loadTennisHeadshotsIndex()?.byPlayerId?.[id];
  if (fromIndex && fromIndex.ok === false) {
    return String(remote || '').trim() || null;
  }
  const url = String(fromIndex?.remoteUrl || remote || '').trim();
  return url || null;
}
