'use client';

export function TennisInjuriesCard({
  isDark = false,
}: {
  isDark?: boolean;
  season?: number;
  playerTeam?: string | null;
  playerName?: string | null;
  gameLogs?: Array<Record<string, unknown>>;
  rosterPlayers?: Array<{ name: string; playerId: string | null; team: string }>;
  teammateFilterName?: string | null;
  setTeammateFilterName?: (name: string | null) => void;
  withWithoutMode?: 'with' | 'without';
  setWithWithoutMode?: (mode: 'with' | 'without') => void;
  clearTeammateFilter?: () => void;
}) {
  return (
    <div className="flex flex-col h-full min-h-[280px]">
      <h3 className={`text-sm font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Injuries</h3>
      <div className={`flex-1 flex items-center justify-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        Injury reports are not in the tennis match feed.
      </div>
    </div>
  );
}
