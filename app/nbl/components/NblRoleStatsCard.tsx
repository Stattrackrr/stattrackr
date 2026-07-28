'use client';

/** Empty role-stats panel body. */
export function NblRoleStatsCard({ isDark = false }: { isDark?: boolean }) {
  return (
    <div className={`w-full min-h-[180px] ${isDark ? 'text-gray-600' : 'text-gray-400'}`} />
  );
}
