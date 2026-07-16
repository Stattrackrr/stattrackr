/**
 * FootyInfo team abbrev / name ↔ official StatTrackr team names.
 */

export const FOOTYINFO_ABBREV_TO_OFFICIAL: Record<string, string> = {
  ADE: 'Adelaide Crows',
  AD: 'Adelaide Crows',
  BRL: 'Brisbane Lions',
  BL: 'Brisbane Lions',
  CAR: 'Carlton Blues',
  CA: 'Carlton Blues',
  COL: 'Collingwood Magpies',
  CW: 'Collingwood Magpies',
  ESS: 'Essendon Bombers',
  ES: 'Essendon Bombers',
  FRE: 'Fremantle Dockers',
  FR: 'Fremantle Dockers',
  GEE: 'Geelong Cats',
  GE: 'Geelong Cats',
  GCS: 'Gold Coast Suns',
  GC: 'Gold Coast Suns',
  GWS: 'GWS Giants',
  GW: 'GWS Giants',
  HAW: 'Hawthorn Hawks',
  HW: 'Hawthorn Hawks',
  MEL: 'Melbourne Demons',
  ME: 'Melbourne Demons',
  NTH: 'North Melbourne Kangaroos',
  NM: 'North Melbourne Kangaroos',
  PAD: 'Port Adelaide Power',
  PA: 'Port Adelaide Power',
  RCH: 'Richmond Tigers',
  RI: 'Richmond Tigers',
  STK: 'St Kilda Saints',
  SK: 'St Kilda Saints',
  SYD: 'Sydney Swans',
  SY: 'Sydney Swans',
  WCE: 'West Coast Eagles',
  WC: 'West Coast Eagles',
  WBD: 'Western Bulldogs',
  WB: 'Western Bulldogs',
};

export const FOOTYINFO_NAME_TO_OFFICIAL: Record<string, string> = {
  Adelaide: 'Adelaide Crows',
  'Adelaide Crows': 'Adelaide Crows',
  Brisbane: 'Brisbane Lions',
  'Brisbane Lions': 'Brisbane Lions',
  Carlton: 'Carlton Blues',
  'Carlton Blues': 'Carlton Blues',
  Collingwood: 'Collingwood Magpies',
  'Collingwood Magpies': 'Collingwood Magpies',
  Essendon: 'Essendon Bombers',
  'Essendon Bombers': 'Essendon Bombers',
  Fremantle: 'Fremantle Dockers',
  'Fremantle Dockers': 'Fremantle Dockers',
  Geelong: 'Geelong Cats',
  'Geelong Cats': 'Geelong Cats',
  'Gold Coast': 'Gold Coast Suns',
  'Gold Coast Suns': 'Gold Coast Suns',
  GWS: 'GWS Giants',
  'Greater Western Sydney': 'GWS Giants',
  'GWS Giants': 'GWS Giants',
  Hawthorn: 'Hawthorn Hawks',
  'Hawthorn Hawks': 'Hawthorn Hawks',
  Melbourne: 'Melbourne Demons',
  'Melbourne Demons': 'Melbourne Demons',
  'North Melbourne': 'North Melbourne Kangaroos',
  'North Melbourne Kangaroos': 'North Melbourne Kangaroos',
  'Port Adelaide': 'Port Adelaide Power',
  'Port Adelaide Power': 'Port Adelaide Power',
  Richmond: 'Richmond Tigers',
  'Richmond Tigers': 'Richmond Tigers',
  'St Kilda': 'St Kilda Saints',
  'St Kilda Saints': 'St Kilda Saints',
  Sydney: 'Sydney Swans',
  'Sydney Swans': 'Sydney Swans',
  'West Coast': 'West Coast Eagles',
  'West Coast Eagles': 'West Coast Eagles',
  'Western Bulldogs': 'Western Bulldogs',
  Footscray: 'Western Bulldogs',
};

/** Nickname used in existing game-log opponent fields (Bombers, Cats, …). */
export const OFFICIAL_TO_NICKNAME: Record<string, string> = {
  'Adelaide Crows': 'Crows',
  'Brisbane Lions': 'Lions',
  'Carlton Blues': 'Blues',
  'Collingwood Magpies': 'Magpies',
  'Essendon Bombers': 'Bombers',
  'Fremantle Dockers': 'Dockers',
  'Geelong Cats': 'Cats',
  'Gold Coast Suns': 'Suns',
  'GWS Giants': 'Giants',
  'Hawthorn Hawks': 'Hawks',
  'Melbourne Demons': 'Demons',
  'North Melbourne Kangaroos': 'Kangaroos',
  'Port Adelaide Power': 'Power',
  'Richmond Tigers': 'Tigers',
  'St Kilda Saints': 'Saints',
  'Sydney Swans': 'Swans',
  'West Coast Eagles': 'Eagles',
  'Western Bulldogs': 'Bulldogs',
};

export function footyinfoAbbrevToOfficial(abbrev: string | null | undefined): string | null {
  if (!abbrev) return null;
  const key = String(abbrev).trim().toUpperCase();
  return FOOTYINFO_ABBREV_TO_OFFICIAL[key] ?? null;
}

export function footyinfoNameToOfficial(name: string | null | undefined): string | null {
  if (!name) return null;
  const t = String(name).trim();
  if (FOOTYINFO_NAME_TO_OFFICIAL[t]) return FOOTYINFO_NAME_TO_OFFICIAL[t];
  const lower = t.toLowerCase();
  const hit = Object.entries(FOOTYINFO_NAME_TO_OFFICIAL).find(([k]) => k.toLowerCase() === lower);
  return hit ? hit[1] : null;
}

export function officialToNickname(official: string | null | undefined): string | null {
  if (!official) return null;
  return OFFICIAL_TO_NICKNAME[official.trim()] ?? null;
}

export function footyinfoOpponentToNickname(abbrevOrName: string | null | undefined): string {
  const official =
    footyinfoAbbrevToOfficial(abbrevOrName) || footyinfoNameToOfficial(abbrevOrName);
  if (!official) return String(abbrevOrName || '').trim();
  return officialToNickname(official) || official;
}

/** Build FootyInfo player URL slug from a display name. */
export function footyinfoPlayerSlug(playerName: string): string {
  const apostropheLike = /[\u0027\u2018\u2019\u201B\u2032\u02BC\u02B9`]/g;
  let s = String(playerName ?? '')
    .trim()
    .toLowerCase();
  s = s.replace(/\bo['\u2018\u2019\u201B\u2032\u02BC\u02B9`]\s*/g, 'o-');
  s = s.replace(/\bd['\u2018\u2019\u201B\u2032\u02BC\u02B9`]\s*/g, 'd-');
  s = s
    .replace(apostropheLike, '')
    .replace(/\./g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s;
}
