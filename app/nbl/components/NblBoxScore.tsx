'use client';

/** Empty box-score / game-log table shell. */
export function NblBoxScore({ isDark = false }: { isDark?: boolean }) {
  return (
    <div className={`w-full min-h-[200px] px-3 py-3 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
      <h3 className={`text-sm font-semibold mb-2 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
        Box Score
      </h3>
    </div>
  );
}
