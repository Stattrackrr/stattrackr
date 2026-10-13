import type { PropsDashboardSport } from '@/lib/propsDashboardLinks';

/**
 * Free accounts get one player per sport: the top prop the props page shows them.
 * The props page saves that pick here; dashboards unlock everything for it and lock other players.
 */
export type FreePlayerPick = {
  sport: PropsDashboardSport;
  name: string;
  id: string | null;
  href: string;
};

export type FreePlayerPicks = Partial<Record<PropsDashboardSport, FreePlayerPick>>;

const STORAGE_KEY = 'st_free_players_v1';
const CHANGE_EVENT = 'st-free-players-change';

function normName(name: string | null | undefined): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "A. Gea" and "Arthur Gea" are the same player; "A. Gea" and "B. Gea" are not. */
function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(' ');
  const ys = y.split(' ');
  if (xs[xs.length - 1] !== ys[ys.length - 1]) return false;
  return xs[0][0] === ys[0][0] && (xs[0].length === 1 || ys[0].length === 1);
}

export function readFreePlayerPicks(): FreePlayerPicks {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as FreePlayerPicks;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Replaces the pick for each sport given; other sports keep theirs. */
export function saveFreePlayerPicks(picks: FreePlayerPick[]): void {
  if (typeof window === 'undefined' || !picks.length) return;
  const current = readFreePlayerPicks();
  let changed = false;
  for (const pick of picks) {
    if (!pick.name) continue;
    const prev = current[pick.sport];
    if (prev && prev.name === pick.name && prev.id === pick.id && prev.href === pick.href) continue;
    current[pick.sport] = pick;
    changed = true;
  }
  if (!changed) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Storage full or blocked — the dashboard falls back to locking every player.
  }
}

export function freePlayerPicksFor(picks: FreePlayerPicks, sports: readonly PropsDashboardSport[]): FreePlayerPick[] {
  return sports.map((sport) => picks[sport]).filter((pick): pick is FreePlayerPick => Boolean(pick));
}

export function isFreePlayerPick(
  picks: FreePlayerPicks,
  sports: readonly PropsDashboardSport[],
  player: { name?: string | null; id?: string | number | null }
): boolean {
  const id = String(player.id ?? '').trim();
  return freePlayerPicksFor(picks, sports).some(
    (pick) => (id !== '' && pick.id != null && String(pick.id) === id) || sameName(pick.name, player.name)
  );
}

export function subscribeFreePlayerPicks(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
