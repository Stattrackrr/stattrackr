/**
 * Build data/tennis/tournament-surfaces.json
 *
 * Sources:
 * - Tennismylife ATP match CSVs (tourney_name + surface)
 * - Sackmann ATP Challenger + WTA match CSVs
 * - Wikipedia ATP / WTA / Challenger / WTA 125 calendars
 * - API-Tennis get_tournaments (names + keys we actually look up)
 *
 * Usage: npx tsx scripts/build-tennis-surfaces.ts
 */
import fs from 'fs';
import path from 'path';
import {
  canonicalTennisSurface,
  foldTourneyName,
  tennisSurfaceKeys,
  tennisSurfacesPath,
  type TennisSurfaceMapFile,
  type TennisSurfaceName,
} from '../lib/tennis/surfaces';

const RAW_DIR = path.join(process.cwd(), 'data', 'tennis', 'surface-raw');
const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
const UA =
  'StatTrackrTennisSurfaces/1.0 (https://github.com; tournament surface calendar lookup)';

const TML_BASE = 'https://raw.githubusercontent.com/Tennismylife/TML-Database/master';
const SACKMANN_BASE = 'https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';

const WIKI_PAGES: Array<{ page: string; year: number; challenger: boolean }> = [];
for (const year of [2024, 2025, 2026]) {
  WIKI_PAGES.push({ page: `${year}_ATP_Tour`, year, challenger: false });
  WIKI_PAGES.push({ page: `${year}_WTA_Tour`, year, challenger: false });
  WIKI_PAGES.push({ page: `${year}_ATP_Challenger_Tour`, year, challenger: true });
  WIKI_PAGES.push({ page: `${year}_WTA_125_tournaments`, year, challenger: true });
  WIKI_PAGES.push({ page: `${year}_WTA_125`, year, challenger: true });
}

const MANUAL: Array<{ name: string; surface: TennisSurfaceName }> = [
  { name: 'Wimbledon', surface: 'Grass' },
  { name: 'Roland Garros', surface: 'Clay' },
  { name: 'French Open', surface: 'Clay' },
  { name: 'Australian Open', surface: 'Hard' },
  { name: 'US Open', surface: 'Hard' },
  { name: 'Indian Wells', surface: 'Hard' },
  { name: 'BNP Paribas Open', surface: 'Hard' },
  { name: 'Miami Open', surface: 'Hard' },
  { name: 'Miami Masters', surface: 'Hard' },
  { name: 'Monte Carlo', surface: 'Clay' },
  { name: 'Monte-Carlo', surface: 'Clay' },
  { name: 'Madrid', surface: 'Clay' },
  { name: 'Rome', surface: 'Clay' },
  { name: 'Italian Open', surface: 'Clay' },
  { name: 'Cincinnati', surface: 'Hard' },
  { name: 'Shanghai', surface: 'Hard' },
  { name: 'Paris Masters', surface: 'Hard' },
  { name: 'Rolex Paris Masters', surface: 'Hard' },
  { name: 'Queens Club', surface: 'Grass' },
  { name: "Queen's Club", surface: 'Grass' },
  { name: 'Halle', surface: 'Grass' },
  { name: 's Hertogenbosch', surface: 'Grass' },
  { name: 'Rosmalen', surface: 'Grass' },
  { name: 'Eastbourne', surface: 'Grass' },
  { name: 'Newport', surface: 'Grass' },
  { name: 'Houston', surface: 'Clay' },
  { name: 'Charleston', surface: 'Clay' },
  { name: 'Barcelona', surface: 'Clay' },
  { name: 'Hamburg', surface: 'Clay' },
  { name: 'Umag', surface: 'Clay' },
  { name: 'Gstaad', surface: 'Clay' },
  { name: 'Kitzbuhel', surface: 'Clay' },
  { name: 'Bastad', surface: 'Clay' },
  { name: 'Buenos Aires', surface: 'Clay' },
  { name: 'Rio de Janeiro', surface: 'Clay' },
  { name: 'Santiago', surface: 'Clay' },
  { name: 'Estoril', surface: 'Clay' },
  { name: 'Geneva', surface: 'Clay' },
  { name: 'Lyon', surface: 'Clay' },
];

type Pending = { surface: TennisSurfaceName | 'CONFLICT'; year: number };

const pending = new Map<string, Pending>();
const sources = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url: string, dest: string, retries = 4): Promise<string | null> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 200) {
    return fs.readFileSync(dest, 'utf8');
  }
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: '*/*', 'User-Agent': UA },
        signal: AbortSignal.timeout(90000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
      const text = await res.text();
      fs.writeFileSync(dest, text);
      return text;
    } catch (err) {
      lastErr = err;
      await sleep(attempt * 800);
    }
  }
  console.warn(`[surfaces] skip ${url}: ${lastErr}`);
  return null;
}

function consider(key: string, surface: TennisSurfaceName, year: number) {
  const folded = foldTourneyName(key);
  if (folded.length < 3) return;
  const cur = pending.get(folded);
  if (!cur) {
    pending.set(folded, { surface, year });
    return;
  }
  if (cur.surface === 'CONFLICT') return;
  if (year > cur.year) {
    pending.set(folded, { surface, year });
    return;
  }
  if (year === cur.year && cur.surface !== surface) {
    pending.set(folded, { surface: 'CONFLICT', year });
  }
}

function addNamed(name: string, surface: TennisSurfaceName, year: number, opts?: { city?: string }) {
  const canon = canonicalTennisSurface(surface);
  if (!canon) return;
  for (const key of tennisSurfaceKeys(name)) consider(key, canon, year);
  if (opts?.city) consider(opts.city, canon, year);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function expandSourceNames(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const out = [trimmed];
  const ch = trimmed.match(/^(.*?)(?:\s+(\d+))?\s+CH$/i);
  if (ch) {
    const base = (ch[1] || '').trim();
    if (base) {
      out.push(base);
      out.push(`${base} Challenger`);
      if (ch[2]) out.push(`${base} ${ch[2]} Challenger`);
    }
  }
  return out;
}

function ingestMatchCsv(text: string, year: number, source: string) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return 0;
  const header = parseCsvLine(lines[0] || '').map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf('tourney_name');
  const surfaceIdx = header.indexOf('surface');
  const dateIdx = header.indexOf('tourney_date');
  if (nameIdx < 0 || surfaceIdx < 0) return 0;
  let n = 0;
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = parseCsvLine(line);
    const name = cols[nameIdx] || '';
    const surface = canonicalTennisSurface(cols[surfaceIdx]);
    if (!name || !surface) continue;
    const dateRaw = dateIdx >= 0 ? cols[dateIdx] || '' : '';
    const rowYear = /^\d{8}$/.test(dateRaw) ? Number(dateRaw.slice(0, 4)) : year;
    const stamp = `${foldTourneyName(name)}|${surface}|${rowYear}`;
    if (seen.has(stamp)) continue;
    seen.add(stamp);
    for (const alias of expandSourceNames(name)) addNamed(alias, surface, rowYear);
    n += 1;
  }
  if (n) sources.add(source);
  return n;
}

function wikiLinkTitles(before: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before))) {
    const page = m[1].trim();
    const display = (m[2] || page).trim();
    const blob = `${page} ${display}`;
    if (/singles|doubles|qualifying|\bdraw\b|points breakdown/i.test(blob)) continue;
    out.push(display);
    const noYear = display.replace(/^20\d{2}\s+/, '').trim();
    if (noYear && noYear !== display) out.push(noYear);
  }
  return out;
}

const SKIP_CITY = new Set([
  'paris',
  'london',
  'melbourne',
  'new york',
  'new york city',
  'beijing',
  'tokyo',
  'sydney',
  'perth',
]);

function isSkipCity(name: string): boolean {
  return SKIP_CITY.has(foldTourneyName(name));
}

function ingestWikiText(text: string, year: number, challenger: boolean, page: string) {
  const surfaceRe = /\b(Hard|Clay|Grass|Carpet)(?:\s*\([^)]+\))?/i;
  let added = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/<[^>]+>/g, ' ');
    const match = surfaceRe.exec(line);
    if (!match || match.index == null) continue;
    const surface = canonicalTennisSurface(match[0]);
    if (!surface) continue;
    const before = line.slice(0, match.index);
    const titles = wikiLinkTitles(before).filter((title) => !isSkipCity(title));
    if (!titles.length) continue;
    const eventName = titles[0];
    const city = titles.length >= 2 ? titles[titles.length - 1] : undefined;
    addNamed(eventName, surface, year);
    if (city && foldTourneyName(city) !== foldTourneyName(eventName) && !isSkipCity(city)) {
      addNamed(city, surface, year);
      if (challenger) addNamed(`${city} Challenger`, surface, year);
    }
    added += 1;
  }
  if (added) sources.add(`wikipedia:${page}`);
  return added;
}

async function ingestWikiPage(page: string, year: number, challenger: boolean) {
  const dest = path.join(RAW_DIR, 'wiki', `${page}.json`);
  const url = `${WIKI_API}?${new URLSearchParams({
    action: 'parse',
    page,
    prop: 'wikitext',
    format: 'json',
    formatversion: '2',
  }).toString()}`;
  const text = await fetchText(url, dest);
  if (!text) return 0;
  try {
    const json = JSON.parse(text) as { parse?: { wikitext?: string }; error?: { code?: string } };
    if (json.error?.code === 'missingtitle' || !json.parse?.wikitext) return 0;
    return ingestWikiText(json.parse.wikitext, year, challenger, page);
  } catch {
    return 0;
  }
}

function loadApiKey(): string {
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    const text = fs.readFileSync(envPath, 'utf8');
    const m = text.match(/^API_TENNIS_KEY=["']?([^"'\r\n]+)["']?/m);
    return (m?.[1] || process.env.API_TENNIS_KEY || '').trim();
  } catch {
    return String(process.env.API_TENNIS_KEY || '').trim();
  }
}

type ApiTournament = { tournament_key?: string | number; tournament_name?: string; event_type_type?: string };

async function loadApiTournaments(): Promise<ApiTournament[]> {
  const key = loadApiKey();
  if (!key) {
    console.warn('[surfaces] API_TENNIS_KEY missing — skipping get_tournaments keys');
    return [];
  }
  const dest = path.join(RAW_DIR, 'api-tennis-tournaments.json');
  const url = `https://api.api-tennis.com/tennis/?${new URLSearchParams({
    method: 'get_tournaments',
    APIkey: key,
  }).toString()}`;
  const text = await fetchText(url, dest);
  if (!text) return [];
  try {
    const json = JSON.parse(text) as { success?: number; result?: ApiTournament[] };
    const rows = Array.isArray(json.result) ? json.result : [];
    if (rows.length) sources.add('api-tennis:get_tournaments');
    return rows;
  } catch {
    return [];
  }
}

function resolvedNames(): Record<string, TennisSurfaceName> {
  const names: Record<string, TennisSurfaceName> = {};
  let conflicts = 0;
  for (const [key, entry] of pending) {
    if (entry.surface === 'CONFLICT') {
      conflicts += 1;
      continue;
    }
    names[key] = entry.surface;
  }
  console.log(`[surfaces] name keys=${Object.keys(names).length} conflictsDropped=${conflicts}`);
  return names;
}

function lookupInNames(names: Record<string, TennisSurfaceName>, title: string): TennisSurfaceName | null {
  for (const key of tennisSurfaceKeys(title)) {
    const hit = names[key];
    if (hit) return hit;
  }
  return null;
}

function lookupApiTournament(
  names: Record<string, TennisSurfaceName>,
  name: string,
  type: string
): TennisSurfaceName | null {
  const stripped = name.replace(/^(ATP|WTA|ITF)\s+/i, '').trim();
  const queries = [name];
  if (stripped && stripped !== name) queries.push(stripped);
  if (/challenger/i.test(type)) {
    queries.push(`${stripped} Challenger`, `${stripped} CH`);
  }
  for (const q of queries) {
    const hit = lookupInNames(names, q);
    if (hit) return hit;
  }
  return null;
}

async function main() {
  console.log('[surfaces] building tournament surface map');

  for (const year of YEARS) {
    const tml = await fetchText(`${TML_BASE}/${year}.csv`, path.join(RAW_DIR, 'tml', `${year}.csv`));
    if (tml) {
      const n = ingestMatchCsv(tml, year, `tml:${year}`);
      console.log(`[surfaces] tml ${year}: unique=${n}`);
    }
    const chall = await fetchText(
      `${SACKMANN_BASE}/atp/atp_matches_qual_chall_${year}.csv`,
      path.join(RAW_DIR, 'sackmann', `atp_matches_qual_chall_${year}.csv`)
    );
    if (chall) {
      const n = ingestMatchCsv(chall, year, `sackmann-chall:${year}`);
      console.log(`[surfaces] sackmann chall ${year}: unique=${n}`);
    }
    const wta = await fetchText(
      `${SACKMANN_BASE}/wta/wta_matches_${year}.csv`,
      path.join(RAW_DIR, 'sackmann', `wta_matches_${year}.csv`)
    );
    if (wta) {
      const n = ingestMatchCsv(wta, year, `sackmann-wta:${year}`);
      console.log(`[surfaces] sackmann wta ${year}: unique=${n}`);
    }
  }

  for (const page of WIKI_PAGES) {
    const n = await ingestWikiPage(page.page, page.year, page.challenger);
    if (n) console.log(`[surfaces] wiki ${page.page}: rows=${n}`);
    await sleep(350);
  }

  for (const row of MANUAL) addNamed(row.name, row.surface, 2099);

  const names = resolvedNames();
  const apiTournaments = await loadApiTournaments();
  const byKey: Record<string, TennisSurfaceName> = {};
  const tournaments: NonNullable<TennisSurfaceMapFile['tournaments']> = [];
  let matched = 0;
  for (const row of apiTournaments) {
    const key = String(row.tournament_key ?? '').trim();
    const name = String(row.tournament_name || '').trim();
    const type = String(row.event_type_type || '').trim();
    if (!key && !name) continue;
    const surface = lookupApiTournament(names, name, type);
    if (key && surface) byKey[key] = surface;
    if (surface) matched += 1;
    if (key) tournaments.push({ key, name, type, surface });
  }

  const out: TennisSurfaceMapFile = {
    fetchedAt: new Date().toISOString(),
    sources: [...sources].sort(),
    byKey,
    names,
    tournaments,
  };
  const dest = tennisSurfacesPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(out)}\n`);
  const kb = Math.round(fs.statSync(dest).size / 1024);
  console.log(
    `[surfaces] wrote ${dest} (${kb} KB) names=${Object.keys(names).length} byKey=${Object.keys(byKey).length} apiTournaments=${tournaments.length} apiMatched=${matched}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
