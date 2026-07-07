export const AFL_TEAM_LOGOS_CACHE_KEY = 'afl_team_logos_cache_v1';
export const AFL_TEAM_LOGOS_CACHE_TS_KEY = 'afl_team_logos_cache_ts_v1';
export const AFL_TEAM_LOGOS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function readAflTeamLogosSessionCache(): Record<string, string> | null {
  if (typeof window === 'undefined') return null;
  try {
    const cachedRaw = sessionStorage.getItem(AFL_TEAM_LOGOS_CACHE_KEY);
    const cachedTsRaw = sessionStorage.getItem(AFL_TEAM_LOGOS_CACHE_TS_KEY);
    const age = cachedTsRaw ? Date.now() - Number(cachedTsRaw) : Infinity;
    if (!cachedRaw || !Number.isFinite(age) || age >= AFL_TEAM_LOGOS_CACHE_TTL_MS) return null;
    const parsed = JSON.parse(cachedRaw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeAflTeamLogosSessionCache(logos: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(AFL_TEAM_LOGOS_CACHE_KEY, JSON.stringify(logos));
    sessionStorage.setItem(AFL_TEAM_LOGOS_CACHE_TS_KEY, Date.now().toString());
  } catch {
    // ignore
  }
}
