/**
 * NBL real starters/bench via SportRadar Connect embed API
 * (same feed as the Atrium/Synergy box score on nbl.com.au).
 *
 * GET https://embed-api.eui.connect.sportradar.com/v1/embed/{websiteId}/fixture_detail?fixtureId={rosettaExternalId}&sub=statistics
 */

export const NBL_SPORTRADAR_WEBSITE_ID = '298';
export const NBL_SPORTRADAR_EMBED_BASE =
  'https://embed-api.eui.connect.sportradar.com/v1/embed';

export type NblLineupPlayer = {
  personId: string | null;
  name: string;
  jersey: string | null;
  position: string | null;
  imageUrl: string | null;
  starter: boolean;
};

export type NblTeamLineupFromMatch = {
  team: string;
  teamCode: string | null;
  isHome: boolean;
  starters: NblLineupPlayer[];
  bench: NblLineupPlayer[];
};

export type NblMatchLineups = {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: string | null;
  awayScore: string | null;
  tipoff: string | null;
  teams: NblTeamLineupFromMatch[];
};

type SrPersonRow = {
  starter?: boolean;
  participated?: boolean;
  personId?: string | null;
  personName?: string | null;
  name?: string | null;
  bib?: string | number | null;
  position?: string | null;
  personImage?: string | null;
  didNotPlayReason?: string | null;
};

function mapPerson(row: SrPersonRow): NblLineupPlayer | null {
  const name = String(row.personName || row.name || '').trim();
  if (!name) return null;
  return {
    personId: row.personId ? String(row.personId) : null,
    name,
    jersey: row.bib != null && String(row.bib).trim() !== '' ? String(row.bib) : null,
    position: row.position ? String(row.position) : null,
    imageUrl: row.personImage ? String(row.personImage) : null,
    starter: Boolean(row.starter),
  };
}

function sideLineup(
  side: 'home' | 'away',
  competitor: { name?: string; code?: string; isHome?: boolean } | null | undefined,
  rows: SrPersonRow[] | undefined
): NblTeamLineupFromMatch {
  const players = (rows || [])
    .filter((r) => r && !r.didNotPlayReason)
    .map(mapPerson)
    .filter((p): p is NblLineupPlayer => Boolean(p));

  const starters = players.filter((p) => p.starter);
  const bench = players.filter((p) => !p.starter);

  return {
    team: competitor?.name || (side === 'home' ? 'Home' : 'Away'),
    teamCode: competitor?.code ?? null,
    isHome: side === 'home',
    starters,
    bench,
  };
}

export async function fetchNblMatchLineupsFromSportRadar(
  fixtureId: string,
  options: { websiteId?: string; signal?: AbortSignal } = {}
): Promise<NblMatchLineups | null> {
  const id = String(fixtureId || '').trim();
  if (!id) return null;

  const websiteId = options.websiteId || NBL_SPORTRADAR_WEBSITE_ID;
  const url = `${NBL_SPORTRADAR_EMBED_BASE}/${websiteId}/fixture_detail?fixtureId=${encodeURIComponent(id)}&sub=statistics`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Origin: 'https://nbl.com.au',
      Referer: 'https://nbl.com.au/',
    },
    signal: options.signal,
  });

  if (!res.ok) return null;

  const json = (await res.json()) as {
    data?: {
      fixture?: {
        startTimeLocal?: string | null;
        startTimeUTC?: string | null;
        competitors?: Array<{
          name?: string;
          code?: string;
          isHome?: boolean;
          score?: string | number | null;
        }>;
      };
      banner?: {
        fixture?: {
          competitors?: Array<{
            name?: string;
            code?: string;
            isHome?: boolean;
            score?: string | number | null;
          }>;
        };
      };
      statistics?: {
        base?: {
          home?: { persons?: Array<{ rows?: SrPersonRow[] }> };
          away?: { persons?: Array<{ rows?: SrPersonRow[] }> };
        };
        data?: {
          base?: {
            home?: { persons?: Array<{ rows?: SrPersonRow[] }> };
            away?: { persons?: Array<{ rows?: SrPersonRow[] }> };
          };
        };
      };
    };
  };

  const base = json.data?.statistics?.data?.base || json.data?.statistics?.base;
  if (!base?.home && !base?.away) return null;

  const competitors =
    json.data?.fixture?.competitors || json.data?.banner?.fixture?.competitors || [];
  const homeComp = competitors.find((c) => c.isHome) || competitors[0] || null;
  const awayComp = competitors.find((c) => c.isHome === false) || competitors[1] || null;

  const homeRows = base.home?.persons?.[0]?.rows;
  const awayRows = base.away?.persons?.[0]?.rows;

  const home = sideLineup('home', homeComp, homeRows);
  const away = sideLineup('away', awayComp, awayRows);

  const homeScore =
    homeComp?.score != null && String(homeComp.score).trim() !== ''
      ? String(homeComp.score)
      : null;
  const awayScore =
    awayComp?.score != null && String(awayComp.score).trim() !== ''
      ? String(awayComp.score)
      : null;

  return {
    fixtureId: id,
    homeTeam: home.team,
    awayTeam: away.team,
    homeScore,
    awayScore,
    tipoff: json.data?.fixture?.startTimeUTC || json.data?.fixture?.startTimeLocal || null,
    teams: [home, away],
  };
}
