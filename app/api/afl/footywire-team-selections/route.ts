import { NextResponse } from 'next/server';
import { fetchFootyinfoRoundSummary } from '@/lib/afl/footyinfoLeague';
import { fetchFootyinfoMatchBoxScore } from '@/lib/afl/footyinfoMatch';
import { footyinfoAbbrevToOfficial, footyinfoNameToOfficial } from '@/lib/afl/footyinfoTeamMapping';

export type PlayerEntry = { name: string; number?: string };
export type PositionRow = { position: string; home_players: PlayerEntry[]; away_players: PlayerEntry[] };
export type TeamSelectionsResponse = {
  url: string;
  title: string | null;
  round_label: string | null;
  match: string | null;
  home_team: string | null;
  away_team: string | null;
  positions: PositionRow[];
  interchange: { home: string[]; away: string[] };
  ins: { home: string[]; away: string[] };
  outs: { home: string[]; away: string[] };
  emergencies: { home: string[]; away: string[] };
  average_attributes: null;
  total_players_by_games: null;
};
export type TeamSelectionsRoundResponse = {
  url: string;
  title: string | null;
  round_label: string | null;
  matches: TeamSelectionsResponse[];
};

const TTL_MS = 1000 * 60 * 15;
let cached: { expiresAt: number; data: TeamSelectionsRoundResponse } | null = null;
const key = (value: string | null | undefined) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function toSelection(match: Awaited<ReturnType<typeof fetchFootyinfoRoundSummary>>[number]): Promise<TeamSelectionsResponse> {
  const score = await fetchFootyinfoMatchBoxScore(match.id);
  const home = score?.home || [];
  const away = score?.away || [];
  const homeTeam = footyinfoNameToOfficial(match.home_team_full) || footyinfoAbbrevToOfficial(match.home_team) || match.home_team_full || match.home_team;
  const awayTeam = footyinfoNameToOfficial(match.away_team_full) || footyinfoAbbrevToOfficial(match.away_team) || match.away_team_full || match.away_team;
  return {
    url: match.slug ? `https://www.footyinfo.com/match/${match.slug}` : `https://www.footyinfo.com/match/${match.id}`,
    title: null,
    round_label: match.round_name_abbrev || match.round_name || null,
    match: `${homeTeam} v ${awayTeam}`,
    home_team: homeTeam,
    away_team: awayTeam,
    // FootyInfo's public match API supplies selected player lists but not
    // positional slots. Do not invent a field layout from list order.
    positions: [],
    interchange: { home: home.map((p) => p.playerName), away: away.map((p) => p.playerName) },
    ins: { home: [], away: [] },
    outs: { home: [], away: [] },
    emergencies: { home: [], away: [] },
    average_attributes: null,
    total_players_by_games: null,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const refresh = ['1', 'true'].includes(url.searchParams.get('refresh') || '');
  const teamParam = url.searchParams.get('team');
  const opponentParam = url.searchParams.get('opponent');
  const season = Number(url.searchParams.get('season') || new Date().getFullYear());
  if (!refresh && cached && cached.expiresAt > Date.now()) {
    return response(cached.data, teamParam, opponentParam);
  }
  const matches = await fetchFootyinfoRoundSummary(season, 166);
  const selections = await Promise.all(matches.map(toSelection));
  const data: TeamSelectionsRoundResponse = {
    url: 'https://www.footyinfo.com/',
    title: 'FootyInfo AFL team selections',
    round_label: selections[0]?.round_label || null,
    matches: selections,
  };
  cached = { expiresAt: Date.now() + TTL_MS, data };
  return response(data, teamParam, opponentParam);
}

function response(data: TeamSelectionsRoundResponse, team: string | null, opponent: string | null) {
  if (!team) return NextResponse.json({ ...data, source: 'footyinfo.com' });
  const wanted = key(footyinfoNameToOfficial(team) || team);
  const other = key(footyinfoNameToOfficial(opponent) || opponent);
  const match = data.matches.find((row) => {
    const home = key(row.home_team);
    const away = key(row.away_team);
    return (home === wanted || away === wanted) && (!other || home === other || away === other);
  });
  return NextResponse.json({ ...data, matches: match ? [match] : [], source: 'footyinfo.com' });
}
