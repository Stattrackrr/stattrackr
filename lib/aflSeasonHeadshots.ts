import fs from 'fs';
import path from 'path';
import { normalizeAflPlayerNameForMatch, toCanonicalAflPlayerName } from './aflPlayerNameUtils';

type AflSeasonHeadshotsFile = {
  season?: string | number;
  generatedAt?: string;
  source?: string;
  description?: string;
  byName?: Record<string, string>;
  missing?: string[];
};

const HEADSHOT_FILE_CACHE_TTL_MS = 5 * 60 * 1000;
const FIRST_NAME_ALIAS_TO_CANON: Record<string, string> = {
  cam: 'cameron',
  lachie: 'lachlan',
  josh: 'joshua',
  matt: 'matthew',
  mitch: 'mitchell',
  nick: 'nicholas',
  ollie: 'oliver',
  sam: 'samuel',
  tom: 'thomas',
  zac: 'zachary',
};

const seasonHeadshotCache = new Map<
  string,
  {
    expiresAt: number;
    byNameRaw: Record<string, string>;
    byNameNorm: Map<string, string>;
    byNameLooseNorm: Map<string, string>;
    missingNorm: Set<string>;
    missingLooseNorm: Set<string>;
  }
>();

export function getAflHeadshotsSeason(input?: string | number | null): string {
  if (typeof input === 'number' && Number.isFinite(input)) return String(input);
  if (typeof input === 'string' && input.trim()) return input.trim();
  const envSeason = process.env.AFL_CURRENT_SEASON?.trim();
  if (envSeason) return envSeason;
  return String(new Date().getFullYear());
}

export function aflSeasonHeadshotsFilePath(seasonInput?: string | number | null): string {
  const season = getAflHeadshotsSeason(seasonInput);
  return path.join(process.cwd(), 'data', `afl-player-headshots-${season}.json`);
}

function normalizeByName(byName: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, url] of Object.entries(byName)) {
    if (typeof url !== 'string') continue;
    const trimmedUrl = url.trim();
    if (!trimmedUrl) continue;
    const canon = toCanonicalAflPlayerName(name);
    const norm = normalizeAflPlayerNameForMatch(canon || name);
    if (!norm) continue;
    out.set(norm, trimmedUrl);
  }
  return out;
}

function toLooseNameNorm(name: string): string {
  const base = normalizeAflPlayerNameForMatch(name);
  if (!base) return '';
  const words = base.split(' ').filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0];
  const canonicalFirst = FIRST_NAME_ALIAS_TO_CANON[first] ?? first;
  return [canonicalFirst, ...words.slice(1)]
    .join(' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeByNameLoose(byName: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, url] of Object.entries(byName)) {
    if (typeof url !== 'string') continue;
    const trimmedUrl = url.trim();
    if (!trimmedUrl) continue;
    const canon = toCanonicalAflPlayerName(name);
    const loose = toLooseNameNorm(canon || name);
    if (!loose) continue;
    out.set(loose, trimmedUrl);
  }
  return out;
}

function normalizeMissing(missing: string[]): Set<string> {
  const out = new Set<string>();
  for (const name of missing) {
    if (typeof name !== 'string') continue;
    const canon = toCanonicalAflPlayerName(name);
    const norm = normalizeAflPlayerNameForMatch(canon || name);
    if (norm) out.add(norm);
  }
  return out;
}

function normalizeMissingLoose(missing: string[]): Set<string> {
  const out = new Set<string>();
  for (const name of missing) {
    if (typeof name !== 'string') continue;
    const canon = toCanonicalAflPlayerName(name);
    const loose = toLooseNameNorm(canon || name);
    if (loose) out.add(loose);
  }
  return out;
}

function loadSeasonHeadshots(seasonInput?: string | number | null): {
  byNameRaw: Record<string, string>;
  byNameNorm: Map<string, string>;
  byNameLooseNorm: Map<string, string>;
  missingNorm: Set<string>;
  missingLooseNorm: Set<string>;
} {
  const season = getAflHeadshotsSeason(seasonInput);
  const hit = seasonHeadshotCache.get(season);
  if (hit && hit.expiresAt > Date.now()) {
    return {
      byNameRaw: hit.byNameRaw,
      byNameNorm: hit.byNameNorm,
      byNameLooseNorm: hit.byNameLooseNorm,
      missingNorm: hit.missingNorm,
      missingLooseNorm: hit.missingLooseNorm,
    };
  }

  const filePath = aflSeasonHeadshotsFilePath(season);
  let parsed: AflSeasonHeadshotsFile = {};
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      parsed = JSON.parse(raw) as AflSeasonHeadshotsFile;
    } catch {
      parsed = {};
    }
  }

  const byNameRaw =
    parsed.byName && typeof parsed.byName === 'object' && !Array.isArray(parsed.byName)
      ? parsed.byName
      : {};
  const missing = Array.isArray(parsed.missing) ? parsed.missing : [];

  const value = {
    byNameRaw,
    byNameNorm: normalizeByName(byNameRaw),
    byNameLooseNorm: normalizeByNameLoose(byNameRaw),
    missingNorm: normalizeMissing(missing),
    missingLooseNorm: normalizeMissingLoose(missing),
  };
  seasonHeadshotCache.set(season, { ...value, expiresAt: Date.now() + HEADSHOT_FILE_CACHE_TTL_MS });
  return value;
}

export function getAflSeasonHeadshotUrl(playerName: string, seasonInput?: string | number | null): string | null {
  if (typeof playerName !== 'string' || !playerName.trim()) return null;
  const { byNameRaw, byNameNorm, byNameLooseNorm } = loadSeasonHeadshots(seasonInput);

  const canon = toCanonicalAflPlayerName(playerName);
  const direct = byNameRaw[canon] ?? byNameRaw[playerName.trim()];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const norm = normalizeAflPlayerNameForMatch(canon || playerName);
  if (!norm) return null;
  const strict = byNameNorm.get(norm);
  if (strict) return strict;
  const loose = toLooseNameNorm(canon || playerName);
  if (!loose) return null;
  return byNameLooseNorm.get(loose) ?? null;
}

export function isAflSeasonHeadshotKnownMissing(
  playerName: string,
  seasonInput?: string | number | null
): boolean {
  if (typeof playerName !== 'string' || !playerName.trim()) return false;
  const { missingNorm, missingLooseNorm } = loadSeasonHeadshots(seasonInput);
  const canon = toCanonicalAflPlayerName(playerName);
  const norm = normalizeAflPlayerNameForMatch(canon || playerName);
  if (!norm) return false;
  if (missingNorm.has(norm)) return true;
  const loose = toLooseNameNorm(canon || playerName);
  return loose ? missingLooseNorm.has(loose) : false;
}
