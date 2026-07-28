'use client';

/** Empty injuries shell — matches AFL desktop h-[320px] content area. */
export function NblInjuriesCard({ isDark = false }: { isDark?: boolean }) {
  return (
    <div className={`h-full w-full min-h-[280px] ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
      <h3 className={`text-sm font-semibold mb-2 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
        Injuries
      </h3>
    </div>
  );
}
