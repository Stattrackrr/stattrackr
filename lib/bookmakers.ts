// Bookmaker display names and logos
export const BOOKMAKER_INFO: Record<string, { name: string; logo: string; logoUrl?: string; color: string }> = {
  'draftkings': {
    name: 'DraftKings',
    logo: 'DK',
    logoUrl: 'https://logo.clearbit.com/draftkings.com',
    color: '#53D337',
  },
  'fanduel': {
    name: 'FanDuel',
    logo: 'FD',
    logoUrl: 'https://logo.clearbit.com/fanduel.com',
    color: '#0070EB',
  },
  'betmgm': {
    name: 'BetMGM',
    logo: 'MGM',
    logoUrl: 'https://logo.clearbit.com/betmgm.com',
    color: '#C5A572',
  },
  'caesars': {
    name: 'Caesars',
    logo: 'CZR',
    logoUrl: 'https://logo.clearbit.com/caesars.com',
    color: '#002855',
  },
  'betonlineag': {
    name: 'BetOnline.ag',
    logo: 'BO',
    logoUrl: '/images/betonline.webp',
    color: '#6B7280',
  },
  'betonline.ag': {
    name: 'BetOnline.ag',
    logo: 'BO',
    logoUrl: '/images/betonline.webp',
    color: '#6B7280',
  },
  'betonline': {
    name: 'BetOnline.ag',
    logo: 'BO',
    logoUrl: '/images/betonline.webp',
    color: '#6B7280',
  },
  'betrivers': {
    name: 'BetRivers',
    logo: 'BR',
    logoUrl: 'https://logo.clearbit.com/betrivers.com',
    color: '#0054A6',
  },
  'betus': {
    name: 'BetUS',
    logo: 'BU',
    logoUrl: 'https://logo.clearbit.com/betus.com',
    color: '#1E4E8C',
  },
  'bovada': {
    name: 'Bovada',
    logo: 'BV',
    logoUrl: 'https://logo.clearbit.com/bovada.lv',
    color: '#C8102E',
  },
  'fanatics': {
    name: 'Fanatics',
    logo: 'FN',
    logoUrl: 'https://logo.clearbit.com/fanatics.com',
    color: '#011E41',
  },
  'fanatics sportsbook': {
    name: 'Fanatics',
    logo: 'FN',
    logoUrl: 'https://logo.clearbit.com/fanatics.com',
    color: '#011E41',
  },
  'fanatics betting and gaming': {
    name: 'Fanatics',
    logo: 'FN',
    logoUrl: 'https://logo.clearbit.com/fanatics.com',
    color: '#011E41',
  },
  'lowvig': {
    name: 'LowVig.ag',
    logo: 'LV',
    logoUrl: 'https://logo.clearbit.com/lowvig.ag',
    color: '#0E7F7F',
  },
  'lowvig.ag': {
    name: 'LowVig.ag',
    logo: 'LV',
    logoUrl: 'https://logo.clearbit.com/lowvig.ag',
    color: '#0E7F7F',
  },
  'mybookieag': {
    name: 'MyBookie.ag',
    logo: 'MB',
    logoUrl: 'https://logo.clearbit.com/mybookie.ag',
    color: '#F26522',
  },
  'mybookie.ag': {
    name: 'MyBookie.ag',
    logo: 'MB',
    logoUrl: 'https://logo.clearbit.com/mybookie.ag',
    color: '#F26522',
  },
  'betrivers sportsbook': {
    name: 'BetRivers',
    logo: 'BR',
    logoUrl: 'https://logo.clearbit.com/betrivers.com',
    color: '#0054A6',
  },
  'pointsbet': {
    name: 'PointsBet',
    logo: 'PB',
    logoUrl: 'https://logo.clearbit.com/pointsbet.com',
    color: '#EE3124',
  },
  'bet365': {
    name: 'Bet365',
    logo: '365',
    logoUrl: 'https://logo.clearbit.com/bet365.com',
    color: '#1C6E38',
  },
  'unibet': {
    name: 'Unibet',
    logo: 'UB',
    logoUrl: 'https://logo.clearbit.com/unibet.com',
    color: '#43B649',
  },
  'foxbet': {
    name: 'FOX Bet',
    logo: 'FB',
    logoUrl: 'https://logo.clearbit.com/foxbet.com',
    color: '#003F87',
  },
  'williamhill': {
    name: 'William Hill',
    logo: 'WH',
    logoUrl: 'https://logo.clearbit.com/williamhill.com',
    color: '#00A3DA',
  },
  'pick6': {
    name: 'DraftKings Pick6',
    logo: 'P6',
    logoUrl: 'https://logo.clearbit.com/draftkings.com',
    color: '#53D337',
  },
  'prizepicks': {
    name: 'PrizePicks',
    logo: 'PP',
    logoUrl: '/images/prizepicks.avif',
    color: '#00C2FF',
  },
  'underdog': {
    name: 'Underdog Fantasy',
    logo: 'UD',
    logoUrl: '/images/underdog.avif',
    color: '#F5C000',
  },
  'underdog fantasy': {
    name: 'Underdog Fantasy',
    logo: 'UD',
    logoUrl: '/images/underdog.avif',
    color: '#F5C000',
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
