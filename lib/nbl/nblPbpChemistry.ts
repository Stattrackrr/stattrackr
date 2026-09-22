/**
 * Parse compact court-chemistry from SportRadar PBP and roll up cache-only
 * season totals. Dashboard APIs must not fetch live PBP.
 */

import fs from 'fs';
import path from 'path';
import {
  NBL_CHEM_MIN_OFF_MINUTES,
  NBL_CHEM_MIN_SHARED_MINUTES,
  NBL_CHEM_MIN_SHARED_POSSESSIONS,
  emptyNblChemistryPayload,
  type NblChemistryLinkupRow,
  type NblChemistryMetric,
  type NblChemistryOnCourtRow,
  type NblChemistryPayload,
} from '@/lib/nbl/chemistryShared';
import {
  fixtureIdOf,
  isCompletedGame,
  loadScheduleGames,
  nblShotPlayerNamesMatch,
} from '@/lib/nbl/nblShotChartData';
import { NBL_CURRENT_SEASON_YEAR, resolveNblClubName } from '@/lib/nblTeamCanonical';

const CHEM_CACHE_DIR = path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'pbp-chem');

const EMPTY_MESSAGE = 'Need PBP for this season';

type SrPbpEvent = {
  clock?: string | null;
  desc?: string | null;
  entityId?: string | null;
  eventSubType?: string | null;
  eventType?: string | null;
  name?: string | null;
  periodId?: number | null;
  personId?: string | null;
  success?: boolean | null;
  successString?: string | null;
};

type SrCompetitor = {
  name?: string;
  code?: string;
  entityId?: string;
  isHome?: boolean;
};

export type NblChemLinkPair = {
  personId: string | null;
  name: string;
  count: number;
  pts: number;
};

export type NblChemOnOffTeammate = {
  personId: string | null;
  name: string;
  onMin: number;
  offMin: number;
  onPoss: number;
  offPoss: number;
  onPts: number;
  offPts: number;
  onReb: number;
  offReb: number;
  onAst: number;
  offAst: number;
};

export type NblChemPlayer = {
  personId: string | null;
  name: string;
  teamCode: string | null;
  teamName: string | null;
  madeFg: number;
  assistedMakes: number;
  assists: number;
  ptsCreated: number;
  finds: NblChemLinkPair[];
  foundBy: NblChemLinkPair[];
};

export type NblChemOnOffPlayer = {
  personId: string | null;
  name: string;
  teamCode: string | null;
  teamName: string | null;
  minutes: number;
  teammates: NblChemOnOffTeammate[];
};

export type NblFixtureChemistry = {
  fixtureId: string;
  homeTeam: string | null;
  awayTeam: string | null;
  homeTeamCode: string | null;
  awayTeamCode: string | null;
  lineupValid: boolean;
  players: NblChemPlayer[];
  onOff: NblChemOnOffPlayer[];
  fetchedAt: string;
};

type LinkAcc = { personId: string | null; name: string; count: number; pts: number };

type OnOffAcc = {
  personId: string | null;
  name: string;
  onMin: number;
  offMin: number;
  onPoss: number;
  offPoss: number;
  onPts: number;
  offPts: number;
  onReb: number;
  offReb: number;
  onAst: number;
  offAst: number;
};

type PlayerAcc = {
  key: string;
  personId: string | null;
  name: string;
  teamId: string;
  teamCode: string | null;
  teamName: string | null;
  madeFg: number;
  assistedMakes: number;
  assists: number;
  ptsCreated: number;
  finds: Map<string, LinkAcc>;
  foundBy: Map<string, LinkAcc>;
  minutes: number;
  teammates: Map<string, OnOffAcc>;
};

function chemCachePath(fixtureId: string): string {
  return path.join(CHEM_CACHE_DIR, `${fixtureId}.json`);
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function eventsFromPeriod(period: unknown): SrPbpEvent[] {
  if (Array.isArray(period)) return period as SrPbpEvent[];
  if (period && typeof period === 'object') {
    const ev = (period as { events?: unknown }).events;
    if (Array.isArray(ev)) return ev as SrPbpEvent[];
  }
  return [];
}

function normalizeEventType(ev: SrPbpEvent): string {
  return String(ev.eventType || '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
}

function isMade(ev: SrPbpEvent): boolean {
  if (ev.success === true) return true;
  if (ev.success === false) return false;
  const flag = String(ev.successString || '').toLowerCase();
  if (flag === 'made' || flag === 'scored' || flag === 'good') return true;
  if (flag === 'missed' || flag === 'miss') return false;
  const desc = String(ev.desc || '').toLowerCase();
  if (/\bmiss(?:ed|es)?\b/.test(desc) || /\blocked\b/.test(desc)) return false;
  if (/\bmade\b|\bscored\b|\bgood\b/.test(desc)) return true;
  return false;
}

function pointsForEvent(ev: SrPbpEvent): number {
  if (!isMade(ev)) return 0;
  const t = normalizeEventType(ev);
  if (t === '3pt' || t === '3p' || t === 'threepoint') return 3;
  if (t === '2pt' || t === '2p' || t === 'twopoint') return 2;
  if (t === 'freethrow' || t === 'ft' || t === '1pt') return 1;
  return 0;
}

function clockSecondsRemaining(clock: string | null | undefined): number | null {
  const s = String(clock || '').trim();
  if (!s) return null;
  const m = s.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (!m) return null;
  const hours = Number(m[1] || 0);
  const mins = Number(m[2] || 0);
  const secs = Number(m[3] || 0);
  if (![hours, mins, secs].every((n) => Number.isFinite(n))) return null;
  return hours * 3600 + mins * 60 + secs;
}

function periodLengthSeconds(periodId: number | null | undefined): number {
  const n = Number(periodId);
  if (!Number.isFinite(n) || n <= 4) return 10 * 60;
  return 5 * 60;
}

function playerKey(personId: string | null | undefined, name: string): string | null {
  const id = String(personId || '').trim();
  if (id) return `id:${id}`;
  const n = name.trim().toLowerCase();
  if (n) return `name:${n}`;
  return null;
}

function bumpLink(map: Map<string, LinkAcc>, key: string, personId: string | null, name: string, pts: number): void {
  let row = map.get(key);
  if (!row) {
    row = { personId, name, count: 0, pts: 0 };
    map.set(key, row);
  } else if (!row.personId && personId) {
    row.personId = personId;
  }
  if (name && (!row.name || row.name.length < name.length)) row.name = name;
  row.count += 1;
  row.pts += pts;
}

function isSubIn(ev: SrPbpEvent): boolean {
  const st = String(ev.eventSubType || '').toLowerCase();
  if (st === 'in') return true;
  if (st === 'out') return false;
  return /substitution\s*in/i.test(String(ev.desc || ''));
}

function isSubOut(ev: SrPbpEvent): boolean {
  const st = String(ev.eventSubType || '').toLowerCase();
  if (st === 'out') return true;
  if (st === 'in') return false;
  return /substitution\s*out/i.test(String(ev.desc || ''));
}

function isPossessionEnd(ev: SrPbpEvent): boolean {
  const t = normalizeEventType(ev);
  if (t === 'turnover' || t === 'to') return true;
  if (t === 'rebound' || t === 'reb') {
    return String(ev.eventSubType || '').toLowerCase() === 'defensive';
  }
  if (t === '2pt' || t === '3pt' || t === '2p' || t === '3p' || t === 'threepoint' || t === 'twopoint') {
    return isMade(ev);
  }
  return false;
}

function linkPairs(map: Map<string, LinkAcc>): NblChemLinkPair[] {
  return [...map.values()]
    .map((row) => ({
      personId: row.personId,
      name: row.name,
      count: row.count,
      pts: row.pts,
    }))
    .sort((a, b) => b.count - a.count || b.pts - a.pts || a.name.localeCompare(b.name));
}

export function parseNblPbpChemistry(fixtureId: string, json: unknown): NblFixtureChemistry | null {
  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== 'object') return null;

  const banner = data.banner as { fixture?: { competitors?: SrCompetitor[] } } | undefined;
  const fixture = (data.fixture as { competitors?: SrCompetitor[] } | undefined) || banner?.fixture;
  const competitors = fixture?.competitors || [];
  const homeComp = competitors.find((c) => c.isHome) || competitors[0] || null;
  const awayComp = competitors.find((c) => c.isHome === false) || competitors[1] || null;
  const teamByEntity = new Map<string, { name: string | null; code: string | null }>();
  for (const c of competitors) {
    if (c.entityId) {
      teamByEntity.set(String(c.entityId), { name: c.name ?? null, code: c.code ?? null });
    }
  }
  const teamIds = new Set(teamByEntity.keys());
  const teamNames = new Set(
    [homeComp?.name, awayComp?.name].map((n) => String(n || '').trim().toLowerCase()).filter(Boolean)
  );

  const pbp = data.pbp;
  if (!pbp || typeof pbp !== 'object') return null;

  const periodKeys = Object.keys(pbp as Record<string, unknown>).sort((a, b) => Number(a) - Number(b));
  const events: SrPbpEvent[] = [];
  for (const key of periodKeys) {
    events.push(...eventsFromPeriod((pbp as Record<string, unknown>)[key]));
  }
  if (!events.length) return null;

  const players = new Map<string, PlayerAcc>();

  const ensurePlayer = (ev: SrPbpEvent): PlayerAcc | null => {
    const name = String(ev.name || '').trim();
    const personId = ev.personId ? String(ev.personId) : null;
    if (!name && !personId) return null;
    if (name && teamNames.has(name.toLowerCase())) return null;
    const teamId = ev.entityId ? String(ev.entityId) : '';
    if (!teamId || !teamIds.has(teamId)) return null;
    const key = playerKey(personId, name);
    if (!key) return null;
    let row = players.get(key);
    if (!row) {
      const team = teamByEntity.get(teamId) || null;
      row = {
        key,
        personId,
        name,
        teamId,
        teamCode: team?.code ?? null,
        teamName: team?.name ?? null,
        madeFg: 0,
        assistedMakes: 0,
        assists: 0,
        ptsCreated: 0,
        finds: new Map(),
        foundBy: new Map(),
        minutes: 0,
        teammates: new Map(),
      };
      players.set(key, row);
    } else {
      if (!row.name && name) row.name = name;
      if (!row.personId && personId) row.personId = personId;
    }
    return row;
  };

  for (let i = 0; i < events.length; i++) {
    ensurePlayer(events[i]);
  }

  const onCourt = new Map<string, Set<string>>();
  for (const teamId of teamIds) onCourt.set(teamId, new Set());

  const seenFirst = new Set<string>();
  for (const ev of events) {
    const row = ensurePlayer(ev);
    if (!row || seenFirst.has(row.key)) continue;
    seenFirst.add(row.key);
    // Bench players enter as substitution in; everyone else who appears started.
    if (normalizeEventType(ev) === 'substitution' && isSubIn(ev)) continue;
    const set = onCourt.get(row.teamId);
    if (!set || set.size >= 5) continue;
    set.add(row.key);
  }

  let lineupValid = [...onCourt.values()].every((set) => set.size === 5);

  const rosterByTeam = new Map<string, string[]>();
  for (const row of players.values()) {
    const list = rosterByTeam.get(row.teamId) || [];
    list.push(row.key);
    rosterByTeam.set(row.teamId, list);
  }
  for (const keys of rosterByTeam.values()) {
    for (const key of keys) {
      const self = players.get(key);
      if (!self) continue;
      for (const mateKey of keys) {
        if (mateKey === key) continue;
        const mate = players.get(mateKey);
        if (!mate) continue;
        if (!self.teammates.has(mateKey)) {
          self.teammates.set(mateKey, {
            personId: mate.personId,
            name: mate.name,
            onMin: 0,
            offMin: 0,
            onPoss: 0,
            offPoss: 0,
            onPts: 0,
            offPts: 0,
            onReb: 0,
            offReb: 0,
            onAst: 0,
            offAst: 0,
          });
        }
      }
    }
  }

  let prevPeriod: number | null = null;
  let prevRemain: number | null = null;

  const accrue = (seconds: number) => {
    if (!lineupValid || !(seconds > 0)) return;
    const dtMin = seconds / 60;
    for (const [teamId, onSet] of onCourt) {
      const roster = rosterByTeam.get(teamId) || [];
      for (const key of onSet) {
        const row = players.get(key);
        if (!row) continue;
        row.minutes += dtMin;
        for (const mateKey of roster) {
          if (mateKey === key) continue;
          const acc = row.teammates.get(mateKey);
          if (!acc) continue;
          if (onSet.has(mateKey)) acc.onMin += dtMin;
          else acc.offMin += dtMin;
        }
      }
    }
  };

  const bumpPossessions = () => {
    if (!lineupValid) return;
    for (const [teamId, onSet] of onCourt) {
      const roster = rosterByTeam.get(teamId) || [];
      for (const key of onSet) {
        const row = players.get(key);
        if (!row) continue;
        for (const mateKey of roster) {
          if (mateKey === key) continue;
          const acc = row.teammates.get(mateKey);
          if (!acc) continue;
          if (onSet.has(mateKey)) acc.onPoss += 1;
          else acc.offPoss += 1;
        }
      }
    }
  };

  const bumpCounting = (row: PlayerAcc, pts: number, reb: number, ast: number) => {
    if (!lineupValid) return;
    const onSet = onCourt.get(row.teamId);
    if (!onSet || !onSet.has(row.key)) {
      lineupValid = false;
      return;
    }
    for (const [mateKey, acc] of row.teammates) {
      if (onSet.has(mateKey)) {
        acc.onPts += pts;
        acc.onReb += reb;
        acc.onAst += ast;
      } else {
        acc.offPts += pts;
        acc.offReb += reb;
        acc.offAst += ast;
      }
    }
  };

  const applySub = (ev: SrPbpEvent) => {
    const row = ensurePlayer(ev);
    if (!row) return;
    const set = onCourt.get(row.teamId);
    if (!set) return;
    if (isSubOut(ev)) set.delete(row.key);
    else if (isSubIn(ev)) set.add(row.key);
  };

  const findAssistedMake = (assistIndex: number): { scorer: PlayerAcc; pts: number } | null => {
    const assist = events[assistIndex];
    const teamId = assist.entityId ? String(assist.entityId) : '';
    const clock = String(assist.clock || '');
    const periodId = assist.periodId;
    for (let j = assistIndex - 1; j >= 0; j--) {
      const prev = events[j];
      if (prev.periodId !== periodId) break;
      if (String(prev.clock || '') !== clock) break;
      const t = normalizeEventType(prev);
      if (t === 'foul' || t === 'freethrow' || t === 'ft' || t === '1pt') continue;
      if ((t === '2pt' || t === '3pt' || t === '2p' || t === '3p' || t === 'threepoint' || t === 'twopoint') && isMade(prev)) {
        if (String(prev.entityId || '') !== teamId) return null;
        const scorer = ensurePlayer(prev);
        if (!scorer) return null;
        return { scorer, pts: pointsForEvent(prev) };
      }
      break;
    }
    return null;
  };

  const checkLineupSize = () => {
    if (!lineupValid) return;
    for (const set of onCourt.values()) {
      if (set.size !== 5) {
        lineupValid = false;
        return;
      }
    }
  };

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const periodId = Number(ev.periodId);
    const remain = clockSecondsRemaining(ev.clock);
    const periodOk = Number.isFinite(periodId) && periodId >= 1;

    if (periodOk) {
      if (prevPeriod != null && periodId !== prevPeriod) {
        if (prevRemain != null && prevRemain > 0) accrue(prevRemain);
        prevRemain = periodLengthSeconds(periodId);
      }
      if (remain != null) {
        if (prevPeriod === periodId && prevRemain != null && prevRemain > remain) {
          accrue(prevRemain - remain);
        }
        prevRemain = remain;
      }
      prevPeriod = periodId;
    }

    const t = normalizeEventType(ev);

    if (t === 'substitution') {
      applySub(ev);
      let k = i + 1;
      while (k < events.length) {
        const nxt = events[k];
        if (normalizeEventType(nxt) !== 'substitution') break;
        if (nxt.periodId !== ev.periodId) break;
        if (String(nxt.clock || '') !== String(ev.clock || '')) break;
        applySub(nxt);
        k += 1;
      }
      checkLineupSize();
      i = k - 1;
      continue;
    }

    if (t === 'assist' || t === 'ast') {
      const passer = ensurePlayer(ev);
      if (!passer) continue;
      passer.assists += 1;
      bumpCounting(passer, 0, 0, 1);
      const made = findAssistedMake(i);
      if (made) {
        const { scorer, pts } = made;
        scorer.assistedMakes += 1;
        passer.ptsCreated += pts;
        bumpLink(passer.finds, scorer.key, scorer.personId, scorer.name, pts);
        bumpLink(scorer.foundBy, passer.key, passer.personId, passer.name, pts);
      }
      continue;
    }

    if (t === 'rebound' || t === 'reb') {
      const row = ensurePlayer(ev);
      if (!row) continue;
      bumpCounting(row, 0, 1, 0);
      if (isPossessionEnd(ev)) bumpPossessions();
      continue;
    }

    const pts = pointsForEvent(ev);
    if ((t === '2pt' || t === '3pt' || t === '2p' || t === '3p' || t === 'threepoint' || t === 'twopoint') && isMade(ev)) {
      const row = ensurePlayer(ev);
      if (row) {
        row.madeFg += 1;
        bumpCounting(row, pts, 0, 0);
      }
      bumpPossessions();
      continue;
    }

    if (pts > 0) {
      const row = ensurePlayer(ev);
      if (row) bumpCounting(row, pts, 0, 0);
      continue;
    }

    if (t === 'turnover' || t === 'to') {
      bumpPossessions();
    }
  }

  if (prevRemain != null && prevRemain > 0) accrue(prevRemain);

  const playerRows: NblChemPlayer[] = [...players.values()]
    .filter((row) => row.madeFg > 0 || row.assists > 0 || row.minutes > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => ({
      personId: row.personId,
      name: row.name,
      teamCode: row.teamCode,
      teamName: row.teamName,
      madeFg: row.madeFg,
      assistedMakes: row.assistedMakes,
      assists: row.assists,
      ptsCreated: row.ptsCreated,
      finds: linkPairs(row.finds),
      foundBy: linkPairs(row.foundBy),
    }));

  const onOff: NblChemOnOffPlayer[] = lineupValid
    ? [...players.values()]
        .filter((row) => row.minutes > 0)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((row) => ({
          personId: row.personId,
          name: row.name,
          teamCode: row.teamCode,
          teamName: row.teamName,
          minutes: Math.round(row.minutes * 10) / 10,
          teammates: [...row.teammates.values()]
            .filter((t) => t.onMin > 0 || t.offMin > 0)
            .map((t) => ({
              personId: t.personId,
              name: t.name,
              onMin: Math.round(t.onMin * 10) / 10,
              offMin: Math.round(t.offMin * 10) / 10,
              onPoss: t.onPoss,
              offPoss: t.offPoss,
              onPts: t.onPts,
              offPts: t.offPts,
              onReb: t.onReb,
              offReb: t.offReb,
              onAst: t.onAst,
              offAst: t.offAst,
            })),
        }))
    : [];

  return {
    fixtureId,
    homeTeam: homeComp?.name ?? null,
    awayTeam: awayComp?.name ?? null,
    homeTeamCode: homeComp?.code ?? null,
    awayTeamCode: awayComp?.code ?? null,
    lineupValid,
    players: playerRows,
    onOff,
    fetchedAt: new Date().toISOString(),
  };
}

export function isNblChemCacheComplete(cached: NblFixtureChemistry | null | undefined): boolean {
  return Boolean(cached && Array.isArray(cached.players) && Array.isArray(cached.onOff));
}

export function readCachedPbpChemistry(fixtureId: string): NblFixtureChemistry | null {
  const id = String(fixtureId || '').trim();
  if (!id) return null;
  const cached = readJson<NblFixtureChemistry>(chemCachePath(id));
  if (!isNblChemCacheComplete(cached)) return null;
  return cached;
}

export function writeCachedPbpChemistry(payload: NblFixtureChemistry): void {
  writeJson(chemCachePath(payload.fixtureId), payload);
}

function teamsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = resolveNblClubName(String(a || ''));
  const cb = resolveNblClubName(String(b || ''));
  if (!ca || !cb) return false;
  return ca === cb;
}

function matchChemPlayer<T extends { name: string; teamName?: string | null; teamCode?: string | null }>(
  rows: T[],
  playerName: string,
  team: string | null
): T | null {
  const named = rows.filter((p) => nblShotPlayerNamesMatch(p.name, playerName));
  if (!named.length) return null;
  if (team) {
    const onTeam = named.filter((p) => teamsMatch(p.teamName, team) || teamsMatch(p.teamCode, team));
    if (onTeam.length === 1) return onTeam[0];
    if (onTeam.length > 1) return onTeam[0];
  }
  if (named.length === 1) return named[0];
  return named[0];
}

type LinkSum = { personId: string | null; name: string; count: number; pts: number };
type OnOffSum = {
  personId: string | null;
  name: string;
  onMin: number;
  offMin: number;
  onPoss: number;
  onPts: number;
  offPts: number;
  onReb: number;
  offReb: number;
  onAst: number;
  offAst: number;
};

function mergeNamed(map: Map<string, LinkSum>, personId: string | null, name: string, count: number, pts: number) {
  const key = personId ? `id:${personId}` : `name:${name.trim().toLowerCase()}`;
  let row = map.get(key);
  if (!row) {
    for (const [existingKey, existing] of map) {
      if (nblShotPlayerNamesMatch(existing.name, name)) {
        row = existing;
        map.delete(existingKey);
        map.set(personId ? `id:${personId}` : existingKey, existing);
        break;
      }
    }
  }
  if (!row) {
    row = { personId, name, count: 0, pts: 0 };
    map.set(key, row);
  }
  if (!row.personId && personId) row.personId = personId;
  if (name && name.length > row.name.length) row.name = name;
  row.count += count;
  row.pts += pts;
}

function mergeOnOff(
  map: Map<string, OnOffSum>,
  mate: NblChemOnOffTeammate
) {
  const key = mate.personId ? `id:${mate.personId}` : `name:${mate.name.trim().toLowerCase()}`;
  let row = map.get(key);
  if (!row) {
    for (const [existingKey, existing] of map) {
      if (nblShotPlayerNamesMatch(existing.name, mate.name)) {
        row = existing;
        map.delete(existingKey);
        map.set(mate.personId ? `id:${mate.personId}` : existingKey, existing);
        break;
      }
    }
  }
  if (!row) {
    row = {
      personId: mate.personId,
      name: mate.name,
      onMin: 0,
      offMin: 0,
      onPoss: 0,
      onPts: 0,
      offPts: 0,
      onReb: 0,
      offReb: 0,
      onAst: 0,
      offAst: 0,
    };
    map.set(key, row);
  }
  if (!row.personId && mate.personId) row.personId = mate.personId;
  if (mate.name && mate.name.length > row.name.length) row.name = mate.name;
  row.onMin += mate.onMin;
  row.offMin += mate.offMin;
  row.onPoss += mate.onPoss;
  row.onPts += mate.onPts;
  row.offPts += mate.offPts;
  row.onReb += mate.onReb;
  row.offReb += mate.offReb;
  row.onAst += mate.onAst;
  row.offAst += mate.offAst;
}

function toLinkRows(map: Map<string, LinkSum>, denom: number): NblChemistryLinkupRow[] {
  return [...map.values()]
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || b.pts - a.pts || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((row) => ({
      name: row.name,
      personId: row.personId,
      count: row.count,
      pts: row.pts,
      share: denom > 0 ? row.count / denom : 0,
    }));
}

function per36(value: number, minutes: number): number {
  if (!(minutes > 0)) return 0;
  return (value / minutes) * 36;
}

function toOnCourtRows(map: Map<string, OnOffSum>, metric: NblChemistryMetric): NblChemistryOnCourtRow[] {
  const rows: NblChemistryOnCourtRow[] = [];
  for (const row of map.values()) {
    if (row.onMin < NBL_CHEM_MIN_SHARED_MINUTES && row.onPoss < NBL_CHEM_MIN_SHARED_POSSESSIONS) continue;
    if (row.offMin < NBL_CHEM_MIN_OFF_MINUTES) continue;
    const onVal = metric === 'points' ? row.onPts : metric === 'rebounds' ? row.onReb : row.onAst;
    const offVal = metric === 'points' ? row.offPts : metric === 'rebounds' ? row.offReb : row.offAst;
    const onPer = per36(onVal, row.onMin);
    const offPer = per36(offVal, row.offMin);
    let liftPct: number | null = null;
    if (offPer > 0) liftPct = ((onPer - offPer) / offPer) * 100;
    else if (onPer > 0) liftPct = 100;
    rows.push({
      name: row.name,
      personId: row.personId,
      onPer36: Math.round(onPer * 10) / 10,
      offPer36: Math.round(offPer * 10) / 10,
      liftPct: liftPct == null ? null : Math.round(liftPct),
      onMinutes: Math.round(row.onMin * 10) / 10,
      offMinutes: Math.round(row.offMin * 10) / 10,
      onPossessions: row.onPoss,
    });
  }
  return rows.sort(
    (a, b) =>
      Math.abs(b.liftPct ?? 0) - Math.abs(a.liftPct ?? 0) || b.onMinutes - a.onMinutes || a.name.localeCompare(b.name)
  );
}

export function loadPlayerChemistryForApi(
  playerName: string,
  team: string | null = null,
  year: number = NBL_CURRENT_SEASON_YEAR
): NblChemistryPayload {
  const name = String(playerName || '').trim();
  const seasonYear = Number.isFinite(year) ? year : NBL_CURRENT_SEASON_YEAR;
  if (!name) return emptyNblChemistryPayload('', seasonYear, EMPTY_MESSAGE);

  const games = loadScheduleGames([seasonYear]).filter(isCompletedGame);
  const fixtureIds = [...new Set(games.map((g) => fixtureIdOf(g)).filter((id): id is string => Boolean(id)))];

  let chemFiles = 0;
  let gamesUsed = 0;
  let gamesWithOnOff = 0;
  let madeFg = 0;
  let assistedMakes = 0;
  let assists = 0;
  let matchedTeam: string | null = team;
  const finds = new Map<string, LinkSum>();
  const foundBy = new Map<string, LinkSum>();
  const onOff = new Map<string, OnOffSum>();

  for (const fixtureId of fixtureIds) {
    const chem = readCachedPbpChemistry(fixtureId);
    if (!chem) continue;
    chemFiles += 1;
    const player = matchChemPlayer(chem.players, name, team);
    if (!player) continue;
    gamesUsed += 1;
    madeFg += player.madeFg;
    assistedMakes += player.assistedMakes;
    assists += player.assists;
    if (!matchedTeam && player.teamName) matchedTeam = player.teamName;
    for (const pair of player.finds) mergeNamed(finds, pair.personId, pair.name, pair.count, pair.pts);
    for (const pair of player.foundBy) mergeNamed(foundBy, pair.personId, pair.name, pair.count, pair.pts);

    if (chem.lineupValid && chem.onOff.length) {
      const stint = matchChemPlayer(chem.onOff, name, team);
      if (stint) {
        gamesWithOnOff += 1;
        for (const mate of stint.teammates) mergeOnOff(onOff, mate);
      }
    }
  }

  if (!chemFiles) return emptyNblChemistryPayload(name, seasonYear, EMPTY_MESSAGE);
  if (!gamesUsed) {
    return emptyNblChemistryPayload(name, seasonYear, 'No chemistry data for this player.');
  }

  const unassistedMakes = Math.max(0, madeFg - assistedMakes);
  return {
    success: true,
    empty: false,
    message: null,
    playerName: name,
    team: matchedTeam,
    seasonYear,
    gamesUsed,
    gamesWithOnOff,
    madeFg,
    assistedMakes,
    unassistedMakes,
    unassistedMakePct: madeFg > 0 ? unassistedMakes / madeFg : null,
    assists,
    heFinds: toLinkRows(finds, assists),
    findsHim: toLinkRows(foundBy, assistedMakes),
    onCourt: {
      points: toOnCourtRows(onOff, 'points'),
      rebounds: toOnCourtRows(onOff, 'rebounds'),
      assists: toOnCourtRows(onOff, 'assists'),
    },
  };
}
