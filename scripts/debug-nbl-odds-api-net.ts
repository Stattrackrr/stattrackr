/**
 * Live probe of odds-api.net NBL player props.
 * Dumps events, raw line/side shapes, and parse success for O/U + milestones.
 *
 * Usage: npx tsx scripts/debug-nbl-odds-api-net.ts
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

import { officialNblClubName } from '../lib/nblTeamCanonical';
import { fetchOddsApiNetNblGames, parseNblOddsApiNetSideLine } from '../lib/nbl/oddsApiNet';

const BASE = 'https://api.odds-api.net/v1';

function apiKey(): string {
  return String(process.env.ODDS_API_NET_KEY || process.env.ODDS_API_NET || '').trim();
}

async function fetchJson(url: string): Promise<unknown> {
  const key = apiKey();
  if (!key) throw new Error('ODDS_API_NET_KEY is not set');
  const res = await fetch(url, {
    headers: { 'X-API-Key': key, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  if (!res.ok) {
    console.warn(`HTTP ${res.status} ${url}: ${text.slice(0, 240)}`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    console.warn('non-json', text.slice(0, 200));
    return null;
  }
}

function eventsFrom(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as { items?: unknown; events?: unknown; data?: unknown };
  for (const key of ['items', 'events', 'data'] as const) {
    if (Array.isArray(p[key])) return p[key] as Array<Record<string, unknown>>;
  }
  return [];
}

async function main() {
  const key = apiKey();
  if (!key) throw new Error('ODDS_API_NET_KEY is not set');

  const eventsPage = await fetchJson(`${BASE}/events?sport=basketball&league=NBL&limit=50`);
  const events = eventsFrom(eventsPage);
  console.log(`[debug] events=${events.length}`);

  for (const ev of events.slice(0, 15)) {
    const id = ev.event_id ?? ev.id;
    const homeRaw = String(ev.home_team || ev.home || '');
    const awayRaw = String(ev.away_team || ev.away || '');
    const home = officialNblClubName(homeRaw);
    const away = officialNblClubName(awayRaw);
    console.log(
      `[debug] event ${id} raw="${homeRaw}" vs "${awayRaw}" → official=${home || 'NULL'} vs ${away || 'NULL'} state=${ev.event_state || ''}`
    );
  }

  // Sample odds from first official NBL event (or first event if none map).
  const sample =
    events.find((ev) => {
      const home = officialNblClubName(String(ev.home_team || ev.home || ''));
      const away = officialNblClubName(String(ev.away_team || ev.away || ''));
      return Boolean(home && away && (ev.event_id ?? ev.id) != null);
    }) || events[0];

  if (sample) {
    const eventId = sample.event_id ?? sample.id;
    const qs = new URLSearchParams({
      types: 'player prop',
      bookmakers: 'sportsbet,tab,bet365,unibet',
      limit: '200',
    });
    const snap = (await fetchJson(
      `${BASE}/events/${encodeURIComponent(String(eventId))}/odds/snapshot?${qs}`
    )) as { items?: Array<Record<string, unknown>> } | null;
    const items = snap?.items || [];
    console.log(`[debug] sample event ${eventId} items=${items.length}`);

    const lineShapes = new Map<string, number>();
    const metrics = new Map<string, number>();
    let parsedOk = 0;
    let parsedFail = 0;
    const failSamples: string[] = [];
    const okSamples: string[] = [];
    for (const item of items) {
      const metric = String(item.metric || item.market_key || '');
      metrics.set(metric, (metrics.get(metric) || 0) + 1);
      const shape = `line=${JSON.stringify(item.line)} side=${JSON.stringify(item.side)} sel=${JSON.stringify(String(item.selection_name || '').slice(0, 40))}`;
      lineShapes.set(shape, (lineShapes.get(shape) || 0) + 1);
      const parsed = parseNblOddsApiNetSideLine({
        line: item.line as string | number | undefined,
        side: item.side as string | undefined,
        selection_name: item.selection_name as string | undefined,
      });
      if (parsed) {
        parsedOk += 1;
        if (okSamples.length < 8) {
          okSamples.push(
            `${item.player_name || '?'} ${metric} ${parsed.side} ${parsed.value} @ ${item.odds}`
          );
        }
      } else {
        parsedFail += 1;
        if (failSamples.length < 8) failSamples.push(shape);
      }
    }
    console.log(`[debug] parse ok=${parsedOk} fail=${parsedFail}`);
    console.log('[debug] metrics', [...metrics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15));
    console.log('[debug] top line shapes', [...lineShapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12));
    console.log('[debug] ok samples', okSamples);
    console.log('[debug] fail samples', failSamples);
  }

  const games = await fetchOddsApiNetNblGames();
  console.log(`[debug] fetchOddsApiNetNblGames games=${games.length}`);
  for (const g of games) {
    const markets = g.bookmakers.reduce((n, b) => n + (b.markets?.length || 0), 0);
    const milestones = g.bookmakers.reduce(
      (n, b) => n + (b.markets || []).filter((m) => (m.selections || []).length === 1).length,
      0
    );
    const twoWay = g.bookmakers.reduce(
      (n, b) => n + (b.markets || []).filter((m) => (m.selections || []).length >= 2).length,
      0
    );
    console.log(
      `[debug] game ${g.homeTeam} vs ${g.awayTeam} tip=${g.commenceTime} books=${g.bookmakers.length} markets=${markets} twoWay=${twoWay} milestoneish=${milestones}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
