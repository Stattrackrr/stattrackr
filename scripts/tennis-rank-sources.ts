/**
 * Ranking-only downloads/parsers for match-day ATP/WTA overlays.
 * No match CSVs — rankings lists + player name tables only.
 */
import fs from 'fs';
import path from 'path';

export const RANK_RAW_DIR = path.join(process.cwd(), 'data', 'tennis', 'rank-raw');
export const TML_BASE = 'https://raw.githubusercontent.com/Tennismylife/TML-Rankings-Database/main';
export const SACKMANN = 'https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main';
export const ATP_WEEKS_API = 'https://atp-rankings-data-visualization.onrender.com';
export const TE_BASE = 'https://www.tennisexplorer.com';

export type RankRow = { date: number; rank: number; name: string; points: number };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseDateInt(raw: string): number | null {
  const digits = String(raw || '').replace(/[-./]/g, '').slice(0, 8);
  if (!/^\d{8}$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

export function ymdFromInt(date: number): string {
  const s = String(date);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export function rankingWeekMondayInt(now = new Date()): number {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

export function mondaysBetween(fromInt: number, toInt: number): number[] {
  const y = Math.floor(fromInt / 10000);
  const m = Math.floor((fromInt % 10000) / 100) - 1;
  const day = fromInt % 100;
  const d = new Date(Date.UTC(y, m, day));
  const dow = d.getUTCDay();
  if (dow !== 1) d.setUTCDate(d.getUTCDate() + ((8 - dow) % 7));
  const out: number[] = [];
  while (true) {
    const n = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    if (n > toInt) break;
    if (n >= fromInt) out.push(n);
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

export async function fetchToFile(
  url: string,
  dest: string,
  opts?: { timeoutMs?: number; retries?: number }
): Promise<{ text: string; fromCache: boolean }> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 200) {
    return { text: fs.readFileSync(dest, 'utf8'), fromCache: true };
  }
  const timeoutMs = opts?.timeoutMs ?? 60000;
  const retries = opts?.retries ?? 4;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: '*/*', 'User-Agent': UA },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
      const text = await res.text();
      fs.writeFileSync(dest, text);
      return { text, fromCache: false };
    } catch (err) {
      lastErr = err;
      await sleep(attempt * 1500);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function parseTmlCsv(text: string): RankRow[] {
  const rows: RankRow[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const firstComma = line.indexOf(',');
    const second = line.indexOf(',', firstComma + 1);
    const lastComma = line.lastIndexOf(',');
    const idComma = line.lastIndexOf(',', lastComma - 1);
    if (firstComma < 0 || second < 0 || idComma <= second) continue;
    const date = parseDateInt(line.slice(0, firstComma));
    const rank = Number(line.slice(firstComma + 1, second));
    const name = line.slice(second + 1, idComma).trim();
    const points = Number(line.slice(lastComma + 1));
    if (date == null || !Number.isFinite(rank) || rank <= 0 || !name) continue;
    rows.push({ date, rank, name, points: Number.isFinite(points) ? points : 0 });
  }
  return rows;
}

export function parseSackmannPlayers(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < 3) continue;
    const id = parts[0].trim();
    const first = parts[1].trim();
    const last = parts[2].trim();
    if (!id || (!first && !last)) continue;
    map.set(id, `${first} ${last}`.replace(/\s+/g, ' ').trim());
  }
  return map;
}

export function parseSackmannRankings(
  text: string,
  players: Map<string, string>,
  minDate: number,
  maxDate: number
): RankRow[] {
  const rows: RankRow[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const c1 = line.indexOf(',');
    const c2 = line.indexOf(',', c1 + 1);
    const c3 = line.indexOf(',', c2 + 1);
    if (c1 < 0 || c2 < 0) continue;
    const date = parseDateInt(line.slice(0, c1));
    if (date == null || date < minDate || date > maxDate) continue;
    const rank = Number(line.slice(c1 + 1, c2));
    const playerId = (c3 < 0 ? line.slice(c2 + 1) : line.slice(c2 + 1, c3)).trim();
    const points = c3 < 0 ? 0 : Number(line.slice(c3 + 1).split(',')[0]);
    if (!Number.isFinite(rank) || rank <= 0) continue;
    const name = players.get(playerId);
    if (!name) continue;
    rows.push({ date, rank, name, points: Number.isFinite(points) ? points : 0 });
  }
  return rows;
}

type AtpWeekPayload = {
  week?: string;
  rankings?: Array<{ rank?: string | number; name?: string; points?: string | number }>;
};

export function parseAtpWeekJson(text: string, fallbackDate: number): RankRow[] {
  let json: AtpWeekPayload;
  try {
    json = JSON.parse(text) as AtpWeekPayload;
  } catch {
    return [];
  }
  const date = parseDateInt(json.week || '') ?? fallbackDate;
  const rows: RankRow[] = [];
  for (const row of json.rankings || []) {
    const rank = Number(String(row.rank ?? '').replace(/[^\d]/g, ''));
    const name = String(row.name || '').trim();
    const points = Number(String(row.points ?? '').replace(/,/g, ''));
    if (!Number.isFinite(rank) || rank <= 0 || !name) continue;
    rows.push({ date, rank, name, points: Number.isFinite(points) ? points : 0 });
  }
  return rows;
}

export function parseTennisExplorerHtml(html: string): { date: number | null; rows: RankRow[] } {
  const dm = html.match(/rankings on\s+-\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/i);
  let date: number | null = null;
  if (dm) {
    const day = dm[1].padStart(2, '0');
    const month = dm[2].padStart(2, '0');
    date = parseDateInt(`${dm[3]}${month}${day}`);
  }
  const rows: RankRow[] = [];
  const re =
    /<td class="rank first">(\d+)\.<\/td>[\s\S]*?<td class="t-name"><a[^>]*>([\s\S]*?)<\/a><\/td>[\s\S]*?<td class="long-point">([\d\s,]+)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const rank = Number(m[1]);
    const name = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const points = Number(m[3].replace(/[^\d]/g, ''));
    if (!Number.isFinite(rank) || rank <= 0 || !name) continue;
    if (date == null) continue;
    rows.push({ date, rank, name, points: Number.isFinite(points) ? points : 0 });
  }
  return { date, rows };
}

export async function loadTmlOfficialYear(year: number): Promise<RankRow[]> {
  const dest = path.join(RANK_RAW_DIR, `tml-official-${year}.csv`);
  const url = `${TML_BASE}/Official%20ATP%20Rankings/${year}.csv`;
  const { text } = await fetchToFile(url, dest);
  return parseTmlCsv(text);
}

export async function loadTmlRankings2026(): Promise<RankRow[]> {
  const dest = path.join(RANK_RAW_DIR, 'tml-2026.csv');
  const url = `${TML_BASE}/TML%20Rankings/2026.csv`;
  const { text } = await fetchToFile(url, dest);
  return parseTmlCsv(text);
}

export async function loadSackmannRankings(tour: 'atp' | 'wta', minDate: number, maxDate: number): Promise<RankRow[]> {
  const prefix = tour;
  const playersPath = path.join(RANK_RAW_DIR, `sackmann-${prefix}-players.csv`);
  const { text: playersText } = await fetchToFile(`${SACKMANN}/${prefix}/${prefix}_players.csv`, playersPath);
  const players = parseSackmannPlayers(playersText);
  const files = [`${prefix}_rankings_20s.csv`, `${prefix}_rankings_current.csv`];
  const rows: RankRow[] = [];
  for (const file of files) {
    const dest = path.join(RANK_RAW_DIR, `sackmann-${file}`);
    console.log(`[ranks] sackmann ${file}`);
    const { text } = await fetchToFile(`${SACKMANN}/${prefix}/${file}`, dest);
    const parsed = parseSackmannRankings(text, players, minDate, maxDate);
    console.log(`[ranks] ${file} rows=${parsed.length}`);
    for (const row of parsed) rows.push(row);
  }
  return rows;
}

export async function loadAtpWeeksApi(minDate: number, maxDate: number): Promise<RankRow[]> {
  const weeksPath = path.join(RANK_RAW_DIR, 'atp-weeks.json');
  console.log('[ranks] ATP weeks index');
  const { text: weeksText } = await fetchToFile(`${ATP_WEEKS_API}/api/weeks`, weeksPath, { timeoutMs: 90000 });
  let weeks: string[] = [];
  try {
    weeks = (JSON.parse(weeksText) as { weeks?: string[] }).weeks || [];
  } catch {
    weeks = [];
  }
  const wanted = weeks
    .map((w) => ({ raw: w, date: parseDateInt(w) }))
    .filter((w): w is { raw: string; date: number } => w.date != null && w.date >= minDate && w.date <= maxDate);
  console.log(`[ranks] ATP weeks API ${wanted.length} weeks in range`);
  const rows: RankRow[] = [];
  for (let i = 0; i < wanted.length; i++) {
    const { raw, date } = wanted[i];
    const dest = path.join(RANK_RAW_DIR, 'atp-weeks', `${raw}.json`);
    const { text, fromCache } = await fetchToFile(`${ATP_WEEKS_API}/api/week/${raw}`, dest);
    rows.push(...parseAtpWeekJson(text, date));
    if ((i + 1) % 20 === 0) console.log(`[ranks] ATP weeks ${i + 1}/${wanted.length}`);
    if (!fromCache) await sleep(180);
  }
  return rows;
}

export async function loadTennisExplorerWeeks(opts: {
  tour: 'atp' | 'wta';
  dates: number[];
  pages: number;
}): Promise<RankRow[]> {
  const slug = opts.tour === 'atp' ? 'atp-men' : 'wta-women';
  const rows: RankRow[] = [];
  let fetches = 0;
  for (const date of opts.dates) {
    const ymd = ymdFromInt(date);
    const year = String(date).slice(0, 4);
    for (let page = 1; page <= opts.pages; page++) {
      const dest = path.join(RANK_RAW_DIR, 'te', `${opts.tour}-${ymd}-p${page}.html`);
      const url = `${TE_BASE}/ranking/${slug}/${year}/?date=${ymd}&page=${page}`;
      const { text: html, fromCache } = await fetchToFile(url, dest);
      if (!fromCache) {
        fetches += 1;
        await sleep(400);
      }
      const parsed = parseTennisExplorerHtml(html);
      if (!parsed.rows.length) break;
      const firstRank = parsed.rows[0]?.rank ?? 0;
      if (page > 1 && firstRank <= 1) break;
      rows.push(...parsed.rows);
      if (parsed.rows.length < 40) break;
    }
    if (opts.dates.indexOf(date) % 5 === 4) {
      console.log(`[ranks] tennisexplorer ${opts.tour} ${ymd} totalRows=${rows.length} fetches=${fetches}`);
    }
  }
  console.log(`[ranks] tennisexplorer ${opts.tour} weeks=${opts.dates.length} rows=${rows.length} fetches=${fetches}`);
  return rows;
}
