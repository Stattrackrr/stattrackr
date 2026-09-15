import { fetchJsonDeduped } from '@/lib/clientFetchDedupe';

/** Warm the tennis dashboard endpoints used immediately after a props-row click. */
export function prefetchTennisDashboardFromProps(options: {
  playerName: string;
  playerId?: string | null;
  tour?: string | null;
}): void {
  const playerName = String(options.playerName || '').trim();
  if (!playerName) return;
  const playerId = String(options.playerId || '').trim();
  const tour = String(options.tour || '').trim();
  const idQ = playerId ? `&playerId=${encodeURIComponent(playerId)}` : '';
  const tourQ = tour ? `&tour=${encodeURIComponent(tour)}` : '';
  const urls = [
    `/api/tennis/players?q=${encodeURIComponent(playerName)}&currentOnly=1`,
    `/api/tennis/next-game?player=${encodeURIComponent(playerName)}${idQ}${tourQ}`,
    `/api/tennis/odds?player=${encodeURIComponent(playerName)}${idQ}`,
  ];
  for (const url of urls) {
    void fetchJsonDeduped(url).catch(() => {});
  }
}
