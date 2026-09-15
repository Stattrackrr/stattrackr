/**
 * Local tennis headshot cache (ATP/WTA official first, then ESPN, then API-Tennis).
 * Downloaded by scripts/cache-tennis-headshots.ts.
 */

import fs from 'fs';
import path from 'path';

export type TennisHeadshotSource = 'atp' | 'wta' | 'tennis-com' | 'espn' | 'api-tennis' | 'wikipedia';

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
  ext?: 'jpg' | 'png';
};

export type TennisHeadshotsIndex = {
  generatedAt: string;
  source: 'atp' | 'wta' | 'tennis-com' | 'espn' | 'api-tennis' | 'wikipedia' | 'mixed';
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

export function tennisHeadshotPublicPath(playerId: string, ext: 'jpg' | 'png' = 'jpg'): string {
  return `/images/tennis/headshots/${playerId}.${ext}`;
}

export function tennisHeadshotFilePath(playerId: string, ext: 'jpg' | 'png' = 'jpg'): string {
  return path.join(tennisHeadshotsPublicDir(), `${playerId}.${ext}`);
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
    const index = loadTennisHeadshotsIndex();
    const entry = index?.byPlayerId?.[id];
    const publicPath =
      String(entry?.file || '').trim() ||
      tennisHeadshotPublicPath(id, entry?.ext === 'png' ? 'png' : 'jpg');
    const stamp = index?.generatedAt || '1';
    const qs = new URLSearchParams({ v: encodeURIComponent(stamp).slice(0, 24) });
    const remoteUrl = String(entry?.remoteUrl || '');
    const paddedStudio =
      (entry?.source === 'tennis-com' && /\/tcf\/images\/players\//i.test(remoteUrl)) ||
      (entry?.source === 'wta' && /-Torso_/i.test(remoteUrl));
    const tightCrop =
      entry?.source === 'wta' &&
      /photoresources\.wtatennis\.com/i.test(remoteUrl) &&
      !/-Torso_/i.test(remoteUrl);
    if (paddedStudio) qs.set('crop', 'wide');
    else if (tightCrop) qs.set('crop', 'tight');
    return `${publicPath}?${qs.toString()}`;
  }
  const fromIndex = loadTennisHeadshotsIndex()?.byPlayerId?.[id];
  if (fromIndex && fromIndex.ok === false) {
    return String(remote || '').trim() || null;
  }
  const url = String(fromIndex?.remoteUrl || remote || '').trim();
  return url || null;
}
