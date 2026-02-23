import { NextResponse } from 'next/server';

const AFL_TEAMS_URL = 'https://www.afl.com.au/teams';
const TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

type CachedLogos = {
  expiresAt: number;
  logos: Record<string, string>;
};

let cache: CachedLogos | null = null;

function normalizeTeamName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addAliases(target: Record<string, string>, canonical: string, logo: string, aliases: string[]) {
  target[normalizeTeamName(canonical)] = logo;
  for (const alias of aliases) {
    const normalized = normalizeTeamName(alias);
    if (normalized) target[normalized] = logo;
  }
}

const CODE_TO_ALIASES: Record<string, string[]> = {
  adel: ['Adelaide', 'Adelaide Crows', 'Crows', 'ADE', 'CRO'],
  bl: ['Brisbane', 'Brisbane Lions', 'Lions', 'BRI', 'LIO'],
  carl: ['Carlton', 'Carlton Blues', 'Blues', 'CAR', 'BLU'],
  coll: ['Collingwood', 'Collingwood Magpies', 'Magpies', 'COL', 'MAG'],
  ess: ['Essendon', 'Essendon Bombers', 'Bombers', 'ESS', 'BOM'],
  fre: ['Fremantle', 'Fremantle Dockers', 'Dockers', 'FRE', 'DOK'],
  geel: ['Geelong', 'Geelong Cats', 'Cats', 'GEE', 'CAT'],
  gcfc: ['Gold Coast', 'Gold Coast Suns', 'Suns', 'GCS', 'SUN'],
  gws: ['GWS', 'GWS Giants', 'Greater Western Sydney', 'Giants', 'GWS', 'GIA'],
  haw: ['Hawthorn', 'Hawthorn Hawks', 'Hawks', 'HAW', 'HWK'],
  melb: ['Melbourne', 'Melbourne Demons', 'Demons', 'MEL', 'DEM'],
  nmfc: ['North Melbourne', 'North Melbourne Kangaroos', 'Kangaroos', 'North', 'NTH', 'KAN'],
  port: ['Port Adelaide', 'Port Adelaide Power', 'Power', 'PTA', 'POR', 'POW'],
  rich: ['Richmond', 'Richmond Tigers', 'Tigers', 'RIC', 'TIG'],
  stk: ['St Kilda', 'St Kilda Saints', 'Saints', 'STK', 'SAI'],
  syd: ['Sydney', 'Sydney Swans', 'Swans', 'SYD', 'SWA'],
  wb: ['Western Bulldogs', 'Bulldogs', 'Footscray', 'WBD', 'BUL'],
  wce: ['West Coast', 'West Coast Eagles', 'Eagles', 'WCE', 'EAG'],
};

async function scrapeAflTeamLogos(): Promise<Record<string, string>> {
  const teamsRes = await fetch(AFL_TEAMS_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-AU,en;q=0.9',
    },
    next: { revalidate: 60 * 60 },
  });
  if (!teamsRes.ok) throw new Error(`Failed to fetch AFL teams page (${teamsRes.status})`);
  const teamsHtml = await teamsRes.text();

  const iconsPathMatch = teamsHtml.match(/xlink:href="(\/resources\/[^"]*\/i\/svg-output\/icons\.svg)#icn-aflc-/i);
  if (!iconsPathMatch) throw new Error('Could not locate AFL icons SVG path');
  const iconsUrl = new URL(iconsPathMatch[1], AFL_TEAMS_URL).toString();

  const iconsRes = await fetch(iconsUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'image/svg+xml,text/plain,*/*',
      Referer: AFL_TEAMS_URL,
    },
    next: { revalidate: 60 * 60 },
  });
  if (!iconsRes.ok) throw new Error(`Failed to fetch AFL icons sprite (${iconsRes.status})`);
  const iconsSvg = await iconsRes.text();

  const logos: Record<string, string> = {};
  const clubRegex = /<li[^>]*class="[^"]*\baflc-([a-z0-9]+)\b[^"]*"[\s\S]*?<a[^>]*title="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = clubRegex.exec(teamsHtml)) !== null) {
    const code = String(match[1] || '').trim().toLowerCase();
    const title = String(match[2] || '').trim();
    if (!code || !title) continue;

    const symbolRegex = new RegExp(`<symbol([^>]*)id="${escapeRegex(`icn-aflc-${code}`)}"([^>]*)>([\\s\\S]*?)<\\/symbol>`, 'i');
    const symbolMatch = iconsSvg.match(symbolRegex);
    if (!symbolMatch) continue;
    const attrs = `${symbolMatch[1] ?? ''} ${symbolMatch[2] ?? ''}`;
    const viewBoxMatch = attrs.match(/viewBox="([^"]+)"/i);
    const viewBox = viewBoxMatch?.[1] || '0 0 200 200';
    const symbolInner = symbolMatch[3];
    const inlineSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${viewBox}">${symbolInner}</svg>`;
    const logoDataUrl = svgToDataUrl(inlineSvg);

    const aliases = CODE_TO_ALIASES[code] ?? [title];
    addAliases(logos, title, logoDataUrl, aliases);
  }

  if (!Object.keys(logos).length) throw new Error('No AFL logos parsed from scrape');
  return logos;
}

export async function GET() {
  if (cache && cache.expiresAt > Date.now()) {
    return NextResponse.json({ source: 'afl.com.au', logos: cache.logos, cached: true });
  }

  try {
    const logos = await scrapeAflTeamLogos();
    cache = { expiresAt: Date.now() + TTL_MS, logos };
    return NextResponse.json({ source: 'afl.com.au', logos, cached: false });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Failed to scrape AFL team logos',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
