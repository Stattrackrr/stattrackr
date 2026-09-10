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
    logoUrl: '/images/caesars.jpg',
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
    logoUrl: '/images/pointsbet.png',
    color: '#EE3124',
  },
  'pointsbet (au)': {
    name: 'PointsBet',
    logo: 'PB',
    logoUrl: '/images/pointsbet.png',
    color: '#EE3124',
  },
  'bet365': {
    name: 'Bet365',
    logo: '365',
    logoUrl: getLogoUrl('bet365.com'),
    color: '#1C6E38',
  },
  'bet 365': {
    name: 'Bet365',
    logo: '365',
    logoUrl: getLogoUrl('bet365.com'),
    color: '#1C6E38',
  },
  'bet 385': {
    name: 'Bet365',
    logo: '365',
    logoUrl: getLogoUrl('bet365.com'),
    color: '#1C6E38',
  },
  'bet365.nl': {
    name: 'Bet365',
    logo: '365',
    logoUrl: getLogoUrl('bet365.com'),
    color: '#1C6E38',
  },
  'bet365 au': {
    name: 'Bet365',
    logo: '365',
    logoUrl: getLogoUrl('bet365.com'),
    color: '#1C6E38',
  },
  'unibet': {
    name: 'Unibet',
    logo: 'UB',
    logoUrl: '/images/unibet.jpg',
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
    logoUrl: '/images/rebet.png',
    color: '#6B7280',
  },
  // AFL / AU bookmakers (The Odds API region=au)
  'neds': {
    name: 'Neds',
    logo: 'Neds',
    logoUrl: getLogoUrl('neds.com.au'),
    color: '#E31837',
  },
  'ladbrokes': {
    name: 'Ladbrokes',
    logo: 'Lad',
    logoUrl: getLogoUrl('ladbrokes.com.au'),
    color: '#006B3F',
  },
  'sportsbet': {
    name: 'Sportsbet',
    logo: 'SB',
    logoUrl: getLogoUrl('sportsbet.com.au'),
    color: '#FFD700',
  },
  'tab': {
    name: 'TAB',
    logo: 'TAB',
    logoUrl: getLogoUrl('tab.com.au'),
    color: '#00843D',
  },
  'betr': {
    name: 'Betr',
    logo: 'BETR',
    logoUrl: '/images/betr.png',
    color: '#6B7280',
  },
  'betright': {
    name: 'Bet Right',
    logo: 'BR',
    logoUrl: '/images/betright.jpg',
    color: '#6B7280',
  },
  'bet right': {
    name: 'Bet Right',
    logo: 'BR',
    logoUrl: '/images/betright.jpg',
    color: '#6B7280',
  },
  'betfair': {
    name: 'Betfair',
    logo: 'BF',
    logoUrl: '/images/betfair.png',
    color: '#FFB81C',
  },
  'dabble': {
    name: 'Dabble',
    logo: 'DB',
    logoUrl: '/images/dabble.jfif',
    color: '#7C3AED',
  },
  // The Odds API uses title "Dabble AU" (see aflPlayerPropsCache book.title || book.key)
  'dabble au': {
    name: 'Dabble',
    logo: 'DB',
    logoUrl: '/images/dabble.jfif',
    color: '#7C3AED',
  },
  'unibet_au': {
    name: 'Unibet',
    logo: 'UB',
    logoUrl: '/images/unibet.jpg',
    color: '#43B649',
  },
  'unibet au': {
    name: 'Unibet',
    logo: 'UB',
    logoUrl: '/images/unibet.jpg',
    color: '#43B649',
  },
  '1xbet': {
    name: '1xBet',
    logo: '1X',
    logoUrl: getLogoUrl('1xbet.com'),
    color: '#1A73E8',
  },
  'onexbet': {
    name: '1xBet',
    logo: '1X',
    logoUrl: getLogoUrl('1xbet.com'),
    color: '#1A73E8',
  },
  'pointsbetau': {
    name: 'PointsBet',
    logo: 'PB',
    logoUrl: '/images/pointsbet.png',
    color: '#EE3124',
  },
  'betr_au': {
    name: 'Betr',
    logo: 'BETR',
    logoUrl: '/images/betr.png',
    color: '#6B7280',
  },
  'leovegas': {
    name: 'LeoVegas',
    logo: 'LV',
    logoUrl: getLogoUrl('leovegas.com'),
    color: '#FF0046',
  },
  'casumo': {
    name: 'Casumo',
    logo: 'CA',
    logoUrl: getLogoUrl('casumo.com'),
    color: '#6B21A8',
  },
  'hardrockbet': {
    name: 'Hard Rock Bet',
    logo: 'HR',
    logoUrl: getLogoUrl('hardrock.bet'),
    color: '#C8102E',
  },
  'espnbet': {
    name: 'theScore Bet',
    logo: 'TS',
    logoUrl: getLogoUrl('espnbet.com'),
    color: '#000000',
  },
  'betano': {
    name: 'Betano',
    logo: 'BN',
    logoUrl: getLogoUrl('betano.com'),
    color: '#00A651',
  },
  'superbet': {
    name: 'Superbet',
    logo: 'SB',
    logoUrl: getLogoUrl('superbet.com'),
    color: '#E30613',
  },
  'marathon': {
    name: 'Marathon',
    logo: 'MB',
    logoUrl: getLogoUrl('marathonbet.com'),
    color: '#0B1F3A',
  },
  'pncl': {
    name: 'Pinnacle',
    logo: 'PN',
    logoUrl: getLogoUrl('pinnacle.com'),
    color: '#1D1D1B',
  },
  'pinnacle': {
    name: 'Pinnacle',
    logo: 'PN',
    logoUrl: getLogoUrl('pinnacle.com'),
    color: '#1D1D1B',
  },
  '888sport': {
    name: '888Sport',
    logo: '888',
    logoUrl: getLogoUrl('888sport.com'),
    color: '#FF6600',
  },
  'betvictor': {
    name: 'BetVictor',
    logo: 'BV',
    logoUrl: getLogoUrl('betvictor.com'),
    color: '#D4AF37',
  },
  'sbo': {
    name: 'SBOBET',
    logo: 'SBO',
    logoUrl: getLogoUrl('sbobet.com'),
    color: '#C8102E',
  },
};

export type BookmakerRegion = 'us' | 'au' | 'uk' | 'other';

const US_BOOK_KEYS = new Set([
  'betonlineag',
  'betonline.ag',
  'betonline',
  'betmgm',
  'betrivers',
  'betrivers sportsbook',
  'betus',
  'bovada',
  'williamhill_us',
  'caesars',
  'draftkings',
  'fanatics',
  'fanatics sportsbook',
  'fanatics betting and gaming',
  'fanduel',
  'lowvig',
  'lowvig.ag',
  'mybookieag',
  'mybookie.ag',
  'ballybet',
  'betanysports',
  'betparx',
  'espnbet',
  'fliff',
  'hardrockbet',
  'hardrockbet_az',
  'hardrockbet_fl',
  'hardrockbet_oh',
  'rebet',
  'foxbet',
  'pick6',
  'prizepicks',
  'underdog',
  'underdog fantasy',
  'dabble_us_dfs',
  'pointsbetus',
]);

const AU_BOOK_KEYS = new Set([
  'betfair_ex_au',
  'betr_au',
  'betr',
  'betright',
  'bet right',
  'bet365_au',
  'bet365 au',
  'dabble_au',
  'dabble au',
  'dabble',
  'ladbrokes_au',
  'ladbrokes',
  'neds',
  'playup',
  'pointsbetau',
  'pointsbet (au)',
  'sportsbet',
  'tab',
  'tabtouch',
  'unibet',
  'unibet_au',
  'unibet au',
]);

const UK_BOOK_KEYS = new Set([
  'sport888',
  '888sport',
  'betano_uk',
  'betfair_ex_uk',
  'betfair_sb_uk',
  'betfred_uk',
  'betvictor',
  'betway',
  'boylesports',
  'casumo',
  'coral',
  'grosvenor',
  'ladbrokes_uk',
  'leovegas',
  'livescorebet',
  'matchbook',
  'paddypower',
  'skybet',
  'smarkets',
  'unibet_uk',
  'virginbet',
  'williamhill',
]);

function normalizeBookKey(key: string): string {
  return key.toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function compactBookKey(key: string): string {
  return key.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

/** Odds API / display-name region. `unibet` without a suffix is AU on The Odds API. */
export function getBookmakerRegion(key: string): BookmakerRegion {
  const raw = key.toLowerCase().trim();
  const spaced = normalizeBookKey(key);
  const compact = compactBookKey(key);

  if (US_BOOK_KEYS.has(raw) || US_BOOK_KEYS.has(spaced) || US_BOOK_KEYS.has(compact)) return 'us';
  if (AU_BOOK_KEYS.has(raw) || AU_BOOK_KEYS.has(spaced) || AU_BOOK_KEYS.has(compact)) return 'au';
  if (UK_BOOK_KEYS.has(raw) || UK_BOOK_KEYS.has(spaced) || UK_BOOK_KEYS.has(compact)) return 'uk';

  if (/(?:^|[\s_(])au(?:$|[\s)]|_)/.test(raw) || compact.endsWith('au')) return 'au';
  if (/(?:^|[\s_(])uk(?:$|[\s)]|_)/.test(raw) || compact.endsWith('uk')) return 'uk';
  if (/(?:^|[\s_(])us(?:$|[\s)]|_)/.test(raw) || compact.endsWith('us')) return 'us';

  if (
    compact.includes('sportsbet') ||
    compact.includes('pointsbet') ||
    compact === 'neds' ||
    compact.includes('ladbrokes') ||
    compact === 'tab' ||
    compact.includes('tabtouch') ||
    compact.includes('playup')
  ) {
    return 'au';
  }
  if (
    compact.includes('draftkings') ||
    compact.includes('fanduel') ||
    compact.includes('betmgm') ||
    compact.includes('caesars') ||
    compact.includes('bovada') ||
    compact.includes('fanatics') ||
    compact.includes('hardrock')
  ) {
    return 'us';
  }

  return 'other';
}

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
