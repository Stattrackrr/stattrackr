'use client';

/** Empty ladder shell. */
export function NblLadderCard({ isDark = false }: { isDark?: boolean }) {
  return (
    <div className={`w-full min-h-[240px] ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
      <h3 className={`text-sm font-semibold mb-2 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
        Ladder
      </h3>
    </div>
  );
}
