// NBA team logo URLs
export function getTeamLogoUrl(teamAbbr: string): string | null {
  const normalized = teamAbbr.toUpperCase();
  
  const logoMap: { [key: string]: string } = {
    'ATL': '/logos/nba/atlanta-hawks.png',
    'BOS': '/logos/nba/boston-celtics.png',
    'BKN': '/logos/nba/brooklyn-nets.png',
    'CHA': '/logos/nba/charlotte-hornets.png',
    'CHI': '/logos/nba/chicago-bulls.png',
    'CLE': '/logos/nba/cleveland-cavaliers.png',
    'DAL': '/logos/nba/dallas-mavericks.png',
    'DEN': '/logos/nba/denver-nuggets.png',
    'DET': '/logos/nba/detroit-pistons.png',
    'GSW': '/logos/nba/golden-state-warriors.png',
    'HOU': '/logos/nba/houston-rockets.png',
    'IND': '/logos/nba/indiana-pacers.png',
    'LAC': '/logos/nba/la-clippers.png',
    'LAL': '/logos/nba/los-angeles-lakes.png',
    'MEM': '/logos/nba/memphis-grizzlies.png',
    'MIA': '/logos/nba/miami-heat.png',
    'MIL': '/logos/nba/milwaukee-bucks.png',
    'MIN': '/logos/nba/minnesota-timberwolves.png',
    'NOP': '/logos/nba/new-orleans-pelicans.png',
    'NYK': '/logos/nba/new-york-knicks.png',
    'OKC': '/logos/nba/oklahoma-city-thunder.png',
    'ORL': '/logos/nba/orlando-magic.png',
    'PHI': '/logos/nba/philadelphia-76ers.png',
    'PHX': '/logos/nba/phoenix-suns.png',
    'POR': '/logos/nba/portland-trail-blazers.png',
    'SAC': '/logos/nba/sacramento-kings.png',
    'SAS': '/logos/nba/san-antonio-spurs.png',
    'TOR': '/logos/nba/toronto-raptors.png',
    'UTA': '/logos/nba/utah-jazz.png',
    'WAS': '/logos/nba/washington-wizards.png'
  };

  return logoMap[normalized] || null;
}

export function getPlayerHeadshotUrl(playerId: string): string {
  return `https://cdn.nba.com/headshots/nba/latest/1040x760/${playerId}.png`;
}