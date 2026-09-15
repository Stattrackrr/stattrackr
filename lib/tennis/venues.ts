/**
 * Client-safe tournament venue lookup: city, indoor/outdoor, court speed.
 * Speed is Slow vs Fast (Medium when the court sits in between).
 */

export type TennisCourtSpeed = 'Slow' | 'Medium' | 'Fast';
export type TennisCourtSetting = 'Indoor' | 'Outdoor';

export type TennisVenue = {
  city: string;
  country: string;
  lat: number;
  lng: number;
  setting: TennisCourtSetting | null;
  speed: TennisCourtSpeed;
  tz?: string;
};

type VenueEntry = { keys: string[]; venue: TennisVenue };

function v(
  keys: string[],
  city: string,
  country: string,
  lat: number,
  lng: number,
  setting: TennisCourtSetting,
  speed: TennisCourtSpeed
): VenueEntry {
  return { keys, venue: { city, country, lat, lng, setting, speed } };
}

const VENUES: VenueEntry[] = [
  v(['australian open', 'aus open', 'melbourne'], 'Melbourne', 'Australia', -37.821, 144.979, 'Outdoor', 'Medium'),
  v(['roland garros', 'french open', 'roland-garros'], 'Paris', 'France', 48.847, 2.253, 'Outdoor', 'Slow'),
  v(['wimbledon'], 'London', 'United Kingdom', 51.434, -0.214, 'Outdoor', 'Fast'),
  v(['us open', 'u s open', 'flushing'], 'New York', 'United States', 40.75, -73.847, 'Outdoor', 'Medium'),
  v(['indian wells', 'bnp paribas open'], 'Indian Wells', 'United States', 33.722, -116.306, 'Outdoor', 'Slow'),
  v(['miami open', 'miami masters'], 'Miami', 'United States', 25.942, -80.21, 'Outdoor', 'Medium'),
  v(['monte carlo', 'monte-carlo', 'montecarlo'], 'Monte Carlo', 'Monaco', 43.752, 7.442, 'Outdoor', 'Slow'),
  v(['madrid', 'mutua madrid'], 'Madrid', 'Spain', 40.432, -3.609, 'Outdoor', 'Slow'),
  v(['rome', 'italian open', 'internazionali bnl'], 'Rome', 'Italy', 41.929, 12.457, 'Outdoor', 'Slow'),
  v(['canada masters', 'canadian open', 'montreal', 'toronto', 'national bank open', 'rogers cup'], 'Montreal', 'Canada', 45.503, -73.569, 'Outdoor', 'Fast'),
  v(['cincinnati', 'western and southern'], 'Cincinnati', 'United States', 39.349, -84.276, 'Outdoor', 'Fast'),
  v(['shanghai', 'rolex shanghai'], 'Shanghai', 'China', 31.042, 121.36, 'Outdoor', 'Fast'),
  v(['paris masters', 'rolex paris masters', 'bercy', 'nanterre'], 'Paris', 'France', 48.839, 2.252, 'Indoor', 'Fast'),
  v(['united cup'], 'Sydney', 'Australia', -33.847, 151.063, 'Outdoor', 'Medium'),
  v(['brisbane'], 'Brisbane', 'Australia', -27.485, 153.035, 'Outdoor', 'Medium'),
  v(['adelaide'], 'Adelaide', 'Australia', -34.919, 138.599, 'Outdoor', 'Medium'),
  v(['auckland', 'asb classic'], 'Auckland', 'New Zealand', -36.847, 174.765, 'Outdoor', 'Medium'),
  v(['hong kong'], 'Hong Kong', 'China', 22.302, 114.177, 'Outdoor', 'Medium'),
  v(['hobart'], 'Hobart', 'Australia', -42.88, 147.325, 'Outdoor', 'Medium'),
  v(['montpellier', 'open occitanie'], 'Montpellier', 'France', 43.611, 3.877, 'Indoor', 'Fast'),
  v(['dallas'], 'Dallas', 'United States', 32.79, -96.81, 'Indoor', 'Fast'),
  v(['rotterdam', 'abn amro'], 'Rotterdam', 'Netherlands', 51.924, 4.478, 'Indoor', 'Fast'),
  v(['marseille', 'open 13', 'open13'], 'Marseille', 'France', 43.296, 5.37, 'Indoor', 'Fast'),
  v(['doha', 'qatar open', 'qatar expos'], 'Doha', 'Qatar', 25.261, 51.445, 'Outdoor', 'Medium'),
  v(['dubai'], 'Dubai', 'United Arab Emirates', 25.188, 55.276, 'Outdoor', 'Fast'),
  v(['delray'], 'Delray Beach', 'United States', 26.461, -80.073, 'Outdoor', 'Fast'),
  v(['acapulco', 'mexican open', 'abierto mexicano'], 'Acapulco', 'Mexico', 16.86, -99.877, 'Outdoor', 'Medium'),
  v(['rio de janeiro', 'rio open'], 'Rio de Janeiro', 'Brazil', -22.972, -43.186, 'Outdoor', 'Slow'),
  v(['buenos aires', 'argentina open'], 'Buenos Aires', 'Argentina', -34.545, -58.45, 'Outdoor', 'Slow'),
  v(['santiago', 'chile open', 'movistar chile'], 'Santiago', 'Chile', -33.464, -70.607, 'Outdoor', 'Slow'),
  v(['houston', 'us mens clay', 'us men s clay'], 'Houston', 'United States', 29.685, -95.409, 'Outdoor', 'Slow'),
  v(['marrakech', 'marrakesh', 'grand prix hassan'], 'Marrakech', 'Morocco', 31.63, -8.009, 'Outdoor', 'Slow'),
  v(['barcelona'], 'Barcelona', 'Spain', 41.375, 2.119, 'Outdoor', 'Slow'),
  v(['munich', 'bmw open'], 'Munich', 'Germany', 48.173, 11.547, 'Outdoor', 'Slow'),
  v(['bucharest', 'tiriac'], 'Bucharest', 'Romania', 44.426, 26.102, 'Outdoor', 'Slow'),
  v(['estoril', 'millennium estoril'], 'Estoril', 'Portugal', 38.71, -9.391, 'Outdoor', 'Slow'),
  v(['hamburg'], 'Hamburg', 'Germany', 53.59, 9.996, 'Outdoor', 'Slow'),
  v(['geneva', 'gonet geneva'], 'Geneva', 'Switzerland', 46.2, 6.15, 'Outdoor', 'Slow'),
  v(
    ['grand prix auvergne', 'auvergne rhone', 'grand prix lyon', 'open parc auvergne', 'open parc'],
    'Lyon',
    'France',
    45.782,
    4.859,
    'Indoor',
    'Fast'
  ),
  v(['lyon'], 'Lyon', 'France', 45.782, 4.859, 'Outdoor', 'Slow'),
  v(['halle', 'terra wortmann'], 'Halle', 'Germany', 51.969, 8.347, 'Outdoor', 'Fast'),
  v(['queens club', 'queen s club', 'hsbc championships', 'cinch championships'], "Queen's Club", 'United Kingdom', 51.487, -0.212, 'Outdoor', 'Fast'),
  v(['stuttgart atp', 'boss open'], 'Stuttgart', 'Germany', 48.792, 9.236, 'Outdoor', 'Fast'),
  v(['hertogenbosch', 'rosmalen', 'libema', 's hertogenbosch'], "'s-Hertogenbosch", 'Netherlands', 51.685, 5.329, 'Outdoor', 'Fast'),
  v(['eastbourne', 'rothesay'], 'Eastbourne', 'United Kingdom', 50.772, 0.29, 'Outdoor', 'Fast'),
  v(['mallorca'], 'Mallorca', 'Spain', 39.545, 2.389, 'Outdoor', 'Fast'),
  v(['newport', 'hall of fame'], 'Newport', 'United States', 41.482, -71.314, 'Outdoor', 'Fast'),
  v(['bastad', 'swedish open'], 'Bastad', 'Sweden', 56.427, 12.861, 'Outdoor', 'Slow'),
  v(['gstaad', 'swiss open'], 'Gstaad', 'Switzerland', 46.475, 7.286, 'Outdoor', 'Slow'),
  v(['umag', 'croatia open', 'plava laguna'], 'Umag', 'Croatia', 45.437, 13.524, 'Outdoor', 'Slow'),
  v(['kitzbuhel', 'kitzbuehel', 'generali open'], 'Kitzbuhel', 'Austria', 47.447, 12.392, 'Outdoor', 'Slow'),
  v(['washington', 'citi open', 'mubadala citi'], 'Washington', 'United States', 38.889, -76.98, 'Outdoor', 'Fast'),
  v(['los cabos', 'mifel'], 'Los Cabos', 'Mexico', 22.891, -109.916, 'Outdoor', 'Medium'),
  v(['winston salem', 'winston-salem'], 'Winston-Salem', 'United States', 36.129, -80.258, 'Outdoor', 'Medium'),
  v(['chengdu'], 'Chengdu', 'China', 30.572, 104.066, 'Outdoor', 'Medium'),
  v(['hangzhou'], 'Hangzhou', 'China', 30.274, 120.155, 'Outdoor', 'Fast'),
  v(['tokyo', 'japan open', 'kinoshita'], 'Tokyo', 'Japan', 35.626, 139.733, 'Outdoor', 'Fast'),
  v(['beijing', 'china open'], 'Beijing', 'China', 39.993, 116.388, 'Outdoor', 'Medium'),
  v(['almaty'], 'Almaty', 'Kazakhstan', 43.238, 76.945, 'Indoor', 'Fast'),
  v(['brussels', 'european open', 'bnp paribas fortis'], 'Brussels', 'Belgium', 50.85, 4.351, 'Indoor', 'Fast'),
  v(['antwerp'], 'Antwerp', 'Belgium', 51.22, 4.4, 'Indoor', 'Fast'),
  v(['basel', 'swiss indoors'], 'Basel', 'Switzerland', 47.56, 7.589, 'Indoor', 'Fast'),
  v(['vienna', 'erste bank'], 'Vienna', 'Austria', 48.202, 16.346, 'Indoor', 'Fast'),
  v(['stockholm', 'nordic open'], 'Stockholm', 'Sweden', 59.35, 18.092, 'Indoor', 'Fast'),
  v(['metz', 'moselle'], 'Metz', 'France', 49.11, 6.176, 'Indoor', 'Fast'),
  v(['sofia'], 'Sofia', 'Bulgaria', 42.697, 23.322, 'Indoor', 'Fast'),
  v(['athens'], 'Athens', 'Greece', 37.984, 23.728, 'Indoor', 'Fast'),
  v(['atp finals', 'nite atp finals', 'tour finals', 'turin'], 'Turin', 'Italy', 45.042, 7.652, 'Indoor', 'Fast'),
  v(['next gen', 'nextgen'], 'Jeddah', 'Saudi Arabia', 21.485, 39.192, 'Indoor', 'Fast'),
  v(['laver cup'], 'London', 'United Kingdom', 51.507, -0.128, 'Indoor', 'Fast'),
  v(['davis cup'], 'Bologna', 'Italy', 44.494, 11.343, 'Indoor', 'Fast'),
  v(['charleston', 'credit one'], 'Charleston', 'United States', 32.861, -79.897, 'Outdoor', 'Slow'),
  v(['stuttgart open', 'porsche tennis', 'porsche grand prix'], 'Stuttgart', 'Germany', 48.794, 9.226, 'Indoor', 'Slow'),
  v(['linz'], 'Linz', 'Austria', 48.31, 14.285, 'Indoor', 'Slow'),
  v(['ostrava'], 'Ostrava', 'Czech Republic', 49.821, 18.262, 'Indoor', 'Fast'),
  v(['cluj', 'transylvania'], 'Cluj-Napoca', 'Romania', 46.771, 23.59, 'Indoor', 'Fast'),
  v(['rouen'], 'Rouen', 'France', 49.443, 1.099, 'Indoor', 'Slow'),
  v(['wta finals'], 'Indian Wells', 'United States', 33.722, -116.306, 'Outdoor', 'Slow'),
  v(['billie jean king', 'bjk cup'], 'Shenzhen', 'China', 22.543, 114.058, 'Indoor', 'Fast'),
  v(['doha wta', 'qatar total'], 'Doha', 'Qatar', 25.261, 51.445, 'Outdoor', 'Medium'),
  v(['abu dhabi'], 'Abu Dhabi', 'United Arab Emirates', 24.453, 54.377, 'Outdoor', 'Medium'),
  v(['indian wells wta'], 'Indian Wells', 'United States', 33.722, -116.306, 'Outdoor', 'Slow'),
  v(['madrid wta'], 'Madrid', 'Spain', 40.432, -3.609, 'Outdoor', 'Slow'),
  v(['rome wta'], 'Rome', 'Italy', 41.929, 12.457, 'Outdoor', 'Slow'),
  v(['berlin'], 'Berlin', 'Germany', 52.499, 13.282, 'Outdoor', 'Fast'),
  v(['bad homburg'], 'Bad Homburg', 'Germany', 50.227, 8.618, 'Outdoor', 'Fast'),
  v(['nottingham'], 'Nottingham', 'United Kingdom', 52.94, -1.132, 'Outdoor', 'Fast'),
  v(['birmingham'], 'Birmingham', 'United Kingdom', 52.455, -1.902, 'Outdoor', 'Fast'),
  v(['montreal wta', 'toronto wta'], 'Montreal', 'Canada', 45.503, -73.569, 'Outdoor', 'Fast'),
  v(['cincinnati wta'], 'Cincinnati', 'United States', 39.349, -84.276, 'Outdoor', 'Fast'),
  v(['guadalajara'], 'Guadalajara', 'Mexico', 20.675, -103.347, 'Outdoor', 'Medium'),
  v(['seoul', 'korea open'], 'Seoul', 'South Korea', 37.517, 127.072, 'Outdoor', 'Medium'),
  v(['osaka', 'japan wta'], 'Osaka', 'Japan', 34.669, 135.5, 'Outdoor', 'Medium'),
  v(['ningbo'], 'Ningbo', 'China', 29.868, 121.544, 'Outdoor', 'Medium'),
  v(['wuhan'], 'Wuhan', 'China', 30.52, 114.318, 'Outdoor', 'Medium'),
  v(['zhuhai'], 'Zhuhai', 'China', 22.271, 113.577, 'Outdoor', 'Medium'),
  v(['strasbourg'], 'Strasbourg', 'France', 48.573, 7.752, 'Outdoor', 'Slow'),
  v(['rabat'], 'Rabat', 'Morocco', 34.02, -6.841, 'Outdoor', 'Slow'),
  v(['istanbul'], 'Istanbul', 'Turkey', 41.013, 28.95, 'Outdoor', 'Slow'),
  v(['palermo'], 'Palermo', 'Italy', 38.116, 13.361, 'Outdoor', 'Slow'),
  v(['lausanne'], 'Lausanne', 'Switzerland', 46.52, 6.633, 'Outdoor', 'Slow'),
  v(['budapest'], 'Budapest', 'Hungary', 47.498, 19.04, 'Outdoor', 'Slow'),
  v(['prague'], 'Prague', 'Czech Republic', 50.088, 14.421, 'Outdoor', 'Slow'),
  v(['bogota'], 'Bogota', 'Colombia', 4.711, -74.072, 'Outdoor', 'Slow'),
  v(['merida', 'merida open'], 'Merida', 'Mexico', 20.967, -89.623, 'Outdoor', 'Medium'),
  v(['austin'], 'Austin', 'United States', 30.267, -97.743, 'Outdoor', 'Medium'),
  v(['san diego'], 'San Diego', 'United States', 32.715, -117.161, 'Outdoor', 'Medium'),
  v(['monterrey'], 'Monterrey', 'Mexico', 25.686, -100.316, 'Outdoor', 'Medium'),
  v(['cleveland'], 'Cleveland', 'United States', 41.499, -81.694, 'Indoor', 'Fast'),
  v(['rennes'], 'Rennes', 'France', 48.117, -1.678, 'Indoor', 'Fast'),
  v(['biella'], 'Biella', 'Italy', 45.563, 8.058, 'Outdoor', 'Slow'),
  v(['szczecin'], 'Szczecin', 'Poland', 53.428, 14.553, 'Outdoor', 'Slow'),
  v(['tiburon'], 'Tiburon', 'United States', 37.873, -122.457, 'Outdoor', 'Medium'),
  v(['cherbourg'], 'Cherbourg', 'France', 49.639, -1.616, 'Indoor', 'Fast'),
  v(['pau'], 'Pau', 'France', 43.295, -0.37, 'Indoor', 'Fast'),
  v(['quimper'], 'Quimper', 'France', 47.996, -4.098, 'Indoor', 'Fast'),
  v(['lille'], 'Lille', 'France', 50.629, 3.057, 'Indoor', 'Fast'),
  v(['brest'], 'Brest', 'France', 48.39, -4.486, 'Indoor', 'Fast'),
  v(['orleans'], 'Orleans', 'France', 47.903, 1.909, 'Indoor', 'Fast'),
  v(['ismaning'], 'Ismaning', 'Germany', 48.229, 11.689, 'Indoor', 'Fast'),
  v(['helsinki'], 'Helsinki', 'Finland', 60.169, 24.938, 'Indoor', 'Fast'),
  v(['bergamo'], 'Bergamo', 'Italy', 45.698, 9.677, 'Indoor', 'Fast'),
  v(['koblenz'], 'Koblenz', 'Germany', 50.357, 7.599, 'Indoor', 'Fast'),
  v(['ottignies', 'louvain'], 'Ottignies', 'Belgium', 50.666, 4.567, 'Indoor', 'Fast'),
  v(['drummondville'], 'Drummondville', 'Canada', 45.883, -72.483, 'Indoor', 'Fast'),
  v(['champaign'], 'Champaign', 'United States', 40.116, -88.243, 'Indoor', 'Fast'),
  v(['knoxville'], 'Knoxville', 'United States', 35.96, -83.921, 'Indoor', 'Fast'),
  v(['bratislava'], 'Bratislava', 'Slovakia', 48.148, 17.107, 'Indoor', 'Fast'),
  v(['andria'], 'Andria', 'Italy', 41.231, 16.297, 'Indoor', 'Fast'),
  v(['maia'], 'Maia', 'Portugal', 41.228, -8.62, 'Indoor', 'Slow'),
  v(['barranquilla'], 'Barranquilla', 'Colombia', 10.968, -74.781, 'Outdoor', 'Slow'),
  v(['sao paulo', 'sp open'], 'Sao Paulo', 'Brazil', -23.543, -46.724, 'Outdoor', 'Medium'),
  v(['pune'], 'Pune', 'India', 18.52, 73.857, 'Outdoor', 'Medium'),
  v(['bengaluru', 'bangalore'], 'Bengaluru', 'India', 12.972, 77.595, 'Outdoor', 'Medium'),
  v(['nonthaburi'], 'Nonthaburi', 'Thailand', 13.862, 100.514, 'Outdoor', 'Medium'),
  v(['busan'], 'Busan', 'South Korea', 35.18, 129.075, 'Outdoor', 'Medium'),
  v(['shanghai challenger'], 'Shanghai', 'China', 31.23, 121.474, 'Outdoor', 'Fast'),
  v(['cary'], 'Cary', 'United States', 35.791, -78.781, 'Outdoor', 'Medium'),
  v(['columbus'], 'Columbus', 'United States', 39.961, -82.999, 'Indoor', 'Fast'),
  v(['virtus', 'bologna challenger'], 'Bologna', 'Italy', 44.494, 11.343, 'Outdoor', 'Slow'),
];

function foldHasKey(fold: string, key: string): boolean {
  if (!fold || !key) return false;
  if (fold === key) return true;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^| )${escaped}(?: |$)`).test(fold);
}

export function foldVenueKey(name: string | null | undefined): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lookupHit(fold: string): TennisVenue | null {
  if (!fold) return null;
  let best: { venue: TennisVenue; len: number } | null = null;
  for (const entry of VENUES) {
    for (const key of entry.keys) {
      if (foldHasKey(fold, key)) {
        if (!best || key.length > best.len) best = { venue: entry.venue, len: key.length };
      }
    }
  }
  return best?.venue ?? null;
}

function heuristicVenue(
  name: string | null | undefined,
  surface?: string | null
): TennisVenue {
  const fold = foldVenueKey(name);
  const surf = String(surface || '').toLowerCase();
  const namedIndoor = /\b(indoor|indoors)\b/.test(fold);
  let speed: TennisCourtSpeed = 'Medium';
  if (surf.includes('clay') || /\bclay\b/.test(fold)) speed = 'Slow';
  else if (surf.includes('grass') || /\bgrass\b/.test(fold)) speed = 'Fast';
  const city = String(name || '')
    .replace(/^(ATP|WTA)\s+/i, '')
    .replace(/\s+\d{4}$/, '')
    .trim() || 'Unknown';
  return {
    city,
    country: '',
    lat: 0,
    lng: 0,
    setting: namedIndoor ? 'Indoor' : null,
    speed,
  };
}

export function lookupTennisVenue(
  name?: string | null,
  surface?: string | null
): TennisVenue {
  const fold = foldVenueKey(name);
  const surf = String(surface || '').toLowerCase();
  if (fold.includes('stuttgart')) {
    if (surf.includes('clay') || fold.includes('porsche') || fold.includes('indoor')) {
      return withTz({ city: 'Stuttgart', country: 'Germany', lat: 48.794, lng: 9.226, setting: 'Indoor', speed: 'Slow' });
    }
    return withTz({ city: 'Stuttgart', country: 'Germany', lat: 48.792, lng: 9.236, setting: 'Outdoor', speed: 'Fast' });
  }
  if (fold.includes('lyon')) {
    if (surf.includes('hard') || fold.includes('auvergne') || fold.includes('indoor') || fold.includes('parc')) {
      return withTz({ city: 'Lyon', country: 'France', lat: 45.782, lng: 4.859, setting: 'Indoor', speed: 'Fast' });
    }
    if (surf.includes('clay')) {
      return withTz({ city: 'Lyon', country: 'France', lat: 45.782, lng: 4.859, setting: 'Outdoor', speed: 'Slow' });
    }
  }
  if ((fold === 'paris' || fold === 'atp paris' || fold === 'wta paris') && !fold.includes('roland')) {
    if (surf.includes('clay')) {
      return withTz({ city: 'Paris', country: 'France', lat: 48.847, lng: 2.253, setting: 'Outdoor', speed: 'Slow' });
    }
    if (surf.includes('hard') || surf.includes('indoor')) {
      return withTz({ city: 'Paris', country: 'France', lat: 48.839, lng: 2.252, setting: 'Indoor', speed: 'Fast' });
    }
  }
  return withTz(lookupHit(fold) || heuristicVenue(name, surface));
}

export function sameTennisEvent(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = foldVenueKey(a);
  const right = foldVenueKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left))) return true;
  return false;
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number | null {
  if (!a.lat && !a.lng) return null;
  if (!b.lat && !b.lng) return null;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sin =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(sin)));
}

export function formatTravelKm(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return '';
  if (km < 80) return 'Same city';
  return `~${Math.round(km).toLocaleString('en-US')} km`;
}

export function parseTennisLogDate(value: string | null | undefined): Date | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function calendarDaysBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / 86_400_000);
}

/** Full 24-hour periods since `from`. Under 24 hours is 0. */
export function daysSinceTimestamp(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (!Number.isFinite(ms) || ms < 86_400_000) return 0;
  return Math.floor(ms / 86_400_000);
}

export function formatDaysAgo(days: number | null): string {
  if (days == null || !Number.isFinite(days) || days < 0) return '—';
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

const CITY_TZ: Record<string, string> = {
  'Sao Paulo': 'America/Sao_Paulo',
  Melbourne: 'Australia/Melbourne',
  Paris: 'Europe/Paris',
  London: 'Europe/London',
  'New York': 'America/New_York',
  'Indian Wells': 'America/Los_Angeles',
  Miami: 'America/New_York',
  'Monte Carlo': 'Europe/Monaco',
  Madrid: 'Europe/Madrid',
  Rome: 'Europe/Rome',
  Montreal: 'America/Toronto',
  Cincinnati: 'America/New_York',
  Shanghai: 'Asia/Shanghai',
  Sydney: 'Australia/Sydney',
  Brisbane: 'Australia/Brisbane',
  Adelaide: 'Australia/Adelaide',
  Auckland: 'Pacific/Auckland',
  'Hong Kong': 'Asia/Hong_Kong',
  Hobart: 'Australia/Hobart',
  Montpellier: 'Europe/Paris',
  Dallas: 'America/Chicago',
  Rotterdam: 'Europe/Amsterdam',
  Marseille: 'Europe/Paris',
  Doha: 'Asia/Qatar',
  Dubai: 'Asia/Dubai',
  'Delray Beach': 'America/New_York',
  Acapulco: 'America/Mexico_City',
  'Rio de Janeiro': 'America/Sao_Paulo',
  'Buenos Aires': 'America/Argentina/Buenos_Aires',
  Santiago: 'America/Santiago',
  Houston: 'America/Chicago',
  Marrakech: 'Africa/Casablanca',
  Barcelona: 'Europe/Madrid',
  Munich: 'Europe/Berlin',
  Bucharest: 'Europe/Bucharest',
  Estoril: 'Europe/Lisbon',
  Hamburg: 'Europe/Berlin',
  Geneva: 'Europe/Zurich',
  Lyon: 'Europe/Paris',
  Halle: 'Europe/Berlin',
  "Queen's Club": 'Europe/London',
  Stuttgart: 'Europe/Berlin',
  "'s-Hertogenbosch": 'Europe/Amsterdam',
  Eastbourne: 'Europe/London',
  Mallorca: 'Europe/Madrid',
  Newport: 'America/New_York',
  Bastad: 'Europe/Stockholm',
  Gstaad: 'Europe/Zurich',
  Umag: 'Europe/Zagreb',
  Kitzbuhel: 'Europe/Vienna',
  Washington: 'America/New_York',
  'Los Cabos': 'America/Mazatlan',
  'Winston-Salem': 'America/New_York',
  Chengdu: 'Asia/Shanghai',
  Hangzhou: 'Asia/Shanghai',
  Tokyo: 'Asia/Tokyo',
  Beijing: 'Asia/Shanghai',
  Almaty: 'Asia/Almaty',
  Brussels: 'Europe/Brussels',
  Antwerp: 'Europe/Brussels',
  Basel: 'Europe/Zurich',
  Vienna: 'Europe/Vienna',
  Stockholm: 'Europe/Stockholm',
  Metz: 'Europe/Paris',
  Sofia: 'Europe/Sofia',
  Athens: 'Europe/Athens',
  Turin: 'Europe/Rome',
  Jeddah: 'Asia/Riyadh',
  Bologna: 'Europe/Rome',
  Charleston: 'America/New_York',
  Linz: 'Europe/Vienna',
  Ostrava: 'Europe/Prague',
  'Cluj-Napoca': 'Europe/Bucharest',
  Rouen: 'Europe/Paris',
  Shenzhen: 'Asia/Shanghai',
  'Abu Dhabi': 'Asia/Dubai',
  Berlin: 'Europe/Berlin',
  'Bad Homburg': 'Europe/Berlin',
  Nottingham: 'Europe/London',
  Birmingham: 'Europe/London',
  Guadalajara: 'America/Mexico_City',
  Seoul: 'Asia/Seoul',
  Osaka: 'Asia/Tokyo',
  Ningbo: 'Asia/Shanghai',
  Wuhan: 'Asia/Shanghai',
  Zhuhai: 'Asia/Shanghai',
  Strasbourg: 'Europe/Paris',
  Rabat: 'Africa/Casablanca',
  Istanbul: 'Europe/Istanbul',
  Palermo: 'Europe/Rome',
  Lausanne: 'Europe/Zurich',
  Budapest: 'Europe/Budapest',
  Prague: 'Europe/Prague',
  Barranquilla: 'America/Bogota',
  Bogota: 'America/Bogota',
  Merida: 'America/Merida',
  Austin: 'America/Chicago',
  'San Diego': 'America/Los_Angeles',
  Monterrey: 'America/Monterrey',
  Cleveland: 'America/New_York',
  Rennes: 'Europe/Paris',
  Biella: 'Europe/Rome',
  Szczecin: 'Europe/Warsaw',
  Tiburon: 'America/Los_Angeles',
  Cherbourg: 'Europe/Paris',
  Pau: 'Europe/Paris',
  Quimper: 'Europe/Paris',
  Lille: 'Europe/Paris',
  Brest: 'Europe/Paris',
  Orleans: 'Europe/Paris',
  Ismaning: 'Europe/Berlin',
  Helsinki: 'Europe/Helsinki',
  Bergamo: 'Europe/Rome',
  Koblenz: 'Europe/Berlin',
  Ottignies: 'Europe/Brussels',
  Drummondville: 'America/Toronto',
  Champaign: 'America/Chicago',
  Knoxville: 'America/New_York',
  Bratislava: 'Europe/Bratislava',
  Andria: 'Europe/Rome',
  Maia: 'Europe/Lisbon',
  Pune: 'Asia/Kolkata',
  Bengaluru: 'Asia/Kolkata',
  Nonthaburi: 'Asia/Bangkok',
  Busan: 'Asia/Seoul',
  Cary: 'America/New_York',
  Columbus: 'America/New_York',
};

const COUNTRY_TZ: Record<string, string> = {
  France: 'Europe/Paris',
  Spain: 'Europe/Madrid',
  Italy: 'Europe/Rome',
  Germany: 'Europe/Berlin',
  Australia: 'Australia/Sydney',
  China: 'Asia/Shanghai',
  Japan: 'Asia/Tokyo',
  'United Kingdom': 'Europe/London',
  'United States': 'America/New_York',
  Canada: 'America/Toronto',
  Netherlands: 'Europe/Amsterdam',
  Switzerland: 'Europe/Zurich',
  Austria: 'Europe/Vienna',
  Belgium: 'Europe/Brussels',
  Portugal: 'Europe/Lisbon',
  Sweden: 'Europe/Stockholm',
  Qatar: 'Asia/Qatar',
  'United Arab Emirates': 'Asia/Dubai',
  Colombia: 'America/Bogota',
  Brazil: 'America/Sao_Paulo',
  Argentina: 'America/Argentina/Buenos_Aires',
  Chile: 'America/Santiago',
  Mexico: 'America/Mexico_City',
  Morocco: 'Africa/Casablanca',
  Turkey: 'Europe/Istanbul',
  'New Zealand': 'Pacific/Auckland',
  'Czech Republic': 'Europe/Prague',
  Romania: 'Europe/Bucharest',
  Poland: 'Europe/Warsaw',
  India: 'Asia/Kolkata',
  Monaco: 'Europe/Monaco',
};

export function timezoneForVenue(venue: Pick<TennisVenue, 'city' | 'country' | 'tz'>): string | null {
  if (venue.tz) return venue.tz;
  if (venue.city && CITY_TZ[venue.city]) return CITY_TZ[venue.city];
  const fold = foldVenueKey(venue.city);
  if (fold) {
    for (const [city, tz] of Object.entries(CITY_TZ)) {
      if (foldHasKey(fold, foldVenueKey(city)) || foldHasKey(foldVenueKey(city), fold)) return tz;
    }
  }
  if (venue.country && COUNTRY_TZ[venue.country]) return COUNTRY_TZ[venue.country];
  if (fold) {
    for (const [country, tz] of Object.entries(COUNTRY_TZ)) {
      if (foldHasKey(fold, foldVenueKey(country))) return tz;
    }
  }
  return null;
}

function tzOffsetMinutes(timeZone: string, date: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      timeZoneName: 'shortOffset',
    }).formatToParts(date);
    const name = parts.find((part) => part.type === 'timeZoneName')?.value || '';
    const match = name.match(/([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) {
      if (/^(GMT|UTC)$/i.test(name)) return 0;
      return null;
    }
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
  } catch {
    return null;
  }
}

export function formatTimezoneDiff(
  fromVenue: Pick<TennisVenue, 'city' | 'country' | 'tz'> | null,
  toVenue: Pick<TennisVenue, 'city' | 'country' | 'tz'>,
  at: Date
): string {
  if (!fromVenue) return '';
  const fromTz = timezoneForVenue(fromVenue);
  const toTz = timezoneForVenue(toVenue);
  if (!fromTz || !toTz) return '';
  if (fromTz === toTz) return '0h';
  const from = tzOffsetMinutes(fromTz, at);
  const to = tzOffsetMinutes(toTz, at);
  if (from == null || to == null) return '';
  const diffMin = to - from;
  if (diffMin === 0) return '0h';
  const sign = diffMin > 0 ? '+' : '-';
  const abs = Math.abs(diffMin);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  const clock = mins ? `${hours}h ${mins}m` : `${hours}h`;
  return `${sign}${clock}`;
}

function withTz(venue: TennisVenue): TennisVenue {
  return { ...venue, tz: timezoneForVenue(venue) || undefined };
}

const COURT_PACE: Array<{ keys: string[]; cpi: number }> = [
  { keys: ['indian wells', 'bnp paribas open'], cpi: 39.3 },
  { keys: ['miami'], cpi: 39.2 },
  { keys: ['monte carlo', 'monte-carlo', 'montecarlo'], cpi: 27.1 },
  { keys: ['madrid'], cpi: 29.8 },
  { keys: ['rome', 'italian open'], cpi: 25.4 },
  { keys: ['canadian open', 'canada masters', 'montreal', 'toronto', 'national bank open', 'rogers cup'], cpi: 35.4 },
  { keys: ['cincinnati'], cpi: 39 },
  { keys: ['us open', 'u s open'], cpi: 42.8 },
  { keys: ['shanghai'], cpi: 37.9 },
  { keys: ['paris masters', 'rolex paris masters', 'bercy'], cpi: 40.3 },
  { keys: ['atp finals', 'tour finals'], cpi: 41.3 },
];

export function lookupCourtPace(name?: string | null): number | null {
  const fold = foldVenueKey(name);
  if (!fold) return null;
  let best: { cpi: number; len: number } | null = null;
  for (const row of COURT_PACE) {
    for (const key of row.keys) {
      if (foldHasKey(fold, key) && (!best || key.length > best.len)) {
        best = { cpi: row.cpi, len: key.length };
      }
    }
  }
  return best?.cpi ?? null;
}

export function courtPaceBand(cpi: number): string {
  if (cpi < 30) return 'Slow';
  if (cpi < 35) return 'Medium-slow';
  if (cpi < 40) return 'Medium';
  if (cpi < 45) return 'Medium-fast';
  return 'Fast';
}
