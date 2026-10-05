import { tennisIdentityMatch, tennisSamePersonRecords } from '@/lib/tennis/oddsApi';
import type { TennisMatchRow } from '@/lib/tennis/types';

export function tennisH2hPairKey(playerId: string, opponentId: string): string {
  const left = String(playerId || '').trim();
  const right = String(opponentId || '').trim();
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

export function tennisIsH2hMatch(
  row: { opponent?: string | null; opponentId?: string | number | null },
  opponentName?: string | null,
  opponentId?: string | number | null
): boolean {
  const targetId = String(opponentId ?? '').trim();
  const rowId = String(row.opponentId ?? '').trim();
  if (targetId && rowId && targetId === rowId) return true;
  const target = String(opponentName || '').trim();
  const rowOpp = String(row.opponent || '').trim();
  if (!target || !rowOpp) return false;
  return tennisIdentityMatch(rowOpp, target);
}

export function tennisResolveOpponentId(
  players: Array<{ playerId?: string | null; name?: string | null; tour?: string | null }>,
  opponentName?: string | null,
  opponentId?: string | null,
  tour?: string | null
): string | null {
  const id = String(opponentId || '').trim();
  if (/^\d+$/.test(id)) return id;
  const name = String(opponentName || '').trim();
  if (!name) return null;
  const wantedTour = String(tour || '').trim().toUpperCase();
  const hits = players.filter((player) => {
    if (!tennisIdentityMatch(player.name, name)) return false;
    if (!wantedTour) return true;
    return String(player.tour || '').toUpperCase() === wantedTour;
  });
  const unique = tennisSamePersonRecords(
    hits.map((player) => ({
      playerId: String(player.playerId || ''),
      name: String(player.name || ''),
    }))
  );
  if (unique?.length) return unique[0].playerId || null;
  return hits.length === 1 ? String(hits[0].playerId || '').trim() || null : null;
}

export function mergeTennisH2hRows(
  primary: TennisMatchRow[],
  overlay: TennisMatchRow[]
): TennisMatchRow[] {
  const byId = new Map<string, TennisMatchRow>();
  const extras: TennisMatchRow[] = [];
  const take = (row: TennisMatchRow | null | undefined) => {
    if (!row) return;
    const id = String(row.matchId || '').trim();
    if (!id) {
      extras.push(row);
      return;
    }
    const prev = byId.get(id);
    if (!prev || (row.totalGames || 0) >= (prev.totalGames || 0)) byId.set(id, row);
  };
  for (const row of primary) take(row);
  for (const row of overlay) take(row);
  return [...byId.values(), ...extras].sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || ''))
  );
}
