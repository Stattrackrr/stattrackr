/**
 * Browser-side Tools board cache for instant paint on revisit / tab return.
 */

import type { ToolsOpportunity } from './types';

const OPS_KEY = 'stattrackr:tools:ops:v4';
const MAX_AGE_MS = 10 * 60_000;

type StoredOps = {
  at: number;
  opportunities: ToolsOpportunity[];
};

export function readToolsOpsCache(): ToolsOpportunity[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(OPS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredOps;
    if (!parsed || !Array.isArray(parsed.opportunities)) return null;
    if (!(Number(parsed.at) > 0) || Date.now() - parsed.at > MAX_AGE_MS) return null;
    return parsed.opportunities;
  } catch {
    return null;
  }
}

export function writeToolsOpsCache(opportunities: ToolsOpportunity[]): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: StoredOps = { at: Date.now(), opportunities: opportunities.slice(0, 120) };
    sessionStorage.setItem(OPS_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}
