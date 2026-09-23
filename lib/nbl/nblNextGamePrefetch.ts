import { normalizeTeamKey, resolveNblClubName } from '@/lib/nblTeamCanonical';

export const NBL_NEXT_GAME_PREFETCH_KEY = 'nbl_next_game_prefetch';
const PREFETCH_TTL_MS = 60_000;

export type NblNextGamePrefetch = {
  team: string;
  next_opponent: string | null;
  next_game_tipoff: string | null;
  next_game_id: string | null;
  opponent_logo: string | null;
  fetchedAt: number;
};

function teamsMatch(a: string, b: string): boolean {
  const aKey = normalizeTeamKey(resolveNblClubName(a) || a);
  const bKey = normalizeTeamKey(resolveNblClubName(b) || b);
  return Boolean(aKey && bKey && (aKey === bKey || aKey.includes(bKey) || bKey.includes(aKey)));
}

export function writeNblNextGamePrefetch(payload: Omit<NblNextGamePrefetch, 'fetchedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const next: NblNextGamePrefetch = { ...payload, fetchedAt: Date.now() };
    sessionStorage.setItem(NBL_NEXT_GAME_PREFETCH_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

export function readNblNextGamePrefetch(team?: string | null): NblNextGamePrefetch | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(NBL_NEXT_GAME_PREFETCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NblNextGamePrefetch;
    const age = parsed?.fetchedAt != null ? Date.now() - Number(parsed.fetchedAt) : Infinity;
    if (!Number.isFinite(age) || age > PREFETCH_TTL_MS) return null;
    const want = String(team || '').trim();
    if (want && parsed.team && !teamsMatch(want, parsed.team)) return null;
    return parsed;
  } catch {
    return null;
  }
}
