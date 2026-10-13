import { DEFAULT_AI_PICKS_PARAMS, type AiPicksParams } from '@/lib/aiPicks/params';
import { scanNblCandidates, type NblScanResult } from '@/lib/aiPicks/candidates/nblScan';
import { scanTennisCandidates, type TennisScanResult } from '@/lib/aiPicks/candidates/tennisScan';
import type { AiCandidate } from '@/lib/aiPicks/candidates/types';

export type CandidateScan = {
  scannedAt: string;
  candidates: AiCandidate[];
  nbl: Omit<NblScanResult, 'candidates'> | null;
  tennis: Omit<TennisScanResult, 'candidates'> | null;
  errors: string[];
};

/** Every priced selection starting within the horizon, across active sports. Reads stored data only. */
export async function scanAiCandidates(opts: { nowMs?: number; horizonMs?: number; params?: AiPicksParams } = {}): Promise<CandidateScan> {
  const nowMs = opts.nowMs ?? Date.now();
  const params = opts.params ?? DEFAULT_AI_PICKS_PARAMS;
  const errors: string[] = [];
  const [nbl, tennis] = await Promise.all([
    scanNblCandidates({ nowMs, horizonMs: opts.horizonMs, params: params.nbl }).catch((e: Error) => {
      errors.push(`nbl: ${e.message}`);
      return null;
    }),
    scanTennisCandidates({ nowMs, horizonMs: opts.horizonMs, params: params.tennis }).catch((e: Error) => {
      errors.push(`tennis: ${e.message}`);
      return null;
    }),
  ]);
  const strip = <T extends { candidates: AiCandidate[] }>(r: T | null) => {
    if (!r) return null;
    const { candidates: _drop, ...rest } = r;
    return rest;
  };
  return {
    scannedAt: new Date(nowMs).toISOString(),
    candidates: [...(nbl?.candidates ?? []), ...(tennis?.candidates ?? [])].sort((a, b) => b.ev - a.ev),
    nbl: strip(nbl),
    tennis: strip(tennis),
    errors,
  };
}
