/**
 * Fetch official AFL club (Telstra tenant) player headshots by scraping public squad + profile pages.
 * Same pages users see on club sites, e.g. westcoasteagles.com.au/teams/afl → /players/956/liam-duggan
 */

import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';
import { normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';

const FETCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 StatTrackr/1';

/** NMFC lists players under `/teams/afl/players`; `/teams/afl/squad` 404s on some tenants. */
const SQUAD_PATHS = ['/teams/afl', '/teams/afl/squad', '/teams/afl/players'] as const;

/** Official roster display name → club site origin (AFL tenant squad pages). */
export const OFFICIAL_TEAM_TO_CLUB_ORIGIN: Record<string, string> = {
  'Adelaide Crows': 'https://www.afc.com.au',
  'Brisbane Lions': 'https://www.lions.com.au',
  'Carlton Blues': 'https://www.carltonfc.com.au',
  'Collingwood Magpies': 'https://www.collingwoodfc.com.au',
  'Essendon Bombers': 'https://www.essendonfc.com.au',
  'Fremantle Dockers': 'https://www.fremantlefc.com.au',
  'Geelong Cats': 'https://www.geelongcats.com.au',
  'Gold Coast Suns': 'https://www.goldcoastfc.com.au',
  'GWS Giants': 'https://www.gwsgiants.com.au',
  'Hawthorn Hawks': 'https://www.hawthornfc.com.au',
  'Melbourne Demons': 'https://www.melbournefc.com.au',
  'North Melbourne Kangaroos': 'https://www.nmfc.com.au',
  'Port Adelaide Power': 'https://www.portadelaidefc.com.au',
  'Richmond Tigers': 'https://www.richmondfc.com.au',
  'St Kilda Saints': 'https://www.saints.com.au',
  'Sydney Swans': 'https://www.sydneyswans.com.au',
  'West Coast Eagles': 'https://www.westcoasteagles.com.au',
  'Western Bulldogs': 'https://www.westernbulldogs.com.au',
};

type SquadRow = { href: string; displayName: string; slug: string };

const squadHtmlCache = new Map<string, { html: string; expiresAt: number }>();
const SQUAD_TTL_MS = 60 * 60 * 1000;

function clubOriginForTeam(teamInput: string | null | undefined): string | null {
  if (!teamInput?.trim()) return null;
  const official = toOfficialAflTeamDisplayName(teamInput.trim());
  return OFFICIAL_TEAM_TO_CLUB_ORIGIN[official] ?? null;
}

function parseSquadPlayers(html: string): SquadRow[] {
  const out: SquadRow[] = [];
  const re =
    /<a class="player-item[^"]*" href="(\/players\/\d+\/[^"]+)">[\s\S]*?<h1 class="player-item__name">\s*([^<]*?)\s*<span class="player-item__last-name">\s*([^<]+?)\s*<\/span>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const first = m[2].replace(/\s+/g, ' ').trim();
    const last = m[3].replace(/\s+/g, ' ').trim();
    const displayName = `${first} ${last}`.trim();
    const slug = href.split('/').pop() ?? '';
    if (href && displayName) out.push({ href, displayName, slug });
  }
  return out;
}

function slugToNorm(slug: string): string {
  return normalizeAflPlayerNameForMatch(slug.replace(/-/g, ' '));
}

function findPlayerHref(rows: SquadRow[], playerName: string): string | null {
  const target = normalizeAflPlayerNameForMatch(playerName);
  if (!target) return null;

  for (const r of rows) {
    if (normalizeAflPlayerNameForMatch(r.displayName) === target) return r.href;
  }
  for (const r of rows) {
    if (slugToNorm(r.slug) === target) return r.href;
  }
  return null;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': FETCH_UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Telstra club sites inject `playerImagePath` + `js-player-image` + squad season id; the hero PNG is
 * served from s.afl.com.au ChampIDImages (see PULSE.common PlayerHeadshot → getCompetitionPlayerImage).
 */
function extractTelstraChampIdHeadshotUrl(html: string): string | null {
  const pathM = html.match(/"playerImagePath"\s*:\s*"(\/\/[^"]+)"/);
  const basePath = pathM?.[1];
  if (!basePath) return null;

  let seasonRaw: string | null = null;
  const scriptSeason = html.match(
    /\.js-player-squad-compseason-pid'\)\s*\.\s*value\s*=\s*"(CD_S\d+)"/
  );
  if (scriptSeason?.[1]) seasonRaw = scriptSeason[1];
  if (!seasonRaw) {
    const inputSeason = html.match(
      /class="[^"]*js-player-squad-compseason-pid[^"]*"[^>]*\svalue="(CD_S\d+)"/i
    );
    if (inputSeason?.[1]) seasonRaw = inputSeason[1];
  }
  if (!seasonRaw?.startsWith('CD_S')) return null;
  const seasonDigits = seasonRaw.replace(/^CD_S/, '');

  const headIdx = html.indexOf('player__headshot');
  if (headIdx === -1) return null;
  const headBlock = html.slice(headIdx, headIdx + 1500);
  const playerM =
    headBlock.match(/class="js-player-image"[^>]*\sdata-player="(\d+)"/) ??
    headBlock.match(/data-player="(\d+)"[^>]*\sclass="js-player-image"/);
  const playerId = playerM?.[1];
  if (!playerId) return null;

  const compAbbr = 'AFL';
  const q = '?im=Scale,width=708,height=708';
  return `https:${basePath}/${compAbbr}/${seasonDigits}/${playerId}.png${q}`;
}

function extractHeadshotFromProfileHtml(html: string): string | null {
  const marker = 'player__headshot';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  // Prefer AFL ChampID static URLs (s.afl.com.au) for every Telstra tenant. Club `resources.*.com.au`
  // photo-resources URLs often 403 or fail in-browser when used as <img src> on another origin; NMFC
  // only “worked” first because the hero has no SSR img and we already fell through to ChampID.
  const champ = extractTelstraChampIdHeadshotUrl(html);
  if (champ) return champ;

  const sliceEnd = Math.min(idx + 4500, html.length);
  const slice = html.slice(idx, sliceEnd);
  const imgTags = slice.match(/<img\b[^>]*>/gi) ?? [];
  for (const tag of imgTags) {
    if (!tag.includes('object-fit-cover-picture__img')) continue;
    const sm = tag.match(/\ssrc="([^"]+)"/i);
    if (sm?.[1]?.includes('photo-resources')) return sm[1].replace(/&amp;/g, '&');
  }
  const loose = slice.match(
    /src="(https:\/\/resources\.[^"]+photo-resources[^"]+\.(?:jpe?g|png|webp|gif)[^"]*)"/i
  );
  return loose?.[1]?.replace(/&amp;/g, '&') ?? null;
}

async function getSquadHtml(origin: string): Promise<string | null> {
  const base = origin.replace(/\/$/, '');
  for (const path of SQUAD_PATHS) {
    const squadUrl = `${base}${path}`;
    const ck = squadUrl;
    const hit = squadHtmlCache.get(ck);
    if (hit && hit.expiresAt > Date.now()) {
      if (parseSquadPlayers(hit.html).length > 0) return hit.html;
      continue;
    }

    const html = await fetchText(squadUrl);
    if (!html) continue;
    squadHtmlCache.set(ck, { html, expiresAt: Date.now() + SQUAD_TTL_MS });
    if (parseSquadPlayers(html).length > 0) return html;
  }
  return null;
}

/**
 * Headshot image URL from the player’s AFL club site, or null if not found.
 */
export async function fetchClubSitePortraitUrl(
  playerName: string,
  team?: string | null
): Promise<string | null> {
  const origin = clubOriginForTeam(team ?? '');
  if (!origin) return null;

  const squadHtml = await getSquadHtml(origin);
  if (!squadHtml) return null;

  const rows = parseSquadPlayers(squadHtml);
  if (rows.length === 0) return null;

  const href = findPlayerHref(rows, playerName);
  if (!href) return null;

  const profileUrl = `${origin.replace(/\/$/, '')}${href}`;
  const profileHtml = await fetchText(profileUrl);
  if (!profileHtml) return null;

  return extractHeadshotFromProfileHtml(profileHtml);
}
