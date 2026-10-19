/**
 * The Odds API event-odds fallback for NBL player props.
 *
 * odds-api.net is the primary player-prop board, but it sometimes omits
 * same-day fixtures that already have AU book lines on The Odds API
 * (e.g. Tasmania vs Adelaide). Fill those gaps so the props page stays complete.
 */

import { officialNblClubName, resolveNblClubName } from '@/lib/nblTeamCanonical';
import { isAflCommenceTimePropsEligible } from '@/lib/combinedPropsSnapshotTypes';
import type { PulseNblGame } from '@/lib/nbl/pulseScore';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const NBL_SPORT_KEY = 'basketball_nbl';

/** Core two-way + combo markets used on the props page. */
const PLAYER_MARKETS = [
  'player_points',
  'player_rebounds',
  'player_assists',
  'player_threes',
  'player_points_rebounds_assists',
  'player_points_rebounds',
  'player_points_assists',
  'player_rebounds_assists',
] as const;

/** Milestone / over-only ladders when two-way O/U is thin. */
const ALTERNATE_MARKETS = [
  'player_points_alternate',
  'player_rebounds_alternate',
  'player_assists_alternate',
  'player_threes_alternate',
] as const;

const MARKET_META: Record<string, { canon: string; noun: string; alternate?: boolean }> = {
  player_points: { canon: 'PLAYER_POINTS', noun: 'points' },
  player_rebounds: { canon: 'PLAYER_REBOUNDS', noun: 'rebounds' },
  player_assists: { canon: 'PLAYER_ASSISTS', noun: 'assists' },
  player_threes: { canon: 'PLAYER_THREES_MADE', noun: 'threes' },
  player_points_rebounds_assists: { canon: 'PLAYER_PRA', noun: 'PRA' },
  player_points_rebounds: { canon: 'PLAYER_PR', noun: 'PR' },
  player_points_assists: { canon: 'PLAYER_PA', noun: 'PA' },
  player_rebounds_assists: { canon: 'PLAYER_RA', noun: 'RA' },
  player_points_alternate: { canon: 'PLAYER_POINTS', noun: 'points', alternate: true },
  player_rebounds_alternate: { canon: 'PLAYER_REBOUNDS', noun: 'rebounds', alternate: true },
  player_assists_alternate: { canon: 'PLAYER_ASSISTS', noun: 'assists', alternate: true },
  player_threes_alternate: { canon: 'PLAYER_THREES_MADE', noun: 'threes', alternate: true },
};

type OddsApiOutcome = {
  name?: string;
  description?: string;
  price?: number;
  point?: number;
};

type OddsApiMarket = {
  key?: string;
  outcomes?: OddsApiOutcome[];
};

type OddsApiBookmaker = {
  key?: string;
  title?: string;
  markets?: OddsApiMarket[];
};

type OddsApiEvent = {
  id?: string;
  commence_time?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: OddsApiBookmaker[];
};

function apiKey(): string {
  return String(process.env.ODDS_API_KEY || '').trim();
}

function officialTeam(raw: string | undefined): string {
  const s = String(raw || '').trim();
  return resolveNblClubName(s) || s;
}

function teamKey(raw: string | undefined): string {
  return officialTeam(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function teamsMatch(a: string | undefined, b: string | undefined): boolean {
  const ka = teamKey(a);
  const kb = teamKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return ka.includes(kb) || kb.includes(ka);
}

function matchupStamp(home: string, away: string, commenceTime: string): string {
  const day = String(commenceTime || '').slice(0, 10);
  const a = teamKey(home);
  const b = teamKey(away);
  return `${day}|${[a, b].sort().join('|')}`;
}

function displayBook(title: string | undefined, key: string | undefined): string | null {
  const t = String(title || '').trim();
  if (t) return t;
  const k = String(key || '').trim();
  if (!k) return null;
  return k.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function fetchJson(url: string): Promise<unknown | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(25_000) });
    const remaining = res.headers.get('x-requests-remaining');
    if (remaining) {
      console.log(`[The Odds API NBL props] remaining=${remaining}`);
    }
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[The Odds API NBL props] ${res.status}: ${text.slice(0, 180)}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(
      '[The Odds API NBL props] fetch failed',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

function eventToPulseGame(ev: OddsApiEvent): PulseNblGame | null {
  const homeRaw = ev.home_team;
  const awayRaw = ev.away_team;
  const home = officialNblClubName(homeRaw) || officialTeam(homeRaw);
  const away = officialNblClubName(awayRaw) || officialTeam(awayRaw);
  if (!home || !away || !ev.id || !ev.commence_time) return null;

  const bookmakers: PulseNblGame['bookmakers'] = [];
  for (const book of ev.bookmakers || []) {
    const bookName = displayBook(book.title, book.key);
    if (!bookName) continue;
    const markets: NonNullable<PulseNblGame['bookmakers'][number]['markets']> = [];

    for (const market of book.markets || []) {
      const meta = MARKET_META[String(market.key || '')];
      if (!meta || !Array.isArray(market.outcomes)) continue;

      type SideRow = { over?: OddsApiOutcome; under?: OddsApiOutcome; point: number; player: string };
      const byPlayerLine = new Map<string, SideRow>();

      for (const outcome of market.outcomes) {
        const player = String(outcome.description || '').trim();
        const point = typeof outcome.point === 'number' ? outcome.point : NaN;
        const side = String(outcome.name || '').trim().toLowerCase();
        if (!player || !Number.isFinite(point)) continue;
        if (typeof outcome.price !== 'number' || outcome.price <= 1) continue;
        if (side !== 'over' && side !== 'under') continue;
        const key = `${player.toLowerCase()}|${point}`;
        const row = byPlayerLine.get(key) ?? { point, player };
        if (side === 'over') row.over = outcome;
        else row.under = outcome;
        byPlayerLine.set(key, row);
      }

      for (const row of byPlayerLine.values()) {
        const twoWay = Boolean(row.over && row.under);
        if (twoWay) {
          markets.push({
            canonicalMarket: meta.canon,
            rawName: `Player ${meta.noun.replace(/^./, (c) => c.toUpperCase())}`,
            name: `${row.player} ${row.point}`,
            line: row.point,
            period: '',
            isActive: true,
            moreInfo: { player: row.player },
            selections: [
              {
                canonicalOutcome: 'OVER',
                rawName: `${row.player} Over ${row.point}`,
                name: `${row.player} Over ${row.point}`,
                odds: row.over!.price,
                line: row.point,
                isActive: true,
                moreInfo: { player: row.player },
              },
              {
                canonicalOutcome: 'UNDER',
                rawName: `${row.player} Under ${row.point}`,
                name: `${row.player} Under ${row.point}`,
                odds: row.under!.price,
                line: row.point,
                isActive: true,
                moreInfo: { player: row.player },
              },
            ],
          });
          continue;
        }
        if (!row.over) continue;
        // Alternate / milestone ladders are over-only.
        const threshold =
          Math.abs(row.point - Math.round(row.point)) < 1e-6
            ? row.point
            : Math.round(row.point + 0.5);
        markets.push({
          canonicalMarket: meta.canon,
          rawName: `${threshold}+ ${meta.noun}`,
          name: `${row.player} ${threshold}+ ${meta.noun}`,
          line: threshold,
          period: '',
          isActive: true,
          moreInfo: { player: row.player },
          selections: [
            {
              canonicalOutcome: 'OVER',
              rawName: row.player,
              name: row.player,
              odds: row.over.price,
              line: threshold,
              isActive: true,
              moreInfo: { player: row.player },
            },
          ],
        });
      }
    }

    if (markets.length) bookmakers.push({ name: bookName, markets });
  }

  if (!bookmakers.length) return null;
  return {
    gameId: String(ev.id),
    homeTeam: home,
    awayTeam: away,
    commenceTime: ev.commence_time,
    bookmakers,
  };
}

async function fetchEventPlayerProps(eventId: string): Promise<PulseNblGame | null> {
  const key = apiKey();
  if (!key) return null;
  const markets = [...PLAYER_MARKETS, ...ALTERNATE_MARKETS].join(',');
  const url =
    `${ODDS_API_BASE}/sports/${NBL_SPORT_KEY}/events/${encodeURIComponent(eventId)}/odds` +
    `?regions=au&oddsFormat=decimal&markets=${encodeURIComponent(markets)}` +
    `&apiKey=${encodeURIComponent(key)}`;
  const payload = (await fetchJson(url)) as OddsApiEvent | null;
  if (!payload || typeof payload !== 'object') return null;
  return eventToPulseGame(payload);
}

/**
 * For tipoff-eligible The Odds API fixtures missing from the odds-api.net board,
 * pull AU player props and append them in the same PulseNblGame shape.
 */
export async function fillMissingNblPlayerPropsFromTheOddsApi(
  existing: PulseNblGame[]
): Promise<PulseNblGame[]> {
  const key = apiKey();
  if (!key) return existing;

  const eventsUrl =
    `${ODDS_API_BASE}/sports/${NBL_SPORT_KEY}/events` +
    `?apiKey=${encodeURIComponent(key)}`;
  const eventsPayload = await fetchJson(eventsUrl);
  const events = Array.isArray(eventsPayload) ? (eventsPayload as OddsApiEvent[]) : [];
  if (!events.length) return existing;

  const have = new Set(
    existing.map((g) => matchupStamp(g.homeTeam, g.awayTeam, g.commenceTime))
  );

  const missing = events.filter((ev) => {
    const home = officialTeam(ev.home_team);
    const away = officialTeam(ev.away_team);
    const tip = String(ev.commence_time || '');
    if (!home || !away || !tip || !ev.id) return false;
    if (!isAflCommenceTimePropsEligible(tip)) return false;
    if (!officialNblClubName(home) || !officialNblClubName(away)) return false;
    return !have.has(matchupStamp(home, away, tip));
  });

  if (!missing.length) return existing;

  console.warn(
    `[The Odds API NBL props] filling ${missing.length} game(s) missing from odds-api.net: ` +
      missing
        .map((ev) => `${ev.home_team} vs ${ev.away_team} @ ${ev.commence_time}`)
        .join('; ')
  );

  const extras: PulseNblGame[] = [];
  for (const ev of missing) {
    const game = await fetchEventPlayerProps(String(ev.id));
    if (game) {
      extras.push(game);
      console.warn(
        `[The Odds API NBL props] added ${game.homeTeam} vs ${game.awayTeam} books=${game.bookmakers.length}`
      );
    } else {
      console.warn(
        `[The Odds API NBL props] no player markets for ${ev.home_team} vs ${ev.away_team} (${ev.id})`
      );
    }
  }

  if (!extras.length) return existing;
  return [...existing, ...extras];
}
