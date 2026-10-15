/**
 * NBA dashboard odds: reads the BallDontLie board stored by the odds cron
 * (/api/cron/refresh-nba-odds) and reshapes it into the NBL-style book rows the dashboard uses.
 * Never triggers a refresh.
 */
import sharedCache from '@/lib/sharedCache';
import { getBookmakerRegion } from '@/lib/bookmakers';
import { normalizeTeamKey, resolveNbaClubName } from './teams';
import type { NbaBookRow, NbaGameOdds, NbaOddsCache, NbaPropEntry, NbaPropLine } from './oddsTypes';

export const NBA_DASH_ODDS_KEY = 'nba_dash_odds_v1';

/** Dashboard stat id → stored prop key. */
export const NBA_STAT_TO_PROP_KEY: Record<string, string> = {
  points: 'PTS',
  rebounds: 'REB',
  assists: 'AST',
  threeMade: 'THREES',
  steals: 'STL',
  blocks: 'BLK',
  turnovers: 'TO',
  pra: 'PRA',
  pr: 'PR',
  pa: 'PA',
  ra: 'RA',
  q1_pts: 'PTS_1Q',
  q1_reb: 'REB_1Q',
  q1_ast: 'AST_1Q',
};

export async function getNbaOddsCache(): Promise<NbaOddsCache | null> {
  const stored = await sharedCache.getJSON<NbaOddsCache>(NBA_DASH_ODDS_KEY);
  return stored && Array.isArray(stored.games) ? stored : null;
}

const teamKey = (v: string | null | undefined) => normalizeTeamKey(resolveNbaClubName(v) || v || '');

/** Upcoming (or in-progress) game for the matchup; finished games are never used. */
export function findNbaOddsGame(games: NbaGameOdds[], team: string, opponent: string | null): NbaGameOdds | null {
  const t = teamKey(team);
  const o = opponent ? teamKey(opponent) : '';
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  const hits = games
    .filter((g) => {
      const sides = [teamKey(g.homeTeam), teamKey(g.awayTeam)];
      return sides.includes(t) && (!o || sides.includes(o));
    })
    .filter((g) => {
      const tip = Date.parse(g.commenceTime);
      return !Number.isFinite(tip) || tip >= cutoff;
    })
    .sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  return hits[0] ?? null;
}

function toPropLines(entries: NbaPropEntry[] | undefined): NbaPropLine[] {
  const out: NbaPropLine[] = [];
  const seen = new Set<string>();
  for (const e of entries ?? []) {
    const value = Number(e?.line);
    if (!e || !Number.isFinite(value)) continue;
    const kind: NbaPropLine['kind'] = e.milestone ? 'milestone' : 'ou';
    const key = `${kind}|${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // "25+" charts as 24.5 so exactly 25 counts as a hit (same as NBL).
    out.push({
      line: String(e.milestone ? value - 0.5 : value),
      over: e.over || 'N/A',
      under: e.milestone ? 'N/A' : e.under || 'N/A',
      kind,
      label: e.milestone ? `${value}+` : String(value),
    });
  }
  return out.sort((a, b) => Number(a.line) - Number(b.line));
}

function propBook(name: string, lines: NbaPropLine[]): NbaBookRow {
  const twoWay = lines.filter((l) => l.kind === 'ou' && l.over !== 'N/A' && l.under !== 'N/A');
  const main = (twoWay.length ? twoWay : lines)[0];
  return {
    name,
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: main ? { line: main.line, over: main.over, under: main.under } : { line: 'N/A', over: 'N/A', under: 'N/A' },
    lines,
  };
}

export const normalizeNbaPropPlayerName = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function nbaPlayerPropsByStat(game: NbaGameOdds, player: string): Record<string, NbaBookRow[]> {
  const want = normalizeNbaPropPlayerName(player);
  const byStat: Record<string, NbaBookRow[]> = {};
  for (const [book, players] of Object.entries(game.playerProps || {})) {
    const name = Object.keys(players || {}).find((p) => normalizeNbaPropPlayerName(p) === want);
    if (!name) continue;
    const props = players[name] || {};
    for (const [stat, key] of Object.entries(NBA_STAT_TO_PROP_KEY)) {
      const lines = toPropLines(props[key]);
      if (!lines.length) continue;
      (byStat[stat] ??= []).push(propBook(book, lines));
    }
  }
  const auFirst = (b: NbaBookRow) => (getBookmakerRegion(b.name) === 'au' ? 0 : 1);
  for (const books of Object.values(byStat)) books.sort((a, b) => auFirst(a) - auFirst(b));
  return byStat;
}

/** Game market books (moneyline / spread / total). */
export function nbaGameBooks(game: NbaGameOdds): NbaBookRow[] {
  return (game.bookmakers || []).map((b) => ({
    name: b.name,
    H2H: b.H2H,
    Spread: b.Spread,
    Total: b.Total,
  }));
}
