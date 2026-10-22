/**
 * RotoWire's public NBA lineups page (predicted starters, "may not play" tags), logged per game so
 * the predictions can be checked against who actually started and played. The dashboard's predicted
 * lineups card reads this log (lib/nba/dash/predictedLineups.ts); the AI picks do not use it.
 * Fetched lightly (see rotowireFetchDue).
 */

import sharedCache from '@/lib/sharedCache';
import { resolveNbaClub } from '@/lib/nba/dash/teams';

export const ROTOWIRE_LINEUPS_URL = 'https://www.rotowire.com/basketball/nba-lineups.php';
const KEY_PREFIX = 'nba_rotowire_lineups_v1';
const STATE_KEY = `${KEY_PREFIX}:state`;
const LOG_TTL_S = 21 * 24 * 60 * 60;
const FETCH_TIMEOUT_MS = 20_000;
const MIN = 60_000;

export const rotowireDayKey = (date: string) => `${KEY_PREFIX}:${date}`;

export type RwPlayer = {
  name: string;
  pos: string;
  /** RotoWire's chance-to-play bucket: 100, 75, 50, 25 or 0. */
  playPct: number | null;
  /** Injury tag such as Out, Ques, Doubt, Prob, GTD, OFS. */
  tag: string | null;
};
export type RwTeamLineup = { team: string; confirmed: boolean; status: string; starters: RwPlayer[]; mayNotPlay: RwPlayer[] };
export type RwGame = { tipEt: string | null; tipAt: string | null; away: RwTeamLineup; home: RwTeamLineup };
export type RwPage = { date: string | null; games: RwGame[] };

export type RwTeamSnapshot = Omit<RwTeamLineup, 'team'> & { at: string; seenAt: string };
export type RwGameLog = { tipEt: string | null; tipAt: string | null; away: string; home: string; teams: Record<string, RwTeamSnapshot[]> };
export type RwDayLog = { date: string; checkedAt: string; games: Record<string, RwGameLog> };
type RwState = { fetchedAt: string; tips: string[] };

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const decode = (s: string) =>
  s
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** "7:00 PM" on an ET calendar date, as a UTC ISO string (handles EDT/EST). */
export function etTimeToUtc(date: string, time: string): string | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(time.trim());
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m || !d) return null;
  const hour = (Number(m[1]) % 12) + (m[3]!.toUpperCase() === 'PM' ? 12 : 0);
  const guess = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), hour, Number(m[2]));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asEt = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess + (guess - asEt)).toISOString();
}

function parsePlayers(html: string): RwPlayer[] {
  const out: RwPlayer[] = [];
  const re =
    /<li class="lineup__player([^"]*)"[^>]*>\s*<div class="lineup__pos"[^>]*>([^<]*)<\/div>\s*<a title="([^"]+)"[^>]*>[^<]*<\/a>\s*(?:<span class="lineup__inj">([^<]*)<\/span>)?/g;
  for (const m of html.matchAll(re)) {
    const pct = /is-pct-play-(\d+)/.exec(m[1]!);
    out.push({ name: decode(m[3]!), pos: decode(m[2]!), playPct: pct ? Number(pct[1]) : null, tag: m[4] ? decode(m[4]) : null });
  }
  return out;
}

function parseTeamList(html: string, team: string): RwTeamLineup {
  const status = /<li class="lineup__status([^"]*)"[^>]*>([\s\S]*?)<\/li>/.exec(html);
  const statusText = status ? decode(status[2]!.replace(/<[^>]+>/g, ' ')) : '';
  const split = html.indexOf('MAY NOT PLAY');
  const top = split >= 0 ? html.slice(0, split) : html;
  const bottom = split >= 0 ? html.slice(split) : '';
  return {
    team,
    confirmed: /is-confirmed/.test(status?.[1] ?? '') || /confirmed/i.test(statusText),
    status: statusText,
    starters: parsePlayers(top),
    mayNotPlay: parsePlayers(bottom),
  };
}

export function parseRotowireLineups(html: string): RwPage {
  const dm = /Starting lineups for ([A-Za-z]+) (\d{1,2}), (\d{4})/.exec(html);
  const month = dm ? MONTHS.indexOf(dm[1]!.toLowerCase()) : -1;
  const date = dm && month >= 0 ? `${dm[3]}-${String(month + 1).padStart(2, '0')}-${dm[2]!.padStart(2, '0')}` : null;
  const games: RwGame[] = [];
  const blocks = html.split(/<div class="lineup is-nba/).slice(1);
  for (const block of blocks) {
    if (/^[^"]*is-tools/.test(block)) continue;
    const abbrs = [...block.matchAll(/lineup__abbr">([^<]+)</g)].map((m) => decode(m[1]!));
    const visit = /<ul class="lineup__list is-visit">([\s\S]*?)<\/ul>/.exec(block);
    const home = /<ul class="lineup__list is-home">([\s\S]*?)<\/ul>/.exec(block);
    if (abbrs.length < 2 || !visit || !home) continue;
    const code = (abbr: string) => resolveNbaClub(abbr)?.code ?? abbr;
    const time = /lineup__time">([^<]+)</.exec(block);
    const tipEt = time ? decode(time[1]!) : null;
    games.push({
      tipEt,
      tipAt: date && tipEt ? etTimeToUtc(date, tipEt) : null,
      away: parseTeamList(visit[1]!, code(abbrs[0]!)),
      home: parseTeamList(home[1]!, code(abbrs[1]!)),
    });
  }
  return { date, games };
}

/** Every 3h to find the next slate, every 30 min within 12h of a tip, every cron run inside 90 min. */
export function rotowireFetchDue(state: RwState | null, nowMs: number): { due: boolean; reason: string } {
  if (!state?.fetchedAt) return { due: true, reason: 'first fetch' };
  const since = nowMs - Date.parse(state.fetchedAt);
  const soonest = Math.min(...state.tips.map((t) => Date.parse(t)).filter((t) => t > nowMs), Infinity);
  const interval = soonest - nowMs <= 90 * MIN ? 9 * MIN : soonest - nowMs <= 12 * 60 * MIN ? 29 * MIN : 179 * MIN;
  return since >= interval
    ? { due: true, reason: `${Math.round(since / MIN)} min since last fetch` }
    : { due: false, reason: `next fetch in ${Math.ceil((interval - since) / MIN)} min` };
}

const lineupSig = (t: Omit<RwTeamLineup, 'team'>) =>
  JSON.stringify({ confirmed: t.confirmed, status: t.status, starters: t.starters, mayNotPlay: t.mayNotPlay });

/** Adds each pre-tip team lineup as a new snapshot when it changed; otherwise just marks it seen again. */
export function mergeRotowireDay(log: RwDayLog | null, page: RwPage & { date: string }, nowMs: number): { log: RwDayLog; changed: number } {
  const now = new Date(nowMs).toISOString();
  const out: RwDayLog = log ?? { date: page.date, checkedAt: now, games: {} };
  out.checkedAt = now;
  let changed = 0;
  for (const g of page.games) {
    if (g.tipAt && nowMs >= Date.parse(g.tipAt)) continue;
    const id = `${g.away.team}@${g.home.team}`;
    const game = (out.games[id] ??= { tipEt: g.tipEt, tipAt: g.tipAt, away: g.away.team, home: g.home.team, teams: {} });
    game.tipEt = g.tipEt;
    game.tipAt = g.tipAt;
    for (const { team, ...lineup } of [g.away, g.home]) {
      const snaps = (game.teams[team] ??= []);
      const last = snaps[snaps.length - 1];
      if (last && lineupSig(last) === lineupSig(lineup)) {
        last.seenAt = now;
        continue;
      }
      snaps.push({ ...lineup, at: now, seenAt: now });
      changed++;
    }
  }
  return { log: out, changed };
}

export type RwLogResult =
  | { fetched: false; reason: string }
  | { fetched: true; date: string | null; games: number; changed: number; warning?: string };

/** Writes `nba_rotowire_lineups_v1:<ET date>` (21-day TTL) and the fetch-throttle state in Redis. */
export async function logRotowireLineups(nowMs = Date.now(), opts: { force?: boolean } = {}): Promise<RwLogResult> {
  const state = await sharedCache.getJSON<RwState>(STATE_KEY);
  const due = opts.force ? { due: true, reason: 'forced' } : rotowireFetchDue(state, nowMs);
  if (!due.due) return { fetched: false, reason: due.reason };

  const res = await fetch(ROTOWIRE_LINEUPS_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: 'no-store',
  });
  const fetchedAt = new Date(nowMs).toISOString();
  if (!res.ok) {
    await sharedCache.setJSON(STATE_KEY, { fetchedAt, tips: state?.tips ?? [] }, LOG_TTL_S);
    return { fetched: true, date: null, games: 0, changed: 0, warning: `RotoWire HTTP ${res.status}` };
  }
  const page = parseRotowireLineups(await res.text());
  await sharedCache.setJSON(STATE_KEY, { fetchedAt, tips: page.games.flatMap((g) => (g.tipAt ? [g.tipAt] : [])) }, LOG_TTL_S);
  if (!page.date || !page.games.length) {
    return { fetched: true, date: page.date, games: 0, changed: 0, warning: page.date ? 'no games parsed (off day or page changed)' : 'page date not found (page changed?)' };
  }
  const key = rotowireDayKey(page.date);
  const merged = mergeRotowireDay(await sharedCache.getJSON<RwDayLog>(key), { ...page, date: page.date }, nowMs);
  await sharedCache.setJSON(key, merged.log, LOG_TTL_S);
  const short = page.games.filter((g) => g.away.starters.length !== 5 || g.home.starters.length !== 5).length;
  return {
    fetched: true,
    date: page.date,
    games: page.games.length,
    changed: merged.changed,
    ...(short ? { warning: `${short} game(s) without five starters per side (page changed?)` } : {}),
  };
}
