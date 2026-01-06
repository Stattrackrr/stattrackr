import { DepthChartData } from '../types';
import { cachedFetch } from '@/lib/requestCache';

/**
 * Fetch team depth chart data
 */
export async function fetchTeamDepthChart(team: string): Promise<DepthChartData | null> {
  try {
    if (!team || team === 'N/A') return null;
    const url = `/api/depth-chart?team=${encodeURIComponent(team)}`;
    // Use cachedFetch to prevent duplicate requests and respect rate limits
    const js = await cachedFetch(url, undefined, 300000); // Cache for 5 minutes
    if (!js || !js.success) return null;
    return js?.depthChart as DepthChartData | null;
  } catch (error) {
    console.warn(`Failed to fetch depth chart for ${team}:`, error);
    return null;
  }
}

/**
 * Resolve BDL player id from a name if depth chart item lacks an id
 */
export async function resolveTeammateIdFromName(name: string): Promise<number | null> {
  try {
    if (!name) return null;
    const q = new URLSearchParams();
    q.set('endpoint', '/players');
    q.set('search', name);
    q.set('per_page', '100');
    const url = `/api/balldontlie?${q.toString()}`;
    const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
    const js = await res?.json().catch(() => ({})) as any;
    const arr = Array.isArray(js?.data) ? js.data : [];
    if (arr.length === 0) return null;
    // Prefer exact full-name match
    const exact = arr.find((p: any) => `${p.first_name} ${p.last_name}`.trim().toLowerCase() === name.trim().toLowerCase());
    const chosen = exact || arr[0];
    return typeof chosen?.id === 'number' ? chosen.id : null;
  } catch {
    return null;
  }
}

