import { tennisIdentityMatch, tennisSamePersonRecords } from '@/lib/tennis/oddsApi';

function normalizeName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tourOf(player: { team?: string | null; tour?: string | null }): string {
  return String(player.tour || player.team || '')
    .trim()
    .toUpperCase();
}

function rankValue(player: { jersey?: string | number | null; rank?: number | null }): number {
  const jersey = Number(player.jersey);
  if (Number.isFinite(jersey) && jersey > 0) return jersey;
  const rank = Number(player.rank);
  if (Number.isFinite(rank) && rank > 0) return rank;
  return 99999;
}

export function findTennisRosterPlayer<
  T extends {
    playerId?: string | null;
    name: string;
    team?: string | null;
    tour?: string | null;
    jersey?: string | number | null;
    rank?: number | null;
  },
>(
  roster: readonly T[],
  selected: {
    playerId?: string | null;
    name?: string | null;
    team?: string | null;
    tour?: string | null;
  }
): T | null {
  const want = normalizeName(selected.name || '');
  const teamWant = tourOf(selected);
  const playerId = String(selected.playerId || '').trim();
  const byId = playerId ? roster.find((player) => String(player.playerId || '').trim() === playerId) : null;
  const idMatchesName =
    Boolean(byId) &&
    (!want ||
      normalizeName(byId!.name) === want ||
      tennisIdentityMatch(byId!.name, selected.name));
  if (idMatchesName) return byId!;

  const nameHits = roster.filter((player) => {
    const same =
      (want && normalizeName(player.name) === want) || tennisIdentityMatch(player.name, selected.name);
    if (!same) return false;
    if (!teamWant) return true;
    const tour = tourOf(player);
    return !tour || tour === teamWant;
  });
  if (nameHits.length === 1) return nameHits[0];
  const unique = tennisSamePersonRecords(
    nameHits.map((player) => ({ ...player, playerId: player.playerId ?? undefined }))
  );
  if (!unique?.length) return null;
  return [...unique].sort((a, b) => rankValue(a) - rankValue(b) || a.name.localeCompare(b.name))[0];
}
