import sharedCache from '@/lib/sharedCache';
import { readTennisRosterCache } from '@/lib/tennis/dashboardCache';
import { fetchTennisMatchPlayers, fetchTennisPlayerFullName } from '@/lib/tennis/ingest';
import type { TennisTour } from '@/lib/tennis/types';

export type TennisPickEvent = {
  tour: TennisTour | null;
  /** Fixture name ("M. Karol") to full name ("Milos Karol"). Players with no full name are left out. */
  names: Record<string, string>;
};

const CACHE_PREFIX = 'ai_picks_tennis_event_v1:';
const COMPLETE_TTL_SECONDS = 60 * 24 * 60 * 60;
/** Retry later when api-tennis had no full name for someone; it fills in for some players over time. */
const PARTIAL_TTL_SECONDS = 2 * 24 * 60 * 60;
const MAX_LOOKUPS = 24;
const CONCURRENCY = 6;

const isAbbreviated = (name: string) => /(^|\s)[A-Z]\.(\s|$)/.test(name);
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * api-tennis full names are sometimes reordered ("J. D. Hara Friend" -> "Dylan Hara Friend Jay"),
 * so only trust one that ends in the fixture surname and starts with its first initial.
 */
function fitsShortName(short: string, full: string): boolean {
  const tokens = short.split(/\s+/).filter(Boolean);
  const initials = tokens.filter((t) => /^[A-Za-z]\.$/.test(t)).map((t) => norm(t[0]));
  const surname = norm(tokens.filter((t) => !/^[A-Za-z]\.$/.test(t)).join(' '));
  const f = norm(full.trim());
  if (!initials.length || !surname || !f.endsWith(` ${surname}`)) return false;
  return f.startsWith(initials[0]);
}

async function fullNameIndex(): Promise<Map<string, string>> {
  const roster = await readTennisRosterCache();
  const byId = new Map<string, string>();
  for (const p of roster?.players ?? []) if (p.name && !isAbbreviated(p.name)) byId.set(String(p.playerId), p.name);
  for (const r of [...(roster?.standings.ATP ?? []), ...(roster?.standings.WTA ?? [])]) {
    if (r.name && !isAbbreviated(r.name)) byId.set(String(r.playerId), r.name);
  }
  return byId;
}

async function lookupEvent(eventKey: string, startsAt: string, known: Map<string, string>): Promise<TennisPickEvent | null> {
  const match = await fetchTennisMatchPlayers(eventKey, startsAt);
  if (!match) return null;
  const names: Record<string, string> = {};
  let complete = true;
  for (const p of match.players) {
    if (!isAbbreviated(p.name)) continue;
    const fromRoster = known.get(p.playerId);
    const full =
      fromRoster && fitsShortName(p.name, fromRoster) ? fromRoster : await fetchTennisPlayerFullName(p.playerId);
    if (full && fitsShortName(p.name, full)) names[p.name] = full;
    else if (!full) complete = false;
  }
  const event: TennisPickEvent = { tour: match.tour, names };
  await sharedCache.setJSON(`${CACHE_PREFIX}${eventKey}`, event, complete ? COMPLETE_TTL_SECONDS : PARTIAL_TTL_SECONDS);
  return event;
}

/** Tour and full player names for AI pick tennis matches. Cached per match; api-tennis is only hit on a miss. */
export async function resolveTennisPickEvents(
  targets: Array<{ eventKey: string; startsAt: string }>
): Promise<Record<string, TennisPickEvent>> {
  const unique = [...new Map(targets.filter((t) => /^\d+$/.test(t.eventKey)).map((t) => [t.eventKey, t])).values()];
  const out: Record<string, TennisPickEvent> = {};
  if (!unique.length) return out;
  const cached = await sharedCache.getJSONMany<TennisPickEvent>(unique.map((t) => `${CACHE_PREFIX}${t.eventKey}`));
  const missing: typeof unique = [];
  unique.forEach((t, i) => {
    const hit = cached[i];
    if (hit && typeof hit === 'object' && hit.names) out[t.eventKey] = hit;
    else missing.push(t);
  });
  if (!missing.length) return out;
  const known = await fullNameIndex();
  const queue = missing.slice(0, MAX_LOOKUPS);
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const batch = queue.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((t) => lookupEvent(t.eventKey, t.startsAt, known).catch(() => null)));
    batch.forEach((t, j) => {
      const event = results[j];
      if (event) out[t.eventKey] = event;
    });
  }
  return out;
}
