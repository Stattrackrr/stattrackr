#!/usr/bin/env tsx
/**
 * Cache playing hand from ESPN tennis athlete bios for names in the API-Tennis cache.
 * Writes data/tennis/espn-hands.json. Resume-safe; skips hits and misses unless --refresh.
 *
 * Usage:
 *   npx tsx scripts/cache-tennis-hands.ts
 *   npx tsx scripts/cache-tennis-hands.ts --ranked-only
 *   npx tsx scripts/cache-tennis-hands.ts --refresh
 *   npx tsx scripts/cache-tennis-hands.ts --concurrency=4 --limit=200
 */
import fs from 'fs';
import path from 'path';
import {
  compactTennisName,
  espnHandsPath,
  foldTennisName,
  loadEspnHandsCache,
  normalizeTennisHand,
  tennisNameTokenKey,
  type EspnHandsCache,
  type TennisHand,
} from '../lib/tennis/hands';

function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | null {
  const pref = `--${name}=`;
  const inline = process.argv.find((a) => a.startsWith(pref));
  if (inline) return inline.slice(pref.length);
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx >= 0) return process.argv[idx + 1] ?? null;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const REFRESH = argFlag('refresh');
const RANKED_ONLY = argFlag('ranked-only');
const CONCURRENCY = Math.max(1, Number(argValue('concurrency')) || 4);
const LIMIT = Math.max(0, Number(argValue('limit')) || 0);
const HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
};

type SearchHit = { id: string; name: string };

function namesMatch(query: string, candidate: string): boolean {
  const qFold = foldTennisName(query);
  const cFold = foldTennisName(candidate);
  if (!qFold || !cFold) return false;
  if (qFold === cFold) return true;
  if (compactTennisName(query) === compactTennisName(candidate)) return true;
  const qTok = tennisNameTokenKey(query);
  const cTok = tennisNameTokenKey(candidate);
  if (qTok && cTok && qTok === cTok) return true;
  const qParts = qFold.split(' ').filter(Boolean);
  const cParts = cFold.split(' ').filter(Boolean);
  const qLast = qParts[qParts.length - 1];
  const cLast = cParts[cParts.length - 1];
  return Boolean(qLast && cLast && qLast === cLast && qLast.length >= 4);
}

function athleteIdFromUid(uid: string | undefined, web: string | undefined): string | null {
  const fromUid = String(uid || '').match(/a:(\d+)/i);
  if (fromUid) return fromUid[1];
  const fromWeb = String(web || '').match(/\/id\/(\d+)/i);
  return fromWeb ? fromWeb[1] : null;
}

async function espnGet(url: string): Promise<any> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.status === 429 || res.status >= 500) {
      const wait = attempt * 1500;
      console.warn(`[tennis-hands] HTTP ${res.status} — retry ${attempt} in ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) return null;
    return res.json();
  }
  return null;
}

async function searchEspn(name: string): Promise<SearchHit | null> {
  const queries = [name];
  const folded = foldTennisName(name);
  const parts = folded.split(' ').filter(Boolean);
  if (parts.length > 2) queries.push(`${parts[0]} ${parts[parts.length - 1]}`);
  if (parts.length >= 2) queries.push(parts.slice(-2).join(' '));

  for (const query of queries) {
    const url = `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(query)}`;
    const json = await espnGet(url);
    const groups = Array.isArray(json?.results) ? json.results : [];
    const players: SearchHit[] = [];
    for (const group of groups) {
      if (String(group?.type || '').toLowerCase() !== 'player') continue;
      for (const item of group.contents || []) {
        const sport = String(item?.sport || item?.description || '').toLowerCase();
        if (sport && sport !== 'tennis') continue;
        const id = athleteIdFromUid(item?.uid, item?.link?.web);
        const display = String(item?.displayName || '').trim();
        if (!id || !display) continue;
        players.push({ id, name: display });
      }
    }
    const exact = players.find((p) => namesMatch(name, p.name));
    if (exact) return exact;
    if (players.length === 1 && namesMatch(name, players[0].name)) return players[0];
  }
  return null;
}

async function athleteHand(espnId: string): Promise<{ hand: TennisHand; espnName: string } | null> {
  const json = await espnGet(
    `https://sports.core.api.espn.com/v2/sports/tennis/athletes/${espnId}`
  );
  const hand = normalizeTennisHand(json?.hand?.type || json?.hand?.abbreviation);
  const espnName = String(json?.fullName || json?.displayName || '').trim();
  if (!hand) return null;
  return { hand, espnName };
}

function loadNames(): string[] {
  const file = path.join(process.cwd(), 'data', 'tennis', 'api-tennis', 'cache.json');
  if (!fs.existsSync(file)) throw new Error(`API-Tennis cache missing: ${file}`);
  const cache = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    players?: Array<{ name?: string | null }>;
    matches?: Array<{ playerName?: string | null; opponent?: string | null }>;
    standings?: {
      ATP?: Array<{ name?: string | null }>;
      WTA?: Array<{ name?: string | null }>;
    };
  };
  const ranked = new Set<string>();
  for (const row of [...(cache.standings?.ATP || []), ...(cache.standings?.WTA || [])]) {
    if (row.name) ranked.add(row.name);
  }
  const rest = new Set<string>();
  for (const p of cache.players || []) if (p.name) rest.add(p.name);
  for (const row of cache.matches || []) {
    if (row.playerName) rest.add(row.playerName);
    if (row.opponent) rest.add(row.opponent);
  }
  const rankedList = [...ranked].sort((a, b) => a.localeCompare(b));
  if (RANKED_ONLY) return rankedList;
  const extra = [...rest].filter((n) => !ranked.has(n)).sort((a, b) => a.localeCompare(b));
  return [...rankedList, ...extra];
}

function writeCache(cache: EspnHandsCache) {
  const dest = espnHandsPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, dest);
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
}

async function main() {
  const names = loadNames();
  const cache = loadEspnHandsCache();
  if (REFRESH) {
    cache.hits = {};
    cache.misses = [];
  }
  const missSet = new Set(cache.misses.map((n) => foldTennisName(n)));
  let pending = names.filter((name) => {
    const key = foldTennisName(name);
    if (!key) return false;
    if (cache.hits[key]) return false;
    if (missSet.has(key)) return false;
    return true;
  });
  if (LIMIT) pending = pending.slice(0, LIMIT);

  console.log(
    `[tennis-hands] ${names.length} names, ${Object.keys(cache.hits).length} hits, ${cache.misses.length} misses, ${pending.length} to fetch`
  );

  let done = 0;
  let hits = 0;
  let misses = 0;
  await pool(pending, CONCURRENCY, async (name) => {
    const key = foldTennisName(name);
    try {
      const found = await searchEspn(name);
      const bio = found ? await athleteHand(found.id) : null;
      if (found && bio) {
        cache.hits[key] = { hand: bio.hand, espnId: found.id, espnName: bio.espnName || found.name };
        hits += 1;
      } else {
        cache.misses.push(name);
        missSet.add(key);
        misses += 1;
      }
    } catch (err) {
      console.warn(`[tennis-hands] fail ${name}:`, err);
      cache.misses.push(name);
      missSet.add(key);
      misses += 1;
    }
    done += 1;
    if (done % 25 === 0 || done === pending.length) {
      cache.fetchedAt = new Date().toISOString();
      writeCache(cache);
      console.log(`[tennis-hands] ${done}/${pending.length} (+${hits} R/L, ${misses} miss)`);
    }
  });

  cache.fetchedAt = new Date().toISOString();
  cache.misses = [...new Set(cache.misses)].sort((a, b) => a.localeCompare(b));
  writeCache(cache);
  console.log(
    `[tennis-hands] done — ${Object.keys(cache.hits).length} hands, ${cache.misses.length} misses → ${espnHandsPath()}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
