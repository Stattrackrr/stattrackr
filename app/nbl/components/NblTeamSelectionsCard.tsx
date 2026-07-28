'use client';

/** Empty lineup / team-selections shell. */
export function NblTeamSelectionsCard({ isDark = false }: { isDark?: boolean }) {
  return (
    <div className={`w-full min-h-[120px] px-3 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
      <h3 className={`text-sm font-semibold mb-2 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
        Lineups
      </h3>
    </div>
  );
}
