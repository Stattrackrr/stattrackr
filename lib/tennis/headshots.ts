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
  return path.join(process.cwd(), 'data', 'tennis', 'headshots.json');
}

function tennisHeadshotsIndexFallbackPath(): string {
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
  const file = fs.existsSync(tennisHeadshotsIndexPath())
    ? tennisHeadshotsIndexPath()
    : tennisHeadshotsIndexFallbackPath();
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
  try {
    const dir = tennisHeadshotsPublicDir();
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        const match = /^(\d+)\.(?:jpg|png)$/i.exec(name);
        if (match) ids.add(match[1]);
      }
    }
  } catch {
    /* public headshot files are optional on Vercel */
  }
  runtime.localIds = ids;
  return ids;
}

function withHeadshotCrop(pathOrUrl: string, entry: TennisHeadshotEntry | undefined, stamp: string): string {
  const remoteUrl = String(entry?.remoteUrl || pathOrUrl);
  const qs = new URLSearchParams();
  if (stamp) qs.set('v', encodeURIComponent(stamp).slice(0, 24));
  const paddedStudio =
    (entry?.source === 'tennis-com' && /\/tcf\/images\/players\//i.test(remoteUrl)) ||
    (entry?.source === 'wta' && /-Torso_/i.test(remoteUrl));
  const tightCrop =
    entry?.source === 'wta' &&
    /photoresources\.wtatennis\.com/i.test(remoteUrl) &&
    !/-Torso_/i.test(remoteUrl);
  if (paddedStudio) qs.set('crop', 'wide');
  else if (tightCrop) qs.set('crop', 'tight');
  const query = qs.toString();
  if (!query) return pathOrUrl;
  return pathOrUrl.includes('?') ? `${pathOrUrl}&${query}` : `${pathOrUrl}?${query}`;
}

export function resolveTennisHeadshotUrl(
  playerId: string | null | undefined,
  remote?: string | null
): string | null {
  const id = String(playerId || '').trim();
  if (!id) return String(remote || '').trim() || null;
  const index = loadTennisHeadshotsIndex();
  const entry = index?.byPlayerId?.[id];
  const stamp = index?.generatedAt || '1';
  if (localHeadshotIds().has(id)) {
    const publicPath =
      String(entry?.file || '').trim() ||
      tennisHeadshotPublicPath(id, entry?.ext === 'png' ? 'png' : 'jpg');
    return withHeadshotCrop(publicPath, entry, stamp);
  }
  const url = String(entry?.remoteUrl || remote || '').trim();
  if (!url) return null;
  if (entry?.source === 'tennis-com' || entry?.source === 'wta') return withHeadshotCrop(url, entry, stamp);
  return url;
}
