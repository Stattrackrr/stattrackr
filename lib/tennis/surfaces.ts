/**
 * Tournament → court surface lookup.
 * Built by scripts/build-tennis-surfaces.ts into data/tennis/tournament-surfaces.json.
 */

import fs from 'fs';
import path from 'path';

export type TennisSurfaceName = 'Hard' | 'Clay' | 'Grass';

export type TennisSurfaceMapFile = {
  fetchedAt: string;
  sources: string[];
  byKey: Record<string, TennisSurfaceName>;
  names: Record<string, TennisSurfaceName>;
  tournaments?: Array<{
    key: string;
    name: string;
    type: string;
    surface: TennisSurfaceName | null;
  }>;
};

type SurfaceRuntime = {
  mtime: number;
  file: TennisSurfaceMapFile | null;
};

function surfaceRuntime(): SurfaceRuntime {
  const g = globalThis as typeof globalThis & { __tennisSurfaces?: SurfaceRuntime };
  if (!g.__tennisSurfaces) g.__tennisSurfaces = { mtime: -1, file: null };
  return g.__tennisSurfaces;
}

export function tennisSurfacesPath(): string {
  return path.join(process.cwd(), 'data', 'tennis', 'tournament-surfaces.json');
}

export function tennisSurfacesMtime(): number {
  try {
    return fs.statSync(tennisSurfacesPath()).mtimeMs;
  } catch {
    return 0;
  }
}

export function foldTourneyName(name: string | null | undefined): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalTennisSurface(raw: string | null | undefined): TennisSurfaceName | null {
  const key = String(raw || '').trim().toLowerCase();
  if (!key) return null;
  if (key.includes('grass')) return 'Grass';
  if (key.includes('clay')) return 'Clay';
  if (key.includes('hard') || key.includes('carpet') || key.includes('acrylic')) return 'Hard';
  return null;
}

const TRAILING_DROP = /^(men|women|mens|womens|singles|doubles|atp|wta|itf|male|female)$/;

function stripApiNoise(fold: string): string {
  return fold
    .replace(/\bqualification\b/g, ' ')
    .replace(/\b(turkey|france|spain|italy|usa|united states|germany|australia|china|japan|brazil|argentina|portugal|netherlands|switzerland|austria|sweden|croatia|romania|morocco|mexico|canada|qatar|uae|united arab emirates|india|korea|taiwan|hong kong|new zealand|great britain|uk|england)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Longest-first keys for a tournament title (keeps "challenger" / city). */
export function tennisSurfaceKeys(name: string | null | undefined): string[] {
  const fold = foldTourneyName(name);
  if (!fold) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const key = stripApiNoise(value.replace(/\s+/g, ' ').trim());
    if (key.length < 3 || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };
  const pushVariants = (base: string) => {
    push(base);
    const parts = base.split(' ').filter(Boolean);
    while (parts.length > 1 && TRAILING_DROP.test(parts[parts.length - 1] || '')) {
      parts.pop();
      push(parts.join(' '));
    }
  };
  pushVariants(fold);
  const strippedLead = fold.replace(/^(atp|wta|itf)\s+/, '');
  if (strippedLead !== fold) pushVariants(strippedLead);
  if (/\bchallenger\b/.test(fold)) {
    pushVariants(fold.replace(/\bchallenger\b/g, 'ch'));
  }
  if (/\bch\b/.test(fold) && !/\bchallenger\b/.test(fold)) {
    pushVariants(fold.replace(/\bch\b/g, 'challenger'));
  }
  const noNum = fold.replace(/\s+\d+$/g, '').replace(/\s+\d+\s+/g, ' ').trim();
  if (noNum !== fold) pushVariants(noNum);
  return keys;
}

/** Last-resort name heuristics when the surface map has no hit. */
export function heuristicTennisSurface(name: string | null | undefined): TennisSurfaceName {
  const n = ` ${foldTourneyName(name)} `;
  if (
    / wimbledon | halle | queens club | eastbourne | hertogenbosch | mallorca | newport | berlin | nottingham | bad homburg | rosmalen | stuttgart | s hertogenbosch /.test(
      n
    )
  ) {
    return 'Grass';
  }
  if (
    / roland garros | french open | monte carlo | montecarlo | barcelona | madrid | rome | hamburg | bastad | geneva | lyon | estoril | buenos aires | rio de janeiro | rio | santiago | houston | charleston | istanbul | rabat | strasbourg | palermo | lausanne | gstaad | kitzbuhel | umag | bucharest | budapest | prague | marrakech | marrakesh | umea /.test(
      n
    )
  ) {
    return 'Clay';
  }
  return 'Hard';
}

function loadSurfaceFile(): TennisSurfaceMapFile | null {
  const runtime = surfaceRuntime();
  const mtime = tennisSurfacesMtime();
  if (runtime.mtime === mtime) return runtime.file;
  runtime.mtime = mtime;
  if (!mtime) {
    runtime.file = null;
    return null;
  }
  try {
    runtime.file = JSON.parse(fs.readFileSync(tennisSurfacesPath(), 'utf8')) as TennisSurfaceMapFile;
  } catch {
    runtime.file = null;
  }
  return runtime.file;
}

export function lookupTennisSurface(
  name?: string | null,
  tournamentKey?: string | number | null
): TennisSurfaceName {
  const file = loadSurfaceFile();
  const key = String(tournamentKey ?? '').trim();
  if (file && key) {
    const fromKey = file.byKey[key];
    if (fromKey) return fromKey;
  }
  if (file) {
    for (const folded of tennisSurfaceKeys(name)) {
      const hit = file.names[folded];
      if (hit) return hit;
    }
  }
  return heuristicTennisSurface(name);
}

export function applyTennisSurface<T extends { tourneyName?: string; tourneyId?: string; surface?: string; venue?: string | null }>(
  row: T
): T {
  const surface = lookupTennisSurface(row.tourneyName, row.tourneyId);
  if (row.surface === surface && row.venue === surface) return row;
  return { ...row, surface, venue: surface };
}
