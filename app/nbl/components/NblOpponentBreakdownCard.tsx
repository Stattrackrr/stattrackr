'use client';

/** Empty opponent-breakdown panel body. */
export default function NblOpponentBreakdownCard({ isDark = false }: { isDark?: boolean }) {
  return (
    <div className={`flex-1 min-h-0 w-full ${isDark ? 'text-gray-600' : 'text-gray-400'}`} />
  );
}
