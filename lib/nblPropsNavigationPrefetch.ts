import { writeNblNextGamePrefetch } from '@/lib/nbl/nblNextGamePrefetch';
import { NBL_CHART_HISTORY_YEARS, NBL_CURRENT_SEASON_YEAR } from '@/lib/nblTeamCanonical';

/** Warm NBL dashboard data on props → dashboard navigation. Does not block routing. */
export function prefetchNblDashboardFromProps(options: {
  playerName: string;
  playerId?: string | null;
  team?: string | null;
  opponent?: string | null;
}): void {
  const playerName = String(options.playerName || '').trim();
  const team = String(options.team || '').trim();
  const opponent = String(options.opponent || '').trim();
  const playerId = String(options.playerId || '').trim();
  if (!playerName && !team) return;

  if (team) {
    void fetch(
      `/api/nbl/next-game?team=${encodeURIComponent(team)}&year=${NBL_CURRENT_SEASON_YEAR}`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        writeNblNextGamePrefetch({
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
    `/api/nbl/players?year=${NBL_CURRENT_SEASON_YEAR}&currentOnly=1`,
    `/api/nbl/team-logos?year=${NBL_CURRENT_SEASON_YEAR}`,
  ];
  if (playerName && team && opponent) {
    urls.push(
      `/api/nbl/player-props?player=${encodeURIComponent(playerName)}&stat=points&team=${encodeURIComponent(team)}&opponent=${encodeURIComponent(opponent)}`
    );
  }
  if (playerId) {
    urls.push(
      `/api/nbl/player-game-logs?playerId=${encodeURIComponent(playerId)}&years=${NBL_CHART_HISTORY_YEARS.join(',')}`
    );
  }
  for (const url of urls) {
    void fetch(url, { cache: 'default' }).catch(() => {});
  }
}
