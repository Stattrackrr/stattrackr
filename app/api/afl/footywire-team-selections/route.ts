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
let inFlight: Promise<TeamSelectionsRoundResponse> | null = null;
const key = (value: string | null | undefined) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function toSelection(match: Awaited<ReturnType<typeof fetchFootyinfoRoundSummary>>[number]): Promise<TeamSelectionsResponse> {
  const score = await fetchFootyinfoMatchBoxScore(match.id, { lineupOnly: true });
  const home = score?.home || [];
  const away = score?.away || [];
  const homeTeam = footyinfoNameToOfficial(match.home_team_full) || footyinfoAbbrevToOfficial(match.home_team) || match.home_team_full || match.home_team;
  const awayTeam = footyinfoNameToOfficial(match.away_team_full) || footyinfoAbbrevToOfficial(match.away_team) || match.away_team_full || match.away_team;
  const slotPosition = (slot: number) => {
    if (slot >= 1 && slot <= 3) return 'FB';
    if (slot <= 6) return 'HB';
    if (slot <= 9) return 'C';
    if (slot <= 12) return 'HF';
    if (slot <= 15) return 'FF';
    if (slot <= 18) return 'Fol';
    return null;
  };
  const entriesFor = (players: typeof home, position: string): PlayerEntry[] =>
    players
      .filter((player) => slotPosition(player.positionSlot || 0) === position)
      .sort((a, b) => (a.positionSlot || 0) - (b.positionSlot || 0))
      .map((player) => ({
        name: player.playerName,
        ...(player.guernsey != null ? { number: String(player.guernsey) } : {}),
      }));
  const fieldPositions: PositionRow[] = ['FB', 'HB', 'C', 'HF', 'FF', 'Fol'].map((position) => ({
    position,
    home_players: entriesFor(home, position),
    away_players: entriesFor(away, position),
  })).filter((row) => row.home_players.length || row.away_players.length);
  // FootyInfo uses 19 for interchange and 20 for emergencies. Do not merge
  // emergencies into the bench: the official lineup sheet presents them separately.
  const bench = (players: typeof home) =>
    players.filter((player) => player.positionSlot === 19).map((player) => player.playerName);
  const emergencies = (players: typeof home) =>
    players.filter((player) => player.positionSlot === 20).map((player) => player.playerName);
  const changes = (side: 'home_stats' | 'away_stats', key: 'player_ins' | 'player_outs') =>
    (score?.meta?.[side]?.[key] || []).map((player) => String(player.n || '').trim()).filter(Boolean);
  return {
    url: match.slug ? `https://www.footyinfo.com/match/${match.slug}` : `https://www.footyinfo.com/match/${match.id}`,
    title: null,
    round_label: match.round_name_abbrev || match.round_name || null,
    match: `${homeTeam} v ${awayTeam}`,
    home_team: homeTeam,
    away_team: awayTeam,
    positions: fieldPositions,
    interchange: { home: bench(home), away: bench(away) },
    ins: { home: changes('home_stats', 'player_ins'), away: changes('away_stats', 'player_ins') },
    outs: { home: changes('home_stats', 'player_outs'), away: changes('away_stats', 'player_outs') },
    emergencies: { home: emergencies(home), away: emergencies(away) },
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
  if (!inFlight || refresh) {
    inFlight = (async () => {
      const matches = await fetchFootyinfoRoundSummary(season, 166);
      const selections = await Promise.all(matches.map(toSelection));
      return {
        url: 'https://www.footyinfo.com/',
        title: 'FootyInfo AFL team selections',
        round_label: selections[0]?.round_label || null,
        matches: selections,
      };
    })();
  }
  let data: TeamSelectionsRoundResponse;
  try {
    data = await inFlight;
  } finally {
    inFlight = null;
  }
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
