'use client';

import { useState } from 'react';

import { SoccerDvpPanel } from '@/app/soccer/components/SoccerDvpPanel';
import { SoccerOpponentBreakdownPanel } from '@/app/soccer/components/SoccerOpponentBreakdownPanel';
import { SoccerTeamMatchupCard } from '@/app/soccer/components/SoccerTeamMatchupCard';

type SoccerOpponentBreakdownMatchupPanelProps = {
  isDark: boolean;
  teamName: string | null;
  teamHref: string | null;
  opponentName: string | null;
  opponentHref: string | null;
  nextCompetitionName: string | null;
  nextCompetitionCountry: string | null;
  statKey?: string | null;
  playerPosition?: string | null;
  emptyTextClass: string;
  showSkeleton?: boolean;
};

type OpponentInsightsTab = 'opponent_breakdown' | 'team_matchup' | 'dvp';

const TAB_BTN_BASE =
  'flex-1 px-2 xl:px-2.5 py-1.5 xl:py-1.5 text-xs xl:text-sm font-semibold rounded-lg transition-colors border';

export function SoccerOpponentBreakdownMatchupPanel({
  isDark,
  teamName,
  teamHref,
  opponentName,
  opponentHref,
  nextCompetitionName,
  nextCompetitionCountry,
  statKey = null,
  playerPosition = null,
  emptyTextClass,
  showSkeleton = false,
}: SoccerOpponentBreakdownMatchupPanelProps) {
  const [tab, setTab] = useState<OpponentInsightsTab>('dvp');
  const [tabsVisited, setTabsVisited] = useState<Set<OpponentInsightsTab>>(() => new Set(['dvp']));

  const inactiveTab =
    'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700';
  const activeTab = 'bg-purple-600 text-white border-purple-600';

  return (
    <div className="flex w-full min-w-0 flex-col overflow-hidden px-0.5 pb-0.5 pt-0.5 xl:px-1 xl:pb-1 xl:pt-1">
      <div className="mb-1 flex flex-shrink-0 gap-1 xl:gap-1.5">
        <button
          type="button"
          onClick={() => {
            setTab('dvp');
            setTabsVisited((prev) => new Set(prev).add('dvp'));
          }}
          className={`${TAB_BTN_BASE} ${tab === 'dvp' ? activeTab : inactiveTab}`}
        >
          DVP
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('opponent_breakdown');
            setTabsVisited((prev) => new Set(prev).add('opponent_breakdown'));
          }}
          className={`${TAB_BTN_BASE} ${tab === 'opponent_breakdown' ? activeTab : inactiveTab}`}
        >
          Opponent Breakdown
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('team_matchup');
            setTabsVisited((prev) => new Set(prev).add('team_matchup'));
          }}
          className={`${TAB_BTN_BASE} ${tab === 'team_matchup' ? activeTab : inactiveTab}`}
        >
          Team Matchup
        </button>
      </div>

      <div className="relative flex flex-col">
        {tabsVisited.has('opponent_breakdown') ? (
          <div className={tab === 'opponent_breakdown' ? 'flex min-w-0 flex-col' : 'hidden'}>
            <SoccerOpponentBreakdownPanel
              isDark={isDark}
              nextCompetitionName={nextCompetitionName}
              nextCompetitionCountry={nextCompetitionCountry}
              opponentName={opponentName}
              opponentHref={opponentHref}
              emptyTextClass={emptyTextClass}
              showSkeleton={showSkeleton}
              hideTitle={true}
            />
          </div>
        ) : null}
        {tabsVisited.has('team_matchup') ? (
          <div className={tab === 'team_matchup' ? 'flex min-w-0 flex-col' : 'hidden'}>
            <SoccerTeamMatchupCard
              isDark={isDark}
              teamName={teamName}
              teamHref={teamHref}
              opponentName={opponentName}
              opponentHref={opponentHref}
              nextCompetitionName={nextCompetitionName}
              nextCompetitionCountry={nextCompetitionCountry}
              emptyTextClass={emptyTextClass}
              showSkeleton={showSkeleton}
              hideTitle={true}
            />
          </div>
        ) : null}
        {tabsVisited.has('dvp') ? (
          <div className={tab === 'dvp' ? 'flex min-w-0 flex-col' : 'hidden'}>
            <SoccerDvpPanel
              isDark={isDark}
              nextCompetitionName={nextCompetitionName}
              nextCompetitionCountry={nextCompetitionCountry}
              opponentName={opponentName}
              opponentHref={opponentHref}
              statKey={statKey}
              playerPosition={playerPosition}
              emptyTextClass={emptyTextClass}
              showSkeleton={showSkeleton}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
