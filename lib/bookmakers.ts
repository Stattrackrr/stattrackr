// Bookmaker display names and logos
// Using Google's favicon service as it's more reliable than Clearbit in production
const getLogoUrl = (domain: string): string => {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
};

export const BOOKMAKER_INFO: Record<string, { name: string; logo: string; logoUrl?: string; color: string }> = {
  'draftkings': {
    name: 'DraftKings',
    logo: 'DK',
    logoUrl: getLogoUrl('draftkings.com'),
    color: '#53D337',
  },
  'fanduel': {
    name: 'FanDuel',
    logo: 'FD',
    logoUrl: getLogoUrl('fanduel.com'),
    color: '#0070EB',
  },
  'betmgm': {
    name: 'BetMGM',
    logo: 'MGM',
    logoUrl: getLogoUrl('betmgm.com'),
    color: '#C5A572',
  },
  'caesars': {
    name: 'Caesars',
    logo: 'CZR',
    logoUrl: getLogoUrl('caesars.com'),
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
    logoUrl: getLogoUrl('betrivers.com'),
    color: '#0054A6',
  },
  'betus': {
    name: 'BetUS',
    logo: 'BU',
    logoUrl: getLogoUrl('betus.com'),
    color: '#1E4E8C',
  },
  'bovada': {
    name: 'Bovada',
    logo: 'BV',
    logoUrl: getLogoUrl('bovada.lv'),
    color: '#C8102E',
  },
  'fanatics': {
    name: 'Fanatics',
    logo: 'FN',
    logoUrl: getLogoUrl('fanatics.com'),
    color: '#011E41',
  },
  'fanatics sportsbook': {
    name: 'Fanatics',
    logo: 'FN',
    logoUrl: getLogoUrl('fanatics.com'),
    color: '#011E41',
  },
  'fanatics betting and gaming': {
    name: 'Fanatics',
    logo: 'FN',
    logoUrl: getLogoUrl('fanatics.com'),
    color: '#011E41',
  },
  'lowvig': {
    name: 'LowVig.ag',
    logo: 'LV',
    logoUrl: getLogoUrl('lowvig.ag'),
    color: '#0E7F7F',
  },
  'lowvig.ag': {
    name: 'LowVig.ag',
    logo: 'LV',
    logoUrl: getLogoUrl('lowvig.ag'),
    color: '#0E7F7F',
  },
  'mybookieag': {
    name: 'MyBookie.ag',
    logo: 'MB',
    logoUrl: getLogoUrl('mybookie.ag'),
    color: '#F26522',
  },
  'mybookie.ag': {
    name: 'MyBookie.ag',
    logo: 'MB',
    logoUrl: getLogoUrl('mybookie.ag'),
    color: '#F26522',
  },
  'betrivers sportsbook': {
    name: 'BetRivers',
    logo: 'BR',
    logoUrl: getLogoUrl('betrivers.com'),
    color: '#0054A6',
  },
  'pointsbet': {
    name: 'PointsBet',
    logo: 'PB',
    logoUrl: getLogoUrl('pointsbet.com'),
    color: '#EE3124',
  },
  'bet365': {
    name: 'Bet365',
    logo: '365',
    logoUrl: getLogoUrl('bet365.com'),
    color: '#1C6E38',
  },
  'unibet': {
    name: 'Unibet',
    logo: 'UB',
    logoUrl: getLogoUrl('unibet.com'),
    color: '#43B649',
  },
  'foxbet': {
    name: 'FOX Bet',
    logo: 'FB',
    logoUrl: getLogoUrl('foxbet.com'),
    color: '#003F87',
  },
  'williamhill': {
    name: 'William Hill',
    logo: 'WH',
    logoUrl: getLogoUrl('williamhill.com'),
    color: '#00A3DA',
  },
  'pick6': {
    name: 'DraftKings Pick6',
    logo: 'P6',
    logoUrl: getLogoUrl('draftkings.com'),
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
  'betway': {
    name: 'Betway',
    logo: 'BW',
    logoUrl: getLogoUrl('betway.com'),
    color: '#FFCC00',
  },
  'ballybet': {
    name: 'Bally Bet',
    logo: 'BB',
    logoUrl: getLogoUrl('ballybet.com'),
    color: '#E31E24',
  },
  'betparx': {
    name: 'BetPARX',
    logo: 'BP',
    logoUrl: getLogoUrl('betparx.com'),
    color: '#00A651',
  },
  'rebet': {
    name: 'ReBet',
    logo: 'RB',
    logoUrl: getLogoUrl('rebet.com'),
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
