import { beginTennisDashboardSession, tennisDashboardFetch } from '@/lib/tennisDashboardFetch';

/** Warm the tennis dashboard endpoints used immediately after a props-row click. */
export function prefetchTennisDashboardFromProps(options: {
  playerName: string;
  playerId?: string | null;
  tour?: string | null;
  opponent?: string | null;
  opponentId?: string | null;
}): void {
  const playerName = String(options.playerName || '').trim();
  if (!playerName) return;
  beginTennisDashboardSession();
  const playerId = String(options.playerId || '').trim();
  const tour = String(options.tour || '').trim();
  const opponent = String(options.opponent || '').trim();
  const opponentId = String(options.opponentId || '').trim();
  const idQ = playerId ? `&playerId=${encodeURIComponent(playerId)}` : '';
  const tourQ = tour ? `&tour=${encodeURIComponent(tour)}` : '';
  const oppQ = opponent ? `&opponent=${encodeURIComponent(opponent)}` : '';
  // Mirror dashboard matches query so prefetch + page join the same in-flight response.
  const matchQs = new URLSearchParams();
  if (playerId) matchQs.set('playerId', playerId);
  matchQs.set('player', playerName);
  if (tour) matchQs.set('tour', tour);
  if (opponentId) matchQs.set('opponentId', opponentId);
  if (opponent) matchQs.set('opponent', opponent);
  const urls = [
    `/api/tennis/players?q=${encodeURIComponent(playerName)}&currentOnly=1`,
    `/api/tennis/next-game?player=${encodeURIComponent(playerName)}${idQ}${tourQ}${oppQ}`,
    `/api/tennis/odds?player=${encodeURIComponent(playerName)}${idQ}`,
    `/api/tennis/matches?${matchQs.toString()}`,
  ];
  for (const url of urls) {
    void tennisDashboardFetch(url).catch(() => {});
  }
}
