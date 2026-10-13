import { DEFAULT_AI_PICKS_PARAMS, mergeSportParams, type AiPicksParams } from '@/lib/aiPicks/params';
import { listActiveLearningStates, type LearningStateRow } from '@/lib/aiPicks/server';

/** Defaults with each sport's active learned params laid over them. */
export function paramsFromStates(rows: LearningStateRow[]): AiPicksParams {
  const d = DEFAULT_AI_PICKS_PARAMS;
  const out: AiPicksParams = { ...d, versions: { ...d.versions }, staking: { ...d.staking } };
  for (const row of rows) {
    if (row.sport === 'nbl') {
      out.nbl = mergeSportParams(d.nbl, row.params);
      out.versions.nbl = row.version;
    } else if (row.sport === 'tennis') {
      out.tennis = mergeSportParams(d.tennis, row.params);
      out.versions.tennis = row.version;
    }
  }
  return out;
}

/** Active params, or the defaults if they cannot be read. */
export async function loadActiveParams(errors?: string[]): Promise<AiPicksParams> {
  try {
    return paramsFromStates(await listActiveLearningStates());
  } catch (e) {
    errors?.push(`learning state: ${(e as Error).message}`);
    return DEFAULT_AI_PICKS_PARAMS;
  }
}
