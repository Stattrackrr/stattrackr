#!/usr/bin/env tsx
/**
 * Cache headshots for every active ATP/WTA player we already load on the tennis dashboard.
 *
 * Active = currently ranked OR played in the current season (same set as currentOnly roster).
 * Prefer ESPN CDN shots (current) when the athlete id is in espn-hands.json.
 * Fall back to API-Tennis logos so coverage stays wide.
 * Files land in public/images/tennis/headshots/{id}.jpg
 *
 * Usage:
 *   npx tsx scripts/cache-tennis-headshots.ts
 *   npx tsx scripts/cache-tennis-headshots.ts --refresh
 *   npx tsx scripts/cache-tennis-headshots.ts --concurrency=8
 */
import fs from 'fs';
import path from 'path';
import { TENNIS_CURRENT_YEAR } from '../lib/tennis/constants';
import {
  apiTennisCachePath,
  type ApiTennisCache,
  type ApiTennisPlayer,
} from '../lib/tennis/apiTennis';
import {
  foldTennisName,
  loadEspnHandsCache,
} from '../lib/tennis/hands';
import {
  tennisHeadshotFilePath,
  tennisHeadshotPublicPath,
  tennisHeadshotsIndexPath,
  tennisHeadshotsPublicDir,
  type TennisHeadshotSource,
  type TennisHeadshotsIndex,
} from '../lib/tennis/headshots';

function loadKey(): string {
  const envPath = path.join(process.cwd(), '.env.local');
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const m = text.match(/^API_TENNIS_KEY=["']?([^"'\r\n]+)["']?/m);
  const key = (m?.[1] || process.env.API_TENNIS_KEY || '').trim();
  if (!key) throw new Error('API_TENNIS_KEY missing from .env.local');
  return key;
}

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

const KEY = loadKey();
const BASE = 'https://api.api-tennis.com/tennis/';
const REFRESH = argFlag('refresh');
const CONCURRENCY = Math.max(1, Number(argValue('concurrency')) || 4);

async function apiCall(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ APIkey: KEY, ...params });
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${BASE}?${qs.toString()}`, { headers: { Accept: 'application/json' } });
    if (res.status === 429 || res.status >= 500) {
      const wait = attempt * 1500;
      console.warn(`[tennis-headshots] HTTP ${res.status} — retry ${attempt} in ${wait}ms`);
      await sleep(wait);
      continue;
    }
    const json = await res.json();
    if (!json?.success && attempt < 4) {
      await sleep(attempt * 800);
      continue;
    }
    return json;
  }
  return null;
}

function slugToken(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function guessLogoUrl(playerId: string, name: string): string | null {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .map(slugToken)
    .filter(Boolean);
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  const first = parts[0]?.[0];
  if (!last || !first) return null;
  return `https://api.api-tennis.com/logo-tennis/${playerId}_${first}-${last}.jpg`;
}

function loadIndex(): TennisHeadshotsIndex {
  const file = tennisHeadshotsIndexPath();
  if (!fs.existsSync(file)) {
    return { generatedAt: new Date().toISOString(), source: 'mixed', byPlayerId: {}, missing: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as TennisHeadshotsIndex;
    return {
      generatedAt: parsed.generatedAt || new Date().toISOString(),
      source: 'mixed',
      byPlayerId: parsed.byPlayerId || {},
      missing: Array.isArray(parsed.missing) ? parsed.missing : [],
    };
  } catch {
    return { generatedAt: new Date().toISOString(), source: 'mixed', byPlayerId: {}, missing: [] };
  }
}

function saveIndex(index: TennisHeadshotsIndex) {
  index.generatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(tennisHeadshotsIndexPath()), { recursive: true });
  fs.writeFileSync(tennisHeadshotsIndexPath(), JSON.stringify(index, null, 2));
}

function activePlayers(cache: ApiTennisCache): ApiTennisPlayer[] {
  const ranked = new Set([
    ...(cache.standings?.ATP || []).map((row) => String(row.playerId)),
    ...(cache.standings?.WTA || []).map((row) => String(row.playerId)),
  ]);
  const playedThisYear = new Set(
    (cache.matches || [])
      .filter((row) => row.season === TENNIS_CURRENT_YEAR)
      .map((row) => String(row.playerId))
  );
  const byId = new Map<string, ApiTennisPlayer>();
  for (const p of cache.players || []) byId.set(String(p.playerId), { ...p });
  for (const row of cache.matches || []) {
    const id = String(row.playerId);
    if (byId.has(id)) continue;
    if (!ranked.has(id) && row.season !== TENNIS_CURRENT_YEAR) continue;
    byId.set(id, {
      playerId: id,
      name: row.playerName,
      tour: row.tour,
      ioc: row.ioc,
      hand: row.hand,
      height: row.height,
      rank: row.playerRank,
      rankPoints: row.rankPoints,
      imageUrl: null,
    });
  }
  return [...byId.values()].filter((p) => ranked.has(p.playerId) || playedThisYear.has(p.playerId));
}

function espnHeadshotUrl(espnId: string): string {
  return `https://a.espncdn.com/i/headshots/tennis/players/full/${espnId}.png`;
}

let espnIdByName: Record<string, string> | null = null;

function espnIdForName(name: string): string | null {
  if (!espnIdByName) {
    espnIdByName = {};
    for (const [key, hit] of Object.entries(loadEspnHandsCache().hits)) {
      if (hit.espnId) espnIdByName[key] = String(hit.espnId);
    }
  }
  return espnIdByName[foldTennisName(name)] || null;
}

async function downloadImage(url: string, dest: string): Promise<boolean> {
  const espn = /espncdn\.com/i.test(url);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Referer: espn ? 'https://www.espn.com/tennis/' : 'https://api.api-tennis.com/',
        },
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(attempt * 800);
        continue;
      }
      if (!res.ok) return false;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 400) return false;
      const type = String(res.headers.get('content-type') || '').toLowerCase();
      if (type.includes('text/html') || type.includes('application/json')) return false;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      return true;
    } catch {
      await sleep(attempt * 400);
    }
  }
  return false;
}

async function mapPool<T>(items: T[], n: number, fn: (item: T, idx: number) => Promise<void>): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
}

function knownRemoteUrl(player: ApiTennisPlayer, index: TennisHeadshotsIndex): string | null {
  const fromIndex = index.byPlayerId[player.playerId]?.remoteUrl;
  return String(fromIndex || player.imageUrl || '').trim() || null;
}

function candidateUrls(player: ApiTennisPlayer, index: TennisHeadshotsIndex): string[] {
  const urls: string[] = [];
  const known = knownRemoteUrl(player, index);
  if (known) urls.push(known);
  const guessed = guessLogoUrl(player.playerId, player.name);
  if (guessed && !urls.includes(guessed)) urls.push(guessed);
  return urls;
}

function markEntry(
  index: TennisHeadshotsIndex,
  player: ApiTennisPlayer,
  remoteUrl: string | null,
  ok: boolean,
  extra?: { source?: TennisHeadshotSource; espnId?: string | null }
) {
  const prev = index.byPlayerId[player.playerId];
  index.byPlayerId[player.playerId] = {
    name: player.name,
    tour: player.tour,
    remoteUrl,
    file: ok ? tennisHeadshotPublicPath(player.playerId) : prev?.file || null,
    ok,
    source: extra?.source || prev?.source,
    espnId: extra?.espnId || prev?.espnId,
  };
}

function refreshMissing(index: TennisHeadshotsIndex, players: ApiTennisPlayer[]) {
  index.missing = players.filter((p) => !index.byPlayerId[p.playerId]?.ok).map((p) => p.playerId);
}

async function fetchPlayerLogo(playerId: string): Promise<string | null> {
  const json = await apiCall({ method: 'get_players', player_key: playerId });
  const row = Array.isArray(json?.result) ? json.result[0] : null;
  return String(row?.player_logo || '').trim() || null;
}

async function main() {
  const cacheFile = apiTennisCachePath();
  if (!fs.existsSync(cacheFile)) {
    throw new Error(`Missing ${cacheFile} — run npx tsx scripts/fetch-api-tennis.ts first`);
  }
  console.log('[tennis-headshots] loading match cache…');
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as ApiTennisCache;
  const players = activePlayers(cache);
  const index = loadIndex();
  fs.mkdirSync(tennisHeadshotsPublicDir(), { recursive: true });
  for (const file of fs.readdirSync(tennisHeadshotsPublicDir())) {
    const id = file.replace(/\.jpg$/i, '');
    if (!id || id === file) continue;
    const existing = index.byPlayerId[id];
    if (existing?.ok && existing.file) continue;
    index.byPlayerId[id] = {
      name: existing?.name,
      tour: existing?.tour,
      remoteUrl: existing?.remoteUrl || null,
      file: tennisHeadshotPublicPath(id),
      ok: true,
    };
  }

  console.log(
    `[tennis-headshots] active players=${players.length} (ranked or ${TENNIS_CURRENT_YEAR} matches)`
  );

  const wantEspn = players.filter((p) => {
    const espnId = espnIdForName(p.name);
    if (!espnId) return false;
    const entry = index.byPlayerId[p.playerId];
    return REFRESH || entry?.source !== 'espn';
  });
  console.log(`[tennis-headshots] trying ESPN for ${wantEspn.length} (concurrency=${CONCURRENCY})`);
  let espnOk = 0;
  let espnMiss = 0;
  await mapPool(wantEspn, CONCURRENCY, async (player) => {
    const espnId = espnIdForName(player.name);
    if (!espnId) return;
    const dest = tennisHeadshotFilePath(player.playerId);
    const url = espnHeadshotUrl(espnId);
    if (await downloadImage(url, dest)) {
      markEntry(index, player, url, true, { source: 'espn', espnId });
      espnOk += 1;
    } else {
      espnMiss += 1;
      const prev = index.byPlayerId[player.playerId];
      if (prev) prev.espnId = espnId;
    }
    if ((espnOk + espnMiss) % 100 === 0) {
      saveIndex(index);
      console.log(`[tennis-headshots] ESPN ${espnOk} hit / ${espnMiss} miss`);
    }
  });
  saveIndex(index);
  console.log(`[tennis-headshots] ESPN done hit=${espnOk} miss=${espnMiss}`);

  const needLookup = players.filter((p) => {
    if (index.byPlayerId[p.playerId]?.source === 'espn') return false;
    if (!REFRESH && fs.existsSync(tennisHeadshotFilePath(p.playerId))) return false;
    return REFRESH || !knownRemoteUrl(p, index);
  });
  const needLookupIds = new Set(needLookup.map((p) => p.playerId));
  for (const player of players) {
    if (needLookupIds.has(player.playerId)) continue;
    if (index.byPlayerId[player.playerId]?.source === 'espn') continue;
    const dest = tennisHeadshotFilePath(player.playerId);
    markEntry(index, player, knownRemoteUrl(player, index), !REFRESH && fs.existsSync(dest), {
      source: fs.existsSync(dest) ? 'api-tennis' : undefined,
    });
  }

  console.log(
    `[tennis-headshots] looking up ${needLookup.length} logos via get_players (concurrency=${CONCURRENCY})`
  );
  let lookedUp = 0;
  await mapPool(needLookup, CONCURRENCY, async (player) => {
    const logo = await fetchPlayerLogo(player.playerId);
    const dest = tennisHeadshotFilePath(player.playerId);
    markEntry(index, player, logo, Boolean(logo && fs.existsSync(dest)));
    lookedUp += 1;
    if (lookedUp % 50 === 0) {
      refreshMissing(index, players);
      saveIndex(index);
      console.log(`[tennis-headshots] looked up ${lookedUp}/${needLookup.length}`);
    }
  });
  refreshMissing(index, players);
  saveIndex(index);

  const toDownload = players.filter((p) => {
    if (index.byPlayerId[p.playerId]?.source === 'espn') return false;
    const dest = tennisHeadshotFilePath(p.playerId);
    if (!REFRESH && fs.existsSync(dest)) return false;
    return candidateUrls(p, index).length > 0;
  });
  console.log(`[tennis-headshots] downloading ${toDownload.length} API-Tennis files (concurrency=${CONCURRENCY})`);

  let downloaded = 0;
  let failed = 0;
  await mapPool(toDownload, CONCURRENCY, async (player) => {
    const dest = tennisHeadshotFilePath(player.playerId);
    let used: string | null = null;
    for (const url of candidateUrls(player, index)) {
      if (await downloadImage(url, dest)) {
        used = url;
        break;
      }
    }
    markEntry(index, player, used || knownRemoteUrl(player, index), Boolean(used), {
      source: used ? 'api-tennis' : undefined,
    });
    if (used) downloaded += 1;
    else failed += 1;
    if ((downloaded + failed) % 100 === 0) {
      refreshMissing(index, players);
      saveIndex(index);
      console.log(`[tennis-headshots] downloaded ${downloaded} failed ${failed} / ${toDownload.length}`);
    }
  });

  for (const player of players) {
    const dest = tennisHeadshotFilePath(player.playerId);
    const entry = index.byPlayerId[player.playerId];
    if (!entry) continue;
    if (fs.existsSync(dest)) {
      entry.ok = true;
      entry.file = tennisHeadshotPublicPath(player.playerId);
    }
  }
  refreshMissing(index, players);
  saveIndex(index);

  const okCount = players.filter((p) => index.byPlayerId[p.playerId]?.ok).length;
  const espnCount = players.filter((p) => index.byPlayerId[p.playerId]?.source === 'espn').length;
  const remoteCount = players.filter((p) => index.byPlayerId[p.playerId]?.remoteUrl).length;
  console.log(
    `[tennis-headshots] done active=${players.length} withFile=${okCount} espn=${espnCount} withRemote=${remoteCount} apiDownloaded=${downloaded} apiFailed=${failed} missing=${index.missing.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
