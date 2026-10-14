/**
 * NBA dashboard odds: reads the stored NBA odds cache (written by the odds refresh cron)
 * and reshapes it into the NBL-style book rows the dashboard uses. Never triggers a refresh.
 */
import cache from '@/lib/cache';
import { getNBACache } from '@/lib/nbaCache';
import type { GameOdds, OddsCache, PlayerPropLineEntry } from '@/app/api/odds/refresh/route';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getNbaClubById, normalizeTeamKey, resolveNbaClubName } from './teams';
import type { NbaBookRow, NbaPropLine } from './oddsTypes';

const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';

/** Dashboard stat id → odds cache prop key. */
const STAT_TO_PROP_KEY: Record<string, string> = {
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

export async function getNbaOddsCache(): Promise<OddsCache | null> {
  const stored =
    (await getNBACache<OddsCache>(ODDS_CACHE_KEY, { restTimeoutMs: 5000, jsTimeoutMs: 5000, quiet: true })) ??
    cache.get<OddsCache>(ODDS_CACHE_KEY) ??
    null;
  if (!stored?.games?.length) return stored;
  return { ...stored, games: await fillMissingTeams(stored.games) };
}

const hasTeam = (name: string | null | undefined) => Boolean(name && name !== 'N/A');

/**
 * The odds refresh only maps teams for games in the next 24h, so games further out are stored
 * with "N/A" teams and no tip-off. Their BDL game ids are in nba_games.
 */
async function fillMissingTeams(games: GameOdds[]): Promise<GameOdds[]> {
  const missing = games
    .filter((g) => !hasTeam(g.homeTeam) || !hasTeam(g.awayTeam) || !g.commenceTime)
    .map((g) => Number(g.gameId))
    .filter(Number.isFinite);
  if (!missing.length) return games;
  const { data } = await supabaseAdmin
    .from('nba_games')
    .select('id, tipoff_at, home_team_id, visitor_team_id')
    .in('id', missing);
  const byId = new Map((data ?? []).map((r) => [String(r.id), r]));
  return games.map((g) => {
    const row = byId.get(String(g.gameId));
    if (!row) return g;
    return {
      ...g,
      homeTeam: hasTeam(g.homeTeam) ? g.homeTeam : getNbaClubById(row.home_team_id)?.name ?? g.homeTeam,
      awayTeam: hasTeam(g.awayTeam) ? g.awayTeam : getNbaClubById(row.visitor_team_id)?.name ?? g.awayTeam,
      commenceTime: g.commenceTime || row.tipoff_at || '',
    };
  });
}

const teamKey = (v: string | null | undefined) => normalizeTeamKey(resolveNbaClubName(v) || v || '');

/** Upcoming (or in-progress) game for the matchup; finished games are never used. */
export function findNbaOddsGame(games: GameOdds[], team: string, opponent: string | null): GameOdds | null {
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

function toPropLines(entries: PlayerPropLineEntry[] | PlayerPropLineEntry | undefined): NbaPropLine[] {
  const list = Array.isArray(entries) ? entries : entries ? [entries] : [];
  const out: NbaPropLine[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    if (!e || e.line == null || e.line === 'N/A') continue;
    // Pick'em Goblin/Demon variants aren't priced lines.
    if (e.variantLabel === 'Goblin' || e.variantLabel === 'Demon') continue;
    const milestone = e.variantLabel === 'Milestone' || (e as { isMilestone?: boolean }).isMilestone === true;
    const kind: NbaPropLine['kind'] = milestone ? 'milestone' : 'ou';
    const key = `${kind}|${e.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      line: String(e.line),
      over: e.over ?? 'N/A',
      under: milestone ? 'N/A' : e.under ?? 'N/A',
      kind,
      label: milestone ? `${e.line}+` : String(e.line),
    });
  }
  return out;
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

const normName = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .trim();

export function nbaPlayerPropsByStat(game: GameOdds, player: string): Record<string, NbaBookRow[]> {
  const want = normName(player);
  const byStat: Record<string, NbaBookRow[]> = {};
  for (const [book, players] of Object.entries(game.playerPropsByBookmaker || {})) {
    const name = Object.keys(players || {}).find((p) => normName(p) === want);
    if (!name) continue;
    const props = (players as Record<string, Record<string, unknown>>)[name] || {};
    for (const [stat, key] of Object.entries(STAT_TO_PROP_KEY)) {
      const lines = toPropLines(props[key] as PlayerPropLineEntry[] | undefined);
      if (!lines.length) continue;
      (byStat[stat] ??= []).push(propBook(book, lines));
    }
  }
  return byStat;
}

/** Game market books (moneyline / spread / total) without the legacy player-prop columns. */
export function nbaGameBooks(game: GameOdds): NbaBookRow[] {
  return (game.bookmakers || []).map((b) => ({
    name: b.name,
    H2H: b.H2H,
    Spread: b.Spread,
    Total: b.Total,
  }));
}
