#!/usr/bin/env tsx
/**
 * Cache headshots for every active ATP/WTA player we already load on the tennis dashboard.
 *
 * Active = currently ranked OR played in the current season (same set as currentOnly roster).
 * Prefer official ATP/WTA square headshots, then ESPN, then API-Tennis logos.
 * ATP images are scraped from atptour.com (opens a Chrome window; Cloudflare
 * blocks headless fetches). WTA uses the official wtatennis.com photo catalog
 * (the same portraits as player pages / search), then the player-page
 * headshot, then the blob .png cutout / casual JPEG. Existing tennis.com
 * studio files are kept and not overwritten.
 * Files land in public/images/tennis/headshots/{id}.jpg or .png
 *
 * Usage:
 *   npx tsx scripts/cache-tennis-headshots.ts
 *   npx tsx scripts/cache-tennis-headshots.ts --refresh
 *   npx tsx scripts/cache-tennis-headshots.ts --atp-only
 *   npx tsx scripts/cache-tennis-headshots.ts --wta-only --wta-pages
 *   npx tsx scripts/cache-tennis-headshots.ts --concurrency=8
 *   npx tsx scripts/cache-tennis-headshots.ts --limit=20
 */
import fs from 'fs';
import path from 'path';
import type { Browser, Page } from 'puppeteer-core';
import { TENNIS_CURRENT_YEAR } from '../lib/tennis/constants';
import {
  apiTennisCachePath,
  type ApiTennisCache,
  type ApiTennisPlayer,
} from '../lib/tennis/apiTennis';
import {
  foldTennisName,
  loadEspnHandsCache,
  tennisNameTokenKey,
} from '../lib/tennis/hands';
import {
  tennisHeadshotFilePath,
  tennisHeadshotPublicPath,
  tennisHeadshotsIndexPath,
  tennisHeadshotsPublicDir,
  type TennisHeadshotEntry,
  type TennisHeadshotSource,
  type TennisHeadshotsIndex,
} from '../lib/tennis/headshots';
import { RANK_RAW_DIR } from './tennis-rank-sources';

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
const ATP_ONLY = argFlag('atp-only');
const WTA_ONLY = argFlag('wta-only');
const WTA_PAGES = argFlag('wta-pages');
const CONCURRENCY = Math.max(1, Number(argValue('concurrency')) || 4);
const LIMIT = Math.max(0, Number(argValue('limit')) || 0);
const ATP_HEADSHOT = (id: string) =>
  `https://www.atptour.com/-/media/alias/player-headshot/${id.toLowerCase()}`;
const WTA_HEADSHOT_JPG = (id: string) =>
  `https://wtafiles.blob.core.windows.net/images/headshots/${id}.jpg`;
const WTA_HEADSHOT_PNG = (id: string) =>
  `https://wtafiles.blob.core.windows.net/images/headshots/${id}.png`;
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

/** Latest TML ATP player code per folded name (KE29, A0E2, …). */
function loadAtpIdByName(): Map<string, string> {
  const files = [
    path.join(RANK_RAW_DIR, 'tml-official-2024.csv'),
    path.join(RANK_RAW_DIR, 'tml-official-2025.csv'),
    path.join(RANK_RAW_DIR, 'tml-2026.csv'),
  ];
  const latest = new Map<string, { date: number; id: string }>();
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const firstComma = line.indexOf(',');
      const second = line.indexOf(',', firstComma + 1);
      const lastComma = line.lastIndexOf(',');
      const idComma = line.lastIndexOf(',', lastComma - 1);
      if (firstComma < 0 || second < 0 || idComma <= second) continue;
      const date = Number(line.slice(0, firstComma).replace(/[-./]/g, '').slice(0, 8));
      const name = line.slice(second + 1, idComma).trim();
      const id = line.slice(idComma + 1, lastComma).trim();
      if (!Number.isFinite(date) || !name || !/^[A-Za-z0-9]{3,6}$/.test(id)) continue;
      const key = foldTennisName(name);
      const prev = latest.get(key);
      if (!prev || date >= prev.date) latest.set(key, { date, id: id.toLowerCase() });
    }
  }
  const out = new Map<string, string>();
  for (const [key, row] of latest) out.set(key, row.id);
  return out;
}

function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 800) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return true;
  const head = buf.slice(0, 32).toString('utf8').toLowerCase();
  if (head.includes('<!doctype') || head.includes('<html') || head.includes('{')) return false;
  return false;
}

function looksLikePng(buf: Buffer): boolean {
  return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

function fileLooksLikePng(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(8);
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  return looksLikePng(buf);
}

function hasStudioWtaHeadshot(playerId: string): boolean {
  return fileLooksLikePng(tennisHeadshotFilePath(playerId, 'png'));
}

async function downloadImage(url: string, dest: string): Promise<boolean> {
  const espn = /espncdn\.com/i.test(url);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'User-Agent': CHROME_UA,
          Referer: espn ? 'https://www.espn.com/tennis/' : 'https://api.api-tennis.com/',
        },
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(attempt * 800);
        continue;
      }
      if (!res.ok) return false;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!looksLikeImage(buf)) return false;
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
  extra?: {
    source?: TennisHeadshotSource;
    espnId?: string | null;
    atpId?: string | null;
    wtaId?: string | null;
    ext?: 'jpg' | 'png';
  }
) {
  const prev = index.byPlayerId[player.playerId];
  const ext = extra?.ext || prev?.ext || 'jpg';
  index.byPlayerId[player.playerId] = {
    name: player.name,
    tour: player.tour,
    remoteUrl,
    file: ok ? tennisHeadshotPublicPath(player.playerId, ext) : prev?.file || null,
    ok,
    ext,
    source: extra?.source || prev?.source,
    espnId: extra?.espnId || prev?.espnId,
    atpId: extra?.atpId || prev?.atpId,
    wtaId: extra?.wtaId || prev?.wtaId,
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

async function launchAtpBrowser(): Promise<Browser> {
  const puppeteerCore = await import('puppeteer-core');
  const puppeteer = await import('puppeteer');
  let executablePath = puppeteer.default.executablePath();
  if (!fs.existsSync(executablePath)) {
    const candidates = [
      process.env.CHROME_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ].filter(Boolean) as string[];
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) throw new Error('Chrome not found for ATP headshot scrape');
    executablePath = found;
  }
  return puppeteerCore.default.launch({
    executablePath,
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
}

async function prepareAtpPage(page: Page): Promise<void> {
  await page.setUserAgent(CHROME_UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
}

async function waitForAtpReady(page: Page): Promise<void> {
  try {
    await page.waitForFunction(() => !/just a moment|attention required/i.test(document.title), {
      timeout: 45000,
    });
  } catch {
    console.warn(`[tennis-headshots] ATP still on "${await page.title()}"`);
  }
}

async function fetchAtpHeadshotBytes(page: Page, atpId: string): Promise<Buffer | null> {
  const result = await page.evaluate(async (id) => {
    const res = await fetch(`/-/media/alias/player-headshot/${id}`, { credentials: 'include' });
    if (!res.ok) return { ok: false, status: res.status, b64: '' };
    const bytes = new Uint8Array(await res.arrayBuffer());
    const chunk = 0x2000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)));
    }
    return { ok: true, status: res.status, b64: btoa(binary) };
  }, atpId.toLowerCase());
  if (!result?.ok || !result.b64) return null;
  const buf = Buffer.from(result.b64, 'base64');
  return looksLikeImage(buf) ? buf : null;
}

async function scrapeAtpHeadshots(
  players: ApiTennisPlayer[],
  atpIdByName: Map<string, string>,
  index: TennisHeadshotsIndex
): Promise<{ ok: number; miss: number }> {
  let browser: Browser | null = null;
  let page: Page | null = null;
  let ok = 0;
  let miss = 0;
  const byAtpId = new Map<string, ApiTennisPlayer[]>();
  for (const player of players) {
    const atpId = atpIdByName.get(foldTennisName(player.name));
    if (!atpId) continue;
    const list = byAtpId.get(atpId) || [];
    list.push(player);
    byAtpId.set(atpId, list);
  }
  const rankOf = (atpId: string) => {
    const ranks = (byAtpId.get(atpId) || []).map((p) => Number(p.rank)).filter((n) => Number.isFinite(n) && n > 0);
    return ranks.length ? Math.min(...ranks) : 9999;
  };
  let ids = [...byAtpId.keys()];
  if (!REFRESH) {
    ids = ids.filter((atpId) => {
      const player = byAtpId.get(atpId)?.[0];
      return !player || index.byPlayerId[player.playerId]?.source !== 'atp';
    });
  }
  ids.sort((a, b) => rankOf(a) - rankOf(b));
  if (LIMIT) ids = ids.slice(0, LIMIT);

  const dead = (err: unknown) =>
    /detached Frame|Target closed|Session closed|Protocol error/i.test((err as Error)?.message || String(err));

  const openSession = async () => {
    if (page && !page.isClosed()) {
      try {
        await page.title();
        return;
      } catch {
        /* reopen */
      }
    }
    if (browser) await browser.close().catch(() => undefined);
    browser = await launchAtpBrowser();
    page = await browser.newPage();
    await prepareAtpPage(page);
    await page.goto('https://www.atptour.com/en/rankings/singles', {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    });
    await waitForAtpReady(page);
    await sleep(1200);
  };

  try {
    console.log(`[tennis-headshots] opening Chrome (visible) to scrape ${ids.length} ATP headshots…`);
    await openSession();
    if (!page) throw new Error('ATP Chrome page failed to open');
    const probe = await fetchAtpHeadshotBytes(page, 'ke29');
    if (!probe) {
      throw new Error('ATP headshot probe failed — Cloudflare still blocking image fetches');
    }
    console.log(`[tennis-headshots] ATP probe ke29 ok bytes=${probe.length} title="${await page.title()}"`);
    const khachanov =
      byAtpId.get('ke29')?.find((p) => String(p.tour || '').toUpperCase() !== 'WTA') || byAtpId.get('ke29')?.[0];
    if (khachanov) {
      fs.mkdirSync(tennisHeadshotsPublicDir(), { recursive: true });
      fs.writeFileSync(tennisHeadshotFilePath(khachanov.playerId), probe);
      markEntry(index, khachanov, ATP_HEADSHOT('ke29'), true, { source: 'atp', atpId: 'ke29' });
      saveIndex(index);
    }

    for (let i = 0; i < ids.length; i++) {
      const atpId = ids[i];
      const matches = byAtpId.get(atpId) || [];
      const player = matches.find((p) => String(p.tour || '').toUpperCase() !== 'WTA') || matches[0];
      if (!player) continue;
      if ((ok + miss) > 0 && (ok + miss) % 80 === 0) {
        try {
          await page.goto('https://www.atptour.com/en/rankings/singles', {
            waitUntil: 'domcontentloaded',
            timeout: 90000,
          });
          await waitForAtpReady(page);
        } catch (err) {
          if (dead(err)) await openSession();
        }
      }
      let buf: Buffer | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (!page || page.isClosed()) await openSession();
          buf = await fetchAtpHeadshotBytes(page!, atpId);
          break;
        } catch (err) {
          if (dead(err) && attempt < 3) {
            console.warn(`[tennis-headshots] Chrome session died — relaunching (${attempt}/3)`);
            await openSession();
            continue;
          }
          if (attempt === 3) {
            console.warn(`[tennis-headshots] ATP fail ${player.name} (${atpId}): ${(err as Error).message}`);
          }
        }
      }
      if (buf) {
        fs.mkdirSync(tennisHeadshotsPublicDir(), { recursive: true });
        fs.writeFileSync(tennisHeadshotFilePath(player.playerId), buf);
        markEntry(index, player, ATP_HEADSHOT(atpId), true, { source: 'atp', atpId, ext: 'jpg' });
        ok += 1;
      } else {
        miss += 1;
      }
      if ((ok + miss) % 25 === 0 || i === ids.length - 1) {
        saveIndex(index);
        console.log(`[tennis-headshots] ATP ${ok} hit / ${miss} miss (${i + 1}/${ids.length})`);
      }
      await sleep(140);
    }
    saveIndex(index);
    return { ok, miss };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

type WtaSearchRow = { id?: number | string; fullName?: string; firstName?: string; lastName?: string };

function pickWtaSearchHit(name: string, rows: WtaSearchRow[]): string | null {
  const fold = foldTennisName(name);
  const token = tennisNameTokenKey(name);
  const scored = rows
    .map((row) => {
      const full = String(row.fullName || `${row.firstName || ''} ${row.lastName || ''}`).trim();
      const id = String(row.id || '').trim();
      if (!id || !full) return null;
      const rowFold = foldTennisName(full);
      if (rowFold === fold) return { id, n: 0 };
      if (token && tennisNameTokenKey(full) === token) return { id, n: 1 };
      return null;
    })
    .filter((row): row is { id: string; n: number } => Boolean(row))
    .sort((a, b) => a.n - b.n);
  return scored[0]?.id || null;
}

async function searchWtaPlayerId(name: string): Promise<string | null> {
  const queries = [name];
  const parts = foldTennisName(name).split(' ').filter(Boolean);
  if (parts.length >= 2) queries.push(parts[parts.length - 1]);
  for (const query of queries) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const url = `https://api.wtatennis.com/tennis/players?page=0&pageSize=10&name=${encodeURIComponent(query)}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (res.status === 429 || res.status >= 500) {
          await sleep(attempt * 900);
          continue;
        }
        if (!res.ok) break;
        const json = (await res.json()) as { content?: WtaSearchRow[] };
        const hit = pickWtaSearchHit(name, Array.isArray(json.content) ? json.content : []);
        if (hit) return hit;
        break;
      } catch {
        await sleep(attempt * 400);
      }
    }
  }
  return null;
}

function wtaPlayerSlug(name: string): string {
  return (
    String(name || 'player')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'player'
  );
}

function tennisComSlugCandidates(name: string): string[] {
  const parts = foldTennisName(name).split(' ').filter(Boolean);
  const out: string[] = [];
  const push = (tokens: string[]) => {
    const slug = tokens.filter(Boolean).join('-');
    if (slug && !out.includes(slug)) out.push(slug);
  };
  push(parts);
  if (parts.length >= 3) {
    push([parts[parts.length - 1], ...parts.slice(0, -1)]);
    push([...parts.slice(1), parts[0]]);
  }
  return out;
}

function tennisComPageMatches(html: string, name: string): boolean {
  const title = String(html.match(/<title>([^<]+)/i)?.[1] || '')
    .replace(/&amp;/g, '&')
    .replace(/\s*\|\s*Tennis\.com.*$/i, '');
  const page = foldTennisName(title);
  const want = foldTennisName(name);
  if (!page || !want) return false;
  if (page.includes(want) || want.includes(page)) return true;
  const tokens = want.split(' ').filter((t) => t.length > 1);
  if (tokens.length < 2) return page.includes(tokens[0] || '');
  return tokens.every((t) => page.includes(t));
}

async function fetchTennisComHeadshot(name: string): Promise<{ url: string; buf: Buffer } | null> {
  for (const slug of tennisComSlugCandidates(name)) {
    const pageUrl = `https://www.tennis.com/players-rankings/${slug}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(pageUrl, {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'User-Agent': CHROME_UA,
            Referer: 'https://www.tennis.com/players-rankings',
          },
          redirect: 'follow',
        });
        if (res.status === 429 || res.status >= 500) {
          await sleep(attempt * 900);
          continue;
        }
        if (!res.ok) break;
        const html = await res.text();
        if (!tennisComPageMatches(html, name)) break;
        const playerMatch = html.match(
          /https:\/\/media\.prod\.tennis\.com\/v1\/tcf\/images\/players\/[0-9a-f-]+\/[^"'?\s>]+\.png/i
        );
        const headshotMatch = html.match(
          /https:\/\/media\.prod\.tennis\.com\/v1\/tcf\/images\/headshots\/[0-9a-f-]+\.png/i
        );
        const raw = playerMatch?.[0] || headshotMatch?.[0];
        if (!raw) break;
        const imgUrl = `${raw.split('?')[0]}?w=750&fm=png`;
        const buf = await fetchWtaImageBytes(imgUrl);
        if (buf && looksLikePng(buf) && buf.length > 8_000) return { url: imgUrl, buf };
        break;
      } catch {
        await sleep(attempt * 400);
      }
    }
  }
  return null;
}

type WtaCmsPhoto = { wtaId: string; url: string; rank: number; title: string };

type WtaCmsCatalog = {
  byWtaId: Map<string, WtaCmsPhoto>;
  byName: Map<string, WtaCmsPhoto>;
};

type WtaCmsPhotoRow = {
  title?: string;
  onDemandUrl?: string;
  tags?: Array<{ label?: string }>;
  references?: Array<{ id?: number | string; type?: string }>;
};

function wtaPhotoKindRank(tags: Array<{ label?: string }> | undefined): number {
  const labels = (tags || []).map((t) => String(t.label || '').toLowerCase());
  if (labels.includes('full-body-headshot')) return 0;
  if (labels.includes('head-cropped-photo')) return 1;
  return 2;
}

function cmsTitleToName(title: string): string {
  return foldTennisName(
    String(title || '')
      .replace(/[-_](torso|crop)_\d+$/i, '')
      .replace(/[_-]+/g, ' ')
  );
}

function wtaImageUrl(raw: string): string {
  const base = String(raw || '').split('?')[0].trim();
  return base ? `${base}?width=800` : '';
}

function extractWtaProfileHeadshotUrl(html: string): string | null {
  const wrap = html.match(
    /profile-header__headshot-wrap[\s\S]{0,5000}?src="(https:\/\/photoresources\.wtatennis\.com\/photo-resources\/[^"]+)"/i
  );
  const raw = wrap?.[1] || '';
  if (raw && !/Home-Share|Quick-Links|WTA_Logo|joint-logo/i.test(raw)) {
    return wtaImageUrl(raw);
  }
  const torso = html.match(
    /https:\/\/photoresources\.wtatennis\.com\/photo-resources\/[^"'\\\s>]+\-Torso_[^"'\\\s>]+\.(?:png|jpe?g)/i
  );
  return torso ? wtaImageUrl(torso[0]) : null;
}

function wtaCmsCachePath(): string {
  return path.join(path.dirname(tennisHeadshotsIndexPath()), 'wta-cms-headshots.json');
}

function catalogFromPhotos(photos: WtaCmsPhoto[]): WtaCmsCatalog {
  const byWtaId = new Map<string, WtaCmsPhoto>();
  const byName = new Map<string, WtaCmsPhoto>();
  for (const photo of photos) {
    if (!photo?.wtaId || !photo.url) continue;
    const prev = byWtaId.get(photo.wtaId);
    if (!prev || photo.rank < prev.rank) byWtaId.set(photo.wtaId, photo);
    const nameKey = cmsTitleToName(photo.title);
    if (nameKey.split(' ').filter(Boolean).length >= 2) {
      const prevName = byName.get(nameKey);
      if (!prevName || photo.rank < prevName.rank) byName.set(nameKey, photo);
    }
  }
  return { byWtaId, byName };
}

function readWtaCmsCache(): WtaCmsCatalog | null {
  const file = wtaCmsCachePath();
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { photos?: WtaCmsPhoto[] };
    const photos = Array.isArray(parsed.photos) ? parsed.photos : [];
    if (!photos.length) return null;
    return catalogFromPhotos(photos);
  } catch {
    return null;
  }
}

function writeWtaCmsCache(catalog: WtaCmsCatalog) {
  fs.mkdirSync(path.dirname(wtaCmsCachePath()), { recursive: true });
  fs.writeFileSync(
    wtaCmsCachePath(),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), photos: [...catalog.byWtaId.values()] },
      null,
      2
    )
  );
}

async function loadWtaCmsHeadshots(): Promise<WtaCmsCatalog> {
  const cached = readWtaCmsCache();
  if (WTA_PAGES) {
    if (cached) {
      console.log(`[tennis-headshots] WTA CMS using disk cache players=${cached.byWtaId.size}`);
      return cached;
    }
    console.log('[tennis-headshots] WTA CMS cache missing — skipping live catalog');
    return { byWtaId: new Map(), byName: new Map() };
  }

  const byWtaId = new Map<string, WtaCmsPhoto>();
  const byName = new Map<string, WtaCmsPhoto>();
  const pageSize = 100;
  let page = 0;
  let numPages = 1;
  let blocked = false;
  while (page < numPages) {
    const url = `https://api.wtatennis.com/content/wta/PHOTO/EN?tagNames=player-headshot&page=${page}&pageSize=${pageSize}`;
    let json: { pageInfo?: { numPages?: number; numEntries?: number }; content?: WtaCmsPhotoRow[] } | null =
      null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': CHROME_UA,
            Referer: 'https://www.wtatennis.com/rankings/singles',
          },
        });
        if (res.status === 429 || res.status >= 500) {
          blocked = res.status === 429;
          await sleep(attempt * 2000);
          continue;
        }
        if (!res.ok) break;
        json = (await res.json()) as typeof json;
        break;
      } catch {
        await sleep(attempt * 400);
      }
    }
    const rows = Array.isArray(json?.content) ? json.content : [];
    numPages = Math.max(1, Number(json?.pageInfo?.numPages) || page + (rows.length ? 2 : 1));
    if (page === 0) {
      console.log(
        `[tennis-headshots] WTA CMS catalog entries=${json?.pageInfo?.numEntries ?? rows.length} pages=${numPages}`
      );
    }
    for (const row of rows) {
      const wtaId = String(
        row.references?.find((r) => String(r.type || '').toUpperCase() === 'TENNIS_PLAYER')?.id || ''
      ).trim();
      const urlRaw = String(row.onDemandUrl || '').trim();
      if (!wtaId || !urlRaw) continue;
      const photo: WtaCmsPhoto = {
        wtaId,
        url: wtaImageUrl(urlRaw),
        rank: wtaPhotoKindRank(row.tags),
        title: String(row.title || ''),
      };
      const prev = byWtaId.get(wtaId);
      if (!prev || photo.rank < prev.rank) byWtaId.set(wtaId, photo);
      const nameKey = cmsTitleToName(photo.title);
      if (nameKey.split(' ').filter(Boolean).length >= 2) {
        const prevName = byName.get(nameKey);
        if (!prevName || photo.rank < prevName.rank) byName.set(nameKey, photo);
      }
    }
    if (!rows.length) break;
    page += 1;
    await sleep(150);
  }
  const live = { byWtaId, byName };
  if (byWtaId.size) {
    writeWtaCmsCache(live);
    return live;
  }
  if (cached) {
    console.warn(
      `[tennis-headshots] WTA CMS live fetch empty${blocked ? ' (rate limited)' : ''} — using disk cache players=${cached.byWtaId.size}`
    );
    return cached;
  }
  return live;
}

let wtaSiteBlocked = false;

async function fetchWtaPlayerPageHeadshot(
  wtaId: string,
  name: string
): Promise<{ url: string; buf: Buffer } | null> {
  if (wtaSiteBlocked) return null;
  const pageUrl = `https://www.wtatennis.com/players/${wtaId}/${wtaPlayerSlug(name)}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(pageUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': CHROME_UA,
          Referer: 'https://www.wtatennis.com/rankings/singles',
        },
      });
      if (res.status === 429 || res.status >= 500) {
        if (res.status === 429 && attempt >= 3) {
          wtaSiteBlocked = true;
          console.warn('[tennis-headshots] WTA site rate limited — stopping player-page scrapes');
        }
        await sleep(attempt * 8000);
        continue;
      }
      if (!res.ok) return null;
      const imgUrl = extractWtaProfileHeadshotUrl(await res.text());
      if (!imgUrl) return null;
      const buf = await fetchWtaImageBytes(imgUrl);
      await sleep(400);
      if (buf && looksLikeImage(buf) && buf.length > 8_000) return { url: imgUrl, buf };
      return null;
    } catch {
      await sleep(attempt * 400);
    }
  }
  return null;
}

async function fetchWtaImageBytes(url: string): Promise<Buffer | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'image/png,image/jpeg,image/*,*/*;q=0.8',
          'User-Agent': CHROME_UA,
          Referer: 'https://www.wtatennis.com/',
        },
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(attempt * 700);
        continue;
      }
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return looksLikeImage(buf) ? buf : null;
    } catch {
      await sleep(attempt * 400);
    }
  }
  return null;
}

function writeWtaHeadshotFile(
  playerId: string,
  buf: Buffer
): 'jpg' | 'png' {
  const ext: 'jpg' | 'png' = looksLikePng(buf) ? 'png' : 'jpg';
  fs.mkdirSync(tennisHeadshotsPublicDir(), { recursive: true });
  fs.writeFileSync(tennisHeadshotFilePath(playerId, ext), buf);
  const other = tennisHeadshotFilePath(playerId, ext === 'png' ? 'jpg' : 'png');
  if (fs.existsSync(other)) fs.unlinkSync(other);
  return ext;
}

function wtaIdFromEntry(entry?: TennisHeadshotEntry | null): string {
  const direct = String(entry?.wtaId || '').trim();
  if (direct) return direct;
  const match = String(entry?.remoteUrl || '').match(/\/headshots\/(\d+)\.(?:png|jpe?g)/i);
  return match?.[1] || '';
}

function hasOfficialWtaPortrait(playerId: string, entry?: TennisHeadshotEntry): boolean {
  if (entry?.source === 'tennis-com' && hasStudioWtaHeadshot(playerId)) return true;
  const remote = String(entry?.remoteUrl || '');
  if (entry?.source !== 'wta' || !/photoresources\.wtatennis\.com/i.test(remote)) return false;
  return (
    fs.existsSync(tennisHeadshotFilePath(playerId, 'png')) ||
    fs.existsSync(tennisHeadshotFilePath(playerId, 'jpg'))
  );
}

async function downloadWtaHeadshot(
  playerId: string,
  wtaId: string,
  name: string
): Promise<{ url: string; ext: 'jpg' | 'png' } | null> {
  const fromPage = await fetchWtaPlayerPageHeadshot(wtaId, name);
  if (fromPage) {
    return { url: fromPage.url, ext: writeWtaHeadshotFile(playerId, fromPage.buf) };
  }
  const pngBuf = await fetchWtaImageBytes(WTA_HEADSHOT_PNG(wtaId));
  if (pngBuf && looksLikePng(pngBuf)) {
    writeWtaHeadshotFile(playerId, pngBuf);
    return { url: WTA_HEADSHOT_PNG(wtaId), ext: 'png' };
  }
  const jpgBuf = pngBuf || (await fetchWtaImageBytes(WTA_HEADSHOT_JPG(wtaId)));
  if (!jpgBuf) return null;
  return { url: WTA_HEADSHOT_JPG(wtaId), ext: writeWtaHeadshotFile(playerId, jpgBuf) };
}

async function scrapeWtaHeadshots(
  players: ApiTennisPlayer[],
  index: TennisHeadshotsIndex
): Promise<{ ok: number; miss: number }> {
  const catalog = await loadWtaCmsHeadshots();
  console.log(
    `[tennis-headshots] WTA CMS players with photos=${catalog.byWtaId.size} named=${catalog.byName.size}`
  );

  const ranked = [...players].sort((a, b) => {
    const ra = Number(a.rank);
    const rb = Number(b.rank);
    const na = Number.isFinite(ra) && ra > 0 ? ra : 9999;
    const nb = Number.isFinite(rb) && rb > 0 ? rb : 9999;
    return na - nb;
  });
  let list = ranked.filter((p) => {
    if (!String(p.name || '').trim()) return false;
    if (REFRESH) return true;
    return !hasOfficialWtaPortrait(p.playerId, index.byPlayerId[p.playerId]);
  });
  if (LIMIT) list = list.slice(0, LIMIT);

  const needId = list.filter((p) => !wtaIdFromEntry(index.byPlayerId[p.playerId]));
  for (const player of list) {
    const wtaId = wtaIdFromEntry(index.byPlayerId[player.playerId]);
    if (!wtaId) continue;
    const prev = index.byPlayerId[player.playerId];
    if (prev) prev.wtaId = wtaId;
    else markEntry(index, player, null, false, { wtaId });
  }
  if (!WTA_PAGES && needId.length) {
    console.log(`[tennis-headshots] WTA resolving ${needId.length} missing player IDs`);
    await mapPool(needId, 1, async (player) => {
      const wtaId = await searchWtaPlayerId(player.name);
      await sleep(400);
      if (!wtaId) return;
      const prev = index.byPlayerId[player.playerId];
      if (prev) prev.wtaId = wtaId;
      else markEntry(index, player, null, false, { wtaId });
    });
  } else if (needId.length) {
    console.log(`[tennis-headshots] WTA skipping ${needId.length} ID lookups (--wta-pages)`);
  }

  const pool = Math.min(CONCURRENCY, WTA_PAGES ? 2 : 4);
  console.log(`[tennis-headshots] WTA downloading ${list.length} official site headshots (concurrency=${pool})`);
  let ok = 0;
  let miss = 0;
  await mapPool(list, pool, async (player) => {
    const wtaId = wtaIdFromEntry(index.byPlayerId[player.playerId]);
    const cms =
      (wtaId && catalog.byWtaId.get(wtaId)) || catalog.byName.get(foldTennisName(player.name)) || null;
    const hasFile =
      fs.existsSync(tennisHeadshotFilePath(player.playerId, 'png')) ||
      fs.existsSync(tennisHeadshotFilePath(player.playerId, 'jpg'));
    if (cms) {
      const buf = await fetchWtaImageBytes(cms.url);
      if (buf && looksLikeImage(buf) && buf.length > 8_000) {
        const ext = writeWtaHeadshotFile(player.playerId, buf);
        markEntry(index, player, cms.url, true, { source: 'wta', wtaId: cms.wtaId || wtaId, ext });
        ok += 1;
      } else if (wtaId) {
        const saved = await downloadWtaHeadshot(player.playerId, wtaId, player.name);
        if (saved && /photoresources\.wtatennis\.com/i.test(saved.url)) {
          markEntry(index, player, saved.url, true, { source: 'wta', wtaId, ext: saved.ext });
          ok += 1;
        } else if (!hasFile && saved) {
          markEntry(index, player, saved.url, true, { source: 'wta', wtaId, ext: saved.ext });
          ok += 1;
        } else if (!hasFile) {
          markEntry(index, player, WTA_HEADSHOT_JPG(wtaId), false, { wtaId });
          miss += 1;
        }
      } else if (!hasFile) {
        miss += 1;
      }
    } else if (wtaId) {
      const saved = await downloadWtaHeadshot(player.playerId, wtaId, player.name);
      if (saved && /photoresources\.wtatennis\.com/i.test(saved.url)) {
        markEntry(index, player, saved.url, true, { source: 'wta', wtaId, ext: saved.ext });
        ok += 1;
      } else if (!hasFile && saved) {
        markEntry(index, player, saved.url, true, { source: 'wta', wtaId, ext: saved.ext });
        ok += 1;
      } else if (!hasFile) {
        markEntry(index, player, WTA_HEADSHOT_JPG(wtaId), false, { wtaId });
        miss += 1;
      }
    } else if (!hasFile) {
      miss += 1;
    }
    if ((ok + miss) % 25 === 0) {
      saveIndex(index);
      console.log(`[tennis-headshots] WTA ${ok} hit / ${miss} miss`);
    }
  });
  saveIndex(index);
  return { ok, miss };
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
    const match = file.match(/^(.+)\.(jpg|jpeg|png)$/i);
    if (!match) continue;
    const id = match[1];
    const ext = match[2].toLowerCase() === 'png' ? 'png' : 'jpg';
    const existing = index.byPlayerId[id];
    if (existing?.ok && existing.file && existing.ext === 'png') continue;
    if (existing?.ok && existing.file && ext === 'jpg' && existing.ext === 'png') continue;
    index.byPlayerId[id] = {
      name: existing?.name,
      tour: existing?.tour,
      remoteUrl: existing?.remoteUrl || null,
      file: tennisHeadshotPublicPath(id, ext),
      ok: true,
      ext,
      source: existing?.source,
      espnId: existing?.espnId,
      atpId: existing?.atpId,
      wtaId: existing?.wtaId,
    };
  }

  console.log(
    `[tennis-headshots] active players=${players.length} (ranked or ${TENNIS_CURRENT_YEAR} matches)`
  );

  const atpIdByName = loadAtpIdByName();
  const atpPlayers = players.filter((p) => {
    const tour = String(p.tour || '').toUpperCase();
    if (tour === 'WTA') return false;
    return atpIdByName.has(foldTennisName(p.name));
  });
  const needAtp = atpPlayers.filter((p) => {
    const entry = index.byPlayerId[p.playerId];
    if (!REFRESH && entry?.source === 'atp' && fs.existsSync(tennisHeadshotFilePath(p.playerId))) return false;
    return true;
  });
  console.log(
    `[tennis-headshots] ATP ids mapped=${atpIdByName.size} players=${atpPlayers.length} needRefresh=${needAtp.length}`
  );
  if (!WTA_ONLY && needAtp.length) {
    const atp = await scrapeAtpHeadshots(atpPlayers, atpIdByName, index);
    saveIndex(index);
    console.log(`[tennis-headshots] ATP done hit=${atp.ok} miss=${atp.miss}`);
  }

  const wtaPlayers = players.filter((p) => String(p.tour || '').toUpperCase() === 'WTA');
  console.log(`[tennis-headshots] WTA players=${wtaPlayers.length}`);
  if (!ATP_ONLY) {
    const wta = await scrapeWtaHeadshots(wtaPlayers, index);
    saveIndex(index);
    console.log(`[tennis-headshots] WTA done hit=${wta.ok} miss=${wta.miss}`);
  }

  if (ATP_ONLY || WTA_ONLY) {
    refreshMissing(index, players);
    saveIndex(index);
    const atpCount = players.filter((p) => index.byPlayerId[p.playerId]?.source === 'atp').length;
    const wtaCount = players.filter((p) => index.byPlayerId[p.playerId]?.source === 'wta').length;
    console.log(`[tennis-headshots] --${ATP_ONLY ? 'atp' : 'wta'}-only stop withFileAtp=${atpCount} withFileWta=${wtaCount}`);
    return;
  }

  const wantEspn = players.filter((p) => {
    if (index.byPlayerId[p.playerId]?.source === 'atp' || index.byPlayerId[p.playerId]?.source === 'wta' || index.byPlayerId[p.playerId]?.source === 'tennis-com') return false;
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
    const src = index.byPlayerId[p.playerId]?.source;
    if (src === 'atp' || src === 'wta' || src === 'tennis-com' || src === 'espn') return false;
    if (!REFRESH && fs.existsSync(tennisHeadshotFilePath(p.playerId))) return false;
    return REFRESH || !knownRemoteUrl(p, index);
  });
  const needLookupIds = new Set(needLookup.map((p) => p.playerId));
  for (const player of players) {
    if (needLookupIds.has(player.playerId)) continue;
    const src = index.byPlayerId[player.playerId]?.source;
    if (src === 'atp' || src === 'wta' || src === 'tennis-com' || src === 'espn') continue;
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
    const src = index.byPlayerId[p.playerId]?.source;
    if (src === 'atp' || src === 'wta' || src === 'tennis-com' || src === 'espn') return false;
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
    const png = tennisHeadshotFilePath(player.playerId, 'png');
    const jpg = tennisHeadshotFilePath(player.playerId, 'jpg');
    const entry = index.byPlayerId[player.playerId];
    if (!entry) continue;
    if (fs.existsSync(png)) {
      entry.ok = true;
      entry.ext = 'png';
      entry.file = tennisHeadshotPublicPath(player.playerId, 'png');
    } else if (fs.existsSync(jpg)) {
      entry.ok = true;
      entry.ext = entry.ext === 'png' ? 'jpg' : entry.ext || 'jpg';
      entry.file = tennisHeadshotPublicPath(player.playerId, 'jpg');
    }
  }
  refreshMissing(index, players);
  saveIndex(index);

  const okCount = players.filter((p) => index.byPlayerId[p.playerId]?.ok).length;
  const atpCount = players.filter((p) => index.byPlayerId[p.playerId]?.source === 'atp').length;
  const wtaCount = players.filter((p) => index.byPlayerId[p.playerId]?.source === 'wta').length;
  const espnCount = players.filter((p) => index.byPlayerId[p.playerId]?.source === 'espn').length;
  const remoteCount = players.filter((p) => index.byPlayerId[p.playerId]?.remoteUrl).length;
  console.log(
    `[tennis-headshots] done active=${players.length} withFile=${okCount} atp=${atpCount} wta=${wtaCount} espn=${espnCount} withRemote=${remoteCount} apiDownloaded=${downloaded} apiFailed=${failed} missing=${index.missing.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
