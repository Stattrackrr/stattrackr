/**
 * Closing (or last pre-tip) Aussie-book prop lines for NBL Similar Players rows.
 * Source: player-prop-lines disk + Redis snapshots written by the NBL props ingest.
 * Uses the Aussie-book consensus O/U line when available, else any-book O/U / milestone.
 */

import { isAussieBook } from '@/lib/aiPicks/candidates/types';
import { isNblPropMarket } from '@/lib/aiPicks/markets';
import {
  listNblPlayerPropSnapshots,
  playerKeyOf,
  type NblPlayerPropSnapshot,
  type NblSnapLine,
} from '@/lib/nbl/playerPropSnapshots';
import { nblListGameStamp, nblListSnapshotForGame } from '@/lib/nbl/playerPropsList';
import { namesMatch } from '@/lib/nbl/pulseScore';
import { officialNblClubName, resolveNblClubName } from '@/lib/nblTeamCanonical';

export type NblSimilarLineKey = {
  playerId: string;
  matchId: string;
  /** Dashboard / prop-log stat key (points, rebounds, …). */
  stat: string;
  playerName: string;
  date: string | null;
  team: string;
  opponent: string;
  isHome: boolean;
};

export type NblSimilarLineHit = {
  line: number;
  book: string | null;
};

function dayShift(isoDay: string, delta: number): string | null {
  const t = Date.parse(`${isoDay}T12:00:00.000Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t + delta * 86_400_000).toISOString().slice(0, 10);
}

function homeAway(key: NblSimilarLineKey): { homeTeam: string; awayTeam: string } | null {
  const team = resolveNblClubName(key.team) || String(key.team || '').trim();
  const opp = resolveNblClubName(key.opponent) || String(key.opponent || '').trim();
  if (!team || !opp) return null;
  return key.isHome ? { homeTeam: team, awayTeam: opp } : { homeTeam: opp, awayTeam: team };
}

function findSnapshot(
  snapshots: NblPlayerPropSnapshot[],
  key: NblSimilarLineKey
): NblPlayerPropSnapshot | null {
  const sides = homeAway(key);
  if (!sides) return null;
  const day = String(key.date || '').slice(0, 10);
  const candidates = [day, day ? dayShift(day, -1) : null, day ? dayShift(day, 1) : null].filter(
    (d): d is string => Boolean(d)
  );
  for (const commenceTime of candidates) {
    const hit = nblListSnapshotForGame(snapshots, {
      homeTeam: sides.homeTeam,
      awayTeam: sides.awayTeam,
      commenceTime,
    });
    if (hit) return hit;
  }
  // Rematch / date drift: same derby on any day — prefer closest commence day.
  if (!day) return null;
  const stampTeams = nblListGameStamp(sides.homeTeam, sides.awayTeam, day).split('|').slice(1).join('|');
  const sameDerby = snapshots
    .filter((snap) => {
      const s = nblListGameStamp(snap.homeTeam, snap.awayTeam, snap.commenceTime);
      return s.split('|').slice(1).join('|') === stampTeams;
    })
    .sort((a, b) => {
      const da = Math.abs(Date.parse(a.commenceTime) - Date.parse(`${day}T12:00:00.000Z`));
      const db = Math.abs(Date.parse(b.commenceTime) - Date.parse(`${day}T12:00:00.000Z`));
      return (Number.isFinite(da) ? da : 1e15) - (Number.isFinite(db) ? db : 1e15);
    });
  const best = sameDerby[0];
  if (!best) return null;
  const delta = Math.abs(Date.parse(best.commenceTime) - Date.parse(`${day}T12:00:00.000Z`));
  return Number.isFinite(delta) && delta <= 2 * 86_400_000 ? best : null;
}

function isTwoWayOu(line: NblSnapLine): boolean {
  return line.kind === 'ou' && line.under !== 'N/A' && line.over !== 'N/A';
}

function playerLines(snap: NblPlayerPropSnapshot, playerName: string, stat: string): NblSnapLine[] {
  const want = playerKeyOf(playerName);
  return snap.lines.filter((line) => {
    if (line.stat !== stat) return false;
    if (want && line.playerKey === want) return true;
    return namesMatch(playerName, line.player);
  });
}

/** One line per book — prefer two-way O/U, else any O/U, else milestone. */
function mainLineForBook(lines: NblSnapLine[]): NblSnapLine | null {
  const twoWay = lines.filter(isTwoWayOu);
  if (twoWay.length) {
    return twoWay.slice().sort((a, b) => a.line - b.line)[Math.floor((twoWay.length - 1) / 2)] ?? null;
  }
  const ou = lines.filter((l) => l.kind === 'ou');
  if (ou.length) {
    return ou.slice().sort((a, b) => a.line - b.line)[Math.floor((ou.length - 1) / 2)] ?? null;
  }
  const milestones = lines.filter((l) => l.kind === 'milestone');
  if (!milestones.length) return null;
  return milestones.slice().sort((a, b) => a.line - b.line)[Math.floor((milestones.length - 1) / 2)] ?? null;
}

function pickLine(snap: NblPlayerPropSnapshot, playerName: string, stat: string): NblSimilarLineHit | null {
  const rows = playerLines(snap, playerName, stat);
  if (!rows.length) return null;

  const byBook = new Map<string, NblSnapLine[]>();
  for (const row of rows) {
    const list = byBook.get(row.book) ?? [];
    list.push(row);
    byBook.set(row.book, list);
  }

  const bookMains = [...byBook.entries()]
    .map(([book, lines]) => {
      const main = mainLineForBook(lines);
      return main ? { book, line: main.line, twoWay: isTwoWayOu(main), aussie: isAussieBook(book) } : null;
    })
    .filter((x): x is { book: string; line: number; twoWay: boolean; aussie: boolean } => Boolean(x));

  const aussie = bookMains.filter((b) => b.aussie);
  const pool = aussie.length ? aussie : bookMains;
  if (!pool.length) return null;

  const twoWayPool = pool.filter((b) => b.twoWay);
  const use = twoWayPool.length ? twoWayPool : pool;
  const sorted = use.slice().sort((a, b) => a.line - b.line);
  const mid = sorted[Math.floor((sorted.length - 1) / 2)]!;
  return { line: mid.line, book: mid.book };
}

/**
 * Batch lookup: one line per player×game×stat. Missing keys are omitted from the map.
 * Matches snapshots by game day + teams (Rosetta matchId ≠ odds gameId).
 */
export async function lookupNblSimilarPlayerLines(
  keys: NblSimilarLineKey[]
): Promise<Map<string, NblSimilarLineHit>> {
  const out = new Map<string, NblSimilarLineHit>();
  const usable = keys.filter(
    (k) =>
      k.playerId &&
      k.matchId &&
      k.playerName &&
      k.team &&
      k.opponent &&
      isNblPropMarket(k.stat)
  );
  if (!usable.length) return out;

  let snapshots: NblPlayerPropSnapshot[] = [];
  try {
    snapshots = (await listNblPlayerPropSnapshots()).filter(
      (snap) => officialNblClubName(snap.homeTeam) && officialNblClubName(snap.awayTeam)
    );
  } catch (err) {
    console.warn('[NBL similar lines]', err instanceof Error ? err.message : err);
    return out;
  }
  if (!snapshots.length) return out;

  for (const k of usable) {
    const snap = findSnapshot(snapshots, k);
    if (!snap) continue;
    const hit = pickLine(snap, k.playerName, k.stat);
    if (!hit) continue;
    out.set(`${k.matchId}|${k.playerId}|${k.stat}`, hit);
  }
  return out;
}
