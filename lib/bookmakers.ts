// Bookmaker display names and logos
export const BOOKMAKER_INFO: Record<string, { name: string; logo: string; color: string }> = {
  'draftkings': {
    name: 'DraftKings',
    logo: '🟢', // We'll use emojis for now, can replace with actual logos later
    color: '#53D337',
  },
  'fanduel': {
    name: 'FanDuel',
    logo: '🔵',
    color: '#0070EB',
  },
  'betmgm': {
    name: 'BetMGM',
    logo: '🟡',
    color: '#C5A572',
  },
  'caesars': {
    name: 'Caesars',
    logo: '👑',
    color: '#002855',
  },
  'pointsbet': {
    name: 'PointsBet',
    logo: '🎯',
    color: '#EE3124',
  },
  'bet365': {
    name: 'Bet365',
    logo: '🎰',
    color: '#1C6E38',
  },
  'unibet': {
    name: 'Unibet',
    logo: '🍀',
    color: '#43B649',
  },
  'foxbet': {
    name: 'FOX Bet',
    logo: '🦊',
    color: '#003F87',
  },
  'williamhill': {
    name: 'William Hill',
    logo: '⚡',
    color: '#00A3DA',
  },
  'mybookieag': {
    name: 'MyBookie',
    logo: '📖',
    color: '#F26522',
  },
};

export function getBookmakerInfo(key: string) {
  return BOOKMAKER_INFO[key.toLowerCase()] || {
    name: key,
    logo: '🎲',
    color: '#6B7280',
  };
}
