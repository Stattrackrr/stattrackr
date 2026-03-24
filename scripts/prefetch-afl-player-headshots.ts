#!/usr/bin/env npx tsx

/**
 * Prefetch AFL player headshots for a season and persist a yearly cache file.
 *
 * Usage:
 *   npm run prefetch:afl:headshots
 *   npm run prefetch:afl:headshots -- --season=2026 --concurrency=6
 *   npm run prefetch:afl:headshots -- --refresh
 */

import fs from 'fs';
import path from 'path';
import { fetchClubSitePortraitUrl } from '../lib/aflClubPlayerPortrait';
import { getAflPlayerHeadshotUrl } from '../lib/aflPlayerHeadshots';
import { normalizeAflPlayerNameForMatch, toCanonicalAflPlayerName } from '../lib/aflPlayerNameUtils';
import { footywireNicknameToOfficial, leagueTeamToOfficial, rosterTeamToInjuryTeam, toOfficialAflTeamDisplayName } from '../lib/aflTeamMapping';
import { aflSeasonHeadshotsFilePath, getAflHeadshotsSeason } from '../lib/aflSeasonHeadshots';

type PlayerSeed = { name: string; team?: string };
type HeadshotsFile = {
  season?: string | number;
  generatedAt?: string;
  source?: string;
  description?: string;
  byName?: Record<string, string>;
  missing?: string[];
};

function argValue(name: string): string | null {
  const exact = `--${name}`;
  const pref = `--${name}=`;
  const idx = process.argv.findIndex((a) => a === exact);
  if (idx >= 0) return process.argv[idx + 1] ?? null;
  const inline = process.argv.find((a) => a.startsWith(pref));
  return inline ? inline.slice(pref.length) : null;
}

function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function asInt(v: string | null, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readLeaguePlayers(season: string): PlayerSeed[] {
  const filePath = path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`);
  const data = readJsonFile<{ players?: Array<{ name?: string; team?: string }> }>(filePath);
  const rows = Array.isArray(data?.players) ? data.players : [];
  const out: PlayerSeed[] = [];
  for (const row of rows) {
    const name = String(row?.name ?? '').trim();
    if (!name) continue;
    const team = String(row?.team ?? '').trim() || undefined;
    out.push({ name, team });
  }
  return out;
}

function readRosterPlayers(season: string): PlayerSeed[] {
  const filePath = path.join(process.cwd(), 'data', `afl-roster-${season}.json`);
  const data = readJsonFile<{ players?: Array<{ name?: string; team?: string }> }>(filePath);
  const rows = Array.isArray(data?.players) ? data.players : [];
  const out: PlayerSeed[] = [];
  for (const row of rows) {
    const name = String(row?.name ?? '').trim();
    if (!name) continue;
    const team = String(row?.team ?? '').trim() || undefined;
    out.push({ name, team });
  }
  return out;
}

function resolveOfficialTeam(team?: string): string | undefined {
  if (!team || !team.trim()) return undefined;
  const t = team.trim();
  return (
    leagueTeamToOfficial(t) ||
    footywireNicknameToOfficial(t) ||
    rosterTeamToInjuryTeam(t) ||
    toOfficialAflTeamDisplayName(t) ||
    t
  );
}

function pickDisplayName(name: string): string {
  const canonical = toCanonicalAflPlayerName(name);
  return canonical || name.trim();
}

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

function normalizeName(name: string): string {
  return normalizeAflPlayerNameForMatch(pickDisplayName(name));
}

function normalizeLooseName(name: string): string {
  const strict = normalizeName(name);
  if (!strict) return '';
  const words = strict.split(' ').filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0];
  const canonicalFirst = FIRST_NAME_ALIAS_TO_CANON[first] ?? first;
  return [canonicalFirst, ...words.slice(1)]
    .join(' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toSortedObject(map: Map<string, string>): Record<string, string> {
  const pairs = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en'));
  return Object.fromEntries(pairs);
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<void>
): Promise<void> {
  let index = 0;
  const runOne = async (): Promise<void> => {
    while (true) {
      const i = index++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => runOne()));
}

async function main(): Promise<void> {
  const season = getAflHeadshotsSeason(argValue('season'));
  const concurrency = asInt(argValue('concurrency'), 5);
  const refresh = argFlag('refresh');
  const seasonNum = Number.parseInt(season, 10);
  const previousSeason = Number.isFinite(seasonNum) ? String(seasonNum - 1) : '';

  const leaguePlayers = readLeaguePlayers(season);
  const rosterPlayers = readRosterPlayers(season);
  const fallbackLeague = previousSeason ? readLeaguePlayers(previousSeason) : [];
  const fallbackRoster = previousSeason ? readRosterPlayers(previousSeason) : [];
  const seeds = [...leaguePlayers, ...rosterPlayers, ...fallbackLeague, ...fallbackRoster];

  if (seeds.length === 0) {
    throw new Error(
      `No AFL players found for ${season} (or fallback ${previousSeason || 'n/a'}). Run fetch scripts first.`
    );
  }

  const dedup = new Map<string, PlayerSeed>();
  for (const row of seeds) {
    const loose = normalizeLooseName(row.name);
    if (!loose || dedup.has(loose)) continue;
    dedup.set(loose, { name: pickDisplayName(row.name), team: resolveOfficialTeam(row.team) });
  }
  const players = [...dedup.values()];

  const outputPath = aflSeasonHeadshotsFilePath(season);
  const existing = readJsonFile<HeadshotsFile>(outputPath) ?? {};
  const existingByName = existing.byName && typeof existing.byName === 'object' ? existing.byName : {};
  const existingMissing = Array.isArray(existing.missing) ? existing.missing : [];

  const byName = new Map<string, string>();
  const byNorm = new Map<string, string>();
  const byLooseNorm = new Map<string, string>();
  for (const [name, url] of Object.entries(existingByName)) {
    if (typeof url !== 'string' || !url.trim()) continue;
    const display = pickDisplayName(name);
    byName.set(display, url.trim());
    const norm = normalizeName(display);
    if (norm) byNorm.set(norm, display);
    const loose = normalizeLooseName(display);
    if (loose) byLooseNorm.set(loose, display);
  }

  const missingByLooseNorm = new Map<string, string>();
  for (const m of existingMissing.map((n) => pickDisplayName(n)).filter(Boolean)) {
    const loose = normalizeLooseName(m);
    if (loose && !missingByLooseNorm.has(loose)) missingByLooseNorm.set(loose, m);
  }
  let reused = 0;
  let reusedAlias = 0;
  let fetched = 0;
  let fetchedManual = 0;
  let misses = 0;

  console.log(`Prefetching AFL headshots for season ${season}`);
  console.log(`Players to evaluate: ${players.length}`);
  console.log(`Output file: ${path.relative(process.cwd(), outputPath)}`);
  console.log(`Concurrency: ${concurrency} | Refresh mode: ${refresh ? 'on' : 'off'}\n`);

  await runWithConcurrency(players, concurrency, async (player, idx) => {
    const displayName = pickDisplayName(player.name);
    const norm = normalizeName(displayName);
    const loose = normalizeLooseName(displayName);
    const linePrefix = `[${idx + 1}/${players.length}] ${displayName}`;

    if (!refresh && norm && byNorm.has(norm)) {
      reused += 1;
      if (loose) missingByLooseNorm.delete(loose);
      if ((idx + 1) % 40 === 0) console.log(`${linePrefix} -> reused`);
      return;
    }
    if (!refresh && loose && byLooseNorm.has(loose)) {
      reused += 1;
      reusedAlias += 1;
      missingByLooseNorm.delete(loose);
      if ((idx + 1) % 40 === 0) console.log(`${linePrefix} -> reused-alias`);
      return;
    }

    const manual = getAflPlayerHeadshotUrl(displayName);
    if (manual) {
      byName.set(displayName, manual);
      if (norm) byNorm.set(norm, displayName);
      if (loose) byLooseNorm.set(loose, displayName);
      if (loose) missingByLooseNorm.delete(loose);
      fetched += 1;
      fetchedManual += 1;
      console.log(`${linePrefix} -> manual`);
      return;
    }

    const url = await fetchClubSitePortraitUrl(displayName, player.team);
    if (url) {
      byName.set(displayName, url);
      if (norm) byNorm.set(norm, displayName);
      if (loose) byLooseNorm.set(loose, displayName);
      if (loose) missingByLooseNorm.delete(loose);
      fetched += 1;
      console.log(`${linePrefix} -> fetched`);
      return;
    }

    if (loose && byLooseNorm.has(loose)) {
      reused += 1;
      reusedAlias += 1;
      missingByLooseNorm.delete(loose);
      console.log(`${linePrefix} -> reused-alias-postfetch`);
      return;
    }
    misses += 1;
    if (loose && !missingByLooseNorm.has(loose)) {
      missingByLooseNorm.set(loose, displayName);
    }
    console.log(`${linePrefix} -> missing`);
  });

  const output: HeadshotsFile = {
    season,
    generatedAt: new Date().toISOString(),
    source: 'club-site-scrape',
    description:
      'Yearly AFL player headshots cache generated by scripts/prefetch-afl-player-headshots.ts',
    byName: toSortedObject(byName),
    missing: [...missingByLooseNorm.values()].sort((a, b) => a.localeCompare(b, 'en')),
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log('\nDone.');
  console.log(`Total players: ${players.length}`);
  console.log(`Headshots saved: ${Object.keys(output.byName ?? {}).length}`);
  console.log(`Known missing: ${output.missing?.length ?? 0}`);
  console.log(`Reused from existing file: ${reused} (alias matches: ${reusedAlias})`);
  console.log(`Fetched this run: ${fetched} (manual ${fetchedManual})`);
  console.log(`Misses this run: ${misses}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
