/**
 * Rebuilds the NBA props-page list and the combined props slice from the stored board. Run after any
 * board write between full odds refreshes (near-tip pulls, the AI's pre-post price check), so the props
 * page shows the same prices as the board instead of waiting for the next 10-minute refresh.
 */

import { upsertCombinedSnapshotNbaFromList } from '@/lib/combinedPropsSnapshotPaint';
import { getNbaPlayerPropsList } from './playerPropsList';

export async function rebakeNbaPropsPage(): Promise<{ rows: number; combined: number }> {
  const list = await getNbaPlayerPropsList({ refresh: true });
  const combined = await upsertCombinedSnapshotNbaFromList(list);
  return { rows: list.data.length, combined };
}
