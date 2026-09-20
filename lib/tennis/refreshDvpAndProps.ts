import { upsertCombinedSnapshotTennisFromList } from '@/lib/combinedPropsSnapshotPaint';
import { buildTennisDvpLiveStore } from '@/lib/tennis/dvpLiveCache';
import { listLiveTennisEventIndex } from '@/lib/tennis/nextGame';
import { bakeCachedTennisDvp, getTennisPlayerPropsList } from '@/lib/tennis/playerPropsList';

export async function rebuildTennisDvpStore() {
  const live = await listLiveTennisEventIndex();
  return buildTennisDvpLiveStore(live);
}

export function tennisDvpStoreSummary(store: Awaited<ReturnType<typeof buildTennisDvpLiveStore>>) {
  return {
    builtAt: store.builtAt,
    events: store.events.length,
    fieldSizes: store.events.map((event) => ({
      tour: event.tour,
      stage: event.stage,
      tournament: event.tournamentName,
      fieldSize: event.fieldSize,
    })),
  };
}

/** Rebuild DVP boards, then bake ranks onto the tennis list + combined snapshot. */
export async function rebuildTennisDvpAndBakeProps() {
  const store = await rebuildTennisDvpStore();
  const tennis = await getTennisPlayerPropsList({ refresh: true });
  const tennisCombined = await upsertCombinedSnapshotTennisFromList(tennis);
  const baked = await bakeCachedTennisDvp();
  const fromList = tennis.data.filter(
    (row) => typeof row.dvpRating === 'number' && Number.isFinite(row.dvpRating) && row.dvpRating > 0
  ).length;
  return {
    ...tennisDvpStoreSummary(store),
    tennisList: tennis.data.length,
    tennisCombined,
    propsCount: baked.props || tennis.data.length,
    propsWithDvp: Math.max(fromList, baked.withDvp),
  };
}
