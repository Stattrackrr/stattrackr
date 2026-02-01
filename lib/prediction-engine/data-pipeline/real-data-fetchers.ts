/**
 * Real Data Fetchers
 * Fetches referee, coach, and arena data from ESPN and static NBA sources
 */

import type { RefereeData, ArenaData, CoachData } from '../types';

const ESPN_BASE = 'https://site.api.espn.com';
const ESPN_V2_BASE = 'https://site.web.api.espn.com/apis/v2/sports/basketball/nba';

function formatYMD(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function normalizeTeam(abbr: string): string {
  return String(abbr || '').toUpperCase().trim();
}

function matchTeam(comp: any, targetAbbr: string): boolean {
  const target = normalizeTeam(targetAbbr);
  const abbr = normalizeTeam(comp?.team?.abbreviation);
  const shortName = normalizeTeam(comp?.team?.shortDisplayName);
  const name = normalizeTeam(comp?.team?.name);
  return abbr === target || shortName === target || name === target;
}

/** ESPN team abbr map (ESPN uses some different abbrevs) */
const ESPN_TEAM_MAP: Record<string, string> = {
  BKN: 'BKN', NYK: 'NY', WAS: 'WSH', SAS: 'SA', GSW: 'GS', NOP: 'NO', UTA: 'UTAH', PHX: 'PHO',
};

function espnTeamAbbr(bdlAbbr: string): string {
  return ESPN_TEAM_MAP[bdlAbbr] || bdlAbbr;
}

/**
 * Fetch referee for a game from ESPN scoreboard/summary
 * ESPN summary includes officials for each game
 */
export async function fetchRefereeFromESPN(
  homeTeam: string,
  awayTeam: string,
  gameDate: string
): Promise<RefereeData | null> {
  try {
    const ymd = gameDate.includes('-')
      ? gameDate.replace(/-/g, '')
      : formatYMD(gameDate);
    const sbUrl = `${ESPN_V2_BASE}/scoreboard?dates=${ymd}`;
    const sbRes = await fetch(sbUrl, { cache: 'no-store', next: { revalidate: 0 } });
    if (!sbRes.ok) return null;

    const sb = await sbRes.json();
    const events = sb?.events || [];

    const homeNorm = espnTeamAbbr(normalizeTeam(homeTeam));
    const awayNorm = espnTeamAbbr(normalizeTeam(awayTeam));

    let evt: any = null;
    for (const e of events) {
      const comps = e?.competitions?.[0]?.competitors || [];
      const homeMatch = comps.some((c: any) => matchTeam(c, homeNorm) || matchTeam(c, homeTeam));
      const awayMatch = comps.some((c: any) => matchTeam(c, awayNorm) || matchTeam(c, awayTeam));
      if (homeMatch && awayMatch) {
        evt = e;
        break;
      }
    }

    if (!evt) return null;

    // Check if officials are on the event itself (scoreboard)
    const comps = evt?.competitions?.[0];
    let officials = comps?.officials || comps?.competitors?.[0]?.officials || [];

    if (officials.length === 0) {
      const eventId = String(evt?.id || evt?.uid?.split(':').pop() || '');
      if (!eventId) return null;

      const sumUrl = `${ESPN_V2_BASE}/summary?event=${eventId}`;
      const sumRes = await fetch(sumUrl, { cache: 'no-store', next: { revalidate: 0 } });
      if (!sumRes.ok) return null;

      const sum = await sumRes.json();
      officials = sum?.gameInfo?.officials || sum?.officials || sum?.boxscore?.officials || [];
      if (officials.length === 0) {
        const altUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`;
        const altRes = await fetch(altUrl, { cache: 'no-store', next: { revalidate: 0 } });
        if (altRes.ok) {
          const alt = await altRes.json();
          officials = alt?.gameInfo?.officials || alt?.officials || [];
        }
      }
    }
    const crewChief = officials.find((o: any) =>
      /crew chief|crewchief/i.test(o?.position || '') || /crew chief|crewchief/i.test(o?.title || '')
    );
    const firstOfficial = crewChief || officials[0];
    if (!firstOfficial) return null;

    const name = firstOfficial?.displayName || firstOfficial?.name || firstOfficial?.athlete?.displayName || '';
    if (!name) return null;

    return {
      name: name.trim(),
      foulsPerGame: 40,
      pace: 100,
      homeBias: 0,
      totalGames: 0,
    };
  } catch (err) {
    console.warn('[Real Data] ESPN referee fetch error:', err);
    return null;
  }
}

/**
 * Fetch head coach for a team from ESPN teams API
 * ESPN team page / roster may include coaching staff
 */
export async function fetchCoachFromESPN(teamAbbr: string): Promise<CoachData | null> {
  try {
    const teamsUrl = `${ESPN_BASE}/apis/site/v2/sports/basketball/nba/teams`;
    const res = await fetch(teamsUrl, { cache: 'no-store', next: { revalidate: 3600 } });
    if (!res.ok) return null;

    const data = await res.json();
    const teams = data?.sports?.[0]?.leagues?.[0]?.teams || [];
    const targetNorm = espnTeamAbbr(normalizeTeam(teamAbbr));
    const targetRaw = normalizeTeam(teamAbbr);

    const teamData = teams.find((t: any) => {
      const abbr = normalizeTeam(t?.team?.abbreviation);
      const short = normalizeTeam(t?.team?.shortDisplayName);
      return abbr === targetNorm || short === targetNorm || abbr === targetRaw || short === targetRaw;
    });

    if (!teamData?.team?.id) return null;

    const teamId = teamData.team.id;
    // Try team detail with roster - sometimes includes staff/coaches
    const teamUrl = `${ESPN_BASE}/apis/site/v2/sports/basketball/nba/teams/${teamId}`;
    const teamRes = await fetch(teamUrl, { cache: 'no-store', next: { revalidate: 3600 } });
    if (!teamRes.ok) return null;

    const teamDetail = await teamRes.json();
    const teamObj = teamDetail?.team || teamDetail;
    const coaches = teamObj?.coaches || teamObj?.coachingStaff || teamDetail?.coaches || [];
    const headCoach = Array.isArray(coaches)
      ? coaches.find((c: any) => /head|hc/i.test(c?.position || c?.title || c?.type || '')) || coaches[0]
      : null;
    const coach = headCoach || teamObj?.headCoach;
    const coachName = coach?.firstName && coach?.lastName
      ? `${coach.firstName} ${coach.lastName}`.trim()
      : coach?.displayName || coach?.name || coach?.fullName;

    if (!coachName) return null;

    return {
      name: coachName,
      team: teamAbbr,
      restTendency: 0.5,
      blowoutTendency: 0.7,
      minutesRestrictionTendency: 0.3,
      system: 'balanced',
      avgStarterMinutes: 32,
    };
  } catch (err) {
    console.warn('[Real Data] ESPN coach fetch error:', err);
    return null;
  }
}

/**
 * Static NBA arena data (all 30 teams)
 * Altitude and arena names are well-documented, stable data
 */
export const NBA_ARENAS: Record<string, ArenaData> = {
  ATL: { name: 'State Farm Arena', team: 'ATL', city: 'Atlanta', altitude: 1050, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/New_York' },
  BOS: { name: 'TD Garden', team: 'BOS', city: 'Boston', altitude: 20, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/New_York' },
  BKN: { name: 'Barclays Center', team: 'BKN', city: 'Brooklyn', altitude: 10, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/New_York' },
  CHA: { name: 'Spectrum Center', team: 'CHA', city: 'Charlotte', altitude: 760, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/New_York' },
  CHI: { name: 'United Center', team: 'CHI', city: 'Chicago', altitude: 597, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Chicago' },
  CLE: { name: 'Rocket Mortgage FieldHouse', team: 'CLE', city: 'Cleveland', altitude: 653, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/New_York' },
  DAL: { name: 'American Airlines Center', team: 'DAL', city: 'Dallas', altitude: 430, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Chicago' },
  DEN: { name: 'Ball Arena', team: 'DEN', city: 'Denver', altitude: 5280, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Denver' },
  DET: { name: 'Little Caesars Arena', team: 'DET', city: 'Detroit', altitude: 600, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Detroit' },
  GSW: { name: 'Chase Center', team: 'GSW', city: 'San Francisco', altitude: 0, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Los_Angeles' },
  HOU: { name: 'Toyota Center', team: 'HOU', city: 'Houston', altitude: 50, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Chicago' },
  IND: { name: 'Gainbridge Fieldhouse', team: 'IND', city: 'Indianapolis', altitude: 715, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Indiana/Indianapolis' },
  LAC: { name: 'Crypto.com Arena', team: 'LAC', city: 'Los Angeles', altitude: 300, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Los_Angeles' },
  LAL: { name: 'Crypto.com Arena', team: 'LAL', city: 'Los Angeles', altitude: 300, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Los_Angeles' },
  MEM: { name: 'FedExForum', team: 'MEM', city: 'Memphis', altitude: 337, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Chicago' },
  MIA: { name: 'Kaseya Center', team: 'MIA', city: 'Miami', altitude: 7, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/New_York' },
  MIL: { name: 'Fiserv Forum', team: 'MIL', city: 'Milwaukee', altitude: 597, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Chicago' },
  MIN: { name: 'Target Center', team: 'MIN', city: 'Minneapolis', altitude: 830, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Chicago' },
  NOP: { name: 'Smoothie King Center', team: 'NOP', city: 'New Orleans', altitude: 7, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Chicago' },
  NYK: { name: 'Madison Square Garden', team: 'NYK', city: 'New York', altitude: 33, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/New_York' },
  OKC: { name: 'Paycom Center', team: 'OKC', city: 'Oklahoma City', altitude: 1200, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Chicago' },
  ORL: { name: 'Kia Center', team: 'ORL', city: 'Orlando', altitude: 82, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/New_York' },
  PHI: { name: 'Wells Fargo Center', team: 'PHI', city: 'Philadelphia', altitude: 39, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/New_York' },
  PHX: { name: 'Footprint Center', team: 'PHX', city: 'Phoenix', altitude: 1090, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Phoenix' },
  POR: { name: 'Moda Center', team: 'POR', city: 'Portland', altitude: 50, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Los_Angeles' },
  SAC: { name: 'Golden 1 Center', team: 'SAC', city: 'Sacramento', altitude: 25, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Los_Angeles' },
  SAS: { name: 'Frost Bank Center', team: 'SAS', city: 'San Antonio', altitude: 650, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Chicago' },
  TOR: { name: 'Scotiabank Arena', team: 'TOR', city: 'Toronto', altitude: 250, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Toronto' },
  UTA: { name: 'Delta Center', team: 'UTA', city: 'Salt Lake City', altitude: 4226, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/Denver' },
  WAS: { name: 'Capital One Arena', team: 'WAS', city: 'Washington', altitude: 0, shootingFactor: 1.0, homeCourtAdvantage: 1.0, timezone: 'America/New_York' },
};

export function getArenaFromStatic(teamAbbr: string): ArenaData | null {
  const key = normalizeTeam(teamAbbr);
  return NBA_ARENAS[key] || null;
}
