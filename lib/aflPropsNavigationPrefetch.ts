import { fetchJsonDeduped } from '@/lib/clientFetchDedupe';
import { footywireNicknameToOfficial, rosterTeamToInjuryTeam } from '@/lib/aflTeamMapping';

/** Warm the immediately visible dashboard data on props → AFL navigation. */
export function prefetchAflDashboardFromProps(options: {
  playerName: string;
  team?: string;
  opponent?: string;
}): void {
  const { playerName, team = '', opponent = '' } = options;
  const currentSeason = new Date().getFullYear();
  const teamForApi = team
    ? rosterTeamToInjuryTeam(team) || footywireNicknameToOfficial(team) || team
    : '';
  const teamEnc = teamForApi ? `&team=${encodeURIComponent(teamForApi)}` : '';
  const logsBase = `/api/afl/player-game-logs?player_name=${encodeURIComponent(playerName)}${teamEnc}&include_both=1`;
  const urls = [
    `/api/afl/player-props?player=${encodeURIComponent(playerName)}&all=1${teamForApi ? `&team=${encodeURIComponent(teamForApi)}` : ''}${opponent ? `&opponent=${encodeURIComponent(opponent)}` : ''}`,
    // Match the complete current-season payload the dashboard renders.
    `${logsBase}&season=${currentSeason}`,
    `/api/afl/fantasy-positions?season=${currentSeason}&player=${encodeURIComponent(playerName)}`,
    `/api/afl/players?query=${encodeURIComponent(playerName)}&limit=30`,
  ];
  for (const url of urls) {
    void fetchJsonDeduped(url).catch(() => {});
  }
}
