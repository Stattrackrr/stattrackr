'use client';

export function TennisShotChart({
  isDark = false,
  playerName = null,
}: {
  isDark?: boolean;
  playerName?: string | null;
  playerTeam?: string | null;
  opponentTeam?: string | null;
}) {
  return (
    <div className="w-full flex flex-col bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-4 gap-3 border border-gray-200 dark:border-gray-700 min-h-[380px]">
      <div className="flex items-center gap-2">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Shot Chart</h2>
      </div>
      <div className={`flex-1 flex items-center justify-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        {playerName
          ? 'Shot locations are not in the tennis match feed.'
          : 'Select a player to load shot locations.'}
      </div>
    </div>
  );
}
