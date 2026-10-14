import { normalizeTeamKey, resolveNbaClubName } from '@/lib/nba/dash/teams';

export const NBA_NEXT_GAME_PREFETCH_KEY = 'nba_next_game_prefetch';
const PREFETCH_TTL_MS = 60_000;

export type NbaNextGamePrefetch = {
  team: string;
  next_opponent: string | null;
  next_game_tipoff: string | null;
  next_game_id: string | null;
  opponent_logo: string | null;
  fetchedAt: number;
};

function teamsMatch(a: string, b: string): boolean {
  const aKey = normalizeTeamKey(resolveNbaClubName(a) || a);
  const bKey = normalizeTeamKey(resolveNbaClubName(b) || b);
  return Boolean(aKey && bKey && (aKey === bKey || aKey.includes(bKey) || bKey.includes(aKey)));
}

export function writeNbaNextGamePrefetch(payload: Omit<NbaNextGamePrefetch, 'fetchedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const next: NbaNextGamePrefetch = { ...payload, fetchedAt: Date.now() };
    sessionStorage.setItem(NBA_NEXT_GAME_PREFETCH_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

export function readNbaNextGamePrefetch(team?: string | null): NbaNextGamePrefetch | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(NBA_NEXT_GAME_PREFETCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NbaNextGamePrefetch;
    const age = parsed?.fetchedAt != null ? Date.now() - Number(parsed.fetchedAt) : Infinity;
    if (!Number.isFinite(age) || age > PREFETCH_TTL_MS) return null;
    const want = String(team || '').trim();
    if (want && parsed.team && !teamsMatch(want, parsed.team)) return null;
    return parsed;
  } catch {
    return null;
  }
}
