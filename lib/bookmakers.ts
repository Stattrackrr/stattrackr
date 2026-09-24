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
    logoUrl: '/images/bookmakers/betvictor.png?v=20260921c',
    color: '#00C2F3',
  },
  'sbo': {
    name: 'SBOBET',
    logo: 'SBO',
    logoUrl: getLogoUrl('sbobet.com'),
    color: '#C8102E',
  },
  'williamhill_us': {
    name: 'Caesars',
    logo: 'CZR',
    logoUrl: '/images/caesars.jpg',
    color: '#002855',
  },
  'fliff': {
    name: 'Fliff',
    logo: 'FL',
    logoUrl: getLogoUrl('getfliff.com'),
    color: '#6D28D9',
  },
  'playup': {
    name: 'PlayUp',
    logo: 'PU',
    logoUrl: getLogoUrl('playup.com.au'),
    color: '#E11D48',
  },
  'tabtouch': {
    name: 'TABtouch',
    logo: 'TT',
    logoUrl: getLogoUrl('tabtouch.mobi'),
    color: '#00843D',
  },
  'picklebet': {
    name: 'Picklebet',
    logo: 'PK',
    logoUrl: getLogoUrl('picklebet.com'),
    color: '#16A34A',
  },
  'palmerbet': {
    name: 'Palmerbet',
    logo: 'PB',
    logoUrl: getLogoUrl('palmerbet.com'),
    color: '#1D4ED8',
  },
  'betgoodwin': {
    name: 'BetGoodwin',
    logo: 'BG',
    logoUrl: getLogoUrl('betgoodwin.com.au'),
    color: '#0F766E',
  },
  'cloudbet': {
    name: 'Cloudbet',
    logo: 'CB',
    logoUrl: getLogoUrl('cloudbet.com'),
    color: '#2563EB',
  },
  'virginbet': {
    name: 'Virgin Bet',
    logo: 'VB',
    logoUrl: getLogoUrl('virginbet.com'),
    color: '#E11D48',
  },
  'grosvenor': {
    name: 'Grosvenor',
    logo: 'GR',
    logoUrl: getLogoUrl('grosvenorcasinos.com'),
    color: '#0F172A',
  },
  'coral': {
    name: 'Coral',
    logo: 'CR',
    logoUrl: getLogoUrl('coral.co.uk'),
    color: '#0B3D0B',
  },
  'paddypower': {
    name: 'Paddy Power',
    logo: 'PP',
    logoUrl: getLogoUrl('paddypower.com'),
    color: '#00A651',
  },
  'skybet': {
    name: 'Sky Bet',
    logo: 'SB',
    logoUrl: getLogoUrl('skybet.com'),
    color: '#DC052D',
  },
  'matchbook': {
    name: 'Matchbook',
    logo: 'MB',
    logoUrl: getLogoUrl('matchbook.com'),
    color: '#111827',
  },
  'smarkets': {
    name: 'Smarkets',
    logo: 'SM',
    logoUrl: getLogoUrl('smarkets.com'),
    color: '#2563EB',
  },
  'betfred_uk': {
    name: 'Betfred',
    logo: 'BF',
    logoUrl: getLogoUrl('betfred.com'),
    color: '#0066B3',
  },
  'boylesports': {
    name: 'BoyleSports',
    logo: 'BS',
    logoUrl: getLogoUrl('boylesports.com'),
    color: '#0072CE',
  },
  'livescorebet': {
    name: 'LiveScore Bet',
    logo: 'LS',
    logoUrl: getLogoUrl('livescorebet.com'),
    color: '#E30613',
  },
  'betsson': {
    name: 'Betsson',
    logo: 'BS',
    logoUrl: getLogoUrl('betsson.com'),
    color: '#F97316',
  },
  'nordicbet': {
    name: 'NordicBet',
    logo: 'NB',
    logoUrl: getLogoUrl('nordicbet.com'),
    color: '#0EA5E9',
  },
  '10bet': {
    name: '10Bet',
    logo: '10',
    logoUrl: getLogoUrl('10bet.com'),
    color: '#111827',
  },
  '188bet': {
    name: '188Bet',
    logo: '188',
    logoUrl: getLogoUrl('188bet.com'),
    color: '#C8102E',
  },
  'dafabet': {
    name: 'Dafabet',
    logo: 'DF',
    logoUrl: getLogoUrl('dafabet.com'),
    color: '#D4A017',
  },
  'bwin': {
    name: 'bwin',
    logo: 'BW',
    logoUrl: getLogoUrl('bwin.com'),
    color: '#FFB800',
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
  'picklebet',
  'palmerbet',
  'betgoodwin',
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

/** Local brand marks in /public/images/bookmakers. Alias keys collapse onto a file slug. */
const LOCAL_BOOKMAKER_LOGO_SLUGS: Record<string, string> = {
  betr: 'betr',
  betrau: 'betr',
  bet365: 'bet365',
  bet365au: 'bet365',
  bet365nl: 'bet365',
  betfair: 'betfair',
  betmgm: 'betmgm',
  betvictor: 'betvictor',
  bv: 'betvictor',
  caesars: 'caesars',
  dabble: 'dabble',
  dabbleau: 'dabble',
  draftkings: 'draftkings',
  fanatics: 'fanatics',
  fanaticssportsbook: 'fanatics',
  fanaticsbettingandgaming: 'fanatics',
  fanduel: 'fanduel',
  ladbrokes: 'ladbrokes',
  neds: 'neds',
  pointsbet: 'pointsbet',
  pointsbetau: 'pointsbet',
  sportsbet: 'sportsbet',
  tab: 'tab',
  unibet: 'unibet',
  unibetau: 'unibet',
  williamhillus: 'caesars',
};

function localBookmakerLogoUrl(key: string): string | null {
  const compact = compactBookKey(key);
  const stripped = compact.replace(/(au|uk|us|eu|nl|fr|se|it|de|ca|ag)$/g, '');
  const slug = LOCAL_BOOKMAKER_LOGO_SLUGS[compact] || LOCAL_BOOKMAKER_LOGO_SLUGS[stripped] || null;
  return slug ? `/images/bookmakers/${slug}.png?v=20260921c` : null;
}

/** Official site used for favicon fallback when a local asset is missing. */
const BOOK_DOMAINS: Record<string, string> = {
  '10bet': '10bet.com',
  '12bet': '12bet.com',
  '188bet': '188bet.com',
  '1xbet': '1xbet.com',
  '22bet': '22bet.com',
  '888sport': '888sport.com',
  bet365: 'bet365.com',
  betano: 'betano.com',
  betanysports: 'betanysports.eu',
  betanything: 'betanysports.eu',
  betclic: 'betclic.com',
  betfair: 'betfair.com',
  betfred: 'betfred.com',
  betmgm: 'betmgm.com',
  betonline: 'betonline.ag',
  betonlineag: 'betonline.ag',
  betparx: 'betparx.com',
  betr: 'betr.com.au',
  betright: 'betright.com.au',
  betrivers: 'betrivers.com',
  betsson: 'betsson.com',
  betus: 'betus.com',
  betvictor: 'betvictor.com',
  betway: 'betway.com',
  bet365nl: 'bet365.com',
  betgoodwin: 'betgoodwin.com.au',
  bovada: 'bovada.lv',
  boylesports: 'boylesports.com',
  bwin: 'bwin.com',
  caesars: 'caesars.com',
  casumo: 'casumo.com',
  cloudbet: 'cloudbet.com',
  coolbet: 'coolbet.com',
  coral: 'coral.co.uk',
  dabble: 'dabble.com',
  dafabet: 'dafabet.com',
  draftkings: 'draftkings.com',
  espnbet: 'espnbet.com',
  everygame: 'everygame.eu',
  fanatics: 'fanatics.com',
  fanduel: 'fanduel.com',
  fliff: 'getfliff.com',
  foxbet: 'foxbet.com',
  grosvenor: 'grosvenorcasinos.com',
  gtbets: 'gtbets.ag',
  hardrockbet: 'hardrock.bet',
  interwetten: 'interwetten.com',
  kalshi: 'kalshi.com',
  ladbrokes: 'ladbrokes.com.au',
  leovegas: 'leovegas.com',
  livescorebet: 'livescorebet.com',
  lowvig: 'lowvig.ag',
  marathon: 'marathonbet.com',
  marathonbet: 'marathonbet.com',
  matchbook: 'matchbook.com',
  mybookie: 'mybookie.ag',
  mybookieag: 'mybookie.ag',
  neds: 'neds.com.au',
  nordicbet: 'nordicbet.com',
  novig: 'novig.com',
  onexbet: '1xbet.com',
  paddypower: 'paddypower.com',
  palmerbet: 'palmerbet.com',
  picklebet: 'picklebet.com',
  pinnacle: 'pinnacle.com',
  playup: 'playup.com.au',
  pncl: 'pinnacle.com',
  pointsbet: 'pointsbet.com',
  pointsbetau: 'pointsbet.com.au',
  polymarket: 'polymarket.com',
  prizepicks: 'prizepicks.com',
  rebet: 'rebet.com',
  sbo: 'sbobet.com',
  sbobet: 'sbobet.com',
  skybet: 'skybet.com',
  smarkets: 'smarkets.com',
  sport888: '888sport.com',
  sportsbet: 'sportsbet.com.au',
  superbet: 'superbet.com',
  tab: 'tab.com.au',
  tabtouch: 'tabtouch.mobi',
  tipico: 'tipico.com',
  underdog: 'underdogfantasy.com',
  unibet: 'unibet.com',
  virginbet: 'virginbet.com',
  williamhill: 'williamhill.com',
  williamhillus: 'caesars.com',
  winamax: 'winamax.fr',
};

function prettyBookName(key: string): string {
  return String(key || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function bookInitials(name: string): string {
  const words = prettyBookName(name).split(' ').filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return prettyBookName(name).slice(0, 2).toUpperCase() || 'BK';
}

function guessBookDomain(key: string): string {
  const compact = compactBookKey(key);
  if (BOOK_DOMAINS[compact]) return BOOK_DOMAINS[compact];
  const stripped = compact.replace(/(au|uk|us|eu|nl|fr|se|it|de|ca|ag)$/g, '');
  if (stripped && BOOK_DOMAINS[stripped]) return BOOK_DOMAINS[stripped];
  const host = String(key || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '');
  if (/^[a-z0-9-]+\.[a-z]{2,}$/i.test(host)) return host;
  return `${stripped || compact || 'bookmaker'}.com`;
}

export function bookmakerLogoCandidates(key: string, preferred?: string | null): string[] {
  const urls: string[] = [];
  const local = localBookmakerLogoUrl(key);
  if (local) urls.push(local);
  if (preferred && preferred !== local) urls.push(preferred);
  const domain = guessBookDomain(key);
  urls.push(getLogoUrl(domain));
  urls.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
  return [...new Set(urls.filter(Boolean))];
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
  const raw = String(key || '').trim();
  const normalizedKey = raw.toLowerCase();
  const spaced = normalizeBookKey(raw);
  const compact = compactBookKey(raw);

  const found =
    BOOKMAKER_INFO[normalizedKey] ||
    BOOKMAKER_INFO[spaced] ||
    Object.entries(BOOKMAKER_INFO).find(([bookKey, info]) => {
      return compactBookKey(bookKey) === compact || compactBookKey(info.name) === compact;
    })?.[1] ||
    Object.entries(BOOKMAKER_INFO).find(([bookKey]) => {
      const bookCompact = compactBookKey(bookKey);
      return bookCompact.length >= 4 && (compact.includes(bookCompact) || bookCompact.includes(compact));
    })?.[1];

  const name = found?.name || prettyBookName(raw) || raw;
  const logo = found?.logo || bookInitials(name);
  const color = found?.color || '#6B7280';
  const logoUrls = bookmakerLogoCandidates(raw, found?.logoUrl);
  return {
    name,
    logo,
    color,
    logoUrl: logoUrls[0] || getLogoUrl(guessBookDomain(raw)),
    logoUrls,
  };
}
