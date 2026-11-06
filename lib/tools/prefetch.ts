/**
 * Warm Tools opportunities on sidebar hover — same idea as props early-fetch.
 */

import { supabase } from '@/lib/supabaseClient';
import { writeToolsOpsCache } from './clientCache';

let inFlight: Promise<void> | null = null;
let lastKick = 0;

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function kickToolsEarlyFetch(): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (now - lastKick < 8_000) return;
  lastKick = now;
  if (inFlight) return;
  inFlight = (async () => {
    try {
      const qs = new URLSearchParams({ sport: 'all', kind: 'all' });
      const res = await fetch(`/api/tools/opportunities?${qs}`, {
        headers: await authHeaders(),
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success || !Array.isArray(json.opportunities)) return;
      writeToolsOpsCache(json.opportunities);
    } catch {
      /* ignore */
    } finally {
      inFlight = null;
    }
  })();
}
