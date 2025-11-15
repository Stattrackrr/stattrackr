// Bookmaker display names and logos
export const BOOKMAKER_INFO: Record<string, { name: string; logo: string; logoUrl?: string; color: string }> = {
  'draftkings': {
    name: 'DraftKings',
    logo: '🟢',
    logoUrl: 'https://logo.clearbit.com/draftkings.com',
    color: '#53D337',
  },
  'fanduel': {
    name: 'FanDuel',
    logo: '🔵',
    logoUrl: 'https://logo.clearbit.com/fanduel.com',
    color: '#0070EB',
  },
  'betmgm': {
    name: 'BetMGM',
    logo: '🟡',
    logoUrl: 'https://logo.clearbit.com/betmgm.com',
    color: '#C5A572',
  },
  'caesars': {
    name: 'Caesars',
    logo: '👑',
    logoUrl: 'https://logo.clearbit.com/caesars.com',
    color: '#002855',
  },
  'pointsbet': {
    name: 'PointsBet',
    logo: '🎯',
    logoUrl: 'https://logo.clearbit.com/pointsbet.com',
    color: '#EE3124',
  },
  'bet365': {
    name: 'Bet365',
    logo: '🎰',
    logoUrl: 'https://logo.clearbit.com/bet365.com',
    color: '#1C6E38',
  },
  'unibet': {
    name: 'Unibet',
    logo: '🍀',
    logoUrl: 'https://logo.clearbit.com/unibet.com',
    color: '#43B649',
  },
  'foxbet': {
    name: 'FOX Bet',
    logo: '🦊',
    logoUrl: 'https://logo.clearbit.com/foxbet.com',
    color: '#003F87',
  },
  'williamhill': {
    name: 'William Hill',
    logo: '⚡',
    logoUrl: 'https://logo.clearbit.com/williamhill.com',
    color: '#00A3DA',
  },
  'mybookieag': {
    name: 'MyBookie',
    logo: '📖',
    logoUrl: 'https://logo.clearbit.com/mybookie.ag',
    color: '#F26522',
  },
  'betonline.ag': {
    name: 'BetOnline.ag',
    logo: '🎲',
    logoUrl: 'https://logo.clearbit.com/betonline.ag',
    color: '#6B7280',
  },
  'fanatics': {
    name: 'Fanatics',
    logo: '🎲',
    logoUrl: 'https://logo.clearbit.com/fanatics.com',
    color: '#6B7280',
  },
  'betonline': {
    name: 'BetOnline.ag',
    logo: '🎲',
    logoUrl: 'https://logo.clearbit.com/betonline.ag',
    color: '#6B7280',
  },
  'betrivers': {
    name: 'BetRivers',
    logo: '🎲',
    logoUrl: 'https://logo.clearbit.com/betrivers.com',
    color: '#6B7280',
  },
  'bovada': {
    name: 'Bovada',
    logo: '🎲',
    logoUrl: 'https://logo.clearbit.com/bovada.lv',
    color: '#6B7280',
  },
};

export function getBookmakerInfo(key: string) {
  const normalizedKey = key.toLowerCase().trim();
  
  // Try exact match first
  if (BOOKMAKER_INFO[normalizedKey]) {
    return BOOKMAKER_INFO[normalizedKey];
  }
  
  // Try partial matches for common variations
  for (const [bookKey, bookInfo] of Object.entries(BOOKMAKER_INFO)) {
    if (normalizedKey.includes(bookKey) || bookKey.includes(normalizedKey)) {
      return bookInfo;
    }
    // Also check if the name matches
    if (bookInfo.name.toLowerCase().includes(normalizedKey) || 
        normalizedKey.includes(bookInfo.name.toLowerCase())) {
      return bookInfo;
    }
  }
  
  // Fallback
  return {
    name: key,
    logo: '🎲',
    color: '#6B7280',
  };
}
