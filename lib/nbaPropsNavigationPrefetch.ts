import { writeNbaNextGamePrefetch } from '@/lib/nba/dash/nextGamePrefetch';
import { NBA_CHART_HISTORY_YEARS, NBA_CURRENT_SEASON_YEAR, resolveNbaClubName } from '@/lib/nba/dash/teams';

/** Warm NBA dashboard data on props → dashboard navigation. Does not block routing. */
export function prefetchNbaDashboardFromProps(options: {
  playerName: string;
  playerId?: string | null;
  team?: string | null;
  opponent?: string | null;
}): void {
  const playerName = String(options.playerName || '').trim();
  const team = resolveNbaClubName(options.team) || '';
  const opponent = resolveNbaClubName(options.opponent) || '';
  const playerId = String(options.playerId || '').trim();
  if (!playerName && !team) return;

  if (team) {
    void fetch(`/api/nba/dash/next-game?team=${encodeURIComponent(team)}&year=${NBA_CURRENT_SEASON_YEAR}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        writeNbaNextGamePrefetch({
          team,
          next_opponent: data?.next_opponent ? String(data.next_opponent) : opponent || null,
          next_game_tipoff: data?.next_game_tipoff ? String(data.next_game_tipoff) : null,
          next_game_id: data?.next_game_id ? String(data.next_game_id) : null,
          opponent_logo: data?.opponent_logo ? String(data.opponent_logo) : null,
        });
      })
      .catch(() => {});
  }

  const urls: string[] = [
    `/api/nba/dash/players?year=${NBA_CURRENT_SEASON_YEAR}&currentOnly=1`,
    `/api/nba/dash/team-logos?year=${NBA_CURRENT_SEASON_YEAR}`,
  ];
  if (playerName && team && opponent) {
    urls.push(
      `/api/nba/dash/player-props?player=${encodeURIComponent(playerName)}&stat=points&team=${encodeURIComponent(team)}&opponent=${encodeURIComponent(opponent)}`
    );
  }
  if (/^\d+$/.test(playerId)) {
    urls.push(
      `/api/nba/dash/player-game-logs?playerId=${encodeURIComponent(playerId)}&years=${NBA_CHART_HISTORY_YEARS.join(',')}`
    );
  }
  for (const url of urls) {
    void fetch(url, { cache: 'default' }).catch(() => {});
  }
}
