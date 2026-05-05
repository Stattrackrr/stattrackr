'use client';

import { useState } from 'react';

import { SoccerHomeAwayCard } from '@/app/soccer/components/SoccerHomeAwayCard';
import { SoccerTeamFormCard } from '@/app/soccer/components/SoccerTeamFormCard';

export type SoccerTeamFormHomeAwayTab = 'team_form' | 'home_away';

type SoccerTeamFormHomeAwayPanelProps = {
  isDark: boolean;
  teamName: string | null;
  teamHref: string | null;
  opponentName: string | null;
  opponentHref: string | null;
  nextCompetitionName: string | null;
  nextCompetitionCountry: string | null;
  emptyTextClass: string;
  showSkeleton?: boolean;
};

const TAB_BTN_BASE =
  'flex-1 px-2 xl:px-2.5 py-1.5 xl:py-1.5 text-xs xl:text-sm font-semibold rounded-lg transition-colors border';

export function SoccerTeamFormHomeAwayPanel({
  isDark,
  teamName,
  teamHref,
  opponentName,
  opponentHref,
  nextCompetitionName,
  nextCompetitionCountry,
  emptyTextClass,
  showSkeleton = false,
}: SoccerTeamFormHomeAwayPanelProps) {
  const [tab, setTab] = useState<SoccerTeamFormHomeAwayTab>('team_form');
  const [tabsVisited, setTabsVisited] = useState<Set<SoccerTeamFormHomeAwayTab>>(() => new Set(['team_form']));

  const inactiveTab =
    'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700';
  const activeTab = 'bg-purple-600 text-white border-purple-600';

  const sharedCardProps = {
    isDark,
    teamName,
    teamHref,
    opponentName,
    opponentHref,
    emptyTextClass,
    showSkeleton,
    hideTitle: true as const,
  };

  return (
    <div className="flex w-full min-w-0 flex-col overflow-hidden px-0.5 pb-0.5 pt-0.5 xl:px-1 xl:pb-1 xl:pt-1">
      <div className="mb-1 flex flex-shrink-0 gap-1 xl:gap-1.5">
        <button
          type="button"
          onClick={() => {
            setTab('team_form');
            setTabsVisited((prev) => new Set(prev).add('team_form'));
          }}
          className={`${TAB_BTN_BASE} ${tab === 'team_form' ? activeTab : inactiveTab}`}
        >
          Team Form
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('home_away');
            setTabsVisited((prev) => new Set(prev).add('home_away'));
          }}
          className={`${TAB_BTN_BASE} ${tab === 'home_away' ? activeTab : inactiveTab}`}
        >
          Home vs Away
        </button>
      </div>

      <div className="relative flex flex-col">
        {tabsVisited.has('team_form') ? (
          <div className={tab === 'team_form' ? 'flex min-w-0 flex-col' : 'hidden'}>
            <SoccerTeamFormCard
              {...sharedCardProps}
              nextCompetitionName={nextCompetitionName}
              nextCompetitionCountry={nextCompetitionCountry}
            />
          </div>
        ) : null}
        {tabsVisited.has('home_away') ? (
          <div className={tab === 'home_away' ? 'flex min-w-0 flex-col' : 'hidden'}>
            <SoccerHomeAwayCard {...sharedCardProps} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
