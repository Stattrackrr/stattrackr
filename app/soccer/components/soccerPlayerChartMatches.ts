import type { PlayerMatchStats } from '@/lib/soccerPlayerStatsScrape';
import type { SoccerPlayerChartTimeframe } from '@/app/soccer/components/soccerPlayerPropsTypes';

export function getPlayerMatchCompetitionKey(match: PlayerMatchStats): string {
  return `${String(match.competitionCountry || '').trim()}:::${String(match.competitionName || '').trim()}`;
}

export function getSoccerSeasonYear(kickoff: Date | null): number {
  if (!kickoff) return 0;
  const month = kickoff.getUTCMonth();
  const year = kickoff.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

function normalizeOpponentName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function playerOpponentNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeOpponentName(a);
  const right = normalizeOpponentName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function filterPlayerMatchesByCompetition(
  matches: PlayerMatchStats[],
  competitionFilter: string
): PlayerMatchStats[] {
  if (competitionFilter === 'all') return matches;
  return matches.filter((match) => getPlayerMatchCompetitionKey(match) === competitionFilter);
}

/** Same match window as the main player props chart (oldest → newest). */
export function getPlayerChartMatches(
  matches: PlayerMatchStats[],
  timeframe: SoccerPlayerChartTimeframe,
  options: {
    competitionFilter?: string;
    nextOpponentName?: string | null;
    currentSeasonYear?: number;
  } = {}
): PlayerMatchStats[] {
  const competitionFilter = options.competitionFilter ?? 'all';
  const nextOpponentName = options.nextOpponentName ?? null;
  const currentSeasonYear = options.currentSeasonYear ?? getSoccerSeasonYear(new Date());

  const filteredMatches = filterPlayerMatchesByCompetition(matches, competitionFilter);
  const sortedNewestFirst = [...filteredMatches].sort((a, b) => (b.kickoffUnix ?? 0) - (a.kickoffUnix ?? 0));

  if (timeframe === 'h2h') {
    if (!nextOpponentName?.trim()) return [];
    return sortedNewestFirst
      .filter((match) => playerOpponentNamesMatch(match.opponent, nextOpponentName))
      .slice(0, 15)
      .sort((a, b) => (a.kickoffUnix ?? 0) - (b.kickoffUnix ?? 0));
  }

  if (timeframe === 'thisSeason' || timeframe === 'lastSeason') {
    const targetSeason = timeframe === 'thisSeason' ? currentSeasonYear : currentSeasonYear - 1;
    return sortedNewestFirst
      .filter((match) => {
        const kickoff = match.kickoffUnix ? new Date(match.kickoffUnix * 1000) : null;
        return getSoccerSeasonYear(kickoff) === targetSeason;
      })
      .sort((a, b) => (a.kickoffUnix ?? 0) - (b.kickoffUnix ?? 0));
  }

  const limited =
    timeframe === 'last5'
      ? sortedNewestFirst.slice(0, 5)
      : timeframe === 'last10'
        ? sortedNewestFirst.slice(0, 10)
        : timeframe === 'last20'
          ? sortedNewestFirst.slice(0, 20)
          : timeframe === 'last50'
            ? sortedNewestFirst.slice(0, 50)
            : sortedNewestFirst;

  return limited.sort((a, b) => (a.kickoffUnix ?? 0) - (b.kickoffUnix ?? 0));
}
